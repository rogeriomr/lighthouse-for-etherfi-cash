import type { MonthEvolution, SpendSummary } from '../lib/analytics';
import { CATEGORY, categoryLabel } from '../lib/merchants';
import { categoryColor } from '../lib/categoryColors';
import type { Locale } from '../lib/locale';
import type { BarSegment } from './charts';

/**
 * O gasto de cada balde (o dia, por padrão; `bucketOf` agrupa por semana ou mês) dividido por categoria, nas cores de
 * "Por categoria" (a maior categoria do período embaixo). Estorno abate da própria categoria; parte que fica negativa no
 * balde some, e as outras encolhem na proporção para a barra somar o total líquido do balde, o mesmo da dica.
 * `totals`: o total líquido de cada balde, na ordem do gráfico (o `byDay` do resumo, quando o balde é o dia).
 */
export function spendStacks(
  summary: SpendSummary,
  locale: Locale,
  totals: { key: string; total: number }[] = summary.byDay.map((d) => ({ key: d.day, total: d.total })),
  bucketOf: (day: string) => string = (day) => day,
): Map<string, BarSegment[]> {
  const order = summary.byCategory.map((c) => c.name);
  const perBucket = new Map<string, Map<string, number>>();
  for (const t of summary.rows) {
    const key = bucketOf(t.date.slice(0, 10));
    const k = t.category ?? CATEGORY.other;
    if (!order.includes(k)) order.push(k);
    const m = perBucket.get(key) ?? new Map<string, number>();
    m.set(k, (m.get(k) ?? 0) + t.amountUsd);
    perBucket.set(key, m);
  }
  const out = new Map<string, BarSegment[]>();
  for (const { key, total } of totals) {
    const m = perBucket.get(key);
    if (!m || total <= 0) continue;
    const parts = order.map((k) => ({ key: k, label: categoryLabel(k, locale), value: Math.max(0, m.get(k) ?? 0), color: categoryColor(k) }));
    const positive = parts.reduce((s, p) => s + p.value, 0);
    const scale = positive > total ? total / positive : 1;
    out.set(key, parts.filter((p) => p.value > 0).map((p) => ({ ...p, value: Math.round(p.value * scale * 100) / 100 })));
  }
  return out;
}

/**
 * O gasto de cada mês do "Gasto por mês" dividido por categoria, nas mesmas cores. Sai do `byCategory` de cada mês (o
 * mesmo cálculo do detalhe do mês, embaixo), na mesma ordem em todas as barras: a maior categoria dos meses mostrados
 * embaixo. O `byCategory` só traz categorias positivas; se elas passam do líquido do mês (estorno), todas encolhem na
 * proporção, para a barra somar o total do mês, o mesmo da dica. Mês com total <= 0 fica sem partes.
 */
export function monthCategoryStacks(months: MonthEvolution[], locale: Locale): Map<string, BarSegment[]> {
  const sum = new Map<string, number>();
  for (const m of months) for (const c of m.byCategory) sum.set(c.name, (sum.get(c.name) ?? 0) + Math.max(0, c.total));
  const order = [...sum.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const out = new Map<string, BarSegment[]>();
  for (const m of months) {
    if (m.total <= 0) continue;
    const by = new Map(m.byCategory.map((c) => [c.name, Math.max(0, c.total)]));
    const parts = order
      .filter((k) => (by.get(k) ?? 0) > 0)
      .map((k) => ({ key: k, label: categoryLabel(k, locale), value: by.get(k) ?? 0, color: categoryColor(k) }));
    const positive = parts.reduce((s, p) => s + p.value, 0);
    const scale = positive > m.total ? m.total / positive : 1;
    out.set(m.month, parts.map((p) => ({ ...p, value: Math.round(p.value * scale * 100) / 100 })));
  }
  return out;
}
