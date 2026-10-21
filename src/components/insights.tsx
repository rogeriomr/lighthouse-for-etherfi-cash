import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown, Copy, ShieldCheck, Sparkles } from 'lucide-react';
import { dateShort, nb, pct, timeOnly, usd } from '../lib/format';
import type { Dataset, Transaction } from '../lib/types';
import type { InsightCard as InsightCardData, InsightGroup as Group, PortfolioSnapshot } from '../lib/insights/types';
import { simulateEthDrop, type EthDropResult } from '../lib/insights/credit';
import { buildInsights, claudeLink, claudePrompts, DEFAULT_ETH_DROP } from '../lib/insights/engine';
import { makeSnapshot, validateSnapshot } from '../lib/insights/summary';
import { readStore, writeStore } from '../lib/storage';
import { useStore } from '../state/store';
import { cx } from '../lib/cx';
import { useLocale, useTr } from '../state/locale';
import { Badge, Button, ExternalLink, Panel, PanelTitle, Why } from './ui';
import { TxRow } from './txrow';
import { useBorrowRate, useClubPrices } from './insightsPref';
import { useSubscriptions } from './subscriptionParts';

// Peças da aba AI Insights (views/Insights.tsx): a preferência liga/desliga, o consentimento, o cartão de insight com
// "por quê?", o simulador de queda do ETH, a taxa opcional do emprestado e o bloco "Abrir no Claude".
// Fase 1: tudo é calculado aqui, no navegador; nada sai do aparelho.

// a preferência liga/desliga e a taxa digitada moram em insightsPref.ts (o App lê a preferência sem baixar o motor)

// ---------- o cartão ----------

const MAX_ROWS = 20;

/**
 * Um insight: título, a frase, os números (com "Estimativa" quando for o caso), o selo de origem ("Calculado aqui") e
 * o "por quê?" com a conta e as linhas que a sustentam. Informação e cenário, nunca recomendação: o texto vem pronto do
 * motor, que passa pelo filtro de recomendação no check. `collapsed` (ex.: as mecânicas do crédito sem nada emprestado)
 * começa fechado: o título vira o botão que abre o resto.
 */
export function InsightCard({ card, txById, children }: { card: InsightCardData; txById: Map<string, Transaction>; children?: ReactNode }) {
  const tr = useTr();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(!card.collapsed);
  const contentId = useId();
  const rows = (card.relatedIds ?? []).map((id) => txById.get(id)).filter((t): t is Transaction => Boolean(t));
  const shown = all ? rows : rows.slice(0, MAX_ROWS);
  return (
    <Panel className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        {card.collapsed ? (
          <h3 className="min-w-0 flex-1 text-base font-medium leading-snug text-ink">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => setOpen((o) => !o)}
              className="-my-1 flex min-h-11 w-full cursor-pointer items-center gap-2 py-1 text-left hover:text-muted pointer-fine:min-h-8"
            >
              <ChevronDown aria-hidden className={cx('size-4 shrink-0 text-faint transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
              {card.title}
            </button>
          </h3>
        ) : (
          <h3 className="min-w-0 text-base font-medium leading-snug text-ink">{card.title}</h3>
        )}
        <span className="flex shrink-0 flex-wrap gap-1.5">
          {card.estimate ? <Badge>{tr('Estimate', 'Estimativa')}</Badge> : null}
          {/* fase 2: o app refaz a conta das linhas que a IA citou, mas a escolha das linhas e o texto são dela */}
          <Badge tone="neutral">{card.origin === 'ai' ? tr('From your AI · numbers recalculated here', 'Da sua IA · números recalculados aqui') : tr('Calculated here', 'Calculado aqui')}</Badge>
        </span>
      </div>
      {/* fechado: só o título e os selos; aberto, o resto (o mesmo para todo cartão que não vem fechado) */}
      <div id={contentId} hidden={!open}>
        <p className="mt-2 text-sm leading-relaxed text-muted">{card.body}</p>
        {card.facts.length ? (
          <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-3 border-t border-line pt-3">
            {card.facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-xs text-faint">{f.label}</dt>
                <dd className="tnum mt-0.5 font-display text-lg font-semibold tracking-tight text-ink">
                  {f.estimate ? (
                    <>
                      <span aria-hidden>≈{'\u00A0'}</span>
                      <span className="sr-only">{tr('about ', 'cerca de ')}</span>
                    </>
                  ) : null}
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {children}
        {card.note ? <p className="mt-3 text-xs leading-relaxed text-muted">{card.note}</p> : null}
        {/* fonte pública de número de fora do dataset: link (só https, do próprio motor) e o dia em que foi conferida;
            texto de imprensa (não página oficial) leva o selo e o dia em que saiu */}
        {card.sources?.length ? (
          <ul className="mt-3 space-y-0.5 text-xs leading-relaxed text-faint">
            {card.sources.map((src) => (
              <li key={src.url}>
                {tr('Source: ', 'Fonte: ')}
                <ExternalLink href={src.url} className="text-muted hover:text-ink">{src.label}</ExternalLink>
                {src.level === 'press' ? (
                  <>
                    {' '}
                    <Badge title={tr('From the press, not an official page', 'Da imprensa, não de uma página oficial')}>{tr('press', 'imprensa')}</Badge>
                  </>
                ) : null}
                {src.published ? nb(tr(` · published on ${dateShort(`${src.published}T12:00:00Z`)}`, ` · publicada em ${dateShort(`${src.published}T12:00:00Z`)}`)) : null}
                {nb(tr(` · checked on ${dateShort(`${src.checked}T12:00:00Z`)}`, ` · conferida em ${dateShort(`${src.checked}T12:00:00Z`)}`))}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3">
          <Why>
            <p>{card.why}</p>
            {rows.length ? (
              <div className="-mx-3 mt-2 divide-y divide-line border-t border-line">
                {shown.map((t) => <TxRow key={t.id} t={t} meta={`${dateShort(t.date)} · ${timeOnly(t.date)}`} />)}
              </div>
            ) : null}
            {rows.length > MAX_ROWS ? (
              <button type="button" onClick={() => setAll((v) => !v)} className="tap mt-2 cursor-pointer text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-ink">
                {all ? tr('Show fewer', 'Mostrar menos') : tr(`Show all ${rows.length}`, `Mostrar todas as ${rows.length}`)}
              </button>
            ) : null}
          </Why>
        </div>
      </div>
    </Panel>
  );
}

/** Um grupo de cartões com título e uma linha de contexto; sem cartões, diz que não há nada para os dados carregados. */
export function InsightGroup({ id, title, subtitle, children, empty }: { id: string; title: string; subtitle: string; children: ReactNode; empty?: boolean }) {
  const tr = useTr();
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
      </div>
      {empty ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
          {tr('Nothing to show here for the data loaded.', 'Nada para mostrar aqui com os dados carregados.')}
        </p>
      ) : (
        // cada cartão na altura do seu conteúdo: lado a lado, um cartão curto não estica até o tamanho do vizinho
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">{children}</div>
      )}
    </section>
  );
}

// ---------- simulador de queda do ETH ----------

/**
 * "Se o ETH cair X%": um slider de 0 a 80% (passo de 5) sobre ETH e derivados, que o teclado move com as setas,
 * Home/End e Page Up/Down. Mostra o limite estimado e a queda que levaria o emprestado ao limite, pela tabela pública
 * de parâmetros (a fonte vai no cartão). Tudo é Estimativa; a 0% o limite estimado é o informado.
 */
export function EthDropSimulator({ simulate, initial }: { simulate: (dropPct: number) => EthDropResult | null; initial: number }) {
  const tr = useTr();
  const id = useId();
  const [drop, setDrop] = useState(initial);
  const r = simulate(drop);
  const figure = 'tnum mt-0.5 font-display text-lg font-semibold tracking-tight';
  return (
    <div className="mt-3 border-t border-line pt-3">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{tr('If ETH and its derivatives fell', 'Se o ETH e derivados caíssem')}</span>
        <output htmlFor={id} className="tnum font-medium text-ink">{pct(drop)}</output>
      </label>
      {/* nativo: o teclado e o leitor de tela já sabem usar; o texto falado diz a queda, não só o número */}
      <input
        id={id}
        type="range"
        min={0}
        max={80}
        step={5}
        value={drop}
        onChange={(e) => setDrop(Number(e.target.value))}
        aria-valuetext={tr(`${pct(drop)} drop`, `queda de ${pct(drop)}`)}
        className="mt-2 h-11 w-full cursor-pointer accent-[var(--color-accent)] pointer-fine:h-6"
      />
      {r ? (
        <>
          {/* só o que muda com o controle: o limite informado, a queda que chega ao limite e o limite a 0% já são
              fatos do cartão, logo acima */}
          <dl className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-4 gap-y-3">
            <div>
              <dt className="text-xs text-faint">{nb(tr(`Estimated limit after a ${pct(drop)} drop`, `Limite estimado com queda de ${pct(drop)}`))}</dt>
              <dd className={figure}><span aria-hidden>≈{'\u00A0'}</span>{usd(r.limit)}</dd>
            </div>
            {r.borrowed > 0 ? (
              <>
                <div>
                  <dt className="text-xs text-faint">{tr('Borrowed today', 'Emprestado hoje')}</dt>
                  <dd className={figure}>{usd(r.borrowed)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">{r.limit >= r.borrowed ? tr('Room left', 'Folga') : tr('Above the estimated limit by', 'Acima do limite estimado em')}</dt>
                  <dd className={figure}><span aria-hidden>≈{'\u00A0'}</span>{usd(Math.abs(r.limit - r.borrowed))}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {/* uma frase só para o leitor de tela, a cada passo do slider (o dl visível não é anunciado inteiro) */}
          <p className="sr-only" aria-live="polite">
            {tr(
              `With a ${pct(drop)} drop, the estimated limit is about ${usd(r.limit)}, against ${usd(r.borrowed)} borrowed.`,
              `Com queda de ${pct(drop)}, o limite estimado fica em cerca de ${usd(r.limit)}, contra ${usd(r.borrowed)} emprestados.`,
            )}
          </p>
          {r.unknownAssets.length ? (
            <p className="mt-2 text-xs text-faint">
              {tr(
                `Not in the published table, so left out of the estimate: ${r.unknownAssets.join(', ')}.`,
                `Fora da tabela publicada, e por isso fora da estimativa: ${r.unknownAssets.join(', ')}.`,
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---------- números que a pessoa digita (taxa do emprestado, preço de clube) ----------

/**
 * Um número opcional que o conector não informa, digitado pela pessoa e guardado só neste navegador. Aceita vírgula ou
 * ponto, grava ao sair do campo ou no Enter; vazio ou fora da faixa apaga.
 */
function StoredNumberField({ label, hint, value, onCommit, max, prefix, suffix, placeholder }: {
  label: string;
  hint: string;
  value: number | null;
  onCommit: (n: number | null) => void;
  max: number;
  prefix?: string;
  suffix?: string;
  placeholder: string;
}) {
  const id = useId();
  const hintId = useId();
  const { locale } = useLocale();
  // a vírgula decimal em português, o ponto em inglês (os dois são aceitos ao digitar)
  const dec = (v: string) => (locale === 'pt' ? v.replace('.', ',') : v);
  const [text, setText] = useState(value === null ? '' : dec(String(value)));
  const commit = (v: string) => {
    const n = Number(v.trim().replace(',', '.'));
    onCommit(v.trim() === '' || !Number.isFinite(n) || n <= 0 || n > max ? null : Math.round(n * 100) / 100);
  };
  return (
    <div className="mt-3 border-t border-line pt-3">
      <label htmlFor={id} className="text-sm text-muted">{label}</label>
      <div className="mt-1.5 flex items-center gap-2">
        {prefix ? <span aria-hidden className="text-sm text-muted">{prefix}</span> : null}
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
          aria-describedby={hintId}
          className="tnum min-h-11 w-28 rounded-lg border border-field bg-panel2 px-3 text-base text-ink pointer-fine:sm:min-h-9 pointer-fine:sm:text-sm"
          placeholder={dec(placeholder)}
        />
        {suffix ? <span aria-hidden className="text-sm text-muted">{suffix}</span> : null}
      </div>
      <p id={hintId} className="mt-1.5 text-xs text-faint">{hint}</p>
    </div>
  );
}

/** A taxa anual que a pessoa vê no app da ether.fi: o conector não informa. Guardada só neste navegador. */
export function BorrowRateField() {
  const tr = useTr();
  const [rate, setRate] = useBorrowRate();
  return (
    <StoredNumberField
      label={tr('Your borrowing rate (optional, % a year)', 'A sua taxa do emprestado (opcional, % ao ano)')}
      hint={tr('The connector doesn’t report it: copy it from the ether.fi app. Saved in this browser only.', 'O conector não informa: copie do app da ether.fi. Fica salva só neste navegador.')}
      value={rate}
      onCommit={setRate}
      max={100}
      suffix="%"
      placeholder="4.25"
    />
  );
}

/**
 * A mensalidade de um clube (pelo id que o cartão traz em `subject`), na moeda da casa: o preço varia por pessoa e nem
 * todo clube tem preço de tabela. Guardada só neste navegador.
 */
export function ClubPriceField({ subject, currency }: { subject: string; currency: string }) {
  const tr = useTr();
  const { locale } = useLocale();
  const [prices, setPrice] = useClubPrices();
  // o símbolo da moeda da casa no idioma da tela ("R$", "€")
  const symbol = (() => {
    try {
      return new Intl.NumberFormat(locale === 'pt' ? 'pt-BR' : 'en-US', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
    } catch {
      return currency;
    }
  })();
  return (
    <StoredNumberField
      label={tr('What you pay for this club a month (optional)', 'Quanto você paga por este clube por mês (opcional)')}
      hint={tr('Copy it from the club’s page in its app. Saved in this browser only.', 'Copie da página do clube no app dele. Fica salvo só neste navegador.')}
      value={prices[subject] ?? null}
      onCommit={(n) => setPrice(subject, n)}
      max={10000}
      prefix={symbol}
      placeholder="9.90"
    />
  );
}

// ---------- abrir no Claude ----------

// as perguntas e o link vêm do motor (claudePrompts, claudeLink): genéricas, sem nenhum número, nome ou id da pessoa

function CopyButton({ text }: { text: string }) {
  const tr = useTr();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  };
  return (
    <Button variant="outline" onClick={() => void copy()} className="min-h-11 justify-center pointer-fine:sm:min-h-8">
      {done ? <Check aria-hidden className="size-4 text-good" /> : <Copy aria-hidden className="size-4" />}
      <span>{done ? tr('Copied', 'Copiado') : tr('Copy', 'Copiar')}</span>
      {/* o leitor de tela ouve a confirmação (4.1.3) */}
      <span role="status" className="sr-only">{done ? tr('Question copied', 'Pergunta copiada') : ''}</span>
    </Button>
  );
}

/**
 * "Abrir no Claude": cada pergunta pronta abre o claude.ai numa aba nova, já escrita, e "Copiar" fica sempre ao lado
 * (o parâmetro ?q= não é documentado e pode parar de funcionar). Nenhum dado da pessoa vai no link.
 */
export function OpenInClaude() {
  const tr = useTr();
  const { locale } = useLocale();
  return (
    <Panel>
      <PanelTitle>
        <span className="inline-flex items-center gap-2"><Sparkles aria-hidden className="size-3.5" /> {tr('Ask your Claude', 'Pergunte ao seu Claude')}</span>
      </PanelTitle>
      <p className="-mt-2 mb-4 max-w-3xl text-sm leading-relaxed text-muted">
        {tr(
          'Ready-made questions for Claude with the ether.fi connector connected. The link carries only the question: nothing from your account goes in it, and Claude reads your data through its own connector. Merchant names are written by the merchants, so each question asks Claude to treat them as data.',
          'Perguntas prontas para o Claude com o conector da ether.fi conectado. O link leva só a pergunta: nada da sua conta vai nele, e o Claude lê os seus dados pelo próprio conector. Nomes de estabelecimento são escritos pelos próprios estabelecimentos, então cada pergunta pede ao Claude que os trate como dados.',
        )}
      </p>
      <ul className="divide-y divide-line">
        {claudePrompts(locale).map(({ id, text: q }) => {
          return (
            <li key={id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-sm leading-relaxed text-ink">{q}</p>
              <div className="flex shrink-0 gap-2">
                <a
                  href={claudeLink(q)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink transition hover:brightness-110 active:brightness-95 pointer-fine:sm:min-h-8"
                >
                  {tr('Open in Claude', 'Abrir no Claude')}
                  <span aria-hidden>↗</span>
                  <span className="sr-only">{tr('(opens claude.ai in a new tab)', '(abre o claude.ai em outra aba)')}</span>
                </a>
                <CopyButton text={q} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-faint">
        {tr(
          'The button depends on claude.ai accepting a question in the link, which isn’t documented and may stop working. If the box opens empty, use Copy and paste it there. Claude’s answers follow its own terms; they aren’t checked by Lighthouse.',
          'O botão depende de o claude.ai aceitar a pergunta no link, o que não é documentado e pode parar de funcionar. Se a caixa abrir vazia, use Copiar e cole lá. As respostas do Claude seguem os termos dele e não são conferidas pelo Lighthouse.',
        )}
      </p>
    </Panel>
  );
}

// ---------- a aba ligada: o motor, os retratos e os grupos (este arquivo só baixa quando a pessoa liga) ----------

/** Os retratos do saldo (só neste navegador): o da importação atual e o da anterior, para "o que mudou desde então". */
const SNAPSHOTS_KEY = 'insights-snapshots';
interface Snapshots {
  current?: PortfolioSnapshot;
  previous?: PortfolioSnapshot;
}
const validateSnapshots = (raw: unknown): Snapshots | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return { current: validateSnapshot(r.current), previous: validateSnapshot(r.previous) };
};

/**
 * O retrato anterior a este carregamento. Grava o atual quando ele muda (nova importação ou leitura), empurrando o que
 * estava para "anterior". Dados fictícios (demo, arquivos de exemplo) nunca gravam: não se compara demo com conta real.
 */
function useLastSnapshot(dataset: Dataset, skip: boolean): PortfolioSnapshot | undefined {
  const current = useMemo(() => (skip ? null : makeSnapshot(dataset)), [dataset, skip]);
  const last = useMemo(() => {
    if (!current) return undefined;
    const stored = readStore<Snapshots>(SNAPSHOTS_KEY, {}, validateSnapshots);
    return stored.current && stored.current.at !== current.at ? stored.current : stored.previous;
  }, [current]);
  useEffect(() => {
    if (!current) return;
    const stored = readStore<Snapshots>(SNAPSHOTS_KEY, {}, validateSnapshots);
    if (stored.current?.at === current.at) return;
    writeStore(SNAPSHOTS_KEY, { current, previous: stored.current });
  }, [current]);
  return last;
}

/** A ligação com o motor (src/lib/insights): os cartões prontos e o simulador, puro. Só roda com a aba ligada. */
function useEngine(dataset: Dataset): { cards: InsightCardData[]; simulate: (dropPct: number) => EthDropResult | null } {
  const { isSample } = useStore();
  const { locale } = useLocale();
  const [rate] = useBorrowRate();
  const [clubPrices] = useClubPrices();
  const { report } = useSubscriptions();
  const lastSnapshot = useLastSnapshot(dataset, isSample);
  const subscriptionsMonthlyUsd = report.monthlyTotalUsd;
  // os registros do motor de assinaturas que a tela já tem (sem eles, o motor de insights calcularia de novo)
  const subscriptions = report.records;
  const cards = useMemo(
    () => buildInsights(dataset, { borrowRate: rate ?? undefined, subscriptionsMonthlyUsd, subscriptions, clubPrices, lastSnapshot }, locale),
    [dataset, rate, subscriptionsMonthlyUsd, subscriptions, clubPrices, lastSnapshot, locale],
  );
  const simulate = useCallback((dropPct: number) => simulateEthDrop(dataset, dropPct), [dataset]);
  return { cards, simulate };
}

const GROUPS: { id: Group; title: [string, string]; subtitle: [string, string] }[] = [
  {
    id: 'credit',
    title: ['Credit and yield', 'Crédito e rendimento'],
    subtitle: ['How your spending power, limit and borrowing work, with your numbers.', 'Como o seu poder de compra, o limite e o emprestado funcionam, com os seus números.'],
  },
  {
    id: 'earnings',
    title: ['What your gains paid for', 'O que os ganhos pagaram'],
    subtitle: ['Yield and cashback next to what you spend.', 'Rendimento e cashback ao lado do que você gasta.'],
  },
  {
    id: 'savings',
    title: ['Savings', 'Economia'],
    subtitle: ['What you pay, next to public prices with a date.', 'O que você paga, ao lado de preços públicos com data.'],
  },
  {
    id: 'summary',
    title: ['Period summary', 'Resumo do período'],
    subtitle: ['What moved your spending and your balance.', 'O que mexeu no seu gasto e no seu saldo.'],
  },
];

/** A aba ligada: os grupos de cartões, o simulador e a taxa dentro do cartão de crédito, e as perguntas para o Claude. */
export function InsightsOn() {
  const { dataset } = useStore();
  const tr = useTr();
  const { cards, simulate } = useEngine(dataset);
  const txById = useMemo(() => new Map<string, Transaction>(dataset.transactions.map((t) => [t.id, t])), [dataset.transactions]);
  const interactive = (card: InsightCardData) =>
    card.interactive === 'eth-drop' ? <EthDropSimulator simulate={simulate} initial={DEFAULT_ETH_DROP} />
      : card.interactive === 'borrow-rate' ? <BorrowRateField />
        : card.interactive === 'club-price' && card.subject ? <ClubPriceField subject={card.subject} currency={dataset.homeCurrency ?? 'USD'} />
        : null;
  return (
    <>
      {GROUPS.map((g) => {
        const list = cards.filter((c) => c.group === g.id);
        return (
          <InsightGroup key={g.id} id={`insights-${g.id}`} title={tr(...g.title)} subtitle={tr(...g.subtitle)} empty={!list.length}>
            {list.map((c) => <InsightCard key={c.id} card={c} txById={txById}>{interactive(c)}</InsightCard>)}
          </InsightGroup>
        );
      })}
      <OpenInClaude />
      <p className="flex items-start gap-2 text-xs text-faint">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {tr(
          'Calculated in this browser from the data loaded; nothing leaves it. Information and scenarios, not financial advice: check any number in the ether.fi app before acting on it.',
          'Calculado neste navegador com os dados carregados; nada sai dele. Informação e cenário, não conselho financeiro: confira qualquer número no app da ether.fi antes de agir.',
        )}
      </p>
    </>
  );
}
