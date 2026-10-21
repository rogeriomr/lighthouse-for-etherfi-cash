// Os arquivos crus do `npm run pull` (respostas do conector), os 3 arquivos da IA e as regras locais de estabelecimento
// (merchant-rules.json), do jeito que estão no disco:
// reconhece cada um (pelo nome e, renomeado, pela forma), junta as páginas do extrato e monta o Dataset pelo
// mesmo assembleDataset do modo live. Usado pelo ?fixtures (dev), pela importação local (qualquer build) e pelos checks.
// Sem DOM e sem Node: roda nos dois.

import { assembleDataset } from './normalize.ts';
import { sanitizeMerchantRules } from './merchants.ts';
import type { MerchantRulesFile } from './merchants';
import type { Dataset, PtaxSeries } from './types';
import type { EvidenceFile, KnowledgeFile, RenewalAuditFile } from './subscriptionTypes';
import { validateAuditFile, validateEvidenceFile, validateKnowledgeFile, validatePtaxFile, type Validated } from './validate.ts';

type Dict = Record<string, unknown>;

export type RawKind =
  | 'transactions' | 'mainAccount' | 'cards' | 'portfolio' | 'deposit' | 'evidence' | 'research' | 'audit' | 'merchantRules' | 'ptax';

/** Um arquivo como chegou: nome, conteúdo já lido do JSON (ou `undefined` se não era JSON) e data de modificação. */
export interface RawFile {
  name: string;
  json: unknown;
  /** ms desde 1970 (File.lastModified ou mtime) */
  modified?: number;
  /** a importação em que o arquivo entrou (a hora dela): arquivos da conta de importações diferentes não confirmam o depósito */
  batch?: number;
}

export type FileStatus = 'used' | 'duplicate' | 'unknown' | 'invalid';

export interface FileVerdict {
  name: string;
  status: FileStatus;
  kind?: RawKind;
  /** página do extrato (list_transactions.pageN.json) */
  page?: number;
  /** entradas descartadas pela validação (arquivos da IA) */
  dropped?: number;
  /** reconhecido pelo conteúdo, não pelo nome: a tela diz o tipo, porque "categorias.json" pode ser um endereço de depósito */
  byShape?: boolean;
}

export interface RawBundle {
  transactions?: Dict;
  mainAccount?: Dict;
  cards?: Dict;
  portfolio?: Dict;
  deposit?: Dict;
  evidence?: EvidenceFile;
  research?: KnowledgeFile;
  audit?: RenewalAuditFile;
  /** como veio: o enrichDataset valida regra a regra (merchants.setLocalMerchantRules) */
  merchantRules?: MerchantRulesFile;
  /** Série da PTAX (ptax.json do npm run pull), já validada */
  ptax?: PtaxSeries;
  /** Quando o saldo foi lido (ISO): na importação, a modificação mais recente de get_main_account / get_portfolio */
  snapshotAt?: string;
  /**
   * O depósito ou a conta entraram numa importação e o resto da conta em outra: um arquivo somado depois (até com o
   * mesmo endereço e o mesmo nome de conta nos dois arquivos trocados) não confirma o endereço de depósito.
   */
  splitImport?: boolean;
}

const isDict = (v: unknown): v is Dict => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Nome que o npm run pull grava → tipo; aceita a cópia que o navegador renomeia ("... (1).json"). */
const BY_NAME: [RegExp, RawKind][] = [
  [/^list_transactions(?:\.page(\d+))?$/, 'transactions'],
  [/^get_main_account$/, 'mainAccount'],
  [/^list_cards$/, 'cards'],
  [/^get_portfolio$/, 'portfolio'],
  [/^get_deposit_address$/, 'deposit'],
  [/^subscription-evidence$/, 'evidence'],
  [/^subscription-research$/, 'research'],
  [/^renewal-audit$/, 'audit'],
  [/^merchant-rules$/, 'merchantRules'],
  [/^ptax$/, 'ptax'],
];

const baseName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? name).replace(/\.json$/i, '').replace(/\s*\(\d+\)$/, '').trim();

/** Pela forma, para arquivo renomeado. Na dúvida, não reconhece. */
function kindByShape(j: Dict): RawKind | undefined {
  // a PTAX do pull ({ kind: 'ptax' }) ou a resposta crua da API do BCB ({ value: [{ cotacaoVenda }] })
  if (j.kind === 'ptax' || (Array.isArray(j.value) && isDict(j.value[0]) && 'cotacaoVenda' in j.value[0])) return 'ptax';
  if (Array.isArray(j.transactions)) return 'transactions';
  if (Array.isArray(j.cards)) return 'cards';
  if (Array.isArray(j.holdings) || Array.isArray(j.groups)) return 'portfolio';
  if (Array.isArray(j.supportedAssets) || (Array.isArray(j.networks) && 'address' in j)) return 'deposit';
  if ('availableBalance' in j || 'creditLimit' in j || 'borrowed' in j) return 'mainAccount';
  if (Array.isArray(j.items)) {
    const first = j.items.find(isDict);
    if (!first) return undefined;
    if ('emailDate' in first || 'subject' in first || typeof j.source === 'string') return 'evidence';
    if ('autoRenew' in first || 'checked' in first || 'risk' in first || 'cancelDeadline' in first) return 'audit';
    if ('isSubscription' in first || 'cycles' in first) return 'research';
  }
  if (Array.isArray(j.rules) || (isDict(j.accents) && Object.keys(j).length <= 2)) return 'merchantRules';
  return undefined;
}

/** Reconhece um arquivo: o nome manda; o conteúdo precisa bater com ele. */
export function classifyFile(file: RawFile): { kind: RawKind; page?: number; byShape?: true } | undefined {
  if (!isDict(file.json)) return undefined;
  const base = baseName(file.name);
  for (const [re, kind] of BY_NAME) {
    const m = re.exec(base);
    if (!m) continue;
    // nome de extrato sem a lista de linhas não é extrato
    if (kind === 'transactions' && !Array.isArray(file.json.transactions)) return undefined;
    return m[1] ? { kind, page: Number(m[1]) } : { kind };
  }
  const kind = kindByShape(file.json);
  return kind ? { kind, byShape: true } : undefined;
}

/**
 * Junta as páginas do extrato, na ordem em que foram lidas (página 1 = mais recente):
 * - `incomplete`: OR de todas as páginas (o conector omitiu linhas em alguma) — os totais são parciais;
 * - `nextPage`: o da última página (há histórico mais antigo que não foi carregado).
 * Os dois ficam separados: um é "faltam linhas", o outro é "falta o começo".
 */
export function mergeTransactionPages(pages: Dict[], opts: { missingPages?: boolean } = {}): Dict | undefined {
  const last = pages.at(-1);
  if (!last) return undefined;
  const transactions = pages.flatMap((p) => (Array.isArray(p.transactions) ? p.transactions : []));
  const incomplete = Boolean(opts.missingPages) || pages.some((p) => p.incomplete === true);
  return { ...last, transactions, incomplete };
}

/** Lê o conjunto de arquivos: o que entra, o que sobrou repetido e o que não foi reconhecido. */
export function bundleFromFiles(files: RawFile[]): { bundle: RawBundle; verdicts: FileVerdict[] } {
  const verdicts: FileVerdict[] = [];
  const pages = new Map<number, { body: Dict; modified: number; batch?: number }>();
  const unnumbered: Dict[] = [];
  const unnumberedBatches: (number | undefined)[] = [];
  const singles = new Map<Exclude<RawKind, 'transactions'>, { file: RawFile; modified: number; verdict: FileVerdict }>();

  for (const file of files) {
    if (file.json === undefined) {
      verdicts.push({ name: file.name, status: 'invalid' });
      continue;
    }
    const c = classifyFile(file);
    if (!c) {
      verdicts.push({ name: file.name, status: 'unknown' });
      continue;
    }
    const modified = file.modified ?? 0;
    const verdict: FileVerdict = { name: file.name, status: 'used', kind: c.kind, ...(c.byShape ? { byShape: true } : {}) };
    verdicts.push(verdict);
    const body = file.json as Dict;
    if (c.kind === 'transactions') {
      if (c.page === undefined) {
        unnumbered.push(body);
        unnumberedBatches.push(file.batch);
        continue;
      }
      verdict.page = c.page;
      // a mesma página duas vezes (duas puxadas misturadas): fica a mais nova
      const prev = pages.get(c.page);
      if (prev && prev.modified >= modified) {
        verdict.status = 'duplicate';
        continue;
      }
      if (prev) {
        const old = verdicts.find((v) => v !== verdict && v.kind === 'transactions' && v.page === c.page && v.status === 'used');
        if (old) old.status = 'duplicate';
      }
      pages.set(c.page, { body, modified, batch: file.batch });
      continue;
    }
    const prev = singles.get(c.kind);
    if (prev && prev.modified >= modified) {
      verdict.status = 'duplicate';
      continue;
    }
    if (prev) prev.verdict.status = 'duplicate';
    singles.set(c.kind, { file, modified, verdict });
  }

  const bundle: RawBundle = {};
  const numbers = [...pages.keys()].sort((a, b) => a - b);
  // falta uma página no meio (ou a 1ª, a mais recente): linhas faltando, não histórico mais antigo
  const missingPages = numbers.length > 0 && numbers.some((n, i) => n !== i + 1);
  const ordered = [...numbers.map((n) => pages.get(n)!.body), ...unnumbered];
  bundle.transactions = mergeTransactionPages(ordered, { missingPages });

  for (const [kind, { file, verdict }] of singles) {
    const json = file.json;
    // arquivos da IA, campo a campo pelo validate.ts: o item sem o essencial sai e entra na contagem
    const take = <T>(v: Validated<T>): T | undefined => {
      if (!v.value) verdict.status = 'invalid';
      else if (v.dropped) verdict.dropped = v.dropped;
      return v.value;
    };
    if (kind === 'evidence') bundle.evidence = take(validateEvidenceFile(json));
    else if (kind === 'research') bundle.research = take(validateKnowledgeFile(json));
    else if (kind === 'audit') bundle.audit = take(validateAuditFile(json));
    else if (kind === 'merchantRules') bundle.merchantRules = take(sanitizeMerchantRules(json));
    else if (kind === 'ptax') bundle.ptax = take(validatePtaxFile(json));
    else bundle[kind] = json as Dict;
  }
  // o retrato do saldo é o dos arquivos da conta e da carteira, não o do extrato (que pode ser de outra puxada)
  const snapshot = Math.max(0, ...(['mainAccount', 'portfolio'] as const).map((k) => singles.get(k)?.modified ?? 0));
  if (snapshot > 0) bundle.snapshotAt = new Date(snapshot).toISOString();
  // de que importações vieram os arquivos da conta em uso (sem `batch`: ?fixtures, checks ou importação antiga)
  const accountBatches = new Set([
    ...[...pages.values()].map((p) => p.batch), ...unnumberedBatches,
    ...(['mainAccount', 'cards', 'portfolio', 'deposit'] as const).map((k) => singles.get(k)?.file.batch),
  ].filter((b): b is number => b !== undefined));
  if (singles.has('deposit') && accountBatches.size > 1) bundle.splitImport = true;
  return { bundle, verdicts };
}

/** Há dado da conta para mostrar (não só os arquivos da IA). */
export const hasAccountData = (b: RawBundle) => Boolean(b.transactions || b.mainAccount || b.cards || b.portfolio || b.deposit);

/** Monta o Dataset cru (antes do enrichDataset), com os arquivos da IA em `subscriptionSources` e as regras locais. */
export function datasetFromBundle(bundle: RawBundle, referenceDate: string, opts: { live?: boolean } = {}): Dataset {
  const { dataset } = assembleDataset({
    referenceDate,
    transactions: bundle.transactions,
    cards: bundle.cards,
    mainAccount: bundle.mainAccount,
    portfolio: bundle.portfolio,
    deposit: bundle.deposit,
    snapshotAt: bundle.snapshotAt,
    splitImport: bundle.splitImport,
    live: opts.live === true,
  });
  const { evidence, research, audit, merchantRules, ptax } = bundle;
  return {
    ...dataset,
    ...(evidence || research || audit ? { subscriptionSources: { evidence, research, audit } } : null),
    ...(merchantRules ? { merchantRules } : null),
    ...(ptax ? { ptax } : null),
  };
}
