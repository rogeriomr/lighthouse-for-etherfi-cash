import { useId } from 'react';
import type { ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';
import { num, pct, usd } from '../lib/format';
import { cx } from '../lib/cx';
import type { Locale } from '../lib/locale';
import { earnedAt, leftOver, type ProjectionPoint } from '../lib/borrow';
import { useTr } from '../state/locale';
import { Panel } from './ui';
import { BORROW_COLORS, durationText, monthLabelFrom, profitPct, type PaidMark } from './borrowCharts';
import { figure, label } from './borrowParts';

/**
 * "Ao longo do tempo": um slider de meses (de hoje ao fim da janela do gráfico) que mostra a garantia e o empréstimo
 * naquele mês, lado a lado como os dois painéis logo acima (abre em hoje): a garantia crescendo pelo rendimento (e o poder de empréstimo
 * junto), a dívida crescendo pelos juros, o poder usado, e uma barra de quanto o rendido cobre do que se deve; depois dos
 * 100%, a mesma barra passa do traço do devido e o excesso fica verde, "lucro". Mesmas taxas paradas do gráfico, sem
 * gasto novo, preços parados: cenário, não previsão; o rendimento fica no cofre e a dívida só cai quando alguém paga.
 */
export function TimeTravel({ points, marks, month, onMonth, start, locale }: {
  /** A janela do gráfico (mês 0 = hoje) */
  points: readonly ProjectionPoint[];
  marks: readonly PaidMark[];
  month: number;
  onMonth: (m: number) => void;
  start: Date;
  locale: Locale;
}) {
  const tr = useTr();
  const id = useId();
  const n = points.length - 1;
  if (n < 1) return null;
  const m = Math.max(0, Math.min(n, month));
  const p = points[m];
  const today = points[0];
  const earned = earnedAt(p, false);
  const rest = leftOver(p, false);
  const isCovered = p.debt > 0 && rest >= 0;
  const share = p.debt > 0 ? earned / p.debt : 0;
  const used = p.borrowPower > 0 ? p.debt / p.borrowPower : null;
  const full = marks.find((mk) => mk.share >= 1 && mk.month <= n) ?? null;
  const when = m === 0 ? tr('Today', 'Hoje') : monthLabelFrom(start, m, locale);
  // a barra: a escala é o maior entre o rendido e o devido; azul até o devido, verde no que passa dele, traço claro no devido
  const scale = Math.max(earned, p.debt, 1);
  const blueW = (Math.min(earned, p.debt) / scale) * 100;
  const greenW = (Math.max(0, rest) / scale) * 100;
  const owedAt = (p.debt / scale) * 100;
  // posição de um mês sob o slider nativo: o centro do polegar anda de 8px a (100% − 8px)
  const at = (mo: number) => `calc(8px + (100% - 16px) * ${mo / n})`;
  const ticks = marks.filter((mk) => mk.share >= 0.25 && mk.month <= n);
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-[13px] font-medium uppercase tracking-[0.1em] text-muted sm:tracking-[0.14em]">{tr('Your position over time', 'A sua posição ao longo do tempo')}</h2>
          <p className="mt-1 text-sm text-muted">{tr('Drag to any month to see the collateral and the loan then, at today’s rates.', 'Arraste até qualquer mês para ver a garantia e o empréstimo naquele momento, nas taxas de hoje.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Jump on={m === 0} onClick={() => onMonth(0)}>{tr('Today', 'Hoje')}</Jump>
          {full ? <Jump on={m === full.month} onClick={() => onMonth(full.month)}>{tr('100%', '100%')} · {monthLabelFrom(start, full.month, locale)}</Jump> : null}
          <Jump on={m === n} onClick={() => onMonth(n)}>{durationText(n, locale)}</Jump>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <CalendarClock aria-hidden className="size-5 self-center text-accent" />
        <output htmlFor={`${id}-month`} aria-live="polite" className={cx(figure, 'text-2xl text-ink sm:text-[1.75rem]')}>{when}</output>
        {m > 0 ? <span className="text-sm text-faint">{tr('in ', 'em ')}{durationText(m, locale)}</span> : null}
      </div>

      <div className="relative mt-2 pb-6">
        <input
          id={`${id}-month`}
          type="range"
          min={0}
          max={n}
          step={1}
          value={m}
          onChange={(e) => onMonth(Number(e.target.value))}
          aria-labelledby={`${id}-title`}
          aria-valuetext={m === 0 ? tr('Today', 'Hoje') : `${when}, ${tr('in', 'em')} ${durationText(m, locale)}`}
          className="h-11 w-full cursor-pointer accent-[var(--color-accent)] pointer-fine:h-6"
        />
        {/* as marcas de 25/50/75/100% no trilho, nos mesmos meses da lista do gráfico */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-6 text-[11px]">
          <span className="absolute left-0 text-faint">{tr('now', 'hoje')}</span>
          {ticks.map((mk) => (
            <span key={mk.share} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: at(mk.month) }}>
              <span className={cx('h-1.5 w-px', mk.share >= 1 ? 'bg-ink' : 'bg-line2')} />
              {mk.share >= 1 ? <span className="tnum mt-0.5 font-semibold text-ink">100%</span> : null}
            </span>
          ))}
          <span className="absolute right-0 text-faint">{monthLabelFrom(start, n, locale)}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Side
          term={tr('Collateral', 'Garantia')}
          value={usd(p.collateralUsd)}
          delta={m === 0 ? tr('today', 'hoje') : `+${usd(p.collateralUsd - today.collateralUsd)} ${tr('earned since today', 'rendidos desde hoje')}`}
          tone={m === 0 ? undefined : 'good'}
          rowTerm={tr('Borrow power', 'Poder de empréstimo')}
          row={usd(p.borrowPower)}
        />
        <Side
          term={tr('You owe', 'Você deve')}
          value={usd(p.debt)}
          delta={m === 0 ? tr('today', 'hoje') : `+${usd(p.debt - today.debt)} ${tr('interest since today', 'de juros desde hoje')}`}
          tone={m === 0 ? undefined : 'bad'}
          rowTerm={tr('Power used', 'Poder usado')}
          row={used === null ? '—' : pct(used * 100, 1)}
          meter={used}
        />
      </div>

      {p.debt > 0 ? (
        <div className="mt-4 rounded-xl border border-line bg-panel2/40 p-4">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            {isCovered ? (
              <span className="text-ink">
                <span className="tnum font-medium text-good">{tr(`+${profitPct(earned, p.debt)}% profit`, `+${profitPct(earned, p.debt)}% de lucro`)}</span>
                {tr(' · the vault’s earnings would repay what you owe, with ', ' · o rendimento do cofre pagaria o que você deve, com ')}
                <span className="tnum font-medium text-good">+{usd(rest)}</span>
                {tr(' to spare', ' de sobra')}
              </span>
            ) : (
              <span className="text-ink">
                {tr('The vault’s earnings would cover ', 'O rendimento do cofre cobriria ')}
                <span className="tnum font-medium">{num(Math.floor(share * 100 + 1e-9), 0)}%</span>
                {tr(' of what you owe', ' do que você deve')}
              </span>
            )}
            <span className="tnum text-xs text-faint">{usd(earned)} {tr('earned', 'rendidos')} · {usd(p.debt)} {tr('owed', 'devidos')}</span>
          </p>
          <div className="relative mt-3 h-3">
            <div className="absolute inset-0 overflow-hidden rounded-full bg-line/60">
              <div className="flex h-full">
                <span className="block h-full transition-[width] duration-200" style={{ width: `${blueW}%`, backgroundColor: BORROW_COLORS.yield }} />
                {greenW > 0 ? <span className="ml-0.5 block h-full transition-[width] duration-200" style={{ width: `calc(${greenW}% - 2px)`, backgroundColor: BORROW_COLORS.leftOver }} /> : null}
              </div>
            </div>
            {/* o traço do que se deve, passando um pouco por cima e por baixo da barra */}
            <span aria-hidden className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${owedAt}%` }} />
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-faint">
        {tr(
          'Today’s rates, today’s loan and prices held still, no new card spending. The earnings stay in the vault: the loan only goes down when you repay it. A scenario, not a forecast.',
          'Taxas, empréstimo e preços de hoje parados, sem gasto novo no cartão. O rendimento fica no cofre: o empréstimo só cai quando você paga. É um cenário, não uma previsão.',
        )}
      </p>
    </Panel>
  );
}

function Jump({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'tap tnum cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors',
        on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:bg-panel2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function Side({ term, value, delta, tone, rowTerm, row, meter }: {
  term: string;
  value: string;
  delta: string;
  tone?: 'good' | 'bad';
  rowTerm: string;
  row: string;
  meter?: number | null;
}) {
  const w = meter === undefined || meter === null ? null : Math.min(100, Math.max(0, meter * 100));
  return (
    <div className="rounded-xl border border-line bg-panel2/40 p-4">
      <div className={label}>{term}</div>
      <div className={cx(figure, 'mt-2 text-xl sm:text-2xl text-ink')}>{value}</div>
      <div className={cx('tnum mt-1 text-xs', tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-faint')}>{delta}</div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs">
        <span className="text-muted">{rowTerm}</span>
        <span className="tnum text-ink">{row}</span>
      </div>
      {w !== null ? (
        <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line">
          <span className={cx('block h-full rounded-full transition-[width] duration-200', w > 90 ? 'bg-bad' : w > 70 ? 'bg-warn' : 'bg-accent')} style={{ width: `${w}%` }} />
        </span>
      ) : null}
    </div>
  );
}
