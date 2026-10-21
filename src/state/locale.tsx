import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, pick, type Locale } from '../lib/locale';
import { setFormatLocale } from '../lib/format';
import { KEYS, readStore, writeStore } from '../lib/storage';

interface LocaleValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

/** Só para o seletor de idioma: a escolha marcada na hora e se a tela ainda está trocando. */
interface LocaleSwitch {
  selected: Locale;
  switching: boolean;
}

const LocaleContext = createContext<LocaleValue | null>(null);
// contexto separado: marcar o botão na hora não pode re-renderizar quem só lê o idioma (a tela inteira)
const LocaleSwitchContext = createContext<LocaleSwitch | null>(null);

// sem storage ou com valor estranho: fica o padrão
const initialLocale = (): Locale =>
  readStore<Locale>(KEYS.locale, DEFAULT_LOCALE, (raw) => (raw === 'en' || raw === 'pt' ? raw : undefined));

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setState] = useState<Locale>(() => {
    const l = initialLocale();
    setFormatLocale(l);
    return l;
  });
  const [selected, setSelected] = useState<Locale>(locale);
  const [switching, startSwitch] = useTransition();

  const setLocale = useCallback((l: Locale) => {
    // a formatação muda antes do re-render, para nenhum número sair no idioma anterior
    setFormatLocale(l);
    writeStore(KEYS.locale, l);
    setSelected(l);
    // a tela inteira (textos, nomes e análises) troca num render de fundo, em fatias: nada congela,
    // e o botão já mostra a escolha
    startSwitch(() => setState(l));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'pt' ? 'pt-BR' : 'en';
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  const switchValue = useMemo(() => ({ selected, switching }), [selected, switching]);
  return (
    <LocaleContext.Provider value={value}>
      <LocaleSwitchContext.Provider value={switchValue}>{children}</LocaleSwitchContext.Provider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale outside LocaleProvider');
  return ctx;
}

/** Para o seletor EN | PT: `selected` muda no clique, antes de a tela terminar de trocar (`switching`). */
export function useLocaleSwitch(): LocaleSwitch {
  const ctx = useContext(LocaleSwitchContext);
  if (!ctx) throw new Error('useLocaleSwitch outside LocaleProvider');
  return ctx;
}

/** tr('Spent', 'Gastei'): o texto nas duas línguas, lado a lado */
export function useTr() {
  const { locale } = useLocale();
  return useCallback(<T,>(en: T, pt: T): T => pick(locale, en, pt), [locale]);
}
