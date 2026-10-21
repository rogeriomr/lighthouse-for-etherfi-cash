import { useCallback, useSyncExternalStore } from 'react';

/**
 * true enquanto a media query casa (ex.: '(min-width: 640px)'). Serve quando o celular pede outro elemento, e não
 * só outro estilo: barras de 16px viram desenho tocável (div) e o controle acessível passa a ser a trilha de chips.
 */
export function useMedia(query: string, fallback = true): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => fallback);
}
