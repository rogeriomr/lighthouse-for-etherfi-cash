// Contas do crédito e do rendimento para os Insights: funções puras, só com o dataset e a tabela pública
// (collateralParams.ts). Nenhuma decide nada pela pessoa: descrevem o mecanismo com os números dela.

import { sourceCame } from '../analytics.ts';
import type { Dataset, Holding, Transaction } from '../types';
import { COLLATERAL, DIRECT_PAY_ASSETS, ETH_BASED, RATE_MODELS, rateRange, REPAY_WITH_VAULT } from './collateralParams.ts';

const R2 = (n: number) => Math.round(n * 100) / 100;
const valueOf = (holdings: Holding[], asset: string) => holdings.filter((h) => h.asset === asset).reduce((s, h) => s + Math.max(0, h.dollarValue), 0);

/** A conta veio (ou não se sabe) e há algo a dizer sobre crédito */
const accountCame = (dataset: Dataset) => sourceCame(dataset, 'get_main_account');
const portfolioCame = (dataset: Dataset) => sourceCame(dataset, 'get_portfolio');

export interface DirectPay {
  usdc: number;
  liquidUsd: number;
  /** USDC + liquidUSD: o que o Direct Pay gasta */
  spendable: number;
  /** O resto do saldo listado: não paga compra direta */
  others: number;
  /** availableBalance da fonte, quando veio */
  spendingPower: number | null;
  /** O poder de compra informado bate com USDC + liquidUSD (±1% ou 1 centavo): a conta se comporta como Direct Pay */
  matchesDirectPay: boolean | null;
}

/** Saldo ≠ poder de compra: no Direct Pay o cartão gasta USDC e depois liquidUSD (ajuda da ether.fi). */
export function directPay(dataset: Dataset): DirectPay | null {
  if (!portfolioCame(dataset)) return null;
  const { holdings } = dataset.portfolio;
  const [usdc, liquidUsd] = DIRECT_PAY_ASSETS.map((a) => R2(valueOf(holdings, a)));
  const spendable = R2(usdc + liquidUsd);
  const listed = R2(holdings.reduce((s, h) => s + Math.max(0, h.dollarValue), 0));
  const power = accountCame(dataset) && dataset.account.availableBalance !== undefined ? dataset.account.availableBalance : null;
  return {
    usdc,
    liquidUsd,
    spendable,
    others: R2(Math.max(0, listed - spendable)),
    spendingPower: power,
    matchesDirectPay: power === null ? null : Math.abs(power - spendable) <= Math.max(0.01, Math.abs(power) * 0.01),
  };
}

export interface LimitUse {
  limit: number;
  borrowed: number;
  /** emprestado ÷ limite × 100 */
  usedPct: number;
  /** limite − emprestado (pode ser negativo) */
  headroom: number;
}

/** Folga até o limite informado. O limite se comporta como o de liquidação (Σ valor × CF), não como o de empréstimo. */
export function limitUse(dataset: Dataset): LimitUse | null {
  if (!accountCame(dataset) || !(dataset.account.creditLimit > 0)) return null;
  const { creditLimit: limit, amountBorrowed: borrowed } = dataset.account;
  return { limit, borrowed, usedPct: R2((borrowed / limit) * 100), headroom: R2(limit - borrowed) };
}

export interface EthDropResult {
  /** Queda simulada (%) */
  dropPct: number;
  /** Limite informado pela fonte */
  reportedLimit: number;
  borrowed: number;
  /** Valor (US$) dos ativos de ETH que garantem o cartão */
  ethValue: number;
  /** Quanto do limite vem deles: Σ valor × CF publicado */
  ethExposure: number;
  /** Limite estimado com a queda: informado − queda × exposição (Estimativa) */
  limit: number;
  /**
   * Queda (%) em que o emprestado alcança o limite estimado. 0 se já alcançou; null sem emprestado, sem exposição a ETH
   * ou além de 100%
   */
  dropToLimit: number | null;
  /** Σ valor × CF de todas as garantias com parâmetro publicado: para conferir com o informado a 0% */
  estimatedLimitAt0: number;
  /** estimado − informado, a 0% */
  diffAt0: number;
  /** Garantias sem parâmetro publicado (ficam fora da estimativa e da exposição) */
  unknownAssets: string[];
}

/**
 * "Se o ETH cair X%": o limite estimado e a queda que levaria o emprestado até ele. Âncora no limite informado (a 0%
 * bate por construção); a inclinação vem do CF publicado de cada ativo de ETH. Tudo Estimativa.
 */
export function simulateEthDrop(dataset: Dataset, dropPct: number): EthDropResult | null {
  const use = limitUse(dataset);
  if (!use || !portfolioCame(dataset)) return null;
  const drop = Math.min(100, Math.max(0, dropPct));
  const collateral = dataset.portfolio.holdings.filter((h) => h.backsSpending && h.dollarValue > 0);
  const unknownAssets = [...new Set(collateral.filter((h) => !COLLATERAL[h.asset]).map((h) => h.asset))];
  const eth = collateral.filter((h) => ETH_BASED.has(h.asset));
  const ethValue = R2(eth.reduce((s, h) => s + h.dollarValue, 0));
  const ethExposure = R2(eth.reduce((s, h) => s + h.dollarValue * (COLLATERAL[h.asset]?.cf ?? 0), 0));
  const estimatedLimitAt0 = R2(collateral.reduce((s, h) => s + h.dollarValue * (COLLATERAL[h.asset]?.cf ?? 0), 0));
  const room = use.limit - use.borrowed;
  let dropToLimit: number | null = null;
  if (use.borrowed > 0 && ethExposure > 0) {
    const d = room <= 0 ? 0 : (room / ethExposure) * 100;
    dropToLimit = d > 100 ? null : R2(d);
  }
  return {
    dropPct: drop,
    reportedLimit: use.limit,
    borrowed: use.borrowed,
    ethValue,
    ethExposure,
    limit: R2(Math.max(0, use.limit - (drop / 100) * ethExposure)),
    dropToLimit,
    estimatedLimitAt0,
    diffAt0: R2(estimatedLimitAt0 - use.limit),
    unknownAssets,
  };
}

export interface BorrowCost {
  borrowed: number;
  market: 'USDC';
  /** Faixa publicada (fração ao ano): mercado ocioso, uso usual (na quebra) e 100% de uso */
  rate: { low: number; usual: number; max: number };
  /** Juros estimados por mês nos três pontos da faixa */
  monthly: { low: number; usual: number; max: number };
  /** Com a taxa que a pessoa digitou (% ao ano), quando houver */
  user?: { rate: number; monthly: number };
}

/**
 * Custo estimado do emprestado pela faixa do modelo publicado do mercado de USDC (o cartão gasta em dólar; o WETH
 * também é emprestável, mas o painel não sabe em qual ativo está a dívida). Juros simples por mês: emprestado × taxa ÷ 12.
 */
export function borrowCost(dataset: Dataset, userRatePct?: number): BorrowCost | null {
  if (!accountCame(dataset) || !(dataset.account.amountBorrowed > 0)) return null;
  const borrowed = dataset.account.amountBorrowed;
  const rate = rateRange(RATE_MODELS.USDC);
  const month = (r: number) => R2((borrowed * r) / 12);
  const validUser = typeof userRatePct === 'number' && Number.isFinite(userRatePct) && userRatePct >= 0 && userRatePct <= 100;
  return {
    borrowed,
    market: 'USDC',
    rate,
    monthly: { low: month(rate.low), usual: month(rate.usual), max: month(rate.max) },
    ...(validUser ? { user: { rate: userRatePct, monthly: month(userRatePct / 100) } } : {}),
  };
}

export interface CollateralYield {
  /** Valor das garantias com APY informado */
  earning: number;
  monthly: number;
  annual: number;
  /** APY médio ponderado (%) */
  apy: number;
  holdings: Holding[];
}

/** Quanto os ativos que garantem o cartão rendem: Σ valor × APY dos que têm APY (Estimativa, como no Portfólio). */
export function collateralYield(dataset: Dataset): CollateralYield | null {
  if (!portfolioCame(dataset)) return null;
  const holdings = dataset.portfolio.holdings.filter((h) => h.backsSpending && (h.apy ?? 0) > 0 && h.dollarValue > 0);
  if (!holdings.length) return null;
  const earning = R2(holdings.reduce((s, h) => s + h.dollarValue, 0));
  const annual = R2(holdings.reduce((s, h) => s + (h.dollarValue * (h.apy ?? 0)) / 100, 0));
  return { earning, annual, monthly: R2(annual / 12), apy: earning > 0 ? R2((annual / earning) * 100) : 0, holdings };
}

export interface VaultRepay {
  asset: keyof typeof REPAY_WITH_VAULT;
  value: number;
  pays: 'USDC' | 'EURC';
  limitKyc: number;
  limitNoKyc: number;
}

/** Tokens de cofre que pagam o emprestado sem vender antes (liquidUSD e liquidRWA pagam USDC; liquidEUR paga EURC). */
export function vaultRepay(dataset: Dataset): VaultRepay[] {
  if (!portfolioCame(dataset)) return [];
  return (Object.keys(REPAY_WITH_VAULT) as (keyof typeof REPAY_WITH_VAULT)[])
    .map((asset) => ({ asset, value: R2(valueOf(dataset.portfolio.holdings, asset)), ...REPAY_WITH_VAULT[asset] }))
    .filter((v) => v.value > 0);
}

/** Estornos (compra com valor negativo) do mês AAAA-MM: em Borrow Mode, estorno não abate o emprestado. */
export function refundsInMonth(dataset: Dataset, month: string): Transaction[] {
  return dataset.transactions.filter((t) => t.type === 'purchase' && t.status !== 'void' && t.amountUsd < 0 && t.date.slice(0, 7) === month);
}
