import { useMemo, useState } from 'react';
import {
  ArrowRight, CalendarClock, Coins, PiggyBank, Plane, Repeat, RotateCcw, Sparkles, TrendingUp, TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { isFullMonth } from '../lib/analytics';
import type { Anomaly, MonthEvent, MonthEventKind, MonthEvolution } from '../lib/analytics';
import { dateFull, dateShort, daysAgo, monthLabelLong, monthName, nb, num, pct, pctSigned, usd, usd0, usdAxis } from '../lib/format';
import { categoryLabel } from '../lib/merchants';
import { categoryColor } from '../lib/categoryColors';
import { recurringMonthlyAt } from '../lib/subscriptions';
import type { RecurringView } from '../lib/subscriptionTypes';
import type { Locale } from '../lib/locale';
import type { Dataset, Transaction } from '../lib/types';
import { KEYS, readStore, writeStore } from '../lib/storage';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { newSubscriptionsIn, useSpendAnalyses } from '../state/analyses';
import { Empty, Panel, PanelTitle, Stat } from '../components/ui';
import { BarChart, HBars } from '../components/charts';
import { monthCategoryStacks } from '../components/spendStacks';
import {
  DeltaPill, EventChip, EventIcon, EVENT_KINDS, EvoBars, EvoMonthChips, isPartialMonth, PartialSwatch, ProjectionSwatch,
} from '../components/evo';
import { tripPlace } from './Trips';
import { cx } from '../lib/cx';
import { VIEW_SLUG } from '../lib/nav';

type Tr = ReturnType<typeof useTr>;

interface Rationale {
  icon: ReactNode;
  tone: string;
  lead: string;
  body: string;
  /** link no fim do texto (ex.: os alertas do mês no Início) */
  link?: { href: string; label: string };
}

/** O que as frases precisam saber além do mês: nada aqui é afirmado sem ter sido calculado. */
interface Ctx {
  tr: Tr;
  locale: Locale;
  dataset: Dataset;
  txById: Map<string, Transaction>;
  recurring: RecurringView;
  /** Meses inteiros sem estorno grande (os únicos comparáveis), sem o mês em foco */
  peers: MonthEvolution[];
  /** Primeiro mês da série: não dá para dizer que uma assinatura é "nova" nele */
  isFirst: boolean;
  prev?: MonthEvolution;
  prevLabel?: string;
}

// o nome do mês abre frase: "Outubro já tem…" (em pt o Intl devolve minúsculo)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Mês a mês dentro de Gastos: os meses que o histórico carregado cobre (o primeiro, se começar no meio, hachurado). */
export function EvolutionSection({ onOpenMonth }: { onOpenMonth?: (month: string) => void }) {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  const { months: all, recurring } = useSpendAnalyses();
  // mês sem histórico antigo carregado fica fora; o mês em que o histórico começa entra, marcado como parcial
  const months = useMemo(() => all.filter((m) => m.covered || m.startsMidMonth), [all]);
  const txById = useMemo(() => new Map(dataset.transactions.map((t) => [t.id, t])), [dataset]);

  const lastComplete = months.filter(isFullMonth).at(-1)?.month;
  const [selected, setSelected] = useState<string>(() => {
    const saved = readStore(KEYS.evoMonth, '', (v) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? v : undefined));
    return saved && months.some((m) => m.month === saved) ? saved : (lastComplete ?? months.at(-1)?.month ?? '');
  });
  const rawIdx = months.findIndex((m) => m.month === selected);
  const idx = rawIdx === -1 ? months.length - 1 : rawIdx;
  const ev = months[idx];
  const prev = idx > 0 ? months[idx - 1] : undefined;

  const select = (m: string) => {
    setSelected(m);
    writeStore(KEYS.evoMonth, m);
  };

  // média e recorde só entre meses inteiros e sem estorno que desfaça o mês
  const comparable = useMemo(() => months.filter((m) => isFullMonth(m) && !m.refundHeavy), [months]);
  const totals = useMemo(() => {
    const totalAll = months.reduce((s, m) => s + m.total, 0);
    const avg = comparable.length ? comparable.reduce((s, m) => s + m.total, 0) / comparable.length : null;
    const record = comparable.length ? comparable.reduce((a, b) => (b.total > a.total ? b : a)) : null;
    const cashbackTotal = months.reduce((s, m) => s + m.cashback, 0);
    return { totalAll, avg, record, cashbackTotal };
  }, [months, comparable]);

  const monthEvents = useMemo(
    () => months.map((m, i) => eventsFor(m, { tr, locale, recurring, isFirst: i === 0 })),
    [months, tr, locale, recurring],
  );
  // cada mês empilhado por categoria, do mesmo byCategory do detalhe do mês (nas cores de "Por categoria")
  const stacks = useMemo(() => monthCategoryStacks(months, locale), [months, locale]);

  if (!ev) {
    return <Empty title={tr('Nothing to compare yet: connect an account with transactions.', 'Nenhuma evolução ainda: conecte uma conta com transações.')} />;
  }

  const prevLabel = prev ? monthName(prev.month) : undefined;
  const ctx: Ctx = {
    tr, locale, dataset, txById, recurring, isFirst: idx === 0, prev, prevLabel,
    peers: comparable.filter((m) => m.month !== ev.month),
  };
  const rationales = buildRationales(ev, ctx);
  const evEvents = monthEvents[idx] ?? [];
  // a legenda sai dos eventos que de fato aparecem nas barras (até 3 por mês)
  const shownKinds = new Set(monthEvents.flatMap((list) => list.slice(0, 3).map((e) => e.kind)));
  const legendKinds = EVENT_KINDS.filter((k) => shownKinds.has(k));
  const hasUrgent = monthEvents.some((list) => list.slice(0, 3).some((e) => e.tone === 'bad'));
  const hasExplained = months.some((m) => m.deltaExplained && m.deltaPct != null);
  const hasDelta = months.some((m) => m.deltaPct != null && !m.partial);
  const hasPartial = months.some(isPartialMonth);
  const projected = months.find((m) => m.partial && m.projected);

  // dias de fato cobertos: no mês corrente até agora; no mês em que o histórico começa, a partir do primeiro dia
  const startDay = ev.startsMidMonth && dataset.coverage ? Number(dataset.coverage.from.slice(8, 10)) : 1;
  const days = Math.max(1, (ev.partial ? ev.elapsed : ev.daysInMonth) - (startDay - 1));
  const dayAvg = ev.total > 0 ? ev.total / days : 0;
  // a grade inteira em dólares inteiros, por extenso (nada de "k" ao lado de "US$ 2.401"); no celular os números
  // dividem a linha em dois e o valor encolhe um pouco para caber
  const kpi = (v: string) => <span className="text-lg sm:text-2xl">{v}</span>;
  // o mês corrente não se compara pelo parcial (engana); a comparação dele é pela projeção, no texto abaixo
  const delta = ev.partial ? null : ev.deltaPct;
  const purchases = ev.count === 1 ? tr('1 purchase', '1 compra') : tr(`${num(ev.count, 0)} purchases`, `${num(ev.count, 0)} compras`);
  const navBtn = 'min-h-11 cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:bg-panel2 hover:text-ink disabled:cursor-default disabled:opacity-40 lg:min-h-0 lg:px-2.5';

  return (
    <div className="space-y-5">
      <div className={cx('grid grid-cols-2 gap-3 sm:gap-4 [&>*:nth-child(3):last-child]:col-span-2 lg:[&>*:nth-child(3):last-child]:col-span-1', totals.cashbackTotal > 0 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        <Stat
          label={months.length === 1 ? tr('Total (1 month)', 'Total (1 mês)') : tr(`Total (${months.length} months)`, `Total (${months.length} meses)`)}
          value={kpi(usd0(totals.totalAll))}
          sub={tr('all spending combined', 'somando todos os gastos')}
        />
        <Stat
          label={tr('Monthly average', 'Média mensal')}
          value={kpi(totals.avg != null ? usd0(totals.avg) : '—')}
          sub={comparable.length ? nb(tr(`${comparable.length} full months`, `${comparable.length} meses inteiros`)) : tr('no full month to average', 'sem mês inteiro para a média')}
        />
        <Stat
          label={tr('Record month', 'Mês recorde')}
          value={kpi(totals.record ? usd0(totals.record.total) : '—')}
          sub={totals.record ? monthLabelLong(`${totals.record.month}-01`) : tr('among full months', 'entre meses inteiros')}
        />
        {totals.cashbackTotal > 0 ? (
          <Stat label={tr('Total cashback', 'Cashback acumulado')} value={kpi(usd0(totals.cashbackTotal))} tone="good" sub={tr('since the first month', 'desde o primeiro mês')} />
        ) : null}
      </div>

      <Panel>
        <PanelTitle hint={tr('pick a month', 'escolha um mês')}>{tr('Spending per month', 'Gasto por mês')}</PanelTitle>
        <EvoMonthChips data={months} selected={ev.month} onSelect={select} />
        <div className="hidden lg:block">
          <EvoBars data={months} selected={ev.month} onSelect={select} events={monthEvents} stacks={stacks} />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted pointer-fine:text-[11px]">
            {hasPartial ? <span className="inline-flex items-center gap-1.5"><PartialSwatch /> {tr('partial month', 'mês parcial')}</span> : null}
            {projected ? <span className="inline-flex items-center gap-1.5"><ProjectionSwatch /> {tr('projection to the end of the month', 'projeção até o fim do mês')}</span> : null}
            {legendKinds.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5"><EventIcon kind={k} /> {eventKindLabel(k, tr)}</span>
            ))}
            {hasUrgent ? (
              <span className="inline-flex items-center gap-1.5"><EventIcon kind="anomalies" urgent /> {tr('urgent: check now', 'urgente: confira agora')}</span>
            ) : null}
            {hasDelta ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-warn">↗</span>/<span className="text-good">↘</span> {tr('vs the month before (full months only)', 'vs o mês anterior (só meses inteiros)')}
              </span>
            ) : null}
            {hasExplained ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted">↗ %</span> {tr('gray: explained by a trip or a one-off purchase', 'cinza: explicado por viagem ou compra avulsa')}
              </span>
            ) : null}
          </div>
        </div>
        {/* celular: os chips dão o nome do mês e a variação fica no detalhe abaixo; as barras só mostram a forma */}
        <div className="mt-3 lg:hidden">
          <EvoBars data={months} selected={ev.month} onSelect={select} height={96} compact stacks={stacks} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0" aria-live="polite">
                <h3 className="text-[13px] font-medium uppercase tracking-[0.14em] text-muted">
                  {monthLabelLong(`${ev.month}-01`)}
                  {ev.partial ? (
                    <span className="ml-2 normal-case tracking-normal text-faint">
                      {tr(`partial, ${ev.daysElapsed} of ${ev.daysInMonth} days`, `parcial, ${ev.daysElapsed} de ${ev.daysInMonth} dias`)}
                    </span>
                  ) : ev.startsMidMonth && dataset.coverage ? (
                    <span className="ml-2 normal-case tracking-normal text-faint">
                      {dataset.coverage.complete
                        ? tr(`partial · account opened on ${dateShort(dataset.coverage.from)}`, `parcial · conta aberta em ${dateShort(dataset.coverage.from)}`)
                        : tr(`partial · history starts ${dateShort(dataset.coverage.from)}`, `parcial · o histórico começa em ${dateShort(dataset.coverage.from)}`)}
                    </span>
                  ) : null}
                </h3>
                <div className="tnum mt-1 font-display text-3xl font-semibold tracking-tight">{usd(ev.total)}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted">
                  {ev.refundHeavy ? (
                    // estorno grande: o líquido engana, então bruto e estornos lado a lado, sem %
                    <span className="tnum">
                      {tr(`purchases ${usd(ev.gross)} · refunds −${usd(ev.refunds)}`, `compras ${usd(ev.gross)} · estornos −${usd(ev.refunds)}`)}
                    </span>
                  ) : delta != null ? (
                    <DeltaPill pct={delta} compareLabel={prevLabel} muted={ev.deltaExplained} />
                  ) : null}
                  {ev.refundHeavy || delta != null ? <span aria-hidden="true">{'\u00a0· '}</span> : null}
                  <span className="whitespace-nowrap">{purchases}</span>
                  {ev.projected ? (
                    <>
                      <span aria-hidden="true">{'\u00a0· '}</span>
                      <span className="text-faint">{nb(tr(`projection for the month: ~${usdAxis(ev.projected)}`, `projeção do mês: ~${usdAxis(ev.projected)}`))}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => select(months[Math.max(0, idx - 1)].month)} disabled={idx <= 0} className={navBtn}>
                  {tr('← previous', '← anterior')}
                </button>
                <button onClick={() => select(months[Math.min(months.length - 1, idx + 1)].month)} disabled={idx >= months.length - 1} className={navBtn}>
                  {tr('next →', 'próximo →')}
                </button>
              </div>
            </div>

            {rationales.length ? (
              <div className="mt-4 space-y-3">
                {rationales.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-panel2/40 p-3.5">
                    <span className={cx('mt-0.5 shrink-0', r.tone)} aria-hidden="true">{r.icon}</span>
                    <p className="text-sm leading-relaxed text-muted">
                      <span className="font-medium text-ink">{nb(r.lead)}</span> {nb(r.body)}
                      {r.link ? (
                        <>
                          {' '}
                          {/* sublinhado: no meio do texto, link não pode ser só cor; a última palavra vai presa à seta */}
                          <a href={r.link.href} className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
                            {r.link.label.slice(0, r.link.label.lastIndexOf(' ') + 1)}
                            <span className="whitespace-nowrap">
                              {r.link.label.slice(r.link.label.lastIndexOf(' ') + 1)}
                              <ArrowRight className="ml-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
                            </span>
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{tr('Spending per day', 'Gasto por dia')}</div>
                <BarChart
                  data={ev.byDay.map((d) => ({ label: dateShort(`${d.day}T12:00:00Z`), value: d.total }))}
                  height={110}
                  average={dayAvg > 0 ? { value: dayAvg, label: tr(`avg ${usd(dayAvg)}/day`, `média ${usd(dayAvg)}/dia`) } : undefined}
                  ariaLabel={tr(`Spending per day in ${monthLabelLong(ev.month + '-01')}`, `Gasto por dia em ${monthLabelLong(ev.month + '-01')}`)}
                  table={[tr('Day', 'Dia'), tr('Spent', 'Gasto')]}
                  axis={ev.byDay.length ? [dateShort(`${ev.byDay[0].day}T12:00:00Z`), dateShort(`${ev.byDay[ev.byDay.length - 1].day}T12:00:00Z`)] : undefined}
                />
              </div>
              <div>
                <div className="mb-2 text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{tr('By category', 'Por categoria')}</div>
                {ev.byCategory.length ? (
                  <HBars data={ev.byCategory.slice(0, 5).map((c) => ({ label: categoryLabel(c.name, locale), value: c.total, color: categoryColor(c.name) }))} />
                ) : (
                  <div className="py-6 text-center text-sm text-faint">{tr('No purchases this month', 'Sem compras no mês')}</div>
                )}
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelTitle>{tr('What stood out', 'Marcou o mês')}</PanelTitle>
            <div className="flex flex-wrap gap-1.5">
              {evEvents.map((e, i) => <EventChip key={`${e.kind}-${i}`} event={{ ...e, label: nb(e.label) }} />)}
              {evEvents.length === 0 ? <span className="text-sm text-faint">{tr('No events this month: business as usual.', 'Mês sem eventos: rotina.')}</span> : null}
            </div>
            {ev.cashbackIsRecord ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <Coins className="size-3.5 text-good" aria-hidden="true" />
                {tr('cashback this month:', 'cashback do mês:')} <span className="tnum text-ink">{usd(ev.cashback)}</span>
              </div>
            ) : null}
          </Panel>

          <Panel>
            <PanelTitle hint={tr('largest this month', 'maiores do mês')}>{tr('Notable transactions', 'Transações marcantes')}</PanelTitle>
            {ev.topTx.length ? (
              <ul className="divide-y divide-line">
                {ev.topTx.slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{t.merchant ?? '—'}</div>
                      <div className="text-xs text-faint">{nb(`${dateShort(t.date)}${t.city ? ` · ${t.city}` : ''}`)}</div>
                    </div>
                    <div className="tnum">{usd(t.amountUsd)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-6 text-center text-sm text-faint">{tr('No purchases this month', 'Sem compras no mês')}</div>
            )}
            {onOpenMonth && ev.count > 0 ? (
              <button
                onClick={() => onOpenMonth(ev.month)}
                className="tap mt-3 inline-flex min-h-6 cursor-pointer items-center gap-1.5 text-xs text-accent transition-colors hover:brightness-110"
              >
                {tr(`See ${monthName(ev.month)} transactions`, `Ver transações de ${monthName(ev.month)}`)} <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </Panel>

          {months.length < 2 ? (
            <Panel>
              <div className="flex items-start gap-2.5 text-xs text-muted">
                <TrendingUp className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
                {tr(
                  'With more months connected, the trend gets context: changes, records and recurring charges.',
                  'Com mais meses conectados, a evolução ganha contexto: variações, recordes e recorrências.',
                )}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function eventKindLabel(kind: MonthEventKind, tr: Tr): string {
  switch (kind) {
    case 'trip': return tr('trip', 'viagem');
    case 'new_sub': return tr('new subscription', 'nova assinatura');
    case 'one_off_big': return tr('big one-off purchase', 'compra avulsa grande');
    case 'anomalies': return tr('charges to review', 'cobranças para revisar');
    case 'borrow': return tr('loan taken', 'empréstimo');
    case 'repayment': return tr('loan repaid', 'empréstimo pago');
    case 'record_cashback': return tr('record cashback', 'recorde de cashback');
  }
}

/** Quanto custa por mês, quando se sabe: "US$ 20/mês" ou "≈ US$ 20/mês" (cobrança por uso); vazio sem ciclo */
function perMonth(monthlyUsd: number, approx: boolean, tr: Tr): string {
  if (!monthlyUsd) return '';
  return `${approx ? '≈ ' : ''}${usd(monthlyUsd)}${tr('/mo', '/mês')}`;
}

function eventsFor(ev: MonthEvolution, ctx: Pick<Ctx, 'tr' | 'locale' | 'recurring' | 'isFirst'>): MonthEvent[] {
  const { tr, locale } = ctx;
  const out: MonthEvent[] = [];
  if (ev.trip) {
    const label = ev.trip.cities.length > 2
      ? tr(`Trip · ${ev.trip.cities.length} cities`, `Viagem · ${ev.trip.cities.length} cidades`)
      : tr(`Trip · ${tripPlace(ev.trip, locale)}`, `Viagem · ${tripPlace(ev.trip, locale)}`);
    out.push({ kind: 'trip', label: `${label} · ${usd(ev.trip.total)}`, tone: 'accent' });
  }
  // o mês a mês só recebe alertas de compras (depósito a confirmar não é "cobrança para revisar")
  if (ev.anomalies.length) {
    const n = chargesIn(ev.anomalies);
    out.push({
      kind: 'anomalies',
      label: n === 1 ? tr('1 charge to review', '1 cobrança para revisar') : tr(`${n} charges to review`, `${n} cobranças para revisar`),
      tone: ev.anomalies.some((a) => a.urgent) ? 'bad' : 'warn',
    });
  }
  if (ev.borrow > 0) {
    out.push({ kind: 'borrow', label: tr(`Borrowed · ${usd(ev.borrow)}`, `Empréstimo · ${usd(ev.borrow)}`), tone: 'info' });
  }
  if (ev.repayment > 0) {
    out.push({ kind: 'repayment', label: tr(`Repaid loan · ${usd(ev.repayment)}`, `Pagou empréstimo · ${usd(ev.repayment)}`), tone: 'good' });
  }
  // no primeiro mês carregado tudo seria "novo": sem histórico antes, não dá para afirmar
  if (!ctx.isFirst) {
    for (const s of newSubscriptionsIn(ctx.recurring, ev.month)) {
      out.push({ kind: 'new_sub', label: tr(`New subscription · ${s.name}`, `Nova assinatura · ${s.name}`), tone: 'info' });
    }
  }
  if (ev.cashbackIsRecord) {
    out.push({ kind: 'record_cashback', label: tr(`Record cashback · ${usd(ev.cashback)}`, `Recorde de cashback · ${usd(ev.cashback)}`), tone: 'good' });
  }
  for (const t of ev.oneOffBig.slice(0, 2)) {
    out.push({ kind: 'one_off_big', label: `${t.merchant} · ${usd(t.amountUsd)}`, tone: 'warn' });
  }
  return out;
}

function buildRationales(ev: MonthEvolution, ctx: Ctx): Rationale[] {
  const { tr, locale, dataset, prev, prevLabel, peers } = ctx;
  const out: Rationale[] = [];
  const month = monthName(ev.month);
  // o parcial do mês corrente não se compara com um mês inteiro
  const delta = ev.partial ? null : ev.deltaPct;

  if (ev.anomalies.length) {
    // vermelho só para o que não pode esperar (cobrança repetida ainda a confirmar); o resto é "confira", em âmbar
    const urgent = ev.anomalies.some((a) => a.urgent);
    const n = chargesIn(ev.anomalies);
    out.push({
      icon: <TriangleAlert className="size-4" />,
      tone: urgent ? 'text-bad' : 'text-warn',
      lead: n === 1
        ? tr(`${cap(month)} has 1 charge to review:`, `${cap(month)} tem 1 cobrança para revisar:`)
        : tr(`${cap(month)} has ${n} charges to review:`, `${cap(month)} tem ${n} cobranças para revisar:`),
      body: anomalySentences(ev.anomalies.slice(0, 4), ctx),
      // o "Precisa de atenção" mostra só os últimos 30 dias; "alerts:AAAA-MM" abre a lista nos alertas deste mês
      link: {
        href: `#/${VIEW_SLUG.spending}?item=${encodeURIComponent(`alerts:${ev.month}`)}`,
        label: tr('See them in Needs attention', 'Ver em Precisa de atenção'),
      },
    });
  }

  if (ev.refundHeavy) {
    out.push({
      icon: <RotateCcw className="size-4" />,
      tone: 'text-info',
      lead: tr(`Refunds reshape ${month}: ${usd(ev.gross)} in purchases and −${usd(ev.refunds)} back.`, `Estornos mudam ${month}: ${usd(ev.gross)} em compras e −${usd(ev.refunds)} de volta.`),
      body: tr(
        `The net (${usd(ev.total)}) doesn't describe how much was spent, so this month isn't compared in % with others.`,
        `O líquido (${usd(ev.total)}) não diz quanto se gastou, então este mês não é comparado em % com os outros.`,
      ),
    });
  }

  if (ev.startsMidMonth && dataset.coverage) {
    out.push({
      icon: <CalendarClock className="size-4" />,
      tone: 'text-muted',
      lead: dataset.coverage.complete
        ? tr(`The account opened on ${dateFull(dataset.coverage.from)}.`, `A conta abriu em ${dateFull(dataset.coverage.from)}.`)
        : tr(`History starts on ${dateFull(dataset.coverage.from)}.`, `O histórico começa em ${dateFull(dataset.coverage.from)}.`),
      body: tr(
        `${cap(month)} only has part of its days, so it's shown hatched and left out of averages, records and comparisons.`,
        `${cap(month)} só tem parte dos dias: aparece hachurado e fica fora de médias, recordes e comparações.`,
      ),
    });
  }

  if (ev.trip && ev.trip.total > 0 && ev.total > 0) {
    const tripAmt = ev.trip.totalInMonth > 0 ? ev.trip.totalInMonth : ev.trip.total;
    const share = Math.min(100, Math.round((tripAmt / ev.total) * 100));
    const place = tripPlace(ev.trip, locale);
    const name = ev.trip.cities.length === 1
      ? tr(`the trip to ${place}`, `a viagem para ${place}`)
      : tr(`the trip (${place})`, `a viagem (${place})`);
    const outside = Math.max(0, Math.round((ev.total - tripAmt) * 100) / 100);
    // "mês normal" = a mediana dos meses inteiros sem viagem; "na linha" só dentro de ±20% dela (D2)
    const normal = median(peers.filter((m) => !m.trip).map((m) => m.total));
    const vsNormal = normal == null || normal <= 0 || ev.rowsMissing ? ''
      : Math.abs(outside - normal) / normal <= 0.2
        ? tr(`, in line with a typical month (~${usd(normal)})`, `, na linha de um mês típico (~${usd(normal)})`)
        : outside < normal
          ? tr(`, below a typical month (~${usd(normal)})`, `, abaixo de um mês típico (~${usd(normal)})`)
          : tr(`, above a typical month (~${usd(normal)})`, `, acima de um mês típico (~${usd(normal)})`);
    const move = delta == null ? '' : delta > 0 ? tr('went up', 'subiu') : delta < 0 ? tr('went down', 'caiu') : tr('held at', 'ficou em');
    out.push({
      icon: <Plane className="size-4" />,
      tone: 'text-accent',
      lead: delta != null && prevLabel
        ? tr(
            `Spending ${move} ${pctSigned(delta)} vs ${prevLabel}: ${name} accounts for ${usd(tripAmt)} (${share}%) of the total.`,
            `O gasto ${move} ${pctSigned(delta)} vs ${prevLabel}: ${name} explica ${usd(tripAmt)} (${share}%) do total.`,
          )
        : share >= 50
          ? tr(`${cap(name)} dominates the month: ${usd(tripAmt)} (${share}% of the total).`, `${cap(name)} domina o mês: ${usd(tripAmt)} (${share}% do total).`)
          : tr(`${cap(name)} accounts for ${usd(tripAmt)} (${share}% of the total).`, `${cap(name)} explica ${usd(tripAmt)} (${share}% do total).`),
      body: tr(`Outside the trip, ${cap(month)} came to ${usd(outside)}${vsNormal}.`, `Fora da viagem, ${month} ficou em ${usd(outside)}${vsNormal}.`),
    });
  }

  if (ev.borrow > 0) {
    const isFirst = ev.borrowedEnd - ev.borrow <= 0.01;
    const limit = dataset.account.creditLimit;
    const util = limit > 0 ? Math.max(0, (ev.borrowedEnd / limit) * 100) : null;
    const end = usd(Math.max(0, ev.borrowedEnd));
    const ofLimit = util != null ? tr(` (${pct(util, 1)} of the limit)`, ` (${pct(util, 1)} do limite)`) : '';
    out.push({
      icon: <PiggyBank className="size-4" />,
      tone: 'text-info',
      lead: isFirst
        ? tr(`First loan on the account: ${usd(ev.borrow)} against your collateral.`, `Primeiro empréstimo da conta: ${usd(ev.borrow)} com os seus ativos de garantia.`)
        : tr(`New loan of ${usd(ev.borrow)} against your collateral.`, `Novo empréstimo de ${usd(ev.borrow)} com os seus ativos de garantia.`),
      body: ev.repayment
        ? tr(
            `After the ${usd(ev.repayment)} repayment, the borrowed balance ends at ${end}${ofLimit}.`,
            `Com o pagamento de ${usd(ev.repayment)}, o saldo emprestado fecha em ${end}${ofLimit}.`,
          )
        : tr(`The borrowed balance ends at ${end}${ofLimit}.`, `O saldo emprestado fecha em ${end}${ofLimit}.`),
    });
  }

  // assinaturas: a mesma lista e o mesmo custo por mês da aba Assinaturas (D12)
  const newSubs = ctx.isFirst ? [] : newSubscriptionsIn(ctx.recurring, ev.month);
  if (newSubs.length) {
    const [first, ...rest] = newSubs;
    const cost = perMonth(first.monthlyUsd, first.approx, tr);
    const fixed = recurringMonthlyAt(ctx.recurring, ev.month, dataset.referenceDate);
    const fixedText = fixed.totalUsd > 0
      ? tr(
          ` Subscriptions now add up to ${fixed.approx ? '≈ ' : ''}${usd(fixed.totalUsd)}/mo.`,
          ` As assinaturas passam a somar ${fixed.approx ? '≈ ' : ''}${usd(fixed.totalUsd)}/mês.`,
        )
      : '';
    out.push({
      icon: <Repeat className="size-4" />,
      tone: 'text-info',
      lead: tr(
        `${first.name} started in ${cap(month)}${cost ? `: ${cost}` : ''}.`,
        `${first.name} começou em ${month}${cost ? `: ${cost}` : ''}.`,
      ),
      body: `${rest.length ? tr(`Also new: ${rest.map((s) => s.name).join(', ')}.`, `Também começaram: ${rest.map((s) => s.name).join(', ')}.`) : ''}${fixedText}`.trim(),
    });
  }

  if (ev.cashbackIsRecord && ev.cashback > 0) {
    out.push({
      icon: <Coins className="size-4" />,
      tone: 'text-good',
      lead: tr(`Record cashback: ${usd(ev.cashback)} in ${cap(month)}.`, `Recorde de cashback: ${usd(ev.cashback)} em ${month}.`),
      body: tr('Cashback follows card spending, and it was a busy month.', 'O cashback acompanha o gasto do cartão, e o mês foi movimentado.'),
    });
  }

  if (ev.partial && ev.projected) {
    // compara a projeção só com um mês anterior inteiro e sem estorno grande
    const base = prev && isFullMonth(prev) && !prev.refundHeavy ? prev : undefined;
    const vs = base?.total ? pctSigned(((ev.projected - base.total) / base.total) * 100) : null;
    out.push({
      icon: <Sparkles className="size-4" />,
      tone: 'text-accent',
      lead: tr(`At the current pace, ${cap(month)} ends at ~${usd(ev.projected)}.`, `No ritmo atual, ${month} fecha em ~${usd(ev.projected)}.`),
      body: tr(
        `Simple projection: ${usd(ev.total)} in ${num(ev.elapsed, 1)} days, the same pace until day ${ev.daysInMonth}.${vs ? ` That would be ${vs} vs ${prevLabel}.` : ''}`,
        `Projeção simples: ${usd(ev.total)} em ${num(ev.elapsed, 1)} dias, no mesmo ritmo até o dia ${ev.daysInMonth}.${vs ? ` Ficaria ${vs} em relação a ${prevLabel}.` : ''}`,
      ),
    });
  }

  if (out.length === 0 && delta != null && delta <= 0) {
    // "um dos mais baratos" só quando o mês está no terço inferior dos meses comparáveis (D2)
    const all = [...peers, ev].sort((a, b) => a.total - b.total);
    const rank = all.findIndex((m) => m.month === ev.month);
    const cheap = all.length >= 3 && rank < Math.ceil(all.length / 3);
    out.push({
      icon: <Sparkles className="size-4" />,
      tone: 'text-muted',
      lead: delta === 0
        ? tr(`${cap(month)} held steady with nothing new behind it.`, `${cap(month)} ficou estável, sem novidade por trás.`)
        : tr(`${cap(month)} dropped ${pctSigned(delta)} with nothing new behind it.`, `${cap(month)} caiu ${pctSigned(delta)} sem novidade por trás.`),
      body: cheap
        ? tr(
            `No trip, no big purchase, just routine. It's one of the cheapest months in the series (${rank + 1} of ${all.length}).`,
            `Sem viagem, sem compra grande, rotina normal. É um dos meses mais baratos da série (${rank + 1}º de ${all.length}).`,
          )
        : tr('No trip, no big purchase, just routine.', 'Sem viagem, sem compra grande, rotina normal.'),
    });
  }

  return out.slice(0, 4);
}

/** Cobranças por trás dos alertas (um alerta de duplicata ou de "lugares novos" junta várias), sem repetir */
const chargesIn = (list: Anomaly[]) => new Set(list.flatMap((a) => a.relatedIds)).size;

/** "menos de um minuto", "12 minutos", "2,5 horas": o intervalo real entre a primeira e a última cobrança */
function spanText(minutes: number, tr: Tr): string {
  const m = Math.round(minutes);
  if (m < 1) return tr('less than a minute', 'menos de um minuto');
  if (m === 1) return tr('1 minute', '1 minuto');
  if (m < 90) return tr(`${m} minutes`, `${m} minutos`);
  const h = num(m / 60, 1);
  return tr(`${h} hours`, `${h} horas`);
}

/** As frases dos alertas do mês, pelo tipo e pelo que de fato aconteceu (D23); "primeira vez" vira uma frase só. */
function anomalySentences(list: Anomaly[], ctx: Ctx): string {
  const { tr, txById, dataset } = ctx;
  const out: string[] = [];
  const firsts: string[] = [];
  for (const a of list) {
    switch (a.kind) {
      case 'duplicate': {
        const times = a.relatedIds.map((id) => txById.get(id)?.date).filter((d): d is string => Boolean(d)).map((d) => Date.parse(d));
        const span = times.length > 1 ? spanText((Math.max(...times) - Math.min(...times)) / 60000, tr) : null;
        const n = a.relatedIds.length;
        out.push(n === 2
          ? tr(
              `${a.merchant} charged the same amount twice${span ? `, ${span} apart` : ''}.`,
              `${a.merchant} cobrou o mesmo valor duas vezes${span ? `, com ${span} de intervalo` : ''}.`,
            )
          : tr(
              `${a.merchant} charged the same amount ${n} times${span ? ` within ${span}` : ''}.`,
              `${a.merchant} cobrou o mesmo valor ${n} vezes${span ? ` em ${span}` : ''}.`,
            ));
        break;
      }
      case 'unusually_large':
        out.push(tr(`${a.merchant} charged far more than you usually spend there.`, `${a.merchant} cobrou muito mais do que você costuma gastar ali.`));
        break;
      case 'first_time':
        firsts.push(a.merchant);
        break;
      case 'stuck_pending': {
        const days = daysAgo(a.date, `${dataset.referenceDate}T23:59:59Z`);
        out.push(tr(
          `${usd(a.amountUsd)} at ${a.merchant} has been pending for ${days} days.`,
          `${usd(a.amountUsd)} em ${a.merchant} está a confirmar há ${days} dias.`,
        ));
        break;
      }
    }
  }
  if (firsts.length) {
    const names = firsts.join(tr(' and ', ' e '));
    out.push(firsts.length === 1 && !/,| and | e /.test(firsts[0])
      ? tr(`${names} showed up for the first time in your history.`, `${names} apareceu pela primeira vez no histórico.`)
      : tr(`${names} showed up for the first time in your history.`, `${names} apareceram pela primeira vez no histórico.`));
  }
  return out.join(' ');
}
