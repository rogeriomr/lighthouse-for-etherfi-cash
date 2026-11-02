// A última foto dos ganhos que a pessoa viu, para o "O que mudou desde a sua última visita" da tela Ganhos e o ponto
// no item "Ganhos" do menu. Uma foto para o demo e outra para os dados reais (conectado ou importado: são a mesma
// conta). Só neste navegador, em lighthouse:v1:earnings-seen; "Esquecer tudo" apaga.
import { useSyncExternalStore } from 'react';
import { validateSnapshot, type EarningsSnapshot } from '../lib/earningsChanges';
import { KEYS, syncedStore } from '../lib/storage';

export type SeenScope = 'demo' | 'real';
export type SeenMap = Partial<Record<SeenScope, EarningsSnapshot>>;

const EMPTY: SeenMap = {};

function validateSeen(raw: unknown): SeenMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: SeenMap = {};
  for (const scope of ['demo', 'real'] as const) {
    const s = validateSnapshot(r[scope]);
    if (s) out[scope] = s;
  }
  return out;
}

const store = syncedStore<SeenMap>(KEYS.earningsSeen, EMPTY, validateSeen);

export function useSeenSnapshots(): SeenMap {
  return useSyncExternalStore(store.subscribe, store.snapshot, () => EMPTY);
}

/** Grava a foto vista de um escopo, sem mexer no outro. Não grava de novo a mesma foto. */
export function saveSeen(scope: SeenScope, snap: EarningsSnapshot) {
  const current = store.snapshot();
  if (JSON.stringify(current[scope]) === JSON.stringify(snap)) return;
  store.save({ ...current, [scope]: snap });
}
