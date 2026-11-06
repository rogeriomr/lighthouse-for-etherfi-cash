// As preferências da tela Empréstimo (ativo e taxas da dívida, os detalhes, as marcas do gráfico, os alarmes, o aceite
// dos candles da Coinbase Exchange e a notificação): só neste navegador, em lighthouse:v1:borrow-prefs. "Esquecer tudo
// neste navegador" apaga a chave e a tela volta ao padrão na hora (syncedStore); outra aba recebe pelo evento 'storage'.
import { useSyncExternalStore } from 'react';
import { DEFAULT_BORROW_PREFS, validateBorrowPrefs, type BorrowPrefs } from '../lib/borrow';
import { KEYS, syncedStore } from '../lib/storage';

const store = syncedStore<BorrowPrefs>(KEYS.borrow, DEFAULT_BORROW_PREFS, validateBorrowPrefs);

export function useBorrowPrefs(): [BorrowPrefs, (next: BorrowPrefs) => void] {
  const prefs = useSyncExternalStore(store.subscribe, store.snapshot, () => DEFAULT_BORROW_PREFS);
  return [prefs, saveBorrowPrefs];
}

/** Grava depois de validar; o que a validação recusar inteiro volta ao padrão. */
export function saveBorrowPrefs(next: BorrowPrefs) {
  store.save(validateBorrowPrefs(next) ?? DEFAULT_BORROW_PREFS);
}

export const borrowPrefsSnapshot = () => store.snapshot();
