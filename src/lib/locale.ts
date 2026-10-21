// Idioma da interface. O projeto tem só inglês (padrão) e português, então o texto fica lado a lado no código:
// pick(locale, 'Spent', 'Gastei'). Sem dicionário separado, nenhuma tradução fica para trás sem ninguém ver.

export type Locale = 'en' | 'pt';

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALES: { value: Locale; label: string; tag: string }[] = [
  { value: 'en', label: 'EN', tag: 'en-US' },
  { value: 'pt', label: 'PT', tag: 'pt-BR' },
];

export const pick = <T>(locale: Locale, en: T, pt: T): T => (locale === 'pt' ? pt : en);

/** Texto que pode vir nas duas línguas (código) ou numa só (dado local, ex.: pesquisa sobre um estabelecimento) */
export type LocalizedText = string | { en: string; pt: string };

export function localized(text: LocalizedText | undefined, locale: Locale): string | undefined {
  if (text === undefined) return undefined;
  return typeof text === 'string' ? text : text[locale];
}
