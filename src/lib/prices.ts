// Candles para os gráficos da tela Empréstimo: a API pública da Coinbase Exchange, a única chamada do app para fora da
// ether.fi. Só roda depois de a pessoa ligar ("Mostrar os gráficos"), e só pede os candles de um par público (ETH-USD,
// BTC-USD…): nada da conta vai junto (sem cookie, sem referrer, sem identificador). A resposta é validada vela a vela.

import { KEYS, readSession, writeSession } from './storage.ts';

export const PRICE_HOST = 'https://api.exchange.coinbase.com';
export const PRICE_SOURCE_URL = 'https://exchange.coinbase.com/';
export const PRICE_SOURCE_NAME = 'Coinbase Exchange';

export type PriceRange = '1M' | '3M' | '6M';
export const PRICE_RANGES: readonly PriceRange[] = ['1M', '3M', '6M'];
/** Vela de 6 h no 1M (120 velas); diária no 3M e no 6M. Uma busca de até 300 velas por tamanho de vela. */
const RANGE: Record<PriceRange, { granularity: 21600 | 86400; count: number }> = {
  '1M': { granularity: 21600, count: 120 },
  '3M': { granularity: 86400, count: 90 },
  '6M': { granularity: 86400, count: 180 },
};

export interface Candle {
  /** ms desde 1970 (abertura da vela) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface CandleSeries {
  product: string;
  range: PriceRange;
  candles: Candle[];
  /** Quando a série foi buscada (ms) */
  fetchedAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const MAX = 300;

/**
 * As velas da Coinbase ([tempo em s, mínima, máxima, abertura, fechamento, volume]): só as com números finitos e
 * positivos e mínima ≤ abertura, fechamento ≤ máxima, em ordem de tempo, sem tempo repetido. null com menos de 2.
 */
export function validateCandles(raw: unknown): Candle[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Candle[] = [];
  for (const row of raw.slice(0, MAX * 2)) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const [t, l, h, o, c] = row;
    const nums = [t, l, h, o, c];
    if (!nums.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) continue;
    if (l > Math.min(o, c) || h < Math.max(o, c) || l > h) continue;
    out.push({ t: t * 1000, o, h, l, c });
  }
  out.sort((a, b) => a.t - b.t);
  const dedup = out.filter((x, i) => i === 0 || out[i - 1].t !== x.t);
  return dedup.length >= 2 ? dedup : null;
}

type Cache = Record<string, { product: string; granularity: number; candles: Candle[]; fetchedAt: number }>;

function validateCache(raw: unknown): Cache | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Cache = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const s = v as { product?: unknown; granularity?: unknown; candles?: unknown; fetchedAt?: unknown };
    const candles = Array.isArray(s.candles)
      ? validateCandles(s.candles.map((x: Candle | null) => [Number(x?.t) / 1000, x?.l, x?.h, x?.o, x?.c]))
      : null;
    if (typeof s.product === 'string' && typeof s.granularity === 'number' && typeof s.fetchedAt === 'number' && candles) {
      out[k] = { product: s.product, granularity: s.granularity, candles, fetchedAt: s.fetchedAt };
    }
  }
  return out;
}

/** As velas de um par público da Coinbase na janela pedida, do cache da sessão quando têm menos de 10 min. */
export async function fetchCandles(product: string, range: PriceRange, signal?: AbortSignal): Promise<CandleSeries> {
  if (!/^[A-Z0-9]{2,10}-USD$/.test(product)) throw new Error('bad product');
  const { granularity, count } = RANGE[range];
  const key = `${product}:${granularity}`;
  const cache = readSession<Cache>(KEYS.prices, {}, validateCache);
  let hit = cache[key];
  if (!hit || Date.now() - hit.fetchedAt >= TTL_MS) {
    const res = await fetch(`${PRICE_HOST}/products/${product}/candles?granularity=${granularity}`, {
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(res.status === 429 ? 'rate_limited' : `http_${res.status}`);
    const candles = validateCandles(await res.json());
    if (!candles) throw new Error('bad_data');
    hit = { product, granularity, candles, fetchedAt: Date.now() };
    writeSession(KEYS.prices, { ...cache, [key]: hit });
  }
  return { product, range, candles: hit.candles.slice(-count), fetchedAt: hit.fetchedAt };
}
