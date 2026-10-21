import type { Dataset, Holding, Transaction } from './types';
import { dateShort, daysAgo, money, num, usd } from './format.ts';
import { localIso } from './enrich.ts';
import { assetClassLabel, assetGroupLabel, typeLabel, txTitle } from './labels.ts';
import { assetClassOf, type AssetClass } from './assetClass.ts';
import { pick, type Locale } from './locale.ts';
import { CATEGORY } from './merchants.ts';

const R2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;

export type PeriodKey = '7d' | '30d' | '90d' | 'all';

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'all', label: 'Tudo' },
];

export function periodWindow(dataset: Dataset, period: PeriodKey): { from: string; to: string; days: number } {
  const to = `${dataset.referenceDate}T23:59:59Z`;
  if (period === 'all') {
    const earliest = dataset.transactions.length
      ? dataset.transactions.map((t) => t.date).reduce((a, b) => (a < b ? a : b))
      : dataset.referenceDate;
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(earliest)) / DAY) + 1);
    return { from: earliest, to, days };
  }
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const from = new Date(Date.parse(to) - (days - 1) * DAY).toISOString().slice(0, 10);
  return { from: `${from}T00:00:00Z`, to, days };
}

/** Entra em "quanto gastei": compra no cartão que não foi cancelada (estorno entra negativo e abate). */
export const isSpend = (t: Transaction) => t.type === 'purchase' && t.status !== 'void';
/** Cobrança de fato (sem estornos): base das regras de padrão, assinatura e viagem. */
export const isCharge = (t: Transaction) => isSpend(t) && t.amountUsd > 0;

/**
 * Data dentro da janela, por dia (AAAA-MM-DD). Comparar o ISO inteiro como texto perde a compra do primeiro segundo:
 * o conector manda milissegundos, e "…T00:00:00.500Z" < "…T00:00:00Z".
 */
export const inDays = (date: string, from: string, to: string) => {
  const day = date.slice(0, 10);
  return day >= from.slice(0, 10) && day <= to.slice(0, 10);
};

/** Compras dos dias de from a to, inclusive (as horas de from e to não contam). */
export function spendIn(dataset: Dataset, from: string, to: string): Transaction[] {
  return dataset.transactions.filter((t) => isSpend(t) && inDays(t.date, from, to));
}

/** true quando a janela pedida começa antes do histórico que foi carregado */
export function windowBeyondCoverage(dataset: Dataset, from: string): boolean {
  const c = dataset.coverage;
  return Boolean(c && !c.complete && Date.parse(from) < Date.parse(c.from));
}

/**
 * O mês ym pode ser comparado com outro: o histórico começa até o dia 1 dele (com histórico completo, o começo é a
 * abertura da conta) e o conector não omitiu linhas. O mesmo critério de isFullMonth, para quem compara trechos do
 * mês fora de monthEvolutions (o "vs os mesmos dias do mês passado" do Início).
 */
export function monthComparable(dataset: Dataset, ym: string): boolean {
  const c = dataset.coverage;
  return !c || (c.from.slice(0, 10) <= `${ym.slice(0, 7)}-01` && !c.droppedRows);
}

export interface Fx {
  currency: string;
  /** unidades da moeda da casa por 1 USD, médio nas compras do histórico */
  localPerUsd: number;
}

/** Câmbio efetivo médio das compras na moeda da casa; null quando a casa é USD. */
export function fxSummary(dataset: Dataset): Fx | null {
  const home = dataset.homeCurrency ?? 'USD';
  if (home === 'USD') return null;
  let local = 0;
  let usdTotal = 0;
  for (const t of dataset.transactions) {
    if (!isCharge(t) || t.currency !== home) continue;
    local += t.amount;
    usdTotal += t.amountUsd;
  }
  return usdTotal > 0 ? { currency: home, localPerUsd: local / usdTotal } : null;
}

/** Total na moeda da casa: valor local quando existe, conversão pelo câmbio médio no resto (por isso "≈"). */
export function homeTotal(rows: Transaction[], fx: Fx | null): number | null {
  if (!fx) return null;
  return R2(rows.reduce((s, t) => s + (t.currency === fx.currency ? t.amount : t.amountUsd * fx.localPerUsd), 0));
}

/** "≈ R$ 1.235": em unidades inteiras, porque o câmbio médio do histórico varia alguns por cento de um mês para outro. */
export function approxHome(rows: Transaction[], fx: Fx | null): string | null {
  const total = homeTotal(rows, fx);
  return total === null || !fx ? null : `≈ ${money(Math.round(total), fx.currency, { compact: true })}`;
}

export interface RecentFx extends Fx {
  /** Compras que entraram na média */
  count: number;
  /** Dia (AAAA-MM-DD) da compra mais antiga e da mais recente usadas */
  from: string;
  to: string;
}

/** Janela do câmbio recente, em dias até o referenceDate */
export const RECENT_FX_DAYS = 90;
/** Amostra mínima: com menos compras, o arredondamento das compras pequenas pesa demais na média */
export const RECENT_FX_MIN = 5;
/** Compra mais velha que isto não entra nem na reserva "as últimas N" */
export const RECENT_FX_MAX_AGE_DAYS = 365;

/**
 * Câmbio efetivo das compras recentes na moeda da casa, para converter um saldo de hoje (o fxSummary é a média do
 * histórico, boa para gasto e ruim para estoque: o câmbio muda alguns por cento de um mês para outro). Usa as compras
 * liquidadas dos últimos RECENT_FX_DAYS dias; se forem menos de RECENT_FX_MIN, as últimas RECENT_FX_MIN de até
 * RECENT_FX_MAX_AGE_DAYS dias. Média ponderada pelo valor (Σ local ÷ Σ USD), como o fxSummary. null quando a casa é
 * USD (ou desconhecida) ou não há a amostra mínima. O câmbio do cartão já inclui o spread da conversão.
 */
export function recentFx(dataset: Dataset): RecentFx | null {
  const home = dataset.homeCurrency;
  if (!home || home === 'USD') return null;
  const ref = dataset.referenceDate;
  const rows = dataset.transactions
    .filter((t) => isCharge(t) && t.status === 'settled' && t.currency === home && t.amount > 0 && daysAgo(t.date.slice(0, 10), ref) <= RECENT_FX_MAX_AGE_DAYS)
    .sort((a, b) => b.date.localeCompare(a.date));
  const inWindow = rows.filter((t) => daysAgo(t.date.slice(0, 10), ref) < RECENT_FX_DAYS);
  const used = inWindow.length >= RECENT_FX_MIN ? inWindow : rows.slice(0, RECENT_FX_MIN);
  if (used.length < RECENT_FX_MIN) return null;
  const local = used.reduce((s, t) => s + t.amount, 0);
  const usdTotal = used.reduce((s, t) => s + t.amountUsd, 0);
  if (!(usdTotal > 0)) return null;
  return {
    currency: home,
    localPerUsd: local / usdTotal,
    count: used.length,
    from: used.at(-1)!.date.slice(0, 10),
    to: used[0].date.slice(0, 10),
  };
}

export interface SpendSummary {
  total: number;
  count: number;
  pendingCount: number;
  pendingTotal: number;
  avgPerTx: number;
  avgPerDay: number;
  busiestDay: { day: string; total: number } | null;
  byDay: { day: string; total: number }[];
  byCategory: { name: string; total: number }[];
  byMerchant: { name: string; total: number; count: number }[];
  buckets: { subscriptions: number; everyday: number; oneOffs: number };
  rows: Transaction[];
}

export interface Subscription {
  merchant: string;
  category?: string;
  amount: number;
  cadenceDays: number;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  annualCost: number;
  totalSpent: number;
}

/** Cobrança de quem costuma ser assinatura, ainda sem recorrência suficiente no histórico. */
export interface LikelySubscription {
  merchant: string;
  category?: string;
  lastAmountUsd: number;
  lastAmountLocal: number;
  currency: string;
  lastDate: string;
  occurrences: number;
}

export interface Anomaly {
  kind: 'duplicate' | 'unusually_large' | 'first_time' | 'stuck_pending';
  /** "check_now" = confira (neutro); "worth_knowing" = vale saber. Vermelho só com `urgent`. */
  group: 'check_now' | 'worth_knowing';
  /** Dinheiro em risco agora: cobrança repetida que ainda está a confirmar. */
  urgent: boolean;
  title: string;
  /** Estabelecimento; no alerta agrupado, os nomes juntos */
  merchant: string;
  amountUsd: number;
  cardId?: string;
  date: string;
  relatedIds: string[];
  rationale: string;
}

export interface Trip {
  from: string;
  to: string;
  days: number;
  cities: string[];
  currencies: string[];
  total: number;
  dailyAvg: number;
  count: number;
  relatedIds: string[];
  byCategory: { name: string; total: number }[];
  byDay: { day: string; total: number }[];
  peakDay: { day: string; total: number } | null;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return R2(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function byMerchantOf(rows: Transaction[]): Map<string, Transaction[]> {
  const out = new Map<string, Transaction[]>();
  for (const t of rows) {
    if (!t.merchant) continue;
    const list = out.get(t.merchant) ?? [];
    list.push(t);
    out.set(t.merchant, list);
  }
  return out;
}

/** Merchants com cadência mensal detectável (>=3 ocorrências, gaps 27-35 dias, valor estável). */
export function detectSubscriptions(dataset: Dataset): Subscription[] {
  const subs: Subscription[] = [];
  for (const [merchant, list] of byMerchantOf(dataset.transactions.filter(isCharge))) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(Math.round((Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / DAY));
    }
    const monthly = gaps.length > 0 && gaps.every((g) => g >= 27 && g <= 35);
    if (!monthly) continue;
    const amounts = sorted.map((t) => t.amountUsd);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length);
    if (mean > 0 && sd / mean >= 0.15) continue;
    const cadenceDays = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    const last = sorted[sorted.length - 1];
    const next = new Date(Date.parse(last.date) + cadenceDays * DAY).toISOString();
    subs.push({
      merchant,
      category: last.category,
      amount: R2(mean),
      cadenceDays,
      occurrences: sorted.length,
      firstDate: sorted[0].date,
      lastDate: last.date,
      nextDate: next,
      annualCost: R2((365 / cadenceDays) * mean),
      totalSpent: R2(sorted.reduce((s, t) => s + t.amountUsd, 0)),
    });
  }
  return subs.sort((a, b) => b.annualCost - a.annualCost);
}

export function likelySubscriptions(dataset: Dataset, subs: Subscription[]): LikelySubscription[] {
  const confirmed = subscriptionMerchantSet(subs);
  const out: LikelySubscription[] = [];
  for (const [merchant, list] of byMerchantOf(dataset.transactions.filter((t) => isCharge(t) && t.subscriptionHint))) {
    if (confirmed.has(merchant)) continue;
    const last = [...list].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
    out.push({
      merchant,
      category: last.category,
      lastAmountUsd: last.amountUsd,
      lastAmountLocal: last.amount,
      currency: last.currency,
      lastDate: last.date,
      occurrences: list.length,
    });
  }
  return out.sort((a, b) => b.lastAmountUsd - a.lastAmountUsd);
}

export function subscriptionMerchantSet(subs: Subscription[]): Set<string> {
  return new Set(subs.map((s) => s.merchant));
}

export function spendSummary(
  dataset: Dataset,
  subs: Subscription[],
  from: string,
  to: string,
): SpendSummary {
  const window = spendIn(dataset, from, to);
  const subsMerchants = subscriptionMerchantSet(subs);

  const total = R2(window.reduce((s, t) => s + t.amountUsd, 0));
  const pending = window.filter((t) => t.status === 'pending');

  const byDayMap = new Map<string, number>();
  for (const t of window) {
    const day = t.date.slice(0, 10);
    byDayMap.set(day, R2((byDayMap.get(day) ?? 0) + t.amountUsd));
  }
  const byDaySparse = [...byDayMap.entries()]
    .map(([day, v]) => ({ day, total: v }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const byDay = zeroFillDays(from, to, byDaySparse);

  const byCategoryMap = new Map<string, number>();
  for (const t of window) {
    const k = t.category ?? CATEGORY.other;
    byCategoryMap.set(k, R2((byCategoryMap.get(k) ?? 0) + t.amountUsd));
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([name, v]) => ({ name, total: v }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  const byMerchantMap = new Map<string, { total: number; count: number }>();
  for (const t of window) {
    const k = t.merchant ?? '—';
    const cur = byMerchantMap.get(k) ?? { total: 0, count: 0 };
    cur.total = R2(cur.total + t.amountUsd);
    cur.count += 1;
    byMerchantMap.set(k, cur);
  }
  const byMerchant = [...byMerchantMap.entries()]
    .map(([name, v]) => ({ name, total: v.total, count: v.count }))
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);

  const buckets = { subscriptions: 0, everyday: 0, oneOffs: 0 };
  for (const t of window) {
    if ((t.merchant && subsMerchants.has(t.merchant)) || t.subscriptionHint) buckets.subscriptions = R2(buckets.subscriptions + t.amountUsd);
    else if (t.amountUsd >= 200) buckets.oneOffs = R2(buckets.oneOffs + t.amountUsd);
    else buckets.everyday = R2(buckets.everyday + t.amountUsd);
  }

  const busiest = byDaySparse.length ? byDaySparse.reduce((a, b) => (b.total > a.total ? b : a)) : null;
  const spanDays = Math.max(1, Math.floor((Date.parse(to) - Date.parse(from)) / DAY) + 1);

  return {
    total,
    count: window.filter((t) => t.amountUsd > 0).length,
    pendingCount: pending.length,
    pendingTotal: R2(pending.reduce((s, t) => s + t.amountUsd, 0)),
    avgPerTx: window.length ? R2(total / window.length) : 0,
    avgPerDay: R2(total / spanDays),
    busiestDay: busiest ? { day: busiest.day, total: busiest.total } : null,
    byDay,
    byCategory,
    byMerchant,
    buckets,
    rows: window,
  };
}

/** A Home e o número único de "esperando você" só olham alertas deste período; os mais antigos ficam em "ver todos". */
export const ALERT_WINDOW_DAYS = 30;
/**
 * Alerta que conta no Início. A pendência travada vale enquanto está a confirmar, por mais antiga que seja a
 * transação (date): é justamente quando envelhece que ela importa.
 */
export const isRecentAnomaly = (a: Anomaly, referenceDate: string) =>
  a.kind === 'stuck_pending' || daysAgo(a.date, referenceDate) <= ALERT_WINDOW_DAYS;

/** Histórico mínimo antes de uma compra para afirmar que é "primeira vez" ali. */
const FIRST_TIME_MIN_HISTORY_DAYS = 60;
/** Mesmo valor no mesmo lugar só é duplicata em minutos ou horas; dias depois é outra compra. */
const DUPLICATE_WINDOW_MIN = 180;
/** A mesma repetição em tantos dias diferentes é costume (ida e volta, por exemplo), não erro. */
const ROUTINE_REPEAT_DAYS = 3;
/** Recarga de saldo (app de corrida, celular, transporte): repetir o valor é rotina, e o dinheiro fica no saldo. */
export const BALANCE_TOP_UP = /^UBER\W*CASH|RECARGA|TOP.?UP|RELOAD/i;
/** A mesma regra para o motor de assinaturas: recarga repetida não é assinatura nem duplicata. */
export const isBalanceTopUp = (t: Pick<Transaction, 'merchantRaw'>) => BALANCE_TOP_UP.test(t.merchantRaw ?? '');
/** Recompensa a confirmar (cashback, indicação) é o normal: a ether.fi credita no prazo dela e nada seu está em risco. */
const REWARD_TYPES = new Set<Transaction['type']>(['cashback', 'cashback_claim', 'referral']);
/** A troca de cripto que sai junto com um resgate de cashback é a perna do resgate, não dinheiro seu. */
const REWARD_SWAP_GAP_MS = 5 * 60000;
/** Estorno do mesmo valor (±1%) e descritor até tantos dias depois resolve a cobrança repetida. */
const DUPLICATE_REFUND_DAYS = 30;

/** Descritor da fatura sem espaços: vendedores diferentes no mesmo marketplace são cobranças diferentes. */
const descriptor = (t: Transaction) => (t.merchantRaw ?? '').replace(/\s+/g, '').toUpperCase();

function nameList(names: string[], locale: Locale, max = Infinity): string {
  if (names.length > max) return `${names.slice(0, max).join(', ')} +${names.length - max}`;
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${pick(locale, 'and', 'e')} ${names[names.length - 1]}`;
}

function spanText(minutes: number, locale: Locale): string {
  const m = Math.round(minutes);
  if (m < 1) return pick(locale, 'less than a minute', 'menos de um minuto');
  if (m === 1) return pick(locale, '1 minute', '1 minuto');
  if (m < 90) return pick(locale, `${m} minutes`, `${m} minutos`);
  const h = num(m / 60, 1);
  return pick(locale, `${h} hours`, `${h} horas`);
}

export interface AnomalyOptions {
  /**
   * Ids das cobranças que o motor de assinaturas atribui a uma assinatura (analyzeSubscriptions). Com isso, "valor
   * incomum" pula essas cobranças; sem isso, cai no detector antigo (subs), por estabelecimento.
   */
  subscriptionCharges?: ReadonlySet<string>;
}

export function detectAnomalies(dataset: Dataset, subs: Subscription[], locale: Locale = 'en', opts: AnomalyOptions = {}): Anomaly[] {
  const tr = (en: string, pt: string) => pick(locale, en, pt);
  const ref = dataset.referenceDate;
  const charges = dataset.transactions
    .filter(isCharge)
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: Anomaly[] = [];
  const subsMerchants = subscriptionMerchantSet(subs);
  const subscriptionCharge = (t: Transaction) => (opts.subscriptionCharges ? opts.subscriptionCharges.has(t.id) : subsMerchants.has(t.merchant ?? ''));
  const coverageFrom = dataset.coverage?.from ?? charges[0]?.date ?? ref;
  const brandCount = new Map<string, number>();
  for (const t of charges) if (t.brand) brandCount.set(t.brand, (brandCount.get(t.brand) ?? 0) + 1);
  const firsts: Transaction[] = [];
  // estornos por descritor e moeda: cada um resolve uma repetição, uma vez só
  const refunds = new Map<string, Transaction[]>();
  for (const t of dataset.transactions) {
    if (!isSpend(t) || t.amount >= 0) continue;
    const k = `${t.currency}|${descriptor(t)}`;
    refunds.set(k, [...(refunds.get(k) ?? []), t]);
  }
  const usedRefunds = new Set<string>();

  for (const [merchant, list] of byMerchantOf(charges)) {
    // duplicatas: mesmo valor, moeda e descritor, cada cobrança até 3 h depois da anterior; três ou mais seguidas
    // viram um alerta só. Recarga de saldo e repetição de costume ficam de fora.
    const sameCharge = new Map<string, Transaction[]>();
    for (const t of list) {
      if (isBalanceTopUp(t)) continue;
      const k = `${t.currency}|${t.amount}|${descriptor(t)}`;
      sameCharge.set(k, [...(sameCharge.get(k) ?? []), t]);
    }
    for (const same of sameCharge.values()) {
      const bursts: Transaction[][] = [];
      let run: Transaction[] = [];
      for (const t of same) {
        const prev = run[run.length - 1];
        const gapMin = prev ? (Date.parse(t.date) - Date.parse(prev.date)) / 60000 : 0;
        if (prev && gapMin > 0 && gapMin <= DUPLICATE_WINDOW_MIN) run.push(t);
        else {
          if (run.length > 1) bursts.push(run);
          run = [t];
        }
      }
      if (run.length > 1) bursts.push(run);
      if (new Set(bursts.map((b) => b[0].date.slice(0, 10))).size >= ROUTINE_REPEAT_DAYS) continue;

      for (const b of bursts) {
        const first = b[0];
        const last = b[b.length - 1];
        const n = b.length;
        // já estornada: um estorno do mesmo valor (±1%) e descritor por repetição, depois da 1ª cobrança e em até 30 dias
        const undone = (refunds.get(`${first.currency}|${descriptor(first)}`) ?? []).filter((r) => {
          const days = (Date.parse(r.date) - Date.parse(first.date)) / DAY;
          return !usedRefunds.has(r.id) && days >= 0 && days <= DUPLICATE_REFUND_DAYS && Math.abs(Math.abs(r.amount) - first.amount) <= first.amount * 0.01;
        });
        if (undone.length >= n - 1) {
          for (const r of undone.slice(0, n - 1)) usedRefunds.add(r.id);
          continue;
        }
        const span = spanText((Date.parse(last.date) - Date.parse(first.date)) / 60000, locale);
        const amount = money(first.amount, first.currency);
        // enquanto a repetição está a confirmar, o estabelecimento ainda pode desfazê-la: o único caso urgente
        const urgent = b.slice(1).some((t) => t.status === 'pending') && daysAgo(last.date, ref) <= 7;
        out.push({
          kind: 'duplicate',
          group: 'check_now',
          urgent,
          title: n === 2 ? tr('Possible duplicate charge', 'Possível cobrança duplicada') : tr(`Same amount charged ${n} times`, `Mesmo valor cobrado ${n} vezes`),
          merchant,
          amountUsd: R2(b.reduce((s, t) => s + t.amountUsd, 0)),
          cardId: last.cardId,
          date: last.date,
          relatedIds: b.map((t) => t.id),
          rationale: tr(
            `${merchant} charged the same amount (${amount}) ${n === 2 ? 'twice' : `${n} times`} within ${span}. It could be a double tap, the merchant reprocessing, or ${n === 2 ? 'two' : 'separate'} real purchases — check the app.${urgent ? ' The repeat is still pending, which is the easiest moment to ask the merchant to drop it.' : ''}`,
            `${merchant} cobrou o mesmo valor (${amount}) ${n === 2 ? 'duas vezes' : `${n} vezes`} em ${span}. Pode ser duplo clique, reprocessamento do estabelecimento ou ${n === 2 ? 'duas compras reais' : 'compras reais separadas'} — confira no app.${urgent ? ' A repetição ainda está a confirmar: é a hora mais fácil de pedir ao estabelecimento que a desfaça.' : ''}`,
          ),
        });
      }
    }

    // valor incomum: cada compra dos últimos 30 dias, comparada à mediana das anteriores no mesmo lugar. Cobrança de
    // assinatura fica de fora: reajuste e plano anual aparecem em Assinaturas
    list.forEach((t, i) => {
      if (i < 2 || daysAgo(t.date, ref) > ALERT_WINDOW_DAYS || t.subscriptionHint || subscriptionCharge(t)) return;
      const history = list.slice(0, i);
      const m = median(history.map((x) => x.amountUsd));
      if (t.amountUsd < Math.max(100, m * 3)) return;
      const times = num(t.amountUsd / m, 1);
      out.push({
        kind: 'unusually_large',
        group: 'check_now',
        urgent: false,
        title: tr('Way above usual', 'Muito acima do usual'),
        merchant,
        amountUsd: t.amountUsd,
        cardId: t.cardId,
        date: t.date,
        relatedIds: [t.id],
        rationale: tr(
          `You usually spend ~${usd(m)} here (median of ${history.length} earlier purchases). This charge of ${usd(t.amountUsd)} is ${times}x that.`,
          `Você costuma gastar ~${usd(m)} aqui (mediana de ${history.length} compras anteriores). Esta cobrança de ${usd(t.amountUsd)} está ${times}x acima disso.`,
        ),
      });
    });

    // primeira vez: só afirma com histórico suficiente antes da compra. Assinatura nova já aparece em Assinaturas,
    // e lugar novo numa plataforma que você já usa (restaurante pelo iFood) não é um desconhecido.
    if (list.length === 1) {
      const t = list[0];
      const knownBrand = Boolean(t.brand && (brandCount.get(t.brand) ?? 0) > 1);
      if (
        !t.subscriptionHint && !knownBrand && t.amountUsd >= 10
        && daysAgo(t.date, ref) <= ALERT_WINDOW_DAYS && daysAgo(coverageFrom, t.date) >= FIRST_TIME_MIN_HISTORY_DAYS
      ) firsts.push(t);
    }
  }

  // vários lugares novos no mesmo dia (dia de compras, viagem) viram um alerta só
  const firstsByDay = new Map<string, Transaction[]>();
  for (const t of firsts) firstsByDay.set(t.date.slice(0, 10), [...(firstsByDay.get(t.date.slice(0, 10)) ?? []), t]);
  for (const day of firstsByDay.values()) {
    const group = day.sort((a, b) => a.date.localeCompare(b.date));
    const last = group[group.length - 1];
    const historyDays = daysAgo(coverageFrom, group[0].date);
    const names = group.map((t) => t.merchant ?? '');
    const single = group.length === 1;
    out.push({
      kind: 'first_time',
      group: 'worth_knowing',
      urgent: false,
      title: single
        ? tr('First time here', 'Primeira vez aqui')
        : tr(`${group.length} new places on ${dateShort(last.date)}`, `${group.length} lugares novos em ${dateShort(last.date)}`),
      merchant: nameList(names, locale, 3),
      amountUsd: R2(group.reduce((s, t) => s + t.amountUsd, 0)),
      cardId: last.cardId,
      date: last.date,
      relatedIds: group.map((t) => t.id),
      rationale: single
        ? tr(
            `First charge from ${names[0]} in ${historyDays} days of history. If you don't recognize it, check the app; if you do, all good.`,
            `Primeira cobrança de ${names[0]} em ${historyDays} dias de histórico. Se não reconhece, confira no app; se reconhece, tudo certo.`,
          )
        : tr(
            `First charges from ${nameList(names, locale)}, all on the same day, in ${historyDays} days of history. Several new places in one day usually mean a shopping day or a trip; if you don't recognize one of them, check the app.`,
            `Primeiras cobranças de ${nameList(names, locale)}, todas no mesmo dia, em ${historyDays} dias de histórico. Vários lugares novos num dia costumam ser um dia de compras ou uma viagem; se não reconhece algum, confira no app.`,
          ),
    });
  }

  // a confirmar há muito tempo: qualquer movimentação com dinheiro seu (compra, depósito, troca), não recompensa
  const claims = dataset.transactions.filter((t) => t.type === 'cashback_claim').map((t) => Date.parse(t.date));
  for (const t of dataset.transactions) {
    if (t.status !== 'pending' || REWARD_TYPES.has(t.type)) continue;
    if (t.type === 'swap' && claims.some((c) => Math.abs(c - Date.parse(t.date)) <= REWARD_SWAP_GAP_MS)) continue;
    // dias de calendário: a compra de ontem está a confirmar há 1 dia, não 0
    const age = daysAgo(t.date.slice(0, 10), ref);
    if (age < 7) continue;
    const what = t.type === 'purchase' ? tr('Charge', 'Cobrança') : `${typeLabel(t.type, locale)}${t.token ? ` (${t.token})` : ''}`;
    out.push({
      kind: 'stuck_pending',
      group: age >= 14 ? 'check_now' : 'worth_knowing',
      urgent: false,
      title: tr('Pending for a long time', 'A confirmar há muito tempo'),
      merchant: txTitle(t, locale),
      amountUsd: t.amountUsd,
      cardId: t.cardId,
      date: t.date,
      relatedIds: [t.id],
      rationale: tr(
        `${what} of ${usd(t.amountUsd)} pending for ${age} days. ${age >= 14 ? 'It has been over two weeks: check the app or open a support ticket.' : 'Pending amounts can still change; if it goes past two weeks, check the app.'}`,
        `${what} de ${usd(t.amountUsd)} a confirmar há ${age} dias. ${age >= 14 ? 'Passou de duas semanas: vale conferir no app ou abrir chamado no suporte.' : 'Valores a confirmar ainda podem mudar; se passar de duas semanas, vale conferir no app.'}`,
      ),
    });
  }

  const order = { check_now: 0, worth_knowing: 1 };
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || order[a.group] - order[b.group] || b.date.localeCompare(a.date));
}

/**
 * As linhas de cashback que somam por período: os créditos (cashback) quando a fonte os traz; senão os resgates
 * (cashback_claim), que é o que uma conta real tem. A mesma escolha do rewardsSummary; cancelada fica fora.
 */
export function cashbackRows(dataset: Dataset): Transaction[] {
  const live = dataset.transactions.filter((t) => t.status !== 'void');
  const credited = live.filter((t) => t.type === 'cashback');
  return credited.length ? credited : live.filter((t) => t.type === 'cashback_claim');
}

export function cashbackSummary(dataset: Dataset, from: string, to: string) {
  const rows = cashbackRows(dataset).filter((t) => inDays(t.date, from, to));
  const byMonth = new Map<string, number>();
  for (const t of rows) {
    const k = t.date.slice(0, 7);
    byMonth.set(k, R2((byMonth.get(k) ?? 0) + t.amountUsd));
  }
  return {
    total: R2(rows.reduce((s, t) => s + t.amountUsd, 0)),
    count: rows.length,
    byMonth: [...byMonth.entries()].map(([month, total]) => ({ month, total })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/**
 * Recompensas que chegam às transações: cashback e indicações, no histórico todo. O conector não traz o cashback de
 * cada compra nem o saldo a resgatar: numa conta real o cashback só aparece quando é resgatado (cashback_claim).
 * Se houver linhas de crédito (cashback), o resgate não entra de novo na soma.
 */
export function rewardsSummary(dataset: Dataset) {
  const live = dataset.transactions.filter((t) => t.status !== 'void');
  const credited = live.filter((t) => t.type === 'cashback');
  const part = (rows: Transaction[]) => ({
    total: R2(rows.reduce((s, t) => s + Math.abs(t.amountUsd), 0)),
    pending: R2(rows.filter((t) => t.status === 'pending').reduce((s, t) => s + Math.abs(t.amountUsd), 0)),
    count: rows.length,
  });
  return {
    cashback: { ...part(credited.length ? credited : live.filter((t) => t.type === 'cashback_claim')), kind: credited.length ? ('received' as const) : ('claimed' as const) },
    referral: part(live.filter((t) => t.type === 'referral')),
  };
}

export function yieldSummary(dataset: Dataset) {
  const rows = dataset.portfolio.holdings.filter((h) => h.apy);
  const monthly = R2(rows.reduce((s, h) => s + (h.dollarValue * (h.apy ?? 0)) / 100 / 12, 0));
  const annual = R2(rows.reduce((s, h) => s + (h.dollarValue * (h.apy ?? 0)) / 100, 0));
  const earning = R2(rows.filter((h) => h.dollarValue > 0).reduce((s, h) => s + h.dollarValue, 0));
  return {
    monthly,
    annual,
    earning,
    /** APY médio ponderado pelo valor */
    avgApy: earning > 0 ? R2((annual / earning) * 100) : 0,
    backingValue: R2(dataset.portfolio.holdings.filter((h) => h.backsSpending).reduce((s, h) => s + h.dollarValue, 0)),
  };
}

/**
 * Viagem = compras fora da moeda da casa (ou com cidade), em sequência com até 4 dias entre elas.
 * Para quem não mora nos EUA, cobrança em USD sem cidade é quase sempre serviço online, não viagem.
 */
export function detectTrips(dataset: Dataset): Trip[] {
  const home = dataset.homeCurrency ?? 'USD';
  const foreign = dataset.transactions
    .filter((t) => isCharge(t) && (t.city || (t.currency !== home && (home === 'USD' || t.currency !== 'USD'))))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!foreign.length) return [];
  const clusters: Transaction[][] = [];
  let current: Transaction[] = [foreign[0]];
  for (let i = 1; i < foreign.length; i++) {
    const prev = current[current.length - 1];
    const gapDays = (Date.parse(foreign[i].date) - Date.parse(prev.date)) / DAY;
    if (gapDays <= 4) current.push(foreign[i]);
    else {
      clusters.push(current);
      current = [foreign[i]];
    }
  }
  clusters.push(current);

  return clusters
    .filter((c) => c.length >= 3)
    .map((c) => {
      const byDayMap = new Map<string, number>();
      const byCategoryMap = new Map<string, number>();
      for (const t of c) {
        const day = t.date.slice(0, 10);
        byDayMap.set(day, R2((byDayMap.get(day) ?? 0) + t.amountUsd));
        const k = t.category ?? CATEGORY.other;
        byCategoryMap.set(k, R2((byCategoryMap.get(k) ?? 0) + t.amountUsd));
      }
      const byDay = [...byDayMap.entries()].map(([day, total]) => ({ day, total })).sort((a, b) => a.day.localeCompare(b.day));
      const total = R2(c.reduce((s, t) => s + t.amountUsd, 0));
      const cities = [...new Set(c.map((t) => t.city).filter((x): x is string => Boolean(x)))];
      const days = Math.max(1, Math.round((Date.parse(c[c.length - 1].date) - Date.parse(c[0].date)) / DAY) + 1);
      return {
        from: c[0].date,
        to: c[c.length - 1].date,
        days,
        cities,
        currencies: [...new Set(c.map((t) => t.currency))],
        total,
        dailyAvg: R2(total / days),
        count: c.length,
        relatedIds: c.map((t) => t.id),
        byCategory: [...byCategoryMap.entries()].map(([name, v]) => ({ name, total: v })).sort((a, b) => b.total - a.total),
        byDay,
        peakDay: byDay.reduce((a, b) => (b.total > a.total ? b : a), byDay[0]) ?? null,
      };
    })
    .sort((a, b) => b.from.localeCompare(a.from));
}

/**
 * Crédito em uso (emprestado ÷ limite, em %) e o crédito livre (limite − emprestado). O livre é conta do painel, não
 * número da fonte, e não é o poder de compra: esse é account.availableBalance, que a ether.fi informa e que difere de
 * limite − emprestado nas contas reais. Não mostre `free` como "crédito disponível".
 */
export function creditUsage(account: Dataset['account']) {
  if (!account.creditLimit) return { utilization: 0, free: 0 };
  return {
    utilization: R2((account.amountBorrowed / account.creditLimit) * 100),
    free: R2(account.creditLimit - account.amountBorrowed),
  };
}

export type PartialReason = 'trading' | 'unrenderable' | 'portfolio_missing' | 'account_missing';

export interface PortfolioGroup {
  /** id da fonte (liquidVaults, value-accruing, crypto); `all` sem grupos na fonte; `other` para grupo não listado */
  id: string;
  /** Já no idioma pedido (assetGroupLabel) */
  label: string;
  value: number;
  /** Fração do grupo na soma dos ativos listados (0–1; os grupos somam 1) */
  share: number;
  /** Do maior para o menor valor */
  holdings: Holding[];
}

export interface PortfolioClass {
  id: AssetClass;
  /** Já no idioma pedido; nas fiat, com as moedas: "Fiat · USD, EUR" (assetClassLabel) */
  label: string;
  value: number;
  /** Fração da classe na soma dos ativos listados (0–1; as classes somam 1) */
  share: number;
  /** Do maior para o menor valor */
  holdings: Holding[];
  /** Só nas fiat: as moedas presentes, da de maior valor para a de menor; nas outras, vazio */
  currencies: string[];
}

export interface PortfolioSummary {
  /** Saldo: totalBalance da conta; sem ele (ferramenta falhou, arquivo faltou), a soma dos ativos listados */
  total: number;
  totalSource: 'account' | 'holdings';
  /**
   * O próprio número do saldo é parcial: o da conta com tradingPositionsIncluded false, ou a soma da lista (sem o saldo
   * da conta, a soma não pode ser apresentada como o valor completo). Os outros motivos podem falar só da lista
   */
  totalPartial: boolean;
  /**
   * Por que o saldo ou a lista não são completos; vazio = nada a avisar. Ordem fixa: trading (saldo ou lista sem
   * posições de trading), unrenderable (a lista não mostra ativos), portfolio_missing, account_missing
   */
  partialReasons: PartialReason[];
  /** Soma dos ativos listados (a base de `share`) */
  listedTotal: number;
  /** Saldo que a lista não detalha: total − listedTotal, só quando o total é da conta e passa a soma (senão 0) */
  unlisted: number;
  /** Ativos que a fonte não soube listar */
  unrenderableCount: number;
  /** Grupos do app com valor > 0, do maior para o menor; sem grupos na fonte, um só (`all`) */
  groups: PortfolioGroup[];
  /** Classes de ativo (assetClassOf) com valor > 0, do maior para o menor: a divisão que a tela mostra */
  classes: PortfolioClass[];
  yield: ReturnType<typeof yieldSummary>;
  /** Poder de compra informado (availableBalance); null sem a conta ou sem o campo */
  spendingPower: number | null;
  creditLimit: number;
  borrowed: number;
  /** borrowed ÷ creditLimit × 100; 0 sem limite */
  utilization: number;
}

/** A ferramenta veio (ou não se sabe: demo e dado antigo não marcam as fontes). */
export const sourceCame = (dataset: Dataset, tool: keyof NonNullable<Dataset['sources']>) => dataset.sources?.[tool] !== false;

/**
 * O retrato da carteira para a tela Portfólio: saldo, por que ele é parcial, os grupos do app com a fração de cada um,
 * o rendimento estimado e o crédito. Nada é somado ao saldo: poder de compra, limite e emprestado são números à parte.
 */
export function portfolioSummary(dataset: Dataset, locale: Locale = 'en'): PortfolioSummary {
  const { account, portfolio } = dataset;
  const accountCame = sourceCame(dataset, 'get_main_account');
  const portfolioCame = sourceCame(dataset, 'get_portfolio');
  const listedTotal = R2(portfolio.holdings.reduce((s, h) => s + h.dollarValue, 0));
  const fromAccount = accountCame && account.totalBalance !== undefined;
  const total = fromAccount ? account.totalBalance! : listedTotal;
  const unrenderableCount = portfolio.unrenderableCount ?? 0;

  const reasons = new Set<PartialReason>();
  // o flag da conta qualifica o saldo; o da carteira, a lista (e a composição que sai dela)
  if (account.balancePartial || portfolio.tradingIncluded === false) reasons.add('trading');
  if (portfolioCame && unrenderableCount > 0) reasons.add('unrenderable');
  if (!portfolioCame) reasons.add('portfolio_missing');
  if (!accountCame) reasons.add('account_missing');
  const order: PartialReason[] = ['trading', 'unrenderable', 'portfolio_missing', 'account_missing'];

  const known = new Map((portfolio.groups ?? []).map((g) => [g.id, g.label]));
  const byGroup = new Map<string, Holding[]>();
  for (const h of portfolio.holdings) {
    const id = !known.size ? 'all' : h.groupId && known.has(h.groupId) ? h.groupId : 'other';
    byGroup.set(id, [...(byGroup.get(id) ?? []), h]);
  }
  const groupSum = [...byGroup.values()].reduce((s, list) => s + list.reduce((a, h) => a + Math.max(0, h.dollarValue), 0), 0);
  const groups = [...byGroup.entries()]
    .map(([id, list]) => {
      const value = R2(list.reduce((s, h) => s + Math.max(0, h.dollarValue), 0));
      return {
        id,
        label: assetGroupLabel(id, known.get(id), locale),
        value,
        share: groupSum > 0 ? value / groupSum : 0,
        holdings: [...list].sort((a, b) => b.dollarValue - a.dollarValue),
      };
    })
    .filter((g) => g.value > 0)
    .sort((a, b) => b.value - a.value);

  // classes: o que cada ativo é (fiat com a moeda), não o grupo em que o app o mostra
  const byClass = new Map<AssetClass, { holdings: Holding[]; byCurrency: Map<string, number> }>();
  for (const h of portfolio.holdings) {
    const info = assetClassOf(h);
    const entry = byClass.get(info.cls) ?? { holdings: [], byCurrency: new Map<string, number>() };
    entry.holdings.push(h);
    if (info.currency) entry.byCurrency.set(info.currency, (entry.byCurrency.get(info.currency) ?? 0) + Math.max(0, h.dollarValue));
    byClass.set(info.cls, entry);
  }
  const classes = [...byClass.entries()]
    .map(([id, { holdings, byCurrency }]) => {
      const value = R2(holdings.reduce((s, h) => s + Math.max(0, h.dollarValue), 0));
      const currencies = [...byCurrency.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
      return {
        id,
        label: assetClassLabel(id, currencies, locale),
        value,
        share: groupSum > 0 ? value / groupSum : 0,
        holdings: [...holdings].sort((a, b) => b.dollarValue - a.dollarValue),
        currencies,
      };
    })
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);

  const creditLimit = accountCame ? account.creditLimit : 0;
  const borrowed = accountCame ? account.amountBorrowed : 0;
  return {
    total,
    totalSource: fromAccount ? 'account' : 'holdings',
    totalPartial: fromAccount ? Boolean(account.balancePartial) : true,
    partialReasons: order.filter((r) => reasons.has(r)),
    listedTotal,
    unlisted: fromAccount && portfolioCame ? Math.max(0, R2(total - listedTotal)) : 0,
    unrenderableCount,
    groups,
    classes,
    yield: yieldSummary(dataset),
    spendingPower: accountCame && account.availableBalance !== undefined ? account.availableBalance : null,
    creditLimit,
    borrowed,
    utilization: creditLimit > 0 ? R2((borrowed / creditLimit) * 100) : 0,
  };
}

export function zeroFillDays(fromISO: string, toISO: string, sparse: { day: string; total: number }[]) {
  const map = new Map(sparse.map((d) => [d.day, d.total]));
  const out: { day: string; total: number }[] = [];
  for (let t = Date.parse(fromISO.slice(0, 10)); t <= Date.parse(toISO); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, total: R2(map.get(day) ?? 0) });
  }
  return out;
}

export type MonthEventKind =
  | 'trip' | 'new_sub' | 'borrow' | 'repayment'
  | 'record_cashback' | 'anomalies' | 'one_off_big';

export interface MonthEvent {
  kind: MonthEventKind;
  label: string;
  detail?: string;
  tone: 'accent' | 'info' | 'warn' | 'bad' | 'good';
}

export interface MonthEvolution {
  month: string;
  /** Líquido: cobranças menos estornos */
  total: number;
  /** Só as cobranças, sem os estornos */
  gross: number;
  /** Estornos do mês, em valor positivo */
  refunds: number;
  /**
   * Total <= 0 ou estornos acima de 50% do bruto: o líquido engana. Mostre bruto e estornos separados; o mês não tem
   * delta em % (nem o seguinte, comparado a ele)
   */
  refundHeavy: boolean;
  count: number;
  deltaPct: number | null;
  deltaAbs: number;
  /** true quando a variação é explicada por viagem ou compra pontual grande */
  deltaExplained: boolean;
  /** Mês corrente */
  partial: boolean;
  /** false quando o histórico carregado começa depois do dia 1 do mês (falta histórico antigo) */
  covered: boolean;
  /**
   * O histórico começa neste mês, depois do dia 1. Com histórico completo, é o mês em que a conta abriu: os dados
   * são de verdade, mas o mês não é inteiro e não entra em média nem comparação
   */
  startsMidMonth: boolean;
  /** O conector omitiu linhas (coverage.droppedRows): nenhum mês é inteiro nem se compara */
  rowsMissing: boolean;
  /** Dia do mês de hoje (mês corrente) ou dias do mês: o "18 de 31 dias" */
  daysElapsed: number;
  /** Dias já corridos, com a fração de hoje (mês corrente; no mínimo 1): a base da projeção e da média por dia */
  elapsed: number;
  daysInMonth: number;
  projected?: number;
  cashback: number;
  cashbackIsRecord: boolean;
  borrow: number;
  repayment: number;
  borrowedEnd: number;
  pendingCount: number;
  trip?: { cities: string[]; currencies: string[]; total: number; totalInMonth: number; from: string; to: string; count: number };
  newSubs: { merchant: string; amount: number }[];
  anomalies: Anomaly[];
  oneOffBig: Transaction[];
  byDay: { day: string; total: number }[];
  byCategory: { name: string; total: number }[];
  topTx: Transaction[];
}

const daysInMonthOf = (ym: string): number => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

/** Mês fechado e inteiro dentro do histórico carregado, sem linhas omitidas: é o único que vale comparar. */
export const isFullMonth = (m: MonthEvolution) => m.covered && !m.partial && !m.startsMidMonth && !m.rowsMissing;

/** Estorno acima desta fração do bruto deixa o líquido do mês sem sentido para comparar. */
const REFUND_HEAVY_SHARE = 0.5;

/** Fração já passada de hoje (0..1) no relógio do dataset; 1 quando referenceDate não é hoje (dado salvo, demo). */
function todayFraction(dataset: Dataset, now: Date): number {
  const zone = dataset.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = localIso(now.toISOString(), zone);
  if (local.slice(0, 10) !== dataset.referenceDate) return 1;
  return Math.min(1, Math.max(0, (Date.parse(local) - Date.parse(`${dataset.referenceDate}T00:00:00Z`)) / DAY));
}

export interface MonthOptions {
  /** A mesma lista de alertas do Início (anomaliesFor); sem ela, detectAnomalies roda aqui */
  anomalies?: Anomaly[];
  /** "Agora", para descontar a parte de hoje que ainda não passou na projeção; padrão: o relógio */
  now?: Date;
  /**
   * Ids das cobranças de assinatura do motor (recurringView): saem de "compra pontual grande". Sem isso, vale o
   * detector antigo (subs), por estabelecimento
   */
  subscriptionCharges?: ReadonlySet<string>;
}

/** Série mensal didática: totais, deltas, eventos e insumos de racional. */
export function monthEvolutions(dataset: Dataset, subs: Subscription[], locale: Locale = 'en', opts: MonthOptions = {}): MonthEvolution[] {
  const refYm = dataset.referenceDate.slice(0, 7);
  const refTs = Date.parse(`${dataset.referenceDate}T23:59:59Z`);
  const purchases = dataset.transactions.filter(isSpend);
  if (!purchases.length) return [];
  const sorted = [...purchases].sort((a, b) => a.date.localeCompare(b.date));
  const firstYm = sorted[0].date.slice(0, 7);
  const coverage = dataset.coverage;
  const rowsMissing = Boolean(coverage?.droppedRows);
  const fraction = todayFraction(dataset, opts.now ?? new Date());

  const months: string[] = [];
  let [y, m] = firstYm.split('-').map(Number);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    months.push(ym);
    if (ym >= refYm) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }

  const trips = detectTrips(dataset);
  const anomalies = opts.anomalies ?? detectAnomalies(dataset, subs, locale);
  // o mês a mês é sobre compras: depósito a confirmar não é "cobrança para revisar"
  const purchaseIds = new Set(purchases.map((t) => t.id));
  const subsMerchants = subscriptionMerchantSet(subs);
  const occurrenceCount = new Map<string, number>();
  for (const t of sorted) {
    if (t.merchant) occurrenceCount.set(t.merchant, (occurrenceCount.get(t.merchant) ?? 0) + 1);
  }

  let borrowed = 0;
  let cashbackRecord = -1;
  // conta real só traz o resgate (cashback_claim): sem isso o cashback do mês ficava sempre zero
  const cashback = cashbackRows(dataset);
  const series: MonthEvolution[] = [];

  for (const ym of months) {
    const monthStart = `${ym}-01T00:00:00Z`;
    const monthEnd = `${ym}-${String(daysInMonthOf(ym)).padStart(2, '0')}T23:59:59Z`;
    // pelo mês do texto: a data tem milissegundos e não se compara com os limites como texto
    const inMonth = (d: string) => d.slice(0, 7) === ym;
    const rows = sorted.filter((t) => inMonth(t.date));
    const total = R2(rows.reduce((s, t) => s + t.amountUsd, 0));
    const gross = R2(rows.reduce((s, t) => s + Math.max(0, t.amountUsd), 0));
    const refunds = R2(gross - total);
    const refundHeavy = rows.length > 0 && (total <= 0 || refunds > gross * REFUND_HEAVY_SHARE);
    const partial = ym === refYm;
    const covered = !coverage || coverage.complete || coverage.from.slice(0, 10) <= `${ym}-01`;
    // a conta (ou o histórico carregado) começou neste mês, depois do dia 1
    const startsMidMonth = Boolean(coverage && coverage.from.slice(0, 7) === ym && coverage.from.slice(8, 10) !== '01');
    const daysInMonth = daysInMonthOf(ym);
    const daysElapsed = partial
      ? Math.max(1, new Date(refTs).getUTCDate())
      : daysInMonth;
    // hoje ainda não acabou: ao meio-dia do dia 18 passaram 17,5 dias, não 18
    const elapsed = partial ? Math.max(1, daysElapsed - 1 + fraction) : daysInMonth;

    const byDayRaw = new Map<string, number>();
    const byCategoryMap = new Map<string, number>();
    for (const t of rows) {
      const day = t.date.slice(0, 10);
      byDayRaw.set(day, R2((byDayRaw.get(day) ?? 0) + t.amountUsd));
      const k = t.category ?? CATEGORY.other;
      byCategoryMap.set(k, R2((byCategoryMap.get(k) ?? 0) + t.amountUsd));
    }
    const byDay = zeroFillDays(monthStart, monthEnd, [...byDayRaw.entries()].map(([day, v]) => ({ day, total: v })));

    const monthCashback = R2(cashback.filter((t) => inMonth(t.date)).reduce((s, t) => s + t.amountUsd, 0));
    const cashbackIsRecord = monthCashback > 0 && monthCashback > cashbackRecord;
    if (monthCashback > cashbackRecord) cashbackRecord = monthCashback;

    let borrow = 0;
    let repayment = 0;
    let pendingCount = 0;
    for (const t of dataset.transactions) {
      if (!inMonth(t.date)) continue;
      if (t.type === 'borrow') { borrow = R2(borrow + t.amountUsd); borrowed = R2(borrowed + t.amountUsd); }
      if (t.type === 'repayment') { repayment = R2(repayment + t.amountUsd); borrowed = R2(borrowed - t.amountUsd); }
      if (t.status === 'pending') pendingCount += 1;
    }

    // viagens que caem neste mês: medimos só o que caiu no mês (por transações do cluster)
    const monthTrips = trips
      .map((trip) => {
        const txnsInMonth = dataset.transactions.filter((t) => trip.relatedIds.includes(t.id) && inMonth(t.date));
        return {
          trip,
          totalInMonth: R2(txnsInMonth.reduce((s, t) => s + t.amountUsd, 0)),
          countInMonth: txnsInMonth.length,
        };
      })
      .filter((x) => x.countInMonth >= 3)
      .sort((a, b) => b.totalInMonth - a.totalInMonth);

    const newSubs = subs
      .filter((s) => inMonth(s.firstDate))
      .map((s) => ({ merchant: s.merchant, amount: s.amount }));

    const monthAnomalies = anomalies.filter((a) => inMonth(a.date) && a.relatedIds.some((id) => purchaseIds.has(id)));

    const recurring = (t: Transaction) => (opts.subscriptionCharges ? opts.subscriptionCharges.has(t.id) : subsMerchants.has(t.merchant ?? '') || Boolean(t.subscriptionHint));
    const oneOffBig = rows.filter(
      (t) => t.amountUsd >= 300 && !recurring(t) && (occurrenceCount.get(t.merchant ?? '') ?? 0) <= 2,
    );

    const topTx = [...rows].sort((a, b) => b.amountUsd - a.amountUsd).slice(0, 6);

    // só compara com o mês anterior quando os dois estão inteiros e fechados, sem linhas omitidas e sem estorno que
    // desfaça o mês. O corrente não tem delta: o parcial contra um mês inteiro engana (a comparação dele é pela
    // projeção, que a tela faz)
    const prev = series.at(-1);
    const whole = covered && !partial && !startsMidMonth && !rowsMissing && !refundHeavy;
    const comparable = prev && prev.covered && !prev.startsMidMonth && !prev.refundHeavy && whole;
    const prevTotal = comparable ? prev.total : 0;
    const deltaAbs = comparable ? R2(total - prevTotal) : 0;
    const tripTotal = monthTrips[0]?.totalInMonth ?? 0;
    const oneOffTotal = R2(oneOffBig.reduce((s, t) => s + t.amountUsd, 0));
    // explicado = viagem + compras pontuais juntas cobrem >= 50% do aumento vs mês anterior
    const deltaExplained = deltaAbs > 0 && tripTotal + oneOffTotal >= deltaAbs * 0.5;

    series.push({
      month: ym,
      total,
      gross,
      refunds,
      refundHeavy,
      count: rows.filter((t) => t.amountUsd > 0).length,
      deltaPct: prevTotal > 0 ? R2(((total - prevTotal) / prevTotal) * 100) : null,
      deltaAbs,
      deltaExplained,
      partial,
      covered,
      startsMidMonth,
      rowsMissing,
      daysElapsed,
      elapsed,
      daysInMonth,
      projected: partial && covered && !startsMidMonth && !rowsMissing ? R2((total / elapsed) * daysInMonth) : undefined,
      cashback: monthCashback,
      cashbackIsRecord,
      borrow,
      repayment,
      borrowedEnd: R2(borrowed),
      pendingCount,
      trip: monthTrips[0]
        ? {
            cities: monthTrips[0].trip.cities,
            currencies: monthTrips[0].trip.currencies,
            total: monthTrips[0].trip.total,
            totalInMonth: monthTrips[0].totalInMonth,
            from: monthTrips[0].trip.from,
            to: monthTrips[0].trip.to,
            count: monthTrips[0].countInMonth,
          }
        : undefined,
      newSubs,
      anomalies: monthAnomalies,
      oneOffBig,
      byDay,
      byCategory: [...byCategoryMap.entries()].map(([name, v]) => ({ name, total: v })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total),
      topTx,
    });
  }
  return series;
}
