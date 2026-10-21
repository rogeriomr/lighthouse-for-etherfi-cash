// Contrato da análise de assinaturas: base de conhecimento (pesquisa), evidências de email e o registro final.
// Arquivos com dados pessoais (evidências do email, pesquisa sobre estabelecimentos da pessoa) ficam em
// fixtures/live/ (fora do git); só conhecimento público e genérico entra no código.
import type { LocalizedText } from './locale';
import type { Transaction } from './types';

export type Cycle = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'unknown';

/** O que se sabe publicamente sobre um serviço: costuma ser assinatura? em quais ciclos? onde cancelar? */
export interface KnowledgeItem {
  /** Trechos do texto da fatura ou do nome legível que identificam o serviço (sem diferenciar maiúsculas) */
  matchers: string[];
  name: string;
  isSubscription: 'yes' | 'no' | 'maybe';
  cycles: Cycle[];
  /** Uma frase sobre como cobra; no código vem nas duas línguas, na pesquisa local pode vir numa só */
  note?: LocalizedText;
  /** Página oficial para gerenciar ou cancelar */
  manageUrl?: string;
  /** Links de onde a informação veio */
  sources: string[];
  /** Sites do próprio serviço ("claude.ai"), além do de manageUrl: link de email ou da IA fora deles fica "não verificado" */
  domains?: string[];
  /** Cada compra é um item que renova por conta própria (domínios): compra sem renovação vira um registro próprio */
  itemized?: boolean;
  /** Cobre várias marcas (planos de operadora): não dá o próprio nome às cobranças; cada estabelecimento fica com o seu */
  generic?: boolean;
  /** A renovação é cobrada tantos dias antes do fim do período pago (domínios na Vercel: 30) */
  chargeLeadDays?: number;
}

export interface KnowledgeFile {
  generatedAt: string;
  items: KnowledgeItem[];
}

export type EvidenceKind = 'receipt' | 'renewal_notice' | 'trial_ending' | 'cancellation' | 'price_change' | 'signup';

/** Um email que confirma ou desmente uma assinatura. Só campos extraídos, nunca o corpo do email. */
export interface EvidenceItem {
  /** Nome legível igual ao do painel quando possível (ex.: "Claude (Anthropic)") */
  name: string;
  matchers: string[];
  kind: EvidenceKind;
  /** AAAA-MM-DD */
  emailDate: string;
  /** Assunto encurtado, sem dados pessoais além do nome do serviço */
  subject: string;
  plan?: string;
  amount?: number;
  currency?: string;
  cycle: Cycle;
  /** Fim do período pago ou próxima renovação informada no email (AAAA-MM-DD) */
  periodEnd?: string;
  manageUrl?: string;
}

export interface EvidenceFile {
  generatedAt: string;
  source: string;
  items: EvidenceItem[];
}

/** Resposta da pessoa, guardada só no navegador. Vale até a renovação indicada; depois o painel pergunta de novo. */
export interface UserDecision {
  choice: 'keep' | 'cancel' | 'not_subscription';
  /** ISO de quando respondeu */
  at: string;
  /** Renovação (AAAA-MM-DD) a que a resposta se refere */
  forRenewal?: string;
}

/** d30 só existe para risco alto (15 a 30 dias antes da renovação) */
export type AlertStage = 'd30' | 'd14' | 'd7' | 'd2' | 'due' | 'overdue';

/** Risco de a pessoa ser cobrada sem perceber; 'unknown' quando não há auditoria nem a heurística dispara */
export type RiskLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface SubscriptionSignal {
  /** 'audit': da auditoria de renovação (leitura dos termos do site e do email), com a fonte */
  kind: 'recurrence' | 'dictionary' | 'knowledge' | 'research' | 'email' | 'audit';
  /** Frase curta no idioma pedido explicando o sinal */
  detail: string;
  /** Link da fonte: só https (safeUrl); texto que não é link (ex.: "email: assunto") fica em sourceText */
  source?: string;
  sourceText?: string;
  /** false quando o link veio da IA (pesquisa ou auditoria) e o host não é um site conhecido do serviço: "não verificado" */
  sourceVerified?: boolean;
}

/** A última cobrança é uma renovação recente (até 45 dias) ou ainda pendente: dá tempo de pedir reembolso? */
export interface JustRenewed {
  chargeId: string;
  /** AAAA-MM-DD da cobrança */
  date: string;
  /** Dias desde a cobrança até hoje */
  daysAgo: number;
  pending: boolean;
  /** Valor da cobrança anterior da mesma assinatura, na moeda dela */
  previousAmount?: number;
  previousCurrency?: string;
  /** O valor mudou mais de 1% em relação à cobrança anterior (na moeda local; em USD quando as moedas diferem) */
  priceChanged?: boolean;
  /** Da auditoria: dias depois da renovação em que dá para pedir reembolso (0 = os termos negam) */
  refundWindowDays?: number;
  /** refundWindowDays − daysAgo (negativo = o prazo passou); null quando os termos negam reembolso; ausente sem auditoria que informe */
  refundDaysLeft?: number | null;
}

export interface SubscriptionRecord {
  /** Chave estável (para guardar a decisão da pessoa) */
  key: string;
  name: string;
  /**
   * 'bill': conta recorrente (aluguel, condomínio, seguro), achada só pela recorrência. Não tem aviso nem pergunta
   * "manter ou cancelar?", não entra no .ics nem nos totais de assinatura.
   */
  kind: 'subscription' | 'bill';
  brand?: string;
  category?: string;
  /** 'unknown' também quando o período pago passa de um ano (domínio de 2 ou 3 anos): aí termMonths diz o prazo */
  cycle: Cycle;
  /** Prazo em meses de um período pago de mais de um ano (pelo email): sem RRULE, custo por mês = cobrança ÷ prazo */
  termMonths?: number;
  cycleSource: 'email' | 'recurrence' | 'knowledge' | 'research' | 'estimate';
  confidence: 'high' | 'medium' | 'low';
  signals: SubscriptionSignal[];
  /** Cobranças no cartão, mais antiga primeiro */
  charges: Transaction[];
  lastCharge: Transaction;
  /** Próxima renovação prevista (AAAA-MM-DD) ou null quando não dá para prever */
  nextRenewal: string | null;
  daysUntil: number | null;
  alert: AlertStage | null;
  status: 'active' | 'maybe_cancelled' | 'cancelled' | 'not_subscription';
  monthlyCostUsd: number;
  annualCostUsd: number;
  /** Cobrança por uso (o valor varia muito): o custo é a média das últimas 3 cobranças, mostrado com "≈" */
  costApprox: boolean;
  plan?: string;
  /** Página para gerenciar ou cancelar: só https (safeUrl) */
  manageUrl?: string;
  /** false quando o link veio do email ou da IA e o host não é um host da base pública: a tela marca "não verificado" */
  manageUrlVerified?: boolean;
  /** Hosts exatos do serviço na base pública (manageUrl e domains): as fontes da auditoria fora deles saem "não verificado" */
  verifiedHosts?: string[];
  decision?: UserDecision;
  /** true quando a decisão guardada venceu (a renovação a que ela se referia passou) e é hora de perguntar de novo */
  needsAnswer: boolean;
  /** Auditoria do modelo de renovação que casou (o primeiro item do arquivo cujo trecho casa; senão o de nome igual) */
  audit?: RenewalAuditItem;
  /**
   * Da auditoria; sem auditoria, 'high' pela heurística (ciclo anual, última cobrança ≥ US$ 100 e nenhum aviso de
   * renovação no email) ou 'unknown'.
   */
  risk: RiskLevel;
  /** De onde veio o risco; ausente quando 'unknown' */
  riskSource?: 'audit' | 'heuristic';
  justRenewed?: JustRenewed;
}

export interface SubscriptionReport {
  records: SubscriptionRecord[];
  /** Ativas com renovação nos próximos 60 dias, da mais próxima para a mais distante */
  upcoming: SubscriptionRecord[];
  /** Ativas em uma das janelas de aviso (30 só no risco alto, 14, 7 ou 2 dias, ou vencida há pouco) que não foram marcadas como "não é assinatura" */
  alerts: SubscriptionRecord[];
  /** Só assinaturas ativas (contas recorrentes ficam fora) */
  monthlyTotalUsd: number;
  annualTotalUsd: number;
  /** Algum custo do total é estimado (cobrança por uso): o total sai com "≈". O motor sempre preenche */
  monthlyApprox?: boolean;
  /**
   * Renovações recentes que pedem atenção, da cobrança mais recente para a mais antiga: as com justRenewed e ciclo
   * mais longo que mensal, preço que mudou, cobrança pendente ou reembolso ainda possível (mensal e semanal estão
   * sempre a menos de 45 dias da última cobrança). O motor sempre preenche; opcional só para relatório vazio montado à mão
   */
  justRenewed?: SubscriptionRecord[];
  /** Ativas com risco alto, da renovação mais próxima para a mais distante (sem data no fim). O motor sempre preenche */
  atRisk?: SubscriptionRecord[];
}

/** "Recorrente" para o resto do painel (Gastos, mês a mês, alertas): uma linha por registro do motor. */
export interface RecurringItem {
  key: string;
  /** Nome do registro ("Amazon Prime", não "Amazon") */
  name: string;
  /** 'bill': conta recorrente (aluguel, condomínio, seguro), que não é assinatura */
  kind: 'subscription' | 'bill';
  status: SubscriptionRecord['status'];
  category?: string;
  cycle: Cycle;
  /** Custo por mês em USD; 0 sem ciclo conhecido */
  monthlyUsd: number;
  /** Custo estimado (cobrança por uso, média das últimas): mostrar com "≈" */
  approx: boolean;
  /** Primeira e última cobrança do registro (Transaction.date: hora local) */
  firstDate: string;
  lastDate: string;
  chargeIds: string[];
}

/** A fonte única de "recorrente" (recurringView): o mesmo relatório da aba Assinaturas. */
export interface RecurringView {
  /** Assinaturas e contas recorrentes, sem as marcadas "não é assinatura" */
  items: RecurringItem[];
  /** Cobranças de assinaturas, em qualquer status: o balde "Assinaturas e software" de Gastos */
  subscriptionChargeIds: ReadonlySet<string>;
  /** Cobranças de assinaturas e de contas recorrentes: ficam fora do alerta de "valor incomum" */
  recurringChargeIds: ReadonlySet<string>;
  /** Igual ao total por mês da aba Assinaturas (só assinaturas ativas) */
  monthlyTotalUsd: number;
  monthlyApprox: boolean;
}

/** Os avisos: 2 semanas, 1 semana e 2 dias antes da renovação */
export const ALERT_DAYS = [14, 7, 2] as const;
/** Risco alto ganha um aviso a mais, 30 dias antes */
export const HIGH_RISK_ALERT_DAYS = [30, 14, 7, 2] as const;

/**
 * Auditoria do modelo de renovação de um serviço, feita pela IA da pessoa: lê os termos no site do serviço
 * e procura no email avisos de cadastro e de renovação. Serve para pegar a renovação anual "nas letras miúdas"
 * antes que ela aconteça — e, quando já aconteceu, dizer se ainda há janela de reembolso.
 * Arquivo local (fixtures/live/renewal-audit.json): é sobre os serviços da pessoa.
 */
export interface RenewalAuditItem {
  name: string;
  matchers: string[];
  /** Renova sozinho se a pessoa não fizer nada? */
  autoRenew: 'yes' | 'no' | 'unknown';
  /** O serviço avisa por email antes de renovar? ('no' quando os termos dizem que não, ou não há aviso no email na última renovação) */
  noticeBeforeRenewal: 'yes' | 'no' | 'unknown';
  /** Com quantos dias de antecedência avisa, quando avisa */
  noticeDays?: number;
  /** Até quando dá para cancelar sem ser cobrado (ex.: "até 24 h antes da renovação") */
  cancelDeadline?: LocalizedText;
  /** Dias depois da renovação em que ainda dá para pedir reembolso (0 = os termos dizem que não há) */
  refundWindowDays?: number;
  refundNote?: LocalizedText;
  /** Preço muda na renovação? (promoção do 1º ano que vira preço cheio etc.) */
  priceChangeAtRenewal?: LocalizedText;
  /** A renovação é cobrada tantos dias antes do fim do período pago; vale mais que o da base */
  chargeLeadDays?: number;
  manageUrl?: string;
  /** Páginas e evidências usadas (URLs dos termos/ajuda; emails só como "email: <assunto curto>, <data>") */
  sources: string[];
  /** O que foi conferido de fato */
  checked: ('website' | 'email')[];
  /** AAAA-MM-DD */
  checkedAt: string;
  /** Risco de a pessoa ser cobrada sem perceber */
  risk: 'high' | 'medium' | 'low';
  riskReasons: LocalizedText[];
}

export interface RenewalAuditFile {
  generatedAt: string;
  items: RenewalAuditItem[];
}
