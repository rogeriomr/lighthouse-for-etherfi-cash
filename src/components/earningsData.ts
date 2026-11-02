import { useEffect, useMemo } from 'react';
import { buildEarnings, type Earnings, type EarningsPrefs, type EarningsSource } from '../lib/earnings';
import { demoBaseline, earningsChanges, snapshotOf, type EarningsChange, type EarningsSnapshot } from '../lib/earningsChanges';
import { NEUTRAL_COLOR } from '../lib/categoryColors';
import { pick, type Locale } from '../lib/locale';
import type { SubscriptionReport } from '../lib/subscriptionTypes';
import type { Dataset } from '../lib/types';
import { useStore } from '../state/store';
import { useLocale } from '../state/locale';
import { useSubscriptions } from '../state/decisions';
import { useEarningsPrefs } from '../state/earningsPrefs';
import { saveSeen, useSeenSnapshots, type SeenScope } from '../state/earningsSeen';

// A ligação da tela Ganhos (e dos atalhos no Portfólio e em Assinaturas) com o motor: o mesmo relatório de assinaturas
// que o resto do app já calcula (com as respostas da pessoa) e as preferências guardadas neste navegador.

/**
 * Uma cor fixa por fonte (pela entidade, nunca pela posição), do revisor visual (ganhos/visual/revisao-1.md). Validadas
 * no cartão #191816 com o validador da skill dataviz, todos os pares: visão normal ≥ 17,7 (≥ 15,2 com o cinza), ≥ 3:1
 * (o menor é o liquidETH, 3,02:1), CVD ≥ 7,7 (o par raro cashback × outros cofres; há rótulo, legenda e tabela).
 * Nenhuma fica a menos de ΔE 15 do acento nem das cores de status. Os outros ativos com APY ficam no cinza "outros"
 * do app (NEUTRAL_COLOR).
 */
export const EARN_COLORS = {
  cashback: '#199e70',
  liquidusd: '#1085fc',
  liquideth: '#7c49c0',
  liquidbtc: '#c25400',
  /** qualquer outro cofre Liquid */
  vault: '#d55aad',
  other: NEUTRAL_COLOR,
} as const;

/** A cor de uma fonte: o cofre pelo símbolo (sem diferenciar maiúsculas), os outros com APY no cinza, o cashback no aqua. */
export function sourceColor(kind: 'vault' | 'other' | 'cashback', asset?: string): string {
  if (kind === 'cashback') return EARN_COLORS.cashback;
  if (kind === 'other') return EARN_COLORS.other;
  const key = asset?.toLowerCase();
  return key === 'liquidusd' || key === 'liquideth' || key === 'liquidbtc' ? EARN_COLORS[key] : EARN_COLORS.vault;
}

/** A cor de uma fonte do motor (o id do cofre é 'vault:<símbolo>'). */
export const colorOfSource = (s: EarningsSource): string => sourceColor(s.kind, s.kind === 'vault' ? s.id.replace(/^vault:/, '') : undefined);

/**
 * A ordem das fontes no fluxo, no medidor e na tabela: cashback, outros com APY e os cofres Liquid por último. Assim a
 * escada de marcos ("mais no Liquid cobriria o próximo") continua de onde o fluxo para.
 */
export const flowOrder = (sources: readonly EarningsSource[]): EarningsSource[] => {
  const rank = { cashback: 0, other: 1, vault: 2 } as const;
  return [...sources].sort((a, b) => rank[a.kind] - rank[b.kind]);
};

// Um resultado só para a página: o menu (o ponto de novidade), o Portfólio e a tela usam a mesma conta, feita uma vez
let lastEarnings: { dataset: Dataset; prefs: EarningsPrefs; report: SubscriptionReport; locale: Locale; value: Earnings } | null = null;
function sharedEarnings(dataset: Dataset, prefs: EarningsPrefs, report: SubscriptionReport, locale: Locale): Earnings {
  const l = lastEarnings;
  if (l && l.dataset === dataset && l.prefs === prefs && l.report === report && l.locale === locale) return l.value;
  const value = buildEarnings(dataset, { prefs, report }, locale);
  lastEarnings = { dataset, prefs, report, locale, value };
  return value;
}

/** Os ganhos da conta carregada, recalculados quando os dados, as respostas, as preferências ou o idioma mudam. */
export function useEarnings(): Earnings {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const { report } = useSubscriptions();
  const [prefs] = useEarningsPrefs();
  return useMemo(() => sharedEarnings(dataset, prefs, report, locale), [dataset, prefs, report, locale]);
}

export interface EarningsNews {
  scope: SeenScope;
  /** A foto de agora */
  current: EarningsSnapshot;
  /** O dia da foto anterior (null: nenhuma) */
  since: string | null;
  changes: EarningsChange[];
}

/**
 * O que mudou nos ganhos desde a última foto vista neste navegador. Nos dados reais vistos pela primeira vez, a foto de
 * hoje vira a base em silêncio. No demo sem foto, vale a "visita anterior" inventada (demoBaseline), para o recurso
 * aparecer. Quem grava a foto vista é a tela Ganhos, ao abrir (saveSeen).
 */
export function useEarningsNews(): EarningsNews {
  const { dataset, isSample } = useStore();
  const { locale } = useLocale();
  const { report } = useSubscriptions();
  const [prefs] = useEarningsPrefs();
  const e = useEarnings();
  const seen = useSeenSnapshots();
  const scope: SeenScope = isSample ? 'demo' : 'real';
  const current = useMemo(() => snapshotOf(e, dataset.referenceDate), [e, dataset.referenceDate]);
  const stored = seen[scope];
  const demoPrev = useMemo(() => (scope === 'demo' && !stored ? demoBaseline(dataset, { prefs, report }, locale) : null), [scope, stored, dataset, prefs, report, locale]);
  const baseline = stored ?? demoPrev;
  const changes = useMemo(() => (baseline ? earningsChanges(baseline, current, (en, pt) => pick(locale, en, pt)) : []), [baseline, current, locale]);
  const empty = e.empty;
  useEffect(() => {
    if (scope === 'real' && !stored && !empty) saveSeen('real', current);
  }, [scope, stored, empty, current]);
  return { scope, current, since: baseline?.at ?? null, changes };
}
