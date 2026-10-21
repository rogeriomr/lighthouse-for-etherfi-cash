import { describeMerchant, setLocalMerchantRules } from './merchants.ts';
import type { Locale } from './locale';
import type { Dataset, Transaction } from './types';

/**
 * Camada de leitura comum ao demo e ao modo real: nome legível (no idioma da tela, quando é descrição),
 * marca, categoria (id), cartão casado pelo id ou pelos 4 últimos dígitos, moeda da casa e cobertura.
 *
 * Com `timeZone`, date passa a ser a hora local nesse fuso, escrita como ISO com Z ("flutuante"), e o
 * instante original fica em dateUtc. Assim slice(0,10), filtros e formatadores em UTC mostram o dia e a hora
 * de quem vê, sem cada tela converter fuso. referenceDate precisa vir no mesmo relógio (localToday).
 * Sem fuso (demo), date fica como veio: a hora do demo já é a de parede de quem "comprou".
 *
 * Idempotente: partir de merchantRaw/categoryRaw/dateUtc permite rodar de novo, ao trocar o idioma ou o fuso.
 * As regras locais do dicionário (d.merchantRules) valem para este dataset e para quem chamar describeMerchant
 * depois dele; um dataset sem elas (o demo) volta às regras públicas.
 */
export function enrichDataset(d: Dataset, locale: Locale = 'en', timeZone?: string): Dataset {
  setLocalMerchantRules(d.merchantRules);
  const cardByRef = new Map<string, string>();
  for (const c of d.cards) {
    cardByRef.set(c.lastFour, c.id);
    cardByRef.set(c.id, c.id);
  }

  const transactions = d.transactions.map((t): Transaction => {
    const merchantRaw = t.merchantRaw ?? t.merchant;
    const categoryRaw = t.categoryRaw ?? t.category;
    const info = t.type === 'purchase' ? describeMerchant(merchantRaw, categoryRaw, locale) : null;
    const merchant = info ? info.name || merchantRaw : merchantRaw;
    const dateUtc = t.dateUtc ?? t.date;
    return {
      ...t,
      date: timeZone ? localIso(dateUtc, timeZone) : dateUtc,
      dateUtc: timeZone ? dateUtc : undefined,
      merchantRaw,
      categoryRaw,
      merchant,
      brand: info ? info.brand || merchant : undefined,
      category: info ? info.category : undefined,
      subscriptionHint: info?.subscription || undefined,
      cardId: t.cardId ? (cardByRef.get(t.cardId) ?? t.cardId) : undefined,
    };
  });

  // a cobertura começa na transação mais antiga: recalculada no mesmo relógio de date
  const earliest = transactions.reduce<string | null>((a, t) => (a === null || t.date < a ? t.date : a), null);
  return {
    ...d,
    transactions,
    timeZone,
    homeCurrency: homeCurrencyOf(transactions),
    coverage: earliest
      ? {
          from: earliest,
          to: d.coverage?.to ?? `${d.referenceDate}T23:59:59Z`,
          complete: d.coverage?.complete ?? true,
          ...(d.coverage?.droppedRows ? { droppedRows: true } : {}),
        }
      : d.coverage,
  };
}

const wallClockFmts = new Map<string, Intl.DateTimeFormat>();

/** Hora de parede no fuso, escrita como ISO com Z: "2026-10-18T01:14:30Z" em São Paulo vira "2026-10-17T22:14:30Z". */
export function localIso(utcIso: string, timeZone: string): string {
  let fmt = wallClockFmts.get(timeZone);
  if (!fmt) {
    // en-US só para ler as partes de forma estável
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    wallClockFmts.set(timeZone, fmt);
  }
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return utcIso;
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second, ((ms % 1000) + 1000) % 1000);
  const iso = new Date(wall).toISOString();
  // mesma precisão da origem: o conector manda milissegundos, o demo não
  return /\.\d+Z$/.test(utcIso) ? iso : iso.replace(/\.\d{3}Z$/, 'Z');
}

/** Instante real da transação (ms): para comparar com relógio de verdade (Date.now(), horário de uma resposta salva). */
export const txInstant = (t: Pick<Transaction, 'date' | 'dateUtc'>): number => Date.parse(t.dateUtc ?? t.date);

/** Data de hoje (AAAA-MM-DD) no fuso: o referenceDate dos dados reais. */
export function localToday(timeZone: string, now: Date = new Date()): string {
  return localIso(now.toISOString(), timeZone).slice(0, 10);
}

/** Moeda local mais frequente nas compras: é nela que a pessoa pensa os preços. */
function homeCurrencyOf(transactions: Transaction[]): string {
  const counts = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== 'purchase' || t.status === 'void') continue;
    counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  }
  let best = 'USD';
  let bestCount = 0;
  for (const [currency, n] of counts) {
    if (n > bestCount) {
      best = currency;
      bestCount = n;
    }
  }
  return best;
}
