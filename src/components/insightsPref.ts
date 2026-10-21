import { useSyncExternalStore } from 'react';
import { syncedStore } from '../lib/storage';

// A preferência da aba AI Insights e a taxa do emprestado que a pessoa digitou: só neste navegador, em lighthouse:v1:*
// ("Esquecer tudo neste navegador" apaga as duas e a aba volta a desligada). Separado de insights.tsx para a navegação
// ler o liga/desliga sem baixar o motor.

interface InsightsPref {
  on: boolean;
  /** quando ligou ou desligou (ISO) */
  at?: string;
  /** versão do texto de consentimento aceito: um modo novo que mande dado para fora sobe a versão e pede de novo */
  consent?: 1;
}

const OFF: InsightsPref = { on: false };
// preferência ausente, ilegível ou de outra versão do consentimento vale "desligado"
const prefStore = syncedStore<InsightsPref>('insights', OFF, (raw) => {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.on !== 'boolean') return undefined;
  return r.on && r.consent !== 1 ? OFF : { on: r.on, at: typeof r.at === 'string' ? r.at : undefined, consent: r.on ? 1 : undefined };
});

/** A aba está ligada? E o jeito de mudar (a navegação e a tela leem o mesmo valor, inclusive entre abas do navegador). */
export function useInsightsOn(): [boolean, (on: boolean) => void] {
  const pref = useSyncExternalStore(prefStore.subscribe, prefStore.snapshot, () => OFF);
  return [pref.on, (on) => prefStore.save(on ? { on: true, at: new Date().toISOString(), consent: 1 } : { on: false, at: new Date().toISOString() })];
}

// a taxa anual do emprestado que a pessoa digitou (o conector não informa): só neste navegador
const rateStore = syncedStore<number | null>('insights-borrow-rate', null, (raw) =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : raw === null ? null : undefined);

export function useBorrowRate(): [number | null, (rate: number | null) => void] {
  const rate = useSyncExternalStore(rateStore.subscribe, rateStore.snapshot, () => null);
  return [rate, rateStore.save];
}

// a mensalidade de um clube (Uber One, iFood Clube…) que a pessoa digitou, na moeda da casa, pelo id do clube
const clubStore = syncedStore<Record<string, number>>('insights-club-prices', {}, (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0 && e[1] < 100000));
});

/** Os preços de clube digitados e o jeito de mudar um (null apaga). */
export function useClubPrices(): [Record<string, number>, (id: string, price: number | null) => void] {
  const prices = useSyncExternalStore(clubStore.subscribe, clubStore.snapshot, () => ({}));
  const set = (id: string, price: number | null) => {
    const next = { ...clubStore.snapshot() };
    if (price === null) delete next[id];
    else next[id] = price;
    clubStore.save(next);
  };
  return [prices, set];
}
