// O motor da tela Ganhos (#/earnings). Junta o que rende (os cofres Liquid, um por um, e os outros ativos com APY) e o
// cashback previsto (base de gasto × taxa), ao lado das recorrências (as assinaturas e contas que o app detecta e os
// itens que a pessoa digita). Depois mostra o que esses ganhos pagam, do mais barato ao mais caro ou na ordem que a
// pessoa fixou, e a escada dos próximos marcos: quanto a mais no Liquid cobriria o próximo item, ao APY de hoje.
// Funções puras. A tela guarda as preferências (EarningsPrefs) em lighthouse:v1:earnings-prefs (src/state/earningsPrefs.ts),
// e "Esquecer tudo" apaga, como as outras chaves do namespace.
// Linha vermelha em todo texto: é estimativa, com a conta à mostra, e nunca recomendação. O marco diz o que
// "cobriria", ao APY de hoje. Nunca diz "deposite", "invista" ou "mova", e nunca há marco do tipo "gaste mais".

import { fxSummary, isSpend, recentFx } from './analytics.ts';
import { isVault } from './assetClass.ts';
import { dateShort, num, pct, usd, usd0 } from './format.ts';
import { LOCALES, pick, type Locale } from './locale.ts';
import { analyzeSubscriptions, knowledgeFor } from './subscriptions.ts';
import type { Cycle, SubscriptionRecord, SubscriptionReport } from './subscriptionTypes';
import type { Dataset, Holding, Transaction } from './types';
import { CASHBACK_PAYOUT, CASHBACK_PLAN_RATES, CASHBACK_PLANS, CASHBACK_STALE_DAYS } from './insights/cashbackPlans.ts';
import type { CashTier, InsightSource } from './insights/types';

const R2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;
/** Folga de arredondamento: item a menos de meio centavo do fim conta como pago inteiro */
const EPS = 0.005;

/** Dias de um mês médio (365,25 ÷ 12): a média por dia vira média por mês */
export const DAYS_PER_MONTH = 365.25 / 12;
/** A base do cartão é a média dos últimos 90 dias cobertos pelo histórico (uma janela móvel, não o mês do calendário) */
export const BASE_WINDOW_DAYS = 90;
/** Com menos dias de histórico do que isto na janela, a média do cartão não vale */
export const BASE_MIN_DAYS = 30;
/**
 * A taxa observada precisa de pelo menos esta janela, de resgate a resgate (ou da abertura da conta ao último resgate):
 * o resgate é em bloco e manual, o cashback fica travado 7 dias e o valor em US$ do resgate carrega a variação do ETHFI
 */
export const OBSERVED_MIN_DAYS = 90;
/** E pelo menos estes resgates: com 1 ou 2, a tabela pública do nível diz mais que eles */
export const OBSERVED_MIN_CLAIMS = 3;
/**
 * Atraso entre a compra e o cashback dela ficar resgatável: a trava de 7 dias depois da liquidação (CASHBACK_PAYOUT,
 * verificado) mais uns 2 dias até liquidar (inferência da pesquisa: de 1 a 3 dias, sem número oficial)
 */
export const CLAIM_LAG_DAYS = CASHBACK_PAYOUT.lockDays + 2;
/** Acima disto (10%), o resultado não é crível como cashback: há outra coisa no resgate ou falta histórico */
export const OBSERVED_MAX_RATE = 0.1;
/** Teto do controle deslizante da taxa (fração) */
export const RATE_MAX = 0.1;
/** Quantos degraus a escada de marcos mostra */
export const MILESTONE_STEPS = 3;
/** Tabela de plano conferida há mais que isto: "pode ter mudado" (o mesmo prazo da pesquisa) */
export const PLAN_STALE_DAYS = CASHBACK_STALE_DAYS;
/** Limites dos itens digitados à mão */
export const MANUAL_LIMITS = { items: 50, name: 60, amount: 1_000_000 } as const;
/** Limite das listas de chaves (exclusões e ordem) guardadas no navegador */
const KEY_LIST_MAX = 500;
const KEY_MAX = 120;

type Tr = (en: string, pt: string) => string;

// ---------- preferências (guardadas só no aparelho) ----------

export type EarningsPeriod = 'monthly' | 'annual';
/** 'card': média do gasto no cartão; 'recurring': só as recorrências pagas no cartão */
export type BaseMode = 'card' | 'recurring';
export type ManualCycle = 'monthly' | 'annual';

/** Item digitado pela pessoa: "Aluguel", "Academia"… */
export interface ManualItem {
  /** Gerado pela tela (ex.: crypto.randomUUID()): letras, números, "-" e "_", até 40 */
  id: string;
  /** Até 60 caracteres, sem caracteres de controle */
  name: string;
  /** Valor por ciclo, na moeda `currency` (> 0) */
  amount: number;
  /** 'USD' ou a moeda da casa (convertida pelo câmbio recente das compras: aí o valor sai com "≈") */
  currency: string;
  cycle: ManualCycle;
  /** Pago com o cartão: o item entra também na base do cashback */
  onCard: boolean;
}

export interface EarningsPrefs {
  version: 1;
  /** Taxa de cashback escolhida no controle (fração, 0 a RATE_MAX). Ausente = automática (observada, senão a do plano) */
  rate?: number;
  base: BaseMode;
  /** Nível do cartão que a pessoa informou, para a taxa pública do plano */
  tier?: CashTier;
  manual: ManualItem[];
  /** Chaves de item (EarningsItem.key) que ficam fora da conta */
  excluded: string[];
  /** Ordem fixada pela pessoa (chaves). Ausente = do mais barato ao mais caro */
  order?: string[];
  /** Alternância mensal ou anual da tela */
  period: EarningsPeriod;
}

export const DEFAULT_EARNINGS_PREFS: EarningsPrefs = { version: 1, base: 'card', manual: [], excluded: [], period: 'monthly' };

const TIERS: readonly CashTier[] = ['core', 'luxe', 'pinnacle', 'vip'];
const isRecord = (raw: unknown): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw);
// controles (C0, DEL, C1) e marcas de direção: um RLO inverteria o nome na tela
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** Nome limpo: sem caracteres de controle nem marcas de direção, espaços juntados, até 60 caracteres */
export const cleanItemName = (s: string): string => s.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, MANUAL_LIMITS.name).trim();

/** Valida um item manual (lido do navegador ou vindo do formulário); o que não servir vira undefined. */
export function validateManualItem(raw: unknown): ManualItem | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, name, amount, currency, cycle, onCard } = raw;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) return undefined;
  const clean = typeof name === 'string' ? cleanItemName(name) : '';
  if (!clean) return undefined;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MANUAL_LIMITS.amount) return undefined;
  const cur = currency === undefined ? 'USD' : typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null;
  if (!cur || (cycle !== 'monthly' && cycle !== 'annual') || typeof onCard !== 'boolean') return undefined;
  return { id, name: clean, amount: R2(amount), currency: cur, cycle, onCard };
}

function keyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const k of raw) {
    if (typeof k === 'string' && k.length > 0 && k.length <= KEY_MAX && !out.includes(k)) out.push(k);
    if (out.length >= KEY_LIST_MAX) break;
  }
  return out;
}

/**
 * Valida as preferências lidas do navegador (storage.ts). Versão errada ou formato estranho vira undefined (vale o
 * padrão). Dentro dele, descarta só o campo ou o item estragado, nunca a lista inteira: os itens são da pessoa.
 */
export function validateEarningsPrefs(raw: unknown): EarningsPrefs | undefined {
  if (!isRecord(raw) || raw.version !== 1) return undefined;
  const out: EarningsPrefs = {
    version: 1,
    base: raw.base === 'recurring' ? 'recurring' : 'card',
    manual: [],
    excluded: keyList(raw.excluded),
    period: raw.period === 'annual' ? 'annual' : 'monthly',
  };
  if (typeof raw.rate === 'number' && Number.isFinite(raw.rate) && raw.rate >= 0 && raw.rate <= RATE_MAX) out.rate = Math.round(raw.rate * 10000) / 10000;
  if (TIERS.includes(raw.tier as CashTier)) out.tier = raw.tier as CashTier;
  if (Array.isArray(raw.manual)) {
    for (const m of raw.manual) {
      const item = validateManualItem(m);
      if (item && !out.manual.some((x) => x.id === item.id)) out.manual.push(item);
      if (out.manual.length >= MANUAL_LIMITS.items) break;
    }
  }
  const order = keyList(raw.order);
  if (order.length) out.order = order;
  return out;
}

/** Chave de um item manual na alocação, nas exclusões e na ordem */
export const manualKey = (id: string) => `man:${id}`;
/** Chave de um item detectado (SubscriptionRecord.key) */
export const recurringKey = (key: string) => `rec:${key}`;

/** Põe ou tira um item da conta. */
export function toggleExcluded(prefs: EarningsPrefs, key: string): EarningsPrefs {
  const excluded = prefs.excluded.includes(key) ? prefs.excluded.filter((k) => k !== key) : [...prefs.excluded, key].slice(-KEY_LIST_MAX);
  return { ...prefs, excluded };
}

/** Acrescenta um item manual ou troca o de mesmo id. Item inválido ou acima do limite: devolve as preferências como estavam. */
export function upsertManual(prefs: EarningsPrefs, raw: ManualItem): EarningsPrefs {
  const item = validateManualItem(raw);
  if (!item) return prefs;
  const i = prefs.manual.findIndex((m) => m.id === item.id);
  if (i < 0 && prefs.manual.length >= MANUAL_LIMITS.items) return prefs;
  const manual = i < 0 ? [...prefs.manual, item] : prefs.manual.map((m, k) => (k === i ? item : m));
  return { ...prefs, manual };
}

/** Remove um item manual, e a chave dele das exclusões e da ordem. */
export function removeManual(prefs: EarningsPrefs, id: string): EarningsPrefs {
  const key = manualKey(id);
  const order = prefs.order?.filter((k) => k !== key);
  const next: EarningsPrefs = { ...prefs, manual: prefs.manual.filter((m) => m.id !== id), excluded: prefs.excluded.filter((k) => k !== key) };
  if (order?.length) next.order = order;
  else delete next.order;
  return next;
}

/**
 * Move uma chave `delta` posições na ordem atual (a da alocação: allocation.rows.map((r) => r.item.key)). Grave o
 * resultado em prefs.order; para voltar ao "mais barato primeiro", apague prefs.order.
 */
export function moveInOrder(keys: readonly string[], key: string, delta: number): string[] {
  const from = keys.indexOf(key);
  if (from < 0) return [...keys];
  const to = Math.max(0, Math.min(keys.length - 1, from + Math.trunc(delta)));
  const out = keys.filter((k) => k !== key);
  out.splice(to, 0, key);
  return out;
}

// ---------- taxa pública do plano (da pesquisa: src/lib/insights/cashbackPlans.ts) ----------

/** Faixa de gasto do mês civil (o contador da ether.fi zera no dia 1): a taxa vale só sobre o gasto que cai nela */
export interface PlanBand {
  /** Fim da faixa, em US$ acumulados no mês (inclusive); sem o campo, a faixa não tem fim */
  upToUsd?: number;
  /** Fração: 0.03 = 3% */
  rate: number;
}

/**
 * Taxa pública de cashback de um plano. Os dados vêm da pesquisa (insights/cashbackPlans.ts, CASHBACK_PLAN_RATES, com
 * fonte e data), que é o padrão; `opts.plans` troca a lista (os checks passam a deles).
 */
export interface PlanRate {
  /** Nível do cartão (CashTier) ou outro id do plano */
  id: string;
  /** Nome como a ether.fi mostra */
  label: string;
  /** Taxa da 1ª faixa (fração): a que vale sem `bands` */
  rate: number;
  /** O plano usado quando a pessoa não diz qual; no máximo um */
  default?: boolean;
  /** Faixas do gasto padrão (USD e moedas que não são EUR). Se a última tem fim, o gasto acima fica sem preço */
  bands?: readonly PlanBand[];
  source: InsightSource;
}

/**
 * Cashback de um gasto mensal pelas faixas do plano: cada faixa paga a sua taxa só sobre a parte do gasto que cai nela.
 * Sem faixas, gasto × taxa. É uma média (o contador real zera todo mês civil e o mês de gasto alto rende menos na
 * margem). `unpriced`: gasto acima da última faixa com fim, sem taxa publicada, que fica fora.
 */
export function planCashback(plan: PlanRate, monthlySpend: number): { usd: number; unpriced: number; effectiveRate: number } {
  const spend = Math.max(0, monthlySpend);
  if (!plan.bands?.length) return { usd: spend * plan.rate, unpriced: 0, effectiveRate: plan.rate };
  let pos = 0;
  let usdTotal = 0;
  for (const band of plan.bands) {
    if (pos >= spend) break;
    const end = Math.min(spend, band.upToUsd ?? Infinity);
    if (end > pos) {
      usdTotal += (end - pos) * band.rate;
      pos = end;
    }
  }
  return { usd: usdTotal, unpriced: Math.max(0, spend - pos), effectiveRate: spend > 0 ? usdTotal / spend : plan.bands[0].rate };
}

/** "3% até US$ 2.000 de gasto no mês, 1% até US$ 3.000, 0,5% acima" */
function bandsText(plan: PlanRate, tr: Tr): string {
  const bands = plan.bands?.length ? plan.bands : [{ rate: plan.rate }];
  const parts = bands.map((b, i) => (b.upToUsd === undefined
    ? (i === 0 ? pct(b.rate * 100, 2) : tr(`${pct(b.rate * 100, 2)} above`, `${pct(b.rate * 100, 2)} acima`))
    : tr(`${pct(b.rate * 100, 2)} up to ${usd0(b.upToUsd)}${i === 0 ? ' of spending in the month' : ''}`, `${pct(b.rate * 100, 2)} até ${usd0(b.upToUsd)}${i === 0 ? ' de gasto no mês' : ''}`)));
  if (bands[bands.length - 1].upToUsd !== undefined) parts.push(tr('above that, a lower rate that isn’t published', 'acima disso, uma taxa menor sem número publicado'));
  return parts.join(', ');
}

// ---------- fontes: rendimento ----------

export interface YieldHolding {
  asset: string;
  name?: string;
  /** Valor em US$ hoje */
  value: number;
  /** APY percentual informado (6.2 = 6,2% ao ano) */
  apy: number;
  monthly: number;
  annual: number;
}

export interface YieldGroup {
  /** 'liquid': cofres Liquid (grupo liquidVaults ou símbolo liquid*); 'other': os outros ativos com APY */
  id: 'liquid' | 'other';
  value: number;
  /** APY médio ponderado pelo valor (%); 0 sem valor */
  avgApy: number;
  monthly: number;
  annual: number;
  /** Do que mais rende para o que menos rende */
  holdings: YieldHolding[];
}

/**
 * Rendimento estimado por ativo: valor × APY ÷ 12, no saldo e no APY de hoje. Só ativos com APY informado e valor
 * positivo. Os cofres Liquid ficam num grupo, um por um; o resto (weETH etc.) noutro.
 */
export function yieldGroups(dataset: Dataset): { liquid: YieldGroup; other: YieldGroup } {
  const rows = dataset.portfolio.holdings.filter((h) => (h.apy ?? 0) > 0 && h.dollarValue > 0);
  const group = (id: YieldGroup['id'], list: Holding[]): YieldGroup => {
    const holdings = list
      .map((h) => {
        const annual = (h.dollarValue * (h.apy ?? 0)) / 100;
        return { asset: h.asset, ...(h.name ? { name: h.name } : {}), value: R2(h.dollarValue), apy: h.apy ?? 0, monthly: R2(annual / 12), annual: R2(annual) };
      })
      .sort((a, b) => b.annual - a.annual || a.asset.localeCompare(b.asset));
    const value = list.reduce((s, h) => s + h.dollarValue, 0);
    const annual = list.reduce((s, h) => s + (h.dollarValue * (h.apy ?? 0)) / 100, 0);
    // o grupo é a soma das linhas como a tela as mostra: o fluxo e a legenda fecham no centavo
    return {
      id, value: R2(value), avgApy: value > 0 ? R2((annual / value) * 100) : 0,
      monthly: R2(holdings.reduce((s, h) => s + h.monthly, 0)), annual: R2(holdings.reduce((s, h) => s + h.annual, 0)), holdings,
    };
  };
  const liquid = rows.filter((h) => h.vault || isVault(h));
  return { liquid: group('liquid', liquid), other: group('other', rows.filter((h) => !liquid.includes(h))) };
}

// ---------- fontes: cashback ----------

/** Por que a taxa observada não deu */
export type ObservedFailure =
  /** o conector omitiu linhas (coverage.droppedRows): os totais não fecham */
  | 'dropped_rows'
  /** nenhum cashback creditado nem resgate liquidado no histórico */
  | 'no_cashback'
  /** só resgates ainda a confirmar */
  | 'pending_only'
  /** menos de OBSERVED_MIN_CLAIMS resgates (ou todos no mesmo dia): o resgate é em bloco, manual e em ETHFI, e com tão poucos a tabela pública diz mais */
  | 'few_claims'
  /** a janela tem menos de OBSERVED_MIN_DAYS dias */
  | 'short_period'
  /** resgate sem gasto no cartão no mesmo período */
  | 'no_spend'
  /** o resultado passa de OBSERVED_MAX_RATE */
  | 'implausible';

export type ObservedRate =
  | {
    ok: true;
    /** Fração: 0.015 = 1,5% */
    rate: number;
    /** 'credits': cashback por compra (linhas cashback) na janela da base; 'claims': resgates em bloco, de resgate a resgate */
    method: 'credits' | 'claims';
    /** Dias da janela (AAAA-MM-DD, inclusive) */
    from: string;
    to: string;
    days: number;
    /** Cashback na janela (US$) */
    cashback: number;
    /** Gasto no cartão na janela, estornos descontados (US$) */
    spend: number;
    /** Linhas de cashback usadas */
    count: number;
    relatedIds: string[];
  }
  | {
    ok: false;
    reason: ObservedFailure;
    /** Linhas de cashback no histórico (liquidadas) */
    count: number;
    /** Dias da janela, quando chegou a haver uma (short_period) */
    days?: number;
    /** O resultado que foi recusado (implausible) */
    rate?: number;
  };

const dayOf = (iso: string) => iso.slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Dias de from a to, contando os dois */
const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
const spendBetween = (dataset: Dataset, from: string, to: string): Transaction[] =>
  dataset.transactions.filter((t) => isSpend(t) && dayOf(t.date) >= from && dayOf(t.date) <= to);
const sumUsd = (rows: Transaction[]) => rows.reduce((s, t) => s + t.amountUsd, 0);

/** A janela da base do cartão: os últimos 90 dias até o referenceDate, a partir do começo do histórico se ele for mais curto. */
function cardWindow(dataset: Dataset): { from: string; to: string; days: number } {
  const to = dataset.referenceDate;
  let from = addDays(to, -(BASE_WINDOW_DAYS - 1));
  const start = dataset.coverage
    ? dayOf(dataset.coverage.from)
    : dataset.transactions.reduce<string | null>((m, t) => (m === null || dayOf(t.date) < m ? dayOf(t.date) : m), null);
  if (start === null) return { from: to, to, days: 0 };
  if (start > from) from = start;
  return { from, to, days: Math.max(0, spanDays(from, to)) };
}

/**
 * Taxa observada: cashback recebido ou resgatado ÷ gasto no cartão no mesmo período, só quando dá para afirmar.
 * - Com cashback por compra (linhas `cashback`, liquidadas): na janela da base (os últimos 90 dias cobertos).
 * - Só com resgates (`cashback_claim`, o que uma conta real tem): um resgate paga o que se acumulou desde o anterior.
 *   Precisa de pelo menos OBSERVED_MIN_CLAIMS resgates. O gasto se mede com CLAIM_LAG_DAYS de atraso (o resgate leva
 *   o que já destravou). Com o histórico desde a abertura da conta (coverage.complete), a janela do gasto vai do começo
 *   até o último resgate − atraso, e entram todos. Sem isso, vai do primeiro resgate − atraso ao último − atraso, e o
 *   primeiro fica fora (não se sabe desde quando ele acumulava).
 * A previsão usa a tabela do plano; a observada é a comparação ao lado (texts.observed).
 * Em qualquer caso, a janela tem pelo menos OBSERVED_MIN_DAYS dias. Resgate a confirmar não entra (como no resto do
 * painel). Toda compra conta como elegível: o conector não manda o código do estabelecimento que decide isso.
 */
export function observedRate(dataset: Dataset): ObservedRate {
  const live = dataset.transactions.filter((t) => t.status === 'settled');
  const credits = live.filter((t) => t.type === 'cashback' && t.amountUsd > 0);
  const claims = live.filter((t) => t.type === 'cashback_claim' && t.amountUsd > 0).sort((a, b) => a.date.localeCompare(b.date));
  const count = credits.length || claims.length;
  if (dataset.coverage?.droppedRows) return { ok: false, reason: 'dropped_rows', count };

  let method: 'credits' | 'claims';
  let from: string;
  let to: string;
  let used: Transaction[];
  if (credits.length) {
    method = 'credits';
    ({ from, to } = cardWindow(dataset));
    used = credits.filter((t) => dayOf(t.date) >= from && dayOf(t.date) <= to);
  } else {
    if (!claims.length) {
      const pending = dataset.transactions.some((t) => t.type === 'cashback_claim' && t.status === 'pending');
      return { ok: false, reason: pending ? 'pending_only' : 'no_cashback', count: 0 };
    }
    method = 'claims';
    if (claims.length < OBSERVED_MIN_CLAIMS) return { ok: false, reason: 'few_claims', count };
    // o resgate do dia t leva o que liquidou e destravou até cerca de t − CLAIM_LAG_DAYS: o gasto se mede com esse atraso
    to = addDays(dayOf(claims[claims.length - 1].date), -CLAIM_LAG_DAYS);
    if (dataset.coverage?.complete) {
      from = dayOf(dataset.coverage.from);
      used = claims;
    } else {
      const first = dayOf(claims[0].date);
      used = claims.filter((t) => dayOf(t.date) > first);
      if (!used.length) return { ok: false, reason: 'few_claims', count };
      from = addDays(first, 1 - CLAIM_LAG_DAYS);
    }
  }
  const days = spanDays(from, to);
  if (days < OBSERVED_MIN_DAYS) return { ok: false, reason: 'short_period', count, days: Math.max(0, days) };
  const cashback = sumUsd(used);
  if (!(cashback > 0)) return { ok: false, reason: 'no_cashback', count };
  const spend = sumUsd(spendBetween(dataset, from, to));
  if (!(spend > 0)) return { ok: false, reason: 'no_spend', count };
  const rate = cashback / spend;
  if (rate > OBSERVED_MAX_RATE) return { ok: false, reason: 'implausible', count, rate: Math.round(rate * 10000) / 10000 };
  return { ok: true, rate: Math.round(rate * 10000) / 10000, method, from, to, days, cashback: R2(cashback), spend: R2(spend), count: used.length, relatedIds: used.map((t) => t.id) };
}

export interface SpendBase {
  mode: BaseMode;
  /** US$ por mês sobre o qual a taxa incide; null quando não dá para estimar (histórico curto demais no modo cartão) */
  monthly: number | null;
  /** A média do cartão nos últimos 90 dias cobertos (sem os itens manuais) */
  card: {
    from: string;
    to: string;
    days: number;
    /** Compras na janela, estornos descontados */
    spend: number;
    count: number;
    /** spend ÷ dias × dias do mês; null com menos de BASE_MIN_DAYS dias de histórico */
    monthly: number | null;
    /** 'short_history': menos de BASE_MIN_DAYS dias; 'no_spend': nenhuma compra na janela */
    reason?: 'short_history' | 'no_spend';
  };
  /**
   * As recorrências incluídas pagas no cartão (as detectadas, que são cobranças do cartão, e as manuais marcadas), por
   * mês: a base do modo 'recurring'. Item excluído sai dela (e no modo 'card' fica no resto do cartão)
   */
  recurring: { monthly: number; count: number };
  /** Itens manuais pagos no cartão, por mês: no modo cartão são somados à média */
  manualOnCard: number;
  /** Modo cartão: as recorrências do cartão somavam mais que a média, e a base subiu até elas */
  lifted: boolean;
  /** O conector omitiu linhas: a média do cartão pode estar abaixo do real */
  partial: boolean;
}

export type RateSource = 'custom' | 'observed' | 'plan' | 'none';

export interface CashbackForecast {
  /** A taxa aplicada (fração); com as faixas do plano, a taxa média que elas dão sobre a base; null sem taxa nenhuma */
  rate: number | null;
  /** 'custom': taxa própria; 'plan': tabela do plano (o padrão); 'observed': só quando não há tabela de plano */
  rateSource: RateSource;
  /** A taxa sem a própria: a média do plano sobre a base (ou a observada, sem tabela). É o ponto inicial do controle */
  autoRate: number | null;
  autoSource: Exclude<RateSource, 'custom'>;
  /** A taxa observada nos resgates: com plano, é a comparação ao lado da previsão (texts.observed) */
  observed: ObservedRate;
  /** Base × taxa observada, para comparar com a previsão; null quando a observada não deu */
  observedMonthly: number | null;
  /** O plano cuja taxa pública valeria (o informado pela pessoa, senão o padrão da pesquisa) */
  plan: PlanRate | null;
  /** O plano veio do padrão (a pessoa não disse o nível dela) */
  planIsDefault: boolean;
  /** A tabela do plano foi conferida há mais de PLAN_STALE_DAYS dias: a tela diz "pode ter mudado" */
  planStale: boolean;
  /** Com as faixas do plano: gasto mensal acima da última faixa com fim, sem taxa publicada (fica fora) */
  unpricedSpend: number;
  base: SpendBase;
  /** base × taxa (0 sem base ou sem taxa) */
  monthly: number;
  annual: number;
  /** Linhas de cashback da taxa observada, para o "por quê?" */
  relatedIds: string[];
}

// ---------- recorrências ----------

export type ItemOrigin = 'subscription' | 'bill' | 'manual';

export interface EarningsItem {
  /** 'rec:<chave do registro>' ou 'man:<id>': a chave das exclusões e da ordem */
  key: string;
  name: string;
  origin: ItemOrigin;
  cycle: Cycle;
  /** Custo por mês em US$ (anual ÷ 12) */
  monthly: number;
  /** Custo por ano em US$ */
  annual: number;
  /** Custo estimado (cobrança por uso, ou item manual convertido pelo câmbio recente): mostrar com "≈" */
  approx: boolean;
  /** Pago com o cartão (os detectados sempre são: vêm das cobranças do cartão) */
  onCard: boolean;
  /** A pessoa tirou o item da conta */
  excluded: boolean;
  /**
   * Cashback estimado do item: custo × a taxa média do cashback sobre a base (Estimativa, "≈"). 0 fora do cartão. Nos
   * incluídos, as linhas mais o resto do cartão fecham no centavo com o cashback total (receipt); no excluído, é só
   * informativo (o valor dele está dentro do resto do cartão)
   */
  cashbackMonthly: number;
  cashbackAnnual: number;
  category?: string;
  /** Item manual: como a pessoa digitou (para editar) */
  manual?: ManualItem;
}

/** Item que fica fora da conta por não ter preço: ciclo desconhecido, ou moeda sem câmbio para converter */
export interface UnpricedItem {
  key: string;
  name: string;
  origin: ItemOrigin;
  reason: 'unknown_cost' | 'no_fx';
}

/**
 * As recorrências da conta: assinaturas ativas e contas recorrentes que o app detecta (o mesmo relatório da aba
 * Assinaturas, sem as marcadas "não é assinatura") e os itens manuais, por mês e por ano.
 */
export function earningsItems(dataset: Dataset, report: SubscriptionReport, prefs: EarningsPrefs): { items: EarningsItem[]; unpriced: UnpricedItem[] } {
  const items: EarningsItem[] = [];
  const unpriced: UnpricedItem[] = [];
  const excluded = new Set(prefs.excluded);
  const used = new Set<string>();
  const unique = (base: string) => {
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}~${n}`;
    used.add(key);
    return key;
  };
  const active = report.records.filter((r: SubscriptionRecord) => r.status === 'active' && r.decision?.choice !== 'not_subscription');
  for (const r of active) {
    const key = unique(recurringKey(r.key));
    const origin: ItemOrigin = r.kind === 'bill' ? 'bill' : 'subscription';
    if (!(r.monthlyCostUsd > 0)) {
      unpriced.push({ key, name: r.name, origin, reason: 'unknown_cost' });
      continue;
    }
    items.push({
      key, name: r.name, origin, cycle: r.cycle, monthly: r.monthlyCostUsd, annual: r.annualCostUsd > 0 ? r.annualCostUsd : R2(r.monthlyCostUsd * 12),
      approx: r.costApprox, onCard: true, excluded: excluded.has(key), cashbackMonthly: 0, cashbackAnnual: 0, ...(r.category ? { category: r.category } : {}),
    });
  }
  const fx = recentFx(dataset) ?? fxSummary(dataset);
  for (const m of prefs.manual) {
    const key = unique(manualKey(m.id));
    let usdAmount: number;
    if (m.currency === 'USD') usdAmount = m.amount;
    else if (fx && fx.currency === m.currency && fx.localPerUsd > 0) usdAmount = m.amount / fx.localPerUsd;
    else {
      unpriced.push({ key, name: m.name, origin: 'manual', reason: 'no_fx' });
      continue;
    }
    const monthly = m.cycle === 'annual' ? usdAmount / 12 : usdAmount;
    items.push({
      key, name: m.name, origin: 'manual', cycle: m.cycle, monthly: R2(monthly), annual: R2(m.cycle === 'annual' ? usdAmount : usdAmount * 12),
      approx: m.currency !== 'USD', onCard: m.onCard, excluded: excluded.has(key), cashbackMonthly: 0, cashbackAnnual: 0, manual: m,
    });
  }
  return { items, unpriced };
}

/** Reparte `total` (em US$) entre as partes, proporcional a `raws`, em centavos inteiros que somam exatamente o total (maior resto). */
export function splitCents(total: number, raws: readonly number[]): number[] {
  const cents = Math.round(total * 100);
  const sum = raws.reduce((s, r) => s + Math.max(0, r), 0);
  if (!raws.length || !(sum > 0) || cents <= 0) return raws.map(() => 0);
  const exact = raws.map((r) => (Math.max(0, r) / sum) * cents);
  const floor = exact.map(Math.floor);
  let left = cents - floor.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, frac: x - floor[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floor[i] += 1;
    left -= 1;
  }
  return floor.map((c) => c / 100);
}

/** O cashback repartido: cada item incluído pago no cartão, e o resto do cartão (o que sobra da base) */
export interface CashbackSplit {
  /** Por chave de item (incluídos e excluídos pagos no cartão) */
  byKey: Map<string, { monthly: number; annual: number }>;
  /** O resto do cartão: o gasto da base fora dos itens incluídos, e o cashback dele; null quando não há resto */
  rest: { spendMonthly: number; cashbackMonthly: number; cashbackAnnual: number } | null;
}

/**
 * Reparte o cashback total entre os itens incluídos pagos no cartão (custo × taxa média sobre a base) e o resto do
 * cartão ((base − itens incluídos no cartão) × a mesma taxa), em centavos que fecham exatamente com o total, no mês e
 * no ano. O excluído pago no cartão está dentro do resto; o valor dele sai à parte, só informativo.
 */
export function splitCashback(items: readonly EarningsItem[], cashback: CashbackForecast): CashbackSplit {
  const byKey = new Map<string, { monthly: number; annual: number }>();
  const base = cashback.base.monthly ?? 0;
  if (!(base > 0) || !(cashback.monthly > 0)) return { byKey, rest: null };
  const rate = cashback.monthly / base;
  const included = items.filter((i) => i.onCard && !i.excluded);
  const restSpend = Math.max(0, base - included.reduce((s, i) => s + i.monthly, 0));
  const raws = [...included.map((i) => i.monthly), restSpend];
  const monthly = splitCents(cashback.monthly, raws);
  // no ano, o item anual pesa pelo preço dele (59,99), não por mensal × 12
  const annual = splitCents(cashback.annual, [...included.map((i) => i.annual), restSpend * 12]);
  included.forEach((i, k) => byKey.set(i.key, { monthly: monthly[k], annual: annual[k] }));
  for (const i of items.filter((x) => x.onCard && x.excluded)) byKey.set(i.key, { monthly: R2(i.monthly * rate), annual: R2(i.annual * rate) });
  const last = raws.length - 1;
  return { byKey, rest: restSpend > 0.005 ? { spendMonthly: R2(restSpend), cashbackMonthly: monthly[last], cashbackAnnual: annual[last] } : null };
}

/** Recorrência sugerida: a anuidade de um nível comprado na ether.fi, achada no extrato. A pessoa aceita e vira item manual */
export interface SuggestedItem {
  /** Vira o id do item manual ao aceitar (suggestionToManual) */
  id: string;
  /** "ether.fi Luxe" */
  name: string;
  /** Preço anual publicado do nível (US$) */
  amount: number;
  cycle: 'annual';
  /** A cobrança achada foi no cartão */
  onCard: boolean;
  /** Nível (CashTier) */
  plan: CashTier;
  /** As linhas do extrato que sustentam a sugestão, para o "por quê?" */
  evidenceIds: string[];
}

const PAID_LEVELS = ['luxe', 'pinnacle'] as const satisfies readonly CashTier[];

/**
 * Anuidade de nível comprado (Luxe US$ 199 ou Pinnacle US$ 999 por ano, pela tabela da pesquisa), só com prova no
 * extrato: uma linha que cita a ether.fi e o nível, com o valor do preço anual (1% de folga), no último ano e pouco.
 * O conector não tem um tipo para isso; sem o texto e o valor juntos, não sugere nada. Já adicionado à mão: não repete.
 */
export function membershipSuggestions(dataset: Dataset, prefs: EarningsPrefs): SuggestedItem[] {
  const out: SuggestedItem[] = [];
  const ref = Date.parse(`${dataset.referenceDate}T00:00:00Z`);
  for (const level of PAID_LEVELS) {
    const plan = CASHBACK_PLANS[level];
    const price = plan.access.annualUsd;
    const id = `ethfi-${level}`;
    if (!price || prefs.manual.some((m) => m.id === id)) continue;
    const name = new RegExp(`\\b${plan.name}\\b`, 'i');
    const rows = dataset.transactions.filter((t) => {
      if (t.status === 'void' || t.type === 'cashback' || t.type === 'cashback_claim' || t.type === 'referral') return false;
      const text = `${t.merchant ?? ''} ${t.merchantRaw ?? ''} ${t.brand ?? ''}`;
      return /ether\.?\s?fi/i.test(text) && name.test(text) && Math.abs(Math.abs(t.amountUsd) - price) <= Math.max(1, price * 0.01)
        && (ref - Date.parse(t.date)) / DAY <= 400;
    });
    if (rows.length) out.push({ id, name: `ether.fi ${plan.name}`, amount: price, cycle: 'annual', onCard: rows.some(isSpend), plan: level, evidenceIds: rows.map((t) => t.id) });
  }
  return out;
}

/** A sugestão aceita, como item manual (grave com upsertManual). */
export const suggestionToManual = (s: SuggestedItem): ManualItem => ({ id: s.id, name: s.name, amount: s.amount, currency: 'USD', cycle: s.cycle, onCard: s.onCard });

/** O que há de errado num item do formulário, campo a campo (o texto, no idioma pedido, sai de manualErrorText) */
export type ManualFieldError =
  | { field: 'name'; code: 'name_empty' }
  | { field: 'amount'; code: 'amount_invalid' | 'amount_too_big' }
  | { field: 'currency'; code: 'currency_invalid' }
  | { field: 'cycle'; code: 'cycle_invalid' };

/** Confere os campos do formulário de item manual; lista vazia = o item passa no validateManualItem (com um id válido). */
export function manualItemErrors(raw: { name?: unknown; amount?: unknown; currency?: unknown; cycle?: unknown }): ManualFieldError[] {
  const out: ManualFieldError[] = [];
  if (typeof raw.name !== 'string' || !cleanItemName(raw.name)) out.push({ field: 'name', code: 'name_empty' });
  const amount = raw.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) out.push({ field: 'amount', code: 'amount_invalid' });
  else if (amount > MANUAL_LIMITS.amount) out.push({ field: 'amount', code: 'amount_too_big' });
  if (raw.currency !== undefined && (typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency))) out.push({ field: 'currency', code: 'currency_invalid' });
  if (raw.cycle !== 'monthly' && raw.cycle !== 'annual') out.push({ field: 'cycle', code: 'cycle_invalid' });
  return out;
}

export function manualErrorText(code: ManualFieldError['code'], locale: Locale): string {
  const tr: Tr = (en, pt) => pick(locale, en, pt);
  switch (code) {
    case 'name_empty': return tr('Give the item a name.', 'Dê um nome ao item.');
    case 'amount_invalid': return tr('Enter an amount above zero.', 'Digite um valor acima de zero.');
    case 'amount_too_big': return tr(`Enter up to ${usd0(MANUAL_LIMITS.amount)}.`, `Digite até ${usd0(MANUAL_LIMITS.amount)}.`);
    case 'currency_invalid': return tr('Pick US$ or your home currency.', 'Escolha US$ ou a moeda da casa.');
    case 'cycle_invalid': return tr('Pick monthly or yearly.', 'Escolha mensal ou anual.');
  }
}

/**
 * A base de gasto do cashback. 'card': média dos últimos 90 dias cobertos (estornos descontados) mais os itens manuais
 * pagos no cartão. 'recurring': só as recorrências pagas no cartão. Item excluído continua na base: excluir tira o item
 * da cobertura, mas ele segue sendo pago no cartão.
 */
export function spendBase(dataset: Dataset, items: readonly EarningsItem[], mode: BaseMode): SpendBase {
  const w = cardWindow(dataset);
  const rows = w.days > 0 ? spendBetween(dataset, w.from, w.to) : [];
  const spend = Math.max(0, sumUsd(rows));
  const short = w.days < BASE_MIN_DAYS;
  const cardMonthly = short ? null : (spend / w.days) * DAYS_PER_MONTH;
  const onCard = items.filter((i) => i.onCard);
  const manualOnCard = onCard.filter((i) => i.origin === 'manual').reduce((s, i) => s + i.monthly, 0);
  const allOnCard = onCard.reduce((s, i) => s + i.monthly, 0);
  const included = onCard.filter((i) => !i.excluded);
  const recurring = included.reduce((s, i) => s + i.monthly, 0);
  // a média do cartão nunca fica abaixo do que as recorrências do cartão já somam (assinatura nova, ainda fora dos 90 dias)
  const cardBase = cardMonthly === null ? null : cardMonthly + manualOnCard;
  const lifted = mode === 'card' && cardBase !== null && allOnCard > cardBase + 0.005;
  const monthly = mode === 'recurring' ? recurring : cardBase === null ? null : Math.max(cardBase, allOnCard);
  return {
    mode,
    monthly: monthly === null ? null : R2(monthly),
    card: {
      from: w.from, to: w.to, days: w.days, spend: R2(spend), count: rows.filter((t) => t.amountUsd > 0).length,
      monthly: cardMonthly === null ? null : R2(cardMonthly),
      ...(short ? { reason: 'short_history' as const } : !rows.length ? { reason: 'no_spend' as const } : {}),
    },
    recurring: { monthly: R2(recurring), count: included.length },
    manualOnCard: R2(manualOnCard),
    lifted,
    partial: Boolean(dataset.coverage?.droppedRows),
  };
}

/** O plano que vale: o nível que a pessoa informou, senão o padrão da pesquisa. */
export function planFor(plans: readonly PlanRate[], tier?: string): PlanRate | null {
  const valid = plans.filter((p) => Number.isFinite(p.rate) && p.rate >= 0 && p.rate <= RATE_MAX && p.source.url.startsWith('https://'));
  return (tier ? valid.find((p) => p.id === tier) : undefined) ?? valid.find((p) => p.default) ?? null;
}

/**
 * Cashback previsto. A taxa: a própria (o controle); senão a pública do plano escolhido (Core por padrão), pelas faixas
 * do mês sobre a base; sem tabela de plano, a observada; senão nenhuma. Com plano, a observada fica como comparação.
 */
export function cashbackForecast(dataset: Dataset, items: readonly EarningsItem[], prefs: EarningsPrefs, plans: readonly PlanRate[] = CASHBACK_PLAN_RATES): CashbackForecast {
  const observed = observedRate(dataset);
  const plan = planFor(plans, prefs.tier);
  const base = spendBase(dataset, items, prefs.base);
  const banded = plan && base.monthly !== null ? planCashback(plan, base.monthly) : null;
  const autoSource: CashbackForecast['autoSource'] = plan ? 'plan' : observed.ok ? 'observed' : 'none';
  const planRate = banded ? Math.round(banded.effectiveRate * 10000) / 10000 : plan ? plan.rate : null;
  const autoRate = plan ? planRate : observed.ok ? observed.rate : null;
  const custom = prefs.rate !== undefined && Number.isFinite(prefs.rate) && prefs.rate >= 0 && prefs.rate <= RATE_MAX ? prefs.rate : undefined;
  const rateSource: RateSource = custom !== undefined ? 'custom' : autoSource;
  const rate = custom ?? autoRate;
  // o plano conta pelas faixas (a taxa média já arredondada mudaria o centavo); o controle e a observada, base × taxa
  const monthly = base.monthly === null || rate === null ? 0 : rateSource === 'plan' && banded ? banded.usd : base.monthly * rate;
  return {
    rate,
    rateSource,
    autoRate,
    autoSource,
    observed,
    plan,
    planIsDefault: Boolean(plan && !(prefs.tier && plan.id === prefs.tier)),
    planStale: Boolean(plan && (Date.parse(`${dataset.referenceDate}T00:00:00Z`) - Date.parse(`${plan.source.checked.slice(0, 10)}T00:00:00Z`)) / DAY > PLAN_STALE_DAYS),
    unpricedSpend: rateSource === 'plan' && banded ? R2(banded.unpriced) : 0,
    base,
    monthly: R2(monthly),
    annual: R2(monthly * 12),
    observedMonthly: observed.ok && base.monthly !== null ? R2(base.monthly * observed.rate) : null,
    relatedIds: observed.ok ? observed.relatedIds : [],
  };
}

// ---------- alocação: o que os ganhos pagam ----------

export type CoverStatus = 'covered' | 'partial' | 'uncovered';

export interface AllocationRow {
  item: EarningsItem;
  /** Posição na ordem (1 = o primeiro a ser pago) */
  rank: number;
  /** Ganhos que vão para o item, por mês e por ano */
  paidMonthly: number;
  paidAnnual: number;
  /** Fração paga (0–1) */
  share: number;
  status: CoverStatus;
}

export interface Allocation {
  order: 'cheapest' | 'custom';
  /** Os itens incluídos, na ordem em que os ganhos os pagam */
  rows: AllocationRow[];
  excluded: EarningsItem[];
  unpriced: UnpricedItem[];
  /** Itens incluídos */
  count: number;
  coveredCount: number;
  partialCount: number;
  /** Σ pago e Σ custo dos incluídos */
  coveredMonthly: number;
  totalMonthly: number;
  coveredAnnual: number;
  totalAnnual: number;
  /** Ganhos que sobram depois de pagar tudo o que dá */
  leftoverMonthly: number;
  leftoverAnnual: number;
  /** Fração do custo total coberta (0–1), para o medidor */
  coverage: number;
  /** Todos os incluídos são assinaturas: o texto diz "assinaturas"; senão, "itens" */
  allSubscriptions: boolean;
}

/**
 * Paga os itens em ordem com os ganhos do mês: cada um recebe até o seu custo; o primeiro que não cabe inteiro fica em
 * parte e os seguintes ficam sem nada. Ordem padrão: do mais barato ao mais caro (cobre o maior número de itens). Com
 * `order`, as chaves dela vêm primeiro, nessa ordem, e os itens novos entram depois, do mais barato ao mais caro.
 */
export function allocate(
  items: readonly EarningsItem[],
  earningsMonthly: number,
  opts: { order?: readonly string[]; locale?: Locale; unpriced?: UnpricedItem[]; /** padrão: mensal × 12 */ earningsAnnual?: number } = {},
): Allocation {
  const earningsAnnual = opts.earningsAnnual ?? earningsMonthly * 12;
  const tag = LOCALES.find((l) => l.value === (opts.locale ?? 'en'))?.tag;
  const included = items.filter((i) => !i.excluded);
  const cheapest = [...included].sort((a, b) => a.monthly - b.monthly || a.name.localeCompare(b.name, tag) || a.key.localeCompare(b.key));
  const pos = new Map((opts.order ?? []).map((k, i) => [k, i]));
  const fixed = cheapest.filter((i) => pos.has(i.key)).sort((a, b) => pos.get(a.key)! - pos.get(b.key)!);
  const ordered = fixed.length ? [...fixed, ...cheapest.filter((i) => !pos.has(i.key))] : cheapest;

  let left = Math.max(0, earningsMonthly);
  const rows: AllocationRow[] = ordered.map((item, i) => {
    const paid = Math.min(left, item.monthly);
    left = Math.max(0, left - paid);
    const full = paid >= item.monthly - EPS;
    const share = item.monthly > 0 ? Math.min(1, paid / item.monthly) : 0;
    const status: CoverStatus = full ? 'covered' : paid > EPS ? 'partial' : 'uncovered';
    return {
      item, rank: i + 1,
      paidMonthly: R2(full ? item.monthly : paid),
      paidAnnual: R2(full ? item.annual : share * item.annual),
      share: full ? 1 : share,
      status,
    };
  });
  // no ano, o item em parte fica com o que sobra dos ganhos do ano: pago + sobra fecha no centavo também na visão anual
  const partialRow = rows.find((r) => r.status === 'partial');
  if (partialRow) {
    const fullAnnual = rows.filter((r) => r.status === 'covered').reduce((s, r) => s + r.paidAnnual, 0);
    partialRow.paidAnnual = R2(Math.max(0, Math.min(partialRow.item.annual, earningsAnnual - fullAnnual)));
  }
  const totalMonthly = included.reduce((s, i) => s + i.monthly, 0);
  const totalAnnual = included.reduce((s, i) => s + i.annual, 0);
  const coveredMonthly = rows.reduce((s, r) => s + r.paidMonthly, 0);
  const coveredAnnual = rows.reduce((s, r) => s + r.paidAnnual, 0);
  return {
    order: fixed.length ? 'custom' : 'cheapest',
    rows,
    excluded: items.filter((i) => i.excluded),
    unpriced: opts.unpriced ?? [],
    count: rows.length,
    coveredCount: rows.filter((r) => r.status === 'covered').length,
    partialCount: rows.filter((r) => r.status === 'partial').length,
    coveredMonthly: R2(coveredMonthly),
    totalMonthly: R2(totalMonthly),
    coveredAnnual: R2(coveredAnnual),
    totalAnnual: R2(totalAnnual),
    leftoverMonthly: R2(Math.max(0, earningsMonthly - coveredMonthly)),
    leftoverAnnual: R2(Math.max(0, earningsAnnual - coveredAnnual)),
    coverage: totalMonthly > 0 ? Math.min(1, coveredMonthly / totalMonthly) : 0,
    allSubscriptions: rows.length > 0 && rows.every((r) => r.item.origin === 'subscription'),
  };
}

/**
 * A cobertura de um tipo de item na mesma alocação da tela Ganhos: para o atalho de Assinaturas ("≈ X% coberto"),
 * passe 'subscription' (o KPI de lá é só de assinaturas ativas), e o número bate com a lista da tela Ganhos.
 * Sem `origin`, todos os incluídos.
 */
/** A fração paga de um item em parte, em %: para baixo, de 1 a 99 (nunca "100%" sem estar pago inteiro). Tela, dica e resumo usam esta. */
export const partialPct = (share: number) => Math.min(99, Math.max(1, Math.floor(share * 100)));

export function coverageOf(allocation: Allocation, origin?: ItemOrigin): { paidMonthly: number; totalMonthly: number; share: number; covered: number; count: number } {
  const rows = origin ? allocation.rows.filter((r) => r.item.origin === origin) : allocation.rows;
  const paid = rows.reduce((s, r) => s + r.paidMonthly, 0);
  const total = rows.reduce((s, r) => s + r.item.monthly, 0);
  return { paidMonthly: R2(paid), totalMonthly: R2(total), share: total > 0 ? Math.min(1, paid / total) : 0, covered: rows.filter((r) => r.status === 'covered').length, count: rows.length };
}

// ---------- marcos: a escada ----------

export interface Milestone {
  /** 1 a MILESTONE_STEPS */
  step: number;
  /** O item que este degrau passa a cobrir por inteiro (os anteriores da escada também ficam cobertos) */
  item: EarningsItem;
  /** O item já está pago em parte hoje */
  wasPartial: boolean;
  /** Quanto falta por mês até este item, cumulativo */
  gapMonthly: number;
  /** US$ a mais no Liquid que cobriria o degrau: gapMonthly × 12 ÷ APY */
  extra: number;
  /** O mesmo, arredondado para cima (dezena abaixo de US$ 10 mil; centena acima): ainda cobre */
  extraRounded: number;
  text: string;
  why: string;
}

export type Milestones =
  | {
    kind: 'ladder';
    /** APY médio ponderado dos cofres Liquid de hoje (%) */
    apy: number;
    /** Valor nos cofres Liquid com APY hoje */
    liquidValue: number;
    steps: Milestone[];
  }
  /** no_liquid: nada rendendo no Liquid (ou sem APY informado); all_covered: os ganhos já cobrem tudo; no_items: nada para cobrir */
  | { kind: 'no_liquid' | 'all_covered' | 'no_items'; text: string };

/**
 * O valor dos marcos e das metas como a tela mostra (com "≈"): para cima, em centenas, no mínimo US$ 100. Um APY que
 * varia não sustenta US$ 1.590; para cima, o valor ainda cobre. A tela, o resumo para a IA e o npm run earnings usam este.
 */
export const milestoneApprox = (extra: number): number => (extra > 0 ? Math.max(100, Math.ceil((extra - 1e-9) / 100) * 100) : 0);

/**
 * O APY médio do grupo ponderado pelo valor, sem o arredondamento de 2 casas que a tela mostra (avgApy). A conta dos
 * marcos e das metas usa este: com o APY arredondado para cima, o valor "≈" podia ficar uns dólares curto.
 */
export function exactApy(g: YieldGroup): number {
  const value = g.holdings.reduce((s, h) => s + h.value, 0);
  // grupo montado sem as linhas (só o valor e o APY médio): vale o médio informado
  return value > 0 ? g.holdings.reduce((s, h) => s + h.value * h.apy, 0) / value : g.avgApy;
}

/** Arredonda para cima: dezena abaixo de US$ 10 mil, centena acima */
const ceilFriendly = (x: number) => {
  const step = x < 10000 ? 10 : 100;
  return Math.ceil((x - 1e-9) / step) * step;
};

/**
 * Para os próximos MILESTONE_STEPS itens ainda não cobertos (na ordem da alocação), o valor a mais no Liquid que os
 * cobriria, cumulativo, ao APY médio ponderado dos cofres Liquid de hoje. O cashback fica constante: não existe marco
 * de gasto. Sem nada rendendo no Liquid, não há marco.
 */
export function milestoneLadder(allocation: Allocation, earningsMonthly: number, liquid: YieldGroup, tr: Tr): Milestones {
  if (!allocation.rows.length) return { kind: 'no_items', text: tr('Nothing recurring to cover yet.', 'Ainda não há recorrências para cobrir.') };
  const firstOpen = allocation.rows.findIndex((r) => r.status !== 'covered');
  if (firstOpen < 0) {
    return {
      kind: 'all_covered',
      text: tr(
        `Your estimated earnings already cover every item, with ${usd(allocation.leftoverMonthly)} a month left over.`,
        `Os ganhos estimados já cobrem todos os itens, com ${usd(allocation.leftoverMonthly)} de sobra por mês.`,
      ),
    };
  }
  if (!(liquid.value > 0) || !(liquid.avgApy > 0)) {
    return { kind: 'no_liquid', text: tr('No balance earning in Liquid today.', 'Sem saldo rendendo no Liquid hoje.') };
  }
  const apy = exactApy(liquid);
  let cumulative = allocation.rows.slice(0, firstOpen).reduce((s, r) => s + r.item.monthly, 0);
  const steps: Milestone[] = [];
  for (const row of allocation.rows.slice(firstOpen, firstOpen + MILESTONE_STEPS)) {
    cumulative += row.item.monthly;
    const gap = Math.max(0, cumulative - earningsMonthly);
    const extra = (gap * 12 * 100) / apy;
    const rounded = Math.max(0, ceilFriendly(extra));
    const step = steps.length + 1;
    const wasPartial = row.status === 'partial';
    const name = row.item.name;
    steps.push({
      step,
      item: row.item,
      wasPartial,
      gapMonthly: R2(gap),
      extra: R2(extra),
      extraRounded: rounded,
      text: wasPartial
        ? tr(
          `With ${usd0(rounded)} more earning in Liquid, at today’s APY, your earnings would also cover all of ${name}.`,
          `Com mais ${usd0(rounded)} rendendo no Liquid, ao APY de hoje, os ganhos cobririam também ${name} por inteiro.`,
        )
        : tr(
          `With ${usd0(rounded)} more earning in Liquid, at today’s APY, your earnings would also cover ${name}.`,
          `Com mais ${usd0(rounded)} rendendo no Liquid, ao APY de hoje, os ganhos cobririam também ${name}.`,
        ),
      why: tr(
        `${usd(gap)} a month short through ${name}${step > 1 ? ' (cumulative: it includes the steps before)' : ''}. ${usd(gap)} × 12 ÷ ${pct(apy, 2)} = ${usd(extra)}, rounded up to ${usd0(rounded)}. Cashback stays as it is.`,
        `Faltam ${usd(gap)} por mês até ${name}${step > 1 ? ' (cumulativo: inclui os degraus anteriores)' : ''}. ${usd(gap)} × 12 ÷ ${pct(apy, 2)} = ${usd(extra)}, arredondado para cima: ${usd0(rounded)}. O cashback fica como está.`,
      ),
    });
  }
  return { kind: 'ladder', apy, liquidValue: liquid.value, steps };
}

// ---------- metas de cobertura: quanto no Liquid cobriria 50%, 75% e 100% ----------

/** As frações do custo das recorrências que a tela e o resumo mostram */
export const COVERAGE_TARGETS = [0.5, 0.75, 1] as const;

export interface CoverageTarget {
  /** Fração do custo por mês das recorrências incluídas: 0.5, 0.75, 1 */
  share: number;
  /** Ganhos por mês que pagam essa fração (share × custo) */
  earningsMonthly: number;
  /** Os ganhos de hoje já pagam essa fração */
  reached: boolean;
  /** US$ a mais no Liquid que cobriria a fração, ao APY médio de hoje: falta × 12 ÷ APY (0 se já cobre) */
  extra: number;
  /** O que haveria no Liquid: o de hoje + extra */
  liquidTotal: number;
  /** Para a tela, com "≈": a mais e o total, para cima, em centenas (milestoneApprox) */
  approxExtra: number;
  approxTotal: number;
  /** Itens pagos inteiros com esses ganhos, na ordem da alocação */
  coveredCount: number;
  text: string;
}

export type CoverageTargets =
  | {
    kind: 'targets';
    /** APY médio ponderado dos cofres Liquid de hoje (%) */
    apy: number;
    /** O que há hoje nos cofres Liquid com APY */
    liquidValue: number;
    /** Custo por mês das recorrências incluídas: a base dos 50%, 75% e 100% */
    costMonthly: number;
    targets: CoverageTarget[];
  }
  /** no_items: nada para cobrir; no_liquid: nada rendendo no Liquid (sem APY, não há conta) */
  | { kind: 'no_items' | 'no_liquid'; text: string };

/**
 * Quanto precisaria haver no Liquid para os ganhos pagarem 50%, 75% e 100% do custo por mês das recorrências
 * incluídas, ao APY médio de hoje dos cofres Liquid, com o cashback como está. A conta é a dos marcos: a falta por mês
 * × 12 ÷ APY. Como a alocação paga em sequência (o item que não cabe inteiro fica em parte), os ganhos pagam
 * min(ganhos, custo): a fração paga é ganhos ÷ custo. Um cenário, nunca uma meta sugerida.
 */
export function coverageTargets(allocation: Allocation, earningsMonthly: number, liquid: YieldGroup, tr: Tr, shares: readonly number[] = COVERAGE_TARGETS): CoverageTargets {
  const cost = allocation.totalMonthly;
  if (!allocation.rows.length || !(cost > 0)) return { kind: 'no_items', text: tr('Nothing recurring to cover yet.', 'Ainda não há recorrências para cobrir.') };
  const apy = exactApy(liquid);
  const hasLiquid = liquid.value > 0 && apy > 0;
  const covered = (earnings: number) => {
    let left = earnings + EPS;
    let n = 0;
    for (const r of allocation.rows) {
      if (r.item.monthly > left) break;
      left -= r.item.monthly;
      n++;
    }
    return n;
  };
  const targets: CoverageTarget[] = [];
  for (const share of shares) {
    const need = R2(cost * share);
    const reached = earningsMonthly >= need - EPS;
    if (!reached && !hasLiquid) continue;
    const extra = reached ? 0 : ((need - earningsMonthly) * 12 * 100) / apy;
    const total = liquid.value + extra;
    const approxExtra = milestoneApprox(extra);
    const approxTotal = reached ? R2(liquid.value) : Math.max(100, Math.ceil((total - 1e-9) / 100) * 100);
    const label = pct(share * 100);
    targets.push({
      share,
      earningsMonthly: need,
      reached,
      extra: R2(extra),
      liquidTotal: R2(total),
      approxExtra,
      approxTotal,
      coveredCount: covered(reached ? earningsMonthly : need),
      text: reached
        ? tr(`${label}: your earnings already cover it today.`, `${label}: os ganhos já cobrem hoje.`)
        : tr(
          `${label} (${usd(need)} a month): with ≈ ${usd0(approxTotal)} in Liquid, ≈ ${usd0(approxExtra)} more than today, at today’s APY.`,
          `${label} (${usd(need)} por mês): com ≈ ${usd0(approxTotal)} no Liquid, ≈ ${usd0(approxExtra)} a mais que hoje, ao APY de hoje.`,
        ),
    });
  }
  // sem Liquid, só as metas já cobertas sairiam: sem APY, a conta das outras não existe
  if (targets.length < shares.length) {
    return { kind: 'no_liquid', text: tr('No balance earning in Liquid today, so there’s no APY to work these out.', 'Sem saldo rendendo no Liquid hoje: não há APY para fazer esta conta.') };
  }
  return { kind: 'targets', apy, liquidValue: R2(liquid.value), costMonthly: R2(cost), targets };
}

// ---------- o todo ----------

export interface EarningsSource {
  /** 'vault:<símbolo>' para cada cofre Liquid, 'other-apy' para o grupo dos outros, 'cashback' */
  id: string;
  kind: 'vault' | 'other' | 'cashback';
  /** Símbolo do cofre, "Outros com APY" ou "Cashback", no idioma pedido */
  label: string;
  /** O nome do cofre ("USD Yield"); os ativos do grupo "outros" ("weETH, eBTC"); a taxa no cashback ("1,5%") */
  detail?: string;
  monthly: number;
  annual: number;
  /** Fração dos ganhos (0–1) */
  share: number;
}

export interface EarningsTexts {
  /** "Seus ganhos cobrem 10 de 13 assinaturas…", por mês e por ano */
  headline: Record<EarningsPeriod, string>;
  /** O aviso fixo, ao lado do selo: "Estimativa · o APY varia · não é recomendação" */
  note: string;
  /** De onde vem a taxa de cashback: a tabela do plano (com a frase neutra sobre o plano), a própria ou a observada */
  rate: string;
  /** A taxa observada nos resgates, para comparar: a conta, ou por que ainda não dá para medir */
  observed: string;
  /** De onde vem a base de gasto */
  base: string;
  /** Só o motivo por que a taxa observada não deu (um trecho de frase); ausente quando deu */
  observedFailure?: string;
  /** Rótulos e a conta do recibo */
  receipt: {
    /** "Cashback do resto do cartão" */
    restLabel: string;
    /** "US$ 3.935,24 por mês: a base menos os itens acima"; vazio sem resto */
    restDetail: string;
  };
  /** As contas, para os "por quê?"; `receipt` explica o cashback por item e o resto do cartão */
  why: { sources: string; cashback: string; allocation: string; milestones: string; receipt: string; targets: string };
}

/**
 * A conta de somar do topo da tela, como um recibo:
 *   itens (custo → cashback ≈) · cashback dos itens · cashback do resto do cartão · Liquid por cofre (saldo, APY, por mês)
 *   · outros com APY · = ganhos por mês → "já pagam N de M".
 * Fecha no centavo: itemsCashback + rest = cashback; Σ liquid.holdings + other + cashback = total. Tudo o que vem de
 * APY e de cashback é Estimativa.
 */
export interface EarningsReceipt {
  /** As linhas dos itens incluídos, na ordem da alocação (as mesmas de allocation.rows): custo, cashback do item, status */
  rows: AllocationRow[];
  /** Custo dos itens incluídos */
  itemsCost: { monthly: number; annual: number };
  /** Σ cashback das linhas dos itens */
  itemsCashback: { monthly: number; annual: number };
  /** Os itens fora da conta (o cashback dos pagos no cartão está no resto) */
  excluded: EarningsItem[];
  /** O resto do gasto no cartão (base − itens incluídos no cartão) e o cashback dele; null sem resto (base "só recorrências") */
  rest: { spendMonthly: number; cashbackMonthly: number; cashbackAnnual: number } | null;
  /** Cashback total (= itemsCashback + rest) */
  cashback: { monthly: number; annual: number };
  /** Os cofres Liquid, um por um: saldo (value), APY e rendimento por mês e por ano; e o total do grupo */
  liquid: YieldGroup;
  /** Os outros ativos com APY (weETH…), numa linha discreta; null sem nenhum */
  other: YieldGroup | null;
  /** Ganhos estimados: cashback + Liquid + outros */
  total: { monthly: number; annual: number };
}

export interface Earnings {
  yield: { liquid: YieldGroup; other: YieldGroup; monthly: number; annual: number };
  /** A conta de somar do topo da tela (recibo), com o cashback por item e o resto do cartão fechando no centavo */
  receipt: EarningsReceipt;
  cashback: CashbackForecast;
  /** As fontes com valor > 0, para o fluxo: cada cofre Liquid, o grupo dos outros com APY e o cashback */
  sources: EarningsSource[];
  /** Ganhos estimados (rendimento + cashback) */
  totalMonthly: number;
  totalAnnual: number;
  /** Todos os itens com preço: os incluídos na ordem da alocação, depois os excluídos */
  items: EarningsItem[];
  allocation: Allocation;
  milestones: Milestones;
  /** Quanto no Liquid cobriria 50%, 75% e 100% do custo das recorrências, ao APY de hoje */
  targets: CoverageTargets;
  /** Recorrências sugeridas (anuidade de nível comprado achada no extrato), ainda fora da conta até a pessoa aceitar */
  suggestions: SuggestedItem[];
  texts: EarningsTexts;
  /** Nada para mostrar: nenhum ganho estimado e nenhuma recorrência */
  empty: boolean;
}

export interface EarningsOptions {
  prefs?: EarningsPrefs;
  /** O relatório da aba Assinaturas (useSubscriptions().report, com as respostas da pessoa); sem ele, o motor calcula */
  report?: SubscriptionReport;
  /** Taxas públicas por plano; padrão: CASHBACK_PLAN_RATES (insights/cashbackPlans.ts, da pesquisa). [] desliga o plano */
  plans?: readonly PlanRate[];
}

function observedFailureText(o: Extract<ObservedRate, { ok: false }>, tr: Tr): string {
  switch (o.reason) {
    case 'dropped_rows': return tr('the connector left rows out of your history, so the totals don’t add up', 'o conector omitiu linhas do histórico e os totais não fecham');
    case 'no_cashback': return tr('there’s no cashback in your history yet', 'ainda não há cashback no histórico');
    case 'pending_only': return tr('your cashback claims are still pending', 'os resgates de cashback ainda estão a confirmar');
    case 'few_claims': return o.count >= OBSERVED_MIN_CLAIMS
      ? tr('all your cashback claims fell on the same day, so it’s unclear which period they pay for', 'os resgates de cashback caíram todos no mesmo dia: não dá para saber de que período eles são')
      : o.count === 1
        ? tr(`there’s only 1 cashback claim (at least ${OBSERVED_MIN_CLAIMS} are needed: claims come in blocks, whenever you choose)`, `há só 1 resgate de cashback (são precisos ${OBSERVED_MIN_CLAIMS}: o resgate vem em bloco, quando você escolhe)`)
        : tr(`there are only ${o.count} cashback claims (at least ${OBSERVED_MIN_CLAIMS} are needed: claims come in blocks, whenever you choose)`, `há só ${o.count} resgates de cashback (são precisos ${OBSERVED_MIN_CLAIMS}: o resgate vem em bloco, quando você escolhe)`);
    case 'short_period': return tr(`the claims cover only ${o.days ?? 0} days (at least ${OBSERVED_MIN_DAYS} are needed)`, `os resgates cobrem só ${o.days ?? 0} dias (são precisos ${OBSERVED_MIN_DAYS})`);
    case 'no_spend': return tr('there’s no card spending in the period the claims cover', 'não há gasto no cartão no período dos resgates');
    case 'implausible': return tr(`the result (${pct((o.rate ?? 0) * 100, 2)}) is too high to be cashback alone`, `o resultado (${pct((o.rate ?? 0) * 100, 2)}) é alto demais para ser só cashback`);
  }
}

const ratePct = (rate: number) => pct(rate * 100, 2);

/** De onde vem a taxa. `inWhy`: dentro do "por quê?", que já abre com o resultado (sem repetir "sobre a base, dá…") */
function rateText(c: CashbackForecast, tr: Tr, inWhy = false): string {
  const o = c.observed;
  const observedLine = o.ok
    ? o.method === 'credits'
      ? tr(
        `Observed rate: ${usd(o.cashback)} in cashback received ÷ ${usd(o.spend)} of card spending from ${dateShort(o.from)} to ${dateShort(o.to)} = ${ratePct(o.rate)}.`,
        `Taxa observada: ${usd(o.cashback)} de cashback recebido ÷ ${usd(o.spend)} de gasto no cartão de ${dateShort(o.from)} a ${dateShort(o.to)} = ${ratePct(o.rate)}.`,
      )
      : tr(
        `Rate observed in your claims: ${usd(o.cashback)} claimed in ${o.count} claims ÷ ${usd(o.spend)} of card spending from ${dateShort(o.from)} to ${dateShort(o.to)} = ${ratePct(o.rate)}.`,
        `Taxa observada nos resgates: ${usd(o.cashback)} resgatados em ${o.count} resgates ÷ ${usd(o.spend)} de gasto no cartão de ${dateShort(o.from)} a ${dateShort(o.to)} = ${ratePct(o.rate)}.`,
      )
    : '';
  const p = c.plan;
  const onBase = p && !inWhy && c.base.monthly !== null && c.rateSource === 'plan'
    ? tr(
      ` On ${usd(c.base.monthly)} a month, that gives ${usd(c.monthly)}, ${ratePct(c.rate ?? 0)} on average${c.unpricedSpend > 0 ? ` (${usd(c.unpricedSpend)} above the last band is left out)` : ''}.`,
      ` Sobre ${usd(c.base.monthly)} por mês, dá ${usd(c.monthly)}, ${ratePct(c.rate ?? 0)} na média${c.unpricedSpend > 0 ? ` (${usd(c.unpricedSpend)} acima da última faixa ficam fora)` : ''}.`,
    )
    : '';
  const planLine = p
    ? tr(
      `Public rates of the ${p.label} plan, from ether.fi (checked on ${dateShort(p.source.checked)}${c.planStale ? '; they may have changed since' : ''}): ${bandsText(p, tr)}.${onBase}${c.planIsDefault ? ` No plan chosen, so ${p.label}, the level everyone starts at.` : ''} ${planDepends(tr)}`,
      `Taxas públicas do plano ${p.label}, da ether.fi (conferidas em ${dateShort(p.source.checked)}${c.planStale ? '; podem ter mudado' : ''}): ${bandsText(p, tr)}.${onBase}${c.planIsDefault ? ` Sem plano escolhido, vale o ${p.label}, o nível em que todo mundo começa.` : ''} ${planDepends(tr)}`,
    )
    : '';
  if (c.rateSource === 'custom') {
    const auto = c.autoRate !== null
      ? tr(
        ` Without it, ${ratePct(c.autoRate)} (${c.autoSource === 'plan' && p ? `${p.label} plan` : 'observed'}).`,
        ` Sem ela, ${ratePct(c.autoRate)} (${c.autoSource === 'plan' && p ? `plano ${p.label}` : 'observada'}).`,
      )
      : '';
    return tr(`Your own rate: ${ratePct(c.rate ?? 0)}.${auto}`, `Taxa própria: ${ratePct(c.rate ?? 0)}.${auto}`);
  }
  if (c.rateSource === 'plan') return planLine;
  if (c.rateSource === 'observed') return observedLine;
  return tr(
    `No cashback rate yet: ${o.ok ? '' : observedFailureText(o, tr)}. You can set your own rate.`,
    `Ainda sem taxa de cashback: ${o.ok ? '' : observedFailureText(o, tr)}. Dá para escolher uma taxa própria.`,
  );
}

/** A frase neutra sobre o plano (decisão do coordenador): as faixas dependem do plano; nada de "chegue ao Luxe" */
const planDepends = (tr: Tr) => tr('Cashback bands depend on your ether.fi plan (Core, Luxe…); check yours in the app.', 'As faixas de cashback dependem do seu plano na ether.fi (Core, Luxe…); confira o seu no app.');

/** A taxa observada nos resgates, ao lado da previsão: a conta, ou por que ainda não dá para medir */
function observedText(c: CashbackForecast, tr: Tr): string {
  const o = c.observed;
  if (!o.ok) return tr(`Rate observed in your claims: can’t be measured yet (${observedFailureText(o, tr)}).`, `Taxa observada nos resgates: ainda não dá para medir (${observedFailureText(o, tr)}).`);
  const line = o.method === 'credits'
    ? tr(
      `Observed rate: ${usd(o.cashback)} in cashback received ÷ ${usd(o.spend)} of card spending from ${dateShort(o.from)} to ${dateShort(o.to)} = ${ratePct(o.rate)}.`,
      `Taxa observada: ${usd(o.cashback)} de cashback recebido ÷ ${usd(o.spend)} de gasto no cartão de ${dateShort(o.from)} a ${dateShort(o.to)} = ${ratePct(o.rate)}.`,
    )
    : tr(
      `Rate observed in your claims: ${usd(o.cashback)} claimed in ${o.count} claims ÷ ${usd(o.spend)} of card spending from ${dateShort(o.from)} to ${dateShort(o.to)} = ${ratePct(o.rate)}.`,
      `Taxa observada nos resgates: ${usd(o.cashback)} resgatados em ${o.count} resgates ÷ ${usd(o.spend)} de gasto no cartão de ${dateShort(o.from)} a ${dateShort(o.to)} = ${ratePct(o.rate)}.`,
    );
  const compare = c.rateSource !== 'observed' && c.observedMonthly !== null
    ? tr(` At that rate, today’s base would give ${usd(c.observedMonthly)} a month.`, ` Nessa taxa, a base de hoje daria ${usd(c.observedMonthly)} por mês.`)
    : '';
  return line + compare;
}

/** A conta do recibo: cashback por item, o resto do cartão, o Liquid por cofre, e que tudo fecha no centavo */
function receiptWhy(r: EarningsReceipt, c: CashbackForecast, tr: Tr): string {
  const base = c.base.monthly ?? 0;
  const rate = base > 0 && c.monthly > 0 ? c.monthly / base : 0;
  const onCard = r.rows.filter((x) => x.item.onCard).reduce((s, x) => s + x.item.monthly, 0);
  const offCard = r.rows.some((x) => !x.item.onCard);
  const vaults = r.liquid.holdings.map((h) => `${h.asset} ${usd(h.value)} × ${pct(h.apy, 2)} ÷ 12 = ${usd(h.monthly)}`).join('; ');
  const parts = [
    rate > 0
      ? tr(
        `Each item’s cashback = its cost × the average cashback rate on the base (${usd(c.monthly)} ÷ ${usd(base)} = ${ratePct(Math.round(rate * 10000) / 10000)}).`,
        `Cashback de cada item = o custo dele × a taxa média do cashback sobre a base (${usd(c.monthly)} ÷ ${usd(base)} = ${ratePct(Math.round(rate * 10000) / 10000)}).`,
      )
      : tr('No cashback estimate, so the items show no cashback.', 'Sem estimativa de cashback, os itens ficam sem cashback.'),
    offCard ? tr('Items not paid with the card earn no cashback.', 'Item que não é pago no cartão não rende cashback.') : '',
    r.rest
      ? tr(
        `Rest of the card = (base ${usd(base)} − items paid with the card ${usd(onCard)}) = ${usd(r.rest.spendMonthly)} a month, at the same rate.`,
        `Resto do cartão = (base ${usd(base)} − itens pagos no cartão ${usd(onCard)}) = ${usd(r.rest.spendMonthly)} por mês, na mesma taxa.`,
      )
      : '',
    r.rest && r.excluded.some((i) => i.onCard)
      ? tr('Excluded items are still paid with the card, so their cashback is in this line.', 'Os itens excluídos continuam pagos no cartão, então o cashback deles está nesta linha.')
      : '',
    rate > 0
      ? tr(
        `Item lines${r.rest ? ' plus the rest' : ''} add up to the cashback total, ${usd(r.cashback.monthly)}: cents are split so the sum closes.`,
        `As linhas dos itens${r.rest ? ' mais o resto' : ''} somam o cashback total, ${usd(r.cashback.monthly)}: os centavos são repartidos para a soma fechar.`,
      )
      : '',
    vaults
      ? tr(`Liquid = what each vault holds × its APY ÷ 12: ${vaults}.`, `Liquid = o que cada cofre tem × o APY dele ÷ 12: ${vaults}.`)
      : tr('No balance earning in Liquid today.', 'Sem saldo rendendo no Liquid hoje.'),
    r.other ? tr(`Other assets with APY: ${usd(r.other.monthly)} a month.`, `Outros ativos com APY: ${usd(r.other.monthly)} por mês.`) : '',
    tr(`Earnings = ${usd(r.total.monthly)} a month (estimate).`, `Ganhos = ${usd(r.total.monthly)} por mês (estimativa).`),
  ];
  return parts.filter(Boolean).join(' ');
}

function baseText(b: SpendBase, tr: Tr): string {
  const partial = b.partial ? tr(' The connector left rows out, so the average may be low.', ' O conector omitiu linhas: a média pode estar abaixo do real.') : '';
  if (b.mode === 'recurring') {
    return tr(
      `Only recurring items paid with the card: ${usd(b.recurring.monthly)} a month (${b.recurring.count}).`,
      `Só as recorrências pagas no cartão: ${usd(b.recurring.monthly)} por mês (${b.recurring.count}).`,
    );
  }
  if (b.card.reason === 'short_history') {
    return tr(
      `Your history has only ${b.card.days} days, too short for a monthly average of card spending.`,
      `O histórico tem só ${b.card.days} dias, pouco para uma média mensal do gasto no cartão.`,
    );
  }
  const manual = (b.manualOnCard > 0
    ? tr(`, plus ${usd(b.manualOnCard)} a month of items you added that are paid with the card`, `, mais ${usd(b.manualOnCard)} por mês de itens que você adicionou e paga no cartão`)
    : '') + (b.lifted && b.monthly !== null
    ? tr(
      `. Your recurring card items add up to more than that, so the base is ${usd(b.monthly)} a month`,
      `. As recorrências pagas no cartão somam mais que isso, então a base é ${usd(b.monthly)} por mês`,
    )
    : '');
  return tr(
    `Average card spending over the last ${b.card.days} days (${dateShort(b.card.from)} to ${dateShort(b.card.to)}), refunds subtracted: ${usd(b.card.spend)} ÷ ${b.card.days} days × ${num(DAYS_PER_MONTH, 2)} days in a month = ${usd(b.card.monthly ?? 0)} a month${manual}.${partial}`,
    `Média do gasto no cartão nos últimos ${b.card.days} dias (${dateShort(b.card.from)} a ${dateShort(b.card.to)}), estornos descontados: ${usd(b.card.spend)} ÷ ${b.card.days} dias × ${num(DAYS_PER_MONTH, 2)} dias do mês = ${usd(b.card.monthly ?? 0)} por mês${manual}.${partial}`,
  );
}

function headline(a: Allocation, earningsMonthly: number, period: EarningsPeriod, tr: Tr): string {
  const n = a.count;
  if (!n) return tr('No recurring items to cover yet.', 'Ainda não há recorrências para cobrir.');
  if (!(earningsMonthly > 0)) {
    return tr(
      'No estimated earnings today: nothing earns a reported APY and there’s no cashback rate.',
      'Sem ganhos estimados hoje: nenhum ativo com APY informado e nenhuma taxa de cashback.',
    );
  }
  const subs = a.allSubscriptions;
  const nounEn = (k: number) => (subs ? (k === 1 ? 'subscription' : 'subscriptions') : k === 1 ? 'item' : 'items');
  const nounPt = (k: number) => (subs ? (k === 1 ? 'assinatura' : 'assinaturas') : k === 1 ? 'item' : 'itens');
  const yearly = period === 'annual';
  const paid = usd(yearly ? a.coveredAnnual : a.coveredMonthly);
  const total = usd(yearly ? a.totalAnnual : a.totalMonthly);
  const per = tr(yearly ? 'a year' : 'a month', yearly ? 'por ano' : 'por mês');
  const c = a.coveredCount;
  if (c === n) {
    const left = usd(yearly ? a.leftoverAnnual : a.leftoverMonthly);
    const allPt = subs ? (n === 1 ? 'a assinatura' : `todas as ${n} assinaturas`) : n === 1 ? 'o item' : `todos os ${n} itens`;
    return tr(
      `Your earnings cover ${n === 1 ? `your 1 ${nounEn(1)}` : `all ${n} ${nounEn(n)}`}: ${total} ${per}, with ${left} left over.`,
      `Seus ganhos cobrem ${allPt}: ${total} ${per}, com ${left} de sobra.`,
    );
  }
  if (c === 0) {
    if (a.partialCount) return tr(`Your earnings cover part of 1 of ${n} ${nounEn(n)}: ${paid} of ${total} ${per}.`, `Seus ganhos cobrem parte de 1 de ${n} ${nounPt(n)}: ${paid} de ${total} ${per}.`);
    const nonePt = subs ? (n === 1 ? 'a assinatura' : `nenhuma das ${n} assinaturas`) : n === 1 ? 'o item' : `nenhum dos ${n} itens`;
    return tr(
      n === 1 ? `Your earnings don’t cover your 1 ${nounEn(1)} yet.` : `Your earnings don’t cover any of the ${n} ${nounEn(n)} yet.`,
      `Seus ganhos ainda não cobrem ${nonePt}.`,
    );
  }
  return a.partialCount
    ? tr(
      `Your earnings cover ${c} of ${n} ${nounEn(n)} in full and part of 1 more: ${paid} of ${total} ${per}.`,
      `Seus ganhos cobrem ${c} de ${n} ${nounPt(n)} por inteiro e parte de mais 1: ${paid} de ${total} ${per}.`,
    )
    : tr(`Your earnings cover ${c} of ${n} ${nounEn(n)}: ${paid} of ${total} ${per}.`, `Seus ganhos cobrem ${c} de ${n} ${nounPt(n)}: ${paid} de ${total} ${per}.`);
}

/**
 * A tela Ganhos inteira: fontes, cashback, recorrências, alocação, marcos e textos no idioma pedido. Os números de
 * rendimento e de cashback são estimativa (a tela põe o selo); o resto é conta sobre o dataset e as preferências.
 * Os textos usam os formatadores de format.ts, no idioma que a tela já acertou (setFormatLocale).
 */
export function buildEarnings(dataset: Dataset, opts: EarningsOptions = {}, locale: Locale = 'en'): Earnings {
  const tr: Tr = (en, pt) => pick(locale, en, pt);
  const prefs = opts.prefs ?? DEFAULT_EARNINGS_PREFS;
  const report = opts.report ?? analyzeSubscriptions(dataset, { knowledge: knowledgeFor(dataset), today: dataset.referenceDate, locale });

  const { liquid, other } = yieldGroups(dataset);
  const yieldMonthly = liquid.monthly + other.monthly;
  const yieldAnnual = liquid.annual + other.annual;
  const found = earningsItems(dataset, report, prefs);
  const unpriced = found.unpriced;
  const cashback = cashbackForecast(dataset, found.items, prefs, opts.plans ?? CASHBACK_PLAN_RATES);
  // o cashback de cada item e o do resto do cartão, em centavos que fecham com o total
  const split = splitCashback(found.items, cashback);
  const items = found.items.map((i) => ({ ...i, cashbackMonthly: split.byKey.get(i.key)?.monthly ?? 0, cashbackAnnual: split.byKey.get(i.key)?.annual ?? 0 }));
  // o total sai das partes já arredondadas: a soma que a tela mostra fecha com as fontes
  const totalMonthly = R2(yieldMonthly + cashback.monthly);
  const totalAnnual = R2(yieldAnnual + cashback.annual);

  const allocation = allocate(items, totalMonthly, { order: prefs.order, locale, unpriced, earningsAnnual: totalAnnual });
  const receipt: EarningsReceipt = {
    rows: allocation.rows,
    itemsCost: { monthly: allocation.totalMonthly, annual: allocation.totalAnnual },
    itemsCashback: {
      monthly: R2(allocation.rows.reduce((s, r) => s + r.item.cashbackMonthly, 0)),
      annual: R2(allocation.rows.reduce((s, r) => s + r.item.cashbackAnnual, 0)),
    },
    excluded: allocation.excluded,
    rest: split.rest,
    cashback: { monthly: cashback.monthly, annual: cashback.annual },
    liquid,
    other: other.holdings.length ? other : null,
    total: { monthly: totalMonthly, annual: totalAnnual },
  };
  const milestones = milestoneLadder(allocation, totalMonthly, liquid, tr);
  const targets = coverageTargets(allocation, totalMonthly, liquid, tr);

  const share = (m: number) => (totalMonthly > 0 ? m / totalMonthly : 0);
  const sources: EarningsSource[] = [
    ...liquid.holdings.map((h) => ({
      id: `vault:${h.asset}`, kind: 'vault' as const, label: h.asset, ...(h.name ? { detail: h.name } : {}), monthly: h.monthly, annual: h.annual, share: share(h.monthly),
    })),
    ...(other.monthly > 0
      ? [{
        id: 'other-apy', kind: 'other' as const, label: tr('Other assets with APY', 'Outros ativos com APY'),
        detail: other.holdings.map((h) => h.asset).join(', '), monthly: R2(other.monthly), annual: R2(other.annual), share: share(other.monthly),
      }]
      : []),
    ...(cashback.monthly > 0
      ? [{ id: 'cashback', kind: 'cashback' as const, label: 'Cashback', detail: ratePct(cashback.rate ?? 0), monthly: cashback.monthly, annual: cashback.annual, share: share(cashback.monthly) }]
      : []),
  ].filter((s) => s.monthly > 0);

  const holdingsLine = [...liquid.holdings, ...other.holdings]
    .map((h) => `${h.asset} ${usd(h.value)} × ${pct(h.apy, 2)} ÷ 12 = ${usd(h.monthly)}`)
    .join('; ');
  // pelas faixas do plano, base × taxa média não fecha no centavo: a conta diz que são as faixas
  const byBands = cashback.rateSource === 'plan' && Boolean(cashback.plan?.bands?.length);
  const cashLine = cashback.rate === null || cashback.base.monthly === null
    ? tr('Cashback: no estimate (no rate or no base).', 'Cashback: sem estimativa (falta a taxa ou a base).')
    : byBands
      ? tr(
        `Cashback = the ${cashback.plan!.label} plan’s bands on the base of ${usd(cashback.base.monthly)} a month = ${usd(cashback.monthly)} a month (${ratePct(cashback.rate)} on average).`,
        `Cashback = as faixas do plano ${cashback.plan!.label} sobre a base de ${usd(cashback.base.monthly)} por mês = ${usd(cashback.monthly)} por mês (${ratePct(cashback.rate)} na média).`,
      )
      : tr(
        `Cashback = base × rate = ${usd(cashback.base.monthly)} × ${ratePct(cashback.rate)} = ${usd(cashback.monthly)} a month.`,
        `Cashback = base × taxa = ${usd(cashback.base.monthly)} × ${ratePct(cashback.rate)} = ${usd(cashback.monthly)} por mês.`,
      );
  const why = {
    sources: [
      holdingsLine
        ? tr(
          `Yield = value × APY ÷ 12 for each asset with a reported APY, at today’s balance and APY: ${holdingsLine}. It stays in the asset’s value and doesn’t arrive as cash; APY changes.`,
          `Rendimento = valor × APY ÷ 12 de cada ativo com APY informado, no saldo e no APY de hoje: ${holdingsLine}. Ele fica no valor do ativo e não chega como dinheiro; o APY muda.`,
        )
        : tr('No asset reports an APY today.', 'Nenhum ativo informa APY hoje.'),
      // o APY do liquidETH, do weETH e do liquidBTC é medido em ETH ou BTC: em US$, o preço pesa mais que o rendimento
      [...liquid.holdings, ...other.holdings].some((h) => /eth|btc/i.test(h.asset))
        ? tr('In ETH and BTC assets, the APY is paid in the asset itself, so the US$ figure assumes today’s price.', 'Nos ativos de ETH e BTC, o APY rende no próprio ativo: o valor em US$ supõe o preço de hoje.')
        : '',
      cashLine,
      tr(`Total ≈ ${usd(totalMonthly)} a month, ${usd(totalAnnual)} a year.`, `Total ≈ ${usd(totalMonthly)} por mês, ${usd(totalAnnual)} por ano.`),
    ].filter(Boolean).join(' '),
    cashback: [
      cashLine,
      baseText(cashback.base, tr),
      rateText(cashback, tr, true),
      // com a taxa própria, a frase do plano não aparece no rateText: ela vale para todo "por quê?" do cashback
      cashback.rateSource === 'plan' ? '' : planDepends(tr),
      tr(
        'Some purchases don’t earn cashback (cash withdrawals, transfers, gambling and others, by merchant code). The connector doesn’t send that code, so every card purchase counts as eligible here. Extras such as Category Cashback and promotions aren’t in the forecast.',
        'Algumas compras não rendem cashback (saque, transferência, apostas e outras, pelo código do estabelecimento). O conector não manda esse código, então aqui toda compra no cartão conta como elegível. Extras como o Category Cashback e promoções não entram na previsão.',
      ),
      tr(
        `Cashback is paid in ${CASHBACK_PAYOUT.token}${CASHBACK_PAYOUT.variablePrice ? ', so its value in US$ moves with the token price' : ''}. It stays locked for ${CASHBACK_PAYOUT.lockDays} days after the purchase settles, and you claim it by hand, from ${usd0(CASHBACK_PAYOUT.minClaimUsd)}.`,
        `O cashback é pago em ${CASHBACK_PAYOUT.token}${CASHBACK_PAYOUT.variablePrice ? ', e o valor em US$ muda com o preço do token' : ''}. Ele fica travado ${CASHBACK_PAYOUT.lockDays} dias depois de a compra liquidar, e o resgate é manual, a partir de ${usd0(CASHBACK_PAYOUT.minClaimUsd)}.`,
      ),
      observedText(cashback, tr),
      cashback.observed.ok && cashback.observed.method === 'claims'
        ? tr(
          `A claim pays what was built up and unlocked since the previous one, so spending is counted up to ${CLAIM_LAG_DAYS} days before each claim (about 2 days to settle plus the ${CASHBACK_PAYOUT.lockDays}-day lock); pending claims don’t count. A claim’s US$ value also carries the change in the token price between earning and claiming.`,
          `Um resgate paga o que se acumulou e destravou desde o anterior, então o gasto conta até ${CLAIM_LAG_DAYS} dias antes de cada resgate (uns 2 dias até liquidar mais a trava de ${CASHBACK_PAYOUT.lockDays}); resgate a confirmar não conta. O valor em US$ do resgate também carrega a variação do preço do token entre ganhar e resgatar.`,
        )
        : '',
    ].filter(Boolean).join(' '),
    allocation: [
      allocation.order === 'cheapest'
        ? tr('Cheapest first, so as many items as possible are paid in full.', 'Do mais barato ao mais caro, para pagar inteiros o maior número de itens.')
        : tr('In the order you set.', 'Na ordem que você fixou.'),
      tr(
        'Each item takes earnings until it’s paid in full; the next one gets what’s left. Yearly items count as their price ÷ 12.',
        'Cada item recebe ganhos até ficar pago inteiro; o seguinte fica com o que sobra. Item anual conta como preço ÷ 12.',
      ),
      tr(
        `Earnings = yield ${usd(R2(yieldMonthly))} + cashback ${usd(cashback.monthly)} = ${usd(totalMonthly)} a month.`,
        `Ganhos = rendimento ${usd(R2(yieldMonthly))} + cashback ${usd(cashback.monthly)} = ${usd(totalMonthly)} por mês.`,
      ),
      allocation.excluded.length
        ? tr(`${allocation.excluded.length} excluded ${allocation.excluded.length === 1 ? 'item stays' : 'items stay'} out.`, `${allocation.excluded.length === 1 ? '1 item excluído fica' : `${allocation.excluded.length} itens excluídos ficam`} fora.`)
        : '',
      unpriced.length
        ? tr(`${unpriced.length} ${unpriced.length === 1 ? 'item without a known price stays' : 'items without a known price stay'} out.`, `${unpriced.length === 1 ? '1 item sem preço conhecido fica' : `${unpriced.length} itens sem preço conhecido ficam`} fora.`)
        : '',
    ].filter(Boolean).join(' '),
    milestones: milestones.kind === 'ladder'
      ? tr(
        `Extra in Liquid = monthly gap × 12 ÷ APY. The gap adds up from step to step: each one includes the ones before. APY = your Liquid vaults’ average weighted by value (${pct(milestones.apy, 2)} on ${usd0(milestones.liquidValue)}), today. Cashback stays as it is. A scenario, not a recommendation: APY changes.`,
        `A mais no Liquid = falta por mês × 12 ÷ APY. A falta se soma de degrau em degrau: cada um inclui os anteriores. APY = média dos seus cofres Liquid ponderada pelo valor (${pct(milestones.apy, 2)} sobre ${usd0(milestones.liquidValue)}), hoje. O cashback fica como está. É um cenário, não uma recomendação: o APY muda.`,
      )
      : milestones.text,
    receipt: receiptWhy(receipt, cashback, tr),
    targets: targets.kind === 'targets'
      ? tr(
        `Earnings needed = share × the monthly cost of the items in the count (${usd(targets.costMonthly)}). In Liquid = today’s ${usd(targets.liquidValue)} + (earnings needed − today’s earnings ${usd(totalMonthly)}) × 12 ÷ APY (${pct(targets.apy, 2)}, your Liquid vaults’ average weighted by value). Rounded up to the hundred. Cashback stays as it is. A scenario, not a recommendation: APY changes.`,
        `Ganhos necessários = fração × o custo por mês dos itens da conta (${usd(targets.costMonthly)}). No Liquid = os ${usd(targets.liquidValue)} de hoje + (ganhos necessários − ganhos de hoje, ${usd(totalMonthly)}) × 12 ÷ APY (${pct(targets.apy, 2)}, a média dos seus cofres Liquid ponderada pelo valor). Arredondado para cima, na centena. O cashback fica como está. É um cenário, não uma recomendação: o APY muda.`,
      )
      : targets.text,
  };

  return {
    yield: { liquid, other, monthly: R2(yieldMonthly), annual: R2(yieldAnnual) },
    receipt,
    cashback,
    sources,
    totalMonthly,
    totalAnnual,
    items: [...allocation.rows.map((r) => r.item), ...allocation.excluded],
    allocation,
    milestones,
    targets,
    // o que o motor de assinaturas já achou como recorrência (duas cobranças ou mais) não volta como sugestão
    suggestions: membershipSuggestions(dataset, prefs).filter((s) => !items.some((i) => i.origin !== 'manual' && /ether\.?\s?fi/i.test(i.name) && new RegExp(`\\b${s.plan}\\b`, 'i').test(i.name))),
    texts: {
      headline: { monthly: headline(allocation, totalMonthly, 'monthly', tr), annual: headline(allocation, totalMonthly, 'annual', tr) },
      note: tr('Estimate · APY varies · not a recommendation', 'Estimativa · o APY varia · não é recomendação'),
      rate: rateText(cashback, tr),
      observed: observedText(cashback, tr),
      base: baseText(cashback.base, tr),
      ...(cashback.observed.ok ? {} : { observedFailure: observedFailureText(cashback.observed, tr) }),
      receipt: {
        restLabel: tr('Cashback on the rest of your card spending', 'Cashback do resto do cartão'),
        restDetail: receipt.rest
          ? tr(`${usd(receipt.rest.spendMonthly)} a month: the base minus the items above`, `${usd(receipt.rest.spendMonthly)} por mês: a base menos os itens acima`)
          : '',
      },
      why,
    },
    empty: !(totalMonthly > 0) && !items.length && !unpriced.length,
  };
}
