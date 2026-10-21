// Resumo do período para os Insights: o que puxou a variação do gasto contra o mês anterior, e o que mudou na conta
// desde a importação anterior (com um retrato do saldo guardado no navegador pela tela).

import { isFullMonth, isSpend, monthComparable, monthEvolutions, portfolioSummary, spendSummary } from '../analytics.ts';
import { txInstant } from '../enrich.ts';
import type { Dataset, Transaction } from '../types';
import type { PortfolioSnapshot } from './types';

const R2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;

/** Mudança mínima para entrar na lista: abaixo disso é ruído de centavos */
const MIN_DELTA_USD = 5;
/** Antes deste dia do mês, o mês corrente é curto demais: compara os dois últimos meses inteiros */
const MIN_DAYS_FOR_MTD = 7;

export interface Driver {
  kind: 'category' | 'merchant';
  /** id da categoria (exiba com categoryLabel) ou nome do estabelecimento como o app mostra */
  name: string;
  now: number;
  before: number;
  delta: number;
}

export interface MonthDrivers {
  /** 'mtd' = mês corrente até hoje contra os mesmos dias do anterior; 'full' = os dois últimos meses inteiros */
  mode: 'mtd' | 'full';
  month: string;
  prevMonth: string;
  window: { from: string; to: string; prevFrom: string; prevTo: string };
  total: number;
  prevTotal: number;
  up: Driver[];
  down: Driver[];
  /** Compras do estabelecimento que mais subiu, para o "por quê?" */
  relatedIds: string[];
}

const ymOf = (iso: string) => iso.slice(0, 7);
const addMonths = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

function deltas(kind: Driver['kind'], now: { name: string; total: number }[], before: { name: string; total: number }[]): Driver[] {
  const names = new Set([...now.map((x) => x.name), ...before.map((x) => x.name)]);
  const get = (list: { name: string; total: number }[], name: string) => list.find((x) => x.name === name)?.total ?? 0;
  return [...names].map((name) => {
    const n = get(now, name);
    const b = get(before, name);
    return { kind, name, now: R2(n), before: R2(b), delta: R2(n - b) };
  });
}

/**
 * O que puxou a variação: categorias e estabelecimentos que mais subiram e desceram. A partir do dia 7, o mês corrente
 * até hoje contra os mesmos dias do anterior (como o Início), só se o anterior está inteiro no histórico; antes disso,
 * os dois últimos meses inteiros. Sem par comparável, null.
 */
export function monthDrivers(dataset: Dataset): MonthDrivers | null {
  if (dataset.coverage?.droppedRows) return null;
  const ref = dataset.referenceDate;
  const day = Number(ref.slice(8, 10));
  let mode: MonthDrivers['mode'];
  let month: string;
  let prevMonth: string;
  let window: MonthDrivers['window'];
  const cur = ymOf(ref);
  if (day >= MIN_DAYS_FOR_MTD && monthComparable(dataset, addMonths(cur, -1))) {
    mode = 'mtd';
    month = cur;
    prevMonth = addMonths(cur, -1);
    const prevDay = Math.min(day, lastDay(prevMonth));
    window = {
      from: `${cur}-01T00:00:00Z`, to: `${ref}T23:59:59Z`,
      prevFrom: `${prevMonth}-01T00:00:00Z`, prevTo: `${prevMonth}-${String(prevDay).padStart(2, '0')}T23:59:59Z`,
    };
  } else {
    const full = monthEvolutions(dataset, [], 'en', { anomalies: [] }).filter((m) => isFullMonth(m) && !m.refundHeavy);
    const last = full.at(-1);
    const prev = last && full.find((m) => m.month === addMonths(last.month, -1));
    if (!last || !prev) return null;
    mode = 'full';
    month = last.month;
    prevMonth = prev.month;
    window = {
      from: `${month}-01T00:00:00Z`, to: `${month}-${lastDay(month)}T23:59:59Z`,
      prevFrom: `${prevMonth}-01T00:00:00Z`, prevTo: `${prevMonth}-${lastDay(prevMonth)}T23:59:59Z`,
    };
  }
  const now = spendSummary(dataset, [], window.from, window.to);
  const before = spendSummary(dataset, [], window.prevFrom, window.prevTo);
  if (!now.count && !before.count) return null;
  const all = [...deltas('category', now.byCategory, before.byCategory), ...deltas('merchant', now.byMerchant, before.byMerchant)]
    .filter((d) => Math.abs(d.delta) >= MIN_DELTA_USD);
  const up = all.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta);
  const down = all.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta);
  const topMerchant = up.find((d) => d.kind === 'merchant');
  const relatedIds = topMerchant ? now.rows.filter((t) => t.merchant === topMerchant.name).map((t) => t.id).slice(0, 20) : [];
  return {
    mode, month, prevMonth, window,
    total: R2(now.total), prevTotal: R2(before.total),
    up: [...up.filter((d) => d.kind === 'category').slice(0, 3), ...up.filter((d) => d.kind === 'merchant').slice(0, 3)],
    down: [...down.filter((d) => d.kind === 'category').slice(0, 3), ...down.filter((d) => d.kind === 'merchant').slice(0, 3)],
    relatedIds,
  };
}

/** Média mensal do gasto nos meses inteiros sem estorno pesado: a mesma da Evolução ("Média mensal"). */
export function averageMonthlySpend(dataset: Dataset): { average: number; months: number } | null {
  const full = monthEvolutions(dataset, [], 'en', { anomalies: [] }).filter((m) => isFullMonth(m) && !m.refundHeavy);
  if (!full.length) return null;
  return { average: R2(full.reduce((s, m) => s + m.total, 0) / full.length), months: full.length };
}

// ---------- o retrato entre importações ----------

/** O retrato de agora: saldo da conta (não a soma da lista), emprestado e ativos. null sem o saldo da conta. */
export function makeSnapshot(dataset: Dataset, now: Date = new Date()): PortfolioSnapshot | null {
  const s = portfolioSummary(dataset);
  if (s.totalSource !== 'account' || s.totalPartial) return null;
  const lastTxAt = dataset.transactions.reduce((m, t) => Math.max(m, txInstant(t)), 0);
  return {
    version: 1,
    at: dataset.snapshotAt ?? now.toISOString(),
    totalBalance: s.total,
    borrowed: s.borrowed,
    lastTxAt,
    holdings: dataset.portfolio.holdings.map((h) => ({ asset: h.asset, value: h.dollarValue, ...(h.quantity !== undefined ? { quantity: h.quantity } : {}) })),
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valida o retrato lido do navegador (storage.ts): o que não servir vira undefined. */
export function validateSnapshot(raw: unknown): PortfolioSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))) return undefined;
  if (!finite(r.totalBalance) || !finite(r.borrowed) || !finite(r.lastTxAt) || !Array.isArray(r.holdings)) return undefined;
  const holdings = r.holdings
    .filter((h): h is Record<string, unknown> => Boolean(h) && typeof h === 'object')
    .filter((h) => typeof h.asset === 'string' && finite(h.value))
    .map((h) => ({ asset: h.asset as string, value: h.value as number, ...(finite(h.quantity) ? { quantity: h.quantity } : {}) }));
  return { version: 1, at: r.at, totalBalance: r.totalBalance, borrowed: r.borrowed, lastTxAt: r.lastTxAt, holdings };
}

export interface SinceSnapshot {
  since: string;
  /** Dias entre os dois retratos */
  days: number;
  balanceBefore: number;
  balanceNow: number;
  borrowedBefore: number;
  borrowedNow: number;
  /** Patrimônio líquido (saldo − emprestado): agora − antes */
  netWorthDelta: number;
  spent: number;
  deposits: number;
  withdrawals: number;
  rewards: number;
  /** O que o extrato explica: depósitos − saques + recompensas − compras */
  explained: number;
  /** O resto: variação de preço e rendimento, e o que o extrato não detalha (Estimativa) */
  unexplained: number;
  /** Linhas novas desde o retrato anterior */
  relatedIds: string[];
}

/**
 * O que mudou desde o retrato anterior: compras, depósitos, saques e recompensas das linhas novas; o resto da
 * variação do patrimônio líquido fica como "variação de preço e rendimento estimada". null sem retrato anterior,
 * sem saldo da conta agora ou quando é o mesmo retrato.
 */
export function sinceSnapshot(prev: PortfolioSnapshot | undefined, dataset: Dataset, now: Date = new Date()): SinceSnapshot | null {
  if (!prev) return null;
  const cur = makeSnapshot(dataset, now);
  if (!cur || Date.parse(cur.at) <= Date.parse(prev.at)) return null;
  const rows = dataset.transactions.filter((t) => txInstant(t) > prev.lastTxAt);
  const settled = (pred: (t: Transaction) => boolean) => R2(rows.filter((t) => t.status === 'settled' && pred(t)).reduce((s, t) => s + Math.abs(t.amountUsd), 0));
  const spent = R2(rows.filter(isSpend).reduce((s, t) => s + t.amountUsd, 0));
  const deposits = settled((t) => t.type === 'top_up');
  const withdrawals = settled((t) => t.type === 'withdrawal');
  // o resgate (cashback_claim) é o mesmo dinheiro do crédito (cashback): com os dois no extrato, contar ambos dobra
  // a recompensa. Só os resgates entram quando a fonte não traz os créditos, como no cartão de ganhos (engine.ts).
  const hasAccrual = rows.some((t) => t.status === 'settled' && t.type === 'cashback');
  const rewards = settled((t) => t.type === 'cashback' || t.type === 'referral' || (!hasAccrual && t.type === 'cashback_claim'));
  const explained = R2(deposits - withdrawals + rewards - spent);
  const netWorthDelta = R2(cur.totalBalance - cur.borrowed - (prev.totalBalance - prev.borrowed));
  return {
    since: prev.at,
    days: Math.max(0, Math.round((Date.parse(cur.at) - Date.parse(prev.at)) / DAY)),
    balanceBefore: prev.totalBalance,
    balanceNow: cur.totalBalance,
    borrowedBefore: prev.borrowed,
    borrowedNow: cur.borrowed,
    netWorthDelta,
    spent,
    deposits,
    withdrawals,
    rewards,
    explained,
    unexplained: R2(netWorthDelta - explained),
    relatedIds: rows.map((t) => t.id),
  };
}
