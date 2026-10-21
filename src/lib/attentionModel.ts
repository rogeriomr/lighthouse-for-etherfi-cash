// A conta do "esperando você", sem React: src/state/attention.ts junta as entradas (relatório, respostas guardadas,
// alertas) e chama attentionOf; scripts/check-subscriptions.mts confere que o número cai a cada resposta.
import type { Anomaly } from './analytics';
import type { SubscriptionRecord } from './subscriptionTypes';
import { pick, type Locale } from './locale.ts';

/**
 * O número único de "esperando você": a barra, o Início, Gastos e Assinaturas mostram este mesmo total.
 * Conta cada pergunta que espera resposta, para o número cair a cada resposta:
 * - toCheck: renovação recente ainda não conferida ("você esperava?"), ou "não esperava" com algo a fazer.
 * - toAnswer: renovação em janela de aviso sem resposta.
 * - toCancel: respondida "vou cancelar" e ainda não marcada como cancelada.
 * - alerts: alertas de compra dos últimos 30 dias (ALERT_WINDOW_DAYS) que a pessoa não marcou "Já conferi".
 * A assinatura com as duas perguntas (conferir a renovação que aconteceu e responder sobre a próxima) é um item só,
 * 'check' com `next`, e conta 2: uma em toCheck e outra em toAnswer ou toCancel. Depois de "não esperava", a conferência
 * está respondida e o que falta é decidir: se a próxima renovação já pede resposta, conta 1, só em toAnswer ou toCancel.
 */
export interface Attention {
  total: number;
  /** renovações em janela de aviso sem resposta */
  toAnswer: number;
  /** marcadas "vou cancelar" e ainda não canceladas */
  toCancel: number;
  /** renovações recentes ainda não conferidas */
  toCheck: number;
  /** toCheck + toAnswer + toCancel: o que a aba Assinaturas resolve */
  renewals: number;
  /** alertas de compra recentes em aberto: ficam no Início */
  alerts: number;
  /** algo de fato urgente (renovação a 2 dias, cobrança repetida ainda a confirmar): só isso fica vermelho */
  urgent: boolean;
}

export type AttentionItem =
  /** next: a mesma assinatura também espera a pergunta da próxima renovação (só em 'check'); as duas aparecem juntas */
  | { kind: 'check'; r: SubscriptionRecord; next?: 'answer' | 'cancel' }
  /**
   * recent: a renovação recente da mesma assinatura já foi conferida ("sim, esperava" ou "não esperava"); a pergunta é
   * responder, mas fica no cartão da renovação recente, logo abaixo da conferência (e do caminho do reembolso)
   */
  | { kind: 'answer' | 'cancel'; r: SubscriptionRecord; recent?: boolean }
  | { kind: 'alert'; a: Anomaly };

/** Quantas respostas o item espera: 2 na assinatura com as duas perguntas. */
export const questionsOf = (it: AttentionItem): number => (it.kind === 'check' && it.next ? 2 : 1);

/** "Vou cancelar" respondido para esta renovação e ainda valendo */
export const plansToCancel = (r: SubscriptionRecord) => r.decision?.choice === 'cancel' && !r.needsAnswer;

// primeiro o que não pode esperar (2 dias, cobrança repetida a confirmar); depois a renovação recente para conferir e o
// risco alto a 30 dias; depois as outras renovações da semana, os alertas para conferir, os avisos de 14 ou 30 dias
// e, por fim, o que é só para saber
export function attentionRank(it: AttentionItem): number {
  if (it.kind === 'alert') return it.a.urgent ? 0 : it.a.group === 'check_now' ? 3 : 5;
  if (it.r.alert === 'd2') return 0;
  if (it.kind === 'check' || (it.r.risk === 'high' && it.r.alert === 'd30')) return 1;
  return it.r.alert === 'd14' || it.r.alert === 'd30' ? 4 : 2;
}

/**
 * toCheck: renovações recentes a conferir; pending: renovações em aviso esperando resposta ou "vou cancelar" por fazer;
 * unexpected: chaves cuja renovação recente a pessoa marcou "não esperava"; answered: chaves cuja renovação recente já
 * foi conferida (qualquer resposta); alerts: alertas de compra recentes ainda em aberto. Devolve a conta e os itens na
 * ordem do Início.
 */
export function attentionOf(input: {
  toCheck: SubscriptionRecord[];
  pending: SubscriptionRecord[];
  unexpected?: ReadonlySet<string>;
  answered?: ReadonlySet<string>;
  alerts: Anomaly[];
  renewalUrgent: boolean;
}): { attention: Attention; items: AttentionItem[] } {
  const { pending, alerts: recent, renewalUrgent } = input;
  const nextOf = (r: SubscriptionRecord) => (plansToCancel(r) ? ('cancel' as const) : ('answer' as const));
  const pendingByKey = new Map(pending.map((r) => [r.key, r]));
  // "não esperava" com a próxima renovação pedindo resposta: a decisão pendente já é o passo que falta
  const merged = new Set(input.toCheck.filter((r) => input.unexpected?.has(r.key) && pendingByKey.has(r.key)).map((r) => r.key));
  const toCheck = input.toCheck.filter((r) => !merged.has(r.key));
  const checkKeys = new Set(toCheck.map((r) => r.key));
  const items: AttentionItem[] = [
    ...toCheck.map((r): AttentionItem => {
      const next = pendingByKey.get(r.key);
      return next ? { kind: 'check', r, next: nextOf(next) } : { kind: 'check', r };
    }),
    ...pending.filter((r) => !checkKeys.has(r.key)).map((r): AttentionItem => (merged.has(r.key) || input.answered?.has(r.key) ? { kind: nextOf(r), r, recent: true } : { kind: nextOf(r), r })),
    ...recent.map((a): AttentionItem => ({ kind: 'alert', a })),
  ].sort((x, y) => attentionRank(x) - attentionRank(y));
  // a segunda pergunta de um 'check' conta no balde dela
  const { toAnswer, toCancel, toCheck: checking } = questionCounts(items);
  const alerts = items.filter((it) => it.kind === 'alert').length;
  return {
    attention: {
      total: toAnswer + toCancel + checking + alerts,
      toAnswer,
      toCancel,
      toCheck: checking,
      renewals: toAnswer + toCancel + checking,
      alerts,
      urgent: renewalUrgent || recent.some((a) => a.urgent),
    },
    items,
  };
}

/** Perguntas por tipo: a divisão única do app. O resumo (attentionSummary) e cada seção da aba Assinaturas contam assim. */
export interface QuestionCounts {
  toAnswer: number;
  toCancel: number;
  toCheck: number;
}

/** A pergunta seguinte de um 'check' conta no tipo dela: "manter ou cancelar?" é responder, mesmo no cartão da renovação recente. */
export function questionCounts(items: AttentionItem[]): QuestionCounts {
  const count = (kind: 'answer' | 'cancel' | 'check') => items.filter((it) => it.kind === kind || (it.kind === 'check' && it.next === kind)).length;
  return { toAnswer: count('answer'), toCancel: count('cancel'), toCheck: count('check') };
}

/**
 * As duas seções da aba Assinaturas, na ordem do Início: "renovaram há pouco" (os 'check', com a pergunta seguinte no
 * mesmo cartão, e a pergunta seguinte de uma renovação recente já conferida) e "renovam em breve" (responder ou cancelar). As perguntas de
 * cada uma saem de questionCounts: o tipo da pergunta não muda com a seção, então as somas fecham com o resumo.
 */
export function attentionSections(items: AttentionItem[]): { recent: AttentionItem[]; soon: AttentionItem[] } {
  const isRecent = (it: AttentionItem) => it.kind === 'check' || ((it.kind === 'answer' || it.kind === 'cancel') && Boolean(it.recent));
  return {
    recent: items.filter(isRecent),
    soon: items.filter((it) => (it.kind === 'answer' || it.kind === 'cancel') && !isRecent(it)),
  };
}

// número e palavra presos (NBSP): "6 renovações" e "2 dias" nunca quebram no meio
const NB = '\u00a0';
// o "·" fica preso ao item anterior: a linha quebra depois dele, nunca com o separador no começo
const SEP = `${NB}· `;

/** "15 waiting on you" / "15 esperando você": a única expressão para o total, em todo o app. */
export function waitingLabel(n: number, locale: Locale): string {
  return pick(locale, `${n}${NB}waiting on you`, `${n}${NB}esperando você`);
}

/**
 * "6 renewals to answer · 1 to cancel · 7 renewals to check": as perguntas, na mesma ordem e com as mesmas palavras em
 * todo lugar. short tira "renovação" (dentro de uma seção de renovações): "1 para responder · 6 para conferir".
 */
export function questionsSummary(c: QuestionCounts, locale: Locale, opts: { short?: boolean } = {}): string {
  const what = (n: number, en: string, pt: string) => (opts.short ? pick(locale, en, pt)
    : n === 1 ? pick(locale, `renewal ${en}`, `renovação ${pt}`) : pick(locale, `renewals ${en}`, `renovações ${pt}`));
  const parts: string[] = [];
  if (c.toAnswer) parts.push(`${c.toAnswer}${NB}${what(c.toAnswer, 'to answer', 'para responder')}`);
  if (c.toCancel) parts.push(`${c.toCancel}${NB}${pick(locale, 'to cancel', 'para cancelar')}`);
  if (c.toCheck) parts.push(`${c.toCheck}${NB}${what(c.toCheck, 'to check', 'para conferir')}`);
  return parts.join(SEP);
}

/** "2 renewals to answer · 1 to cancel · 1 renewal to check · 3 alerts": a mesma composição em todo lugar. */
export function attentionSummary(a: Attention, locale: Locale): string {
  const parts = [questionsSummary(a, locale)].filter(Boolean);
  if (a.alerts) parts.push(a.alerts === 1 ? pick(locale, `1${NB}alert`, `1${NB}alerta`) : pick(locale, `${a.alerts}${NB}alerts`, `${a.alerts}${NB}alertas`));
  return parts.join(SEP);
}
