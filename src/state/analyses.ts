// As análises de Gastos (mês a mês, viagens, câmbio, recorrentes) saem uma vez por dataset, idioma e relatório de
// assinaturas e valem para todas as telas que as pedem: Gastos, Evolução e Viagens não refazem a mesma conta, e
// voltar a uma aba não recalcula nada. Dataset e relatório são imutáveis (trocam de objeto quando mudam): servem
// de chave.
import { useMemo } from 'react';
import { detectSubscriptions, detectTrips, fxSummary, monthEvolutions } from '../lib/analytics';
import type { Fx, MonthEvolution, Trip } from '../lib/analytics';
import { recurringView } from '../lib/subscriptions';
import type { RecurringView, SubscriptionReport } from '../lib/subscriptionTypes';
import type { Locale } from '../lib/locale';
import type { Dataset } from '../lib/types';
import { useSubscriptions } from '../components/subscriptionParts';
import { anomaliesFor } from './attention';
import { useStore } from './store';
import { useLocale } from './locale';

export interface SpendAnalyses {
  /** Mês a mês com os mesmos alertas do Início */
  months: MonthEvolution[];
  trips: Trip[];
  fx: Fx | null;
  /** A fonte única de "recorrente": o relatório da aba Assinaturas (D12) */
  recurring: RecurringView;
}

const cache = new WeakMap<object, Map<string, unknown>>();

function once<T>(owner: object, key: string, make: () => T): T {
  let slot = cache.get(owner);
  if (!slot) {
    slot = new Map();
    cache.set(owner, slot);
  }
  if (!slot.has(key)) slot.set(key, make());
  return slot.get(key) as T;
}

export function spendAnalyses(dataset: Dataset, locale: Locale, report: SubscriptionReport): SpendAnalyses {
  const anomalies = anomaliesFor(dataset, locale, report);
  const recurring = recurringView(report);
  return {
    // a lista de alertas é a mesma enquanto o relatório for o mesmo: ela é a chave do mês a mês. A "compra avulsa
    // grande" do mês exclui as cobranças de assinatura do motor, pelo id (D12)
    months: once(anomalies, `months:${locale}`, () => monthEvolutions(
      dataset, once(dataset, 'subs', () => detectSubscriptions(dataset)), locale,
      { anomalies, subscriptionCharges: recurring.subscriptionChargeIds },
    )),
    trips: once(dataset, 'trips', () => detectTrips(dataset)),
    fx: once(dataset, 'fx', () => fxSummary(dataset)),
    recurring,
  };
}

export function useSpendAnalyses(): SpendAnalyses {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const { report } = useSubscriptions();
  return useMemo(() => spendAnalyses(dataset, locale, report), [dataset, locale, report]);
}

/** Assinaturas cuja primeira cobrança caiu no mês AAAA-MM (o evento "nova assinatura" do mês a mês) */
export function newSubscriptionsIn(view: RecurringView, ym: string): { name: string; monthlyUsd: number; approx: boolean }[] {
  return view.items
    .filter((i) => i.kind === 'subscription' && i.firstDate.slice(0, 7) === ym)
    .map((i) => ({ name: i.name, monthlyUsd: i.monthlyUsd, approx: i.approx }));
}
