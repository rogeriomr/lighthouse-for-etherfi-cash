import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowDownRight, ArrowUpRight, CircleCheck, Coins, PiggyBank, Plane, Repeat, ShoppingBag, TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MonthEvolution, MonthEvent, MonthEventKind } from '../lib/analytics';
import { monthLabel, monthLabelLong, pctSigned, usd, usdAxis } from '../lib/format';
import { categoryColor, NEUTRAL_COLOR } from '../lib/categoryColors';
import { CATEGORY } from '../lib/merchants';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';
import { ChartTip, useEscape } from './charts';
import type { BarSegment } from './charts';

/**
 * Uma cor e uma forma por tipo de evento (a legenda sai daqui): a forma (ícone) diz o que é sem depender da cor.
 * O que tem categoria usa a cor dela; "para revisar" usa o âmbar de atenção (nunca vermelho: não é urgência).
 */
export const EVENT_COLOR: Record<MonthEventKind, string> = {
  trip: categoryColor(CATEGORY.travel),
  new_sub: categoryColor(CATEGORY.software),
  one_off_big: categoryColor(CATEGORY.shopping),
  anomalies: 'var(--color-warn)',
  borrow: 'var(--color-info)',
  repayment: 'var(--color-ink)',
  record_cashback: 'var(--color-good)',
};

const EVENT_ICON: Record<MonthEventKind, LucideIcon> = {
  trip: Plane,
  new_sub: Repeat,
  one_off_big: ShoppingBag,
  anomalies: TriangleAlert,
  borrow: PiggyBank,
  repayment: CircleCheck,
  record_cashback: Coins,
};

/** Ordem da legenda */
export const EVENT_KINDS: MonthEventKind[] = ['trip', 'new_sub', 'one_off_big', 'anomalies', 'borrow', 'repayment', 'record_cashback'];

/**
 * Trilha horizontal de chips no celular: encaixa no chip (snap) e esmaece as bordas, para o chip cortado na ponta
 * parecer continuação e não defeito; sem barra de rolagem (o gesto é o arrasto). A trilha avança sobre o respiro do
 * painel (-mx-4/px-4): o esmaecimento cai ali.
 */
export const CHIP_TRACK = 'relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)]';

/** Inicial do mês sob cada barra estreita ("J F M…", igual em inglês e português) */
export const monthInitial = (ym: string) => monthLabel(ym).charAt(0).toUpperCase();

// mês parcial: hachura a 135° na cor do painel, o mesmo desenho do Histórico
const HATCH = 'repeating-linear-gradient(135deg, transparent 0 3px, var(--color-panel) 3px 5px)';

/** Mês que não é inteiro: o corrente e o mês em que o histórico (ou a conta) começa no meio. Vai hachurado. */
export const isPartialMonth = (m: MonthEvolution) => m.partial || m.startsMidMonth;

/** `urgent`: o único caso que fica vermelho (ex.: cobrança repetida ainda a confirmar) */
export function EventIcon({ kind, urgent, className }: { kind: MonthEventKind; urgent?: boolean; className?: string }) {
  const Icon = EVENT_ICON[kind];
  return <Icon aria-hidden="true" className={cx('size-3 shrink-0', className)} strokeWidth={2.25} style={{ color: urgent ? 'var(--color-bad)' : EVENT_COLOR[kind] }} />;
}

export function EventChip({ event }: { event: MonthEvent }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line2 px-2 py-1 text-xs leading-4 text-muted pointer-fine:lg:text-[11px]">
      <EventIcon kind={event.kind} urgent={event.tone === 'bad'} />
      {event.label}
    </span>
  );
}

/** Amostras da legenda: parcial (hachura, como no Histórico) e projeção (contorno tracejado, sem preenchimento) */
export function PartialSwatch() {
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: 'var(--color-muted)', backgroundImage: HATCH }} />;
}

export function ProjectionSwatch() {
  return <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[3px] border border-dashed border-muted" />;
}

export function DeltaPill({ pct, compareLabel, muted, className }: { pct: number | null; compareLabel?: string; muted?: boolean; className?: string }) {
  if (pct == null) {
    return <span className={cx('text-xs text-faint', className)}>—</span>;
  }
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const tone = muted ? 'text-muted' : up ? 'text-warn' : 'text-good';
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs tnum', tone, className)}>
      <Icon className="size-3" aria-hidden="true" />
      {pctSigned(pct)}
      {compareLabel ? <span className="font-normal text-faint"> vs {compareLabel}</span> : null}
    </span>
  );
}

/**
 * Barras mensais selecionáveis (radiogroup acessível) + eventos + rótulos + variações.
 * Cada mês vem empilhado por categoria (`stacks`, nas cores de "Por categoria"); apontar, tocar ou focar um mês
 * abre a dica completa (ChartTip) com todas as categorias, e os outros meses esmaecem enquanto ela está aberta.
 * O mês escolhido ganha contorno no acento e o nome em negrito; os outros ficam com a cor cheia (esmaecer de vez
 * deixaria categorias abaixo de 3:1 sobre o cartão).
 * Mês parcial: o realizado com hachura; a projeção do mês corrente é uma extensão só de contorno tracejado em cima,
 * com rótulo "projeção · ~US$ X". A escala cobre a projeção, mas a barra cheia é só o que já saiu: ninguém lê
 * "outubro já gastou quase o recorde".
 * `compact` (celular): só a forma; os chips (EvoMonthChips) são o controle acessível e dizem nome e valor,
 * então aqui as barras ficam fora da árvore de acessibilidade e só respondem ao toque (que também abre a dica).
 */
export function EvoBars({
  data,
  selected,
  onSelect,
  events,
  stacks,
  height = 180,
  compact,
  className,
}: {
  data: MonthEvolution[];
  selected: string;
  onSelect: (m: string) => void;
  events?: MonthEvent[][];
  /** Partes de cada mês por categoria, pela chave AAAA-MM (monthCategoryStacks) */
  stacks?: Map<string, BarSegment[]>;
  height?: number;
  compact?: boolean;
  className?: string;
}) {
  const tr = useTr();
  // o mês da dica: ponteiro, toque ou foco do teclado
  const [hover, setHover] = useState<number | null>(null);
  useEscape(hover != null, setHover);
  const wrapRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const max = Math.max(...data.map((d) => Math.max(d.total, d.projected ?? 0)), 1);
  // roving tabindex: a seta escolhe o mês e leva o foco junto (sem isso a próxima seta partiria do mês antigo)
  const move = (i: number) => {
    const k = Math.max(0, Math.min(data.length - 1, i));
    const next = data[k];
    if (!next) return;
    onSelect(next.month);
    const el = colsRef.current?.children[k];
    if (el instanceof HTMLElement) el.focus();
  };
  const cols = { gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` };
  const projectedMonth = data.find((m) => m.partial && m.projected);
  const tipMonth = hover != null ? data[hover] : undefined;
  const tipParts = tipMonth ? (stacks?.get(tipMonth.month) ?? []) : [];

  const bar = (m: MonthEvolution, i: number) => {
    const isSelected = m.month === selected;
    const partial = isPartialMonth(m);
    const h = Math.max(2, (Math.max(0, m.total) / max) * 100);
    const ext = m.partial && m.projected && m.projected > m.total ? ((m.projected - m.total) / max) * 100 : 0;
    const segs = stacks?.get(m.month);
    // alturas de dentro em relação ao bloco (realizado + projeção), que é o que tem altura na coluna
    const inner = (v: number) => `${(v / (h + ext)) * 100}%`;
    return (
      <span
        className={cx(
          'flex w-full shrink-0 flex-col justify-end self-center rounded-t-md transition-opacity duration-150 motion-reduce:transition-none',
          compact ? 'max-w-7' : 'max-w-9',
          isSelected && 'outline-2 outline-offset-2 outline-accent',
          hover != null && hover !== i && 'opacity-30',
        )}
        style={{ height: `${h + ext}%` }}
      >
        {ext > 0 ? (
          <span className={cx('w-full shrink-0 rounded-t-md border border-b-0 border-dashed', isSelected ? 'border-accent/70' : 'border-muted')} style={{ height: inner(ext) }} />
        ) : null}
        {segs?.length ? (
          // empilhada: a maior categoria embaixo, 1 px de vão na cor do cartão entre as partes; o mês parcial leva
          // a hachura por cima de cada cor
          <span className={cx('flex w-full shrink-0 flex-col-reverse gap-px overflow-hidden', ext > 0 ? '' : 'rounded-t-md')} style={{ height: inner(h) }}>
            {segs.map((s) => (
              <span key={s.key} className="min-h-px basis-0" style={{ flexGrow: s.value, backgroundColor: s.color, backgroundImage: partial ? HATCH : undefined }} />
            ))}
          </span>
        ) : (
          <span
            className={cx('w-full shrink-0', ext > 0 ? '' : 'rounded-t-md')}
            style={{ height: inner(h), backgroundColor: NEUTRAL_COLOR, backgroundImage: partial ? HATCH : undefined }}
          />
        )}
      </span>
    );
  };

  const tip = tipMonth && hover != null ? (
    <ChartTip
      title={`${monthLabelLong(tipMonth.month)}${isPartialMonth(tipMonth) ? ` · ${tr('partial', 'parcial')}` : ''}`}
      total={usd(tipMonth.total)}
      note={tipMonth.partial && tipMonth.projected ? tr(`projection ~${usdAxis(tipMonth.projected)}`, `projeção ~${usdAxis(tipMonth.projected)}`) : undefined}
      parts={tipParts}
      format={usd}
      columnsRef={colsRef}
      index={hover}
      containerRef={wrapRef}
      onDismiss={() => setHover(null)}
    />
  ) : null;
  const leave = (e: ReactPointerEvent) => { if (e.pointerType === 'mouse') setHover(null); };

  if (compact) {
    return (
      <div className={cx('space-y-2', className)}>
        <div ref={wrapRef} className="relative" onPointerLeave={leave}>
          <div ref={colsRef} aria-hidden="true" className="flex items-end gap-1" style={{ height }}>
            {data.map((m, i) => (
              <div
                key={m.month}
                onClick={() => onSelect(m.month)}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(i); }}
                onPointerDown={(e) => { if (e.pointerType !== 'mouse') setHover(i); }}
                className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end"
              >
                {bar(m, i)}
              </div>
            ))}
          </div>
          {tip}
        </div>
        {/* a inicial de cada mês logo abaixo da barra; o nome inteiro está nos chips */}
        <div className="flex gap-1 text-center text-xs leading-none text-faint" aria-hidden="true">
          {data.map((m) => <span key={m.month} className={cx('min-w-0 flex-1', m.month === selected && 'font-medium text-ink')}>{monthInitial(m.month)}</span>)}
        </div>
        <div className="flex justify-between gap-3 text-xs text-faint" aria-hidden="true">
          <span>{data[0] ? monthLabelLong(data[0].month) : ''}</span>
          <span>{data.length > 1 ? monthLabelLong(data[data.length - 1].month) : ''}</span>
        </div>
        {data.some(isPartialMonth) ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5"><PartialSwatch />{tr('partial month', 'mês parcial')}</span>
            {projectedMonth?.projected ? (
              <span className="inline-flex items-center gap-1.5">
                <ProjectionSwatch />
                <span className="tnum">{tr('projection', 'projeção')}{'\u00a0· '}~{usdAxis(projectedMonth.projected)}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cx('space-y-2', className)}>
      <div ref={wrapRef} className="relative" onPointerLeave={leave}>
        <div
          ref={colsRef}
          role="radiogroup"
          aria-label={tr('Select month', 'Selecionar mês')}
          className="flex items-end gap-2"
          style={{ height }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null); }}
        >
          {data.map((m, i) => {
            const isSelected = m.month === selected;
            const partial = isPartialMonth(m);
            const projected = m.partial && m.projected ? m.projected : null;
            return (
              <button
                key={m.month}
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }
                  if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); }
                  if (e.key === 'Home') { e.preventDefault(); move(0); }
                  if (e.key === 'End') { e.preventDefault(); move(data.length - 1); }
                }}
                onClick={() => onSelect(m.month)}
                onFocus={() => setHover(i)}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(i); }}
                onPointerDown={(e) => { if (e.pointerType !== 'mouse') setHover(i); }}
                aria-label={`${monthLabelLong(m.month)}: ${usd(m.total)}${partial ? tr(', partial month', ', mês parcial') : ''}${projected ? tr(`, projection ~${usd(projected)}`, `, projeção ~${usd(projected)}`) : ''}`}
                className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                {projected ? (
                  // o rótulo da projeção fica sempre à vista: é a parte do desenho que não é dado realizado. É sempre
                  // a última coluna: com muitos meses ele passa da largura dela e cresce para a esquerda, sem cortar
                  <span className="mb-1 w-max self-end text-right text-xs leading-tight whitespace-nowrap text-muted pointer-fine:text-[11px]">
                    <span className="block">{tr('projection', 'projeção')}</span>
                    <span className="tnum block">~{usdAxis(projected)}</span>
                  </span>
                ) : (
                  <span className={cx('mb-1 w-full truncate text-center text-xs tnum pointer-fine:text-[11px]', isSelected ? 'font-medium text-ink' : 'text-faint opacity-0 group-hover:opacity-100')}>
                    {usdAxis(m.total)}
                  </span>
                )}
                {bar(m, i)}
              </button>
            );
          })}
        </div>
        {tip}
        {/* o leitor ouve o mês e o total no próprio botão; aqui, as categorias do mês da dica */}
        <span className="sr-only" aria-live="polite">
          {tipMonth && tipParts.length
            ? `${monthLabelLong(tipMonth.month)}, ${tr('by category', 'por categoria')}: ${[...tipParts].sort((a, b) => b.value - a.value).map((p) => `${p.label} ${usd(p.value)}`).join(', ')}`
            : ''}
        </span>
      </div>
      {events ? (
        <div className="grid gap-2" style={cols}>
          {events.map((list, i) => (
            <div key={data[i]?.month ?? i} className="flex items-center justify-center gap-1">
              {list.slice(0, 3).map((ev, j) => (
                <span key={`${ev.kind}-${j}`} title={ev.label}><EventIcon kind={ev.kind} urgent={ev.tone === 'bad'} /></span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-2" style={cols}>
        {data.map((m, i) => (
          <span key={m.month} className={cx('truncate text-center text-xs leading-tight pointer-fine:text-[11px]', m.month === selected ? 'font-semibold text-ink' : 'text-faint')}>
            {monthLabel(m.month)}
            {i === 0 || m.month.endsWith('-01') ? <span className="block text-xs text-faint pointer-fine:text-[11px]">{m.month.slice(0, 4)}</span> : null}
          </span>
        ))}
      </div>
      <div className="grid gap-2" style={cols}>
        {data.map((m) => (
          <div key={m.month} className="flex justify-center">
            {/* mês corrente: parcial contra inteiro engana; a comparação dele é pela projeção, no detalhe */}
            <DeltaPill pct={m.partial ? null : m.deltaPct} muted={m.deltaExplained} className="pointer-fine:text-[11px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Centraliza o chip escolhido na trilha agora e sempre que a largura dela mudar; devolve a limpeza do efeito. */
export function centerChip(track: HTMLElement | null, selector: string, fallbackEnd = false): (() => void) | undefined {
  if (!track) return undefined;
  const center = () => {
    const chip = track.querySelector<HTMLElement>(selector);
    if (chip) track.scrollLeft = chip.offsetLeft - (track.clientWidth - chip.clientWidth) / 2;
    else if (fallbackEnd) track.scrollLeft = track.scrollWidth;
  };
  center();
  if (typeof ResizeObserver === 'undefined') return undefined;
  let width = track.clientWidth;
  const ro = new ResizeObserver(() => {
    if (track.clientWidth === width) return;
    width = track.clientWidth;
    center();
  });
  ro.observe(track);
  return () => ro.disconnect();
}

/** Trilha de chips para o celular: o controle acessível do mês (nome, valor e "parcial"). */
export function EvoMonthChips({
  data,
  selected,
  onSelect,
}: {
  data: MonthEvolution[];
  selected: string;
  onSelect: (m: string) => void;
}) {
  const tr = useTr();
  // o mês escolhido fica à vista na trilha (rola só a trilha, nunca a página); de novo quando a trilha muda de
  // largura (girar o celular, ou a trilha que montou escondida na tela larga e apareceu)
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => centerChip(trackRef.current, '[aria-checked="true"]'), [selected]);
  return (
    <div ref={trackRef} className={cx(CHIP_TRACK, 'lg:hidden')} role="radiogroup" aria-label={tr('Select month', 'Selecionar mês')}>
      {data.map((m, i) => {
        const active = m.month === selected;
        // a seta escolhe o mês e leva o foco junto (roving tabindex)
        const move = (dir: number) => {
          const k = Math.max(0, Math.min(data.length - 1, i + dir));
          const next = data[k];
          if (!next) return;
          onSelect(next.month);
          const el = trackRef.current?.children[k];
          if (el instanceof HTMLElement) el.focus();
        };
        return (
          <button
            key={m.month}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(m.month)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
              if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
              if (e.key === 'Home') { e.preventDefault(); move(-data.length); }
              if (e.key === 'End') { e.preventDefault(); move(data.length); }
            }}
            className={cx(
              'min-h-11 shrink-0 snap-start cursor-pointer rounded-lg border px-3 py-1.5 text-left transition-colors',
              active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink',
            )}
          >
            <div className="text-xs font-medium">
              {monthLabel(m.month)}
              {i === 0 || m.month.endsWith('-01') ? <span className={cx('ml-1 font-normal', active ? 'text-accent/80' : 'text-faint')}>{m.month.slice(2, 4)}</span> : null}
            </div>
            <div className={cx('tnum text-xs', active ? 'text-accent/80' : 'text-faint')}>
              {usdAxis(m.total)}{isPartialMonth(m) ? `\u00a0· ${tr('partial', 'parcial')}` : ''}
            </div>
          </button>
        );
      })}
    </div>
  );
}
