// Câmbio das compras em reais contra a PTAX de venda do Banco Central (dia da compra). A série vem do `ptax.json`,
// baixado pelo `npm run pull` (Node, API pública do BCB: só datas saem, nenhum dado da pessoa) e importado como os
// outros arquivos. O que se mede é o custo total contra a referência oficial, não "a taxa da ether.fi": a diferença
// junta a margem da bandeira, o horário da cotação e a taxa do cartão.

import type { Dataset, PtaxRate, Transaction } from '../types';
import type { InsightSource } from './types';

export const PTAX_SOURCE: InsightSource = {
  label: 'Banco Central do Brasil · PTAX',
  url: 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/aplicacao',
  checked: '2026-10-19',
};

/** Fim de semana e feriado não têm cotação: vale o último dia útil antes, até este tanto de dias */
const MAX_GAP_DAYS = 4;
/** Mês com menos compras comparadas que isto não ganha cartão (a mediana de 2 compras não diz nada) */
export const FX_MIN_PURCHASES = 5;

const DAY = 86400000;
const R2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** A PTAX do dia ou do último dia útil antes (até MAX_GAP_DAYS); undefined fora da série. */
export function ptaxOn(rates: PtaxRate[], day: string): PtaxRate | undefined {
  const t = Date.parse(`${day}T00:00:00Z`);
  // série ordenada por data: busca binária pelo último dia <= day
  let lo = 0;
  let hi = rates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rates[mid].date <= day) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0) return undefined;
  const r = rates[found];
  return (t - Date.parse(`${r.date}T00:00:00Z`)) / DAY <= MAX_GAP_DAYS ? r : undefined;
}

export interface FxRow {
  t: Transaction;
  ptax: number;
  /** usd × ptax ÷ brl − 1: quanto a mais (fração) a compra custou contra a PTAX do dia */
  cost: number;
  /** US$ debitados − US$ que o mesmo valor em reais daria na PTAX */
  excessUsd: number;
}

export interface FxMonth {
  month: string;
  count: number;
  /** Mediana do custo (fração) */
  medianCost: number;
  /** Σ US$ debitados nas compras comparadas */
  usd: number;
  /** Σ US$ a mais contra a PTAX */
  excessUsd: number;
  rows: FxRow[];
}

export type FxUnavailable = 'not_brl' | 'no_ptax' | 'no_purchases';

export interface FxVsPtax {
  months: FxMonth[];
  /** Compras em reais sem PTAX no período da série */
  unmatched: number;
  from: string;
  to: string;
}

/**
 * Compras liquidadas em BRL (a pendente muda na liquidação; estorno e cancelada ficam fora), cada uma contra a PTAX
 * de venda do dia da compra no relógio local, agregadas por mês. Só com a moeda da casa BRL e a série importada.
 */
export function fxVsPtax(dataset: Dataset): FxVsPtax | { unavailable: FxUnavailable } {
  if (dataset.homeCurrency !== 'BRL') return { unavailable: 'not_brl' };
  const rates = dataset.ptax?.rates;
  if (!rates?.length) return { unavailable: 'no_ptax' };
  const buys = dataset.transactions.filter((t) => t.type === 'purchase' && t.status === 'settled' && t.currency === 'BRL' && t.amount > 0 && t.amountUsd > 0);
  if (!buys.length) return { unavailable: 'no_purchases' };
  const byMonth = new Map<string, FxRow[]>();
  let unmatched = 0;
  for (const t of buys) {
    const p = ptaxOn(rates, t.date.slice(0, 10));
    if (!p) { unmatched++; continue; }
    const row: FxRow = { t, ptax: p.sell, cost: (t.amountUsd * p.sell) / t.amount - 1, excessUsd: t.amountUsd - t.amount / p.sell };
    const ym = t.date.slice(0, 7);
    byMonth.set(ym, [...(byMonth.get(ym) ?? []), row]);
  }
  const months = [...byMonth.entries()]
    .map(([month, rows]) => ({
      month,
      count: rows.length,
      medianCost: median(rows.map((r) => r.cost)),
      usd: R2(rows.reduce((s, r) => s + r.t.amountUsd, 0)),
      excessUsd: R2(rows.reduce((s, r) => s + r.excessUsd, 0)),
      rows: [...rows].sort((a, b) => b.excessUsd - a.excessUsd),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
  return { months, unmatched, from: rates[0].date, to: rates[rates.length - 1].date };
}
