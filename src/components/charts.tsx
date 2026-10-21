import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { monthLabel, usd, usd0, usdAxis } from '../lib/format';
import { NEUTRAL_COLOR } from '../lib/categoryColors';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';

/**
 * Gêmeo em tabela de um gráfico: o mesmo número sem depender de cor nem de ponteiro. A área rolável é uma
 * região com nome e entra no Tab (tabelas largas rolam de lado no celular).
 */
export function AsTable({ label, children }: { label: string; children: ReactNode }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={cx(open && 'w-full')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="tap -mx-1 -my-1 cursor-pointer px-1 py-1 text-xs text-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-muted"
      >
        {open ? tr('hide table', 'esconder tabela') : tr('view as table', 'ver como tabela')}
      </button>
      {open ? (
        <div id={id} tabIndex={0} role="region" aria-label={label} className="mt-2 max-h-80 overflow-auto rounded-lg border border-line">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Parte de uma barra empilhada (ex.: uma categoria dentro do gasto do dia), com a cor da própria categoria */
export interface BarSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Esc fecha a dica de onde estiver o foco (WCAG 1.4.13: quem apontou com o mouse também consegue dispensar). */
export function useEscape(open: boolean, close: (v: null) => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);
}

/**
 * Dica rica de uma barra (o guia da ether.fi: "richer tooltips are dark rounded boxes"): o rótulo e o total no topo
 * e uma linha por parte (ponto, nome e valor), da maior para a menor. A caixa encosta na coluna apontada, à direita
 * (ou à esquerda, perto da borda), alinhada ao topo do gráfico: não cobre a barra e o ponteiro chega nela sem passar
 * por outra barra (WCAG 1.4.13). Sem lugar dos dois lados (celular estreito), fica por cima do gráfico, no topo.
 * Nunca sai do cartão. É posição absoluta, então nada se mexe no layout. Só visual: quem lê é a região viva do
 * gráfico. Um toque na caixa a fecha (no celular não há "tirar o mouse").
 */
export function ChartTip({
  title,
  total,
  parts,
  note,
  format,
  columnsRef,
  index,
  containerRef,
  boxRef,
  hiddenNote,
  hiddenNoteRef,
  onDismiss,
}: {
  title: string;
  total: string;
  parts: BarSegment[];
  note?: string;
  /** Linha que nasce escondida e quem chama mostra pelo `hiddenNoteRef` (ex.: a média, quando a caixa cobre a linha) */
  hiddenNote?: string;
  hiddenNoteRef?: RefObject<HTMLDivElement | null>;
  format: (n: number) => string;
  /** Pai das colunas: o filho `index` é a coluna inteira da barra apontada */
  columnsRef: RefObject<HTMLElement | null>;
  index: number;
  /** Referência da posição (relative), da largura das colunas */
  containerRef: RefObject<HTMLElement | null>;
  boxRef?: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = boxRef ?? own;
  // medida antes de pintar: a caixa nunca aparece no lugar errado
  useLayoutEffect(() => {
    const box = ref.current;
    const wrap = containerRef.current;
    const col = columnsRef.current?.children[index];
    if (!box || !wrap || !(col instanceof HTMLElement)) return;
    const c = wrap.getBoundingClientRect();
    const a = col.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let x = a.right - c.left + 1;
    if (x + w > c.width) x = a.left - c.left - 1 - w;
    if (x < 0) x = Math.max(0, Math.min(c.width - w, a.left + a.width / 2 - c.left - w / 2));
    // no topo do gráfico; se for mais alta que o espaço até o fim do cartão, sobe o que faltar, sem passar do topo dele
    const card = wrap.closest('.panel')?.getBoundingClientRect() ?? c;
    const room = card.bottom - 8 - c.top;
    const y = h > room ? Math.max(card.top + 8 - c.top, room - h) : 0;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
  });
  const rows = parts.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      onPointerDown={(e) => { if (e.pointerType !== 'mouse') onDismiss(); }}
      className="absolute top-0 left-0 z-20 w-max max-w-[min(18rem,100%)] min-w-40 rounded-xl border border-line2 bg-bg px-3 py-2 text-xs leading-4 shadow-xl"
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-muted">{title}</span>
        <span className="tnum font-medium whitespace-nowrap text-ink">{total}</span>
      </div>
      {note ? <div className="mt-0.5 text-faint">{note}</div> : null}
      {hiddenNote ? <div ref={hiddenNoteRef} className="mt-0.5 text-faint" style={{ display: 'none' }}>{hiddenNote}</div> : null}
      {rows.length ? (
        <div className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-t border-line pt-1.5">
          {rows.map((p) => (
            <Fragment key={p.key}>
              <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="truncate text-muted">{p.label}</span>
              <span className="tnum text-right whitespace-nowrap text-ink">{format(p.value)}</span>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Barras de uma série no tempo (ex.: gasto por dia). O valor de cada barra aparece no ponteiro, no toque (fica
 * até o próximo toque) e no teclado: o gráfico entra no Tab, as setas andam de barra em barra e uma região viva
 * lê "dia: valor" e cada parte. Esc fecha. `table` acrescenta o "ver como tabela". Com `segments`, a barra vem
 * empilhada (a primeira parte embaixo) e a dica (ChartTip) traz todas as partes; ao apontar uma barra, as outras
 * esmaecem. Com a dica aberta (ou o gráfico no foco do teclado), a linha da média ganha o valor escrito em cima.
 */
export function BarChart({
  data,
  height = 140,
  format = usd,
  ariaLabel,
  average,
  table,
  axis,
}: {
  data: { label: string; value: number; highlight?: boolean; segments?: BarSegment[] }[];
  height?: number;
  format?: (n: number) => string;
  ariaLabel?: string;
  /** Linha de referência com rótulo (ex.: média por dia), para a barra ter com o que ser comparada */
  average?: { value: number; label: string };
  /** Cabeçalhos da tabela gêmea: [coluna do rótulo, coluna do valor] */
  table?: [string, string];
  /** Rótulos do começo e do fim do eixo, logo abaixo das barras */
  axis?: [string, string];
}) {
  const [hover, setHover] = useState<number | null>(null);
  // foco do teclado no gráfico (antes de qualquer seta): a média já mostra o valor
  const [kbFocus, setKbFocus] = useState(false);
  const tr = useTr();
  useEscape(hover != null, setHover);
  const max = Math.max(...data.map((d) => d.value), average?.value ?? 0, 1);
  const tip = hover != null ? data[hover] : null;
  const avg = average && average.value > 0 ? average : null;
  const avgPct = avg ? (avg.value / max) * 100 : 0;
  const peak = data.reduce<number | null>((best, d, i) => (d.value > 0 && (best == null || d.value > data[best].value) ? i : best), null);
  const name = ariaLabel ?? tr('Time series', 'Série temporal');
  const summary = `${name}${peak != null ? tr(`: peak of ${format(data[peak].value)} on ${data[peak].label}`, `: pico de ${format(data[peak].value)} em ${data[peak].label}`) : ''}${avg ? ` · ${avg.label}` : ''}`;
  const step = (i: number) => setHover(Math.max(0, Math.min(data.length - 1, i)));
  // todas as partes da barra apontada, da maior para a menor: na dica e na região viva
  const tipParts = tip?.segments ? [...tip.segments].filter((s) => s.value > 0).sort((a, b) => b.value - a.value) : [];
  const wrapRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const avgTagRef = useRef<HTMLSpanElement>(null);
  // a linha "média" dentro da dica: só aparece quando a caixa cobre a linha inteira (celular estreito, caixa por cima)
  const avgNoteRef = useRef<HTMLDivElement>(null);
  // o valor da média fica na ponta direita, logo acima da linha; se ali estiver a barra apontada ou a dica, tenta a
  // ponta esquerda e depois abaixo da linha; sem lugar livre, ele vai para dentro da dica. Roda depois da dica (efeito
  // do filho primeiro), então já sabe onde ela ficou. Só mexe no DOM (posição e visibilidade), sem estado
  useLayoutEffect(() => {
    const tag = avgTagRef.current;
    const note = avgNoteRef.current;
    if (note) note.style.display = 'none';
    if (!tag) return;
    const col = hover != null ? barsRef.current?.children[hover] : null;
    const bar = col?.firstElementChild?.firstElementChild;
    const hits = (el: Element | null | undefined) => {
      if (!(el instanceof HTMLElement)) return false;
      const t = tag.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return t.left < r.right && t.right > r.left && t.top < r.bottom && t.bottom > r.top;
    };
    const place = (right: boolean, up: boolean) => {
      tag.style.left = right ? 'auto' : '0px';
      tag.style.right = right ? '0px' : 'auto';
      tag.style.bottom = up ? `calc(${avgPct}% + 3px)` : `calc(${avgPct}% - 19px)`;
    };
    // acima da linha, a não ser que ela esteja no alto; abaixo só se houver espaço até a base
    const prefer = avgPct <= 82;
    const spots: [boolean, boolean][] = [[true, prefer], [false, prefer]];
    if (prefer ? avgPct > 14 : true) spots.push([true, !prefer], [false, !prefer]);
    const free = spots.find(([right, up]) => {
      place(right, up);
      return !hits(boxRef.current) && !hits(bar);
    });
    if (!free) place(true, prefer);
    tag.style.visibility = free ? '' : 'hidden';
    if (note && !free) note.style.display = '';
  });
  return (
    <div>
      {/* a dica (ChartTip) é posição absoluta sobre este bloco: nada se mexe quando ela aparece, e sair das barras para
          dentro dela não a fecha (WCAG 1.4.13) */}
      <div ref={wrapRef} className="relative" onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}>
        <div
          ref={barsRef}
          className="relative flex items-end gap-[3px] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          style={{ height }}
          tabIndex={0}
          role="group"
          aria-roledescription={tr('chart', 'gráfico')}
          aria-label={`${summary}. ${tr('Arrow keys read each bar.', 'As setas leem cada barra.')}`}
          onFocus={(e) => setKbFocus(e.currentTarget.matches(':focus-visible'))}
          onBlur={() => { setHover(null); setKbFocus(false); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); step(hover == null ? 0 : hover + 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); step(hover == null ? data.length - 1 : hover - 1); }
            if (e.key === 'Home') { e.preventDefault(); step(0); }
            if (e.key === 'End') { e.preventDefault(); step(data.length - 1); }
            if (e.key === 'Escape') setHover(null);
          }}
        >
          {data.map((d, i) => (
            <div
              key={`${d.label}-${i}`}
              aria-hidden="true"
              className="relative h-full min-w-0 flex-1"
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(i); }}
              onPointerDown={() => setHover(i)}
            >
              <div
                className={cx(
                  'absolute inset-x-0 bottom-0 flex h-full items-end justify-center transition-opacity duration-150 motion-reduce:transition-none',
                  hover != null && hover !== i && 'opacity-30',
                )}
              >
                {d.segments?.length ? (
                  // empilhada: a primeira parte embaixo, 1 px de vão na cor do cartão entre as partes
                  <div
                    className="flex w-full max-w-8 flex-col-reverse gap-px overflow-hidden rounded-t-[3px]"
                    style={{ height: d.value > 0 ? `${Math.max(2, (d.value / max) * 100)}%` : '0%' }}
                  >
                    {d.segments.map((s) => (s.value > 0 ? <div key={s.key} className="min-h-px basis-0" style={{ flexGrow: s.value, backgroundColor: s.color }} /> : null))}
                  </div>
                ) : (
                  <div
                    className={cx('w-full max-w-8 rounded-t-[3px] transition-colors', d.highlight ? 'bg-accent' : hover === i && 'bg-muted')}
                    style={{
                      height: d.value > 0 ? `${Math.max(2, (d.value / max) * 100)}%` : '0%',
                      backgroundColor: d.highlight || hover === i ? undefined : NEUTRAL_COLOR,
                    }}
                  />
                )}
              </div>
            </div>
          ))}
          {avg ? (
            <div className="pointer-events-none absolute inset-x-0 h-px bg-ink/45" style={{ bottom: `${avgPct}%` }} aria-hidden="true" />
          ) : null}
          {avg && (tip || kbFocus) ? (
            // o valor da média, discreto, logo acima da linha (abaixo, se a linha estiver no alto); fundo do cartão
            // semitransparente para ler sobre as barras. Aparece e some sem animação. A legenda embaixo continua
            <span
              ref={avgTagRef}
              aria-hidden="true"
              className="tnum pointer-events-none absolute right-0 z-10 rounded-sm bg-panel/85 px-1 text-xs leading-4 whitespace-nowrap text-muted pointer-fine:text-[11px]"
              style={{ bottom: avgPct > 82 ? `calc(${avgPct}% - 19px)` : `calc(${avgPct}% + 3px)` }}
            >
              {tr('avg', 'média')}{' '}{format(avg.value)}
            </span>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {tip ? `${tip.label}: ${format(tip.value)}${tipParts.map((s) => `, ${s.label} ${format(s.value)}`).join('')}` : ''}
          </span>
        </div>
        {tip && hover != null ? (
          <ChartTip
            title={tip.label}
            total={format(tip.value)}
            hiddenNote={avg ? `${tr('avg', 'média')} ${format(avg.value)}` : undefined}
            hiddenNoteRef={avgNoteRef}
            parts={tipParts}
            format={format}
            columnsRef={barsRef}
            index={hover}
            containerRef={wrapRef}
            boxRef={boxRef}
            onDismiss={() => setHover(null)}
          />
        ) : null}
      </div>
      {/* o eixo fica colado às barras; a legenda da média e a tabela vêm depois */}
      {axis ? (
        <div className="mt-1.5 flex justify-between gap-3 text-xs text-faint pointer-fine:lg:text-[11px]" aria-hidden="true">
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
        </div>
      ) : null}
      {/* a legenda da linha fica fora do gráfico: dentro, o rótulo cobriria justamente as barras mais altas */}
      {avg || table ? (
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          {avg ? (
            <div className="flex items-center gap-1.5 text-xs text-muted pointer-fine:lg:text-[11px]" aria-hidden="true">
              <span className="inline-block h-px w-4 bg-ink/45" />
              <span className="tnum">{avg.label}</span>
            </div>
          ) : <span />}
          {table ? (
            <AsTable label={name}>
              <table className="w-full text-xs">
                <caption className="sr-only">{name}</caption>
                <thead>
                  <tr className="border-b border-line text-left uppercase tracking-wider text-faint">
                    <th scope="col" className="px-3 py-2 font-medium">{table[0]}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{table[1]}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.map((d, i) => (
                    <tr key={`${d.label}-${i}`}>
                      <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">{d.label}</th>
                      <td className={cx('tnum px-3 py-1.5 text-right', d.value > 0 ? 'text-ink' : 'text-faint')}>{format(d.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AsTable>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Rosca de partes de um todo. Cada fatia traz a própria cor (por categoria, nunca pela posição); `rest: true`
 * marca "todo o resto", em cinza. No celular a legenda desce para baixo da rosca e ocupa a largura toda,
 * para os nomes não sumirem.
 */
export function Donut({
  data,
  size = 168,
  centerLabel,
  label,
}: {
  data: { name: string; total: number; color?: string; rest?: boolean }[];
  size?: number;
  centerLabel?: string;
  label?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tr = useTr();
  const total = data.reduce((s, d) => s + d.total, 0) || 1;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const colorOf = (d: (typeof data)[number]) => (d.rest || !d.color ? NEUTRAL_COLOR : d.color);
  // onde cada fatia começa (fração do todo), calculado antes do desenho
  const starts = data.map((_, i) => data.slice(0, i).reduce((s, x) => s + x.total / total, 0));
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
      <div className="relative shrink-0 self-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={label ?? tr('Spending by category', 'Distribuição de gasto por categoria')}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
          {data.map((d, i) => {
            const frac = d.total / total;
            const dash = `${Math.max(0, frac * c - 2)} ${Math.max(0, c - frac * c + 2)}`;
            const offset = -starts[i] * c;
            return (
              <circle
                key={d.name}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={colorOf(d)}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                className="transition-opacity"
                opacity={active != null && active !== i ? 0.35 : 1}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-lg font-semibold">{usd0(total)}</span>
          <span className="text-xs uppercase tracking-wider text-faint pointer-fine:lg:text-[11px]">{centerLabel ?? tr('this period', 'no período')}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {data.map((d, i) => (
          <div
            key={d.name}
            className="flex cursor-default items-center gap-2 text-sm transition-colors"
            // mouse destaca ao passar; no toque, um toque destaca e outro solta (pointerenter/leave piscariam)
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') setActive(i); }}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null); }}
            onClick={() => setActive((a) => (a === i ? null : i))}
          >
            <span className={cx('size-2.5 shrink-0 rounded-sm transition-all', active === i && 'size-3')} style={{ background: colorOf(d) }} />
            <span className={cx('min-w-0 flex-1 leading-snug', active === i ? 'text-ink' : 'text-muted')}>{d.name}</span>
            <span className="tnum text-ink">{usd(d.total)}</span>
            <span className="tnum w-10 text-right text-xs text-faint">{Math.round((d.total / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Ranking em barras horizontais. Uma série só fica num cinza claro (o violeta do acento é destaque, não dado);
 * `color` por item quando a barra é uma categoria. No celular o nome vai acima da barra, inteiro.
 */
export function HBars({ data, color = 'var(--color-muted)' }: { data: { label: string; value: number; color?: string }[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div key={d.label} className="text-sm">
          <div className="mb-1 flex items-baseline gap-3 sm:hidden">
            <span className="min-w-0 flex-1 truncate text-muted">{d.label}</span>
            <span className="tnum shrink-0 text-ink">{usd(d.value)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden w-36 shrink-0 truncate text-muted sm:block" title={d.label}>{d.label}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? color }} />
            </div>
            <span className="tnum hidden min-w-20 shrink-0 text-right text-ink sm:block">{usd(d.value)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Barras mensais simples com o valor escrito em cima; o leitor de tela ouve "mês: valor" de cada coluna. */
export function MonthBars({ data, ariaLabel }: { data: { month: string; total: number }[]; ariaLabel?: string }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const maxMonth = data.find((d) => d.total === max)?.month;
  const tr = useTr();
  const peakMonth = maxMonth ? monthLabel(`${maxMonth}-01`) : '—';
  return (
    <div
      className="flex items-end gap-2"
      style={{ height: 120 }}
      role="group"
      aria-label={ariaLabel ?? tr(`Monthly series: peak of ${usdAxis(max)} in ${peakMonth}`, `Série mensal: pico de ${usdAxis(max)} em ${peakMonth}`)}
    >
      {data.map((d) => (
        <div key={d.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
          <span className="sr-only">{`${monthLabel(`${d.month}-01`)}: ${usd(d.total)}`}</span>
          <span aria-hidden="true" className={cx('tnum text-xs pointer-fine:lg:text-[11px]', d.month === maxMonth ? 'text-ink' : 'text-faint')}>{usdAxis(d.total)}</span>
          <div
            aria-hidden="true"
            className={cx('w-full max-w-8 rounded-t-md transition-colors', d.month === maxMonth && 'bg-accent/70')}
            style={{
              height: d.total > 0 ? `${Math.max(3, (d.total / max) * 82)}%` : '0%',
              backgroundColor: d.month === maxMonth ? undefined : NEUTRAL_COLOR,
            }}
          />
          <span aria-hidden="true" className="text-xs text-faint pointer-fine:lg:text-[11px]">{monthLabel(`${d.month}-01`)}</span>
        </div>
      ))}
    </div>
  );
}
