import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { usd, usdTick, axisUnit, num, pctSigned, dateShort } from '../lib/format';
import { cx } from '../lib/cx';
import { pick, type Locale } from '../lib/locale';
import type { ProjectionPoint } from '../lib/borrow';
import type { Candle } from '../lib/prices';
import { useTr } from '../state/locale';
import { EARN_COLORS } from './earningsData';
import { AsTable } from './charts';

// Os dois gráficos da tela Empréstimo, em SVG medido (o texto não estica): o "quanto o rendimento já pagou" da dívida,
// com marcas de 25/50/75/100% que a pessoa liga e desliga, e os candles de um ativo com a faixa de atenção e a de
// liquidação. Mesmo vocabulário dos outros gráficos do app: grade fina, eixo com a unidade escrita uma vez, tabela
// gêmea para quem não vê o desenho.

export const BORROW_COLORS = {
  yield: EARN_COLORS.liquidusd,
  cashback: EARN_COLORS.cashback,
  debt: '#f3f0e8',
} as const;

/** Largura do contêiner, medida (o SVG desenha na escala 1:1 e o texto fica com o tamanho certo). */
function useWidth(ref: RefObject<HTMLElement | null>, fallback = 640): number {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = Math.round(entries[0]?.contentRect.width ?? 0);
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Marcas "redondas" entre min e max (3 a 5 marcas). */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export function monthLabelFrom(start: Date, m: number, locale: string): string {
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1));
  return new Intl.DateTimeFormat(locale === 'pt' ? 'pt-BR' : 'en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d).replace(/ de /, ' ');
}

/** "8 meses", "2 anos e 3 meses", "menos de 1 mês". */
export function durationText(months: number, locale: Locale): string {
  if (months < 1) return pick(locale, 'under a month', 'menos de 1 mês');
  if (months < 24) return pick(locale, `${months} ${months === 1 ? 'month' : 'months'}`, `${months} ${months === 1 ? 'mês' : 'meses'}`);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const yy = pick(locale, `${y} years`, `${y} anos`);
  return m ? pick(locale, `${yy} and ${m} ${m === 1 ? 'month' : 'months'}`, `${yy} e ${m} ${m === 1 ? 'mês' : 'meses'}`) : yy;
}

// ---------- quanto o rendimento já pagou ----------

export interface PaidMark {
  share: number;
  month: number;
}

/**
 * O lucro da garantia (área azul: o rendimento menos os juros do empréstimo, acumulados), com o cashback por cima quando
 * ligado (área aqua), contra o valor emprestado (linha clara, reta: os juros já saíram do azul). Cada marca ligada vira uma linha vertical no mês em que o somado chega
 * àquela parte do devido ("50% · mar. 2027"); a de 100% diz o mês e quanto tempo falta ("Tudo pago · abr. 2029 · em 2
 * anos e 5 meses").
 */
export function ProjectionChart({ points, marks, showCashback, start, locale, label }: {
  points: readonly ProjectionPoint[];
  marks: readonly PaidMark[];
  showCashback: boolean;
  start: Date;
  locale: Locale;
  label: string;
}) {
  const tr = useTr();
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [hover, setHover] = useState<number | null>(null);
  const H = width < 480 ? 230 : 270;
  const pad = { l: 44, r: 12, t: 44, b: 26 };
  const n = points.length - 1;
  const top = Math.max(1, ...points.map((p) => Math.max(p.debt, p.cumYield + (showCashback ? p.cumCashback : 0))));
  // o lucro fica negativo quando os juros passam do rendimento: a escala desce abaixo de zero
  const bottom = Math.min(0, ...points.map((p) => p.cumYield));
  const ticks = niceTicks(bottom < 0 ? bottom * 1.05 : 0, top * 1.05);
  const yMax = ticks[ticks.length - 1] || top;
  const yMin = Math.min(0, ticks[0]);
  const x = (m: number) => pad.l + (n > 0 ? (m / n) * (width - pad.l - pad.r) : 0);
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  const area = (f: (p: ProjectionPoint) => number, g: (p: ProjectionPoint) => number) =>
    `M${points.map((p) => `${x(p.month)},${y(f(p))}`).join('L')}L${[...points].reverse().map((p) => `${x(p.month)},${y(g(p))}`).join('L')}Z`;
  const line = (f: (p: ProjectionPoint) => number) => `M${points.map((p) => `${x(p.month)},${y(f(p))}`).join('L')}`;
  const yearStep = n <= 18 ? 3 : n <= 36 ? 6 : n <= 72 ? 12 : 24;
  // marcas do eixo do tempo: o passo cresce até caberem (≈ 90px por rótulo "Nov 2028")
  const fit = Math.max(2, Math.floor((width - pad.l - pad.r) / 90));
  const tickStep = [yearStep, yearStep * 2, yearStep * 3, yearStep * 4, yearStep * 6].find((st) => n / st <= fit) ?? yearStep * 6;
  const xTicks = points.filter((p) => p.month % tickStep === 0 && (p.month === 0 || n - p.month >= tickStep / 2 || p.month === n));
  const earned = (p: ProjectionPoint) => p.cumYield + (showCashback ? p.cumCashback : 0);
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const m = Math.round(((e.clientX - r.left - pad.l) / (width - pad.l - pad.r)) * n);
    setHover(Math.max(0, Math.min(n, m)));
  };
  const hp = hover !== null ? points[hover] : null;
  const flip = hp && x(hp.month) + 210 > width;
  const visibleMarks = marks.filter((mk) => mk.month <= n).sort((a, b) => a.share - b.share);
  return (
    <div>
      <div ref={box} className="relative w-full select-none">
        <svg width={width} height={H} role="img" aria-label={label} className="block touch-pan-y" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <text x={pad.l - 6} y={pad.t - 10} textAnchor="end" className="fill-faint text-[11px]">{axisUnit()}</text>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="tnum fill-faint text-[11px]">{usdTick(t)}</text>
            </g>
          ))}
          {xTicks.map((p) => (
            <text key={p.month} x={x(p.month)} y={H - 8} textAnchor={p.month === 0 ? 'start' : p.month === n ? 'end' : 'middle'} className="fill-faint text-[11px]">
              {p.month === 0 ? tr('now', 'hoje') : monthLabelFrom(start, p.month, locale)}
            </text>
          ))}
          <path d={area((p) => p.cumYield, () => 0)} fill={BORROW_COLORS.yield} fillOpacity={0.28} />
          <path d={line((p) => p.cumYield)} fill="none" stroke={BORROW_COLORS.yield} strokeWidth={2} />
          {showCashback ? (
            <>
              <path d={area((p) => p.cumYield + p.cumCashback, (p) => p.cumYield)} fill={BORROW_COLORS.cashback} fillOpacity={0.28} />
              <path d={line((p) => p.cumYield + p.cumCashback)} fill="none" stroke={BORROW_COLORS.cashback} strokeWidth={2} />
            </>
          ) : null}
          <path d={line((p) => p.debt)} fill="none" stroke={BORROW_COLORS.debt} strokeWidth={2} strokeDasharray="6 4" />
          {visibleMarks.map((mk, i) => {
            const full = mk.share >= 1;
            const px = x(mk.month);
            // no celular, as marcas de 5% e 10% ficam sem rótulo (muito perto do começo); a lista embaixo diz o mês
            const narrow = width < 520;
            const showLabel = !narrow || mk.share >= 0.25;
            // rótulos em duas alturas alternadas: marcas próximas não se atropelam
            const ly = 8 + (i % 2) * 13;
            return (
              <g key={mk.share}>
                <line x1={px} x2={px} y1={ly + 6} y2={H - pad.b} stroke="var(--color-ink)" strokeOpacity={full ? 0.75 : 0.3} strokeWidth={full ? 1.5 : 1} strokeDasharray={full ? undefined : '3 3'} />
                <circle cx={px} cy={y(earned(points[mk.month]))} r={full ? 5 : 3.5} fill={BORROW_COLORS.yield} stroke="var(--color-panel)" strokeWidth={2} />
                {showLabel ? (
                  <text x={px} y={ly + 2} textAnchor={px > width - 24 ? 'end' : 'middle'} className={cx('tnum text-[11px]', full ? 'fill-ink font-semibold' : 'fill-muted font-medium')}>
                    {num(mk.share * 100, 0)}%
                  </text>
                ) : null}
              </g>
            );
          })}
          {hp ? <line x1={x(hp.month)} x2={x(hp.month)} y1={pad.t} y2={H - pad.b} stroke="var(--color-line2)" strokeWidth={1} /> : null}
        </svg>
        {hp ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-10 z-10 w-[200px] rounded-lg border border-line2 bg-bg/95 px-3 py-2 text-xs shadow-lg"
            style={{ left: flip ? Math.max(0, x(hp.month) - 210) : x(hp.month) + 10 }}
          >
            <div className="mb-1 flex justify-between gap-2 font-medium text-ink">
              <span>{hp.month === 0 ? tr('Today', 'Hoje') : monthLabelFrom(start, hp.month, locale)}</span>
              <span className="tnum text-good">{hp.debt > 0 ? `${num(Math.min(100, (earned(hp) / hp.debt) * 100), 0)}% ${tr('paid', 'pago')}` : ''}</span>
            </div>
            <TipRow color="transparent" label={tr('Vault earned', 'O cofre rendeu')} value={usd(hp.cumYield + hp.cumInterest)} />
            <TipRow color="transparent" label={tr('− loan interest', '− juros do empréstimo')} value={usd(hp.cumInterest)} />
            <TipRow color={BORROW_COLORS.yield} label={tr('= profit', '= lucro')} value={usd(hp.cumYield)} />
            {showCashback ? <TipRow color={BORROW_COLORS.cashback} label={tr('+ cashback', '+ cashback')} value={usd(hp.cumCashback)} /> : null}
            <TipRow color={BORROW_COLORS.debt} dashed label={tr('Borrowed', 'Emprestado')} value={usd(hp.debt)} />
          </div>
        ) : null}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <Legend color={BORROW_COLORS.yield} label={tr('Profit: vault yield − loan interest', 'Lucro: rendimento do cofre − juros do empréstimo')} />
        {showCashback ? <Legend color={BORROW_COLORS.cashback} label={tr('+ the card cashback', '+ o cashback do cartão')} /> : null}
        <Legend color={BORROW_COLORS.debt} dashed label={tr('What you borrowed', 'O que você pegou emprestado')} />
      </ul>
      {marks.length ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={tr('When the profit reaches each part of the loan', 'Quando o lucro chega a cada parte do empréstimo')}>
          {[...marks].sort((a, b) => a.share - b.share).map((mk) => (
            <li key={mk.share} className={cx('tnum', mk.share >= 1 ? 'font-medium text-ink' : 'text-muted')}>
              {num(mk.share * 100, 0)}% · {monthLabelFrom(start, mk.month, locale)}
              {mk.share >= 1 ? <span className="text-faint"> · {tr('in ', 'em ')}{durationText(mk.month, locale)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {tr(
          'Blue is the profit of the collateral: what the vault has earned minus the loan interest, added up month by month. The dashed line is what you borrowed. Each vertical line is the month the profit reaches that part of the loan; at 100%, the profit alone would repay it.',
          'O azul é o lucro da garantia: o que o cofre rendeu menos os juros do empréstimo, somado mês a mês. A linha tracejada é o que você pegou emprestado. Cada linha vertical é o mês em que o lucro chega àquela parte do empréstimo; em 100%, só o lucro já pagaria tudo.',
        )}
        {showCashback
          ? tr(' Green, on top, adds the card cashback (your spending is paid with your own money, so it doesn’t add to the loan).', ' O verde, em cima, soma o cashback do cartão (o gasto é pago com o seu dinheiro, então não aumenta o empréstimo).')
          : ''}
      </p>
      <div className="mt-2">
        <AsTable label={label}>
          <table className="w-full text-left text-xs">
            <thead className="text-faint">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{tr('Month', 'Mês')}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Profit', 'Lucro')}</th>
                {showCashback ? <th scope="col" className="px-3 py-2 text-right font-medium">Cashback</th> : null}
                <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Borrowed', 'Emprestado')}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{tr('Paid', 'Pago')}</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {points.filter((p) => p.month % yearStep === 0 || marks.some((mk) => mk.month === p.month)).map((p) => (
                <tr key={p.month} className="border-t border-line">
                  <th scope="row" className="px-3 py-1.5 font-normal text-muted">{p.month === 0 ? tr('Today', 'Hoje') : monthLabelFrom(start, p.month, locale)}</th>
                  <td className="px-3 py-1.5 text-right">{usd(p.cumYield)}</td>
                  {showCashback ? <td className="px-3 py-1.5 text-right">{usd(p.cumCashback)}</td> : null}
                  <td className="px-3 py-1.5 text-right">{usd(p.debt)}</td>
                  <td className="px-3 py-1.5 text-right">{p.debt > 0 ? `${num(Math.min(100, (earned(p) / p.debt) * 100), 0)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsTable>
      </div>
    </div>
  );
}

function TipRow({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Swatch color={color} dashed={dashed} />
        {label}
      </span>
      <span className="tnum text-ink">{value}</span>
    </div>
  );
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return dashed
    ? <span aria-hidden className="inline-block h-0 w-3 border-t-2 border-dashed" style={{ borderColor: color }} />
    : <span aria-hidden className="inline-block size-2 rounded-[3px]" style={{ backgroundColor: color }} />;
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <Swatch color={color} dashed={dashed} />
      {label}
    </li>
  );
}

// ---------- candles com atenção e liquidação ----------

export interface PriceLine {
  id: string;
  price: number;
  label: string;
  tone: 'bad' | 'orange' | 'caution' | 'info';
  style: 'solid' | 'dashed' | 'dotted';
}

const TONE = { bad: 'var(--color-bad)', orange: 'var(--color-orange)', caution: 'var(--color-caution)', info: 'var(--color-info)' } as const;

/**
 * Candles do ativo com os três degraus de risco, cada um com a sua faixa: aviso (amarelo, até a atenção), atenção
 * (laranja, quando o cartão para, até a liquidação) e a liquidação (vermelha, até a borda no sentido do risco). Uma linha longe demais para caber sem achatar as velas
 * (queda maior que 55%, alta maior que 80%) fica presa na borda, com uma seta e a distância. A legenda do topo mostra a
 * vela apontada (ou a última): data, abertura, máxima, mínima, fechamento.
 */
export function CandleChart({ candles, lines, zone, label, unit, intraday }: {
  candles: readonly Candle[];
  lines: readonly PriceLine[];
  zone: { liquidation: number | null; attention: number | null; warning: number | null; direction: 'drop' | 'rise' } | null;
  label: string;
  unit: string;
  /** Velas de 6 h: a legenda leva a hora */
  intraday: boolean;
}) {
  const tr = useTr();
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [hover, setHover] = useState<number | null>(null);
  const [cursorY, setCursorY] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const H = width < 480 ? 250 : 300;
  const pad = { l: 8, r: 66, t: 40, b: 26 };
  const last = candles[candles.length - 1];
  const now = last.c;
  const lo = Math.min(...candles.map((c) => c.l));
  const hi = Math.max(...candles.map((c) => c.h));
  // o que cabe sem achatar as velas: até −55% e +80% do preço de hoje
  const fits = (p: number) => p >= now * 0.45 && p <= now * 1.8;
  const inRange = lines.filter((l) => fits(l.price));
  let yLo = Math.min(lo, ...inRange.map((l) => l.price));
  let yHi = Math.max(hi, ...inRange.map((l) => l.price));
  const span = yHi - yLo || yHi * 0.1;
  yLo = Math.max(0, yLo - span * 0.07);
  yHi += span * 0.07;
  const plotW = width - pad.l - pad.r;
  const plotTop = pad.t;
  const plotBottom = H - pad.b;
  const step = plotW / candles.length;
  const bodyW = Math.max(1, Math.min(14, step * 0.64));
  const x = (i: number) => pad.l + step * (i + 0.5);
  const y = (v: number) => plotTop + (1 - (v - yLo) / (yHi - yLo)) * (plotBottom - plotTop);
  const priceAt = (py: number) => yLo + (1 - (py - plotTop) / (plotBottom - plotTop)) * (yHi - yLo);
  const ticks = niceTicks(yLo, yHi, 4).filter((t) => t >= yLo && t <= yHi);
  const nTicks = width < 480 ? 3 : 4;
  const xTickIdx = Array.from({ length: nTicks }, (_, k) => Math.round((k * (candles.length - 1)) / (nTicks - 1)));
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - pad.l) / step);
    setHover(Math.max(0, Math.min(candles.length - 1, i)));
    const py = e.clientY - r.top;
    setCursorY(py >= plotTop && py <= plotBottom ? py : null);
  };
  const shown = hover !== null ? candles[hover] : last;
  const up = shown.c >= shown.o;
  const when = (t: number) => {
    const iso = new Date(t).toISOString();
    return intraday ? `${dateShort(iso)} ${iso.slice(11, 16)}` : dateShort(iso);
  };
  const liq = zone?.liquidation ?? null;
  const att = zone?.attention ?? null;
  const drop = zone?.direction !== 'rise';
  // a faixa começa onde a linha está (ou na borda, quando ela fica fora da escala)
  const zoneEdge = drop ? plotBottom : plotTop;
  const liqY = liq !== null ? (fits(liq) ? y(liq) : zoneEdge) : null;
  const attY = att !== null ? (fits(att) ? y(att) : zoneEdge) : null;
  const warnPrice = zone?.warning ?? null;
  const warnY = warnPrice !== null ? (fits(warnPrice) ? y(warnPrice) : zoneEdge) : null;
  // a faixa de um degrau vai da linha dele até a do próximo (ou até a borda, quando não há próximo)
  const band = (from: number | null, to: number | null) => {
    if (from === null) return null;
    const end = to ?? zoneEdge;
    return Math.abs(end - from) > 0.5 ? { y: Math.min(from, end), h: Math.abs(end - from) } : null;
  };
  const warnBand = band(warnY, attY ?? liqY);
  const attBand = band(attY, liqY);
  const pinned = lines.filter((l) => !fits(l.price));
  return (
    <div>
      <div ref={box} className="relative w-full select-none">
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={label}
          className="block touch-pan-y"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => { setHover(null); setCursorY(null); }}
        >
          <defs>
            <linearGradient id={`liq-${gid}`} x1="0" x2="0" y1={drop ? '0' : '1'} y2={drop ? '1' : '0'}>
              <stop offset="0%" stopColor="var(--color-bad)" stopOpacity={0.1} />
              <stop offset="100%" stopColor="var(--color-bad)" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          {/* zonas atrás de tudo: âmbar (atenção) até a linha da liquidação, vermelha da liquidação à borda */}
          {warnBand ? <rect x={pad.l} width={plotW} y={warnBand.y} height={warnBand.h} fill="var(--color-caution)" fillOpacity={0.07} /> : null}
          {attBand ? <rect x={pad.l} width={plotW} y={attBand.y} height={attBand.h} fill="var(--color-orange)" fillOpacity={0.11} /> : null}
          {liqY !== null ? (
            <rect x={pad.l} width={plotW} y={drop ? liqY : plotTop} height={Math.max(0, drop ? plotBottom - liqY : liqY - plotTop)} fill={`url(#liq-${gid})`} />
          ) : null}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
              {/* a marca do eixo some quando cai embaixo de uma pílula (preço de hoje ou uma linha) */}
              {[now, ...inRange.map((l) => l.price)].some((p) => Math.abs(y(p) - y(t)) < 13) ? null : (
                <text x={width - pad.r + 8} y={y(t) + 4} className="tnum fill-faint text-[11px]">{usdTick(t)}</text>
              )}
            </g>
          ))}
          {xTickIdx.map((i, k) => (
            <text key={k} x={x(i)} y={H - 8} textAnchor={k === 0 ? 'start' : k === xTickIdx.length - 1 ? 'end' : 'middle'} className="fill-faint text-[11px]">
              {dateShort(new Date(candles[i].t).toISOString())}
            </text>
          ))}
          {candles.map((c, i) => {
            const rise = c.c >= c.o;
            const color = rise ? 'var(--color-good)' : 'var(--color-bad)';
            const top = y(Math.max(c.o, c.c));
            const h = Math.max(1, Math.abs(y(c.o) - y(c.c)));
            return (
              <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.55}>
                <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
                <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={h} rx={bodyW > 4 ? 1 : 0} fill={color} />
              </g>
            );
          })}
          {inRange.map((l) => (
            <g key={l.id}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={y(l.price)}
                y2={y(l.price)}
                stroke={TONE[l.tone]}
                strokeWidth={l.style === 'solid' ? 1.5 : 1.25}
                strokeDasharray={l.style === 'dashed' ? '6 4' : l.style === 'dotted' ? '2 3' : undefined}
              />
              <text x={pad.l + 6} y={y(l.price) - 5} className="tnum text-[11px] font-semibold" fill={TONE[l.tone]}>
                {l.label} · {pctSigned(((l.price - now) / now) * 100)}
              </text>
              <rect x={width - pad.r + 2} y={y(l.price) - 9} width={pad.r - 4} height={18} rx={5} fill={TONE[l.tone]} />
              <text x={width - pad.r / 2 + 1} y={y(l.price) + 4} textAnchor="middle" className="tnum text-[11px] font-semibold" fill="var(--color-bg)">{usdTick(l.price)}</text>
            </g>
          ))}
          {pinned.map((l, k) => {
            const below = l.price < now;
            const py = below ? plotBottom - 12 - k * 22 : plotTop + 12 + k * 22;
            return (
              <g key={l.id}>
                <rect x={pad.l + 4} y={py - 9} width={Math.min(plotW - 8, 250)} height={18} rx={9} fill="var(--color-bg)" stroke={TONE[l.tone]} strokeOpacity={0.7} />
                <text x={pad.l + 14} y={py + 4} className="tnum text-[11px] font-semibold" fill={TONE[l.tone]}>
                  {below ? '↓' : '↑'} {l.label} {usd(l.price)} · {pctSigned(((l.price - now) / now) * 100)}
                </text>
              </g>
            );
          })}
          <line x1={pad.l} x2={width - pad.r} y1={y(now)} y2={y(now)} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="2 3" />
          <rect x={width - pad.r + 2} y={y(now) - 9} width={pad.r - 4} height={18} rx={5} fill="var(--color-accent)" />
          <text x={width - pad.r / 2 + 1} y={y(now) + 4} textAnchor="middle" className="tnum text-[11px] font-semibold" fill="var(--color-accent-ink)">{usdTick(now)}</text>
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={plotTop} y2={plotBottom} stroke="var(--color-line2)" strokeWidth={1} /> : null}
          {cursorY !== null ? (
            <>
              <line x1={pad.l} x2={width - pad.r} y1={cursorY} y2={cursorY} stroke="var(--color-line2)" strokeWidth={1} strokeDasharray="3 3" />
              <rect x={width - pad.r + 2} y={cursorY - 9} width={pad.r - 4} height={18} rx={5} fill="var(--color-panel2)" stroke="var(--color-line2)" />
              <text x={width - pad.r / 2 + 1} y={cursorY + 4} textAnchor="middle" className="tnum fill-ink text-[11px]">{usdTick(priceAt(cursorY))}</text>
            </>
          ) : null}
          <text x={pad.l + 2} y={15} className="tnum text-[11px]">
            <tspan className="fill-faint">{when(shown.t)}</tspan>
            <tspan dx={8} className="fill-faint">O</tspan><tspan dx={3} className="fill-ink">{usdTick(shown.o)}</tspan>
            <tspan dx={7} className="fill-faint">H</tspan><tspan dx={3} className="fill-ink">{usdTick(shown.h)}</tspan>
            <tspan dx={7} className="fill-faint">L</tspan><tspan dx={3} className="fill-ink">{usdTick(shown.l)}</tspan>
            <tspan dx={7} className="fill-faint">C</tspan><tspan dx={3} fill={up ? 'var(--color-good)' : 'var(--color-bad)'}>{usdTick(shown.c)}</tspan>
          </text>
          {liq !== null ? (
            <text x={pad.l + 2} y={30} className="tnum fill-muted text-[11px]">
              {tr('to liquidation', 'até a liquidação')} {pctSigned(((liq - shown.c) / shown.c) * 100)}
            </text>
          ) : null}
        </svg>
      </div>
      <div className="mt-2">
        <AsTable label={label}>
          <table className="w-full text-left text-xs">
            <thead className="text-faint">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{tr('Line', 'Linha')}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{unit}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{tr('From today', 'De hoje')}</th>
              </tr>
            </thead>
            <tbody className="tnum">
              <tr className="border-t border-line">
                <th scope="row" className="px-3 py-1.5 font-normal text-muted">{tr('Today', 'Hoje')}</th>
                <td className="px-3 py-1.5 text-right">{usd(now)}</td>
                <td className="px-3 py-1.5 text-right">—</td>
              </tr>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <th scope="row" className="px-3 py-1.5 font-normal text-muted">{l.label}</th>
                  <td className="px-3 py-1.5 text-right">{usd(l.price)}</td>
                  <td className="px-3 py-1.5 text-right">{pctSigned(((l.price - now) / now) * 100)}</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <th scope="row" className="px-3 py-1.5 font-normal text-muted">{tr('Window low / high', 'Mínima / máxima da janela')}</th>
                <td className="px-3 py-1.5 text-right">{usd(lo)} / {usd(hi)}</td>
                <td className="px-3 py-1.5 text-right">{pctSigned(((lo - now) / now) * 100)}</td>
              </tr>
            </tbody>
          </table>
        </AsTable>
      </div>
    </div>
  );
}
