import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent } from 'react';
import { Switch } from '@ark-ui/react/switch';
import { connectorAcceptsOrigin, ETHERFI_CASH_URL, ETHERFI_CONNECTOR_URL, MCP_URL, PHONE_TRANSFER, PRIVACY_NOTE, PRODUCT, PRODUCT_TAGLINE, SCOPES } from '../lib/config';
import { errorText, type LoadError } from '../lib/errors';
import { dateFull } from '../lib/format';
import { localized, pick, type Locale } from '../lib/locale';
import type { FileStatus, FileVerdict, RawKind } from '../lib/rawFiles';
import { foreignServiceWorker } from '../lib/storage';
import { useStore, type ImportReport } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { Badge, Button, Empty, ExternalLink, Panel, PanelTitle, Spinner } from '../components/ui';
import { Code } from '../components/code';
import { ChevronRight, CircleAlert, CircleCheck, FileJson, HardDrive, KeyRound, Laptop, LogOut, RefreshCw, ShieldCheck, Trash2, TriangleAlert, Upload } from 'lucide-react';

/** Rótulo curto do motivo, no selo de cada ferramenta. */
function errBadge(error: LoadError, tr: ReturnType<typeof useTr>): string {
  if (error.code === 'unauthorized' || error.status === 401) return tr('reconnect', 'reconectar');
  if (error.status === 403) return tr('missing scope', 'escopo ausente');
  return tr('error', 'erro');
}

/** O motivo em texto fixo + o código e o status, para quem for depurar. */
function ErrorLine({ error }: { error: LoadError }) {
  const { locale } = useLocale();
  return (
    <>
      {errorText(error, locale)}{' '}
      <span className="font-mono text-xs break-words text-faint">
        ({error.code}{error.status ? ` ${error.status}` : ''}{error.detail ? ` · ${error.detail}` : ''})
      </span>
    </>
  );
}

/** "Settings → AI Connections" é o caminho de um menu do app: só pode partir depois da seta. */
const AI_CONNECTIONS = (
  <>
    <span className="whitespace-nowrap">Settings →</span> <span className="whitespace-nowrap">AI Connections</span>
  </>
);

export function ConnectView() {
  const { source, connection, loadError, importInfo } = useStore();
  const tr = useTr();
  const connected = connection.kind === 'connected';
  // o CORS do conector recusa qualquer site próprio: fora das origens aceitas, o caminho real é puxar e importar
  const direct = connectorAcceptsOrigin();
  const usingFiles = source === 'import' || source === 'fixtures';
  // o formulário da conexão direta só existe com o "Tentar conectar direto" aberto: fechado, o Chrome ainda calcula a
  // caixa dos interruptores escondidos por cima do que vem depois
  const [directOpen, setDirectOpen] = useState(false);

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted">
        {tr(
          `${PRODUCT} only reads your ether.fi Cash account, through ether.fi’s official AI connector. You approve it on ether.fi’s own screen and can revoke it anytime in the ether.fi app, under `,
          `O ${PRODUCT} só lê a sua conta ether.fi Cash, pelo conector de IA oficial da ether.fi. Você aprova na tela da própria ether.fi e pode revogar quando quiser no app da ether.fi, em `,
        )}
        {AI_CONNECTIONS}.
      </p>

      {loadError ? (
        <div role="alert" className="panel border-bad/40 p-4">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-bad">{tr('Couldn’t load your data', 'Não deu para carregar seus dados')}</div>
              <div className="mt-1 text-muted"><ErrorLine error={loadError} /></div>
            </div>
          </div>
        </div>
      ) : null}

      {usingFiles ? <LocalFilesStatus /> : null}

      {connected ? (
        <ConnectedPanel />
      ) : direct ? (
        <ConnectPanel />
      ) : (
        <>
          <HowToUse imported={source === 'import' && importInfo !== null} />
          {/* o botão continua lá, mas como segunda opção, já dizendo que deve falhar */}
          <details className="group panel p-5" onToggle={(e) => setDirectOpen(e.currentTarget.open)}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
              {tr('Try connecting directly anyway', 'Tentar conectar direto mesmo assim')}
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {tr(
                'ether.fi’s connector only accepts browser calls from a few websites (CORS), and a site of your own, localhost included, isn’t one of them. From here the connection will most likely fail; the files path above always works.',
                'O conector da ether.fi só aceita chamadas de navegador vindas de alguns sites (CORS), e um site próprio, localhost incluído, não está entre eles. Daqui, a conexão deve falhar; o caminho dos arquivos, acima, sempre funciona.',
              )}
            </p>
            {directOpen ? <div className="mt-4"><ConnectForm secondary /></div> : null}
          </details>
        </>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <BrowserDataPanel />
        <div className="space-y-5">
          <PrivacyPanel />
          <AboutPanel />
        </div>
      </div>

      <TechnicalDetails />

      {!connected && source === 'demo' ? (
        <Panel>
          <PanelTitle>{tr('How demo mode works', 'Como o modo demonstração funciona')}</PanelTitle>
          <div className="text-sm leading-relaxed text-muted">
            {tr(
              'Without your files or a connection, Lighthouse runs on about six months of sample data built into the source code, with the dates moved so they end today. It has trips to eight cities, subscriptions, duplicates and unusual charges on purpose, so you can see each explanation in action. No data leaves your browser.',
              'Sem os seus arquivos nem conexão, o Lighthouse roda com cerca de seis meses de dados fictícios embutidos no código-fonte, com as datas deslocadas para terminar hoje. Eles têm viagens a oito cidades, assinaturas, duplicatas e cobranças atípicas de propósito, para você ver cada explicação em ação. Nenhum dado sai do seu navegador.',
            )}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

// toque (celular ou tablet): o npm run pull não roda aqui, então a importação vem primeiro
const COARSE = '(pointer: coarse)';
const subscribeCoarse = (onChange: () => void) => {
  const m = window.matchMedia(COARSE);
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
};
const useCoarsePointer = () => useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches);

/** Marcador do passo: o número no computador; no toque, um ícone (a ordem mostrada não é a ordem de fazer). */
function StepMark({ n, icon: Icon }: { n: number; icon: typeof Upload | null }) {
  return (
    <span aria-hidden className="tnum flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
      {Icon ? <Icon className="size-3.5" /> : n}
    </span>
  );
}

/**
 * Fora das origens aceitas: o caminho que funciona, em 2 passos, com a importação no passo 2. No celular, a
 * importação vem primeiro e uma linha diz que puxar os dados precisa de um computador.
 */
function HowToUse({ imported }: { imported: boolean }) {
  const tr = useTr();
  const touch = useCoarsePointer();

  const pull = (
    <li key="pull" className="flex gap-3">
      <StepMark n={1} icon={touch ? Laptop : null} />
      <div className="min-w-0 space-y-1.5 text-muted">
        <p className="font-medium text-ink">
          {touch ? tr('On a computer: pull your data', 'No computador: puxe seus dados') : tr('Pull your data on your computer', 'Puxe seus dados no seu computador')}
        </p>
        <p>
          {tr('In a copy of the Lighthouse project (Node 22.13+), run ', 'Numa cópia do projeto do Lighthouse (Node 22.13+), rode ')}
          <Code>npm run pull</Code>
          {tr(
            '. It opens ether.fi’s approval page and saves your account as .json files in ',
            '. Ele abre a tela de aprovação da ether.fi e salva a sua conta em arquivos .json na pasta ',
          )}
          <Code>~/lighthouse-data</Code>
          {tr(', only on your computer.', ', só no seu computador.')}
        </p>
        <p className="text-xs text-faint">
          {tr(
            'It runs outside the browser, so the connector’s CORS limit doesn’t apply, and the access token never goes to disk. A different folder: ',
            'Ele roda fora do navegador, então o limite de CORS do conector não vale, e o token de acesso nunca vai para o disco. Outra pasta: ',
          )}
          <Code>LIGHTHOUSE_DATA_DIR</Code>
          {tr(' (the old ', ' (a antiga ')}
          <Code>fixtures/live/</Code>
          {tr(' is still read).', ' continua sendo lida).')}
        </p>
      </div>
    </li>
  );

  const importStep = (
    <li key="import" className="flex gap-3">
      <StepMark n={2} icon={touch ? Upload : null} />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1.5 text-muted">
          <p className="font-medium text-ink">
            {imported
              ? tr('Import updated files', 'Importe arquivos atualizados')
              : touch ? tr('Import the .json files', 'Importe os arquivos .json') : tr('Import the files here', 'Importe os arquivos aqui')}
          </p>
          <p>
            {touch
              ? tr('Pick all of them at once.', 'Escolha todos de uma vez.')
              : tr('Pick all the .json files from that folder at once.', 'Escolha todos os arquivos .json da pasta de uma vez.')}
          </p>
        </div>
        <ImportForm touch={touch} />
        <details className="group text-xs text-muted">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
            {tr('Which files?', 'Quais arquivos?')}
          </summary>
          <ul className="mt-1 list-disc space-y-1.5 pl-5 leading-relaxed">
            <li>
              {tr('The statement pages: ', 'As páginas do extrato: ')}<Code>list_transactions.page1.json</Code>, <Code>page2</Code>…
              {tr(' (all of them: a missing page means missing purchases).', ' (todas: página faltando é compra faltando).')}
            </li>
            <li>
              <Code>get_main_account.json</Code>, <Code>list_cards.json</Code>, <Code>get_portfolio.json</Code>, <Code>get_deposit_address.json</Code>.
            </li>
            <li>
              {tr('Optional, from your AI: ', 'Opcionais, da sua IA: ')}
              <Code>subscription-evidence.json</Code>, <Code>subscription-research.json</Code>, <Code>renewal-audit.json</Code>
              {tr('. They can also be added later, on their own.', '. Também podem entrar depois, sozinhos.')}
            </li>
          </ul>
        </details>
        {import.meta.env.DEV && !touch ? (
          <p className="text-xs text-faint">
            {tr('Developing on this computer? ', 'Desenvolvendo neste computador? ')}
            <a href={`${import.meta.env.BASE_URL}?fixtures`} className="inline-block py-1 text-ink underline underline-offset-2">
              {tr('Open with ', 'Abrir com ')}<span className="whitespace-nowrap">?fixtures</span>
            </a>
            {tr(' reads the folder directly, or ', ' lê a pasta direto, ou ')}
            <a href={`${import.meta.env.BASE_URL}?fixtures=sample`} className="inline-block py-1 whitespace-nowrap text-ink underline underline-offset-2">?fixtures=sample</a>
            {tr(' the synthetic sample files.', ' os arquivos sintéticos de exemplo.')}
          </p>
        ) : null}
      </div>
    </li>
  );

  return (
    <Panel className="border-accent/30">
      <PanelTitle>{tr('Use it with your account', 'Como usar com a sua conta')}</PanelTitle>
      {touch ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2.5 text-sm text-muted">
          <Laptop aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          <span>
            {tr('Pulling your data needs a computer (step below). ', 'Puxar os dados precisa de um computador (passo abaixo). ')}
            {tr(PHONE_TRANSFER.en, PHONE_TRANSFER.pt)}
            {tr(' Then pick them here, from your Files app.', ' Depois, escolha-os aqui pelo app Arquivos.')}
          </span>
        </p>
      ) : null}
      <ol className="space-y-5 text-sm">{touch ? [importStep, pull] : [pull, importStep]}</ol>
      {/* o tutorial inteiro (caminhos, Claude Code, celular, segurança) fica na página "Comece aqui" */}
      <p className="mt-4 border-t border-line pt-3">
        <a href="#/start" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent underline-offset-2 hover:underline pointer-fine:min-h-8">
          {tr('Full step-by-step guide', 'Passo a passo completo')} <span aria-hidden>→</span>
        </a>
      </p>
    </Panel>
  );
}

/** Título do painel "Seus arquivos importados": o foco vai para ele depois de uma importação que deu certo. */
const IMPORTED_TITLE_ID = 'imported-files-title';

const STATUS_LABEL: Record<FileStatus, [en: string, pt: string]> = {
  used: ['read', 'lido'],
  duplicate: ['repeated, ignored', 'repetido, ignorado'],
  unknown: ['not recognized', 'não reconhecido'],
  invalid: ['invalid', 'inválido'],
};

/** O que cada arquivo virou: um "categorias.json" reconhecido pelo conteúdo pode ser o endereço de depósito */
const KIND_LABEL: Record<RawKind, [en: string, pt: string]> = {
  transactions: ['statement', 'extrato'],
  mainAccount: ['account balances', 'saldos da conta'],
  cards: ['cards', 'cartões'],
  portfolio: ['holdings', 'ativos'],
  deposit: ['deposit address', 'endereço de depósito'],
  evidence: ['email evidence (AI)', 'evidências de email (IA)'],
  research: ['subscription research (AI)', 'pesquisa de assinaturas (IA)'],
  audit: ['renewal audit (AI)', 'auditoria de renovação (IA)'],
  merchantRules: ['merchant rules', 'regras de estabelecimento'],
  ptax: ['PTAX rates', 'cotações PTAX'],
};
/** Tipos que mudam a conta na tela: reconhecidos só pelo conteúdo, ganham aviso e abrem a lista */
const ACCOUNT_KINDS = new Set<RawKind>(['transactions', 'mainAccount', 'cards', 'portfolio', 'deposit']);
const renamedAccountFile = (v: FileVerdict) => Boolean(v.byShape && v.kind && ACCOUNT_KINDS.has(v.kind));

/** Seletor de arquivos + arrastar e soltar. Os dados ficam só na memória, a não ser que a pessoa peça para lembrar. */
function ImportForm({ touch }: { touch: boolean }) {
  const { importFiles, loading, importInfo } = useStore();
  const tr = useTr();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // já existe uma cópia lembrada neste navegador: o padrão não pode apagá-la sem a pessoa ver
  const [remember, setRemember] = useState(importInfo?.remembered ?? false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const { locale } = useLocale();

  // deu certo: o foco vai ao painel dos arquivos importados (que acabou de aparecer acima), em vez de cair no <body>
  useEffect(() => {
    if (report?.ok) document.getElementById(IMPORTED_TITLE_ID)?.focus();
  }, [report]);

  const run = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    // o campo não é desativado durante a leitura (perderia o foco): só ignora uma segunda escolha
    if (!files.length || busy || loading) return;
    setBusy(true);
    try {
      setReport(await importFiles(files, remember));
    } finally {
      setBusy(false);
      // o mesmo arquivo escolhido de novo precisa disparar o change
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    void run(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <label
        htmlFor={inputId}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={onDrop}
        className={
          'flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40 ' +
          (dragging ? 'border-accent bg-accent/10' : 'border-line2 bg-panel2/30 hover:border-accent/60 hover:bg-panel2/60')
        }
      >
        {busy ? <Spinner /> : <Upload aria-hidden className="size-5 text-accent" />}
        <span className="text-sm font-medium text-ink">
          {busy ? tr('Reading the files…', 'Lendo os arquivos…') : tr('Choose the .json files', 'Escolher os arquivos .json')}
        </span>
        <span className="text-xs text-muted">
          {touch ? tr('several at once', 'vários de uma vez') : tr('or drop them here · several at once', 'ou solte aqui · vários de uma vez')}
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept=".json,application/json"
          aria-busy={busy || undefined}
          onChange={(e) => void run(e.currentTarget.files)}
          className="sr-only"
        />
      </label>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-1 py-2 text-sm">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.currentTarget.checked)}
          className="size-6 shrink-0 cursor-pointer accent-accent"
        />
        <span className="min-w-0">
          <span className="block text-ink">{tr('Remember in this browser', 'Lembrar neste navegador')}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {tr(
              'Off: the data stays only in memory and is gone when you close the tab. On: it’s kept in this browser (IndexedDB) until you forget it here.',
              'Desligado: os dados ficam só na memória e somem ao fechar a aba. Ligado: ficam guardados neste navegador (IndexedDB) até você esquecer aqui.',
            )}
          </span>
        </span>
      </label>

      {report ? <ImportResult report={report} /> : null}
      {/* região viva que já existe antes do resultado: o leitor de tela anuncia "N arquivos lidos" ou o motivo do erro */}
      <p role="status" className="sr-only">{report ? announcement(report, locale) : ''}</p>
    </div>
  );
}

/** O resultado numa frase, para o leitor de tela. */
function announcement(report: ImportReport, locale: Locale): string {
  if (!report.ok) return report.error ? errorText(report.error, locale) : '';
  const used = report.verdicts.filter((v) => v.status === 'used').length;
  const skipped = report.verdicts.length - used;
  return pick(
    locale,
    `Imported: ${used} ${used === 1 ? 'file' : 'files'} read${skipped ? `, ${skipped} ignored` : ''}.${report.remembered ? ' Remembered in this browser.' : ''}`,
    `Importado: ${used} ${used === 1 ? 'arquivo lido' : 'arquivos lidos'}${skipped ? `, ${skipped} ${skipped === 1 ? 'ignorado' : 'ignorados'}` : ''}.${report.remembered ? ' Lembrado neste navegador.' : ''}`,
  );
}

function ImportResult({ report }: { report: ImportReport }) {
  const { locale } = useLocale();
  const tr = useTr();
  const used = report.verdicts.filter((v) => v.status === 'used').length;
  const skipped = report.verdicts.length - used;
  const dropped = report.verdicts.reduce((s, v) => s + (v.dropped ?? 0), 0);
  return (
    <div className={'rounded-lg border px-3 py-3 text-sm ' + (report.ok ? 'border-good/30 bg-good/5' : 'border-bad/30 bg-bad/5')}>
      <div className="flex items-start gap-2.5">
        {report.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />}
        <div className="min-w-0 space-y-1">
          {report.ok ? (
            <>
              <p className="font-medium text-ink">
                {tr(`Loaded: ${used} ${used === 1 ? 'file' : 'files'} read`, `Carregado: ${used} ${used === 1 ? 'arquivo lido' : 'arquivos lidos'}`)}
                {skipped ? tr(`, ${skipped} ignored`, `, ${skipped} ${skipped === 1 ? 'ignorado' : 'ignorados'}`) : ''}.
              </p>
              <p className="text-xs text-muted">
                {report.remembered
                  ? tr('Remembered in this browser.', 'Lembrado neste navegador.')
                  : report.rememberFailed
                    ? tr('This browser refused to save them: they stay only until you close the tab.', 'Este navegador recusou guardar: ficam só até fechar a aba.')
                    : tr('Only in memory: gone when you close the tab.', 'Só na memória: somem ao fechar a aba.')}
                {dropped
                  ? tr(` ${dropped} AI ${dropped === 1 ? 'item was' : 'items were'} skipped (missing fields).`, ` ${dropped} ${dropped === 1 ? 'item da IA foi ignorado' : 'itens da IA foram ignorados'} (campos faltando).`)
                  : ''}
              </p>
              <p><a href="#/portfolio" className="inline-flex min-h-11 items-center text-xs font-medium text-accent underline underline-offset-2">{tr('See the overview', 'Ver o resumo')}</a></p>
            </>
          ) : (
            <p className="text-ink">{report.error ? errorText(report.error, locale) : null}</p>
          )}
          {report.verdicts.length ? <VerdictList verdicts={report.verdicts} open={!report.ok || skipped > 0 || report.verdicts.some(renamedAccountFile)} /> : null}
        </div>
      </div>
    </div>
  );
}

function VerdictList({ verdicts, open }: { verdicts: FileVerdict[]; open: boolean }) {
  const tr = useTr();
  return (
    <details open={open || undefined} className="group pt-1">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs text-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {tr('File by file', 'Arquivo por arquivo')}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {verdicts.map((v, i) => (
          <li key={`${v.name}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <FileJson aria-hidden className="size-3.5 shrink-0 text-faint" />
            <span className="min-w-0 font-mono break-all text-ink">{v.name}</span>
            <Badge tone={v.status === 'used' ? 'good' : v.status === 'invalid' ? 'bad' : 'neutral'}>{tr(...STATUS_LABEL[v.status])}</Badge>
            {v.kind ? (
              <span className={renamedAccountFile(v) ? 'text-warn' : 'text-faint'}>
                {tr(...KIND_LABEL[v.kind])}
                {v.page ? tr(` · page ${v.page}`, ` · página ${v.page}`) : ''}
                {v.byShape ? tr(' · by its content, not its name: check where it came from', ' · pelo conteúdo, não pelo nome: confira de onde veio') : ''}
              </span>
            ) : null}
            {v.dropped ? <span className="text-faint">{tr(`${v.dropped} skipped`, `${v.dropped} ignorados`)}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** O que está na tela vem de arquivos locais: quantos, de quando, se fica lembrado; e o botão de esquecer. */
function LocalFilesStatus() {
  const { source, importInfo, forgetImport, isSample } = useStore();
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  if (source === 'fixtures') {
    return (
      <Panel>
        <PanelTitle hint={isSample ? tr('synthetic sample', 'exemplo sintético') : tr('dev only', 'só no dev')}>
          <span className="inline-flex items-center gap-2"><HardDrive className="size-3.5" /> {tr('Local files', 'Arquivos locais')}</span>
        </PanelTitle>
        <p className="text-sm text-muted">
          {isSample
            ? tr('Showing the synthetic files in ', 'Mostrando os arquivos sintéticos de ')
            : tr('Showing your files from ', 'Mostrando os seus arquivos de ')}
          <Code>{isSample ? 'fixtures/sample/' : 'fixtures/live/'}</Code>
          {tr(', read by the development server. The files aren’t stored in this browser; only your answers are.', ', lidos pelo servidor de desenvolvimento. Os arquivos não ficam guardados neste navegador; só as suas respostas.')}
        </p>
      </Panel>
    );
  }
  if (!importInfo) return null;
  const forget = async () => {
    setBusy(true);
    try { await forgetImport(); } finally { setBusy(false); }
  };
  return (
    <Panel>
      <PanelTitle id={IMPORTED_TITLE_ID} hint={importInfo.remembered ? tr('remembered here', 'lembrado aqui') : tr('in memory only', 'só na memória')}>
        <span className="inline-flex items-center gap-2"><HardDrive className="size-3.5" /> {tr('Your imported files', 'Seus arquivos importados')}</span>
      </PanelTitle>
      <div className="space-y-3 text-sm text-muted">
        <p>
          {tr(`Showing ${importInfo.files} files from npm run pull`, `Mostrando ${importInfo.files} arquivos do npm run pull`)}
          {importInfo.pulledOn ? tr(`, saved on ${dateFull(importInfo.pulledOn)}`, `, salvos em ${dateFull(importInfo.pulledOn)}`) : ''}.{' '}
          {importInfo.remembered
            ? tr('They’re kept in this browser until you forget them.', 'Ficam guardados neste navegador até você esquecer.')
            : tr('They’re gone when you close the tab.', 'Somem ao fechar a aba.')}
        </p>
        <Button variant="outline" onClick={() => void forget()} disabled={busy} className="min-h-11">
          {busy ? <Spinner /> : <Trash2 className="size-4" />} {tr('Forget these files', 'Esquecer estes arquivos')}
        </Button>
      </div>
    </Panel>
  );
}

/** Conectado: estado, recarregar e desconectar (que só apaga o local; revogar é no app da ether.fi). */
function ConnectedPanel() {
  const { connection, refresh, disconnect, loading } = useStore();
  const tr = useTr();
  const scopes = connection.kind === 'connected' ? connection.scopes : [];
  return (
    <Panel>
      <PanelTitle hint={tr('connected', 'conectado')}>
        <span className="inline-flex items-center gap-2"><KeyRound className="size-3.5" /> {tr('Status', 'Estado')}</span>
      </PanelTitle>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="good">{tr('connected to ether.fi', 'conectado à ether.fi')}</Badge>
          <span className="text-xs text-faint">{tr('access valid for ~1h, renewed automatically', 'acesso válido por ~1h, renovado automaticamente')}</span>
        </div>
        {scopes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((s) => <Badge key={s}>{s}</Badge>)}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={refresh} disabled={loading} className="min-h-11">
            {loading ? <Spinner /> : <RefreshCw className="size-4" />} {tr('Reload data', 'Recarregar dados')}
          </Button>
          <Button variant="danger" onClick={disconnect} className="min-h-11">
            <LogOut className="size-4" /> {tr('Disconnect', 'Desconectar')}
          </Button>
        </div>
        <p className="text-xs text-faint">
          {tr(
            'Disconnecting only erases the sign-in kept in this browser: ether.fi has no way for a site to revoke access. To revoke it for good, open the ether.fi app, Settings → AI Connections. To also erase your answers here, use “Forget everything in this browser” below.',
            'Desconectar só apaga o login guardado neste navegador: a ether.fi não oferece um jeito de um site revogar o acesso. Para revogar de vez, abra o app da ether.fi, em Settings → AI Connections. Para apagar também as suas respostas daqui, use “Esquecer tudo neste navegador”, abaixo.',
          )}
        </p>
      </div>
    </Panel>
  );
}

/** Numa origem aceita pelo conector: a conexão direta é o caminho principal. */
function ConnectPanel() {
  const { source } = useStore();
  const tr = useTr();
  return (
    <Panel>
      <PanelTitle hint={source === 'demo' ? tr('not connected', 'não conectado') : undefined}>
        <span className="inline-flex items-center gap-2"><KeyRound className="size-3.5" /> {tr('Connect', 'Conectar')}</span>
      </PanelTitle>
      <ConnectForm />
    </Panel>
  );
}

function ConnectForm({ secondary }: { secondary?: boolean }) {
  const { connection, connect } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  const [scopes, setScopes] = useState<string[]>(SCOPES.map((s) => s.id));
  const toggle = (id: string, checked: boolean) => {
    setScopes((s) => (checked ? [...new Set([...s, id])] : s.filter((x) => x !== id)));
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{tr('What Lighthouse will ask to read:', 'O que o Lighthouse vai pedir para ler:')}</p>
      <div className="space-y-3">
        {SCOPES.map((s) => {
          const on = scopes.includes(s.id);
          return (
            // a linha inteira é o rótulo do interruptor: área de toque grande e nome acessível
            <Switch.Root
              key={s.id}
              checked={on}
              onCheckedChange={(d) => toggle(s.id, d.checked)}
              className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-line bg-panel2/40 px-4 py-3 transition-colors hover:border-line2"
            >
              <span className="min-w-0">
                <Switch.Label className="block text-sm font-medium">{localized(s.label, locale)}</Switch.Label>
                <span className="mt-0.5 block text-xs text-muted">{localized(s.description, locale)}</span>
                <span className="mt-1 block font-mono text-xs text-faint">{s.id}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 pt-0.5">
                <span aria-hidden className={on ? 'text-xs text-ink' : 'text-xs text-faint'}>
                  {on ? tr('on', 'ligado') : tr('off', 'desligado')}
                </span>
                <Switch.Control className="inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line2 bg-panel transition-colors data-[state=checked]:border-accent/60 data-[state=checked]:bg-accent/25">
                  <Switch.Thumb className="block size-3.5 translate-x-[2px] rounded-full bg-muted transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent" />
                </Switch.Control>
              </span>
              <Switch.HiddenInput />
            </Switch.Root>
          );
        })}
      </div>
      <Button
        variant={secondary ? 'outline' : 'primary'}
        onClick={() => connect(scopes)}
        disabled={scopes.length === 0 || connection.kind === 'connecting'}
        className="min-h-11"
      >
        {connection.kind === 'connecting' ? <Spinner /> : null}
        {secondary ? tr('Try connecting anyway', 'Tentar conectar mesmo assim') : tr('Connect to ether.fi', 'Conectar na ether.fi')}
      </Button>
      {scopes.length === 0 ? (
        <p className="text-xs text-muted">{tr('Turn on at least one item to connect.', 'Ligue pelo menos um item para conectar.')}</p>
      ) : null}
      <p className="text-xs text-faint">
        {tr(
          'You’ll be taken to the ether.fi consent screen: you pick the account, pick the scopes and approve there. Consent never depends on what Lighthouse says about itself.',
          'Você será levado à tela de consentimento da ether.fi: escolhe a conta, escolhe os escopos e aprova lá. O consentimento nunca depende do que o Lighthouse declara sobre si mesmo.',
        )}
      </p>
    </div>
  );
}

/** O que fica neste navegador e o "esquecer tudo", com confirmação em dois passos. */
function BrowserDataPanel() {
  const { forgetAll } = useStore();
  const tr = useTr();
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy' | 'done'>('idle');
  const forget = async () => {
    setStep('busy');
    try {
      await forgetAll();
    } finally {
      setStep('done');
    }
  };
  return (
    <Panel>
      <PanelTitle>{tr('Data in this browser', 'Dados neste navegador')}</PanelTitle>
      <div className="space-y-3 text-sm text-muted">
        <p>
          {tr(
            'Lighthouse has no server. What it keeps stays only in this browser: your answers (subscriptions, renewals, alerts already checked), the language, the sign-in to ether.fi when connected, with AI Insights on a summary of the balance to compare with the next load and, if you asked, the imported files.',
            'O Lighthouse não tem servidor. O que ele guarda fica só neste navegador: as suas respostas (assinaturas, renovações, alertas já conferidos), o idioma, o login na ether.fi quando conectado, com o AI Insights ligado um resumo do saldo para comparar com a próxima carga e, se você pediu, os arquivos importados.',
          )}
        </p>
        {/* o painel não usa service worker: um controlando a página veio de outro projeto na mesma origem (localhost:5173) */}
        {foreignServiceWorker() && step !== 'done' ? (
          <p className="flex items-start gap-2 text-warn">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              {tr(
                'A service worker from another site or project is controlling this page. Lighthouse doesn’t use one, and it can see what this page loads: “Forget everything in this browser” removes it.',
                'Um service worker de outro site ou projeto está controlando esta página. O Lighthouse não usa nenhum, e ele enxerga o que esta página carrega: “Esquecer tudo neste navegador” o remove.',
              )}
            </span>
          </p>
        ) : null}
        {step === 'confirm' ? (
          <div className="space-y-3 rounded-lg border border-bad/30 bg-bad/5 p-3">
            <p className="text-ink">
              {tr(
                'Erase your answers, the sign-in and the imported files from this browser? Only the language choice stays. This can’t be undone, and it doesn’t revoke access at ether.fi: do that in the ether.fi app, Settings → AI Connections.',
                'Apagar as suas respostas, o login e os arquivos importados deste navegador? Só a escolha de idioma fica. Não dá para desfazer, e isso não revoga o acesso na ether.fi: faça isso no app da ether.fi, em Settings → AI Connections.',
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => void forget()} className="min-h-11">
                <Trash2 className="size-4" /> {tr('Yes, forget everything', 'Sim, esquecer tudo')}
              </Button>
              <Button variant="ghost" onClick={() => setStep('idle')} className="min-h-11">{tr('Cancel', 'Cancelar')}</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setStep('confirm')} disabled={step === 'busy'} className="min-h-11">
            {step === 'busy' ? <Spinner /> : <Trash2 className="size-4" />} {tr('Forget everything in this browser', 'Esquecer tudo neste navegador')}
          </Button>
        )}
        <p role="status" className="text-xs text-good">
          {step === 'done' ? tr('Done: everything Lighthouse kept in this browser was erased.', 'Pronto: tudo o que o Lighthouse guardava neste navegador foi apagado.') : ''}
        </p>
      </div>
    </Panel>
  );
}

function PrivacyPanel() {
  const { locale } = useLocale();
  const tr = useTr();
  return (
    <Panel>
      <PanelTitle>{tr('Privacy', 'Privacidade')}</PanelTitle>
      <div className="space-y-3 text-xs leading-relaxed text-muted">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
          <span>
            {tr(
              'Read-only. The connector has no write path: nothing can spend, borrow, repay or touch the cards.',
              'Somente leitura. Não existe caminho de escrita no conector: nada pode gastar, emprestar, repagar ou mexer nos cartões.',
            )}
          </span>
        </div>
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
          <span>
            {tr(
              'Everything runs on your device. Imported files and the sign-in stay only in this browser; Lighthouse has no server.',
              'Tudo roda no seu aparelho. Os arquivos importados e o login ficam só neste navegador; o Lighthouse não tem servidor.',
            )}
          </span>
        </div>
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warn" />
          <span>{localized(PRIVACY_NOTE, locale)}</span>
        </div>
      </div>
    </Panel>
  );
}

function AboutPanel() {
  const { locale } = useLocale();
  const tr = useTr();
  return (
    <Panel>
      <PanelTitle>{tr('About Lighthouse', 'Sobre o Lighthouse')}</PanelTitle>
      <div className="space-y-2 text-xs leading-relaxed text-muted">
        <p className="text-sm font-medium text-ink">{PRODUCT_TAGLINE[locale]}.</p>
        <p>
          {tr(
            'Lighthouse is an independent open-source project for the ether.fi Cash community. It isn’t made or endorsed by ether.fi. It works with ether.fi Cash only through ether.fi’s official connector, which you approve and revoke in the ether.fi app.',
            'O Lighthouse é um projeto open source independente, feito para a comunidade do ether.fi Cash. Não é feito nem endossado pela ether.fi. Ele funciona com o ether.fi Cash só pelo conector oficial da ether.fi, que você aprova e revoga no app da ether.fi.',
          )}
        </p>
        <p>
          {tr(
            'The analyses are estimates made on your device. The ether.fi app is the source of truth: check there before acting.',
            'As análises são estimativas feitas no seu aparelho. O app da ether.fi é a fonte da verdade: confira lá antes de agir.',
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          <ExternalLink href={ETHERFI_CASH_URL} className="inline-flex min-h-6 items-center text-ink pointer-coarse:min-h-11">ether.fi Cash</ExternalLink>
          <span className="text-xs text-faint">{tr('(the link uses the author’s referral code)', '(o link usa o código de indicação do autor)')}</span>
          <ExternalLink href={ETHERFI_CONNECTOR_URL} className="inline-flex min-h-6 items-center text-ink pointer-coarse:min-h-11">{tr('ether.fi AI connector', 'Conector de IA da ether.fi')}</ExternalLink>
        </p>
      </div>
    </Panel>
  );
}

/** Jargão de desenvolvedor fica recolhido; abre sozinho quando alguma ferramenta falhou. */
function TechnicalDetails() {
  const { toolErrors, toolNames, toolsError } = useStore();
  const tr = useTr();
  const entries = Object.entries(toolErrors) as [keyof typeof toolErrors, LoadError][];
  const errorCount = entries.length;
  return (
    <details open={errorCount > 0 ? true : undefined} className="group panel p-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] font-medium uppercase tracking-[0.14em] text-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {tr('Technical details', 'Detalhes técnicos')}
        {errorCount ? <Badge tone="bad">{errorCount === 1 ? tr('1 error', '1 erro') : tr(`${errorCount} errors`, `${errorCount} erros`)}</Badge> : null}
      </summary>
      <div className="mt-4 space-y-3 text-sm">
        <p className="text-xs break-all text-muted">
          {tr('MCP server', 'Servidor MCP')}: <span className="font-mono text-ink">{MCP_URL}</span> · {tr('client', 'cliente')}: <span className="font-mono text-ink">lighthouse-for-etherfi-cash</span>
        </p>
        <div className="text-xs text-faint">
          {toolNames.length
            ? tr(`Connector tools: ${toolNames.length} detected`, `Ferramentas do conector: ${toolNames.length} detectadas`)
            : tr('Connector tools (from the official spec)', 'Ferramentas do conector (da especificação oficial)')}
        </div>
        {toolsError ? (
          <div className="rounded-md border border-line2 px-3 py-2 text-xs text-muted">
            {tr('The tool list didn’t load: ', 'A lista de ferramentas não carregou: ')}<ErrorLine error={toolsError} />
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(toolNames.length ? toolNames : ['list_transactions', 'list_cards', 'get_main_account', 'get_portfolio', 'get_deposit_address', 'example_library']).map((n) => {
            const error = entries.find(([k]) => k === n)?.[1];
            return (
              <div key={n} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2/40 px-3 py-2">
                <span className="min-w-0 font-mono text-xs break-all">{n}</span>
                {error ? <Badge tone="bad">{errBadge(error, tr)}</Badge> : toolNames.length ? <Badge>ok</Badge> : null}
              </div>
            );
          })}
        </div>
        {errorCount ? (
          <div className="space-y-1.5">
            {entries.map(([k, v]) => (
              <div key={k} className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad">
                <span className="font-mono">{k}</span>: <ErrorLine error={v} />
              </div>
            ))}
          </div>
        ) : null}
        {toolNames.length === 0 && errorCount === 0 ? (
          <Empty title={tr('Lighthouse never calls the connector in demo mode or with imported files.', 'O Lighthouse nunca chama o conector no modo demonstração nem com arquivos importados.')} />
        ) : null}
      </div>
    </details>
  );
}
