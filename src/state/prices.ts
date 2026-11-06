// Os candles da tela Empréstimo: a série de um ativo por janela (o gráfico) e o último preço de cada ativo de referência
// (os alarmes de preço). Nada é buscado sem a pessoa ligar os gráficos (prefs.prices).
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { fetchCandles, type CandleSeries, type PriceRange } from '../lib/prices';
import { PRICE_PRODUCTS, type Underlying } from '../lib/borrow';

// ---------- o último preço de cada ativo (para os alarmes) ----------

type Latest = Partial<Record<Underlying, number>>;
let latest: Latest = {};
const listeners = new Set<() => void>();

function setLatest(u: Underlying, price: number) {
  if (latest[u] === price) return;
  latest = { ...latest, [u]: price };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** O último preço conhecido nesta aba de cada ativo de referência (só os que o gráfico já buscou). */
export function useLatestPrices(): Latest {
  return useSyncExternalStore(subscribe, () => latest, () => latest);
}

// ---------- a série do gráfico ----------

export type SeriesState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ok'; series: CandleSeries }
  | { status: 'error'; reason: 'rate_limited' | 'network' | 'bad_data' };

type Reason = 'rate_limited' | 'network' | 'bad_data';
interface Loaded {
  key: string;
  result: { ok: true; series: CandleSeries } | { ok: false; reason: Reason };
}

/** As velas de `underlying` na janela pedida; `enabled` false não busca nada. `retry` busca de novo. */
export function useCandles(underlying: Underlying, range: PriceRange, enabled: boolean): { state: SeriesState; retry: () => void } {
  const product = PRICE_PRODUCTS[underlying]?.product;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${product}:${range}:${attempt}`;
  useEffect(() => {
    if (!enabled || !product) return;
    // `cancelled`: desmontou ou trocou de janela, o resultado não interessa mais. O aborto sem cancelamento é o tempo
    // esgotado (15 s), e vira erro de rede
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    fetchCandles(product, range, ctrl.signal)
      .then((series) => {
        if (cancelled) return;
        setLoaded({ key, result: { ok: true, series } });
        const last = series.candles[series.candles.length - 1];
        if (last) setLatest(underlying, last.c);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '';
        setLoaded({ key, result: { ok: false, reason: msg === 'rate_limited' ? 'rate_limited' : msg === 'bad_data' ? 'bad_data' : 'network' } });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, product, range, key, underlying]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  if (!enabled || !product) return { state: { status: 'off' }, retry };
  if (!loaded || loaded.key !== key) return { state: { status: 'loading' }, retry };
  return { state: loaded.result.ok ? { status: 'ok', series: loaded.result.series } : { status: 'error', reason: loaded.result.reason }, retry };
}
