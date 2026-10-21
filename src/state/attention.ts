import { useMemo } from 'react';
import { detectAnomalies, detectSubscriptions, isRecentAnomaly, type Anomaly } from '../lib/analytics';
import { attentionOf, type Attention, type AttentionItem } from '../lib/attentionModel';
import { recurringView } from '../lib/subscriptions';
import type { Dataset } from '../lib/types';
import type { SubscriptionReport } from '../lib/subscriptionTypes';
import type { Locale } from '../lib/locale';
import { alertId, useDismissed } from '../components/alerts';
import { useSubscriptions } from './decisions';
import { useStore } from './store';
import { useLocale } from './locale';

// a conta em si (o que entra, a ordem e a composição) fica em lib/attentionModel.ts, sem React, para o check conferir
export {
  attentionRank, attentionSections, attentionSummary, plansToCancel, questionCounts, questionsOf, questionsSummary, waitingLabel,
} from '../lib/attentionModel';
export type { Attention, AttentionItem, QuestionCounts } from '../lib/attentionModel';

export interface AttentionDetail {
  attention: Attention;
  /** o que conta no total, já na ordem do Início */
  items: AttentionItem[];
  /** alertas em aberto com mais de 30 dias: fora da contagem, no "ver todos" do Início */
  older: Anomaly[];
  /** alertas que a pessoa marcou "Já conferi" */
  hidden: number;
}

const anomalyCache = new WeakMap<Dataset, Map<Locale, { report: SubscriptionReport; list: Anomaly[] }>>();

/**
 * Alertas do histórico todo, uma vez por dataset, idioma e relatório de assinaturas: a barra lateral e o Início pedem
 * os mesmos. O relatório é o da aba Assinaturas (as cobranças dele ficam fora do "valor incomum").
 */
export function anomaliesFor(dataset: Dataset, locale: Locale, report: SubscriptionReport): Anomaly[] {
  let byLocale = anomalyCache.get(dataset);
  if (!byLocale) {
    byLocale = new Map();
    anomalyCache.set(dataset, byLocale);
  }
  const hit = byLocale.get(locale);
  if (hit?.report === report) return hit.list;
  let list: Anomaly[];
  // a barra lateral roda isto fora do ErrorBoundary: um erro aqui não pode derrubar o painel
  try {
    // cobranças de assinatura e de conta recorrente (as do motor) não são "valor incomum"; sem relatório (a análise
    // falhou ou não achou nada), vale o detector antigo
    const opts = report.records.length ? { subscriptionCharges: recurringView(report).recurringChargeIds } : {};
    list = detectAnomalies(dataset, detectSubscriptions(dataset), locale, opts);
  } catch (error) {
    console.error(error);
    list = [];
  }
  byLocale.set(locale, { report, list });
  return list;
}

export function useAttentionDetail(): AttentionDetail {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const { report, checks, pending, toCheck, urgent: renewalUrgent } = useSubscriptions();
  const { dismissed } = useDismissed();
  const anomalies = anomaliesFor(dataset, locale, report);
  const ref = dataset.referenceDate;

  return useMemo(() => {
    const hiddenIds = new Set(dismissed);
    const open = anomalies.filter((a) => !hiddenIds.has(alertId(a)));
    const unexpected = new Set(toCheck.filter((r) => r.justRenewed && checks[r.justRenewed.chargeId] === 'unexpected').map((r) => r.key));
    // renovação recente já conferida: a pergunta seguinte fica no cartão dela, na mesma seção da aba
    const answered = new Set((report.justRenewed ?? []).filter((r) => r.justRenewed && checks[r.justRenewed.chargeId] !== undefined).map((r) => r.key));
    const { attention, items } = attentionOf({ toCheck, pending, unexpected, answered, alerts: open.filter((a) => isRecentAnomaly(a, ref)), renewalUrgent });
    return {
      attention,
      items,
      older: open.filter((a) => !isRecentAnomaly(a, ref)),
      hidden: anomalies.length - open.length,
    };
  }, [anomalies, dismissed, pending, toCheck, checks, report, renewalUrgent, ref]);
}

export function useAttention(): Attention {
  return useAttentionDetail().attention;
}
