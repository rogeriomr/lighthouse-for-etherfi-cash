import type { Dataset } from '../types';

const DAY = 86400000;

/** Soma `days` dias à parte AAAA-MM-DD de um ISO e mantém o resto do texto (hora e fuso) como estava. */
function shiftIso(iso: string, days: number): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * DAY).toISOString().slice(0, 10) + iso.slice(10);
}

/** Desloca os dias dentro do texto de um arquivo da IA: só campos de data AAAA-MM-DD, nada mais muda. */
function shiftDays<T>(value: T, days: number): T {
  return JSON.parse(JSON.stringify(value), (key, v) =>
    typeof v === 'string' && /^(emailDate|periodEnd|checkedAt|generatedAt)$/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(v) ? shiftIso(v, days) : v) as T;
}

/**
 * O demo visto hoje: todas as datas andam o mesmo número de dias inteiros, para o `referenceDate` cair em `today`.
 * Intervalos, horários e a ordem das compras não mudam; só o calendário. Os checks usam o dataset cru (datas fixas).
 * Andam junto os arquivos da IA (datas dos emails e da auditoria) e o retrato anterior do saldo.
 */
export function shiftDemo(d: Dataset, today: string): Dataset {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d.referenceDate}T00:00:00Z`)) / DAY);
  if (!Number.isFinite(days) || days === 0) return d;
  return {
    ...d,
    referenceDate: shiftIso(d.referenceDate, days),
    transactions: d.transactions.map((t) => ({
      ...t,
      date: shiftIso(t.date, days),
      ...(t.dateUtc ? { dateUtc: shiftIso(t.dateUtc, days) } : null),
    })),
    ...(d.coverage
      ? { coverage: { ...d.coverage, from: shiftIso(d.coverage.from, days), to: shiftIso(d.coverage.to, days) } }
      : null),
    ...(d.subscriptionSources ? { subscriptionSources: shiftDays(d.subscriptionSources, days) } : null),
    ...(d.previousSnapshot
      ? { previousSnapshot: { ...d.previousSnapshot, at: shiftIso(d.previousSnapshot.at, days), lastTxAt: d.previousSnapshot.lastTxAt + days * DAY } }
      : null),
  };
}
