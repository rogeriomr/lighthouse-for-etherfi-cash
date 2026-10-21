// Respostas da pessoa sobre as assinaturas (só neste navegador) e o relatório que depende delas.
// A gravação passa por lib/storage.ts (lighthouse:v1:*); a migração das chaves antigas é de lá.
import { useMemo, useSyncExternalStore } from 'react';
import { analyzeSubscriptions, knowledgeFor } from '../lib/subscriptions';
import { plansToCancel } from '../lib/attentionModel';
import type { SubscriptionRecord, SubscriptionReport, UserDecision } from '../lib/subscriptionTypes';
import type { Dataset } from '../lib/types';
import type { Locale } from '../lib/locale';
import { KEYS, syncedStore } from '../lib/storage';
import { useStore } from './store';
import { useLocale } from './locale';

// ---------- respostas ("vou manter", "vou cancelar", "não é assinatura") ----------

const CHOICES: UserDecision['choice'][] = ['keep', 'cancel', 'not_subscription'];

/** A resposta guardada. `done`: a pessoa avisou que já cancelou; só o painel usa, para parar de pedir a ação. */
export type StoredDecision = UserDecision & { done?: boolean };
export type Decisions = Record<string, StoredDecision>;

const isRecord = (raw: unknown): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw);

// descarta só a entrada estragada, nunca o mapa inteiro: as respostas são da pessoa
function validateDecisions(raw: unknown): Decisions | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Decisions = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const { choice, at, forRenewal, done } = value;
    if (!CHOICES.includes(choice as UserDecision['choice']) || typeof at !== 'string') continue;
    out[key] = { choice: choice as UserDecision['choice'], at };
    if (typeof forRenewal === 'string') out[key].forRenewal = forRenewal;
    if (done === true) out[key].done = true;
  }
  return out;
}

const decisionStore = syncedStore<Decisions>(KEYS.decisions, {}, validateDecisions);

/** A resposta vale para a renovação que está pendente agora; na seguinte o motor pergunta de novo. */
export function decide(r: SubscriptionRecord, choice: UserDecision['choice']) {
  const d: StoredDecision = { choice, at: new Date().toISOString() };
  if (r.nextRenewal) d.forRenewal = r.nextRenewal;
  decisionStore.save({ ...decisionStore.snapshot(), [r.key]: d });
}

export function forget(key: string) {
  const next = { ...decisionStore.snapshot() };
  delete next[key];
  decisionStore.save(next);
}

export function markCancelled(key: string) {
  const d = decisionStore.snapshot()[key];
  if (d) decisionStore.save({ ...decisionStore.snapshot(), [key]: { ...d, done: true } });
}

// ---------- conferência das renovações recentes (por cobrança, separada da resposta da próxima renovação) ----------

/** "Você esperava essa renovação?" — por id da cobrança, para a próxima renovação perguntar de novo */
export type RenewalCheck = 'expected' | 'unexpected';
export type Checks = Record<string, RenewalCheck>;

// gravado com a data da resposta, para podar: a renovação recente some da tela em até 45 dias
type StoredChecks = Record<string, { v: RenewalCheck; at: string }>;
const CHECK_TTL_DAYS = 120;

// a leitura converteu o formato antigo ou podou algo: grava de volta uma vez, para a data ficar
let rewrite = false;

function validateChecks(raw: unknown): StoredChecks | undefined {
  if (!isRecord(raw)) return undefined;
  const now = Date.now();
  const out: StoredChecks = {};
  for (const [chargeId, value] of Object.entries(raw)) {
    // formato antigo: só o valor, sem data; ganha a data de hoje e entra na poda a partir dela
    if (value === 'expected' || value === 'unexpected') {
      out[chargeId] = { v: value, at: new Date(now).toISOString() };
      rewrite = true;
    } else if (isRecord(value) && (value.v === 'expected' || value.v === 'unexpected') && typeof value.at === 'string') {
      const at = Date.parse(value.at);
      if (Number.isFinite(at) && now - at <= CHECK_TTL_DAYS * 86400000) out[chargeId] = { v: value.v, at: value.at };
      else rewrite = true;
    } else {
      rewrite = true;
    }
  }
  return out;
}

const checkStore = syncedStore<StoredChecks>(KEYS.checks, {}, validateChecks);

function storedChecks(): StoredChecks {
  const stored = checkStore.snapshot();
  if (rewrite) {
    rewrite = false;
    // fora do render: gravar notifica os assinantes (o snapshot é o mesmo objeto, ninguém re-renderiza)
    queueMicrotask(() => checkStore.save(checkStore.snapshot()));
  }
  return stored;
}

// a tela só precisa do valor; o mapa simples acompanha a identidade do snapshot (estável entre renders)
let plainOf: { from: StoredChecks; checks: Checks } | null = null;
function checksSnapshot(): Checks {
  const stored = storedChecks();
  if (plainOf?.from !== stored) {
    const checks: Checks = {};
    for (const [id, c] of Object.entries(stored)) checks[id] = c.v;
    plainOf = { from: stored, checks };
  }
  return plainOf.checks;
}

export function setRenewalCheck(chargeId: string, value: RenewalCheck | null) {
  const next = { ...storedChecks() };
  if (value) next[chargeId] = { v: value, at: new Date().toISOString() };
  else delete next[chargeId];
  checkStore.save(next);
}

export const renewalCheckOf = (r: SubscriptionRecord, checks: Checks): RenewalCheck | undefined =>
  r.justRenewed ? checks[r.justRenewed.chargeId] : undefined;

// ---------- desfazer ----------

/** O estado das duas respostas de uma assinatura, para o "desfazer" devolver exatamente o que havia. */
export interface AnswerSnapshot {
  key: string;
  decision?: StoredDecision;
  chargeId?: string;
  check?: { v: RenewalCheck; at: string };
}

export function snapshotOf(r: SubscriptionRecord): AnswerSnapshot {
  const chargeId = r.justRenewed?.chargeId;
  return { key: r.key, decision: decisionStore.snapshot()[r.key], chargeId, check: chargeId ? storedChecks()[chargeId] : undefined };
}

export function restore(s: AnswerSnapshot) {
  const decisions = { ...decisionStore.snapshot() };
  if (s.decision) decisions[s.key] = s.decision;
  else delete decisions[s.key];
  decisionStore.save(decisions);
  if (!s.chargeId) return;
  const checks = { ...storedChecks() };
  if (s.check) checks[s.chargeId] = s.check;
  else delete checks[s.chargeId];
  checkStore.save(checks);
}

// ---------- o que pede ação ----------

/**
 * Renovação recente que pede a conferência: ainda sem resposta, ou "não esperava" até a pessoa decidir o que fazer
 * com a assinatura (manter, ou cancelar e marcar que cancelou). Assim o caminho do reembolso fica à vista enquanto
 * importa. "Sim, esperava" encerra.
 */
export function needsCheck(r: SubscriptionRecord, checks: Checks, decisions: Decisions): boolean {
  const j = r.justRenewed;
  if (!j || r.status !== 'active') return false;
  const check = checks[j.chargeId];
  if (!check) return true;
  if (check === 'expected') return false;
  if (!r.decision || r.needsAnswer) return true;
  return r.decision.choice === 'cancel' && !decisions[r.key]?.done;
}

/** Pede ação agora: renovação em janela de aviso sem resposta, ou "vou cancelar" que ainda não foi feito. */
export function awaitsYou(r: SubscriptionRecord, decisions: Decisions): boolean {
  if (r.status !== 'active' || !r.alert) return false;
  if (r.needsAnswer) return true;
  return r.decision?.choice === 'cancel' && !decisions[r.key]?.done;
}

// "vou cancelar" ainda valendo: a regra mora no modelo da contagem (lib/attentionModel.ts), testado no check
export { plansToCancel };

// ---------- relatório ----------

type Analysis = { report: SubscriptionReport; error: unknown };
const EMPTY: SubscriptionReport = { records: [], upcoming: [], alerts: [], monthlyTotalUsd: 0, annualTotalUsd: 0 };
const reports = new WeakMap<Dataset, { decisions: Decisions; locale: Locale; analysis: Analysis }>();

// a barra lateral e a Home também rodam a análise, fora do ErrorBoundary: um erro aqui não pode derrubar o painel
function analysisFor(dataset: Dataset, decisions: Decisions, locale: Locale): Analysis {
  const hit = reports.get(dataset);
  if (hit?.decisions === decisions && hit.locale === locale) return hit.analysis;
  let analysis: Analysis;
  try {
    // knowledgeFor: a pesquisa local antes da base pública (a primeira que casa vence)
    analysis = { report: analyzeSubscriptions(dataset, { knowledge: knowledgeFor(dataset), decisions, today: dataset.referenceDate, locale }), error: null };
  } catch (error) {
    analysis = { report: EMPTY, error };
  }
  reports.set(dataset, { decisions, locale, analysis });
  return analysis;
}

// 2 dias é a última chance de cancelar; a data que passou sem cobrança vem logo depois
const STAGE_RANK: Record<NonNullable<SubscriptionRecord['alert']>, number> = { d2: 0, due: 1, overdue: 1, d7: 2, d30: 2.5, d14: 3 };

export const byUrgency = (a: SubscriptionRecord, b: SubscriptionRecord) =>
  STAGE_RANK[a.alert ?? 'd14'] - STAGE_RANK[b.alert ?? 'd14']
  || (a.daysUntil ?? 0) - (b.daysUntil ?? 0)
  || a.name.localeCompare(b.name);

export function useSubscriptions() {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const decisions = useSyncExternalStore(decisionStore.subscribe, decisionStore.snapshot);
  const checks = useSyncExternalStore(checkStore.subscribe, checksSnapshot);
  const { report, error } = useMemo(() => analysisFor(dataset, decisions, locale), [dataset, decisions, locale]);
  const pending = useMemo(() => report.alerts.filter((r) => awaitsYou(r, decisions)).sort(byUrgency), [report, decisions]);
  const toCheck = useMemo(() => (report.justRenewed ?? []).filter((r) => needsCheck(r, checks, decisions)), [report, checks, decisions]);
  // vermelho na barra só para a renovação a 2 dias; conferir uma renovação recente não é alarme
  const urgent = pending.some((r) => r.alert === 'd2');
  return { report, decisions, checks, pending, toCheck, urgent, error };
}
