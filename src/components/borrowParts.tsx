import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Lightbulb, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import {
  DEBT_ASSETS,
  DEBT_GROUP_OF,
  DUST_USD,
  EARN_APY_DATE,
  MARKET_ASSETS,
  OBSERVED_RATES,
  APR_MAX,
  CASHBACK_PCT_MAX,
  PERIOD_YEARS,
  debtGroups,
  type CarryPeriod,
  type RateTip,
  type BorrowSummary,
  type CollateralLine,
  type DebtAsset,
  type DebtGroup,
  type DebtLine,
  type Uncounted,
  type MarketAsset,
} from '../lib/borrow';
import { dateShort, nb, num, pct, usd } from '../lib/format';
import { cx } from '../lib/cx';
import { useLocale, useTr } from '../state/locale';
import { Badge, Button, Panel, PanelTitle, Segmented, Why } from './ui';
import { AssetChip } from './portfolio';
import { BORROW_COLORS, durationText, monthLabelFrom } from './borrowCharts';

// As partes da tela Empréstimo: a faixa de números no topo (como a da Aave, sem o health factor, que o varejo não lê),
// o "rende × custa" (o ouro da tela) com o gráfico do quanto já foi pago, a garantia (só o que está ativo, com
// "Adicionar" e "Sincronizar") e o empréstimo (agrupado por moeda, com "Detalhes" para ver ativo por ativo).

export const label = 'text-xs font-medium uppercase tracking-[0.12em] text-faint';
export const figure = 'tnum font-display font-semibold tracking-tight';

// ---------- campo numérico ----------

/** "12,90", "12.90", "1.234,56" ou "1,234.56" → número; texto que não é número → NaN. */
export function parseLoose(text: string): number {
  const t = text.trim().replace(/[\s$%]|US/g, '');
  if (!t) return NaN;
  const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  // "1.234" (milhar) e "1,5" (decimal): com um separador só e três dígitos depois, é milhar
  const tail = last < 0 ? '' : t.slice(last + 1);
  const single = (t.match(/[.,]/g) ?? []).length === 1;
  const normalized = last < 0 ? t : single && tail.length === 3 && t[last] !== '.' ? t.replace(/[.,]/g, '') : `${t.slice(0, last).replace(/[.,]/g, '')}.${tail}`;
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}

/**
 * Campo de número que aceita vírgula ou ponto. Cada digitação válida já vale (a tela recalcula na hora); o texto que
 * não é número fica marcado e não muda nada. Quando o valor muda por fora (reset), o campo acompanha, a não ser que
 * esteja com o foco.
 */
export function NumberField({ id, value, onChange, max, decimals = 2, prefix, suffix, ariaLabel, className, describedBy }: {
  id?: string;
  value: number;
  onChange: (n: number) => void;
  max: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  ariaLabel?: string;
  className?: string;
  describedBy?: string;
}) {
  const { locale } = useLocale();
  const fmt = (n: number) => {
    const s = String(Math.round(n * 10 ** decimals) / 10 ** decimals);
    return locale === 'pt' ? s.replace('.', ',') : s;
  };
  const [draft, setDraft] = useState(() => fmt(value));
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  // valor novo vindo de fora (reset, troca de ativo): o texto acompanha, menos durante a digitação
  if (value !== seen && !focused) {
    setSeen(value);
    setDraft(fmt(value));
  }
  const parsed = parseLoose(draft);
  const bad = draft.trim() !== '' && (!Number.isFinite(parsed) || parsed > max);
  return (
    <div className={cx('flex min-h-11 items-center gap-1 rounded-lg border bg-panel2 px-2.5 pointer-fine:sm:min-h-9', bad ? 'border-bad' : 'border-field', className)}>
      {prefix ? <span aria-hidden className="text-sm text-faint">{prefix}</span> : null}
      <input
        id={id}
        value={draft}
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        aria-describedby={describedBy}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (draft.trim() === '') {
            onChange(0);
            setDraft(fmt(0));
            setSeen(0);
          } else if (!bad) setDraft(fmt(parsed));
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseLoose(e.target.value);
          if (Number.isFinite(n) && n <= max) {
            setSeen(n);
            onChange(n);
          }
        }}
        className="tnum w-full min-w-0 bg-transparent text-base text-ink outline-none pointer-fine:sm:text-sm"
      />
      {suffix ? <span aria-hidden className="text-sm text-faint">{suffix}</span> : null}
    </div>
  );
}

/** Interruptor (role="switch"): o "Detalhes" do empréstimo. 44px de toque pelo `tap`. */
export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="tap inline-flex cursor-pointer items-center gap-2 rounded-lg py-1 text-xs text-muted transition-colors hover:text-ink"
    >
      <span className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line2')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-ink transition-[left] duration-200', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {children}
    </button>
  );
}

/** Chip que liga e desliga (as marcas do gráfico, o cashback). */
export function ToggleChip({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        'tap inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        on ? 'border-good/50 bg-good/10 text-good' : 'border-line2 text-faint hover:text-muted',
      )}
    >
      <span aria-hidden className={cx('size-1.5 rounded-full', on ? 'bg-good' : 'bg-line2')} />
      {children}
    </button>
  );
}

// ---------- o topo ----------

/** A faixa da Aave, sem health factor: emprestado, patrimônio, APY líquido, poder usado e o que ainda dá para pegar. */
export function HeroStats({ s, simulating }: { s: BorrowSummary; simulating: boolean }) {
  const tr = useTr();
  return (
    <Panel className="p-0">
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-line">
        <HeroCell term={tr('Borrowed', 'Emprestado')} className="col-span-2 sm:col-span-1" value={<span className={cx(figure, 'text-[1.625rem] leading-none sm:text-[1.75rem]')}>{usd(s.debt)}</span>} sub={s.debt > 0 ? tr(`at ${pct(s.apr, 2)} a year on average`, `a ${pct(s.apr, 2)} ao ano, em média`) : tr('no loan', 'sem empréstimo')} />
        <HeroCell term={tr('Net worth', 'Patrimônio líquido')} value={<span className={cx(figure, 'text-xl sm:text-2xl')}>{usd(s.netWorth)}</span>} sub={tr(`${usd(s.collateralUsd)} collateral`, `${usd(s.collateralUsd)} de garantia`)} />
        <HeroCell
          term={tr('Net APY', 'APY líquido')}
          value={<span className={cx(figure, 'text-xl sm:text-2xl', s.netApy !== null && s.netApy < 0 ? 'text-bad' : 'text-good')}>{s.netApy === null ? '—' : pct(s.netApy, 2)}</span>}
          sub={tr('yield − interest, on net worth', 'rendimento − juros, sobre o patrimônio')}
        />
        <HeroCell
          term={tr('Borrow power used', 'Poder de empréstimo usado')}
          value={<span className={cx(figure, 'text-xl sm:text-2xl')}>{Number.isFinite(s.borrowPowerUsed) ? pct(s.borrowPowerUsed * 100, 1) : '—'}</span>}
          sub={<PowerBar used={s.borrowPowerUsed} />}
        />
        <HeroCell term={tr('Available to borrow', 'Disponível para pegar')} value={<span className={cx(figure, 'text-xl sm:text-2xl')}>{usd(s.available)}</span>} sub={tr(`of ${usd(s.borrowPower)} borrow power`, `de ${usd(s.borrowPower)} de poder`)} />
      </dl>
      {simulating ? (
        <p className="border-t border-line px-5 py-2 text-xs text-accent">{tr('Simulation: these numbers use your edits below, not your account as it is.', 'Simulação: estes números usam o que você mudou abaixo, não a conta como está.')}</p>
      ) : null}
    </Panel>
  );
}

function HeroCell({ term, value, sub, className }: { term: string; value: ReactNode; sub: ReactNode; className?: string }) {
  return (
    <div className={cx('border-b border-line px-5 py-4 lg:border-b-0', className)}>
      <dt className={label}>{term}</dt>
      <dd className="mt-2">{value}</dd>
      <dd className="mt-1.5 text-xs text-muted">{sub}</dd>
    </div>
  );
}

function PowerBar({ used }: { used: number }) {
  const tr = useTr();
  const w = Math.min(100, Math.max(0, (Number.isFinite(used) ? used : 1) * 100));
  return (
    <span
      role="meter"
      aria-label={tr('Borrow power used', 'Poder de empréstimo usado')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(w)}
      className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line"
    >
      <span className={cx('block h-full rounded-full', w > 90 ? 'bg-bad' : w > 70 ? 'bg-warn' : 'bg-accent')} style={{ width: `${w}%` }} />
    </span>
  );
}

// ---------- rende × custa ----------

export function CarryPanel({ s, paidMonths, chart, horizonControl, period, onPeriod }: {
  s: BorrowSummary;
  /** O período do número de cima e das barras (7 dias, 1 mês, 1 ano) */
  period: CarryPeriod;
  onPeriod: (p: CarryPeriod) => void;
  /** O mês em que o lucro da garantia paga 5/10/25/50/75/100% do empréstimo (sem cashback); null = não chega em 50 anos */
  paidMonths: Record<number, number | null>;
  chart: ReactNode;
  horizonControl: ReactNode;
}) {
  const tr = useTr();
  const { locale } = useLocale();
  const debt = s.debt;
  const f = PERIOD_YEARS[period];
  const max = Math.max(s.yieldYear, s.interestYear, 1) * f;
  const per = { '7d': tr('in 7 days', 'em 7 dias'), '1m': tr('a month', 'por mês'), '1y': tr('a year', 'por ano') }[period];
  const positive = s.netYear >= 0;
  const start = new Date();
  const full = paidMonths[1] ?? null;
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.1em] text-muted sm:tracking-[0.14em]">{tr('What the collateral earns vs. what the loan costs', 'O que a garantia rende × o que o empréstimo custa')}</h2>
          {debt > 0 ? (
            <p className="mt-2 font-display text-[clamp(1.5rem,6vw,2.25rem)] leading-tight font-semibold tracking-tight">
              <span className={cx('tnum', positive ? 'text-good' : 'text-bad')}>{positive ? '+' : '−'}{usd(Math.abs(s.netYear * f))}</span>{' '}
              <span className="text-base font-normal text-faint sm:text-lg">{tr(`${per} after interest`, `${per} depois dos juros`)}</span>
            </p>
          ) : (
            <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{tr('No loan right now', 'Sem empréstimo agora')}</p>
          )}
          <p className="mt-1 text-sm text-muted">
            {nb(tr(
              `Collateral earns ≈ ${usd(s.yieldYear * f)} ${per} (${pct(s.collateralApy, 2)} a year)${debt > 0 ? `; the loan costs ≈ ${usd(s.interestYear * f)} (${pct(s.apr, 2)} a year)` : ''}.`,
              `A garantia rende ≈ ${usd(s.yieldYear * f)} ${per} (${pct(s.collateralApy, 2)} ao ano)${debt > 0 ? `; o empréstimo custa ≈ ${usd(s.interestYear * f)} (${pct(s.apr, 2)} ao ano)` : ''}.`,
            ))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel={tr('Period', 'Período')}
            value={period}
            onChange={onPeriod}
            options={[{ value: '7d', label: '7D' }, { value: '1m', label: '1M' }, { value: '1y', label: tr('1Y', '1A') }]}
          />
          <Badge>{tr('Estimate', 'Estimativa')}</Badge>
        </div>
      </div>

      {/* as duas barras na mesma escala: o tamanho do rendimento perto do tamanho dos juros é o que a tela quer mostrar */}
      <div className="mt-5 space-y-2.5">
        <CompareBar label={tr('Collateral yield', 'Rendimento da garantia')} value={s.yieldYear * f} max={max} color={BORROW_COLORS.yield} />
        <CompareBar label={tr('Loan interest', 'Juros do empréstimo')} value={s.interestYear * f} max={max} color="var(--color-bad)" />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Kpi
          term={tr('Yield ÷ interest', 'Rendimento ÷ juros')}
          value={s.coverage === null ? '—' : `${num(s.coverage, s.coverage < 10 ? 1 : 0)}×`}
          tone={s.coverage === null ? undefined : s.coverage >= 1 ? 'good' : 'bad'}
          sub={s.coverage === null
            ? tr('no interest to cover', 'não há juros a cobrir')
            : s.coverage >= 1
              ? tr(`the yield covers the interest ${num(s.coverage, 1)} times over`, `o rendimento cobre os juros ${num(s.coverage, 1)} vezes`)
              : tr('the interest is larger than the yield', 'os juros são maiores que o rendimento')}
        />
        <Kpi
          term={tr('Interest stays below the yield up to', 'Os juros ficam abaixo do rendimento até')}
          value={s.breakEvenDebt === null ? '—' : usd(s.breakEvenDebt)}
          sub={s.breakEvenDebt === null ? tr('no interest rate set', 'sem taxa de juros') : tr(`of debt at today’s rates · you owe ${usd(debt)}`, `de dívida, nas taxas de hoje · você deve ${usd(debt)}`)}
        />
        <Kpi
          term={tr('The profit pays the loan in', 'O lucro paga o empréstimo em')}
          value={debt <= 0 ? '—' : full === null ? tr('50+ years', '50+ anos') : durationText(full, locale)}
          tone={debt > 0 && full !== null ? 'good' : undefined}
          sub={debt <= 0
            ? tr('nothing owed', 'nada devido')
            : full !== null
              ? `≈ ${monthLabelFrom(start, full, locale)}`
              : tr('the interest grows faster than the yield', 'os juros crescem mais que o rendimento')}
        />
      </div>

      {debt > 0 ? (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h3 className="text-sm font-medium text-ink">{tr('How much of the loan the collateral’s profit has paid', 'Quanto do empréstimo o lucro da garantia já pagou')}</h3>
            {horizonControl}
          </div>
          {chart}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {debt > 0 ? (
          // a taxa contra a taxa engana sozinha (uma garantia 7× maior que a dívida rende mais mesmo com APY menor): vai
          // junto o tamanho de uma contra a outra, em tom neutro
          <span className="tnum rounded-md border border-line2 px-2 py-0.5 text-xs text-muted">
            {nb(tr(
              `Collateral APY ${pct(s.collateralApy, 2)} · loan ${pct(s.apr, 2)} · collateral is ${num(s.collateralUsd / debt, 1)}× the debt`,
              `APY da garantia ${pct(s.collateralApy, 2)} · empréstimo ${pct(s.apr, 2)} · a garantia é ${num(s.collateralUsd / debt, 1)}× a dívida`,
            ))}
          </span>
        ) : null}
        <Why>
          {tr(
            'Yield = each collateral’s value × its APY; interest = each loan × its rate, both a year at today’s rates. The chart keeps today’s loan (no new spending) and adds up, month by month, the yield minus the interest: the collateral’s profit. Where it reaches what you borrowed, the profit alone would repay the loan; the card cashback stays out of it. It is a yardstick, not a repayment: the yield stays in the vault and the debt only goes down when you repay it. A liquidUSD balance can’t repay a USDT loan directly (it can repay USDC). APY and loan rates are variable; cashback is paid in ETHFI, whose price changes.',
            'Rendimento = valor de cada garantia × o APY dela; juros = cada empréstimo × a taxa dele, os dois por ano, nas taxas de hoje. O gráfico mantém o empréstimo de hoje (sem gasto novo) e soma, mês a mês, o rendimento menos os juros: o lucro da garantia. Onde ele alcança o que você pegou emprestado, só o lucro já pagaria o empréstimo; o cashback do cartão fica fora. É uma régua, não um pagamento: o rendimento fica no cofre e a dívida só cai quando você paga. Saldo em liquidUSD não paga empréstimo em USDT direto (paga o de USDC). APY e taxas são variáveis; o cashback é pago em ETHFI, de preço variável.',
          )}
        </Why>
      </div>
    </Panel>
  );
}

function CompareBar({ label: name, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    // no celular, o nome e o valor em cima e a barra embaixo, na largura toda; a partir de 640px, tudo numa linha
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr_6rem]">
      <span className="truncate text-muted">{name}</span>
      <span className="col-span-2 row-start-2 h-3 overflow-hidden rounded-full bg-line/60 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(value > 0 ? 1.5 : 0, (value / max) * 100)}%`, backgroundColor: color }} />
      </span>
      <span className="tnum col-start-2 row-start-1 text-right text-ink sm:col-start-3">{usd(value)}</span>
    </div>
  );
}

function Kpi({ term, value, sub, tone }: { term: string; value: string; sub: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line bg-panel2/40 p-4">
      <div className="text-xs leading-snug text-faint">{term}</div>
      <div className={cx(figure, 'mt-1.5 text-xl', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</div>
      <div className="mt-1 text-xs leading-snug text-muted">{sub}</div>
    </div>
  );
}

// ---------- garantia ----------

/**
 * Só o que está ativo: os ativos da conta com saldo (a poeira abaixo de US$ 1 vira uma nota) e o que a pessoa adicionou
 * na simulação. "Adicionar" abre a lista do mercado; "Sincronizar" busca a conta de novo (ou leva à Conexão).
 */
export function CollateralPanel({ lines, uncounted, onChange, onRemove, onAdd, onSync, syncing, total, apy, power }: {
  lines: CollateralLine[];
  uncounted: Uncounted[];
  onChange: (symbol: string, patch: Partial<CollateralLine>) => void;
  onRemove: (symbol: string) => void;
  onAdd: (asset: MarketAsset) => void;
  onSync: () => void;
  syncing: boolean;
  total: number;
  apy: number;
  power: number;
}) {
  const tr = useTr();
  const [adding, setAdding] = useState(false);
  const active = lines.filter((c) => !c.fromAccount || c.valueUsd >= DUST_USD);
  const dust = lines.length - active.length;
  const free = MARKET_ASSETS.filter((m) => !active.some((l) => l.symbol === m.symbol));
  return (
    <Panel className="flex flex-col">
      <PanelTitle
        hint={
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            title={tr('Fetch the account again from ether.fi', 'Buscar a conta de novo na ether.fi')}
            className="tap inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line2 px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink disabled:opacity-60"
          >
            <RefreshCw aria-hidden className={cx('size-3.5', syncing && 'animate-spin')} />
            {tr('Sync', 'Sincronizar')}
          </button>
        }
      >
        {tr('Your collateral', 'A sua garantia')}
      </PanelTitle>
      <dl className="mb-2 flex flex-wrap gap-x-6 gap-y-2 border-b border-line pb-4">
        <MiniStat term={tr('Balance', 'Saldo')} value={usd(total)} />
        <MiniStat term={tr('Earns a month', 'Rende por mês')} value={`+${usd((total * apy) / 100 / 12)}`} tone="good" />
        <MiniStat term="APY" value={pct(apy, 2)} />
        <MiniStat term={tr('Borrow power', 'Poder de empréstimo')} value={usd(power)} />
      </dl>
      {active.length ? (
        <div role="table" aria-label={tr('Collateral', 'Garantia')} className="text-sm">
          <div role="row" className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_5.5rem_3.5rem_2rem] gap-2 py-2 text-xs uppercase tracking-[0.08em] text-faint sm:grid">
            <span role="columnheader">{tr('Asset', 'Ativo')}</span>
            <span role="columnheader">{tr('Value', 'Valor')}</span>
            <span role="columnheader">APY</span>
            <span role="columnheader" title={tr('Product LTV: what you can borrow against it', 'Product LTV: quanto dá para pegar contra ela')}>LTV</span>
            <span role="columnheader"><span className="sr-only">{tr('Remove', 'Remover')}</span></span>
          </div>
          {active.map((c) => (
            <div key={c.symbol} role="row" className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 border-t border-line py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_5.5rem_3.5rem_2rem]">
              <div role="cell" className="flex min-w-0 items-center gap-2.5">
                <AssetChip asset={c.symbol} tint="bg-panel2 text-muted" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{c.symbol}</div>
                  <div className="truncate text-xs text-faint">{c.fromAccount ? c.name : tr('simulated', 'simulada')}</div>
                  {c.apy > 0 && c.valueUsd > 0 ? <div className="text-xs"><PerMonth value={(c.valueUsd * c.apy) / 100 / 12} tone="good" /></div> : null}
                </div>
              </div>
              <div role="cell" className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                <NumberField value={c.valueUsd} max={1e9} prefix="$" onChange={(n) => onChange(c.symbol, { valueUsd: n })} ariaLabel={tr(`${c.symbol} value in US$`, `Valor em ${c.symbol}, em US$`)} />
              </div>
              <div role="cell" className="row-start-3 sm:row-start-auto">
                <NumberField value={c.apy} max={100} suffix="%" onChange={(n) => onChange(c.symbol, { apy: n })} ariaLabel={tr(`${c.symbol} APY`, `APY de ${c.symbol}`)} />
              </div>
              <div role="cell" className="tnum row-start-3 text-muted sm:row-start-auto">
                <span className="text-xs text-faint sm:hidden">LTV </span>{pct(c.productLtv * 100)}
              </div>
              <div role="cell" className="col-start-2 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto">
                <button
                  type="button"
                  onClick={() => onRemove(c.symbol)}
                  aria-label={tr(`Remove ${c.symbol} from the simulation`, `Tirar ${c.symbol} da simulação`)}
                  className="tap flex size-8 cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-panel2 hover:text-ink"
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{tr('No active collateral. Add an asset to simulate, or sync your account.', 'Nenhuma garantia ativa. Adicione um ativo para simular, ou sincronize a conta.')}</p>
      )}
      <div className="mt-3">
        {adding ? (
          <AssetPicker
            assets={free}
            onPick={(m) => {
              onAdd(m);
              setAdding(false);
            }}
            onClose={() => setAdding(false)}
          />
        ) : (
          <Button className="w-full justify-center border-dashed" onClick={() => setAdding(true)} disabled={!free.length}>
            <Plus aria-hidden className="size-4" />
            {tr('Add collateral', 'Adicionar garantia')}
          </Button>
        )}
      </div>
      {dust > 0 || uncounted.length ? (
        <p className="mt-3 text-xs leading-relaxed text-faint">
          {dust > 0 ? tr(`${dust} asset${dust > 1 ? 's' : ''} under ${usd(DUST_USD)} not listed (still counted). `, `${dust} ativo${dust > 1 ? 's' : ''} abaixo de ${usd(DUST_USD)} fora da lista (continua${dust > 1 ? 'm' : ''} na conta). `) : ''}
          {uncounted.length ? tr('Not collateral (not in the published table): ', 'Não contam como garantia (fora da tabela pública): ') : ''}
          {uncounted.map((u) => `${u.symbol} ${usd(u.valueUsd)}`).join(' · ')}
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * "Adicionar garantia" em cards: os cofres da tela Earn em cima, grandes, com o logo, o APY de referência do app e o
 * LTV; o resto do mercado embaixo, em cards menores. Um toque adiciona o ativo à simulação. Esc ou "Fechar" saem.
 */
function AssetPicker({ assets, onPick, onClose }: { assets: MarketAsset[]; onPick: (m: MarketAsset) => void; onClose: () => void }) {
  const tr = useTr();
  const vaults = assets.filter((m) => m.vault);
  const others = assets.filter((m) => !m.vault);
  return (
    <div
      role="group"
      aria-label={tr('Choose collateral to add', 'Escolha a garantia para adicionar')}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="rounded-xl border border-line2 bg-panel2/40 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-[0.1em] text-faint">{tr('Liquid vaults (Earn)', 'Cofres Liquid (Earn)')}</h3>
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onClose}>{tr('Close', 'Fechar')}</Button>
      </div>
      {vaults.length ? (
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {vaults.map((m, i) => (
            <button
              key={m.symbol}
              type="button"
              autoFocus={i === 0}
              onClick={() => onPick(m)}
              className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-panel px-3 py-3 text-left transition-colors hover:border-accent/50 hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="scale-125"><AssetChip asset={m.symbol} tint="bg-panel2 text-muted" /></span>
              <span className="ml-1 min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{m.name}</span>
                <span className="block truncate text-xs text-faint">{m.symbol}</span>
                <span className="block text-xs text-faint">LTV {pct(m.productLtv * 100)}</span>
              </span>
              {m.refApy !== undefined ? (
                <span className="text-right">
                  <span className="tnum block font-display text-lg font-semibold text-good">{pct(m.refApy, 2)}</span>
                  <span className="block text-[11px] text-faint">APY</span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-faint">{tr('All vaults are already in the simulation.', 'Todos os cofres já estão na simulação.')}</p>
      )}
      <p className="mt-1.5 text-[11px] text-faint">{tr(`APY as the app’s Earn screen showed on ${dateShort(EARN_APY_DATE)}; it changes.`, `APY como a tela Earn do app mostrava em ${dateShort(EARN_APY_DATE)}; ele muda.`)}</p>
      {others.length ? (
        <>
          <h3 className="mt-4 mb-2 text-xs font-medium uppercase tracking-[0.1em] text-faint">{tr('Other assets', 'Outros ativos')}</h3>
          <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
            {others.map((m) => (
              <button
                key={m.symbol}
                type="button"
                onClick={() => onPick(m)}
                title={m.name}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-2 text-left transition-colors hover:border-accent/50 hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <AssetChip asset={m.symbol} tint="bg-panel2 text-muted" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{m.symbol}</span>
                  <span className="block truncate text-[11px] text-faint">LTV {pct(m.productLtv * 100)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MiniStat({ term, value, tone }: { term: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <dt className="text-xs text-faint">{term}</dt>
      <dd className={cx(figure, 'mt-0.5 text-lg', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</dd>
    </div>
  );
}

/** "+US$ 41,33/mês" em verde (rende) ou vermelho (a dívida cresce). */
function PerMonth({ value, tone }: { value: number; tone: 'good' | 'bad' }) {
  const tr = useTr();
  return <span className={cx('tnum whitespace-nowrap', tone === 'good' ? 'text-good' : 'text-bad')}>+{usd(value)}{tr('/mo', '/mês')}</span>;
}

// ---------- empréstimo ----------

const GROUP_ICON: Record<DebtGroup, DebtAsset[]> = { usd: ['USDT', 'USDC'], eth: ['WETH'], eur: ['EURC'] };

/** Ícones sobrepostos (o grupo do dólar com USDT e USDC). */
function ChipStack({ assets }: { assets: readonly string[] }) {
  return (
    <span className="flex shrink-0 -space-x-3">
      {assets.map((a) => (
        <span key={a} className="rounded-full ring-2 ring-panel">
          <AssetChip asset={a} tint="bg-panel2 text-muted" />
        </span>
      ))}
    </span>
  );
}

/**
 * O empréstimo como o app da ether.fi mostra: os ativos ativos (o que se deve) e os disponíveis (com a taxa). Na visão
 * normal, agrupado por moeda: dólar (USDT e USDC juntos), ETH e euro, nunca somados entre si. "Detalhes" separa ativo
 * por ativo e deixa mudar valor e taxa (vira simulação). O conector só informa o total: ele fica no ativo escolhido.
 */
export type BorrowTip = { kind: 'cheaper'; t: RateTip } | { kind: 'lowest'; asset: DebtAsset; apr: number; other: DebtAsset; otherApr: number };

/**
 * O balão de dica do empréstimo: só informação, sem dizer o que fazer. Com uma dívida num ativo mais caro que outro da
 * mesma moeda, a diferença por ano; com a dívida já no mais barato, isso mesmo. E o que muda além da taxa: o liquidUSD
 * paga USDC direto, não USDT; um empréstimo em WETH sai mais barato, mas cresce quando o ETH sobe.
 */
function RateBalloon({ tip }: { tip: BorrowTip }) {
  const tr = useTr();
  return (
    <div role="note" className="mt-4 rounded-xl border border-info/30 bg-info/10 px-3.5 py-3 text-sm leading-relaxed">
      <p className="flex items-start gap-2 text-ink">
        <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        <span>
          {tip.kind === 'cheaper'
            ? nb(tr(
              `${tip.t.to} is at ${pct(tip.t.toApr, 2)} and ${tip.t.from} at ${pct(tip.t.fromApr, 2)}: the same ${usd(tip.t.amount)} in ${tip.t.to} would cost ≈ ${usd(tip.t.savingYear)} a year less (≈ ${usd(tip.t.savingYear / 12)} a month).`,
              `O ${tip.t.to} está a ${pct(tip.t.toApr, 2)} e o ${tip.t.from} a ${pct(tip.t.fromApr, 2)}: os mesmos ${usd(tip.t.amount)} em ${tip.t.to} custariam ≈ ${usd(tip.t.savingYear)} a menos por ano (≈ ${usd(tip.t.savingYear / 12)} por mês).`,
            ))
            : nb(tr(
              `Your dollar loan is already at the lowest dollar rate: ${tip.asset} ${pct(tip.apr, 2)} vs ${tip.other} ${pct(tip.otherApr, 2)}.`,
              `O seu empréstimo em dólar já está na menor taxa em dólar: ${tip.asset} ${pct(tip.apr, 2)} × ${tip.other} ${pct(tip.otherApr, 2)}.`,
            ))}
        </span>
      </p>
      <p className="mt-1.5 pl-6 text-xs text-muted">
        {tr(
          `Beyond the rate: a USD Yield (liquidUSD) balance repays a USDC loan directly, not a USDT one. A WETH loan (${pct(OBSERVED_RATES.rates.WETH, 2)}) is cheaper but grows when ETH rises. Rates change; check the app.`,
          `Além da taxa: saldo no USD Yield (liquidUSD) paga empréstimo em USDC direto, não em USDT. O empréstimo em WETH (${pct(OBSERVED_RATES.rates.WETH, 2)}) é mais barato, mas cresce quando o ETH sobe. As taxas mudam; confira no app.`,
        )}
      </p>
    </div>
  );
}

export function BorrowPanel({ debts, details, onDetails, accountAsset, onAccountAsset, accountLoan, onAmount, onApr, onAprReset, aprCustom, onAdd, onRemove, spend, onSpend, cashbackPct, onCashbackPct, monthlyCashback, s, tip }: {
  debts: DebtLine[];
  details: boolean;
  onDetails: (v: boolean) => void;
  accountAsset: DebtAsset;
  onAccountAsset: (a: DebtAsset) => void;
  /** A dívida ainda é a da conta (sem simulação): o ativo dela pode ser trocado */
  accountLoan: boolean;
  onAmount: (asset: DebtAsset, n: number) => void;
  onApr: (asset: DebtAsset, n: number) => void;
  onAprReset: (asset: DebtAsset) => void;
  aprCustom: (asset: DebtAsset) => boolean;
  onAdd: (asset: DebtAsset) => void;
  onRemove: (asset: DebtAsset) => void;
  spend: number;
  onSpend: (n: number) => void;
  /** Taxa de cashback da tela, em % (3 por padrão) */
  cashbackPct: number;
  onCashbackPct: (n: number) => void;
  monthlyCashback: number;
  s: BorrowSummary;
  /** A dica de taxa (da tela): um ativo mais barato na mesma moeda, ou a confirmação de que já está no mais barato */
  tip: BorrowTip | null;
}) {
  const tr = useTr();
  const id = useId();
  const groups = debtGroups(debts);
  const available = DEBT_ASSETS.filter((a) => !debts.some((d) => d.asset === a));
  const groupName: Record<DebtGroup, string> = { usd: tr('Dollar', 'Dólar'), eth: 'ETH', eur: tr('Euro', 'Euro') };
  return (
    <Panel className="flex flex-col">
      <PanelTitle hint={<Switch checked={details} onChange={onDetails}>{tr('Details', 'Detalhes')}</Switch>}>{tr('Your borrow', 'O seu empréstimo')}</PanelTitle>
      <dl className="mb-2 flex flex-wrap gap-x-6 gap-y-2 border-b border-line pb-4">
        {groups.length ? groups.map((g) => (
          <MiniStat key={g.group} term={tr(`${groupName[g.group]} balance`, `Saldo em ${groupName[g.group].toLowerCase() === 'eth' ? 'ETH' : groupName[g.group].toLowerCase()}`)} value={usd(g.amount)} />
        )) : <MiniStat term={tr('Balance', 'Saldo')} value={usd(0)} />}
        <MiniStat term={tr('Grows a month', 'Cresce por mês')} value={`+${usd(s.interestYear / 12)}`} tone="bad" />
        <MiniStat term="APR" value={pct(s.apr, 2)} />
        <MiniStat term={tr('Power used', 'Poder usado')} value={Number.isFinite(s.borrowPowerUsed) ? pct(s.borrowPowerUsed * 100, 1) : '—'} />
      </dl>

      {tip ? <RateBalloon tip={tip} /> : null}

      <h3 className="mt-3 text-xs font-medium uppercase tracking-[0.1em] text-faint">{tr('Active', 'Ativos')}</h3>
      {debts.length === 0 ? (
        <p className="py-3 text-sm text-muted">{tr('No loan. Pick one below to simulate.', 'Nenhum empréstimo. Escolha um abaixo para simular.')}</p>
      ) : !details ? (
        <ul className="divide-y divide-line">
          {groups.map((g) => (
            <li key={g.group} className="flex items-center gap-3 py-3">
              <ChipStack assets={g.assets.length ? g.assets : GROUP_ICON[g.group]} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-ink">{groupName[g.group]}</div>
                <div className="tnum text-xs text-faint">{g.assets.join(' · ')} · {pct(g.apr, 2)}</div>
              </div>
              <div className="text-right">
                <div className="tnum font-medium text-ink">{usd(g.amount)}</div>
                <div className="text-xs"><PerMonth value={(g.amount * g.apr) / 100 / 12} tone="bad" /></div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-line">
          {debts.map((d) => (
            <li key={d.asset} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[auto_minmax(0,1fr)_8rem_6rem_2rem]">
              <AssetChip asset={d.asset} tint="bg-panel2 text-muted" />
              <div className="min-w-0">
                {accountLoan ? (
                  <select
                    aria-label={tr('Which asset your loan is in', 'Em que ativo está o seu empréstimo')}
                    value={accountAsset}
                    onChange={(e) => onAccountAsset(e.target.value as DebtAsset)}
                    className="cursor-pointer rounded-md border border-field bg-panel2 px-1.5 py-1 text-sm font-medium text-ink"
                  >
                    {DEBT_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                ) : (
                  <div className="font-medium text-ink">{d.asset}</div>
                )}
                <div className="mt-0.5 text-xs text-faint">{groupName[DEBT_GROUP_OF[d.asset]]}{d.amount > 0 ? <> · <PerMonth value={(d.amount * d.apr) / 100 / 12} tone="bad" /></> : null}</div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(d.asset)}
                aria-label={tr(`Remove ${d.asset} from the simulation`, `Tirar ${d.asset} da simulação`)}
                className="tap col-start-3 row-start-1 flex size-8 cursor-pointer items-center justify-center justify-self-end rounded-lg text-faint transition-colors hover:bg-panel2 hover:text-ink sm:col-start-5"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
              <div className="col-span-3 grid grid-cols-[1fr_6rem] gap-2 sm:col-span-2 sm:col-start-3 sm:row-start-1 sm:grid-cols-[8rem_6rem]">
                <NumberField value={d.amount} max={1e9} prefix="$" onChange={(n) => onAmount(d.asset, n)} ariaLabel={tr(`${d.asset} debt in US$`, `Dívida em ${d.asset}, em US$`)} />
                <NumberField value={d.apr} max={APR_MAX} suffix="%" onChange={(n) => onApr(d.asset, n)} ariaLabel={tr(`${d.asset} rate (APR)`, `Taxa de ${d.asset} (APR)`)} />
              </div>
              {aprCustom(d.asset) ? (
                <button type="button" onClick={() => onAprReset(d.asset)} className="tap col-span-3 inline-flex cursor-pointer items-center gap-1 justify-self-start text-xs text-faint underline decoration-dotted underline-offset-2 hover:text-muted sm:col-span-5">
                  <RotateCcw aria-hidden className="size-3" />
                  {tr(`rate back to ${pct(OBSERVED_RATES.rates[d.asset], 2)} (app, ${dateShort(OBSERVED_RATES.date)})`, `taxa de volta a ${pct(OBSERVED_RATES.rates[d.asset], 2)} (app, ${dateShort(OBSERVED_RATES.date)})`)}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {details && accountLoan ? (
        <p className="text-xs text-faint">{tr('The connector reports how much you owe, not in which asset: pick the one your app shows.', 'O conector informa quanto você deve, não em qual ativo: escolha o que o seu app mostra.')}</p>
      ) : null}

      {available.length ? (
        <>
          <h3 className="mt-4 text-xs font-medium uppercase tracking-[0.1em] text-faint">{tr('Available', 'Disponíveis')}</h3>
          <ul className="divide-y divide-line">
            {available.map((a) => (
              <li key={a} className="flex items-center gap-3 py-2.5">
                <AssetChip asset={a} tint="bg-panel2 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{a}</div>
                  <div className="text-xs text-faint">{groupName[DEBT_GROUP_OF[a]]}</div>
                </div>
                <span className="tnum text-sm text-muted">{pct(OBSERVED_RATES.rates[a], 2)}</span>
                <Button variant="ghost" className="px-2.5 text-xs" onClick={() => onAdd(a)} aria-label={tr(`Simulate a ${a} loan`, `Simular um empréstimo em ${a}`)}>
                  <Plus aria-hidden className="size-3.5" />
                  {tr('Simulate', 'Simular')}
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-faint">{tr(`Rates as shown in the ether.fi app on ${dateShort(OBSERVED_RATES.date)} · variable`, `Taxas como o app da ether.fi mostrava em ${dateShort(OBSERVED_RATES.date)} · variáveis`)}</p>
        </>
      ) : null}

      <div className="mt-4 rounded-xl border border-line bg-panel2/40 p-4">
        <div className="grid grid-cols-[1fr_6.5rem] gap-2">
          <div>
            <label htmlFor={`${id}-spend`} className="mb-1.5 block text-xs text-muted">{tr('Card spending a month', 'Gasto no cartão por mês')}</label>
            <NumberField id={`${id}-spend`} value={spend} max={1e7} prefix="$" onChange={onSpend} />
          </div>
          <div>
            <label htmlFor={`${id}-cb`} className="mb-1.5 block text-xs text-muted">Cashback</label>
            <NumberField id={`${id}-cb`} value={cashbackPct} max={CASHBACK_PCT_MAX} suffix="%" onChange={onCashbackPct} />
          </div>
        </div>
        <p className="mt-1.5 text-xs text-faint">
          {nb(tr(
            `≈ ${usd(monthlyCashback)} of cashback a month, paid in ETHFI. Spending is your card average; this purchase money is yours, not new debt.`,
            `≈ ${usd(monthlyCashback)} de cashback por mês, pago em ETHFI. O gasto é a média do seu cartão; esse gasto sai do seu dinheiro, não vira dívida nova.`,
          ))}
        </p>
      </div>
    </Panel>
  );
}
