import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HeatCell, HistoryMonth } from '../lib/history';
import { axisUnit, monthLabel, monthLabelLong, monthYearLabel, num, usd, usdAxis, usdTick } from '../lib/format';
import type { Locale } from '../lib/locale';
import { NEUTRAL_COLOR } from '../lib/categoryColors';
import { cx } from '../lib/cx';
import { useLocale, useTr } from '../state/locale';
import { useMedia } from './useMedia';
import { CHIP_TRACK, centerChip, monthInitial } from './evo';

const REST_KEY = '__rest';

// mês parcial: hachura a 135° na cor do painel, por cima da barra já esmaecida
const HATCH = 'repeating-linear-gradient(135deg, transparent 0 3px, var(--color-panel) 3px 5px)';

const R2 = (n: number) => Math.round(n * 100) / 100;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Marcas redondas do eixo, de 0 até a primeira que cobre o máximo */
function axisTicks(max: number, count = 3): number[] {
  const step = niceStep(max / count);
  const out = [0];
  while (out[out.length - 1] < max) out.push(R2(out[out.length - 1] + step));
  return out;
}

export function Swatch({ color, hatch, className }: { color: string; hatch?: boolean; className?: string }) {
  return (
    <span
      className={cx('inline-block size-2.5 shrink-0 rounded-[3px]', className)}
      style={{ backgroundColor: color, backgroundImage: hatch ? HATCH : undefined, opacity: hatch ? 0.7 : 1 }}
    />
  );
}

/** Traço curto de cor no tooltip: identifica a série sem pesar como uma caixa cheia */
function LineKey({ color }: { color: string }) {
  return <span className="inline-block h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

export interface StackSeries {
  /** id da categoria */
  name: string;
  label: string;
  color: string;
}

export interface MonthStack extends HistoryMonth {
  segs: { key: string; label: string; color: string; total: number }[];
  height: number;
}

/** A pilha de cada mês: as séries na ordem dada (a mais forte na base) e "Tudo o resto" no topo, em cinza. */
export function monthStacks(months: HistoryMonth[], series: StackSeries[], restLabel: string): MonthStack[] {
  const named = new Set(series.map((s) => s.name));
  return months.map((m) => {
    const byName = new Map(m.byCategory.map((c) => [c.name, c.total]));
    const rest = R2(m.byCategory.filter((c) => !named.has(c.name)).reduce((s, c) => s + c.total, 0));
    const segs = [
      ...series.map((s) => ({ key: s.name, label: s.label, color: s.color, total: byName.get(s.name) ?? 0 })),
      { key: REST_KEY, label: restLabel, color: NEUTRAL_COLOR, total: rest },
    ].filter((s) => s.total > 0);
    // categoria líquida negativa no mês (estorno maior que a compra) não entra na pilha
    return { ...m, segs, height: segs.reduce((s, x) => s + x.total, 0) };
  });
}

/**
 * Barras mensais empilhadas por categoria. A série mais forte do período fica na base (é a mais fácil de
 * comparar entre meses); o que não está em `series` vira "Tudo o resto" no topo. Clique alterna o mês.
 * No celular as barras (16px com 15 meses) são só desenho tocável: o controle acessível é a trilha de chips
 * logo abaixo, com nome, valor e "parcial", em alvos de 44px.
 */
export function StackedMonthBars({
  months,
  series,
  selected,
  onSelect,
  height = 200,
}: {
  months: HistoryMonth[];
  series: StackSeries[];
  selected: string | null;
  onSelect: (month: string) => void;
  height?: number;
}) {
  const tr = useTr();
  const wide = useMedia('(min-width: 640px) and (pointer: fine)');
  const [hover, setHover] = useState<number | null>(null);
  const restLabel = tr('Everything else', 'Tudo o resto');
  const stacks = useMemo(() => monthStacks(months, series, restLabel), [months, series, restLabel]);

  const max = Math.max(1, ...stacks.map((s) => s.height));
  const ticks = axisTicks(max);
  const top = ticks[ticks.length - 1];
  const peak = stacks.reduce((best, s, i) => (s.height > stacks[best].height ? i : best), 0);
  const n = stacks.length;
  const hasPartial = stacks.some((s) => !s.full);
  const tip = hover != null ? stacks[hover] : null;
  const ariaFor = (m: MonthStack, isSel: boolean) => tr(
    `${monthLabelLong(m.month)}: ${usd(m.total)}, ${m.count} ${m.count === 1 ? 'purchase' : 'purchases'}${m.full ? '' : ', partial month'}. ${isSel ? 'Filter on; click to remove it.' : 'Click to see this month\'s purchases.'}`,
    `${monthLabelLong(m.month)}: ${usd(m.total)}, ${m.count} ${m.count === 1 ? 'compra' : 'compras'}${m.full ? '' : ', mês parcial'}. ${isSel ? 'Filtro ativo; clique para tirar.' : 'Clique para ver as compras deste mês.'}`,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5"><Swatch color={s.color} />{s.label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><Swatch color={NEUTRAL_COLOR} />{restLabel}</span>
        {hasPartial ? (
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--color-muted)" hatch />{tr('partial month', 'mês parcial')}</span>
        ) : null}
      </div>

      <div className="flex gap-2">
        {/* eixo y: marcas redondas, compactas; a moeda vai uma vez no topo */}
        <div className="relative w-10 shrink-0" aria-hidden="true">
          <span className="block h-5 text-right text-xs leading-none text-faint pointer-fine:lg:text-[11px]">{axisUnit()}</span>
          <div className="relative" style={{ height }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="tnum absolute right-0 translate-y-1/2 text-xs leading-none whitespace-nowrap text-faint pointer-fine:lg:text-[11px]"
                style={{ bottom: `${(t / top) * 100}%` }}
              >
                {usdTick(t)}
              </span>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative pt-5" onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}>
            <div className="relative" style={{ height }}>
              {ticks.map((t) => (
                <div
                  key={t}
                  aria-hidden="true"
                  className={cx('absolute inset-x-0 h-px', t === 0 ? 'bg-line2' : 'bg-line/70')}
                  style={{ bottom: `${(t / top) * 100}%` }}
                />
              ))}
              <div
                role={wide ? 'group' : undefined}
                aria-label={wide ? tr('Spending by month, stacked by category', 'Gasto por mês, empilhado por categoria') : undefined}
                aria-hidden={wide ? undefined : true}
                className="absolute inset-0 flex gap-0.5 sm:gap-1"
              >
                {stacks.map((m, i) => {
                  const pctH = (m.height / top) * 100;
                  const isSel = selected === m.month;
                  const dim = selected != null && !isSel;
                  const body = (
                    <>
                      <span
                        className={cx(
                          'absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-6 flex-col-reverse gap-0.5 overflow-hidden rounded-t-[4px] transition-opacity',
                          dim ? 'opacity-60' : 'opacity-100',
                          'group-hover:brightness-110',
                        )}
                        style={{ height: `${pctH}%` }}
                      >
                        {m.segs.map((s) => (
                          <span
                            key={s.key}
                            className="block min-h-0 w-full"
                            style={{ flex: `${s.total} 1 0px`, background: s.color, opacity: m.full ? 1 : 0.55 }}
                          />
                        ))}
                        {!m.full ? <span className="pointer-events-none absolute inset-0" style={{ backgroundImage: HATCH }} /> : null}
                      </span>
                    </>
                  );
                  const cls = cx('group relative h-full min-w-0 flex-1 cursor-pointer rounded-sm', isSel && 'ring-1 ring-inset ring-line2');
                  return wide ? (
                    <button
                      key={m.month}
                      type="button"
                      aria-pressed={isSel}
                      aria-label={ariaFor(m, isSel)}
                      onClick={() => onSelect(m.month)}
                      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(i); }}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setHover(null); }}
                      className={cx(cls, 'focus-visible:outline-2 focus-visible:outline-accent')}
                    >
                      {body}
                    </button>
                  ) : (
                    <div key={m.month} onClick={() => onSelect(m.month)} className={cls}>{body}</div>
                  );
                })}
              </div>
              {/* o valor escrito fica numa camada à parte: dentro do botão ele brigaria com o nome acessível */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex gap-0.5 sm:gap-1">
                {stacks.map((m, i) => {
                  const isSel = selected === m.month;
                  // o tooltip já mostra o total do mês sob o mouse
                  const show = m.height > 0 && (isSel || (selected == null && hover == null && i === peak));
                  // nas pontas o rótulo encosta na borda do gráfico em vez de vazar
                  const edge = i === 0 ? 'left-0' : i === n - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2';
                  return (
                    <div key={m.month} className="relative h-full min-w-0 flex-1">
                      {show ? (
                        <span
                          className={cx('tnum absolute text-xs leading-none whitespace-nowrap pointer-fine:lg:text-[11px]', edge, isSel ? 'text-ink' : 'text-muted')}
                          style={{ bottom: `calc(${(m.height / top) * 100}% + 5px)` }}
                        >
                          {usdAxis(m.total)}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {tip && hover != null ? (
                <div
                  aria-hidden="true"
                  className="absolute z-10 w-max max-w-full rounded-md border border-line2 bg-panel2/95 px-2.5 py-1.5 text-xs leading-4 shadow-lg pointer-fine:lg:text-[11px]"
                  // compacto e acima da barra; left X% com translate −X% segura o tooltip dentro do gráfico nas pontas
                  style={{
                    left: `${((hover + 0.5) / n) * 100}%`,
                    transform: `translateX(-${((hover + 0.5) / n) * 100}%)`,
                    bottom: `calc(${(tip.height / top) * 100}% + 6px)`,
                  }}
                >
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-muted">{capitalize(monthLabel(tip.month))} {tip.month.slice(0, 4)}{!tip.full ? ` · ${tr('partial', 'parcial')}` : ''}</span>
                    <span className="tnum font-semibold text-ink">{usd(tip.total)}</span>
                    <span className="tnum text-faint">· {num(tip.count, 0)} {tip.count === 1 ? tr('purchase', 'compra') : tr('purchases', 'compras')}</span>
                  </div>
                  {/* na ordem da pilha: de cima para baixo, como o olho lê a barra */}
                  {[...tip.segs].reverse().map((sg) => (
                    <div key={sg.key} className="flex items-center gap-1.5 whitespace-nowrap">
                      <LineKey color={sg.color} />
                      <span className="tnum text-ink">{usd(sg.total)}</span>
                      <span className="min-w-0 truncate text-muted">{sg.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {wide ? (
            <div className="mt-1.5 flex gap-0.5 sm:gap-1" aria-hidden="true">
              {stacks.map((m, i) => {
                const year = i === 0 || m.month.endsWith('-01');
                return (
                  <div key={m.month} className="min-w-0 flex-1 text-center leading-tight">
                    <div className={cx('text-[11px]', selected === m.month ? 'font-medium text-ink' : 'text-faint')}>{monthLabel(m.month)}</div>
                    <div className="h-3.5 overflow-visible whitespace-nowrap text-[11px] text-faint">{year ? m.month.slice(0, 4) : ''}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            // celular: a inicial de cada mês sob a barra, e o primeiro e o último com o ano; o nome inteiro está nos chips
            <div aria-hidden="true">
              <div className="mt-1.5 flex gap-0.5 text-center text-xs leading-none text-faint">
                {stacks.map((m) => <span key={m.month} className={cx('min-w-0 flex-1', selected === m.month && 'font-medium text-ink')}>{monthInitial(m.month)}</span>)}
              </div>
              <div className="mt-1.5 flex justify-between gap-3 text-xs text-faint">
                <span>{stacks[0] ? monthYearLabel(stacks[0].month) : ''}</span>
                <span>{n > 1 ? monthYearLabel(stacks[n - 1].month) : ''}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {wide ? null : <MonthChipTrack stacks={stacks} selected={selected} onSelect={onSelect} />}
    </div>
  );
}

/** Celular: um chip por mês (o mais recente à direita, já à vista), mesmo toggle das barras. */
function MonthChipTrack({ stacks, selected, onSelect }: {
  stacks: MonthStack[];
  selected: string | null;
  onSelect: (month: string) => void;
}) {
  const tr = useTr();
  const trackRef = useRef<HTMLDivElement>(null);
  // sem filtro, a trilha abre no fim (mês mais recente); com filtro, no chip escolhido
  useEffect(() => centerChip(trackRef.current, '[aria-pressed="true"]', true), [selected]);
  return (
    <div ref={trackRef} role="group" aria-label={tr('Filter by month', 'Filtrar por mês')} className={cx(CHIP_TRACK, 'mt-3')}>
      {stacks.map((m, i) => {
        const isSel = selected === m.month;
        return (
          <button
            key={m.month}
            type="button"
            aria-pressed={isSel}
            onClick={() => onSelect(m.month)}
            className={cx(
              'min-h-11 shrink-0 snap-start cursor-pointer rounded-lg border px-3 py-1.5 text-left transition-colors',
              isSel ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink',
            )}
          >
            <div className="text-xs font-medium">
              {capitalize(monthLabel(m.month))}
              {i === 0 || m.month.endsWith('-01') ? <span className={cx('ml-1 font-normal', isSel ? 'text-accent/80' : 'text-faint')}>{m.month.slice(2, 4)}</span> : null}
            </div>
            <div className={cx('tnum text-xs', isSel ? 'text-accent/80' : 'text-faint')}>
              {usdAxis(m.total)}{m.full ? '' : `\u00a0· ${tr('partial', 'parcial')}`}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export interface RankRow {
  key: string;
  label: ReactNode;
  value: number;
  valueLabel: string;
  /** Cor da barra; sem cor, cinza neutro (uma série só) */
  color?: string;
  /** Linha logo abaixo do nome (ex.: categoria) */
  sub?: ReactNode;
  /** Linha miúda sob a barra: %, nº de compras, datas */
  detail?: ReactNode;
}

/**
 * Ranking em barras horizontais finas; cada linha é um botão que liga/desliga um filtro. O nome acessível é o
 * próprio texto da linha; a instrução ("clique para filtrar") vai em `describedBy`. Com um filtro ligado, as
 * outras linhas apagam só a barra: o texto mantém o contraste.
 */
export function RankBars({
  rows,
  max,
  active,
  onSelect,
  describedBy,
}: {
  rows: RankRow[];
  max?: number;
  active?: string;
  onSelect?: (key: string) => void;
  describedBy?: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-0.5">
      {rows.map((r) => {
        const isActive = active === r.key;
        const dim = active != null && !isActive;
        return (
          <button
            key={r.key}
            type="button"
            aria-pressed={isActive}
            aria-describedby={describedBy}
            onClick={() => onSelect?.(r.key)}
            className={cx(
              'group block w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              isActive ? 'bg-panel2 ring-1 ring-inset ring-line2' : 'hover:bg-panel2/60',
            )}
          >
            <div className="flex items-baseline gap-3 text-sm">
              <span className={cx('line-clamp-2 min-w-0 flex-1 break-words', isActive ? 'text-ink' : dim ? 'text-muted' : 'text-ink/90')}>{r.label}</span>
              <span className={cx('tnum shrink-0 font-medium', dim ? 'text-muted' : 'text-ink')}>{r.valueLabel}</span>
            </div>
            {r.sub ? <div className="mt-0.5 truncate text-xs text-faint pointer-fine:lg:text-[11px]">{r.sub}</div> : null}
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] bg-line">
              <div
                className={cx('h-full rounded-r-[3px] transition-opacity', dim && 'opacity-60 group-hover:opacity-100')}
                style={{ width: `${Math.max(0.5, (r.value / top) * 100)}%`, background: r.color ?? 'var(--color-muted)' }}
              />
            </div>
            {r.detail ? <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-faint pointer-fine:lg:text-[11px]">{r.detail}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

export type HeatMetric = 'count' | 'total';

/** Semana começando na segunda: o fim de semana fica junto, no fim */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
// índice 0 = domingo, como em HeatCell.weekday
const WEEKDAY_SHORT: Record<Locale, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
};
const WEEKDAY_LONG: Record<Locale, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  pt: ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'],
};

export const weekdayLong = (d: number, locale: Locale) => WEEKDAY_LONG[locale][d];

/** "3pm" em inglês, "15h" em português; 24 fecha o dia */
function hourLabel(h: number, locale: Locale): string {
  if (locale === 'pt') return `${h}h`;
  return `${h % 12 === 0 ? 12 : h % 12}${h % 24 < 12 ? 'am' : 'pm'}`;
}

export const hourRange = (from: number, to: number, locale: Locale) => `${hourLabel(from, locale)}–${hourLabel(to, locale)}`;

const cellValue = (c: HeatCell, metric: HeatMetric) => (metric === 'total' ? c.total : c.count);

/**
 * Rampa de uma cor só: painel → destaque. Contagem é linear; valor usa raiz quadrada, senão poucas compras
 * grandes apagam o resto do mapa.
 */
function heatColor(v: number, max: number, metric: HeatMetric): string {
  if (v <= 0 || max <= 0) return 'var(--color-panel2)';
  const f = metric === 'total' ? Math.sqrt(v / max) : v / max;
  const p = Math.round(12 + 88 * f);
  return `color-mix(in oklab, var(--color-accent) ${p}%, var(--color-panel2))`;
}

function cellText(c: HeatCell, locale: Locale): string {
  return `${weekdayLong(c.weekday, locale)}, ${hourRange(c.hour, c.hour + 1, locale)}`;
}

/**
 * Mapa de calor dia da semana × hora. Na tela larga, 7 linhas × 24 colunas; no celular, transposto
 * (24 linhas × 7 colunas) para caber sem rolagem horizontal.
 */
export function Heatmap({ cells, metric, ariaLabel }: { cells: HeatCell[]; metric: HeatMetric; ariaLabel: string }) {
  const { locale } = useLocale();
  const tr = useTr();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...cells.map((c) => cellValue(c, metric)));
  const purchases = (n: number) => `${num(n, 0)}\u00a0${n === 1 ? tr('purchase', 'compra') : tr('purchases', 'compras')}`;
  const peak = cells.reduce((best, c, i) => (cellValue(c, metric) > cellValue(cells[best], metric) ? i : best), 0);
  const shown = hover ?? peak;
  const cur = cells[shown];
  const at = (weekday: number, hour: number) => weekday * 24 + hour;

  const cell = (i: number, className: string) => {
    const c = cells[i];
    return (
      <div
        key={i}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(i); }}
        onPointerDown={() => setHover(i)}
        className={cx(className, 'rounded-[3px] transition-[outline-color]', hover === i ? 'outline-1 outline-ink' : 'outline-1 outline-transparent')}
        style={{ background: heatColor(cellValue(c, metric), max, metric), outlineStyle: 'solid' }}
      />
    );
  };

  return (
    <div>
      <div className="mb-3 min-h-10 rounded-lg border border-line bg-panel2/40 px-3 py-2 text-xs" aria-live="polite">
        {cur && cur.count > 0 ? (
          <>
            <span className="text-faint">{hover == null ? tr('Peak: ', 'Pico: ') : ''}</span>
            <span className="text-muted">{cellText(cur, locale)}</span>
            <span className="text-faint"> · </span>
            <span className="tnum font-medium text-ink">{metric === 'count' ? purchases(cur.count) : usd(cur.total)}</span>
            <span className="tnum text-faint"> · {metric === 'count' ? usd(cur.total) : purchases(cur.count)}</span>
          </>
        ) : cur ? (
          <span className="text-faint">{capitalize(cellText(cur, locale))}: {tr('no purchases', 'nenhuma compra')}</span>
        ) : null}
      </div>

      <div role="img" aria-label={ariaLabel} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}>
        {/* tela larga: dias nas linhas, horas nas colunas */}
        <div className="hidden sm:block">
          <div className="grid gap-0.5" style={{ gridTemplateColumns: '2.25rem repeat(24, minmax(0, 1fr))' }}>
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="tnum pb-1 text-xs leading-none whitespace-nowrap text-faint pointer-fine:text-[11px]">{h % 3 === 0 ? hourLabel(h, locale) : ''}</span>
            ))}
            {WEEK_ORDER.map((d) => (
              <div key={d} className="contents">
                <span className="flex items-center text-xs text-faint pointer-fine:text-[11px]">{WEEKDAY_SHORT[locale][d]}</span>
                {Array.from({ length: 24 }, (_, h) => cell(at(d, h), 'h-7'))}
              </div>
            ))}
          </div>
        </div>
        {/* celular: horas nas linhas, dias nas colunas */}
        <div className="sm:hidden">
          <div className="grid gap-0.5" style={{ gridTemplateColumns: '2.5rem repeat(7, minmax(0, 1fr))' }}>
            <span />
            {WEEK_ORDER.map((d) => (
              <span key={d} className="pb-1 text-center text-xs leading-none text-faint">{WEEKDAY_SHORT[locale][d]}</span>
            ))}
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="contents">
                <span className="tnum flex items-center text-xs leading-none whitespace-nowrap text-faint">{h % 3 === 0 ? hourLabel(h, locale) : ''}</span>
                {WEEK_ORDER.map((d) => cell(at(d, h), 'h-4'))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-faint pointer-fine:lg:text-[11px]" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          {tr('less', 'menos')}
          {[0.08, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} className="inline-block size-3 rounded-[3px]" style={{ background: heatColor(f, 1, 'count') }} />
          ))}
          {tr('more', 'mais')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-[3px] bg-panel2 ring-1 ring-inset ring-line" />
          {tr('no purchases', 'nenhuma compra')}
        </span>
      </div>
    </div>
  );
}
