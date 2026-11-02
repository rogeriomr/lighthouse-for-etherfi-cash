// "O que mudou" na tela Ganhos: uma foto pequena dos ganhos (EarningsSnapshot) e a diferença entre duas fotos, em
// frases. Serve a dois usos com a mesma conta:
//   - 'since': desde a última visita (a tela guarda a foto neste navegador; o npm run earnings, na pasta de dados);
//   - 'scenario': hoje contra um "e se" (mais no Liquid, outro APY), no resumo para a IA e no npm run earnings.
// Linha vermelha, como no resto da tela: informa o que mudou e o que um cenário cobriria. Nunca diz "deposite",
// "invista" ou "gaste mais", e não fala de nível.
import { buildEarnings, DEFAULT_EARNINGS_PREFS, milestoneApprox, partialPct, type CoverStatus, type Earnings, type EarningsOptions } from './earnings.ts';
import { pct, usd, usd0 } from './format.ts';
import type { Locale } from './locale.ts';
import type { Dataset } from './types';

type Tr = (en: string, pt: string) => string;

export interface SnapshotItem {
  /** EarningsItem.key ('rec:…' ou 'man:…') */
  key: string;
  name: string;
  /** Custo por mês (US$) */
  monthly: number;
  status: CoverStatus;
  /** Fração paga (0–1) */
  share: number;
  /** Item digitado pela pessoa: ela já sabe que entrou ou saiu */
  manual?: true;
}

export interface EarningsSnapshot {
  v: 1;
  /** Dia da foto (AAAA-MM-DD) */
  at: string;
  /** Ganhos estimados por mês */
  totalMonthly: number;
  /** O que havia nos cofres Liquid com APY */
  liquidValue: number;
  /** APY (%) de cada ativo que rende, pelo símbolo */
  apy: Record<string, number>;
  /** Os itens incluídos na conta, na ordem da alocação */
  items: SnapshotItem[];
  /** O primeiro degrau da escada de marcos: o item e o valor "≈" a mais no Liquid */
  next?: { key: string; name: string; approx: number };
}

export const SNAPSHOT_LIMITS = { items: 300, name: 80, key: 160, assets: 60 } as const;

/** Quanto precisa mudar para virar frase: menos que isso é ruído do APY ou do centavo */
export const CHANGE_THRESHOLDS = {
  /** pontos percentuais de APY */
  apyPp: 0.25,
  /** preço do item: as duas condições juntas */
  priceShare: 0.02,
  priceUsd: 0.5,
  /** ganhos do mês: as duas juntas */
  totalShare: 0.05,
  totalUsd: 1,
  /** o próximo marco andou pelo menos isto (US$) */
  milestoneUsd: 100,
} as const;

/** A foto dos ganhos de hoje. `at`: o dia (AAAA-MM-DD). */
export function snapshotOf(e: Earnings, at: string): EarningsSnapshot {
  const apy: Record<string, number> = {};
  for (const h of [...e.yield.liquid.holdings, ...e.yield.other.holdings]) apy[h.asset] = h.apy;
  const first = e.milestones.kind === 'ladder' ? e.milestones.steps[0] : undefined;
  return {
    v: 1,
    at,
    totalMonthly: e.totalMonthly,
    liquidValue: e.yield.liquid.value,
    apy,
    items: e.allocation.rows.slice(0, SNAPSHOT_LIMITS.items).map((r) => ({
      key: r.item.key,
      name: r.item.name.slice(0, SNAPSHOT_LIMITS.name),
      monthly: r.item.monthly,
      status: r.status,
      share: Math.round(r.share * 10000) / 10000,
      ...(r.item.origin === 'manual' ? { manual: true as const } : {}),
    })),
    ...(first ? { next: { key: first.item.key, name: first.item.name.slice(0, SNAPSHOT_LIMITS.name), approx: milestoneApprox(first.extra) } } : {}),
  };
}

const isRecord = (raw: unknown): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw);
const money = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 1e12;
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
// controles e marcas de direção não voltam para a tela, mesmo vindo do próprio navegador
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;

/** Valida uma foto lida do navegador ou de um arquivo; o que não servir vira undefined (e a tela trata como primeira visita). */
export function validateSnapshot(raw: unknown): EarningsSnapshot | undefined {
  if (!isRecord(raw) || raw.v !== 1) return undefined;
  if (typeof raw.at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.at) || !money(raw.totalMonthly) || !money(raw.liquidValue)) return undefined;
  if (!isRecord(raw.apy) || !Array.isArray(raw.items) || raw.items.length > SNAPSHOT_LIMITS.items) return undefined;
  const apy: Record<string, number> = {};
  const entries = Object.entries(raw.apy);
  if (entries.length > SNAPSHOT_LIMITS.assets) return undefined;
  for (const [k, v] of entries) {
    if (!text(k, 40) || UNSAFE.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) return undefined;
    apy[k] = v;
  }
  const items: SnapshotItem[] = [];
  for (const it of raw.items) {
    if (!isRecord(it) || !text(it.key, SNAPSHOT_LIMITS.key) || !text(it.name, SNAPSHOT_LIMITS.name) || UNSAFE.test(it.name) || !money(it.monthly)) return undefined;
    if (it.status !== 'covered' && it.status !== 'partial' && it.status !== 'uncovered') return undefined;
    if (typeof it.share !== 'number' || !(it.share >= 0 && it.share <= 1)) return undefined;
    items.push({ key: it.key, name: it.name, monthly: it.monthly, status: it.status, share: it.share, ...(it.manual === true ? { manual: true as const } : {}) });
  }
  const out: EarningsSnapshot = { v: 1, at: raw.at, totalMonthly: raw.totalMonthly, liquidValue: raw.liquidValue, apy, items };
  const n = raw.next;
  if (isRecord(n) && text(n.key, SNAPSHOT_LIMITS.key) && text(n.name, SNAPSHOT_LIMITS.name) && !UNSAFE.test(n.name) && money(n.approx)) out.next = { key: n.key, name: n.name, approx: n.approx };
  return out;
}

export type ChangeKind = 'now_covered' | 'no_longer_covered' | 'new_item' | 'gone_item' | 'price' | 'apy' | 'total' | 'milestone';

export interface EarningsChange {
  id: string;
  kind: ChangeKind;
  /** good: os ganhos passaram a pagar mais; attention: pagam menos, ou um custo subiu; neutral: só informa */
  tone: 'good' | 'attention' | 'neutral';
  text: string;
}

/** "A, B e C" / "A, B and C" */
function list(names: string[], tr: Tr): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')}${tr(' and ', ' e ')}${names[names.length - 1]}`;
}

/**
 * O que mudou de `prev` para `now`, em frases, na ordem em que importam: cobertura, itens novos e que saíram, preços,
 * APY, o total e o próximo marco. `mode` 'since' fala no passado ("passaram a cobrir"); 'scenario', no condicional
 * ("cobririam também"), e aí só entram cobertura, APY e total (os itens são os mesmos nos dois lados).
 */
export function earningsChanges(prev: EarningsSnapshot, now: EarningsSnapshot, tr: Tr, mode: 'since' | 'scenario' = 'since'): EarningsChange[] {
  const out: EarningsChange[] = [];
  const before = new Map(prev.items.map((i) => [i.key, i]));
  const after = new Map(now.items.map((i) => [i.key, i]));
  const scenario = mode === 'scenario';

  // cobertura: quem passou a ser pago inteiro e quem deixou de ser (os itens novos têm frase própria)
  const gained = now.items.filter((i) => i.status === 'covered' && before.has(i.key) && before.get(i.key)!.status !== 'covered');
  const lost = now.items.filter((i) => i.status !== 'covered' && before.get(i.key)?.status === 'covered');
  if (gained.length) {
    const names = list(gained.map((i) => i.name), tr);
    out.push({
      id: `now_covered:${gained.map((i) => i.key).join('|')}`,
      kind: 'now_covered',
      tone: 'good',
      text: scenario
        ? tr(`Your earnings would also cover ${names}.`, `Os ganhos cobririam também ${names}.`)
        : tr(`Your earnings now also cover ${names}.`, `Seus ganhos passaram a cobrir também ${names}.`),
    });
  }
  if (lost.length) {
    const names = list(lost.map((i) => i.name), tr);
    out.push({
      id: `no_longer_covered:${lost.map((i) => i.key).join('|')}`,
      kind: 'no_longer_covered',
      tone: 'attention',
      text: scenario
        ? tr(`Your earnings would no longer cover all of ${names}.`, `Os ganhos deixariam de cobrir por inteiro ${names}.`)
        : tr(`Your earnings no longer cover all of ${names}.`, `Seus ganhos não cobrem mais por inteiro ${names}.`),
    });
  }

  if (!scenario) {
    for (const i of now.items) {
      if (before.has(i.key) || i.manual) continue;
      const cover = i.status === 'covered'
        ? tr('fully covered by your earnings', 'coberta por inteiro pelos seus ganhos')
        : i.status === 'partial'
          ? tr(`${pct(partialPct(i.share))} covered by your earnings`, `${pct(partialPct(i.share))} coberta pelos seus ganhos`)
          : tr('not covered yet', 'ainda sem cobertura');
      out.push({
        id: `new_item:${i.key}`,
        kind: 'new_item',
        tone: 'neutral',
        text: tr(`New recurring charge: ${i.name}, ${usd(i.monthly)} a month, ${cover}.`, `Nova recorrência: ${i.name}, ${usd(i.monthly)} por mês, ${cover}.`),
      });
    }
    for (const i of prev.items) {
      if (after.has(i.key) || i.manual) continue;
      out.push({ id: `gone_item:${i.key}`, kind: 'gone_item', tone: 'neutral', text: tr(`${i.name} is no longer in the count.`, `${i.name} não está mais na conta.`) });
    }
    for (const i of now.items) {
      const p = before.get(i.key);
      if (!p || i.manual) continue;
      const d = i.monthly - p.monthly;
      if (Math.abs(d) < CHANGE_THRESHOLDS.priceUsd || Math.abs(d) < p.monthly * CHANGE_THRESHOLDS.priceShare) continue;
      out.push({
        id: `price:${i.key}:${i.monthly}`,
        kind: 'price',
        tone: d > 0 ? 'attention' : 'good',
        text: tr(`${i.name} went from ${usd(p.monthly)} to ${usd(i.monthly)} a month.`, `${i.name} foi de ${usd(p.monthly)} para ${usd(i.monthly)} por mês.`),
      });
    }
  }

  for (const [asset, apy] of Object.entries(now.apy)) {
    const was = prev.apy[asset];
    if (was === undefined || Math.abs(apy - was) < CHANGE_THRESHOLDS.apyPp) continue;
    out.push({
      id: `apy:${asset}:${apy}`,
      kind: 'apy',
      tone: apy > was ? 'good' : 'attention',
      text: scenario
        ? tr(`${asset} APY: ${pct(was, 2)} → ${pct(apy, 2)}.`, `APY do ${asset}: ${pct(was, 2)} → ${pct(apy, 2)}.`)
        : tr(`${asset} APY went from ${pct(was, 2)} to ${pct(apy, 2)}.`, `O APY do ${asset} foi de ${pct(was, 2)} para ${pct(apy, 2)}.`),
    });
  }

  const dt = now.totalMonthly - prev.totalMonthly;
  if (Math.abs(dt) >= CHANGE_THRESHOLDS.totalUsd && Math.abs(dt) >= prev.totalMonthly * CHANGE_THRESHOLDS.totalShare) {
    out.push({
      id: `total:${now.totalMonthly}`,
      kind: 'total',
      tone: dt > 0 ? 'good' : 'attention',
      text: scenario
        ? tr(`Estimated earnings: ${usd(prev.totalMonthly)} → ${usd(now.totalMonthly)} a month.`, `Ganhos estimados: ${usd(prev.totalMonthly)} → ${usd(now.totalMonthly)} por mês.`)
        : tr(`Your estimated earnings went from ${usd(prev.totalMonthly)} to ${usd(now.totalMonthly)} a month.`, `Seus ganhos estimados foram de ${usd(prev.totalMonthly)} para ${usd(now.totalMonthly)} por mês.`),
    });
  }

  // o próximo marco é o mesmo item e andou: mais perto ou mais longe (item novo no topo da escada sai nas frases acima)
  if (!scenario && prev.next && now.next && prev.next.key === now.next.key && Math.abs(now.next.approx - prev.next.approx) >= CHANGE_THRESHOLDS.milestoneUsd) {
    const closer = now.next.approx < prev.next.approx;
    out.push({
      id: `milestone:${now.next.key}:${now.next.approx}`,
      kind: 'milestone',
      tone: closer ? 'good' : 'neutral',
      text: closer
        ? tr(
          `The next milestone got closer: with ≈ ${usd0(now.next.approx)} more earning in Liquid, your earnings would also cover ${now.next.name} (it was ≈ ${usd0(prev.next.approx)}).`,
          `O próximo marco ficou mais perto: com ≈ ${usd0(now.next.approx)} a mais rendendo no Liquid, os ganhos cobririam também ${now.next.name} (antes, ≈ ${usd0(prev.next.approx)}).`,
        )
        : tr(
          `The next milestone moved further: it now takes ≈ ${usd0(now.next.approx)} more earning in Liquid to also cover ${now.next.name} (it was ≈ ${usd0(prev.next.approx)}).`,
          `O próximo marco ficou mais longe: agora são ≈ ${usd0(now.next.approx)} a mais rendendo no Liquid para cobrir também ${now.next.name} (antes, ≈ ${usd0(prev.next.approx)}).`,
        ),
    });
  }
  return out;
}

/**
 * O "e se" de uma linha, do primeiro degrau da escada: "Com ≈ US$ 300 a mais rendendo no Liquid, ao APY de hoje, os
 * ganhos cobririam também ChatGPT." Sem escada (sem Liquid, tudo coberto ou nada para cobrir), null.
 */
export function nextWhatIf(e: Earnings, tr: Tr): string | null {
  if (e.milestones.kind !== 'ladder' || !e.milestones.steps.length) return null;
  const s = e.milestones.steps[0];
  const approx = usd0(milestoneApprox(s.extra));
  return s.wasPartial
    ? tr(
      `With ≈ ${approx} more earning in Liquid, at today’s APY, your earnings would also cover all of ${s.item.name}.`,
      `Com ≈ ${approx} a mais rendendo no Liquid, ao APY de hoje, os ganhos cobririam também ${s.item.name} por inteiro.`,
    )
    : tr(
      `With ≈ ${approx} more earning in Liquid, at today’s APY, your earnings would also cover ${s.item.name}.`,
      `Com ≈ ${approx} a mais rendendo no Liquid, ao APY de hoje, os ganhos cobririam também ${s.item.name}.`,
    );
}

/** Quanto o APY do liquidUSD do demo era menor na "visita anterior" inventada, em pontos percentuais */
export const DEMO_PREVIOUS_APY_DROP = 1.2;
/** Há quantos dias foi essa visita */
export const DEMO_PREVIOUS_DAYS = 30;

/**
 * A "visita anterior" do demo, para quem abre o demo ver o "O que mudou" funcionando: há 30 dias, o liquidUSD rendia
 * 1,2 ponto a menos e o Midjourney ainda não estava na conta. Só para os dados de exemplo; nos dados reais a primeira
 * visita grava a foto de hoje e não mostra nada.
 */
export function demoBaseline(dataset: Dataset, opts: EarningsOptions, locale: Locale): EarningsSnapshot {
  const today = buildEarnings(dataset, opts, locale);
  const prefs = opts.prefs ?? DEFAULT_EARNINGS_PREFS;
  const late = today.allocation.rows.find((r) => /midjourney/i.test(r.item.name));
  const holdings = dataset.portfolio.holdings.map((h) => (/^liquidusd$/i.test(h.asset) && (h.apy ?? 0) > DEMO_PREVIOUS_APY_DROP ? { ...h, apy: Math.round(((h.apy ?? 0) - DEMO_PREVIOUS_APY_DROP) * 100) / 100 } : h));
  const before = buildEarnings(
    { ...dataset, portfolio: { ...dataset.portfolio, holdings } },
    { ...opts, prefs: late ? { ...prefs, excluded: [...prefs.excluded, late.item.key] } : prefs },
    locale,
  );
  return snapshotOf(before, daysBefore(dataset.referenceDate, DEMO_PREVIOUS_DAYS));
}

/** Dias entre duas datas AAAA-MM-DD (b − a) */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Dia anterior em `days` dias (AAAA-MM-DD) */
export const daysBefore = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
