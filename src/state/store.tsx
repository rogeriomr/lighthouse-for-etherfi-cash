import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { demoDataset } from '../lib/demo/dataset';
import { shiftDemo } from '../lib/demo/shift';
import { enrichDataset, localToday } from '../lib/enrich';
import { AppError, toLoadError, type LoadError } from '../lib/errors';
import { setFormatTimeZone, setFormatToday } from '../lib/format';
import { McpClient, McpError, parseToolJson } from '../lib/mcp';
import { clearTokens, getTokens, handleCallback, hasPendingAuth, isCallbackRoute, refreshIfNeeded, startAuthorize } from '../lib/oauth';
import { bundleFromFiles, datasetFromBundle, hasAccountData, mergeTransactionPages, type FileVerdict, type RawFile } from '../lib/rawFiles';
import { forgetEverything, KEYS, NAMESPACE, readLarge, readStore, removeLarge, removeStore, writeLarge, writeStore } from '../lib/storage';
import type { ConnectionState, Dataset, ToolErrors, ToolName } from '../lib/types';
import { pick } from '../lib/locale';
import { ShellSkeleton } from '../components/skeleton';
import { useLocale } from './locale';

/** De onde vêm os dados na tela. `import`: arquivos do `npm run pull` escolhidos na tela de Conexão. */
export type Source = 'demo' | 'live' | 'fixtures' | 'import';

/** O que foi importado (sem os dados): para a tela de Conexão dizer o que está carregado e se fica lembrado. */
export interface ImportInfo {
  /** arquivos usados */
  files: number;
  /** modificação mais recente dos arquivos do extrato (≈ quando o npm run pull rodou), AAAA-MM-DD local */
  pulledOn?: string;
  /** guardado no IndexedDB deste navegador */
  remembered: boolean;
}

/** Arquivos da IA que a validação (validate.ts) aparou: itens descartados e arquivos ignorados inteiros. */
export interface AiFileIssues {
  dropped: number;
  invalidFiles: ('evidence' | 'research' | 'audit')[];
}

export interface ImportReport {
  ok: boolean;
  error?: LoadError;
  verdicts: FileVerdict[];
  remembered: boolean;
  /** pediu para lembrar, mas o navegador recusou */
  rememberFailed?: boolean;
}

interface StoreValue {
  source: Source;
  /** dados de exemplo na tela: o demo ou o ?fixtures=sample (arquivos sintéticos) */
  isSample: boolean;
  connection: ConnectionState;
  dataset: Dataset;
  /** falha parcial: o motivo por ferramenta (o resto carregou) */
  toolErrors: ToolErrors;
  /** a lista de ferramentas do conector não veio (só informativo; a carga segue) */
  toolsError: LoadError | null;
  /**
   * Por que a última tentativa de carregar dados reais falhou (null = sem falha). Com ela ligada e sem dados
   * anteriores, a tela continua no demo, mas a faixa de erro diz o motivo: nunca cai calado no demo.
   */
  loadError: LoadError | null;
  loading: boolean;
  toolNames: string[];
  importInfo: ImportInfo | null;
  /** null quando os arquivos da IA (?fixtures ou importação) entraram inteiros ou não vieram */
  aiFileIssues: AiFileIssues | null;
  connect: (scopes: string[]) => void;
  disconnect: () => void;
  refresh: () => void;
  /** Repete a última tentativa que falhou (conector, fixtures ou arquivos lembrados). */
  retry: () => void;
  importFiles: (files: File[], remember: boolean) => Promise<ImportReport>;
  /** Apaga os arquivos importados (da memória e do IndexedDB) e volta ao demo se eles estavam na tela. */
  forgetImport: () => Promise<void>;
  /** "Esquecer tudo neste navegador": storage.forgetEverything + sessão + volta ao demo. */
  forgetAll: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

/** Teto de páginas do extrato (100 linhas cada) por carregamento */
const MAX_TX_PAGES = 30;
/** Arquivo maior que isso não é do npm run pull (e travaria a aba) */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Um lote maior que isso estoura a memória antes de qualquer validação */
const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const IMPORT_KEY = 'import';

/**
 * Cada importação/“esquecer” invalida a anterior. Um arquivo grande lido devagar não pode aplicar dados velhos por
 * cima de uma importação mais nova, nem regravar o que a pessoa acabou de apagar.
 */
let importGeneration = 0;

// Hora local em todo o app: os dados reais são reescritos neste fuso (enrichDataset) e o rótulo sai dele
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
setFormatTimeZone(BROWSER_TZ);

// o demo visto hoje: as datas andam até o referenceDate cair no dia de hoje (os checks usam o cru)
const DEMO = shiftDemo(demoDataset, localToday(BROWSER_TZ));

// dev: ?fixtures lê fixtures/live/ e ?fixtures=sample lê fixtures/sample/ (vite.config). Fora do dev, nem existe.
const DEV_FIXTURES = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('fixtures') : null;

interface RememberedImport {
  at: string;
  files: number;
}
const validRemembered = (raw: unknown): RememberedImport | undefined =>
  raw && typeof raw === 'object' && typeof (raw as RememberedImport).at === 'string' ? (raw as RememberedImport) : undefined;
const rememberedImport = () => readStore<RememberedImport | null>(KEYS.importRemember, null, validRemembered);

const validRawFiles = (raw: unknown): RawFile[] | undefined =>
  Array.isArray(raw)
    ? raw.filter((f): f is RawFile => Boolean(f) && typeof f === 'object' && typeof (f as RawFile).name === 'string')
    : undefined;

/**
 * Os arquivos crus que o plugin do vite.config serve. Só existe no dev: no build, import.meta.env.DEV vira false
 * e a função inteira (com o fetch de /__fixtures) sai do bundle.
 */
const fetchDevFixtures = import.meta.env.DEV
  ? async (set: string): Promise<RawFile[]> => {
    const res = await fetch(`/__fixtures${set ? `?set=${encodeURIComponent(set)}` : ''}`, { cache: 'no-store' });
    if (res.status === 404) throw new AppError('fixtures_missing', 404);
    if (!res.ok) throw new AppError('fixtures_bad', res.status);
    const body = (await res.json().catch(() => null)) as { files?: unknown } | null;
    const files = validRawFiles(body?.files);
    if (!files) throw new AppError('fixtures_bad');
    return files;
  }
  : null;

// Com ?fixtures, retorno do OAuth, sessão salva ou arquivos lembrados, os dados reais estão a caminho: até chegarem,
// nada de demo na tela
const wantsRealData = () =>
  DEV_FIXTURES !== null || (isCallbackRoute() && hasPendingAuth()) || Boolean(getTokens()) || rememberedImport() !== null;

// O código de autorização vale uma vez: no StrictMode o efeito de carga roda duas vezes, a troca só uma
let callbackExchange: Promise<unknown> | null = null;

/** Arquivos escolhidos → RawFile (JSON lido; `json` undefined quando não é JSON ou é grande demais). */
async function readFiles(files: File[]): Promise<RawFile[]> {
  const out: RawFile[] = [];
  // sequencial: 20 arquivos de 2 MB lidos de uma vez também são 40 MB de texto antes do parse
  for (const f of files) {
    let json: unknown;
    if (f.size <= MAX_FILE_BYTES) {
      try {
        json = JSON.parse(await f.text());
      } catch {
        json = undefined;
      }
    }
    out.push({ name: f.name, json, modified: f.lastModified });
  }
  return out;
}

/** Dia local da modificação mais recente dos arquivos do extrato: quando o npm run pull rodou. */
function pulledOn(files: RawFile[], verdicts: FileVerdict[]): string | undefined {
  const used = new Set(verdicts.filter((v) => v.status === 'used' && v.kind === 'transactions').map((v) => v.name));
  const newest = Math.max(0, ...files.filter((f) => used.has(f.name) && f.modified).map((f) => f.modified ?? 0));
  return newest ? localToday(BROWSER_TZ, new Date(newest)) : undefined;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore fora do provider');
  return ctx;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();

  const [source, setSource] = useState<Source>('demo');
  // guarda os dados brutos; o enriquecimento depende do idioma (nomes descritivos como "Uber · ride")
  const [raw, setRaw] = useState<Dataset>(DEMO);
  // o demo já vem em hora de parede; os dados reais (UTC) passam para o fuso do navegador. Trocar o idioma refaz
  // isto dentro da transição do LocaleProvider (render de fundo, em fatias)
  const dataset = useMemo(() => enrichDataset(raw, locale, raw === DEMO ? undefined : BROWSER_TZ), [raw, locale]);
  // como o idioma no LocaleProvider: antes de os filhos renderizarem, "este ano" é o do referenceDate
  setFormatToday(dataset.referenceDate);
  const [booting, setBooting] = useState(wantsRealData);
  const [toolErrors, setToolErrors] = useState<ToolErrors>({});
  const [toolsError, setToolsError] = useState<LoadError | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(false);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [importInfo, setImportInfo] = useState<ImportInfo | null>(null);
  const [aiFileIssues, setAiFileIssues] = useState<AiFileIssues | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(() =>
    (isCallbackRoute() && hasPendingAuth()) || getTokens() ? { kind: 'connecting' } : { kind: 'demo' },
  );
  const clientRef = useRef<McpClient | null>(null);
  // identidade da carga ao vivo: refresh/retry que terminam fora de ordem não podem sobrescrever dados mais novos
  const loadGen = useRef(0);
  // os arquivos importados, para somar os da IA depois e lembrar o conjunto inteiro
  const importedRef = useRef<RawFile[]>([]);
  // a última tentativa, para o "Tentar de novo" da faixa de erro
  const lastAttempt = useRef<'live' | 'fixtures' | 'remembered' | null>(null);
  // a fonte atual para os callbacks estáveis (importar, recarregar), atualizada depois do render
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const loadLive = useCallback(async (keepCurrent = false) => {
    const gen = ++loadGen.current;
    const current = () => gen === loadGen.current;
    lastAttempt.current = 'live';
    setLoading(true);
    try {
      const client = clientRef.current ?? new McpClient(async () => {
        const tokens = await refreshIfNeeded();
        return tokens.accessToken;
      });
      clientRef.current = client;

      // a lista de ferramentas é só informativa: falhou, registra o motivo e segue (401 derruba a sessão)
      const tools = await client.listTools().catch((err: unknown) => {
        if (err instanceof McpError && err.kind === 'unauthorized') throw err;
        setToolsError(toLoadError(err));
        return null;
      });
      if (!current()) return;
      if (tools) {
        setToolsError(null);
        setToolNames(tools.map((t) => t.name));
      }

      // "hoje" no mesmo relógio das datas reescritas em hora local
      const referenceDate = localToday(BROWSER_TZ);
      const errors: ToolErrors = {};
      const call = async (name: ToolName, args: Record<string, unknown> = {}) => {
        try {
          const result = await client.callTool(name, args);
          if (result.isError) {
            errors[name] = { code: 'tool_error' };
            return undefined;
          }
          return parseToolJson(result);
        } catch (err) {
          // 401 não é "escopo ausente": propaga para derrubar a sessão e pedir reconexão
          if (err instanceof McpError && err.kind === 'unauthorized') throw err;
          errors[name] = toLoadError(err);
          return undefined;
        }
      };

      // o extrato vem paginado: sem seguir nextPage, as regras rodariam sobre a última semana
      const allTransactions = async () => {
        const pages: Record<string, unknown>[] = [];
        let page: number | undefined = 1;
        for (let n = 0; page && n < MAX_TX_PAGES; n++) {
          const res = await call('list_transactions', { limit: 100, page });
          // falha no meio: fica com o que veio; o nextPage pendente marca o histórico como incompleto
          if (!res) break;
          pages.push(res);
          page = typeof res.nextPage === 'number' ? res.nextPage : undefined;
        }
        // incomplete de qualquer página (linhas omitidas) e o nextPage da última (histórico mais antigo)
        return mergeTransactionPages(pages);
      };

      const [transactions, cards, mainAccount, portfolio, deposit] = await Promise.all([
        allTransactions(),
        call('list_cards'),
        call('get_main_account'),
        call('get_portfolio'),
        call('get_deposit_address'),
      ]);
      if (!current()) return;
      // nada veio: não é "conta vazia", é falha de carga (ex.: o CORS recusou todas as chamadas)
      if (!transactions && !cards && !mainAccount && !portfolio && !deposit) {
        const first = errors.list_transactions ?? Object.values(errors)[0];
        throw new AppError(first?.code ?? 'unknown', first?.status, first?.detail);
      }

      // o retrato do saldo é desta leitura, quando a conta ou a carteira vieram
      const snapshotAt = mainAccount || portfolio ? new Date().toISOString() : undefined;
      const next = datasetFromBundle({ transactions, cards, mainAccount, portfolio, deposit, snapshotAt }, referenceDate, { live: true });
      const hasAny = next.transactions.length > 0 || (next.account.totalBalance ?? next.account.availableBalance ?? 0) > 0;
      setToolErrors(errors);
      if (hasAny || !keepCurrent) {
        setRaw(next);
        setAiFileIssues(null);
      }
      setConnection({
        kind: 'connected',
        scopes: extractScopes(),
      });
      setSource('live');
      setLoadError(null);
    } catch (err) {
      // uma carga antiga que falhou depois de outra mais nova não muda a tela
      if (!current()) return;
      const error = toLoadError(err);
      if (err instanceof McpError && err.kind === 'unauthorized') {
        clearTokens();
        clientRef.current = null;
      }
      setConnection({ kind: 'error', error });
      setLoadError(error);
      if (!keepCurrent) setSource('demo');
    } finally {
      // só a carga atual apaga o indicador: a anterior não pode encerrar o spinner da que ainda está rodando
      if (current()) setLoading(false);
    }
  }, []);

  /** Mostra um conjunto de arquivos crus (fixtures ou importação). Devolve o erro, se não havia dado da conta. */
  const showFiles = useCallback((files: RawFile[], as: 'fixtures' | 'import'): { verdicts: FileVerdict[]; error?: LoadError } => {
    const { bundle, verdicts } = bundleFromFiles(files);
    if (!hasAccountData(bundle)) {
      const aiOnly = verdicts.some((v) => v.status === 'used');
      const code = as === 'fixtures' ? 'fixtures_missing' : aiOnly ? 'import_ai_only' : 'import_empty';
      return { verdicts, error: { code } };
    }
    const today = localToday(BROWSER_TZ);
    let next = datasetFromBundle(bundle, today);
    // o exemplo sintético tem datas fixas: o "hoje" dele é o dia da última linha, para prazos, alertas e e-mails da IA
    // continuarem coerentes daqui a meses
    if (as === 'fixtures' && DEV_FIXTURES === 'sample') {
      const last = next.transactions.reduce((m, t) => (t.date > m ? t.date : m), '');
      const day = last ? localToday(BROWSER_TZ, new Date(last)) : today;
      if (day < today) next = datasetFromBundle(bundle, day);
    }
    setRaw(next);
    setSource(as);
    setLoadError(null);
    const ai = verdicts.filter((v) => v.kind === 'evidence' || v.kind === 'research' || v.kind === 'audit');
    const dropped = ai.reduce((sum, v) => sum + (v.dropped ?? 0), 0);
    const invalidFiles = ai.filter((v) => v.status === 'invalid').map((v) => v.kind as AiFileIssues['invalidFiles'][number]);
    setAiFileIssues(dropped || invalidFiles.length ? { dropped, invalidFiles } : null);
    return { verdicts };
  }, []);

  // dev: lê os arquivos crus de fixtures/live/ (ou fixtures/sample/) pelo plugin do vite.config, no mesmo caminho da importação
  const loadFixtures = useCallback(async (set: string) => {
    if (!fetchDevFixtures) return;
    const gen = ++loadGen.current;
    lastAttempt.current = 'fixtures';
    setLoading(true);
    try {
      const files = await fetchDevFixtures(set);
      if (gen !== loadGen.current) return;
      const { error } = showFiles(files, 'fixtures');
      if (error) throw new AppError(error.code);
    } catch (err) {
      if (gen === loadGen.current) setLoadError(toLoadError(err));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [showFiles]);

  // arquivos importados antes, com "lembrar neste navegador"
  const loadRemembered = useCallback(async () => {
    const gen = ++loadGen.current;
    lastAttempt.current = 'remembered';
    setLoading(true);
    try {
      const files = await readLarge<RawFile[]>(IMPORT_KEY, validRawFiles);
      if (gen !== loadGen.current) return;
      if (!files?.length) throw new AppError('import_restore');
      const { verdicts, error } = showFiles(files, 'import');
      if (error) throw new AppError('import_restore');
      importedRef.current = files;
      setImportInfo({ files: verdicts.filter((v) => v.status === 'used').length, pulledOn: pulledOn(files, verdicts), remembered: true });
    } catch (err) {
      if (gen === loadGen.current) setLoadError(toLoadError(err));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [showFiles]);

  // a carga inicial roda uma vez: no StrictMode (dev) o efeito monta duas vezes, mas o estado e a ref ficam
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      if (import.meta.env.DEV && DEV_FIXTURES !== null) {
        await loadFixtures(DEV_FIXTURES);
        return;
      }
      if (isCallbackRoute()) {
        // só um login iniciado nesta aba é tratado: um /callback forjado (ex.: ?error_description=…) é ignorado
        const ours = callbackExchange !== null || hasPendingAuth();
        let failure: unknown = null;
        if (ours) {
          try {
            callbackExchange ??= handleCallback();
            await callbackExchange;
          } catch (err) {
            failure = err;
          }
        }
        // o código já foi trocado (ou recusado): sem sair de /callback, recarregar a página repetiria o erro
        if (isCallbackRoute()) window.history.replaceState({}, '', `${import.meta.env.BASE_URL}${window.location.hash}`);
        if (failure) {
          const error = toLoadError(failure);
          setConnection({ kind: 'error', error });
          setLoadError(error);
          setSource('demo');
          return;
        }
        if (ours) {
          await loadLive();
          return;
        }
      }
      if (getTokens()) {
        await loadLive();
        return;
      }
      if (rememberedImport()) await loadRemembered();
    })().finally(() => setBooting(false));
  }, [loadFixtures, loadLive, loadRemembered]);

  const connect = useCallback((scopes: string[]) => {
    setLoadError(null);
    setConnection({ kind: 'connecting' });
    startAuthorize(scopes).catch((err: unknown) => {
      const error = toLoadError(err);
      setConnection({ kind: 'error', error });
      setLoadError(error);
    });
  }, []);

  const backToDemo = useCallback(() => {
    // invalida cargas em voo: desconectar ou esquecer não pode ser desfeito por uma resposta que já estava a caminho
    loadGen.current += 1;
    importGeneration += 1;
    clientRef.current = null;
    setLoading(false);
    setConnection({ kind: 'demo' });
    setSource('demo');
    setToolErrors({});
    setToolsError(null);
    setLoadError(null);
    setAiFileIssues(null);
    setRaw(DEMO);
    setToolNames([]);
  }, []);

  const disconnect = useCallback(() => {
    clearTokens();
    backToDemo();
  }, [backToDemo]);

  const refresh = useCallback(() => {
    if (getTokens()) void loadLive(sourceRef.current === 'live');
  }, [loadLive]);

  const retry = useCallback(() => {
    const last = lastAttempt.current;
    if (last === 'fixtures' && DEV_FIXTURES !== null) void loadFixtures(DEV_FIXTURES);
    else if (last === 'remembered') void loadRemembered();
    else if (getTokens()) void loadLive(sourceRef.current === 'live');
    // sem sessão nem arquivos: não há o que repetir; a faixa leva à tela de Conexão
    else setLoadError(null);
  }, [loadFixtures, loadLive, loadRemembered]);

  const importFiles = useCallback(async (files: File[], remember: boolean): Promise<ImportReport> => {
    const totalBytes = files.reduce((n, f) => n + f.size, 0);
    if (files.length > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
      return { ok: false, verdicts: [], remembered: false, error: { code: 'import_too_large' } };
    }
    // cada importação invalida a anterior (e um "esquecer" invalida todas as que estão lendo arquivos)
    const gen = ++importGeneration;
    // cada escolha de arquivos é uma importação: conta e depósito somados depois do resto não confirmam o endereço
    const batch = Date.now();
    const incoming: RawFile[] = (await readFiles(files)).map((f) => ({ ...f, batch }));
    if (gen !== importGeneration) return { ok: false, verdicts: [], remembered: false, error: { code: 'unknown' } };
    // arquivos da IA sozinhos somam-se à importação atual; um tipo que veio de novo substitui o anterior
    let combined = incoming;
    if (sourceRef.current === 'import' && importedRef.current.length) {
      const kindOf = (f: RawFile) => bundleFromFiles([f]).verdicts[0]?.kind;
      const replaced = new Set(incoming.map(kindOf).filter(Boolean));
      combined = [...importedRef.current.filter((f) => !replaced.has(kindOf(f))), ...incoming];
    }
    const { verdicts, error } = showFiles(combined, 'import');
    // o relatório fala só dos arquivos que a pessoa acabou de escolher
    const names = new Set(incoming.map((f) => f.name));
    const report: ImportReport = { ok: !error, verdicts: verdicts.filter((v) => names.has(v.name)), remembered: false };
    if (error) return { ...report, error };

    importedRef.current = combined;
    setConnection((c) => (c.kind === 'error' ? { kind: 'demo' } : c));
    if (remember) {
      const saved = (await writeLarge(IMPORT_KEY, combined)) && writeStore(KEYS.importRemember, { at: new Date().toISOString(), files: combined.length });
      if (gen !== importGeneration) {
        // um "esquecer" (ou outra importação) aconteceu durante a gravação: não deixa o dado ressuscitar
        removeStore(KEYS.importRemember);
        await removeLarge(IMPORT_KEY);
        return { ok: false, verdicts: [], remembered: false, error: { code: 'unknown' } };
      }
      report.remembered = saved;
      if (!saved) report.rememberFailed = true;
    } else {
      if (gen !== importGeneration) return { ok: false, verdicts: [], remembered: false, error: { code: 'unknown' } };
      // "não lembrar" vale também para o que estava guardado de antes
      removeStore(KEYS.importRemember);
      await removeLarge(IMPORT_KEY);
    }
    setImportInfo({ files: verdicts.filter((v) => v.status === 'used').length, pulledOn: pulledOn(combined, verdicts), remembered: report.remembered });
    return report;
  }, [showFiles]);

  const forgetImport = useCallback(async () => {
    importGeneration += 1;
    removeStore(KEYS.importRemember);
    await removeLarge(IMPORT_KEY);
    importedRef.current = [];
    setImportInfo(null);
    if (sourceRef.current === 'import') backToDemo();
  }, [backToDemo]);

  const forgetAll = useCallback(async () => {
    importGeneration += 1;
    await forgetEverything();
    clearTokens();
    importedRef.current = [];
    setImportInfo(null);
    backToDemo();
  }, [backToDemo]);

  // "esquecer tudo" numa aba: as outras abas não podem continuar mostrando os dados que já saíram do disco
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== NAMESPACE + 'forget-at') return;
      clearTokens();
      importedRef.current = [];
      setImportInfo(null);
      backToDemo();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [backToDemo]);

  const isSample = source === 'demo' || (source === 'fixtures' && DEV_FIXTURES === 'sample');

  const value = useMemo<StoreValue>(
    () => ({
      source, isSample, connection, dataset, toolErrors, toolsError, loadError, loading, toolNames, importInfo, aiFileIssues,
      connect, disconnect, refresh, retry, importFiles, forgetImport, forgetAll,
    }),
    [source, isSample, connection, dataset, toolErrors, toolsError, loadError, loading, toolNames, importInfo, aiFileIssues, connect, disconnect, refresh, retry, importFiles, forgetImport, forgetAll],
  );

  return <StoreContext.Provider value={value}>{booting ? <BootScreen /> : children}</StoreContext.Provider>;
}

/**
 * Enquanto os dados reais carregam: nunca o demo no lugar deles. O esqueleto é o cromo do próprio app (da ui-shell),
 * nas mesmas medidas, com a forma da tela do endereço; na passagem para o app, só o miolo troca.
 */
function BootScreen() {
  const { locale } = useLocale();
  return <ShellSkeleton label={pick(locale, 'Loading your data…', 'Carregando seus dados…')} />;
}

function extractScopes(): string[] {
  const tokens = getTokens();
  if (!tokens?.scope) return [];
  return tokens.scope.split(/[\s,]+/).filter(Boolean);
}
