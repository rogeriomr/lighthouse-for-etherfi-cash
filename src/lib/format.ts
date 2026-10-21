import { DEFAULT_LOCALE, LOCALES, type Locale } from './locale.ts';

// Idioma corrente da formatação. O LocaleProvider troca antes de re-renderizar; scripts no Node ficam no padrão.
let locale: Locale = DEFAULT_LOCALE;
let tag = 'en-US';
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

export function setFormatLocale(next: Locale) {
  locale = next;
  tag = LOCALES.find((l) => l.value === next)?.tag ?? 'en-US';
}

export const formatLocale = (): Locale => locale;

// Ano de "hoje" no painel (referenceDate): data de outro ano sai com o ano junto
let todayYear = String(new Date().getFullYear());

export function setFormatToday(day: string) {
  todayYear = day.slice(0, 4);
}

// Fuso em que as datas estão escritas, só para o rótulo (as datas já vêm em hora local: ver enrichDataset)
let zone: string | null = null;

export function setFormatTimeZone(next: string | null) {
  zone = next;
}

function nf(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n:${tag}:${JSON.stringify(opts)}`;
  let f = cache.get(key) as Intl.NumberFormat | undefined;
  if (!f) {
    f = new Intl.NumberFormat(tag, opts);
    cache.set(key, f);
  }
  return f;
}

function df(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d:${tag}:${JSON.stringify(opts)}`;
  let f = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!f) {
    f = new Intl.DateTimeFormat(tag, opts);
    cache.set(key, f);
  }
  return f;
}

export function usd(n: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(n)) return nf({ style: 'currency', currency: 'USD' }).format(0);
  if (opts?.compact && Math.abs(n) >= 1000) return usd0(n);
  return nf({ style: 'currency', currency: 'USD' }).format(n);
}

export function usd0(n: number): string {
  return nf({ style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

/** Valor na moeda informada (R$, €, US$…); código desconhecido cai para "XYZ 1,00". */
export function money(n: number, currency: string, opts?: { compact?: boolean }): string {
  try {
    return nf({ style: 'currency', currency, maximumFractionDigits: opts?.compact ? 0 : 2 }).format(Number.isFinite(n) ? n : 0);
  } catch {
    return `${currency} ${num(n)}`;
  }
}

/** "$1 = R$5.01" (en) / "US$ 1 = R$ 5,01" (pt) a partir do câmbio em USD por unidade local. */
export function fxLabel(usdPerLocal: number, currency: string): string {
  if (!usdPerLocal) return '';
  return `${money(1, 'USD', { compact: true })} = ${money(1 / usdPerLocal, currency)}`;
}

export function num(n: number, digits = 2): string {
  return nf({ maximumFractionDigits: digits }).format(n);
}

export function pct(n: number, digits = 0): string {
  return `${nf({ maximumFractionDigits: digits }).format(n)}%`;
}

// Formatação em UTC de propósito: date já é hora local escrita com Z (enrichDataset), então UTC aqui mostra
// a hora de quem vê e bate com a agregação por dia (t.date.slice(0,10))
const otherYear = (iso: string) => iso.slice(0, 4) !== todayYear;
const withYear = (iso: string): Intl.DateTimeFormatOptions => (otherYear(iso) ? { year: 'numeric' } : {});

// Uma data nunca se parte no fim da linha ("25 de / out."): os espaços de dentro dela viram NBSP
const whole = (s: string) => s.replace(/ /g, '\u00a0');

/** "Oct 17"; de outro ano, "Aug 11, 2025". Dia sem zero à esquerda ("Oct 1", "1 de out."), inteira numa linha */
export function dateShort(iso: string): string {
  return whole(df({ day: 'numeric', month: 'short', ...withYear(iso), timeZone: 'UTC' }).format(new Date(iso)));
}

/** "Oct 17" sem ano, mesmo de outro ano: para listas sob um cabeçalho que já diz o período (ex.: uma viagem) */
export function dateDayMonth(iso: string): string {
  return whole(df({ day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso)));
}

export function dateFull(iso: string): string {
  return whole(df({ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso)));
}

/**
 * Intervalo sem repetir o que é igual ("Oct 1 – 18", "1 – 18 de out."), com ano quando cruza anos
 * ("Aug 11, 2025 – Oct 18, 2026") ou não é do ano corrente
 */
export function dateRange(from: string, to: string): string {
  const year = from.slice(0, 4) !== to.slice(0, 4) || otherYear(to) ? { year: 'numeric' as const } : {};
  const f = df({ day: 'numeric', month: 'short', ...year, timeZone: 'UTC' });
  // cada data fica inteira numa linha ("Oct 1 – 18" não se parte); num intervalo de meses diferentes, a linha pode
  // quebrar antes do "–", nunca depois dele. O "–" permite quebra logo depois mesmo com NBSP em seguida (UAX #14), e a
  // linha nova começaria com um espaço: o WORD JOINER (U+2060) colado ao "–" impede essa quebra
  const s = f.formatRange(new Date(from), new Date(to)).replace(/[ \u2009]/g, '\u00a0');
  return s.replace(/\u00a0–\u00a0/, from.slice(0, 7) === to.slice(0, 7) ? '\u00a0–\u2060\u00a0' : ' –\u2060\u00a0');
}

/** Data e hora com o rótulo do fuso: "Oct 17, 9:57 PM GMT-3" */
export function dateTime(iso: string): string {
  const s = df({ day: 'numeric', month: 'short', ...withYear(iso), hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
  const z = tzLabel(iso);
  return z ? `${s} ${z}` : s;
}

/** Só a hora ("9:57 PM", "21:57"); quem lista horas mostra tzLabel() uma vez no cabeçalho */
export function timeOnly(iso: string): string {
  return df({ hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}
/** Rótulo curto do fuso das datas ("GMT-3" em inglês, "BRT" em português); vazio quando não há fuso definido. */
export function tzLabel(iso?: string): string {
  if (!zone) return '';
  // date é hora de parede: o instante difere por poucas horas, o que só pesa perto da virada do horário de verão
  const parts = df({ timeZone: zone, timeZoneName: 'short' }).formatToParts(iso ? new Date(iso) : new Date());
  // hífen sem quebra (U+2011): "GMT-3" nunca vira "GMT-" / "3" no fim da linha
  return (parts.find((p) => p.type === 'timeZoneName')?.value ?? '').replace(/[-−]/g, '\u2011');
}

export function dayHeading(day: string): string {
  const s = df({ weekday: 'short', day: 'numeric', month: 'short', ...withYear(day), timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Aceita "AAAA-MM", "AAAA-MM-DD" ou ISO completo: só o mês importa
const monthDate = (value: string) => new Date(`${value.slice(0, 7)}-01T12:00:00Z`);

/** Mês curto sem ano ("Oct"), para eixos; listas que cruzam anos usam monthYearLabel */
export function monthLabel(value: string): string {
  return df({ month: 'short', timeZone: 'UTC' }).format(monthDate(value)).replace('.', '');
}

/** "Aug 2025" / "ago de 2025" */
export function monthYearLabel(value: string): string {
  return df({ month: 'short', year: 'numeric', timeZone: 'UTC' }).format(monthDate(value)).replace('.', '');
}

export function monthLabelLong(value: string): string {
  return df({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(monthDate(value));
}

/** Só o nome do mês, sem o ano: "October" / "outubro" */
export function monthName(value: string): string {
  return df({ month: 'long', timeZone: 'UTC' }).format(monthDate(value));
}

export function pctSigned(n: number): string {
  const f = nf({ maximumFractionDigits: 1 }).format(Math.abs(n));
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${f}%`;
}

// Em português "$" sozinho é ambíguo (peso, real?): os formatos compactos levam "US$", com espaço sem quebra
const usdPrefix = () => (locale === 'pt' ? 'US$\u00a0' : '$');

/** Número curto sem moeda: "12.3k" / "12,3 mil", "1.2M" / "1,2 mi"; abaixo de `from`, inteiro */
function compactNum(n: number, from: number): string {
  const a = Math.abs(n);
  const one = nf({ maximumFractionDigits: 1 });
  if (a >= 1_000_000) return `${one.format(a / 1_000_000)}${locale === 'pt' ? '\u00a0mi' : 'M'}`;
  if (a >= from) return `${one.format(a / 1_000)}${locale === 'pt' ? '\u00a0mil' : 'k'}`;
  return nf({ maximumFractionDigits: 0 }).format(a);
}

/** Valor compacto com moeda: "$14.9k" / "US$ 14,9 mil"; até 10 mil, inteiro ("$4,895" / "US$ 4.895") */
export function usdAxis(n: number): string {
  return `${n < 0 ? '−' : ''}${usdPrefix()}${compactNum(n, 10_000)}`;
}

/** Marca de eixo, sem moeda ("2k" / "2 mil"); a moeda vai uma vez no topo do eixo (axisUnit) */
export function usdTick(n: number): string {
  return `${n < 0 ? '−' : ''}${compactNum(n, 1_000)}`;
}

/** Unidade escrita uma vez sobre o eixo dos valores */
export const axisUnit = (): string => (locale === 'pt' ? 'US$' : 'USD');

/**
 * Quebra de linha sem feiura: número preso à unidade ("12\u00a0compras"), "≈" preso ao valor e o "·" preso ao item
 * anterior (a linha pode quebrar depois dele, nunca começar com ele). Para textos montados com " · ".
 */
export function nb(s: string): string {
  return s.replace(/(\d) (?=\p{L})/gu, '$1\u00a0').replace(/≈ /g, '≈\u00a0').replace(/ · /g, '\u00a0· ');
}

export function daysAgo(iso: string, ref: string): number {
  return Math.floor((Date.parse(ref) - Date.parse(iso)) / 86400000);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
