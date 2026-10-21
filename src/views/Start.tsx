import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDown, ArrowRight, Ban, BookOpen, ChevronDown, Code2, Eye, HandCoins, KeyRound, Server, ShieldCheck, Smartphone, Sparkles, Terminal,
} from 'lucide-react';
import { CLAUDE_CODE_URL, ETHERFI_CASH_URL, ETHERFI_CONNECTOR_URL, PHONE_TRANSFER, REPO_URL } from '../lib/config';
import { pick, type Locale } from '../lib/locale';
import { aiFilesRequest } from '../lib/aiPrompts';
import { cx } from '../lib/cx';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { Badge, ExternalLink } from '../components/ui';
import { Code, CommandBlock, CopyButton } from '../components/code';

// "Comece aqui" (#/start): como qualquer pessoa vê a própria conta no Lighthouse. Cada afirmação aqui segue o código
// (scripts/pull-history.mjs, src/state/store.tsx, src/lib/storage.ts, src/views/Connect.tsx); mudou lá, muda aqui.

type PathId = 'look' | 'claude' | 'terminal' | 'host';
const PATHS: PathId[] = ['look', 'claude', 'terminal', 'host'];

const NBSP = String.fromCharCode(0xa0);
/** Número + unidade sem quebra ("~10 min") */
const nb = (s: string) => s.replaceAll(' ', NBSP);

/** Pasta do projeto depois do git clone: o nome do repositório, ou um marcador enquanto ele não existe */
const repoFolder = (locale: Locale) => (REPO_URL ? REPO_URL.split('/').filter(Boolean).at(-1) ?? 'lighthouse' : pick(locale, '<project folder>', '<pasta do projeto>'));
const repoRef = (locale: Locale) => REPO_URL ?? pick(locale, '<repository link>', '<link do repositório>');

/** O pedido pronto para colar no Claude Code. Os comandos e a pasta seguem o que o README e os scripts fazem. */
function claudeRequest(locale: Locale): string {
  return pick(
    locale,
    `Set up Lighthouse for ether.fi Cash on this computer for me. Clone ${repoRef(locale)} and install it with \`npm ci\` (it needs Node 22.13 or newer; install Node if it is missing). Keep my data out of the project and out of any cloud-synced folder (OneDrive, iCloud Drive, Dropbox, Google Drive): before the first pull, create the folder lighthouse-data in my home folder (~/lighthouse-data on macOS or Linux, %USERPROFILE%\\lighthouse-data on Windows); Lighthouse finds it on its own, and \`node scripts/data-dir.mjs\` confirms it. Then run \`npm run pull\` and wait while I sign in on the ether.fi page that opens in my browser. When it finishes, run \`npm run dev\` and open http://localhost:5173/?fixtures. This task needs no email or other connector. Never upload, commit, send or share the data files.`,
    `Configure o Lighthouse for ether.fi Cash neste computador para mim. Clone ${repoRef(locale)} e instale com \`npm ci\` (precisa do Node 22.13 ou mais novo; instale o Node se não houver). Mantenha meus dados fora do projeto e de qualquer pasta sincronizada na nuvem (OneDrive, iCloud Drive, Dropbox, Google Drive): antes do primeiro pull, crie a pasta lighthouse-data na minha pasta pessoal (~/lighthouse-data no macOS ou Linux, %USERPROFILE%\\lighthouse-data no Windows); o Lighthouse a encontra sozinho, e o \`node scripts/data-dir.mjs\` confirma. Depois rode \`npm run pull\` e espere enquanto eu entro na página da ether.fi que vai abrir no meu navegador. Quando terminar, rode \`npm run dev\` e abra http://localhost:5173/?fixtures. Esta tarefa não precisa de email nem de outro conector. Nunca envie, faça commit nem compartilhe os arquivos de dados.`,
  );
}

/** Link para uma seção do README (âncora do GitHub) ou, sem repositório, só o nome da seção. */
function ReadmeLink({ anchor, children }: { anchor: string; children: ReactNode }) {
  if (!REPO_URL) return <span className="text-ink">{children}</span>;
  return <ExternalLink href={`${REPO_URL}#${anchor}`} className="text-ink">{children}</ExternalLink>;
}

/** "o repositório do projeto no GitHub", com a contração do português inteira dentro do link ("do", "no") */
function RepoName({ form = 'o' }: { form?: 'o' | 'do' | 'no' }) {
  const tr = useTr();
  const text = tr('the project’s GitHub repository', `${form} repositório do projeto no GitHub`);
  if (!REPO_URL) return <>{text}</>;
  return <ExternalLink href={REPO_URL} className="text-ink">{text}</ExternalLink>;
}

function SectionTitle({ id, children, icon: Icon }: { id: string; children: ReactNode; icon?: typeof Eye }) {
  return (
    <h2 id={id} tabIndex={-1} className="flex scroll-mt-20 items-center gap-2 font-display text-lg font-semibold tracking-tight text-ink outline-none sm:text-xl">
      {Icon ? <Icon aria-hidden className="size-5 shrink-0 text-accent" /> : null}
      {children}
    </h2>
  );
}

export function StartView({ target }: { target?: string | null }) {
  const tr = useTr();
  const initial = PATHS.find((p) => p === target) ?? 'claude';
  const [path, setPath] = useState<PathId>(initial);
  const steps = useRef<HTMLHeadingElement>(null);

  // escolher um caminho leva ao passo a passo dele (que fica logo abaixo dos cartões), com o foco no título
  const choose = (p: PathId) => {
    setPath(p);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      steps.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      steps.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-4 sm:space-y-10">
      <header className="space-y-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {tr('Use Lighthouse with your account', 'Use o Lighthouse com a sua conta')}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          {tr(
            'Lighthouse explains your ether.fi Cash card in plain words. Here is how to see your own account in it, step by step, whether or not you know how to program.',
            'O Lighthouse explica o seu cartão ether.fi Cash em palavras simples. Aqui está como ver a sua própria conta nele, passo a passo, sabendo programar ou não.',
          )}
        </p>
        <ul aria-label={tr('In short', 'Em resumo')} className="flex flex-wrap gap-2">
          <li><Badge tone="good"><ShieldCheck aria-hidden className="size-3.5" />{tr('read-only', 'só leitura')}</Badge></li>
          <li><Badge><Server aria-hidden className="size-3.5" />{tr('no server', 'sem servidor')}</Badge></li>
          <li><Badge><Code2 aria-hidden className="size-3.5" />{tr('open source (MIT)', 'open source (MIT)')}</Badge></li>
          <li><Badge><HandCoins aria-hidden className="size-3.5" />{tr('free', 'gratuito')}</Badge></li>
        </ul>
        {/* no celular os caminhos ficam a uma tela e meia daqui: um atalho já na primeira */}
        <button
          type="button"
          onClick={() => jumpTo('start-paths')}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-line2 px-3.5 text-sm font-medium text-ink transition-colors hover:bg-panel2 active:bg-panel2 lg:hidden"
        >
          {tr('Choose my path', 'Escolher meu caminho')}
          <ArrowDown aria-hidden className="size-4" />
        </button>
      </header>

      <HowItWorks />

      <section aria-labelledby="start-paths" className="space-y-4">
        <SectionTitle id="start-paths" icon={ArrowRight}>{tr('Choose your path', 'Escolha o seu caminho')}</SectionTitle>
        <PathCards selected={path} onChoose={choose} />
      </section>

      <section aria-labelledby="start-steps" className="space-y-5">
        <h2 ref={steps} id="start-steps" tabIndex={-1} className="scroll-mt-20 font-display text-lg font-semibold tracking-tight text-ink outline-none sm:text-xl">
          {tr('Step by step: ', 'Passo a passo: ')}
          <span className="text-accent">{pathTitle(path, tr)}</span>
        </h2>
        {path === 'look' ? <LookSteps /> : null}
        {path === 'claude' ? <ClaudeSteps /> : null}
        {path === 'terminal' ? <TerminalSteps /> : null}
        {path === 'host' ? <HostSteps /> : null}
        {path !== 'look' ? <OnYourPhone /> : null}
      </section>

      <WhyNoButton />
      <Security />
      <Extras />
      <OpenSource />
      <Faq />

      <footer className="rounded-xl border border-line bg-panel2/30 px-4 py-4 text-sm text-muted sm:px-5">
        <p className="font-medium text-ink">{tr('Don’t have ether.fi Cash yet?', 'Ainda não tem o ether.fi Cash?')}</p>
        <p className="mt-1">
          <ExternalLink href={ETHERFI_CASH_URL} className="text-accent">{tr('Get to know ether.fi Cash', 'Conheça o ether.fi Cash')}</ExternalLink>{' '}
          <span className="text-xs text-faint">{tr('(the link uses the author’s referral code)', '(o link usa o código de indicação do autor)')}</span>
        </p>
      </footer>
    </div>
  );
}

/** Rola até um título da página e põe o foco nele (o leitor de tela anuncia onde a pessoa chegou). */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

function pathTitle(p: PathId, tr: ReturnType<typeof useTr>): string {
  if (p === 'look') return tr('Just look', 'Só olhar');
  if (p === 'claude') return tr('With Claude Code', 'Com o Claude Code');
  if (p === 'terminal') return tr('With the terminal', 'Pelo terminal');
  return tr('Host your own', 'Hospedar o seu');
}

// ---------- como funciona: o diagrama ----------

interface DiagramNode {
  title: string;
  lines: [string, string];
  /** a descrição numa linha só, para o diagrama empilhado do celular */
  line: string;
  /** o que roda com você (computador e navegador) ganha o contorno de destaque */
  yours?: boolean;
}

function diagramNodes(locale: Locale): DiagramNode[] {
  return [
    {
      title: 'ether.fi Cash',
      lines: pick(locale, ['your account', 'and card'], ['sua conta', 'e cartão']),
      line: pick(locale, 'your account and card', 'sua conta e cartão'),
    },
    {
      title: pick(locale, 'Official connector', 'Conector oficial'),
      lines: pick(locale, ['read-only', 'sign-in on ether.fi'], ['só leitura', 'login na ether.fi']),
      line: pick(locale, 'read-only · sign-in on ether.fi', 'só leitura · login na ether.fi'),
    },
    {
      title: pick(locale, 'Your computer', 'Seu computador'),
      lines: pick(locale, ['npm run pull saves', '.json files'], ['npm run pull salva', 'arquivos .json']),
      line: pick(locale, 'npm run pull saves .json files', 'npm run pull salva arquivos .json'),
      yours: true,
    },
    {
      title: 'Lighthouse',
      lines: pick(locale, ['in your browser:', 'nothing is uploaded'], ['no seu navegador:', 'nada sobe']),
      line: pick(locale, 'in your browser · nothing uploaded', 'no seu navegador · nada sobe'),
      yours: true,
    },
  ];
}

/** Seta com ponta, desenhada em linhas (sem marker: cada SVG fica independente e sem ids) */
function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const horizontal = y1 === y2;
  const head = horizontal ? `M${x2 - 8} ${y2 - 6} L${x2} ${y2} L${x2 - 8} ${y2 + 6}` : `M${x2 - 6} ${y2 - 8} L${x2} ${y2} L${x2 + 6} ${y2 - 8}`;
  return (
    <g className="fill-none stroke-faint" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${x1} ${y1} L${x2} ${y2}`} />
      <path d={head} />
    </g>
  );
}

function HowItWorks() {
  const { locale } = useLocale();
  const tr = useTr();
  const nodes = diagramNodes(locale);
  const titleId = useId();
  const descId = useId();
  const title = tr('How Lighthouse gets your data', 'Como o Lighthouse recebe os seus dados');
  const desc = tr(
    'ether.fi Cash, then ether.fi’s official connector (read-only; you sign in on ether.fi’s page), then your computer (npm run pull saves .json files), then Lighthouse in your browser (it reads the files; nothing is uploaded).',
    'ether.fi Cash, depois o conector oficial da ether.fi (só leitura; você entra na página da ether.fi), depois o seu computador (o npm run pull salva arquivos .json), depois o Lighthouse no seu navegador (ele lê os arquivos; nada sobe).',
  );
  // largo (desktop): 4 caixas lado a lado; estreito: empilhadas, e o texto continua com 12 px ou mais a 320 px
  const W = { box: 197, gap: 44, h: 110 };
  const T = { box: 260, h: 54, gap: 22 };
  return (
    <section aria-labelledby="start-how" className="space-y-4">
      <SectionTitle id="start-how" icon={BookOpen}>{tr('How it works', 'Como funciona')}</SectionTitle>
      <div className="rounded-xl border border-line bg-panel/60 p-3 sm:p-5">
        <svg role="img" aria-labelledby={`${titleId}-w ${descId}-w`} viewBox="0 0 920 130" className="hidden h-auto w-full lg:block">
          <title id={`${titleId}-w`}>{title}</title>
          <desc id={`${descId}-w`}>{desc}</desc>
          {nodes.map((n, i) => {
            const x = i * (W.box + W.gap);
            return (
              <g key={n.title}>
                <rect x={x + 1} y={10} width={W.box - 2} height={W.h} rx={14} className={cx('fill-panel2', n.yours ? 'stroke-accent/60' : 'stroke-line2')} strokeWidth={1.5} />
                <text x={x + W.box / 2} y={48} textAnchor="middle" className="fill-ink" fontSize={17} fontWeight={600}>{n.title}</text>
                <text x={x + W.box / 2} y={76} textAnchor="middle" className="fill-muted" fontSize={15}>{n.lines[0]}</text>
                <text x={x + W.box / 2} y={97} textAnchor="middle" className="fill-muted" fontSize={15}>{n.lines[1]}</text>
                {i < nodes.length - 1 ? <Arrow x1={x + W.box + 6} y1={65} x2={x + W.box + W.gap - 6} y2={65} /> : null}
              </g>
            );
          })}
        </svg>
        <svg role="img" aria-labelledby={`${titleId}-t ${descId}-t`} viewBox={`0 0 280 ${4 * T.h + 3 * T.gap + 8}`} className="mx-auto block h-auto w-full max-w-[300px] lg:hidden">
          <title id={`${titleId}-t`}>{title}</title>
          <desc id={`${descId}-t`}>{desc}</desc>
          {nodes.map((n, i) => {
            const y = 4 + i * (T.h + T.gap);
            return (
              <g key={n.title}>
                <rect x={10} y={y} width={T.box} height={T.h} rx={12} className={cx('fill-panel2', n.yours ? 'stroke-accent/60' : 'stroke-line2')} strokeWidth={1.5} />
                <text x={140} y={y + 22} textAnchor="middle" className="fill-ink" fontSize={16} fontWeight={600}>{n.title}</text>
                <text x={140} y={y + 42} textAnchor="middle" className="fill-muted" fontSize={13.5}>{n.line}</text>
                {i < nodes.length - 1 ? <Arrow x1={140} y1={y + T.h + 3} x2={140} y2={y + T.h + T.gap - 3} /> : null}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="grid gap-2.5 text-sm leading-relaxed text-muted sm:grid-cols-3 sm:gap-3">
        <Fact icon={Eye}>
          <strong className="font-medium text-ink">{tr('What it reads: ', 'O que ele lê: ')}</strong>
          {tr(
            'your transactions, cards (nickname, type and last 4 digits), balances, holdings and deposit address, through ether.fi’s official AI connector.',
            'suas transações, cartões (apelido, tipo e últimos 4 dígitos), saldos, ativos e endereço de depósito, pelo conector de IA oficial da ether.fi.',
          )}
        </Fact>
        <Fact icon={Ban}>
          <strong className="font-medium text-ink">{tr('What it never reads: ', 'O que ele nunca lê: ')}</strong>
          {tr(
            'the full card number, CVC or expiry date. The connector doesn’t give access to them.',
            'o número completo do cartão, o CVC ou a validade. O conector não dá acesso a eles.',
          )}
        </Fact>
        <Fact icon={ShieldCheck}>
          <strong className="font-medium text-ink">{tr('It can’t move money: ', 'Ele não move dinheiro: ')}</strong>
          {tr(
            'the connector has no write path. Nothing can spend, borrow, repay or change your cards.',
            'o conector não tem caminho de escrita. Nada pode gastar, emprestar, repagar ou mudar seus cartões.',
          )}
        </Fact>
      </ul>
    </section>
  );
}

function Fact({ icon: Icon, children }: { icon: typeof Eye; children: ReactNode }) {
  return (
    <li className="flex gap-2.5 sm:rounded-xl sm:border sm:border-line sm:bg-panel/40 sm:p-3">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

// ---------- os caminhos ----------

function PathCards({ selected, onChoose }: { selected: PathId; onChoose: (p: PathId) => void }) {
  const { locale } = useLocale();
  const tr = useTr();
  const { isSample } = useStore();
  const showSteps = tr('See the steps', 'Ver o passo a passo');
  const card = (id: PathId, icon: typeof Eye, time: string, need: string, text: string, extra?: ReactNode, tag?: string) => {
    const Icon = icon;
    const on = selected === id;
    return (
      <li key={id} className={cx('flex min-w-0 flex-col gap-3 rounded-xl border p-4 transition-colors', on ? 'border-accent/60 bg-accent/5' : 'border-line bg-panel/60')}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex items-center gap-2 font-medium text-ink">
            <Icon aria-hidden className="size-4 shrink-0 text-accent" />
            {pathTitle(id, tr)}
          </h3>
          <Badge>{nb(time)}</Badge>
        </div>
        {tag ? <p className="-mt-1 text-xs font-medium text-accent">{tag}</p> : null}
        <p className="text-sm leading-relaxed text-muted">{text}</p>
        <p className="text-xs leading-relaxed text-faint">
          <span className="text-muted">{tr('You’ll need: ', 'Você vai precisar de: ')}</span>
          {need}
        </p>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {id === 'look' ? (
            <a href="#/portfolio" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink transition hover:brightness-110 active:brightness-95 pointer-fine:min-h-9">
              {isSample ? tr('Open the demo', 'Abrir o demo') : tr('Open the dashboard', 'Abrir o painel')}
              <ArrowRight aria-hidden className="size-4" />
            </a>
          ) : (
            <button
              type="button"
              aria-pressed={on}
              aria-controls="start-steps"
              onClick={() => onChoose(id)}
              className={cx(
                'inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition pointer-fine:min-h-9',
                on ? 'bg-accent text-accent-ink hover:brightness-110' : 'border border-line2 text-ink hover:bg-panel2 active:bg-panel2',
              )}
            >
              {showSteps}
              <ChevronDown aria-hidden className="size-4" />
            </button>
          )}
          {extra}
        </div>
      </li>
    );
  };
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {card(
        'look', Eye, '1 min',
        tr('nothing. It’s sample data.', 'nada. São dados fictícios.'),
        tr('Explore every screen with a fictional account whose dates follow today.', 'Explore todas as telas com uma conta fictícia, com datas que acompanham hoje.'),
      )}
      {card(
        'claude', Sparkles, '~10 min',
        tr(
          'a computer (Mac, Windows or Linux), Claude Code and your ether.fi Cash login.',
          'um computador (Mac, Windows ou Linux), o Claude Code e o seu login do ether.fi Cash.',
        ),
        tr(
          'Paste one request. Claude downloads, installs and runs everything; you only sign in on ether.fi’s page.',
          'Cole um pedido. O Claude baixa, instala e roda tudo; você só entra na página da ether.fi.',
        ),
        <CopyButton text={claudeRequest(locale)} visibleLabel={tr('Copy request', 'Copiar pedido')} context={tr('for Claude Code', 'para o Claude Code')} className="pointer-fine:min-h-9" />,
        tr('Recommended if you don’t program', 'Recomendado para quem não programa'),
      )}
      {card(
        'terminal', Terminal, '~5 min',
        tr('Node 22.13 or newer, git and your ether.fi Cash login.', 'Node 22.13 ou mais novo, git e o seu login do ether.fi Cash.'),
        tr('A handful of commands: download, install, pull your data and open the dashboard.', 'Alguns comandos: baixar, instalar, puxar os dados e abrir o painel.'),
      )}
      {card(
        'host', Server, '~20 min',
        tr('a GitHub account and a static host (Vercel, Netlify or Cloudflare Pages).', 'uma conta no GitHub e uma hospedagem estática (Vercel, Netlify ou Cloudflare Pages).'),
        tr(
          'Your own copy online, to open on any device. Your data still comes in by importing the files.',
          'Uma cópia sua na internet, para abrir em qualquer aparelho. Os dados continuam entrando pela importação dos arquivos.',
        ),
        undefined,
        tr('Optional', 'Opcional'),
      )}
    </ul>
  );
}

// ---------- os passos ----------

function Step({ n, title, children, see, wrong }: { n: number; title: string; children?: ReactNode; see?: ReactNode; wrong?: ReactNode }) {
  const tr = useTr();
  return (
    <li className="flex gap-3 sm:gap-4">
      <span aria-hidden className="tnum mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">{n}</span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <h3 className="font-medium text-ink">{title}</h3>
        {children ? <div className="space-y-2.5 text-sm leading-relaxed text-muted">{children}</div> : null}
        {see ? (
          <p className="text-sm leading-relaxed text-muted">
            <span className="font-medium text-ink">{tr('You’ll see: ', 'O que você vai ver: ')}</span>
            {see}
          </p>
        ) : null}
        {wrong ? (
          <div className="rounded-lg border border-line bg-panel2/30 px-3 py-2 text-xs leading-relaxed text-muted">
            <span className="font-medium text-ink">{tr('Didn’t work? ', 'Deu errado? ')}</span>
            {wrong}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-6">{children}</ol>;
}

function LookSteps() {
  const tr = useTr();
  const { isSample } = useStore();
  return (
    <Steps>
      <Step n={1} title={tr('Open the demo', 'Abra o demo')}>
        <p>
          {tr(
            'Everything in it is fictional: about sixteen months of an account with trips, subscriptions, duplicates and unusual charges on purpose, so every explanation shows up. The dates move so the data ends today.',
            'Tudo nele é fictício: cerca de dezesseis meses de uma conta com viagens, assinaturas, duplicatas e cobranças atípicas de propósito, para cada explicação aparecer. As datas andam para os dados terminarem hoje.',
          )}
        </p>
        <p>
          <a href="#/portfolio" className="inline-flex min-h-11 items-center gap-1 font-medium text-accent underline-offset-2 hover:underline pointer-fine:min-h-6">
            {isSample ? tr('Open the demo', 'Abrir o demo') : tr('Open the dashboard', 'Abrir o painel')} <span aria-hidden>→</span>
          </a>
        </p>
      </Step>
    </Steps>
  );
}

function ClaudeSteps() {
  const { locale } = useLocale();
  const tr = useTr();
  return (
    <Steps>
      <Step n={1} title={tr('Install Claude Code on your computer', 'Instale o Claude Code no seu computador')}>
        <p>
          {tr(
            'Use the desktop app or the terminal version, on the computer where you’ll open the dashboard. The web version won’t do: ether.fi’s sign-in comes back to your own computer (localhost).',
            'Use o app de computador ou a versão de terminal, no computador onde você vai abrir o painel. A versão web não serve: o login da ether.fi volta para o seu próprio computador (localhost).',
          )}
        </p>
        <p>
          <ExternalLink href={CLAUDE_CODE_URL} className="font-medium text-ink">{tr('Get Claude Code', 'Baixar o Claude Code')}</ExternalLink>
          <span className="text-faint"> · {tr('it needs a Claude account; see Anthropic’s plans.', 'precisa de uma conta do Claude; veja os planos da Anthropic.')}</span>
        </p>
      </Step>
      <Step
        n={2}
        title={tr('Paste this request', 'Cole este pedido')}
        see={tr(
          'Claude asks before each command (downloading the project, installing Node if it’s missing, installing the dependencies). Read what it wants to run and approve.',
          'o Claude pede permissão antes de cada comando (baixar o projeto, instalar o Node se faltar, instalar as dependências). Leia o que ele quer rodar e aprove.',
        )}
      >
        <CommandBlock code={claudeRequest(locale)} context={tr('the request for Claude Code', 'o pedido para o Claude Code')} caption={tr('Request for Claude Code', 'Pedido para o Claude Code')} wrap />
        {REPO_URL ? null : (
          <p className="text-xs text-faint">
            {tr('Replace ', 'Troque ')}<Code>{repoRef(locale)}</Code>
            {tr(' with the link to the project’s GitHub repository.', ' pelo link do repositório do projeto no GitHub.')}
          </p>
        )}
      </Step>
      <Step
        n={3}
        title={tr('Sign in on ether.fi’s page', 'Entre na página da ether.fi')}
        see={tr(
          'a page that says “Done. You can close this tab and go back to the terminal.” Then Claude reads every page of your statement and saves the files.',
          'uma página que diz “Pronto. Pode fechar esta aba e voltar ao terminal.” Depois o Claude lê todas as páginas do seu extrato e salva os arquivos.',
        )}
        wrong={tr(
          'No page opened? The address is in Claude’s output: open it yourself. More than 5 minutes passed? The wait expires: ask Claude to run npm run pull again.',
          'Nenhuma página abriu? O endereço está na saída do Claude: abra você mesmo. Passaram mais de 5 minutos? A espera expira: peça ao Claude para rodar o npm run pull de novo.',
        )}
      >
        <p>
          {tr('When Claude runs ', 'Quando o Claude roda o ')}<Code>npm run pull</Code>
          {tr(
            ', your browser opens ether.fi’s consent screen. Sign in, pick the account and approve read-only access.',
            ', o seu navegador abre a tela de consentimento da ether.fi. Entre, escolha a conta e aprove o acesso só de leitura.',
          )}
        </p>
      </Step>
      <Step
        n={4}
        title={tr('Open your dashboard', 'Abra o seu painel')}
        see={tr('your own numbers, with the badge “real data · local file”.', 'os seus próprios números, com o selo “dados reais · arquivo local”.')}
        wrong={
          <>
            {tr(
              '“No local files found”: the dashboard reads the same folder as the pull. Ask Claude to run ',
              '“Nenhum arquivo local encontrado”: o painel lê a mesma pasta que o pull. Peça ao Claude para rodar ',
            )}
            <Code>node scripts/data-dir.mjs</Code>
            {tr(
              ' to see which one; if the pull used LIGHTHOUSE_DATA_DIR, the dashboard needs it too. Port 5173 taken? Vite picks the next one: use the address it prints, with ?fixtures at the end.',
              ' para ver qual é; se o pull usou LIGHTHOUSE_DATA_DIR, o painel precisa dela também. Porta 5173 ocupada? O Vite usa a próxima: use o endereço que ele mostra, com ?fixtures no fim.',
            )}
          </>
        }
      >
        <p>
          {tr('Claude runs ', 'O Claude roda o ')}<Code>npm run dev</Code>{tr(' and opens ', ' e abre ')}<Code>http://localhost:5173/?fixtures</Code>.
        </p>
      </Step>
      <Step n={5} title={tr('Update it later', 'Atualize depois')}>
        <p>
          {tr('To bring in new transactions, ask Claude to run ', 'Para trazer transações novas, peça ao Claude para rodar o ')}<Code>npm run pull</Code>
          {tr(' again (or run it yourself in the project folder), then reload the page.', ' de novo (ou rode você mesmo na pasta do projeto) e recarregue a página.')}
        </p>
      </Step>
    </Steps>
  );
}

function TerminalSteps() {
  const { locale } = useLocale();
  const tr = useTr();
  const copy = tr('the command', 'o comando');
  return (
    <Steps>
      <Step
        n={1}
        title={tr('Check Node', 'Confira o Node')}
        see={tr('v22.13 or newer.', 'v22.13 ou mais novo.')}
        wrong={tr('Older, or “command not found”: install the current LTS from nodejs.org.', 'Mais velho, ou “command not found”: instale a versão LTS atual em nodejs.org.')}
      >
        <CommandBlock code="node -v" context={copy} />
      </Step>
      <Step n={2} title={tr('Download the project', 'Baixe o projeto')}>
        <CommandBlock code={`git clone ${repoRef(locale)}\ncd ${repoFolder(locale)}`} context={copy} />
        {REPO_URL ? null : (
          <p className="text-xs text-faint">
            {tr('Use the link to ', 'Use o link ')}<RepoName form="do" />
            {tr(' and the folder git creates.', ' e a pasta que o git criar.')}
          </p>
        )}
      </Step>
      <Step n={3} title={tr('Install', 'Instale')} see={tr('the dependencies being installed. Warnings are fine; errors are not.', 'as dependências sendo instaladas. Avisos tudo bem; erros não.')}>
        <CommandBlock code="npm ci" context={copy} />
      </Step>
      {/* a pasta pessoal lighthouse-data é achada sem variável (scripts/data-dir.mjs): basta criá-la uma vez */}
      <Step n={4} title={tr('Create the data folder, outside the project and the cloud', 'Crie a pasta de dados, fora do projeto e da nuvem')}>
        <p>
          {tr(
            'The files are your full financial history: keep them out of the project and of any folder synced to the cloud (OneDrive, iCloud Drive, Dropbox, Google Drive). Create ',
            'Os arquivos são o seu histórico financeiro inteiro: deixe-os fora do projeto e de qualquer pasta sincronizada na nuvem (OneDrive, iCloud Drive, Dropbox, Google Drive). Crie ',
          )}
          <Code>lighthouse-data</Code>
          {tr(
            ' in your home folder once: the pull and the dashboard find it on their own. Without it, the files go to ',
            ' na sua pasta pessoal uma vez: o pull e o painel a encontram sozinhos. Sem ela, os arquivos vão para ',
          )}
          <Code>fixtures/live/</Code>
          {tr(', inside the project.', ', dentro do projeto.')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CommandBlock code="mkdir -p ~/lighthouse-data" context={copy} caption="macOS / Linux" />
          <CommandBlock code={'New-Item -ItemType Directory -Force "$env:USERPROFILE\\lighthouse-data"'} context={copy} caption="Windows (PowerShell)" />
        </div>
        <p className="text-xs text-faint">
          {tr(
            'Created once, it stays: the pull and the dashboard find it on their own, in any terminal. Avoid a folder at the root of the drive (such as C:\\lighthouse-data): on Windows it inherits write access for every account on the computer. Another folder? Set ',
            'Criada uma vez, ela fica: o pull e o painel a acham sozinhos, em qualquer terminal. Evite uma pasta na raiz do disco (como C:\\lighthouse-data): no Windows, ela herda escrita para todas as contas do computador. Outra pasta? Defina ',
          )}
          <Code>LIGHTHOUSE_DATA_DIR</Code>
          {tr(' in the same terminal window as the next two commands. ', ' na mesma janela do terminal dos dois próximos comandos. ')}
          <Code>node scripts/data-dir.mjs</Code>
          {tr(' says which folder is in use.', ' diz qual pasta está valendo.')}
        </p>
      </Step>
      <Step
        n={5}
        title={tr('Pull your data', 'Puxe os seus dados')}
        see={tr(
          'your browser opens ether.fi’s consent screen; sign in and approve. The terminal then shows “Approved. Reading the account…”, a page counter and finally “Saved in …” with how many pages and transactions it saved. If it saved to fixtures/live/, it ends with a tip to create lighthouse-data and move the files there.',
          'o navegador abre a tela de consentimento da ether.fi; entre e aprove. O terminal mostra “Aprovado. Lendo a conta…”, um contador de páginas e por fim “Salvo em …”, com quantas páginas e movimentações ele salvou. Se salvou em fixtures/live/, termina com uma dica para criar a lighthouse-data e mover os arquivos para lá.',
        )}
        wrong={
          <>
            {tr('“Ignored a sign-in return from another request”: normal, it keeps waiting for yours. ', '“Ignorei um retorno de login de outro pedido”: normal, ele continua esperando o seu. ')}
            {tr('“port 53682 unavailable”: use another one, ', '“porta 53682 indisponível”: use outra, ')}
            <Code>PULL_PORT=53700 npm run pull</Code>
            {tr(' (macOS/Linux) or ', ' (macOS/Linux) ou ')}
            <Code>{"$env:PULL_PORT='53700'; npm run pull"}</Code>
            {tr(' (PowerShell). “nobody approved within 5 minutes”: run it again.', ' (PowerShell). “ninguém aprovou em 5 minutos”: rode de novo.')}
          </>
        }
      >
        <CommandBlock code="npm run pull" context={copy} />
      </Step>
      <Step
        n={6}
        title={tr('Open the dashboard', 'Abra o painel')}
        see={tr('your own numbers, with the badge “real data · local file”.', 'os seus próprios números, com o selo “dados reais · arquivo local”.')}
        wrong={tr(
          'Port 5173 taken? Vite picks the next one: use the address it prints, with ?fixtures at the end.',
          'Porta 5173 ocupada? O Vite usa a próxima: use o endereço que ele mostra, com ?fixtures no fim.',
        )}
      >
        <CommandBlock code="npm run dev" context={copy} />
        <p>
          {tr('Then open ', 'Depois abra ')}<Code>http://localhost:5173/?fixtures</Code>
          {tr('. To update later, run npm run pull again and reload.', '. Para atualizar depois, rode o npm run pull de novo e recarregue.')}
        </p>
      </Step>
    </Steps>
  );
}

function HostSteps() {
  const tr = useTr();
  return (
    <Steps>
      <Step n={1} title={tr('Fork the repository', 'Faça um fork do repositório')}>
        <p>
          {tr('On GitHub, fork ', 'No GitHub, faça um fork ')}<RepoName form="do" />
          {tr(' to your account.', ' para a sua conta.')}
        </p>
      </Step>
      <Step n={2} title={tr('Deploy it as a static site', 'Publique como site estático')}>
        <p>
          {tr(
            'On Vercel, Netlify or Cloudflare Pages, import your fork. Build command ',
            'Na Vercel, na Netlify ou no Cloudflare Pages, importe o seu fork. Comando de build ',
          )}
          <Code>npm run build</Code>
          {tr(', output folder ', ', pasta de saída ')}
          <Code>dist</Code>
          {tr(
            ', Node 22. The security headers (a strict Content-Security-Policy) already come in the repository: ',
            ', Node 22. Os cabeçalhos de segurança (uma Content-Security-Policy estrita) já vêm no repositório: ',
          )}
          <Code>vercel.json</Code>, <Code>netlify.toml</Code>
          {tr(' and ', ' e ')}
          <Code>public/_headers</Code>.
        </p>
        <p>
          {tr('Details per host: the ', 'Detalhes por hospedagem: a seção ')}
          <ReadmeLink anchor="deploy">Deploy</ReadmeLink>
          {tr(' section of the README.', ' do README.')}
        </p>
      </Step>
      <Step n={3} title={tr('Bring in your data', 'Traga os seus dados')}>
        <p>
          {tr(
            'On your computer, pull the files (the terminal path up to step 5, or Claude Code). Then open your site, go to ',
            'No seu computador, puxe os arquivos (o caminho pelo terminal até o passo 5, ou o Claude Code). Depois abra o seu site, vá em ',
          )}
          <a href="#/portfolio/connection" className="font-medium text-ink underline underline-offset-2">{tr('Portfolio → Connection', 'Portfólio → Conexão')}</a>
          {tr(' and import the .json files (file picker, or drag and drop).', ' e importe os .json (seletor de arquivos, ou arrastar e soltar).')}
        </p>
      </Step>
      <Step n={4} title={tr('Remember them, or not', 'Lembrar ou não')}>
        <p>
          {tr(
            'By default the data stays only in the tab’s memory. “Remember in this browser” keeps it in this browser (IndexedDB) until you choose “Forget these files”. The “Connect” button straight from your site doesn’t work today; see below why.',
            'Por padrão, os dados ficam só na memória da aba. “Lembrar neste navegador” guarda neste navegador (IndexedDB) até você escolher “Esquecer estes arquivos”. O botão “Conectar” direto do seu site não funciona hoje; veja abaixo por quê.',
          )}
        </p>
      </Step>
    </Steps>
  );
}

function OnYourPhone() {
  const tr = useTr();
  return (
    <div className="rounded-xl border border-line bg-panel/60 p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-medium text-ink">
        <Smartphone aria-hidden className="size-4 shrink-0 text-accent" />
        {tr('On your phone', 'No celular')}
      </h3>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
        <li>{tr('Pulling the data needs a computer: create the files there first.', 'Puxar os dados precisa de um computador: gere os arquivos lá primeiro.')}</li>
        <li>{tr(PHONE_TRANSFER.en, PHONE_TRANSFER.pt)}</li>
        <li>
          {tr(
            'Open a published copy of Lighthouse (ideally your own), go to Portfolio → Connection and import them. On a phone, that screen puts the import first.',
            'Abra uma cópia publicada do Lighthouse (de preferência a sua), vá em Portfólio → Conexão e importe. No celular, essa tela já mostra a importação primeiro.',
          )}
        </li>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        {tr(
          'Only import your data into a copy you trust: the files never leave the browser, but the page’s code is what reads them.',
          'Só importe os seus dados numa cópia em que você confia: os arquivos não saem do navegador, mas é o código da página que os lê.',
        )}
      </p>
    </div>
  );
}

// ---------- o porquê, a segurança e o resto ----------

function WhyNoButton() {
  const tr = useTr();
  return (
    <section aria-labelledby="start-why" className="space-y-3">
      <SectionTitle id="start-why" icon={KeyRound}>{tr('Why isn’t there just a “Connect” button?', 'Por que não tem só um botão “Conectar”?')}</SectionTitle>
      <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-muted">
        <p>
          {tr(
            'ether.fi’s connector currently refuses calls made by a browser from any site of ours (CORS): localhost, *.pages.dev and *.github.io were tested and all get a 403. A script on your computer isn’t a browser, so ',
            'O conector da ether.fi hoje recusa chamadas feitas por um navegador a partir de qualquer site nosso (CORS): localhost, *.pages.dev e *.github.io foram testados e todos recebem 403. Um script no seu computador não é um navegador, então o ',
          )}
          <Code>npm run pull</Code>
          {tr(
            ' works. That’s why the path is: pull the files, then import them.',
            ' funciona. Por isso o caminho é: puxar os arquivos e depois importar.',
          )}
        </p>
        <p>
          {tr(
            'If ether.fi ever allows a site, the direct connection on the Connection screen (“Try connecting directly anyway”) works there, and whoever runs the site can make it the main path with one setting.',
            'Se a ether.fi um dia liberar um site, a conexão direta da tela de Conexão (“Tentar conectar direto mesmo assim”) funciona nele, e quem publica o site pode torná-la o caminho principal com uma configuração.',
          )}
        </p>
        <p>
          <strong className="font-medium text-ink">{tr('Why a script, and not asking an AI to copy your data into a chat? ', 'Por que um script, e não pedir a uma IA para copiar os dados no chat? ')}</strong>
          {tr(
            'The script saves the connector’s answers exactly as they came. An AI retyping hundreds or thousands of transactions can get numbers wrong.',
            'O script salva as respostas do conector exatamente como vieram. Uma IA redigitando centenas ou milhares de transações pode errar números.',
          )}
        </p>
      </div>
    </section>
  );
}

function Security() {
  const tr = useTr();
  const item = (children: ReactNode) => (
    <li className="flex gap-2.5">
      <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
      <span className="min-w-0">{children}</span>
    </li>
  );
  return (
    <section aria-labelledby="start-security" className="space-y-3">
      <SectionTitle id="start-security" icon={ShieldCheck}>{tr('Security and control', 'Segurança e controle')}</SectionTitle>
      <h3 className="pt-1 font-medium text-ink">{tr('What ', 'O que o ')}<Code>npm run pull</Code>{tr(' does', ' faz')}</h3>
      <ul className="max-w-3xl space-y-2 text-sm leading-relaxed text-muted">
        {item(
          <>
            {tr('Registers a public OAuth client with ether.fi (no secret) and keeps only its id, in ', 'Registra um cliente OAuth público na ether.fi (sem segredo) e guarda só o id dele, em ')}
            <Code>.pull-client.json</Code>
            {tr(' inside the data folder.', ' dentro da pasta de dados.')}
          </>,
        )}
        {item(tr(
          'Opens ether.fi’s own consent screen: you sign in and approve there, with read-only scopes (transactions, cards, balances).',
          'Abre a tela de consentimento da própria ether.fi: você entra e aprova lá, com escopos só de leitura (transações, cartões, saldos).',
        ))}
        {item(tr(
          'Waits for the answer only on your own computer (localhost, port 53682), and ignores any return that is not from this request.',
          'Espera a resposta só no seu próprio computador (localhost, porta 53682) e ignora qualquer retorno que não seja deste pedido.',
        ))}
        {item(tr(
          'Keeps the access token only in its memory while it runs: it is never written to disk.',
          'Guarda o token de acesso só na memória enquanto roda: ele nunca vai para o disco.',
        ))}
        {item(
          <>
            {tr('Saves the answers as .json files in your data folder (', 'Salva as respostas em arquivos .json na sua pasta de dados (')}
            <Code>LIGHTHOUSE_DATA_DIR</Code>
            {tr(', else ', ', senão ')}
            <Code>lighthouse-data</Code>
            {tr(' in your home folder, else ', ' na pasta pessoal, senão ')}
            <Code>fixtures/live/</Code>
            {tr(
              ') only after reading everything: if something fails midway, your previous files stay as they were. It refuses a folder inside the project other than fixtures/live/, which git would commit.',
              ') só depois de ler tudo: se algo falhar no meio, os arquivos anteriores ficam como estavam. Recusa uma pasta dentro do projeto que não seja fixtures/live/, que o git levaria num commit.',
            )}
          </>,
        )}
      </ul>
      <h3 className="pt-2 font-medium text-ink">{tr('In the browser', 'No navegador')}</h3>
      <ul className="max-w-3xl space-y-2 text-sm leading-relaxed text-muted">
        {item(tr(
          'The imported files are read on your device; nothing is uploaded. By default they stay only in the tab’s memory.',
          'Os arquivos importados são lidos no seu aparelho; nada sobe. Por padrão, ficam só na memória da aba.',
        ))}
        {item(tr(
          '“Remember in this browser” keeps them in this browser (IndexedDB) until “Forget these files”. “Forget everything in this browser” also erases your answers and the sign-in; only the language stays.',
          '“Lembrar neste navegador” guarda neste navegador (IndexedDB) até “Esquecer estes arquivos”. “Esquecer tudo neste navegador” apaga também as suas respostas e o login; só o idioma fica.',
        ))}
        {item(tr(
          'A published copy talks only to itself and to ether.fi’s connector: the Content-Security-Policy in the repository blocks everything else.',
          'Uma cópia publicada só fala com ela mesma e com o conector da ether.fi: a Content-Security-Policy do repositório bloqueia o resto.',
        ))}
      </ul>
      <h3 className="pt-2 font-medium text-ink">{tr('Revoking access', 'Revogar o acesso')}</h3>
      <p className="max-w-3xl text-sm leading-relaxed text-muted">
        {tr('Anytime, in the ether.fi app: ', 'Quando quiser, no app da ether.fi: ')}
        <span className="whitespace-nowrap text-ink">Settings →</span> <span className="whitespace-nowrap text-ink">AI Connections</span>
        {tr('. ether.fi explains the connection on its ', '. A ether.fi explica a conexão na ')}
        <ExternalLink href={ETHERFI_CONNECTOR_URL} className="text-ink">{tr('AI connector page', 'página do conector de IA')}</ExternalLink>.
      </p>
    </section>
  );
}

function Extras() {
  const tr = useTr();
  return (
    <section aria-labelledby="start-extras" className="space-y-3">
      <SectionTitle id="start-extras" icon={Sparkles}>{tr('Extras with your AI (optional)', 'Extras com a sua IA (opcional)')}</SectionTitle>
      <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted pointer-coarse:space-y-6">
        <li>
          {tr(
            'Lighthouse never reads your email. Your own Claude, with your email connected, can write the subscription files (',
            'O Lighthouse nunca lê o seu email. O seu próprio Claude, com o email conectado, pode escrever os arquivos de assinaturas (',
          )}
          <Code>subscription-evidence.json</Code>, <Code>subscription-research.json</Code>, <Code>renewal-audit.json</Code>
          {tr(
            '): receipts, renewal notices and cancel terms. Import them with the others. Formats: the “AI files” section of the ',
            '): recibos, avisos de renovação e regras de cancelamento. Importe junto com os outros. Formatos: a seção “Arquivos da IA” do ',
          )}
          <ReadmeLink anchor="ai-files-dev-or-import">README</ReadmeLink>.
          <AiFilesRequest />
        </li>
        <li>
          <a href="#/insights" className="font-medium text-ink underline underline-offset-2">AI Insights</a>
          {tr(
            ' (optional, off by default): explains your credit, yield, savings and the period with your own numbers, calculated in this browser. Nothing leaves it. Its ready-made questions open Claude in a new tab with the question only, never your data.',
            ' (opcional, começa desligado): explica o seu crédito, o rendimento, a economia e o período com os seus números, calculado neste navegador. Nada sai dele. As perguntas prontas abrem o Claude em outra aba, só com a pergunta, nunca com os seus dados.',
          )}
        </li>
        <li>
          {tr('You can also connect the same ', 'Você também pode conectar o mesmo ')}
          <ExternalLink href={ETHERFI_CONNECTOR_URL} className="text-ink">{tr('ether.fi connector', 'conector da ether.fi')}</ExternalLink>
          {tr(' to Claude and ask questions about your account in the chat.', ' ao Claude e fazer perguntas sobre a sua conta no chat.')}
        </li>
      </ul>
    </section>
  );
}

/**
 * Antes do pedido, a sessão: um email pode trazer instrução escondida para a IA, e a combinação perigosa é ler email,
 * ver os dados e poder enviar na mesma sessão. O texto completo fica atrás de "ver o pedido".
 */
function AiFilesRequest() {
  const tr = useTr();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const id = useId();
  const doc = REPO_URL ? `${REPO_URL}/blob/main/docs/ai-prompts.md` : null;
  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-line bg-panel/60 p-3">
      <p>
        <span className="font-medium text-ink">{tr('Do it in a session that can’t send anything. ', 'Faça isso numa sessão que não consiga enviar nada. ')}</span>
        {tr(
          'An email can carry hidden text written for your AI. In your AI’s settings, turn off the tools that send, reply, forward or share (email, Drive, calendar), leave the ether.fi connector off for this task and keep the AI asking before each action. The request below covers the two files that come from email and tells your AI to only read and to treat every email as data.',
          'Um email pode trazer texto escondido escrito para a sua IA. Nas configurações da sua IA, desligue as ferramentas que enviam, respondem, encaminham ou compartilham (email, Drive, agenda), deixe o conector da ether.fi desligado nesta tarefa e mantenha a IA pedindo permissão antes de cada ação. O pedido abaixo cobre os dois arquivos que vêm do email e manda a sua IA só ler e tratar todo email como dado.',
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CopyButton text={aiFilesRequest(locale)} visibleLabel={tr('Copy request', 'Copiar pedido')} context={tr('for your AI, read-only email', 'para a sua IA, email só leitura')} />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-xs text-ink underline underline-offset-2 pointer-fine:min-h-8"
        >
          {open ? tr('hide the request', 'esconder o pedido') : tr('see the request', 'ver o pedido')}
          <ChevronDown aria-hidden className={cx('size-3.5 motion-safe:transition-transform', open && 'rotate-180')} />
        </button>
        {doc ? <ExternalLink href={doc} className="text-xs text-ink">{tr('the same rules in the repository', 'as mesmas regras no repositório')}</ExternalLink> : null}
      </div>
      <div id={id} hidden={!open}>
        <CommandBlock code={aiFilesRequest(locale)} context={tr('the request for your AI', 'o pedido para a sua IA')} caption={tr('Request for your AI (email, read-only)', 'Pedido para a sua IA (email, só leitura)')} wrap />
      </div>
    </div>
  );
}

function OpenSource() {
  const tr = useTr();
  return (
    <section aria-labelledby="start-oss" className="space-y-3">
      <SectionTitle id="start-oss" icon={Code2}>{tr('Open source', 'Open source')}</SectionTitle>
      <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted pointer-coarse:space-y-6">
        <li>{tr('MIT license: use it, change it, share it.', 'Licença MIT: use, mude, compartilhe.')}</li>
        <li>
          {tr('The code is in ', 'O código está ')}<RepoName form="no" />
          {tr('. Fork it and make it yours: the links and the credit live in ', '. Faça um fork e deixe do seu jeito: os links e o crédito ficam em ')}
          <Code>src/lib/config.ts</Code>.
        </li>
        <li>
          {tr('To contribute, read ', 'Para contribuir, leia o ')}
          {REPO_URL ? <ExternalLink href={`${REPO_URL}/blob/HEAD/CONTRIBUTING.md`} className="text-ink">CONTRIBUTING.md</ExternalLink> : <Code>CONTRIBUTING.md</Code>}
          {tr(
            '. In issues and pull requests use only the demo or the synthetic files: never paste real transactions, amounts or screenshots of your account.',
            '. Em issues e pull requests use só o demo ou os arquivos sintéticos: nunca cole transações reais, valores ou prints da sua conta.',
          )}
        </li>
      </ul>
    </section>
  );
}

function Faq() {
  const tr = useTr();
  const items: [string, ReactNode][] = [
    [
      tr('Is it paid?', 'É pago?'),
      tr(
        'Lighthouse is free and open source (MIT). ether.fi Cash and Claude are separate products, with their own terms.',
        'O Lighthouse é gratuito e open source (MIT). O ether.fi Cash e o Claude são produtos à parte, com os próprios termos.',
      ),
    ],
    [
      tr('Does my data go to a server?', 'Meus dados vão para algum servidor?'),
      tr(
        'No. Lighthouse has no server and no analytics. The pull talks only to ether.fi, and the page reads the files in your browser.',
        'Não. O Lighthouse não tem servidor nem analytics. O pull só fala com a ether.fi, e a página lê os arquivos no seu navegador.',
      ),
    ],
    [
      tr('Do I need to know how to program?', 'Preciso saber programar?'),
      tr(
        'No. With Claude Code you paste one request and sign in on ether.fi’s page; Claude asks before running each command.',
        'Não. Com o Claude Code você cola um pedido e entra na página da ether.fi; o Claude pede permissão antes de cada comando.',
      ),
    ],
    [
      tr('Does it work on my phone?', 'Funciona no celular?'),
      tr(
        'To view, yes: import the files on a published copy (see “On your phone” above). Pulling the data needs a computer.',
        'Para ver, sim: importe os arquivos numa cópia publicada (veja “No celular”, acima). Puxar os dados precisa de um computador.',
      ),
    ],
    [
      tr('Does it work with another card?', 'Funciona com outro cartão?'),
      tr(
        'No. It reads ether.fi Cash accounts only, through ether.fi’s official connector.',
        'Não. Ele lê só contas ether.fi Cash, pelo conector oficial da ether.fi.',
      ),
    ],
    [
      tr('Can I erase everything?', 'Posso apagar tudo?'),
      tr(
        'Yes, in three places: “Forget everything in this browser” (Portfolio → Connection), revoking access in the ether.fi app (Settings → AI Connections) and deleting the data folder on your computer.',
        'Sim, em três lugares: “Esquecer tudo neste navegador” (Portfólio → Conexão), revogar o acesso no app da ether.fi (Settings → AI Connections) e apagar a pasta de dados no seu computador.',
      ),
    ],
  ];
  return (
    <section aria-labelledby="start-faq" className="space-y-3">
      <SectionTitle id="start-faq">{tr('Questions', 'Perguntas frequentes')}</SectionTitle>
      <div className="divide-y divide-line rounded-xl border border-line bg-panel/60">
        {items.map(([q, a]) => <FaqItem key={q} question={q}>{a}</FaqItem>)}
      </div>
    </section>
  );
}

/** Acordeão acessível: o botão do título diz se está aberto (aria-expanded) e qual região controla. */
function FaqItem({ question, children }: { question: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <h3>
        <button
          type="button"
          id={`${id}-q`}
          aria-expanded={open}
          aria-controls={`${id}-a`}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-panel2/50 active:bg-panel2"
        >
          {question}
          <ChevronDown aria-hidden className={cx('size-4 shrink-0 text-muted motion-safe:transition-transform', open && 'rotate-180')} />
        </button>
      </h3>
      <div id={`${id}-a`} role="region" aria-labelledby={`${id}-q`} hidden={!open} className="px-4 pb-4 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </div>
  );
}

