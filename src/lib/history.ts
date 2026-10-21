import type { Dataset, Transaction } from './types';
import { fxSummary, homeTotal, isSpend } from './analytics.ts';
import { CATEGORY } from './merchants.ts';
import { LOCALES, pick, type Locale } from './locale.ts';

const R2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;

export interface HistoryMonth {
  month: string;
  total: number;
  count: number;
  /** Mês inteiro dentro da cobertura e já fechado: o único que vale comparar */
  full: boolean;
  /** O histórico começa neste mês, depois do dia 1 (com histórico completo, o mês em que a conta abriu): parcial */
  startsMidMonth: boolean;
  byCategory: { name: string; total: number }[];
}

export interface HistoryGroup {
  /** Em byCategory é o id da categoria: exiba com categoryLabel */
  name: string;
  total: number;
  /** Cobranças (estornos não contam) */
  count: number;
  /** Fatia entre os grupos listados, 0..1 */
  share: number;
  avgTicket: number;
  /** Primeira e última cobrança no grupo */
  first: string;
  last: string;
  /** Id da categoria mais frequente (estabelecimento e marca) */
  category?: string;
}

export interface HistoryPlace {
  /** 'home' para a moeda da casa; nas demais, o código ISO */
  key: string;
  label: string;
  currency: string;
  total: number;
  count: number;
  share: number;
}

/** weekday 0 = domingo */
export interface HeatCell {
  weekday: number;
  hour: number;
  total: number;
  count: number;
}

export interface PurchaseHistory {
  /** isSpend, mais recente primeiro: inclui pendentes e estornos, nunca canceladas */
  purchases: Transaction[];
  from: string;
  to: string;
  days: number;
  /** Líquido em USD: estorno abate */
  total: number;
  /** ≈ moeda da casa; null quando a casa é USD */
  totalHome: number | null;
  homeCurrency: string;
  count: number;
  avgTicket: number;
  months: HistoryMonth[];
  byCategory: HistoryGroup[];
  byMerchant: HistoryGroup[];
  byBrand: HistoryGroup[];
  byPlace: HistoryPlace[];
  /** 7×24, índice weekday * 24 + hour; só cobranças, total bruto */
  heatmap: HeatCell[];
  topPurchases: Transaction[];
  coverageComplete: boolean;
  /** O conector omitiu linhas: os totais são parciais e nenhum mês é inteiro */
  droppedRows: boolean;
}

interface Acc {
  total: number;
  count: number;
  first: string;
  last: string;
  categories: Map<string, number>;
}

/** Soma crua por chave; o arredondamento fica para o fim, para os grupos fecharem com o total. */
function accumulate(rows: Transaction[], keyOf: (t: Transaction) => string): Map<string, Acc> {
  const out = new Map<string, Acc>();
  for (const t of rows) {
    const k = keyOf(t);
    let g = out.get(k);
    if (!g) {
      g = { total: 0, count: 0, first: '', last: '', categories: new Map() };
      out.set(k, g);
    }
    g.total += t.amountUsd;
    if (t.amountUsd <= 0) continue;
    g.count += 1;
    // rows vêm da mais recente para a mais antiga
    if (!g.last) g.last = t.date;
    g.first = t.date;
    const c = t.category ?? CATEGORY.other;
    g.categories.set(c, (g.categories.get(c) ?? 0) + 1);
  }
  return out;
}

/** Empate fica com a categoria da cobrança mais recente. */
function topCategory(categories: Map<string, number>): string {
  let best: string = CATEGORY.other;
  let bestCount = 0;
  for (const [name, n] of categories) {
    if (n > bestCount) {
      best = name;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Grupo só de estorno (total <= 0) fica fora da lista; o total geral continua líquido.
 * Por isso a fatia é sobre os grupos listados: fica em 0..1 e soma 1.
 */
function listed(map: Map<string, Acc>): { key: string; g: Acc; total: number; share: number }[] {
  const rows = [...map.entries()]
    .map(([key, g]) => ({ key, g, total: R2(g.total) }))
    .filter((x) => x.total > 0);
  const base = rows.reduce((s, x) => s + x.total, 0);
  return rows.map((x) => ({ ...x, share: base > 0 ? x.total / base : 0 }));
}

// desempate pela chave, sem idioma: a ordem é a mesma em inglês e em português
const byTotal = (a: { total: number; name?: string; currency?: string }, b: { total: number; name?: string; currency?: string }) => {
  const ka = a.name ?? a.currency ?? '';
  const kb = b.name ?? b.currency ?? '';
  return b.total - a.total || (ka < kb ? -1 : ka > kb ? 1 : 0);
};

function groups(rows: Transaction[], keyOf: (t: Transaction) => string, withCategory: boolean): HistoryGroup[] {
  return listed(accumulate(rows, keyOf))
    .map(({ key, g, total, share }) => ({
      name: key,
      total,
      count: g.count,
      share,
      avgTicket: g.count ? R2(total / g.count) : 0,
      first: g.first,
      last: g.last,
      ...(withCategory ? { category: topCategory(g.categories) } : {}),
    }))
    .sort(byTotal);
}

/** "euros", "British pounds" em inglês; "euro", "libra esterlina" em português. Código desconhecido fica como veio. */
function currencyName(code: string, locale: Locale): string {
  const tag = LOCALES.find((l) => l.value === locale)?.tag ?? 'en-US';
  try {
    if (locale === 'en') {
      // "in euros" pede o plural, que só o NumberFormat dá (nome por extenso de 2 unidades)
      return new Intl.NumberFormat(tag, { style: 'currency', currency: code, currencyDisplay: 'name' })
        .formatToParts(2).find((p) => p.type === 'currency')?.value ?? code;
    }
    const name = new Intl.DisplayNames(tag, { type: 'currency' }).of(code);
    // nome de moeda é substantivo comum: "em libra esterlina"
    return name && name !== code ? name.toLocaleLowerCase(tag) : code;
  } catch {
    return code;
  }
}

function placeLabel(currency: string, home: string, locale: Locale): string {
  const name = currencyName(currency, locale);
  if (currency === home) {
    return home === 'BRL' ? pick(locale, 'Brazil · in reais', 'Brasil · em reais') : pick(locale, `Home currency · ${name}`, `Moeda da casa · ${name}`);
  }
  // para quem não mora nos EUA, cobrança em dólar é serviço online ou compra lá fora
  if (currency === 'USD') return pick(locale, 'In US dollars · online or abroad', 'Em dólar · online ou exterior');
  return pick(locale, `In ${name}`, `Em ${name}`);
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana e hora no fuso pedido (com 'UTC', a hora de parede gravada em date); getHours() dependeria da máquina. */
function weekdayHourIn(timeZone: string): (iso: string) => { weekday: number; hour: number } {
  // en-US só para ler as partes de forma estável
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  return (iso) => {
    let weekday = 0;
    let hour = 0;
    for (const p of fmt.formatToParts(new Date(iso))) {
      if (p.type === 'weekday') weekday = WEEKDAY[p.value] ?? 0;
      else if (p.type === 'hour') hour = Number(p.value) % 24;
    }
    return { weekday, hour };
  };
}

function monthRange(firstYm: string, lastYm: string): string[] {
  const out: string[] = [];
  let [y, m] = firstYm.split('-').map(Number);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= lastYm) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Todas as compras no cartão de uma vez: base da tela de histórico.
 * Dia, mês e hora saem de date, que nos dados reais já é hora local (enrichDataset): mapa de calor, meses e lista
 * usam o mesmo relógio. `timeZone` só serve para ver o mapa de calor em outro fuso, a partir de dateUtc.
 */
export function purchaseHistory(dataset: Dataset, opts: { timeZone?: string; locale?: Locale } = {}): PurchaseHistory {
  const locale = opts.locale ?? 'en';
  const purchases = dataset.transactions.filter(isSpend).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const charges = purchases.filter((t) => t.amountUsd > 0);
  const homeCurrency = dataset.homeCurrency ?? 'USD';
  const coverage = dataset.coverage;

  const empty = `${dataset.referenceDate}T00:00:00Z`;
  const from = purchases.at(-1)?.date ?? empty;
  const to = purchases[0]?.date ?? empty;
  const total = R2(purchases.reduce((s, t) => s + t.amountUsd, 0));
  const count = charges.length;

  // mês de date, como monthEvolutions: o total do mês bate com o resto do painel
  const monthAcc = new Map<string, { total: number; count: number; categories: Map<string, number> }>();
  for (const t of purchases) {
    const ym = t.date.slice(0, 7);
    const acc = monthAcc.get(ym) ?? { total: 0, count: 0, categories: new Map() };
    acc.total += t.amountUsd;
    if (t.amountUsd > 0) acc.count += 1;
    const c = t.category ?? CATEGORY.other;
    acc.categories.set(c, (acc.categories.get(c) ?? 0) + t.amountUsd);
    monthAcc.set(ym, acc);
  }
  const refYm = dataset.referenceDate.slice(0, 7);
  const months: HistoryMonth[] = purchases.length
    ? monthRange(from.slice(0, 7), to.slice(0, 7)).map((ym) => {
      const acc = monthAcc.get(ym);
      // mesma regra de isFullMonth: o mês em que o histórico começa depois do dia 1 é parcial, mesmo com cobertura
      // completa (aí é o mês em que a conta abriu); com linhas omitidas, nenhum mês é inteiro
      const covered = !coverage || coverage.complete || coverage.from.slice(0, 10) <= `${ym}-01`;
      const startsMidMonth = Boolean(coverage && coverage.from.slice(0, 7) === ym && coverage.from.slice(8, 10) !== '01');
      return {
        month: ym,
        total: R2(acc?.total ?? 0),
        count: acc?.count ?? 0,
        full: covered && !startsMidMonth && !coverage?.droppedRows && ym < refYm,
        startsMidMonth,
        byCategory: [...(acc?.categories ?? [])]
          .map(([name, v]) => ({ name, total: R2(v) }))
          .filter((c) => c.total > 0)
          .sort(byTotal),
      };
    })
    : [];

  const byPlace: HistoryPlace[] = listed(accumulate(purchases, (t) => t.currency))
    .map(({ key: currency, g, total: placeTotal, share }) => ({
      key: currency === homeCurrency ? 'home' : currency,
      label: placeLabel(currency, homeCurrency, locale),
      currency,
      total: placeTotal,
      count: g.count,
      share,
    }))
    .sort(byTotal);

  // estorno sai quando o estabelecimento processa, não quando a pessoa comprou: o mapa é só de cobranças
  const heatmap: HeatCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) heatmap.push({ weekday, hour, total: 0, count: 0 });
  }
  // date já está no relógio local: lida em UTC, sem aplicar o fuso de novo
  const weekdayHour = weekdayHourIn(opts.timeZone ?? 'UTC');
  const heatRaw = new Array<number>(168).fill(0);
  for (const t of charges) {
    const { weekday, hour } = weekdayHour(opts.timeZone ? (t.dateUtc ?? t.date) : t.date);
    const i = weekday * 24 + hour;
    heatRaw[i] += t.amountUsd;
    heatmap[i].count += 1;
  }
  heatRaw.forEach((v, i) => { heatmap[i].total = R2(v); });

  return {
    purchases,
    from,
    to,
    days: Math.max(1, Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY) + 1),
    total,
    totalHome: homeTotal(purchases, fxSummary(dataset)),
    homeCurrency,
    count,
    avgTicket: count ? R2(total / count) : 0,
    months,
    byCategory: groups(purchases, (t) => t.category ?? CATEGORY.other, false),
    byMerchant: groups(purchases, (t) => t.merchant ?? '—', true),
    byBrand: groups(purchases, (t) => t.brand ?? t.merchant ?? '—', true),
    byPlace,
    heatmap,
    // sort é estável: no empate fica a mais recente
    topPurchases: [...charges].sort((a, b) => b.amountUsd - a.amountUsd).slice(0, 10),
    coverageComplete: coverage?.complete ?? true,
    droppedRows: Boolean(coverage?.droppedRows),
  };
}
