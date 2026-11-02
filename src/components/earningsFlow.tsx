import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';

// O fluxo da tela Ganhos: as fontes (rendimento de cada cofre, outros ativos com APY, cashback) à esquerda e o que elas
// pagam à direita (cada item coberto, o parcial e a sobra), ligados por faixas da cor da fonte. As faixas seguem a ordem
// das duas colunas: o dinheiro não tem carimbo, a soma dos ganhos é que vai pagando a lista na ordem dela.
// O SVG só desenha (aria-hidden); os rótulos são texto de verdade, em duas listas, e a tela tem o gêmeo em tabela.

export interface FlowSource {
  id: string;
  label: string;
  /** "US$ 38/mês · 6,2% a.a." */
  detail: string;
  value: number;
  /** cor da faixa e do nó (token CSS: var(--…)) */
  color: string;
}

export interface FlowTarget {
  id: string;
  label: string;
  detail: string;
  /** o quanto dos ganhos chega aqui */
  value: number;
  kind: 'full' | 'partial' | 'leftover';
  /** parcial: o custo inteiro do item (o nó tem essa altura; o que falta fica em trilho) e a fração paga */
  whole?: number;
  share?: number;
}

/**
 * A pizza do item pago em parte (a mesma na lista e no fluxo): contorno accent de 1,5 px e o setor da fração paga
 * preenchido, a partir do topo, no sentido do relógio. Pela forma (e não só pela cor) ela se distingue do anel vazio
 * do "ainda não" (1.4.1): a 94% fica quase cheia, com uma fatia vazia.
 */
export function PartialPie({ share, className }: { share: number; className?: string }) {
  const c = 7;
  const r = 6;
  const f = Math.min(0.99, Math.max(0.03, share));
  const angle = f * 2 * Math.PI;
  const x = c + r * Math.sin(angle);
  const y = c - r * Math.cos(angle);
  return (
    <svg aria-hidden viewBox="0 0 14 14" className={className ?? 'mt-px size-3.5 shrink-0'}>
      <path d={`M${c} ${c}L${c} ${c - r}A${r} ${r} 0 ${angle > Math.PI ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)}Z`} fill="var(--color-accent)" />
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
    </svg>
  );
}

interface Band {
  key: string;
  source: string;
  target: string;
  color: string;
  ys: number;
  yt: number;
  t: number;
}

/**
 * Rótulos que se encostariam descem ou sobem só o necessário, sem sair da área. Cada um tem a sua altura (nome em uma
 * ou duas linhas): dois centros vizinhos ficam a pelo menos a meia altura de um mais a do outro.
 */
function spread(centers: number[], heights: number[], H: number): number[] {
  const y = [...centers];
  const n = y.length;
  const gap = (i: number) => (heights[i - 1] + heights[i]) / 2;
  for (let i = 0; i < n; i++) y[i] = Math.max(y[i], i ? y[i - 1] + gap(i) : heights[0] / 2);
  for (let i = n - 1; i >= 0; i--) y[i] = Math.min(y[i], i < n - 1 ? y[i + 1] - gap(i + 1) : H - heights[n - 1] / 2);
  for (let i = 0; i < n; i++) y[i] = Math.max(y[i], i ? y[i - 1] + gap(i) : heights[0] / 2);
  return y;
}

/** Largura do contêiner, medida antes de pintar (o desenho depende dela). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const NODE = 8;
/** distância entre nós da mesma coluna: o respiro de superfície que separa as partes */
const GAP = 6;
/** altura de uma linha de texto do rótulo (13 px no nome, 12 px no detalhe, linha de 16 px) */
const LINE = 16;
/** um rótulo: o nome (1 ou 2 linhas), o detalhe e o respiro até o próximo */
const labelHeight = (nameLines: number) => nameLines * LINE + LINE + 8;
/** nome que não cabe numa linha da coluna vai para duas (line-clamp-2): ~6,9 px por letra a 13 px */
const linesFor = (text: string, width: number) => (text.length * 6.9 > width ? 2 : 1);

type Cursor = { side: 'l' | 'r'; i: number };

export function EarningsFlow({ sources, targets, ariaSources, ariaTargets }: {
  sources: FlowSource[];
  targets: FlowTarget[];
  ariaSources: string;
  ariaTargets: string;
}) {
  const tr = useTr();
  const [ref, W] = useWidth();
  // realce: o mouse em cima, o toque (liga e desliga) ou o cursor do teclado, nessa ordem de prioridade inversa
  const [hover, setHover] = useState<string | null>(null);
  const [touch, setTouch] = useState<string | null>(null);
  const [cur, setCur] = useState<Cursor | null>(null);

  // celular (< 520 px): sem coluna de rótulos à esquerda (as fontes vão numa legenda acima) e a coluna dos itens com
  // ~58% da largura, para as fitas terem ~100 px e os nomes caberem
  const narrow = W > 0 && W < 520;
  const L = narrow ? 0 : W >= 720 ? 176 : 136;
  const R = narrow ? Math.round(W * 0.58) : W >= 720 ? 216 : 168;
  const lead = narrow ? 10 : 18;
  const x0 = narrow ? 0 : L + lead;
  const x1 = W - R - lead - NODE;

  const leftH = sources.map((s) => labelHeight(narrow ? 1 : linesFor(s.label, L - 18)));
  // o ✓ e a pizza tomam ~20 px da linha do nome
  const rightH = targets.map((t) => labelHeight(linesFor(t.label, R - (t.kind === 'leftover' ? 4 : 20))));
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const total = sources.reduce((s, x) => s + x.value, 0);
  const H = Math.max(240, sum(rightH) + 8, narrow ? 0 : sum(leftH) + 8);
  // a coluna dos itens pode passar da das fontes: o parcial ocupa a altura do item inteiro
  const rightTotal = targets.reduce((s, t) => s + (t.whole ?? t.value), 0);
  const scale = total > 0 ? Math.min((H - GAP * (sources.length - 1)) / total, (H - GAP * (targets.length - 1)) / Math.max(total, rightTotal)) : 0;

  // posição de cada nó: altura pelo valor (no mínimo 3 px, para nada sumir), colunas centradas na altura
  const column = (values: number[]) => {
    const heights = values.map((v) => Math.max(v * scale, 3));
    const height = heights.reduce((s, h) => s + h, 0) + GAP * (values.length - 1);
    let y = (H - height) / 2;
    return heights.map((h) => {
      const top = y;
      y += h + GAP;
      return { top, h };
    });
  };
  const left = column(sources.map((s) => s.value));
  const right = column(targets.map((t) => t.whole ?? t.value));

  // faixas: a sobreposição entre o trecho de cada fonte e o de cada item, na soma acumulada
  const bands: Band[] = [];
  let a = 0;
  sources.forEach((s, i) => {
    let c = 0;
    targets.forEach((t, j) => {
      const lo = Math.max(a, c);
      const hi = Math.min(a + s.value, c + t.value);
      if (hi - lo > 1e-9) {
        bands.push({
          key: `${s.id}>${t.id}`,
          source: s.id,
          target: t.id,
          color: s.color,
          ys: left[i].top + (lo - a) * scale,
          yt: right[j].top + (lo - c) * scale,
          t: (hi - lo) * scale,
        });
      }
      c += t.value;
    });
    a += s.value;
  });

  const leftY = spread(left.map((p) => p.top + p.h / 2), leftH, H);
  const rightY = spread(right.map((p) => p.top + p.h / 2), rightH, H);
  const cx0 = x0 + NODE;
  const mid = (cx0 + x1) / 2;

  // o que está realçado e o que se liga a ele
  const curId = cur ? (cur.side === 'l' ? sources[cur.i]?.id : targets[cur.i]?.id) ?? null : null;
  const hot = curId ?? touch ?? hover;
  const linked = new Set<string>(hot ? [hot, ...bands.filter((b) => b.source === hot || b.target === hot).flatMap((b) => [b.source, b.target])] : []);
  const lit = (b: Band) => !hot || b.source === hot || b.target === hot;
  // fora do realce, o texto esmaece pela cor (faint), nunca por opacidade
  const tone = (id: string, base: string) => (hot && !linked.has(id) ? 'text-faint' : base);
  const toggleTouch = (id: string) => (e: { pointerType: string }) => {
    if (e.pointerType !== 'mouse') setTouch((t) => (t === id ? null : id));
  };

  // frase para o leitor de tela a cada passo do teclado: o nó, o valor e com o que ele se liga
  const names = (ids: string[], list: { id: string; label: string }[]) => list.filter((x) => ids.includes(x.id)).map((x) => x.label).join(', ');
  const readout = (() => {
    if (!cur || !curId) return '';
    if (cur.side === 'l') {
      const s = sources[cur.i];
      return tr(`${s.label}, ${s.detail}. Pays: ${names(bands.filter((b) => b.source === s.id).map((b) => b.target), targets)}.`, `${s.label}, ${s.detail}. Paga: ${names(bands.filter((b) => b.source === s.id).map((b) => b.target), targets)}.`);
    }
    const t = targets[cur.i];
    const status = t.kind === 'full' ? tr('paid in full', 'pago inteiro') : t.kind === 'partial' ? tr('in part', 'em parte') : tr('left over', 'sobra');
    return tr(`${t.label}, ${t.detail}, ${status}. Paid by: ${names(bands.filter((b) => b.target === t.id).map((b) => b.source), sources)}.`, `${t.label}, ${t.detail}, ${status}. Pago por: ${names(bands.filter((b) => b.target === t.id).map((b) => b.source), sources)}.`);
  })();

  // uma parada de Tab no desenho: ↑↓ andam na coluna, ←→ trocam de coluna (para o primeiro nó ligado), Esc limpa
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'];
    if (!keys.includes(e.key)) return;
    if (e.key === 'Escape') {
      if (cur) e.preventDefault();
      setCur(null);
      return;
    }
    e.preventDefault();
    const key = e.key;
    // sempre a partir do cursor anterior: duas setas no mesmo quadro andam dois passos
    setCur((prev) => {
      const c: Cursor = prev ?? { side: key === 'ArrowLeft' ? 'l' : 'r', i: -1 };
      const len = c.side === 'l' ? sources.length : targets.length;
      const firstLinked = (side: 'l' | 'r') => {
        const id = c.side === 'l' ? sources[Math.max(0, c.i)]?.id : targets[Math.max(0, c.i)]?.id;
        const other = side === 'l' ? sources : targets;
        const hit = bands.find((b) => (side === 'l' ? b.target === id : b.source === id));
        return Math.max(0, other.findIndex((x) => x.id === (side === 'l' ? hit?.source : hit?.target)));
      };
      if (key === 'ArrowDown') return { side: c.side, i: Math.min(len - 1, c.i + 1) };
      if (key === 'ArrowUp') return { side: c.side, i: Math.max(0, c.i < 0 ? 0 : c.i - 1) };
      if (key === 'Home') return { side: c.side, i: 0 };
      if (key === 'End') return { side: c.side, i: len - 1 };
      if (key === 'ArrowLeft') return prev && c.side === 'r' ? { side: 'l', i: firstLinked('l') } : { side: 'l', i: Math.max(0, c.i) };
      return prev && c.side === 'l' ? { side: 'r', i: firstLinked('r') } : { side: 'r', i: Math.max(0, c.i) };
    });
  };

  const label = (id: string, y: number, h: number, side: 'left' | 'right', children: ReactNode) => (
    <li
      key={id}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(id); }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={toggleTouch(id)}
      className={cx(
        'absolute flex flex-col justify-center rounded-md',
        side === 'left' ? 'items-end pr-1 text-right' : 'items-start pl-1 text-left',
        curId === id && 'bg-panel2',
      )}
      style={{ top: y - h / 2, height: h, ...(side === 'left' ? { left: 0, width: L } : { left: W - R, width: R }) }}
    >
      {children}
    </li>
  );

  return (
    <div ref={ref} className="w-full">
      {/* celular: as fontes numa legenda acima do desenho, uma linha cada (amostra, nome, valor) */}
      {narrow ? (
        <ul aria-label={ariaSources} className="mb-3 space-y-1">
          {sources.map((s) => (
            <li
              key={s.id}
              onPointerDown={toggleTouch(s.id)}
              className={cx('flex min-h-8 items-center gap-2 rounded-md px-1 text-[13px]', curId === s.id && 'bg-panel2')}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className={cx('min-w-0 flex-1 break-words', tone(s.id, 'text-ink'))}>{s.label}</span>
              <span className={cx('tnum shrink-0 text-xs', tone(s.id, 'text-muted'))}>{s.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    <div
      tabIndex={0}
      role="group"
      aria-roledescription={tr('flow chart', 'diagrama de fluxo')}
      aria-label={tr('Flow from the sources to what they pay. Arrow keys go through it; Esc clears.', 'Fluxo das fontes até o que elas pagam. As setas percorrem o desenho; Esc limpa.')}
      onKeyDown={onKey}
      onBlur={() => setCur(null)}
      className="relative w-full rounded-lg"
      style={{ height: W ? H : 260 }}
    >
      <p aria-live="polite" className="sr-only">{readout}</p>
      {W ? (
        <>
          <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 overflow-visible">
            {bands.map((b) => (
              <path
                key={b.key}
                d={`M${cx0} ${b.ys}C${mid} ${b.ys} ${mid} ${b.yt} ${x1} ${b.yt}L${x1} ${b.yt + b.t}C${mid} ${b.yt + b.t} ${mid} ${b.ys + b.t} ${cx0} ${b.ys + b.t}Z`}
                fill={b.color}
                fillOpacity={lit(b) ? (hot ? 0.62 : 0.38) : 0.1}
                className="transition-[fill-opacity] duration-150"
              />
            ))}
            {sources.map((s, i) => (
              <g key={s.id} onPointerDown={toggleTouch(s.id)}>
                <rect x={x0} y={left[i].top} width={NODE} height={left[i].h} rx={2} fill={s.color} />
                {/* traço-guia quando o rótulo teve de sair do lado do nó */}
                {!narrow && Math.abs(leftY[i] - (left[i].top + left[i].h / 2)) > 3 ? (
                  <path d={`M${x0 - 2} ${left[i].top + left[i].h / 2}L${L + 2} ${leftY[i]}`} stroke="var(--color-line2)" strokeWidth={1} fill="none" />
                ) : null}
              </g>
            ))}
            {targets.map((t, j) => (
              <g key={t.id} onPointerDown={toggleTouch(t.id)}>
                {/* a sobra é vazada: não é um item pago, e o cinza cheio já é a cor dos outros ativos com APY */}
                {t.kind === 'leftover' ? (
                  <rect x={x1 + 0.75} y={right[j].top + 0.75} width={NODE - 1.5} height={Math.max(0, right[j].h - 1.5)} rx={2} fill="none" stroke="var(--color-field)" strokeWidth={1.5} />
                ) : t.kind === 'partial' && t.whole ? (
                  // o parcial na altura do item inteiro: a parte paga em cima (onde as fitas chegam), o resto em trilho
                  <>
                    <rect x={x1 + 0.5} y={right[j].top + 0.5} width={NODE - 1} height={Math.max(0, right[j].h - 1)} rx={2} fill="var(--color-accent)" fillOpacity={0.15} stroke="var(--color-line2)" strokeWidth={1} />
                    <rect x={x1} y={right[j].top} width={NODE} height={Math.max(2, t.value * scale)} rx={2} fill="var(--color-muted)" />
                  </>
                ) : (
                  <rect x={x1} y={right[j].top} width={NODE} height={right[j].h} rx={2} fill="var(--color-muted)" />
                )}
                {Math.abs(rightY[j] - (right[j].top + right[j].h / 2)) > 3 ? (
                  <path d={`M${x1 + NODE + 2} ${right[j].top + right[j].h / 2}L${W - R - 2} ${rightY[j]}`} stroke="var(--color-line2)" strokeWidth={1} fill="none" />
                ) : null}
              </g>
            ))}
          </svg>
          {narrow ? null : (
            <ul aria-label={ariaSources}>
              {sources.map((s, i) => label(s.id, leftY[i], leftH[i], 'left', (
                <>
                  <span className="flex max-w-full items-center gap-1.5 text-[13px] leading-4">
                    <span className={cx('line-clamp-2 min-w-0 break-words', tone(s.id, 'text-ink'))}>{s.label}</span>
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  </span>
                  <span className={cx('tnum mt-0.5 max-w-full truncate text-xs leading-4', tone(s.id, 'text-muted'))}>{s.detail}</span>
                </>
              )))}
            </ul>
          )}
          <ul aria-label={ariaTargets}>
            {targets.map((t, j) => label(t.id, rightY[j], rightH[j], 'right', (
              <>
                <span className="flex max-w-full items-start gap-1 text-[13px] leading-4">
                  {t.kind === 'full' ? (
                    <>
                      <Check aria-hidden className="mt-px size-3.5 shrink-0 text-good" />
                      <span className="sr-only">{tr('paid in full: ', 'pago inteiro: ')}</span>
                    </>
                  ) : t.kind === 'partial' ? (
                    <>
                      <PartialPie share={t.share ?? 0} />
                      <span className="sr-only">{tr('paid in part: ', 'pago em parte: ')}</span>
                    </>
                  ) : null}
                  <span className={cx('line-clamp-2 min-w-0 break-words', tone(t.id, t.kind === 'leftover' ? 'text-muted' : 'text-ink'))}>{t.label}</span>
                </span>
                <span className={cx('tnum mt-0.5 max-w-full truncate text-xs leading-4', tone(t.id, 'text-muted'))}>{t.detail}</span>
              </>
            )))}
          </ul>
        </>
      ) : null}
    </div>
    </div>
  );
}
