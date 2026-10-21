import { useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { zeroFillDays, type Trip } from '../lib/analytics';
import { dateDayMonth, dateFull, dateRange, dateShort, money, nb, usd } from '../lib/format';
import { cx } from '../lib/cx';
import { categoryColor } from '../lib/categoryColors';
import { LOCALES, pick, type Locale } from '../lib/locale';
import { useStore } from '../state/store';
import { useMedia } from '../components/useMedia';
import { useSpendAnalyses } from '../state/analyses';
import { useLocale, useTr } from '../state/locale';
import { categoryLabel } from '../lib/merchants';
import { Badge, Empty, Panel, PanelTitle, Stat, Why } from '../components/ui';
import { BarChart } from '../components/charts';
import { Plane } from 'lucide-react';

/** Linhas da viagem visíveis no celular antes do "Mostrar todas" */
const TRIP_ROWS = 6;

/** "Argentine pesos", "pesos argentinos": o nome da moeda no plural (o Intl dá o plural para 2 unidades) */
function currencyPlural(code: string, locale: Locale): string {
  try {
    const tag = LOCALES.find((l) => l.value === locale)?.tag;
    const fmt = new Intl.NumberFormat(tag, { style: 'currency', currency: code, currencyDisplay: 'name' });
    const name = fmt.formatToParts(2).find((p) => p.type === 'currency')?.value ?? code;
    // em português o nome de moeda é substantivo comum: "pesos argentinos"
    return locale === 'pt' ? name.toLocaleLowerCase(tag) : name;
  } catch {
    return code;
  }
}

/** Onde foi a viagem: cidades quando a ether.fi informa; senão, pela moeda ("Buenos Aires → Mendoza", "pesos argentinos") */
export function tripPlace(t: { cities: string[]; currencies: string[] }, locale: Locale): string {
  if (t.cities.length > 1) return `${t.cities[0]} → ${t.cities[t.cities.length - 1]}`;
  if (t.cities.length === 1) return t.cities[0];
  const names = t.currencies.map((c) => currencyPlural(c, locale));
  return names.length ? names.join(' + ') : pick(locale, 'unknown place', 'lugar desconhecido');
}

/** Viagens dentro de Gastos: só aparece quando há alguma. */
export function TripsSection() {
  const { locale } = useLocale();
  const tr = useTr();
  const { trips } = useSpendAnalyses();
  const [openIdx, setOpenIdx] = useState(0);
  const detailRef = useRef<HTMLDivElement>(null);

  const select = (i: number) => {
    setOpenIdx(i);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      detailRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    });
  };

  return (
    <div className="space-y-5">
      {trips.length === 0 ? (
        <Empty title={tr('No trips detected in the available data.', 'Nenhuma viagem detectada nos dados disponíveis.')} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {trips.map((t, i) => (
              <button
                key={t.from}
                onClick={() => select(i)}
                aria-pressed={openIdx === i}
                className={`panel cursor-pointer p-5 text-left transition-all ${
                  openIdx === i ? 'glow-accent border-accent/30' : 'hover:border-line2'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2 text-accent">
                  <Plane className="size-4 shrink-0" />
                  <span className="truncate text-sm font-medium">{tr('Trip', 'Viagem')} · {tripPlace(t, locale)}</span>
                </div>
                <div className="tnum mt-2 text-2xl font-semibold tracking-tight">{usd(t.total)}</div>
                {t.cities.length > 2 ? <div className="mt-1.5 truncate text-sm text-muted">{t.cities.join(' → ')}</div> : null}
                <div className="mt-2 text-xs text-faint pointer-fine:lg:text-[11px]">
                  {nb(`${dateRange(t.from, t.to)} · ${t.days === 1 ? tr('1 day', '1 dia') : tr(`${t.days} days`, `${t.days} dias`)} · ${t.count === 1 ? tr('1 transaction', '1 transação') : tr(`${t.count} transactions`, `${t.count} transações`)}`)}
                </div>
                <div className="mt-2 flex gap-1">
                  {t.currencies.map((c) => <Badge key={c}>{c}</Badge>)}
                </div>
              </button>
            ))}
          </div>

          <div ref={detailRef}>
            {trips[openIdx] ? <TripDetail t={trips[openIdx]} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

function TripDetail({ t }: { t: Trip }) {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  const wide = useMedia('(min-width: 1024px)');
  const [showAll, setShowAll] = useState(false);
  const txns = useMemo(
    () =>
      dataset.transactions
        .filter((x) => t.relatedIds.includes(x.id))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [dataset, t.relatedIds],
  );

  return (
    <Panel>
      {/* no celular o intervalo vai numa linha própria: ao lado do título ele ficava espremido e quebrava no meio */}
      <PanelTitle hint={<span className="hidden sm:inline">{dateRange(t.from, t.to)}</span>}>{tr('Trip report', 'Relatório da viagem')}</PanelTitle>
      <p className="-mt-2 mb-4 text-xs text-faint sm:hidden">{dateRange(t.from, t.to)}</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* no celular o valor encolhe um pouco para caber em meia linha ("US$ 3.642,81" a 320 px) */}
        <Stat label="Total" value={<span className="text-lg sm:text-2xl">{usd(t.total)}</span>} />
        <Stat label={tr('Daily average', 'Média por dia')} value={<span className="text-lg sm:text-2xl">{usd(t.dailyAvg)}</span>} />
        <Stat label={tr('Transactions', 'Transações')} value={String(t.count)} />
        <Stat label={tr('Days', 'Dias')} value={String(t.days)} />
      </div>

      <div className="mt-6">
        <div className="mb-2 text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{tr('Spending per day', 'Gasto por dia')}</div>
        {/* um dia por barra, inclusive os sem compra: sem isso a barra de um dia caía na posição de outro */}
        <BarChart
          data={zeroFillDays(t.from, t.to.slice(0, 10), t.byDay).map((d) => ({ label: dateShort(`${d.day}T12:00:00Z`), value: d.total, highlight: d.day === t.peakDay?.day }))}
          height={130}
          average={{ value: t.dailyAvg, label: tr(`avg ${usd(t.dailyAvg)}/day`, `média ${usd(t.dailyAvg)}/dia`) }}
          ariaLabel={tr(`Trip spending per day, ${tripPlace(t, locale)}`, `Gasto por dia da viagem, ${tripPlace(t, locale)}`)}
          table={[tr('Day', 'Dia'), tr('Spent', 'Gasto')]}
          axis={t.byDay.length > 1 ? [dateShort(`${t.byDay[0].day}T12:00:00Z`), dateShort(`${t.byDay[t.byDay.length - 1].day}T12:00:00Z`)] : undefined}
        />
        <div className="mt-2 text-xs text-faint">
          {tr('Peak', 'Pico')}: {t.peakDay ? `${dateFull(t.peakDay.day)}, ${usd(t.peakDay.total)}` : '—'}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{tr('By category', 'Por categoria')}</div>
          <div className="space-y-2">
            {t.byCategory.map((c) => {
              const total = t.byCategory.reduce((s, x) => s + x.total, 0) || 1;
              return (
                <div key={c.name} className="flex items-center gap-3 text-sm">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: categoryColor(c.name) }} />
                  <span className="min-w-0 flex-1 truncate text-muted">{categoryLabel(c.name, locale)}</span>
                  <span className="tnum text-ink">{usd(c.total)}</span>
                  <span className="tnum w-10 text-right text-xs text-faint">{Math.round((c.total / total) * 100)}%</span>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{tr('Transactions', 'Transações')}</div>
          <div
            {...(wide ? { tabIndex: 0, role: 'region', 'aria-label': tr(`Trip transactions, ${tripPlace(t, locale)}`, `Transações da viagem, ${tripPlace(t, locale)}`) } : {})}
            className="rounded-md lg:max-h-72 lg:overflow-y-auto lg:pr-1"
          >
            <ul className="divide-y divide-line lg:divide-y-0">
              {(wide || showAll ? txns : txns.slice(0, TRIP_ROWS)).map((x) => (
                <li
                  key={x.id}
                  className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-1 py-2 text-sm transition-colors hover:bg-panel2/50 lg:flex lg:items-center lg:gap-2 lg:rounded-md lg:px-2 lg:py-1.5 lg:text-xs"
                >
                  {/* sem ano (o título do relatório já diz o período): com ano a data não cabia na coluna e encostava no nome */}
                  <span className="text-xs whitespace-nowrap text-faint lg:min-w-16 lg:shrink-0">{dateDayMonth(x.date)}</span>
                  <span className="tnum text-right text-ink lg:order-last lg:shrink-0">{usd(x.amountUsd)}</span>
                  <span className="min-w-0 break-words lg:flex-1 lg:truncate">{x.merchant}</span>
                  <span className="text-right text-xs text-faint lg:contents">
                    {x.city ? <span className="lg:shrink-0">{x.city}</span> : null}
                    {x.city && x.currency !== 'USD' ? <span className="lg:hidden">{'\u00a0· '}</span> : null}
                    {x.currency !== 'USD' ? <span className="tnum whitespace-nowrap lg:shrink-0">{money(x.amount, x.currency)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {!wide && txns.length > TRIP_ROWS ? (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line2 px-4 text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink"
            >
              {showAll ? tr('Show fewer', 'Mostrar menos') : tr(`Show all (${txns.length})`, `Mostrar todas (${txns.length})`)}
              <ChevronDown className={cx('size-4 transition-transform', showAll && 'rotate-180')} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <Why>
          {tr(
          'Purchases outside your currency (or with a recorded city) become a trip when they happen in a row, with up to 4 days between them. A dollar charge with no city, for someone who doesn’t live in the US, counts as an online service, not a trip. The dollar amount is what left your balance. With no city, the trip is named after its currency.',
          'Compras fora da sua moeda (ou com cidade registrada) viram uma viagem quando ocorrem em sequência, com até 4 dias entre elas. Cobrança em dólar sem cidade, para quem não mora nos EUA, conta como serviço online, não como viagem. O valor em US$ é o que saiu do saldo. Sem cidade, a viagem leva o nome da moeda.',
          )}
        </Why>
      </div>
    </Panel>
  );
}
