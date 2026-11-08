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

// Os dois gráficos da tela Empréstimo, em SVG medido (o texto não estica): o que o cofre rendeu contra o que você deve
// (o emprestado + os juros), com marcas de 5/10/25/50/75/100%, e os candles de um ativo com a faixa de atenção e a de
// liquidação. Mesmo vocabulário dos outros gráficos do app: grade fina, eixo com a unidade escrita uma vez, tabela
// gêmea para quem não vê o desenho.

export const BORROW_COLORS = {
  yield: EARN_COLORS.liquidusd,
  cashback: EARN_COLORS.cashback,
  debt: '#f3f0e8',
  /** Depois dos 100%: a faixa entre o rendido e o devido, o lucro depois de pagar (o verde de "bom" do tema) */
  leftOver: 'var(--color-good)',
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
  /** O mês da lista, da tabela e do "em 21 meses": o primeiro em que o rendido já passou da fração */
  month: number;
  /** Onde a curva cruza a fração, em meses fracionados (entre `month` − 1 e `month`): onde a marca é desenhada */
  at: number;
}

/** "9% pago": arredonda para baixo, para nenhum mês dizer 5% antes do mês em que a marca de 5% chega. */
const paidPct = (ratio: number) => Math.max(0, Math.min(100, Math.floor(ratio * 100 + 1e-9)));
/** Coberto: o rendido já passou do que se deve (daí em diante a tela fala do lucro, não de "% pago"). */
const covered = (earned: number, debt: number) => debt > 0 && earned >= debt;
/**
 * Depois dos 100%, o "% pago" continua como "% de lucro": o lucro (rendido − devido) sobre o que se deve, para baixo como
 * o "% pago" (147% do devido = "+47% de lucro"; no mês do cruzamento, +0%).
 */
export const profitPct = (earned: number, debt: number) => (debt > 0 ? Math.max(0, Math.floor((earned / debt - 1) * 100 + 1e-9)) : 0);

/**
 * O que o cofre rendeu (área azul: o rendimento bruto, acumulado), com o cashback por cima quando ligado (área aqua),
 * contra o que você deve (linha clara tracejada: o emprestado mais os juros, que entram na dívida e capitalizam; sobe um
 * pouco todo mês). Cada marca ligada vira uma linha vertical no instante em que o rendido cruza aquela parte do devido,
 * com o ponto exatamente na altura da fração (`at`, interpolado entre os dois meses vizinhos); a lista embaixo e a tabela
 * dizem o mês em que ela chega ("50% · mar. 2027"), e a de 100% quanto tempo falta ("em 2 anos e 5 meses"). As marcas
 * precisam vir da mesma conta do desenho: com `showCashback`, calculadas com o cashback.
 */
export function ProjectionChart({ points, marks, showCashback, start, locale, label, pinned = null, onPick }: {
  points: readonly ProjectionPoint[];
  marks: readonly PaidMark[];
  showCashback: boolean;
  start: Date;
  locale: Locale;
  label: string;
  /** O mês escolhido em "ao longo do tempo": uma linha fixa no gráfico (null = nenhuma) */
  pinned?: number | null;
  /** Clicar no gráfico escolhe aquele mês em "ao longo do tempo" */
  onPick?: (month: number) => void;
}) {
  const tr = useTr();
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  // a posição do ponteiro, em px dentro do SVG: vira o mês mais perto ou, perto de uma marca, a própria marca
  const [hoverX, setHoverX] = useState<number | null>(null);
  const H = width < 480 ? 230 : 270;
  const pad = { l: 44, r: 12, t: 44, b: 26 };
  const n = points.length - 1;
  const plotW = width - pad.l - pad.r;
  const earned = (p: ProjectionPoint) => p.cumYield + (showCashback ? p.cumCashback : 0);
  const top = Math.max(1, ...points.map((p) => Math.max(p.debt, earned(p))));
  // o rendimento não fica negativo com APY ≥ 0; a escala só desce abaixo de zero se um APY digitado for negativo
  const bottom = Math.min(0, ...points.map((p) => p.cumYield));
  const ticks = niceTicks(bottom < 0 ? bottom * 1.05 : 0, top * 1.05);
  // as marcas param na última redonda abaixo do máximo: sem uma a mais, a linha do emprestado (US$ 13k numa escala que
  // ia até 10k) ficava fora do gráfico
  const yStep = ticks.length > 1 ? ticks[1] - ticks[0] : top;
  while (ticks[ticks.length - 1] < top) ticks.push(ticks[ticks.length - 1] + yStep);
  const yMax = ticks[ticks.length - 1] || top;
  const yMin = Math.min(0, ticks[0]);
  const x = (m: number) => pad.l + (n > 0 ? (m / n) * plotW : 0);
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  // um valor entre dois meses, na reta que o desenho liga entre eles (os pontos vêm um por mês, a partir do 0)
  const lerp = (t: number, f: (p: ProjectionPoint) => number) => {
    const i = Math.max(0, Math.min(n, Math.floor(t)));
    const j = Math.min(n, i + 1);
    const w = Math.max(0, Math.min(1, t - i));
    return f(points[i]) * (1 - w) + f(points[j]) * w;
  };
  const area = (f: (p: ProjectionPoint) => number, g: (p: ProjectionPoint) => number) =>
    `M${points.map((p) => `${x(p.month)},${y(f(p))}`).join('L')}L${[...points].reverse().map((p) => `${x(p.month)},${y(g(p))}`).join('L')}Z`;
  const line = (f: (p: ProjectionPoint) => number) => `M${points.map((p) => `${x(p.month)},${y(f(p))}`).join('L')}`;
  const yearStep = n <= 18 ? 3 : n <= 36 ? 6 : n <= 72 ? 12 : 24;
  // marcas do eixo do tempo: o passo cresce até caberem (≈ 90px por rótulo "Nov 2028")
  const fit = Math.max(2, Math.floor(plotW / 90));
  const tickStep = [yearStep, yearStep * 2, yearStep * 3, yearStep * 4, yearStep * 6].find((st) => n / st <= fit) ?? yearStep * 6;
  const xTicks = points.filter((p) => p.month % tickStep === 0 && (p.month === 0 || n - p.month >= tickStep / 2 || p.month === n));
  const principal = points[0]?.debt ?? 0;
  const visibleMarks = marks.filter((mk) => mk.month <= n).sort((a, b) => a.share - b.share);
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left);
  const hoverMonth = hoverX === null || n <= 0 ? null : Math.max(0, Math.min(n, Math.round(((hoverX - pad.l) / plotW) * n)));
  // perto (6 px) de uma linha de marca e mais perto dela que do ponto do mês, o balão fala da marca; senão, do mês
  const hoverMark = hoverX === null || hoverMonth === null ? null : visibleMarks
    .map((mk) => ({ mk, d: Math.abs(x(mk.at) - hoverX) }))
    .filter((c) => c.d <= 6 && c.d < Math.abs(x(hoverMonth) - hoverX))
    .sort((a, b) => a.d - b.d)[0]?.mk ?? null;
  const tip = hoverMark
    ? { t: hoverMark.at, px: x(hoverMark.at) }
    : hoverMonth !== null ? { t: hoverMonth, px: x(hoverMonth) } : null;
  const flip = tip && tip.px + 210 > width;
  const tipVal = (f: (p: ProjectionPoint) => number) => (tip ? lerp(tip.t, f) : 0);
  // no instante da marca os valores são da reta entre dois meses: "≈"
  const approx = hoverMark ? '≈ ' : '';
  const reachedIn = (m: number) => visibleMarks.filter((mk) => mk.month === m).map((mk) => `${num(mk.share * 100, 0)}%`);
  // depois da marca de 100%: a faixa verde entre o devido (embaixo) e o rendido (em cima), do instante do cruzamento ao
  // fim da janela. É o lucro se o rendido pagasse o que se deve (o max segura um APY digitado menor que a taxa)
  const fullMark = visibleMarks.find((mk) => mk.share >= 1) ?? null;
  const after = fullMark ? points.filter((p) => p.month > fullMark.at) : [];
  const band = fullMark && after.length
    ? `M${x(fullMark.at)},${y(lerp(fullMark.at, (p) => p.debt))}`
      + after.map((p) => `L${x(p.month)},${y(Math.max(earned(p), p.debt))}`).join('')
      + [...after].reverse().map((p) => `L${x(p.month)},${y(p.debt)}`).join('')
      + 'Z'
    : null;
  // a área azul: até o rendido antes do cruzamento e até o devido depois, com o ponto exato do cruzamento no meio (sem
  // ele, a reta entre o último mês abaixo e o primeiro acima abriria uma fresta entre o azul e o verde)
  const blueArea = band && fullMark && !showCashback
    ? (() => {
        const before = points.filter((p) => p.month < fullMark.at);
        const top = [
          ...before.map((p) => `${x(p.month)},${y(p.cumYield)}`),
          `${x(fullMark.at)},${y(lerp(fullMark.at, (p) => p.debt))}`,
          ...after.map((p) => `${x(p.month)},${y(p.debt)}`),
        ];
        return `M${top.join('L')}L${x(n)},${y(0)}L${x(0)},${y(0)}Z`;
      })()
    : area((p) => p.cumYield, () => 0);
  // o rótulo "lucro" dentro da faixa, no fim da janela, só quando ela já tem altura e largura para o texto
  const last = points[n];
  const bandLabel = band && fullMark && last && y(last.debt) - y(earned(last)) >= 20 && x(n) - x(fullMark.at) >= 90
    ? { x: x(n) - 8, y: (y(last.debt) + y(earned(last))) / 2 + 4 }
    : null;
  const tipCovered = tip ? covered(tipVal(earned), tipVal((p) => p.debt)) : false;
  const pinPoint = pinned !== null && pinned >= 0 && pinned <= n ? points[pinned] : null;
  return (
    <div>
      <div ref={box} className="relative w-full select-none">
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={label}
          className={cx('block touch-pan-y', onPick && 'cursor-pointer')}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHoverX(null)}
          onClick={(e) => {
            if (!onPick || n <= 0) return;
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
            onPick(Math.max(0, Math.min(n, Math.round(((px - pad.l) / plotW) * n))));
          }}
        >
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
          {/* a área azul vai até o que se deve: depois dos 100%, o que passa da linha é a faixa verde (o rendido = o que paga
              a dívida + o lucro), como a barra de "ao longo do tempo"; a linha azul segue o rendido inteiro */}
          <path d={blueArea} fill={BORROW_COLORS.yield} fillOpacity={0.28} />
          {band ? <path d={band} fill={BORROW_COLORS.leftOver} fillOpacity={0.38} /> : null}
          <path d={line((p) => p.cumYield)} fill="none" stroke={BORROW_COLORS.yield} strokeWidth={2} />
          {showCashback ? (
            <>
              <path d={area((p) => p.cumYield + p.cumCashback, (p) => p.cumYield)} fill={BORROW_COLORS.cashback} fillOpacity={0.28} />
              <path d={line((p) => p.cumYield + p.cumCashback)} fill="none" stroke={BORROW_COLORS.cashback} strokeWidth={2} />
            </>
          ) : null}
          <path d={line((p) => p.debt)} fill="none" stroke={BORROW_COLORS.debt} strokeWidth={2} strokeDasharray="6 4" />
          {bandLabel ? (
            <text x={bandLabel.x} y={bandLabel.y} textAnchor="end" className="fill-ink text-[11px] font-medium">{tr('profit', 'lucro')}</text>
          ) : null}
          {visibleMarks.map((mk, i) => {
            const full = mk.share >= 1;
            const px = x(mk.at);
            // no celular, as marcas de 5% e 10% ficam sem rótulo (muito perto do começo); a lista embaixo diz o mês
            const narrow = width < 520;
            const showLabel = !narrow || mk.share >= 0.25;
            // rótulos em duas alturas alternadas: marcas próximas não se atropelam
            const ly = 8 + (i % 2) * 13;
            return (
              <g key={mk.share}>
                <line x1={px} x2={px} y1={ly + 6} y2={H - pad.b} stroke="var(--color-ink)" strokeOpacity={full ? 0.75 : 0.3} strokeWidth={full ? 1.5 : 1} strokeDasharray={full ? undefined : '3 3'} />
                {/* o ponto fica onde a curva cruza a fração: na altura de `share` × o que se deve naquele instante */}
                <circle cx={px} cy={y(mk.share * lerp(mk.at, (p) => p.debt))} r={full ? 5 : 3.5} fill={BORROW_COLORS.yield} stroke="var(--color-panel)" strokeWidth={2} />
                {showLabel ? (
                  <text x={px} y={ly + 2} textAnchor={px > width - 24 ? 'end' : 'middle'} className={cx('tnum text-[11px]', full ? 'fill-ink font-semibold' : 'fill-muted font-medium')}>
                    {num(mk.share * 100, 0)}%
                  </text>
                ) : null}
              </g>
            );
          })}
          {/* o mês de "ao longo do tempo": linha violeta com um ponto em cada curva */}
          {pinPoint ? (
            <g aria-hidden>
              <line x1={x(pinPoint.month)} x2={x(pinPoint.month)} y1={pad.t - 6} y2={H - pad.b} stroke="var(--color-accent)" strokeWidth={1.5} />
              <circle cx={x(pinPoint.month)} cy={y(earned(pinPoint))} r={4.5} fill={BORROW_COLORS.yield} stroke="var(--color-panel)" strokeWidth={2} />
              <circle cx={x(pinPoint.month)} cy={y(pinPoint.debt)} r={4.5} fill={BORROW_COLORS.debt} stroke="var(--color-panel)" strokeWidth={2} />
            </g>
          ) : null}
          {tip ? <line x1={tip.px} x2={tip.px} y1={pad.t} y2={H - pad.b} stroke="var(--color-line2)" strokeWidth={1} /> : null}
        </svg>
        {tip ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-10 z-10 w-[200px] rounded-lg border border-line2 bg-bg/95 px-3 py-2 text-xs shadow-lg"
            style={{ left: flip ? Math.max(0, tip.px - 210) : tip.px + 10 }}
          >
            {hoverMark ? (
              <div className="mb-1 flex justify-between gap-2 font-medium text-ink">
                <span className="tnum text-good">{tr(`${num(hoverMark.share * 100, 0)}% reached`, `${num(hoverMark.share * 100, 0)}% alcançado`)}</span>
                <span>{tr('by ', 'até ')}{monthLabelFrom(start, hoverMark.month, locale)}</span>
              </div>
            ) : (
              <div className="mb-1 flex justify-between gap-2 font-medium text-ink">
                <span>{tip.t === 0 ? tr('Today', 'Hoje') : monthLabelFrom(start, tip.t, locale)}</span>
                <span className="tnum text-good">{tipVal((p) => p.debt) <= 0 ? '' : tipCovered ? tr(`+${profitPct(tipVal(earned), tipVal((p) => p.debt))}% profit`, `+${profitPct(tipVal(earned), tipVal((p) => p.debt))}% de lucro`) : `${paidPct(tipVal(earned) / tipVal((p) => p.debt))}% ${tr('paid', 'pago')}`}</span>
              </div>
            )}
            <TipRow color={BORROW_COLORS.yield} label={tr('Vault earned', 'O cofre rendeu')} value={approx + usd(tipVal((p) => p.cumYield))} />
            {showCashback ? <TipRow color={BORROW_COLORS.cashback} label={tr('+ cashback', '+ cashback')} value={approx + usd(tipVal((p) => p.cumCashback))} /> : null}
            <TipRow color="transparent" label={tr('Borrowed', 'Emprestado')} value={usd(principal)} />
            <TipRow color="transparent" label={tr('+ interest', '+ juros')} value={approx + usd(tipVal((p) => p.cumInterest))} />
            <TipRow color={BORROW_COLORS.debt} dashed label={tr('= you owe', '= você deve')} value={approx + usd(tipVal((p) => p.debt))} />
            {tipCovered ? (
              <div className="mt-1 border-t border-line pt-1">
                <TipRow color={BORROW_COLORS.leftOver} label={tr('profit', 'lucro')} value={`${approx}+${usd(tipVal(earned) - tipVal((p) => p.debt))}`} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <Legend color={BORROW_COLORS.yield} label={tr('What the vault earned', 'O que o cofre rendeu')} />
        {showCashback ? <Legend color={BORROW_COLORS.cashback} label={tr('+ the card cashback', '+ o cashback do cartão')} /> : null}
        <Legend color={BORROW_COLORS.debt} dashed label={tr('What you owe: borrowed + interest', 'O que você deve: emprestado + juros')} />
        {band ? <Legend color={BORROW_COLORS.leftOver} label={tr('After 100%: profit after repaying', 'Depois dos 100%: lucro depois de pagar')} /> : null}
      </ul>
      {marks.length ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={tr('When what the vault earned reaches each part of what you owe', 'Quando o que o cofre rendeu chega a cada parte do que você deve')}>
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
          'Blue is what the vault has earned since today, added up month by month. The dashed line is what you owe: what you borrowed plus the interest, which goes into the debt and compounds, so it rises a little every month (at today’s rate, which is variable). Each vertical line is where the earnings reach that share of what you owe, and the list gives the month by which it gets there; at 100%, they would be enough to repay the loan with its interest. After that, green is the profit: what the vault would have earned beyond repaying it, also as a share of what you owe. They stay in the vault: the loan only goes down when you repay it.',
          'O azul é o que o cofre rendeu desde hoje, somado mês a mês. A linha tracejada é o que você deve: o que pegou emprestado mais os juros, que entram na dívida e também rendem juros, então ela sobe um pouco todo mês (na taxa de hoje, que é variável). Cada linha vertical é onde o rendimento chega àquela parte do que você deve, e a lista diz até que mês ele chega lá; em 100%, ele daria para pagar o empréstimo com os juros. Depois disso, o verde é o lucro: o que o cofre teria rendido além de pagar, também como parte do que você deve. Ele fica no cofre: o empréstimo só cai quando você paga.',
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
                <th scope="col" className="px-2 py-2 sm:px-3 font-medium">{tr('Month', 'Mês')}</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">{tr('Vault earned', 'O cofre rendeu')}</th>
                {showCashback ? <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">Cashback</th> : null}
                <th scope="col" className="hidden px-2 py-2 text-right font-medium sm:table-cell sm:px-3">{tr('Interest', 'Juros')}</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">{tr('You owe', 'Você deve')}</th>
                <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">{tr('Paid · profit', 'Pago · lucro')}</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {points.filter((p) => p.month % yearStep === 0 || marks.some((mk) => mk.month === p.month)).map((p) => {
                const reached = reachedIn(p.month);
                return (
                  <tr key={p.month} className="border-t border-line">
                    <th scope="row" className="px-2 py-1.5 sm:px-3 font-normal text-muted">
                      <span className="whitespace-nowrap">{p.month === 0 ? tr('Today', 'Hoje') : monthLabelFrom(start, p.month, locale)}</span>
                      {reached.length ? <span className="block text-faint">{tr(`${reached.join(', ')} reached`, `chegou a ${reached.join(', ')}`)}</span> : null}
                    </th>
                    <td className="px-2 py-1.5 sm:px-3 text-right">{usd(p.cumYield)}</td>
                    {showCashback ? <td className="px-2 py-1.5 sm:px-3 text-right">{usd(p.cumCashback)}</td> : null}
                    <td className="hidden px-2 py-1.5 text-right sm:table-cell sm:px-3">{usd(p.cumInterest)}</td>
                    <td className="px-2 py-1.5 sm:px-3 text-right">{usd(p.debt)}</td>
                    <td className={cx('px-2 py-1.5 sm:px-3 text-right', covered(earned(p), p.debt) && 'text-good')}>
                      {p.debt <= 0 ? '—' : covered(earned(p), p.debt) ? `+${profitPct(earned(p), p.debt)}% (+${usd(earned(p) - p.debt)})` : `${paidPct(earned(p) / p.debt)}%`}
                    </td>
                  </tr>
                );
              })}
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
