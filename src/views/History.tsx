import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ArrowDown, CircleAlert, Search, X } from 'lucide-react';
import { fxSummary, homeTotal } from '../lib/analytics';
import { purchaseHistory, type HistoryGroup } from '../lib/history';
import { CATEGORY, categoryLabel } from '../lib/merchants';
import { categoryColor, hasCategoryColor } from '../lib/categoryColors';
import { dateFull, dateShort, money, monthLabelLong, num, pct, timeOnly, tzLabel, usd, usd0 } from '../lib/format';
import { LOCALES, type Locale } from '../lib/locale';
import type { Transaction } from '../lib/types';
import { cx } from '../lib/cx';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { Badge, Empty, Panel, PanelTitle, Segmented, Stat, Why } from '../components/ui';
import { TxRow } from '../components/txrow';
import { TxAmount, TxBadges } from '../components/money';
import { AsTable } from '../components/charts';
import { DroppedRowsNote } from '../components/coverageNote';
import { useMedia } from '../components/useMedia';
import {
  Heatmap, hourRange, monthStacks, RankBars, StackedMonthBars, Swatch, WEEK_ORDER, weekdayLong, type HeatMetric, type RankRow,
} from '../components/historyCharts';

const PAGE = 50;
const TOP_WHO = 10;
/** No celular, "ver mais" de 20 em 20 em vez de uma lista inteira rolando dentro do painel */
const WHO_STEP = 20;

// mesmas chaves de agrupamento de purchaseHistory: o filtro bate com o ranking
const categoryOf = (t: Transaction) => t.category ?? CATEGORY.other;
const brandOf = (t: Transaction) => t.brand ?? t.merchant ?? '—';
const merchantOf = (t: Transaction) => t.merchant ?? '—';
const monthOf = (t: Transaction) => t.date.slice(0, 7);

/** Busca sem acento e sem caixa: "cafe" acha "Café" */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const plural = (n: number, one: string, many: string) => `${num(n, 0)}\u00a0${n === 1 ? one : many}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const BANDS: { label: Record<Locale, string>; from: number; to: number }[] = [
  { label: { en: 'Late night', pt: 'Madrugada' }, from: 0, to: 6 },
  { label: { en: 'Morning', pt: 'Manhã' }, from: 6, to: 12 },
  { label: { en: 'Afternoon', pt: 'Tarde' }, from: 12, to: 18 },
  { label: { en: 'Evening', pt: 'Noite' }, from: 18, to: 24 },
];

type Who = 'brand' | 'merchant';
interface Filters {
  month?: string;
  category?: string;
  brand?: string;
  merchant?: string;
  /** moeda da compra */
  place?: string;
}
type FilterKey = keyof Filters;

function groupBy(rows: Transaction[], keyOf: (t: Transaction) => string): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>();
  for (const t of rows) {
    const k = keyOf(t);
    const list = out.get(k);
    if (list) list.push(t);
    else out.set(k, [t]);
  }
  return out;
}

/**
 * memo: a tela não tem props, então só re-renderiza quando os dados, o idioma ou o próprio estado mudam. Um estado do
 * cabeçalho (esconder ao rolar, por exemplo) não refaz os gráficos no meio da rolagem.
 */
export const HistoryView = memo(function HistoryView() {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  // date já é hora local (enrichDataset): sem timeZone aqui, senão o fuso entraria duas vezes no mapa de calor
  const h = useMemo(() => purchaseHistory(dataset, { locale }), [dataset, locale]);
  const fx = useMemo(() => fxSummary(dataset), [dataset]);
  // data curta com ano (10/17/26 · 17/10/26): primeira e última compra de uma marca
  const dmy = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(LOCALES.find((l) => l.value === locale)?.tag, { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' });
    return (iso: string) => fmt.format(new Date(iso));
  }, [locale]);

  const [filters, setFilters] = useState<Filters>({});
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [who, setWho] = useState<Who>('brand');
  const [whoShown, setWhoShown] = useState(TOP_WHO);
  const wide = useMedia('(min-width: 1024px)');
  const narrow = useMedia('(max-width: 359px)', false);
  const allWho = whoShown === Infinity;
  const filterHint = useId();
  const whoListRef = useRef<HTMLDivElement>(null);
  const whoFocusFrom = useRef<number | null>(null);
  useEffect(() => {
    const from = whoFocusFrom.current;
    if (from == null) return;
    whoFocusFrom.current = null;
    whoListRef.current?.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')[from]?.focus();
  }, [whoShown]);
  const [heatMetric, setHeatMetric] = useState<HeatMetric>('count');

  const toggle = (key: FilterKey, value: string) => {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? undefined : value }));
    setLimit(PAGE);
  };
  const clearFilter = (key: FilterKey) => {
    setFilters((f) => ({ ...f, [key]: undefined }));
    setLimit(PAGE);
  };

  // as 5 maiores categorias que têm cor própria (fixa por id); "Outros" e as menores vão para o cinza
  const series = useMemo(
    () => h.byCategory
      .filter((c) => c.name !== CATEGORY.other && hasCategoryColor(c.name))
      .slice(0, 5)
      .map((c) => ({ name: c.name, label: categoryLabel(c.name, locale), color: categoryColor(c.name) })),
    [h, locale],
  );
  const catName = (id?: string) => categoryLabel(id, locale);
  const stacks = useMemo(() => monthStacks(h.months, series, ''), [h, series]);

  const rowsBy = useMemo(() => ({
    category: groupBy(h.purchases, categoryOf),
    brand: groupBy(h.purchases, brandOf),
    merchant: groupBy(h.purchases, merchantOf),
    place: groupBy(h.purchases, (t) => t.currency),
  }), [h]);

  const approx = (v: number | null) => (v == null || !fx ? null : `≈\u00a0${money(v, fx.currency, { compact: true })}`);
  const purchasesText = (n: number) => plural(n, tr('purchase', 'compra'), tr('purchases', 'compras'));

  const kpis = useMemo(() => {
    const full = h.months.filter((m) => m.full);
    const fullSet = new Set(full.map((m) => m.month));
    const monthAvg = full.length ? full.reduce((s, m) => s + m.total, 0) / full.length : null;
    const fullHome = fx && full.length ? homeTotal(h.purchases.filter((t) => fullSet.has(monthOf(t))), fx) : null;
    return {
      fullMonths: full.length,
      monthAvg,
      monthAvgHome: fullHome != null ? fullHome / full.length : null,
      ticketHome: h.totalHome != null && h.count ? h.totalHome / h.count : null,
      refunds: h.purchases.filter((t) => t.amountUsd < 0).length,
      pending: h.purchases.filter((t) => t.status === 'pending').length,
    };
  }, [h, fx]);

  const heat = useMemo(() => {
    const v = (c: { total: number; count: number }) => (heatMetric === 'total' ? c.total : c.count);
    const byDay = WEEK_ORDER.map((d) => {
      const cells = h.heatmap.slice(d * 24, d * 24 + 24);
      return {
        weekday: d,
        bands: BANDS.map((b) => cells.slice(b.from, b.to).reduce((s, c) => ({ total: s.total + c.total, count: s.count + c.count }), { total: 0, count: 0 })),
        total: cells.reduce((s, c) => s + c.total, 0),
        count: cells.reduce((s, c) => s + c.count, 0),
      };
    });
    const bandTotals = BANDS.map((_, i) => byDay.reduce((s, d) => ({ total: s.total + d.bands[i].total, count: s.count + d.bands[i].count }), { total: 0, count: 0 }));
    const topDay = byDay.reduce((best, d) => (v(d) > v(best) ? d : best), byDay[0]);
    const topBand = bandTotals.reduce((best, b, i) => (v(b) > v(bandTotals[best]) ? i : best), 0);
    return { byDay, topDay, topBand };
  }, [h, heatMetric]);

  const rows = useMemo(() => {
    const q = fold(query.trim());
    return h.purchases.filter((t) =>
      (!filters.month || monthOf(t) === filters.month)
      && (!filters.category || categoryOf(t) === filters.category)
      && (!filters.brand || brandOf(t) === filters.brand)
      && (!filters.merchant || merchantOf(t) === filters.merchant)
      && (!filters.place || t.currency === filters.place)
      && (!q || fold(`${t.merchant ?? ''} ${t.merchantRaw ?? ''} ${t.brand ?? ''}`).includes(q)));
  }, [h, filters, query]);

  const listed = useMemo(() => {
    const total = rows.reduce((s, t) => s + t.amountUsd, 0);
    const charges = rows.filter((t) => t.amountUsd > 0).length;
    // total do mês sobre todas as linhas filtradas, não só as já exibidas
    const monthTotals = new Map<string, { total: number; count: number; rows: Transaction[] }>();
    for (const t of rows) {
      const m = monthTotals.get(monthOf(t)) ?? { total: 0, count: 0, rows: [] };
      m.total += t.amountUsd;
      if (t.amountUsd > 0) m.count += 1;
      m.rows.push(t);
      monthTotals.set(monthOf(t), m);
    }
    const groups: { month: string; rows: Transaction[] }[] = [];
    for (const t of rows.slice(0, limit)) {
      const last = groups[groups.length - 1];
      if (last && last.month === monthOf(t)) last.rows.push(t);
      else groups.push({ month: monthOf(t), rows: [t] });
    }
    return { total, charges, refunds: rows.length - charges, monthTotals, groups };
  }, [rows, limit]);

  const fullByMonth = useMemo(() => new Map(h.months.map((m) => [m.month, m.full])), [h]);
  const usedCards = useMemo(() => {
    const ids = new Set(h.purchases.map((t) => t.cardId));
    return dataset.cards.filter((c) => ids.has(c.id));
  }, [dataset, h]);
  const cardById = useMemo(() => new Map(dataset.cards.map((c) => [c.id, c])), [dataset]);

  // aviso flutuante (JumpToList): o clique no gráfico filtra a lista lá embaixo; sem isso parece que nada aconteceu
  const listRef = useRef<HTMLElement>(null);
  const hasPurchases = h.purchases.length > 0;

  if (!hasPurchases) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">{tr('Purchase history', 'Histórico de compras')}</h1>
        <Empty
          title={tr('No card purchases in the loaded history.', 'Nenhuma compra no cartão no histórico carregado.')}
          hint={tr(
            'Once there are purchases, this page shows what you spend the most on, with whom, where and when.',
            'Quando houver compras, aqui aparece com o que mais se gasta, com quem, onde e quando.',
          )}
        />
      </div>
    );
  }

  const placeByCurrency = new Map(h.byPlace.map((p) => [p.currency, p]));
  const chips: { key: FilterKey; label: string; value: string }[] = [];
  if (filters.month) chips.push({ key: 'month', label: tr('Month', 'Mês'), value: monthLabelLong(filters.month) });
  if (filters.category) chips.push({ key: 'category', label: tr('Category', 'Categoria'), value: catName(filters.category) });
  if (filters.brand) chips.push({ key: 'brand', label: tr('Brand', 'Marca'), value: filters.brand });
  if (filters.merchant) chips.push({ key: 'merchant', label: tr('Merchant', 'Estabelecimento'), value: filters.merchant });
  if (filters.place) chips.push({ key: 'place', label: tr('Where', 'Onde'), value: placeByCurrency.get(filters.place)?.label ?? filters.place });
  const filtering = chips.length > 0 || query.trim() !== '';
  const zone = tzLabel();

  const categoryRows: RankRow[] = h.byCategory.map((c) => ({
    key: c.name,
    label: <span className="inline-flex items-center gap-2"><Swatch color={categoryColor(c.name)} />{catName(c.name)}</span>,
    value: c.total,
    valueLabel: usd(c.total),
    color: categoryColor(c.name),
    detail: (
      <>
        <span className="tnum">{pct(c.share * 100, c.share < 0.1 ? 1 : 0)}</span>
        <span>{purchasesText(c.count)}</span>
        {fx ? <span className="tnum">{approx(homeTotal(rowsBy.category.get(c.name) ?? [], fx))}</span> : null}
      </>
    ),
  }));

  const whoList: HistoryGroup[] = who === 'brand' ? h.byBrand : h.byMerchant;
  const whoRows: RankRow[] = whoList.slice(0, whoShown).map((g) => ({
    key: g.name,
    label: g.name,
    sub: <span className="inline-flex items-center gap-1.5"><Swatch color={categoryColor(g.category)} className="size-2" />{catName(g.category)}</span>,
    value: g.total,
    valueLabel: usd(g.total),
    detail: (
      <>
        <span>{purchasesText(g.count)}</span>
        {g.count > 1 ? <span className="tnum">{tr('avg', 'média')} {usd(g.avgTicket)}</span> : null}
        <span className="tnum">
          {g.count > 1 && g.first !== g.last ? `${dmy(g.first)} → ${dmy(g.last)}` : `${tr('on', 'em')} ${dmy(g.last || g.first)}`}
        </span>
      </>
    ),
  }));

  const placeRows: RankRow[] = h.byPlace.map((p) => {
    const local = p.currency !== 'USD' ? (rowsBy.place.get(p.currency) ?? []).reduce((s, t) => s + t.amount, 0) : null;
    return {
      key: p.currency,
      label: p.label,
      value: p.total,
      valueLabel: usd(p.total),
      detail: (
        <>
          <span className="tnum">{pct(p.share * 100, p.share < 0.1 ? 1 : 0)}</span>
          <span>{purchasesText(p.count)}</span>
          {local != null ? (
            <span className="tnum">{money(local, p.currency, { compact: true })} {tr('in local currency', 'na moeda local')}</span>
          ) : null}
        </>
      ),
    };
  });

  // no celular os quatro números dividem a tela em 2×2: o valor encolhe um pouco para caber
  const kpi = (v: string) => <span className="text-lg sm:text-2xl">{v}</span>;
  const metricLabel = heatMetric === 'count' ? tr('purchases', 'compras') : tr('spending', 'gasto');
  const fmtHeat = (c: { total: number; count: number }) => (heatMetric === 'count' ? num(c.count, 0) : usd0(c.total));
  const topDayName = weekdayLong(heat.topDay.weekday, locale);
  const topBand = BANDS[heat.topBand];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{tr('Purchase history', 'Histórico de compras')}</h1>
        <p className="mt-0.5 text-sm text-muted">
          {tr(`All card purchases from ${dateFull(h.from)} to ${dateFull(h.to)}`, `Todas as compras no cartão de ${dateFull(h.from)} a ${dateFull(h.to)}`)}
          {/* o "·" fica preso ao item anterior: a linha nunca começa com ele */}
          <span className="text-faint">{'\u00a0· '}{plural(h.months.length, tr('month', 'mês'), tr('months', 'meses'))}{'\u00a0· '}{purchasesText(h.count)}</span>
        </p>
      </div>

      <DroppedRowsNote />
      {!h.coverageComplete ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-xs text-muted">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          {tr(
            `Older history wasn't loaded: purchases before ${dateFull(h.from)} don't show up here, and the first month may be incomplete.`,
            `Há histórico mais antigo que não foi carregado: compras antes de ${dateFull(h.from)} não aparecem aqui, e o primeiro mês pode estar pela metade.`,
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat
          label={tr('Total spent', 'Total gasto')}
          value={kpi(usd(h.total))}
          sub={approx(h.totalHome != null ? Math.round(h.totalHome) : null) ?? `${tr('over', 'em')} ${plural(h.days, tr('day', 'dia'), tr('days', 'dias'))}`}
          why={tr(
            `Sum of every card purchase in the period, including pending ones. Refunds are subtracted; voided purchases are left out.${fx ? ` The ≈ adds what you paid in ${fx.currency} and converts the rest at the average exchange rate of your purchases.` : ''}`,
            `Soma de todas as compras no cartão do período, inclusive as ainda a confirmar. Estorno abate; compra cancelada fica fora.${fx ? ` O ≈ soma o que foi pago em ${fx.currency === 'BRL' ? 'reais' : fx.currency} e converte o resto pelo câmbio médio das suas compras.` : ''}`,
          )}
        />
        <Stat
          label={tr('Purchases', 'Compras')}
          value={kpi(num(h.count, 0))}
          sub={[
            kpis.refunds ? plural(kpis.refunds, tr('refund', 'estorno'), tr('refunds', 'estornos')) : null,
            kpis.pending ? `${num(kpis.pending, 0)}\u00a0${tr('pending', 'a confirmar')}` : null,
          ].filter(Boolean).join('\u00a0· ') || tr('no refunds', 'nenhum estorno')}
          why={tr(
            "Each card charge counts once. A refund isn't a purchase: it only comes off the total.",
            'Cada cobrança no cartão conta uma vez. Estorno não conta como compra: só abate do total.',
          )}
        />
        <Stat
          label={tr('Average purchase', 'Média por compra')}
          value={kpi(usd(h.avgTicket))}
          sub={approx(kpis.ticketHome) ?? tr('per purchase', 'por compra')}
          why={tr('Total spent ÷ number of purchases.', 'Total gasto ÷ número de compras.')}
        />
        <Stat
          label={tr('Monthly average', 'Média por mês')}
          value={kpi(kpis.monthAvg != null ? usd(kpis.monthAvg) : '—')}
          sub={kpis.fullMonths
            ? `${approx(kpis.monthAvgHome) ? `${approx(kpis.monthAvgHome)}\u00a0· ` : ''}${plural(kpis.fullMonths, tr('full month', 'mês inteiro'), tr('full months', 'meses inteiros'))}`
            : tr('no full month yet', 'ainda sem mês inteiro')}
          why={tr(
            'Only full months count. The current month and a half-loaded first month would be low and drag the average down.',
            'Só meses inteiros entram. O mês corrente e um primeiro mês pela metade ficariam baixos e puxariam a média para baixo.',
          )}
        />
      </div>

      <span id={filterHint} className="sr-only">{tr('Filters the purchase list below.', 'Filtra a lista de compras abaixo.')}</span>
      <Panel>
        <PanelTitle hint={tr('pick a month', 'escolha um mês')}>{tr('Month by month', 'Mês a mês')}</PanelTitle>
        <StackedMonthBars months={h.months} series={series} selected={filters.month ?? null} onSelect={(m) => toggle('month', m)} />
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          <Why>
            {tr(
              'Each bar is the month\'s spending, split into the period\'s 5 biggest categories. Each category keeps the same color everywhere in Lighthouse; everything else (smaller categories and "Other", what couldn\'t be classified) sits in gray on top. A partial month (hatched) is the current month or a month where the history starts midway: don\'t compare it with full months.',
              'Cada barra é o gasto do mês, dividido pelas 5 categorias mais fortes do período. Cada categoria tem a mesma cor em todo o Lighthouse; o resto (as categorias menores e "Outros", o que não deu para classificar) fica em cinza no topo. Mês parcial (hachurado) é o mês corrente ou um mês em que o histórico começa no meio: não compare com os inteiros.',
            )}
          </Why>
          <AsTable label={tr('Month by month, as a table', 'Mês a mês, em tabela')}>
            <table className="w-full min-w-[420px] text-xs">
              <caption className="sr-only">{tr('Spending per month by category', 'Gasto por mês e categoria')}</caption>
              <thead>
                <tr className="border-b border-line text-left uppercase tracking-wider text-faint">
                  <th scope="col" className="px-3 py-2 font-medium">{tr('Month', 'Mês')}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Purchases', 'Compras')}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  {series.map((c) => <th key={c.name} scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">{c.label}</th>)}
                  <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">{tr('Everything else', 'Tudo o resto')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...stacks].reverse().map((m) => {
                  const seg = new Map(m.segs.map((x) => [x.key, x.total]));
                  return (
                    <tr key={m.month}>
                      <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap text-muted">{capitalize(monthLabelLong(m.month))}{m.full ? '' : ` · ${tr('partial', 'parcial')}`}</th>
                      <td className="tnum px-3 py-1.5 text-right">{num(m.count, 0)}</td>
                      <td className="tnum px-3 py-1.5 text-right">{usd(m.total)}</td>
                      {series.map((c) => <td key={c.name} className="tnum px-3 py-1.5 text-right">{seg.has(c.name) ? usd(seg.get(c.name) ?? 0) : '—'}</td>)}
                      <td className="tnum px-3 py-1.5 text-right">{seg.has('__rest') ? usd(seg.get('__rest') ?? 0) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AsTable>
        </div>
      </Panel>

      {/* no celular a ordem do DOM vale (categorias, quem, onde); na tela larga, quem ocupa a coluna da direita inteira */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle>{tr('What I spend the most on', 'Com o que mais gasto')}</PanelTitle>
          <RankBars rows={categoryRows} active={filters.category} onSelect={(k) => toggle('category', k)} describedBy={filterHint} />
          <div className="mt-3">
            <Why>
              {tr(
                'The category comes from the dashboard\'s merchant dictionary; when it doesn\'t know the name, the category ether.fi sends is used. "Other" is what couldn\'t be classified. The percentage is of total spending, and a refund comes off the category of its purchase.',
                'A categoria vem do dicionário de estabelecimentos do painel; quando ele não conhece o nome, vale a categoria que a ether.fi manda. "Outros" é o que não deu para classificar. O percentual é sobre o total gasto, e estorno abate da categoria da compra.',
              )}
            </Why>
          </div>
        </Panel>

        {/* aberta, a lista rola dentro do painel; contain:size faz o painel ocupar a altura da coluna da esquerda em vez de esticá-la */}
        <Panel className={cx('flex flex-col lg:row-span-2', allWho && wide && 'lg:[contain:size]')}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{tr('Who got the money', 'Para quem foi o dinheiro')}</h2>
            <Segmented
              ariaLabel={tr('Group by', 'Agrupar por')}
              value={who}
              onChange={(v) => { setWho(v); setWhoShown(TOP_WHO); }}
              options={[{ value: 'brand', label: tr('Brand', 'Marca') }, { value: 'merchant', label: tr('Merchant', 'Estabelecimento') }]}
            />
          </div>
          <div
            ref={whoListRef}
            {...(allWho && wide ? { tabIndex: 0, role: 'region', 'aria-label': tr('Who got the money, full list', 'Para quem foi o dinheiro, lista completa') } : {})}
            className={cx(allWho && wide && 'min-h-0 flex-1 overflow-y-auto pr-1')}
          >
            <RankBars
              rows={whoRows}
              max={whoList[0]?.total}
              active={who === 'brand' ? filters.brand : filters.merchant}
              onSelect={(k) => toggle(who, k)}
              describedBy={filterHint}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <Why>
              {tr(
                'Brand groups what belongs to the same company or platform: every order placed through iFood counts as iFood, and Uber rides and Uber credit top-ups count as Uber. Merchant is who charged you, with the statement name already cleaned up. Average = total ÷ number of purchases; the dates are the first and last purchase.',
                'Marca junta o que é da mesma empresa ou plataforma: todo pedido feito pelo iFood conta como iFood, corrida e recarga de saldo da Uber contam como Uber. Estabelecimento é quem cobrou, com o nome da fatura já limpo. Média por compra = total ÷ número de compras; as datas são a primeira e a última compra.',
              )}
            </Why>
            {whoList.length > TOP_WHO ? (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {whoShown < whoList.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      whoFocusFrom.current = whoShown;
                      setWhoShown((v) => (wide ? Infinity : v + WHO_STEP));
                    }}
                    className="tap -my-1 cursor-pointer py-1 text-xs text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
                  >
                    {wide
                      ? tr(`see all (${num(whoList.length, 0)})`, `ver todos (${num(whoList.length, 0)})`)
                      : tr(`show ${Math.min(WHO_STEP, whoList.length - whoShown)} more\u00a0· ${num(whoList.length - whoShown, 0)} left`, `mostrar mais ${Math.min(WHO_STEP, whoList.length - whoShown)}\u00a0· faltam ${num(whoList.length - whoShown, 0)}`)}
                  </button>
                ) : null}
                {whoShown > TOP_WHO ? (
                  <button
                    type="button"
                    onClick={() => setWhoShown(TOP_WHO)}
                    className="tap -my-1 cursor-pointer py-1 text-xs text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
                  >
                    {tr(`show only the top ${TOP_WHO}`, `mostrar só os ${TOP_WHO} primeiros`)}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelTitle>{tr('Where', 'Onde')}</PanelTitle>
          <RankBars rows={placeRows} active={filters.place} onSelect={(k) => toggle('place', k)} describedBy={filterHint} />
          <div className="mt-3">
            <Why>
              {tr(
                'ether.fi doesn\'t report the city or country of a purchase. "Where" comes from the currency the purchase was made in: in your home currency, almost always near home; in dollars, an online service or a purchase abroad; in another currency, probably a trip. It\'s a hint, not a location.',
                'A ether.fi não informa cidade nem país da compra. O "onde" vem da moeda em que a compra foi feita: na moeda da casa, quase sempre perto de casa; em dólar, um serviço online ou uma compra lá fora; em outra moeda, provavelmente uma viagem. É uma pista, não uma localização.',
              )}
            </Why>
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{tr('When', 'Quando')}</h2>
          <Segmented
            ariaLabel={tr('Map color', 'Cor do mapa')}
            value={heatMetric}
            onChange={setHeatMetric}
            options={[{ value: 'count', label: tr('# of purchases', 'Nº de compras') }, { value: 'total', label: tr('Amount', 'Valor') }]}
          />
        </div>
        <Heatmap
          cells={h.heatmap}
          metric={heatMetric}
          ariaLabel={tr(
            `Heatmap of ${metricLabel} by day of the week and hour. Day with the most ${metricLabel}: ${topDayName}; time of day with the most ${metricLabel}: ${topBand.label.en.toLowerCase()}.`,
            `Mapa de calor de ${metricLabel} por dia da semana e hora. Dia com mais ${metricLabel}: ${topDayName}; faixa com mais ${metricLabel}: ${topBand.label.pt.toLowerCase()}.`,
          )}
        />
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
          <span>{tr(`Day with the most ${metricLabel}:`, `Dia com mais ${metricLabel}:`)} <span className="text-ink">{topDayName}</span></span>
          <span>
            {tr(`Time of day with the most ${metricLabel}:`, `Faixa do dia com mais ${metricLabel}:`)}{' '}
            <span className="text-ink">{topBand.label[locale].toLowerCase()} <span className="whitespace-nowrap">({hourRange(topBand.from, topBand.to, locale)})</span></span>
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <Why>
            {tr(
              `Each square is one hour of one weekday, added up over the whole period. Charges only: a refund posts when the merchant processes it, not when you bought. In amount mode the color grows with the square root of the total, so a few big purchases don't wash out the rest. Times are local${tzLabel() ? ` (${tzLabel()})` : ''}, the same clock as the purchase list below.`,
              `Cada quadrado é uma hora de um dia da semana, somando o período todo. Só cobranças: estorno sai quando o estabelecimento processa, não quando você comprou. Em valor, a cor cresce com a raiz da soma, para poucas compras grandes não apagarem o resto. Hora local${tzLabel() ? ` (${tzLabel()})` : ''}, o mesmo relógio da lista de compras abaixo.`,
            )}
          </Why>
          <AsTable label={tr('When, as a table', 'Quando, em tabela')}>
            <table className="w-full min-w-[420px] text-xs">
              <caption className="sr-only">{tr(`${capitalize(metricLabel)} by day of the week and time of day`, `${capitalize(metricLabel)} por dia da semana e faixa do dia`)}</caption>
              <thead>
                <tr className="border-b border-line text-left uppercase tracking-wider text-faint">
                  <th scope="col" className="px-3 py-2 font-medium">{tr('Day', 'Dia')}</th>
                  {BANDS.map((b) => <th key={b.from} scope="col" className="px-3 py-2 text-right font-medium">{b.label[locale]}</th>)}
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {heat.byDay.map((d) => (
                  <tr key={d.weekday}>
                    <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">{weekdayLong(d.weekday, locale)}</th>
                    {d.bands.map((b, i) => <td key={BANDS[i].from} className="tnum px-3 py-1.5 text-right">{fmtHeat(b)}</td>)}
                    <td className="tnum px-3 py-1.5 text-right font-medium">{fmtHeat(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AsTable>
        </div>
      </Panel>

      <Panel className="!p-0 overflow-hidden">
        <div className="px-5 pt-5">
          <PanelTitle hint={tr('by USD amount', 'pelo valor em US$')}>{tr('Largest purchases', 'Maiores compras')}</PanelTitle>
        </div>
        <ol className="divide-y divide-line border-t border-line">
          {h.topPurchases.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="tnum w-5 shrink-0 text-right text-xs text-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-medium">{t.merchant ?? tr('Purchase', 'Compra')}</span>
                  <TxBadges t={t} />
                </div>
                <div className="truncate text-xs text-faint">{dateFull(t.date)} · {catName(categoryOf(t))}</div>
              </div>
              <TxAmount t={t} compact />
            </li>
          ))}
        </ol>
      </Panel>

      <section ref={listRef} className="scroll-mt-20 space-y-3" aria-labelledby="history-list">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="history-list" className="text-lg font-semibold tracking-tight">{tr('All purchases', 'Todas as compras')}</h2>
          <div className="text-xs text-muted" role="status" aria-live="polite">
            {purchasesText(listed.charges)}
            {listed.refunds ? `\u00a0+ ${plural(listed.refunds, tr('refund', 'estorno'), tr('refunds', 'estornos'))}` : ''}
            <span className="text-faint">{'\u00a0· '}</span>
            <span className="tnum text-ink">{usd(listed.total)}</span>
            {fx ? <span className="tnum text-faint"> ({approx(homeTotal(rows, fx))})</span> : null}
          </div>
        </div>

        <Panel className="!p-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
              placeholder={narrow ? tr('Search…', 'Buscar…') : tr('Search merchant or brand…', 'Buscar estabelecimento ou marca…')}
              aria-label={tr('Search merchant or brand', 'Buscar estabelecimento ou marca')}
              // no toque, 16 px e 44 px de altura: com menos de 16 px, o Safari do iPhone amplia a página ao focar o campo
              className="w-full rounded-lg border border-field bg-panel min-h-11 py-2 pr-12 pl-8 text-base text-ink outline-none placeholder:text-faint focus:border-line2 pointer-fine:sm:min-h-0 pointer-fine:sm:pr-9 pointer-fine:sm:text-xs"
            />
            {query ? (
              <button
                type="button"
                onClick={() => { setQuery(''); setLimit(PAGE); }}
                aria-label={tr('Clear search', 'Limpar busca')}
                className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-faint hover:bg-panel2 hover:text-ink pointer-fine:sm:right-2 pointer-fine:sm:size-6"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
          {chips.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => clearFilter(c.key)}
                  className="tap inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-line2 bg-panel2 px-2.5 py-1 text-xs transition-colors hover:border-faint min-h-9 pointer-fine:sm:min-h-0"
                >
                  <span className="text-faint">{c.label}</span>
                  <span className="truncate text-ink">{c.value}</span>
                  {/* o nome acessível é o texto do chip mais a ação: "Categoria Delivery, tirar filtro" */}
                  <span className="sr-only">{tr(', remove filter', ', tirar filtro')}</span>
                  <X className="size-3 shrink-0 text-faint" aria-hidden="true" />
                </button>
              ))}
              {chips.length > 1 ? (
                <button
                  type="button"
                  onClick={() => { setFilters({}); setLimit(PAGE); }}
                  className="tap min-h-6 cursor-pointer px-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {tr('clear all', 'limpar tudo')}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-xs text-faint">
              {tr(
                'Pick a month, category, brand, merchant or place above to filter.',
                'Escolha um mês, categoria, marca, estabelecimento ou lugar acima para filtrar.',
              )}
              {zone ? <span className="whitespace-nowrap">{tr(` Times in ${zone} (your time zone).`, ` Horários em ${zone} (seu fuso).`)}</span> : null}
            </div>
          )}
        </Panel>

        {listed.groups.length === 0 ? (
          <Empty
            title={tr('No purchases match these filters.', 'Nenhuma compra com esses filtros.')}
            hint={tr('Remove a filter or change the search.', 'Tire um filtro ou mude a busca.')}
          />
        ) : (
          <div className="space-y-4">
            {listed.groups.map((g) => {
              const m = listed.monthTotals.get(g.month);
              return (
                <Panel key={g.month} className="!p-0 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-line bg-panel2/40 px-4 py-2 text-xs">
                    <span className="inline-flex items-center gap-2 font-medium text-muted">
                      {capitalize(monthLabelLong(g.month))}
                      {fullByMonth.get(g.month) === false ? <Badge>{tr('partial', 'parcial')}</Badge> : null}
                    </span>
                    {m ? (
                      <span className="tnum text-faint">
                        {purchasesText(m.count)}{'\u00a0· '}<span className="text-ink">{usd(m.total)}</span>
                        {fx ? ` ${approx(homeTotal(m.rows, fx))}` : ''}
                      </span>
                    ) : null}
                  </div>
                  <div className="divide-y divide-line">
                    {g.rows.map((t) => (
                      <TxRow
                        key={t.id}
                        t={t}
                        meta={`${dateShort(t.date)} · ${timeOnly(t.date)}`}
                        card={usedCards.length > 1 && t.cardId ? cardById.get(t.cardId) : undefined}
                      />
                    ))}
                  </div>
                </Panel>
              );
            })}
            {rows.length > limit ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + PAGE)}
                  className="min-h-11 cursor-pointer rounded-lg border border-line2 px-4 py-2 text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink pointer-fine:sm:min-h-0"
                >
                  {/* o padrão de "mostrar mais" do painel: "Mostrar mais 50 · faltam N" */}
                  {tr(`Show ${Math.min(PAGE, rows.length - limit)} more`, `Mostrar mais ${Math.min(PAGE, rows.length - limit)}`)}
                  <span className="text-faint">{'\u00a0· '}{tr(`${num(rows.length - limit, 0)} left`, `faltam ${num(rows.length - limit, 0)}`)}</span>
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {filtering && rows.length > 0 ? <JumpToList listRef={listRef} count={rows.length} /> : null}
    </div>
  );
});

/**
 * Botão flutuante "Ver N compras filtradas", visível enquanto a lista está fora da tela. Tem o próprio observador e o
 * próprio estado: quando a lista entra ou sai da tela, só ele re-renderiza, não os gráficos e o ranking da tela.
 */
function JumpToList({ listRef, count }: { listRef: RefObject<HTMLElement | null>; count: number }) {
  const tr = useTr();
  const [listInView, setListInView] = useState(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setListInView(e.isIntersecting), { rootMargin: '0px 0px -25% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [listRef]);
  if (listInView) return null;
  return (
    // no celular a barra de navegação fixa ocupa ~56px + área segura: o botão fica logo acima dela
    <button
      type="button"
      onClick={() => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        listRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }}
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-30 inline-flex min-h-11 -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium whitespace-nowrap text-accent-ink shadow-lg shadow-black/40 transition hover:brightness-110 lg:bottom-5 lg:min-h-0"
    >
      {tr(
        `See ${plural(count, 'filtered purchase', 'filtered purchases')}`,
        `Ver ${plural(count, 'compra filtrada', 'compras filtradas')}`,
      )}
      <ArrowDown className="size-4" aria-hidden="true" />
    </button>
  );
}
