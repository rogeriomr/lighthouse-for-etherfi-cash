// As preferências da tela Ganhos (taxa escolhida, base, itens digitados à mão, exclusões, ordem e a alternância mensal
// ou anual): só neste navegador, em lighthouse:v1:earnings-prefs. "Esquecer tudo neste navegador" apaga a chave e a tela
// volta ao padrão na hora (syncedStore); outra aba recebe pelo evento 'storage'.
import { useSyncExternalStore } from 'react';
import { DEFAULT_EARNINGS_PREFS, validateEarningsPrefs, type EarningsPrefs } from '../lib/earnings';
import { KEYS, syncedStore } from '../lib/storage';

const store = syncedStore<EarningsPrefs>(KEYS.earnings, DEFAULT_EARNINGS_PREFS, validateEarningsPrefs);

/**
 * As preferências e o jeito de gravar. Grave sempre um objeto novo, montado com os ajudantes de lib/earnings.ts
 * (toggleExcluded, upsertManual, removeManual, moveInOrder): a gravação passa pela mesma validação da leitura.
 */
export function useEarningsPrefs(): [EarningsPrefs, (next: EarningsPrefs) => void] {
  const prefs = useSyncExternalStore(store.subscribe, store.snapshot, () => DEFAULT_EARNINGS_PREFS);
  return [prefs, saveEarningsPrefs];
}

/** Grava depois de validar; o que a validação recusar inteiro volta ao padrão. */
export function saveEarningsPrefs(next: EarningsPrefs) {
  store.save(validateEarningsPrefs(next) ?? DEFAULT_EARNINGS_PREFS);
}
