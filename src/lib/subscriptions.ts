// Assinaturas a partir das compras no cartão, dos emails (evidências) e do que se sabe de cada serviço.
// Regras (scripts/check-subscriptions.mts fixa cada uma):
// - Grupo = estabelecimento (nome legível) + item da base ou do email que casou, não marca: o clube da loja ≠ as
//   compras na loja, o vídeo ≠ o armazenamento da mesma empresa. Base: o primeiro item da lista que casa vence (a lista vai do específico para o
//   genérico, como no merchants.ts); trecho antes de nome igual. Item que casa só pelo texto da fatura com parte das
//   cobranças (o "clube" no app de delivery, os domínios na hospedagem) separa essa parte, com o nome do item. Emails
//   de mesmo nome sem trecho em comum também separam (plano mensal × domínio anual); email que casa só pelo texto da
//   fatura dá o nome dele às cobranças, juntando descritores diferentes da mesma assinatura.
// - Entra: dicionário do painel (subscriptionHint), base 'yes'/'maybe', email, ou recorrência: ≥ 2 cobranças com
//   intervalos de um mesmo ciclo e valor local variando até 25% (semanal pede 3). Sem outro sinal, nenhuma outra compra
//   do estabelecimento pode cair no meio da sequência. Delivery, restaurantes, mercado, transporte e saúde só entram
//   com base 'yes', email ou dicionário (academia). Base 'no' exclui, salvo com email, ou com dicionário quando a base
//   só casou por trecho do nome. Só a recorrência, sem nenhum outro sinal: recarga de saldo não entra, semanal não
//   entra (mercado, lavanderia), e fora de software, celular, lazer e educação só com valor baixo (até US$ 30);
//   aluguel, condomínio, seguro e escola viram conta recorrente (kind 'bill': sem aviso, pergunta, risco, .ics nem total).
//   Item genérico da base (plano de operadora) não dá o próprio nome: a parte fica "Vivo · Easy".
// - Um estabelecimento pode ter mais de uma assinatura (dois planos, duas inscrições de canal): cada sequência de
//   valor próprio vira um registro; a mais antiga fica com o nome do estabelecimento, as outras levam o valor no nome.
//   Com outro sinal, a cobrança na data esperada continua a sequência mesmo com valor diferente (uso, reajuste). Item a
//   item (domínios, itemized na base): cada compra que não renovou também é um registro.
// - Ciclo: email (dito, ou deduzido do periodEnd) > recorrência > base com um ciclo só > pesquisa com um ciclo só >
//   estimativa. A estimativa só existe quando o serviço oferece mais de um ciclo: sai o ciclo que já teria renovado
//   sem aparecer no cartão; entre os que sobram, US$ 60 ou mais indica o mais longo, até US$ 25 o mais curto, e no
//   meio fica 'unknown'.
// - Próxima renovação: periodEnd do email mais recente quando passa da última cobrança por mais que a tolerância
//   (colado nela é a renovação que já aconteceu); senão última cobrança + 1 ciclo em mês de calendário, mantendo o
//   dia (31/01 → 28/02 → 31/03). Quem cobra antes do vencimento (chargeLeadDays: domínios na Vercel, 30) renova no fim do
//   período do recibo menos o lead, e a 1ª compra, em 1 ciclo menos o lead. Período pago de mais de 380 dias (domínio de
//   2 ou 5 anos) não é anual: ciclo 'unknown' com termMonths, sem RRULE, custo = cobrança ÷ prazo.
// - Custo por mês: última cobrança ÷ meses do ciclo; cobrança por uso (o valor sobe e desce), a média das 3 últimas,
//   com costApprox ("≈" na tela). Confiança alta pede email ou 3+ cobranças, e nunca com ciclo estimado ou só a recorrência.
// - Links (gerenciar e fontes) só https (url.ts); o que veio do email ou da IA fora dos sites do serviço na base sai
//   "não verificado".
// - Status: decisão "não é assinatura" > email de cancelamento no dia da última cobrança ou depois > última cobrança
//   estornada > renovação vencida além da tolerância (semanal 3d, mensal 7d, trimestral e semestral 15d, anual 30d) >
//   sem ciclo e sem cobrança há mais de 410 dias > ativa. Aviso só na ativa: 8–14 dias d14, 3–7 d7, 0–2 d2, −1 a −3 due.
// - Decisão vale para forRenewal (sem ela, até a próxima cobrança); vencida, pergunta de novo. Sem decisão, pergunta
//   quando há aviso. "Não é assinatura" não vence.
// - Auditoria de renovação (subscriptionSources.audit): o primeiro item que casa por trecho (senão por nome) dá o risco
//   e os sinais (renova sozinho, aviso, prazo, reembolso, preço). Sem auditoria, plano anual ≥ US$ 100 sem aviso de
//   renovação no email é risco alto pela heurística. Risco alto ganha o aviso d30 (15 a 30 dias) e o alarme de 30 dias
//   no .ics. Última cobrança que é renovação de até 45 dias (ou pendente) ganha justRenewed, com a janela de reembolso.
// - Idioma: sinais, nomes gerados e o .ics seguem opts.locale (padrão 'en'); dinheiro e datas seguem o format.ts, que a
//   tela põe no mesmo idioma. A chave (e o UID) não muda com o idioma: sai do nome em português do merchants.ts e, nas
//   sequências extras, do valor cru — no mesmo formato das chaves salvas antes do inglês.
import type { Dataset, Transaction } from './types';
import type {
  AlertStage, Cycle, EvidenceItem, EvidenceKind, KnowledgeItem, SubscriptionRecord, SubscriptionReport, SubscriptionSignal, UserDecision,
} from './subscriptionTypes';
import type { JustRenewed, RecurringItem, RecurringView, RenewalAuditItem, RiskLevel } from './subscriptionTypes';
import { ALERT_DAYS, HIGH_RISK_ALERT_DAYS } from './subscriptionTypes.ts';
import { SUBSCRIPTION_KNOWLEDGE } from './subscriptionKnowledge.ts';
import { isKnownHost, safeUrl, urlHost } from './url.ts';
import { clip } from './cleanText.ts';
import { isBalanceTopUp, isSpend } from './analytics.ts';
import { txInstant } from './enrich.ts';
import { dateFull, money } from './format.ts';
import { LOCALES, localized, pick, type Locale } from './locale.ts';
import { CATEGORY, describeMerchant } from './merchants.ts';

const R2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;

type KnownCycle = Exclude<Cycle, 'unknown'>;

interface CycleRule {
  /** Intervalo entre cobranças, em dias, que conta como este ciclo */
  gap: [number, number];
  /** Atraso aceito na renovação antes de "talvez cancelada" */
  tolerance: number;
  /** Duração em meses: soma em mês de calendário e normaliza o custo (semanal = 12/52) */
  months: number;
  label: { en: string; pt: string };
}

const CYCLES: Record<KnownCycle, CycleRule> = {
  weekly: { gap: [6, 8], tolerance: 3, months: 12 / 52, label: { en: 'weekly', pt: 'semanal' } },
  monthly: { gap: [27, 35], tolerance: 7, months: 1, label: { en: 'monthly', pt: 'mensal' } },
  quarterly: { gap: [85, 95], tolerance: 15, months: 3, label: { en: 'quarterly', pt: 'trimestral' } },
  semiannual: { gap: [175, 190], tolerance: 15, months: 6, label: { en: 'semiannual', pt: 'semestral' } },
  annual: { gap: [350, 380], tolerance: 30, months: 12, label: { en: 'annual', pt: 'anual' } },
};
const CYCLE_ORDER = Object.keys(CYCLES) as KnownCycle[];
const cycleLabel = (c: KnownCycle, locale: Locale) => CYCLES[c].label[locale];
const cycleList = (cs: KnownCycle[], locale: Locale) => cs.map((c) => cycleLabel(c, locale)).join(pick(locale, ' or ', ' ou '));

// Nessas categorias repetir é rotina (o mesmo restaurante, a mesma corrida), não assinatura
const NEEDS_CONFIRMATION = new Set<string>([CATEGORY.delivery, CATEGORY.dining, CATEGORY.groceries, CATEGORY.transport, CATEGORY.health]);

/** Variação aceita do valor local entre cobranças da mesma assinatura */
const STABLE = 0.25;
const LARGE_USD = 60;
const SMALL_USD = 25;
/** Sem ciclo conhecido: nenhum ciclo fica tanto tempo sem cobrar (anual + tolerância) */
const STALE_DAYS = 410;
const UPCOMING_DAYS = 60;
/** Renovação tão recente que ainda vale olhar reembolso */
const JUST_RENEWED_DAYS = 45;
/** Sem auditoria: plano anual a partir disso, sem aviso no email, conta como risco alto */
const HEURISTIC_USD = 100;
/** Sem outro sinal, a recorrência só vira assinatura nestas categorias ou com valor baixo (mediana da sequência) */
const SUBSCRIPTION_LIKE = new Set<string>([CATEGORY.software, CATEGORY.phone, CATEGORY.leisure, CATEGORY.education]);
const LOW_USD = 30;
/** Período pago acima disso (descontado o lead) não é anual: é plurianual (domínio de 2, 3 ou 5 anos) */
const ANNUAL_MAX_DAYS = 380;
// Aluguel, condomínio, seguro e mensalidade escolar cobram todo mês, mas não se "mantém ou cancela": viram conta
// recorrente ("RENT" sem "RENT A CAR", que é aluguel de carro)
const BILL = /\b(aluguel|aluguer|imobiliaria|condominio|condominial|seguro|seguros|seguradora|insurance|assurance|versicherung|miete|alquiler|arriendo|hoa|lease|rent|escola|colegio|faculdade|universidade|tuition|school)\b(?! ?a ?car)/;

const EVIDENCE_LABEL: Record<EvidenceKind, { en: string; pt: string }> = {
  receipt: { en: 'receipt', pt: 'recibo' },
  renewal_notice: { en: 'renewal notice', pt: 'aviso de renovação' },
  trial_ending: { en: 'trial-ending notice', pt: 'aviso de fim do teste' },
  cancellation: { en: 'cancellation', pt: 'cancelamento' },
  price_change: { en: 'price-change notice', pt: 'aviso de reajuste' },
  signup: { en: 'sign-up confirmation', pt: 'confirmação de assinatura' },
};

// ---------- datas (dia UTC, como o resto do painel) ----------

const dayOf = (iso: string) => iso.slice(0, 10);
const tsOf = (day: string) => Date.parse(`${day}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((tsOf(to) - tsOf(from)) / DAY);
const addDays = (day: string, n: number) => new Date(tsOf(day) + n * DAY).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// data por extenso no idioma do format.ts ("Oct 11, 2026" / "11 de out. de 2026")
const dayText = (day: string) => dateFull(`${day}T00:00:00Z`);
const byDate = (a: Transaction, b: Transaction) => Date.parse(a.date) - Date.parse(b.date);
const after = (a: Transaction, b: Transaction) => Date.parse(a.date) > Date.parse(b.date);

function isMonthEnd(day: string): boolean {
  const [y, m, d] = day.split('-').map(Number);
  return d === daysInMonth(y, m);
}

function addMonths(day: string, n: number, anchor: number): string {
  const [y, m] = day.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(anchor, daysInMonth(ny, nm)))}`;
}

function addCycle(day: string, cycle: KnownCycle, anchor: number): string {
  return cycle === 'weekly' ? addDays(day, 7) : addMonths(day, CYCLES[cycle].months, anchor);
}

/** Dia do mês a manter: um 28/02 depois de cobranças no dia 31 continua sendo "dia 31". */
function anchorDay(sorted: Transaction[]): number {
  const last = dayOf(sorted[sorted.length - 1].date);
  const d = Number(last.slice(8, 10));
  return isMonthEnd(last) ? Math.max(d, ...sorted.slice(-3).map((t) => Number(t.date.slice(8, 10)))) : d;
}

function classify(days: number): KnownCycle | null {
  return CYCLE_ORDER.find((c) => days >= CYCLES[c].gap[0] && days <= CYCLES[c].gap[1]) ?? null;
}

/** Risco alto ganha a janela de 15 a 30 dias (d30), para dar tempo de ler os termos e cancelar. */
function alertFor(days: number, highRisk: boolean): AlertStage | null {
  if (days > 30) return null;
  if (days >= 15) return highRisk ? 'd30' : null;
  if (days >= 8) return 'd14';
  if (days >= 3) return 'd7';
  if (days >= 0) return 'd2';
  if (days >= -3) return 'due';
  return null;
}

// ---------- casamento com a base e com o email ----------

interface Matchable { name: string; matchers: string[] }

interface Prepared<T extends Matchable> {
  item: T;
  key: string;
  name: string;
  /** Trechos sem acento e em minúsculas; originals guarda o texto como veio, para dar nome a uma parte */
  matchers: string[];
  originals: string[];
}

/** Item da base na posição da lista: a ordem vai do específico para o genérico */
interface KnownItem {
  p: Prepared<KnowledgeItem>;
  index: number;
  research: boolean;
}

interface KnownMatch extends KnownItem {
  /** Casou pelo nome do grupo: um 'no' assim vale mais que o dicionário */
  byName: boolean;
}

interface Group {
  key: string;
  name: string;
  /** Cobranças, mais antiga primeiro */
  charges: Transaction[];
  refunds: Transaction[];
  pub: KnownMatch | null;
  res: KnownMatch | null;
  /** O primeiro da lista entre os dois: decide se é assinatura */
  know: KnownMatch | null;
  /** Emails do grupo, do mais antigo para o mais recente */
  evidence: EvidenceItem[];
}

interface Tag {
  t: Transaction;
  pub: KnownItem | null;
  res: KnownItem | null;
  /** Assinatura do email cujo trecho mais longo casou com a cobrança, e esse trecho como veio */
  ident: number | null;
  evMatcher: string;
  kMatcher: string;
  /** Nome exibido, no idioma da tela */
  name: string;
  /** Nome de onde sai a chave: não muda com o idioma */
  keyName: string;
}

const plain =(s: string | undefined) => (s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim();

const textCache = new WeakMap<Transaction, { raw: string; name: string }>();
function textOf(t: Transaction): { raw: string; name: string } {
  let c = textCache.get(t);
  if (!c) {
    c = { raw: plain(t.merchantRaw), name: plain(t.merchant) };
    textCache.set(t, c);
  }
  return c;
}

const keyNameCache = new Map<string, string>();
/**
 * A chave sai do nome que o merchants.ts dá em português ("Uber · corrida", não "Uber · ride"): a resposta salva vale
 * nos dois idiomas e bate com as chaves de antes do inglês. Nome que não veio do merchants.ts fica como está.
 */
function keyNameOf(t: Transaction): string {
  const merchant = t.merchant ?? '';
  const id = `${t.merchantRaw ?? ''}\u0000${t.categoryRaw ?? ''}\u0000${merchant}`;
  let name = keyNameCache.get(id);
  if (name === undefined) {
    const raw = t.merchantRaw ?? merchant;
    const pt = describeMerchant(raw, t.categoryRaw, 'pt').name;
    name = pt && (merchant === pt || merchant === describeMerchant(raw, t.categoryRaw, 'en').name) ? pt : merchant;
    keyNameCache.set(id, name);
  }
  return name;
}

function prepare<T extends Matchable>(items: T[]): Prepared<T>[] {
  return items.map((item) => {
    const byPlain = new Map<string, string>();
    for (const m of item.matchers) if (plain(m) && !byPlain.has(plain(m))) byPlain.set(plain(m), m.trim());
    return { item, key: subscriptionKey(item.name), name: plain(item.name), matchers: [...byPlain.keys()], originals: [...byPlain.values()] };
  });
}

/** Posição do trecho mais longo do item que aparece no texto da fatura ou no nome legível; -1 quando nenhum aparece. */
function longestHit(p: Prepared<Matchable>, t: Transaction): number {
  const { raw, name } = textOf(t);
  let best = -1;
  p.matchers.forEach((m, i) => {
    if ((raw.includes(m) || name.includes(m)) && (best < 0 || m.length > p.matchers[best].length)) best = i;
  });
  return best;
}

function hits(p: Prepared<Matchable>, t: Transaction): boolean {
  return longestHit(p, t) >= 0 || (Boolean(p.name) && textOf(t).name === p.name);
}

/**
 * Como no merchants.ts, o primeiro da lista que casa vence. O nome igual ao estabelecimento só vale quando nenhum
 * trecho casa: senão "Discord" (Nitro) pegaria todas as cobranças do Discord antes do "Discord" genérico.
 */
function firstKnown(items: KnownItem[], t: Transaction): KnownItem | null {
  return items.find((k) => longestHit(k.p, t) >= 0) ?? items.find((k) => k.p.name && k.p.name === textOf(t).name) ?? null;
}

/** Emails do mesmo nome com algum trecho em comum são a mesma assinatura; sem trecho em comum (plano mensal × domínio anual), duas. */
function evidenceIdentities(ev: Prepared<EvidenceItem>[]): number[] {
  const parent = ev.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  ev.forEach((a, i) => {
    for (let j = i + 1; j < ev.length; j++) {
      if (a.name === ev[j].name && a.matchers.some((m) => ev[j].matchers.includes(m))) parent[root(j)] = root(i);
    }
  });
  return ev.map((_, i) => root(i));
}

const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && a[n] === b[n]) n++;
  return n;
};

/** "NUVEM HOSPEDA DOMAINS" dentro de "Nuvem Hospeda" vira "Domains": sai o que já está no nome e a caixa alta vira só a inicial. */
function partLabel(text: string, base: string): string {
  const baseWords = new Set(plain(base).split(/[^a-z0-9]+/).filter(Boolean));
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const rest = words.filter((w) => !baseWords.has(plain(w)));
  const out = (rest.length ? rest : words).join(' ');
  return out === out.toUpperCase() ? out.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : out;
}

function makeGroup(key: string, name: string, tags: Tag[]): Group {
  const sorted = [...tags].sort((a, b) => byDate(a.t, b.t));
  const charges = sorted.filter((x) => x.t.amountUsd > 0).map((x) => x.t);
  const refunds = sorted.filter((x) => x.t.amountUsd < 0).map((x) => x.t);
  const base = sorted.filter((x) => x.t.amountUsd > 0);
  // o item com o nome do grupo; senão o que casou com mais cobranças; empate fica com o primeiro da lista
  const pick = (get: (x: Tag) => KnownItem | null): KnownMatch | null => {
    const count = new Map<KnownItem, number>();
    for (const x of base.length ? base : sorted) {
      const k = get(x);
      if (k) count.set(k, (count.get(k) ?? 0) + 1);
    }
    const best = [...count].sort(([a, na], [b, nb]) => Number(b.p.key === key) - Number(a.p.key === key) || nb - na || a.index - b.index)[0]?.[0];
    return best ? { ...best, byName: best.p.key === key || charges.some((t) => Boolean(best.p.name) && textOf(t).name === best.p.name) } : null;
  };
  const pub = pick((x) => x.pub);
  const res = pick((x) => x.res);
  const know = pub && res ? (pub.index < res.index ? pub : res) : pub ?? res;
  return { key, name, charges, refunds, pub, res, know, evidence: [] };
}

/**
 * Dentro do mesmo nome, emails de trechos diferentes separam assinaturas (Pro mensal × domínio anual); sem email,
 * itens diferentes da base. A cobrança sem nenhum dos dois fica com a parte maior, que leva o nome; as outras
 * levam o trecho no nome ("Vercel · Domains").
 */
function splitByIdentity(key: string, tags: Tag[]): Group[] {
  const charged = tags.filter((x) => x.t.amountUsd > 0);
  const latest = (charged.length ? charged : tags).sort((a, b) => byDate(a.t, b.t))[(charged.length || tags.length) - 1];
  const { name, keyName } = latest;
  const byEmail = tags.some((x) => x.ident !== null);
  const firstOf = (x: Tag) => (x.pub && x.res ? (x.pub.index < x.res.index ? x.pub : x.res) : x.pub ?? x.res);
  const idOf = (x: Tag) => (byEmail ? (x.ident !== null ? `e${x.ident}` : null) : firstOf(x) ? `k${firstOf(x)!.index}` : null);
  const parts = new Map<string, Tag[]>();
  for (const x of tags) {
    const id = idOf(x);
    if (id) parts.set(id, [...(parts.get(id) ?? []), x]);
  }
  if (parts.size <= 1) return [makeGroup(key, name, tags)];
  const charges = (part: Tag[]) => part.filter((x) => x.t.amountUsd > 0).length;
  const ordered = [...parts.values()].sort((a, b) => charges(b) - charges(a) || byDate(a[0].t, b[0].t));
  ordered[0].push(...tags.filter((x) => !idOf(x)));
  const used = new Set<string>();
  return ordered.map((part, i) => {
    if (i === 0) return makeGroup(key, name, part);
    // o rótulo vem do trecho ou do nome do item, que não mudam com o idioma; a chave usa o nome estável
    const sample = part.find((x) => x.t.amountUsd > 0) ?? part[0];
    const known = firstOf(sample);
    const text = byEmail ? sample.evMatcher : known && known.p.name !== plain(keyName) && !known.p.item.generic ? known.p.item.name : sample.kMatcher;
    let label = partLabel(text, keyName) || String(i + 1);
    if (used.has(label)) label = `${label} ${i + 1}`;
    used.add(label);
    return makeGroup(subscriptionKey(`${keyName} · ${label}`), `${name} · ${label}`, part);
  });
}

function groupsOf(transactions: Transaction[], known: KnownItem[], ev: Prepared<EvidenceItem>[]): Group[] {
  const pubList = known.filter((k) => !k.research);
  const resList = known.filter((k) => k.research);
  const identity = evidenceIdentities(ev);
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of transactions.filter((x) => isSpend(x) && x.merchant && x.amountUsd !== 0).sort(byDate)) {
    const key = subscriptionKey(keyNameOf(t));
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }

  const tags: Tag[] = [];
  for (const list of byMerchant.values()) {
    const draft = list.map((t) => {
      const legible = textOf(t).name;
      const pub = firstKnown(pubList, t);
      const res = firstKnown(resList, t);
      const first = pub && res ? (pub.index < res.index ? pub : res) : pub ?? res;
      let ident: number | null = null;
      let evMatcher = '';
      let evName: string | null = null;
      let bestLen = -1;
      for (let j = 0; j < ev.length; j++) {
        const p = ev[j];
        const h = longestHit(p, t);
        if (h < 0 || p.matchers[h].length <= bestLen) continue;
        bestLen = p.matchers[h].length;
        ident = identity[j];
        evMatcher = p.originals[h];
        // o email dá nome à cobrança quando casa só pelo texto da fatura: junta descritores diferentes da mesma assinatura
        evName = p.name !== legible && !legible.includes(p.matchers[h]) ? p.item.name : null;
      }
      const kHit = first ? longestHit(first.p, t) : -1;
      const byText = first && kHit >= 0 && first.p.name !== legible && !first.p.matchers.some((m) => legible.includes(m));
      // item genérico (planos de operadora) não dá o próprio nome: a parte fica "Vivo · Easy", e cada marca com a sua
      const label = byText && first.p.item.generic ? partLabel(first.p.originals[kHit], t.merchant ?? '') : '';
      const kName = !byText ? null : label ? `${t.merchant} · ${label}` : first.p.item.name;
      const kKey = !byText ? null : label ? `${keyNameOf(t)} · ${label}` : first.p.item.name;
      return { t, pub, res, ident, evMatcher, kMatcher: first && kHit >= 0 ? first.p.originals[kHit] : '', evName, kName, kKey };
    });
    // a base que cobre o estabelecimento inteiro não troca o nome dele: só separa uma parte
    const charged = draft.filter((d) => d.t.amountUsd > 0);
    const whole = charged.length > 0 && charged.every((d) => d.kName !== null && d.kName === charged[0].kName);
    for (const { evName, kName, kKey, ...d } of draft) {
      const own = evName ?? (whole ? null : kName);
      const ownKey = evName ?? (whole ? null : kKey);
      tags.push({ ...d, name: own ?? d.t.merchant!, keyName: ownKey ?? keyNameOf(d.t) });
    }
  }

  const buckets = new Map<string, Tag[]>();
  for (const x of tags) {
    const key = subscriptionKey(x.keyName);
    buckets.set(key, [...(buckets.get(key) ?? []), x]);
  }
  const groups = [...buckets].flatMap(([key, list]) => splitByIdentity(key, list));

  // cada email confirma uma assinatura só: vai para o grupo das cobranças da mesma assinatura de email; senão para o
  // de mais cobranças que ele casa (ou de nome igual); empate fica com o nome mais parecido
  const identOf = new Map(tags.map((x) => [x.t, x.ident]));
  const most = (score: (g: Group) => number, p: Prepared<EvidenceItem>) => groups
    .map((g) => ({ g, n: score(g), near: commonPrefix(p.name, plain(g.name)) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.near - a.near)[0]?.g;
  ev.forEach((p, j) => {
    const target = most((g) => g.charges.filter((t) => identOf.get(t) === identity[j]).length, p)
      ?? most((g) => g.charges.filter((t) => hits(p, t)).length, p);
    target?.evidence.push(p.item);
  });
  return groups;
}

// ---------- recorrência ----------

interface Recurrence {
  cycle: KnownCycle;
  /** Cobranças da sequência, mais antiga primeiro */
  charges: Transaction[];
  /** Cobranças na sequência, contando as que completaram buracos e o fim */
  count: number;
  avgGap: number;
  variation: number;
}

const lastOf = (chain: Transaction[]) => chain[chain.length - 1];

/** Como o serviço cobra: lead = dias que a renovação vem antes do fim do período; itemized = cada compra é um item */
interface Billing {
  lead: number;
  itemized: boolean;
}

/** A 1ª renovação de quem cobra antes do vencimento (domínio comprado há 335 dias) também é anual. */
function gapOf(cycle: KnownCycle, lead: number): [number, number] {
  const [lo, hi] = CYCLES[cycle].gap;
  return [CYCLES[cycle].months >= 12 ? lo - lead : lo, hi];
}

/** Mesma moeda e até 25% de diferença; sem outro sinal vale para a sequência toda, com sinal basta parecer com a última. */
function similar(chain: Transaction[], t: Transaction, loose: boolean): boolean {
  if (t.currency !== lastOf(chain).currency) return false;
  const values = loose ? [lastOf(chain).amount] : chain.map((x) => x.amount);
  return Math.max(t.amount, ...values) <= Math.min(t.amount, ...values) * (1 + STABLE);
}

/**
 * A data manda: cada cobrança entra na sequência aberta cujo intervalo cabe no ciclo, preferindo a de valor parecido
 * e, entre elas, o intervalo mais perto do meio da faixa. Assim duas assinaturas em dias diferentes viram duas
 * sequências. Com outro sinal, valor diferente também continua a sequência (uso, reajuste), desde que nenhuma
 * cobrança de valor parecido dispute a mesma vaga.
 */
function chainsOf(charges: Transaction[], cycle: KnownCycle, loose: boolean, lead: number): Transaction[][] {
  const [lo, hi] = gapOf(cycle, lead);
  const mid = (lo + hi) / 2;
  const gapTo = (chain: Transaction[], t: Transaction) => daysBetween(dayOf(lastOf(chain).date), dayOf(t.date));
  const fits = (chain: Transaction[], t: Transaction) => gapTo(chain, t) >= lo && gapTo(chain, t) <= hi;
  const closest = (a: Transaction[], b: Transaction[], t: Transaction) => Math.abs(gapTo(a, t) - mid) - Math.abs(gapTo(b, t) - mid);
  const open: Transaction[][] = [];
  const done: Transaction[][] = [];
  charges.forEach((t, k) => {
    for (let i = open.length - 1; i >= 0; i--) if (gapTo(open[i], t) > hi) done.push(...open.splice(i, 1));
    const candidates = open.filter((c) => fits(c, t));
    let pick = candidates.filter((c) => similar(c, t, loose)).sort((a, b) => closest(a, b, t))[0];
    if (!pick && loose) {
      const rest = charges.slice(k + 1);
      pick = candidates.filter((c) => !rest.some((u) => fits(c, u) && similar(c, u, loose))).sort((a, b) => closest(a, b, t))[0];
    }
    if (pick) pick.push(t);
    else open.push([t]);
  });
  return [...done, ...open];
}

/** Sequências de valor parecido que não se sobrepõem são a mesma assinatura com uma pausa no meio. */
function joinPauses(chains: Transaction[][]): Transaction[][] {
  const streams: Transaction[][] = [];
  for (const c of [...chains].sort((a, b) => byDate(a[0], b[0]))) {
    const s = streams
      .filter((x) => after(c[0], lastOf(x)) && similar(x, c[0], true))
      .sort((a, b) => byDate(lastOf(b), lastOf(a)))[0];
    if (s) s.push(...c);
    else streams.push([...c]);
  }
  return streams;
}

/** Sem outro sinal, outra compra no meio da sequência indica coincidência num lugar onde a pessoa compra sempre. */
function isClean(chain: Transaction[], charges: Transaction[]): boolean {
  const from = Date.parse(chain[0].date);
  const to = Date.parse(lastOf(chain).date);
  return charges.every((t) => chain.includes(t) || Date.parse(t.date) < from || Date.parse(t.date) > to);
}

/**
 * Depois de achar as sequências, a sobra completa o que o intervalo do ciclo deixou de fora: a cobrança até a
 * tolerância da data esperada continua a sequência (com outro sinal, de qualquer valor; sem, só de valor parecido)
 * e, com outro sinal, depois de uma pausa a sequência retoma na próxima cobrança de valor parecido (menos item a item,
 * como domínios: lá a compra de valor parecido é outro item).
 */
function extend(own: Set<Transaction>, charges: Transaction[], spare: Set<Transaction>, cycle: KnownCycle, loose: boolean, resume: boolean): number {
  const core = charges.filter((t) => own.has(t));
  const currency = core[0].currency;
  const lo = Math.min(...core.map((t) => t.amount)) / (1 + STABLE);
  const hi = Math.max(...core.map((t) => t.amount)) * (1 + STABLE);
  const priced = (t: Transaction) => t.currency === currency && t.amount >= lo && t.amount <= hi;
  const tol = CYCLES[cycle].tolerance;
  let absorbed = 0;
  let cursor = core[0];
  for (;;) {
    const expected = addCycle(dayOf(cursor.date), cycle, anchorDay(charges.filter((t) => own.has(t) && !after(t, cursor))));
    const off = (t: Transaction) => Math.abs(daysBetween(expected, dayOf(t.date)));
    const later = charges.filter((t) => after(t, cursor) && (own.has(t) || (spare.has(t) && (loose || priced(t)))));
    const next = later.filter((t) => off(t) <= tol).sort((a, b) => Number(own.has(b)) - Number(own.has(a)) || off(a) - off(b))[0]
      ?? later.find((t) => own.has(t) || (resume && loose && priced(t)));
    if (!next) break;
    if (spare.delete(next)) {
      own.add(next);
      absorbed += 1;
    }
    cursor = next;
  }
  return absorbed;
}

/**
 * Semanal pede 3; com só 2, os valores precisam ser parecidos (2 cobranças soltas de valores diferentes não fazem
 * assinatura). Item a item (domínios), a renovação na data certa basta: o 1º ano costuma ter preço promocional.
 */
function isSequence(chain: Transaction[], cycle: KnownCycle, itemized = false): boolean {
  return chain.length >= (cycle === 'weekly' ? 3 : 2) && (chain.length >= 3 || itemized || similar([chain[0]], chain[1], true));
}

/**
 * Com outro sinal, cada sequência vira uma assinatura: a cada rodada fica a com mais cobranças (depois a que termina
 * mais tarde, depois o ciclo mais curto) e as cobranças dela saem da disputa. Sem sinal, só a melhor sequência limpa,
 * e aí a que termina mais tarde vem primeiro: é o estado atual. Item a item (domínios), pausa não junta sequências.
 */
function detectRecurrences(charges: Transaction[], loose: boolean, billing: Billing): Recurrence[] {
  type Found = { cycle: KnownCycle; chain: Transaction[]; count: number; end: number };
  const found: Found[] = [];
  const better = (a: Found, b: Found | null) => !b || (loose
    ? a.count > b.count || (a.count === b.count && a.end > b.end)
    : a.end > b.end || (a.end === b.end && a.count > b.count));
  for (let pool = charges; ;) {
    let best: Found | null = null;
    for (const cycle of CYCLE_ORDER) {
      const chains = chainsOf(pool, cycle, loose, billing.lead).filter((c) => isSequence(c, cycle, billing.itemized) && (loose || isClean(c, charges)));
      for (const chain of loose && !billing.itemized ? joinPauses(chains) : chains) {
        const candidate = { cycle, chain, count: chain.length, end: Date.parse(lastOf(chain).date) };
        if (better(candidate, best)) best = candidate;
      }
    }
    if (!best) break;
    found.push(best);
    const taken = new Set(best.chain);
    pool = pool.filter((t) => !taken.has(t));
    if (!loose) break;
  }
  const used = new Set(found.flatMap((f) => f.chain));
  const spare = new Set(charges.filter((t) => !used.has(t)));
  return found.map(({ cycle, chain, count }) => {
    const own = new Set(chain);
    const absorbed = extend(own, charges, spare, cycle, loose, !billing.itemized);
    const mine = charges.filter((t) => own.has(t));
    const [lo, hi] = gapOf(cycle, billing.lead);
    const gaps = chain.slice(1).map((t, i) => daysBetween(dayOf(chain[i].date), dayOf(t.date))).filter((g) => g >= lo && g <= hi);
    const sameCurrency = mine.every((t) => t.currency === mine[0].currency);
    const values = mine.map((t) => (sameCurrency ? t.amount : t.amountUsd));
    return {
      cycle,
      charges: mine,
      count: count + absorbed,
      avgGap: Math.round(gaps.reduce((s, g) => s + g, 0) / Math.max(1, gaps.length)),
      variation: Math.max(...values) / Math.min(...values) - 1,
    };
  });
}

// ---------- ciclo pelo email e estimativa ----------

function knownCycles(cycles: Cycle[]): KnownCycle[] {
  return CYCLE_ORDER.filter((c) => cycles.includes(c));
}

function evidenceCycle(evs: EvidenceItem[], charges: Transaction[]): KnownCycle | null {
  const recent = [...evs].reverse();
  const stated = recent.find((e) => e.cycle !== 'unknown');
  if (stated) return stated.cycle as KnownCycle;
  // sem ciclo dito: o período pago vai da cobrança que o email confirma até o periodEnd
  for (const e of recent) {
    if (!e.periodEnd || e.kind === 'trial_ending') continue;
    const limit = addDays(e.emailDate, 1);
    const paid = charges.filter((t) => dayOf(t.date) <= limit).pop();
    const start = paid ? dayOf(paid.date) : e.kind === 'receipt' || e.kind === 'signup' ? e.emailDate : null;
    const cycle = start ? classify(daysBetween(start, e.periodEnd.slice(0, 10))) : null;
    if (cycle) return cycle;
  }
  return null;
}

function estimateCycle(offered: KnownCycle[], last: Transaction, anchor: number, today: string, locale: Locale): { cycle: Cycle; detail: string } {
  const lastDay = dayOf(last.date);
  const labels = cycleList(offered, locale);
  const lapsed = offered.filter((c) => daysBetween(addCycle(lastDay, c, anchor), today) > CYCLES[c].tolerance);
  const viable = offered.filter((c) => !lapsed.includes(c));
  if (!viable.length) {
    const cycle = offered[offered.length - 1];
    const label = cycleLabel(cycle, locale);
    return {
      cycle,
      detail: pick(locale,
        `the service bills ${labels}; no new charge since then, so ${label} is the estimate`,
        `o serviço cobra ${labels}; sem cobrança nova desde então, ciclo ${label} estimado`),
    };
  }
  const elapsed = daysBetween(lastDay, today);
  const ruledOut = !lapsed.length ? '' : pick(locale,
    `no new charge in ${elapsed} days, so not ${lapsed.map((c) => cycleLabel(c, locale)).join(' or ')}; `,
    `sem cobrança nova em ${elapsed} dias, não é ${lapsed.map((c) => cycleLabel(c, locale)).join(' nem ')}; `);
  const estimated = (cycle: KnownCycle, why: { en: string; pt: string } | null) => {
    const label = cycleLabel(cycle, locale);
    return {
      cycle,
      detail: ruledOut + (why
        ? pick(locale, `${why.en} for a service billed ${labels}: ${label} cycle estimated from the amount`, `${why.pt} para um serviço ${labels}: ciclo ${label} estimado pelo valor`)
        : pick(locale, `${label} cycle estimated`, `ciclo ${label} estimado`)),
    };
  };
  if (viable.length === 1) return estimated(viable[0], null);
  if (last.amountUsd >= LARGE_USD) return estimated(viable[viable.length - 1], { en: 'high charge', pt: 'cobrança alta' });
  if (last.amountUsd <= SMALL_USD) return estimated(viable[0], { en: 'low charge', pt: 'cobrança baixa' });
  return {
    cycle: 'unknown',
    detail: ruledOut + pick(locale, `the service bills ${labels} and the amount doesn't say which`, `o serviço cobra ${labels} e o valor não indica qual`),
  };
}

// ---------- sinais ----------

function emailSignals(evs: EvidenceItem[], locale: Locale): SubscriptionSignal[] {
  const latest = new Map<EvidenceKind, { e: EvidenceItem; count: number }>();
  for (const e of evs) latest.set(e.kind, { e, count: (latest.get(e.kind)?.count ?? 0) + 1 });
  return [...latest.values()]
    .sort((a, b) => b.e.emailDate.localeCompare(a.e.emailDate))
    .map(({ e, count }) => {
      const cycle = e.cycle !== 'unknown' ? cycleLabel(e.cycle, locale) : '';
      // o nome do plano muitas vezes já diz o ciclo ("anual", "mensalidade", "yearly"), em qualquer das línguas
      const said = e.cycle !== 'unknown' && e.plan && [CYCLES[e.cycle].label.en, CYCLES[e.cycle].label.pt].some((l) => plain(e.plan).includes(l.slice(0, 5)));
      const plan = e.plan
        ? `: ${e.plan}${cycle && !said ? ` (${cycle})` : ''}`
        : cycle ? pick(locale, `: ${cycle} plan`, `: plano ${cycle}`) : '';
      const end = !e.periodEnd ? ''
        : e.kind === 'cancellation' ? pick(locale, `; access until ${dayText(e.periodEnd)}`, `; acesso até ${dayText(e.periodEnd)}`)
        : e.kind === 'trial_ending' ? pick(locale, `; trial ends ${dayText(e.periodEnd)}`, `; teste acaba em ${dayText(e.periodEnd)}`)
        : pick(locale, `; next renewal ${dayText(e.periodEnd)}`, `; próxima renovação em ${dayText(e.periodEnd)}`);
      const label = EVIDENCE_LABEL[e.kind][locale];
      const when = pick(locale, `${label} in email on ${dayText(e.emailDate)}`, `${label} no email em ${dayText(e.emailDate)}`);
      return { kind: 'email' as const, detail: `${when}${plan}${end}${count > 1 ? ` (${count} emails)` : ''}` };
    });
}

function knowledgeSignal(k: KnowledgeItem, kind: 'knowledge' | 'research', locale: Locale): SubscriptionSignal {
  const cycles = k.isSubscription !== 'no' ? cycleList(knownCycles(k.cycles), locale) : '';
  const base = k.isSubscription === 'yes' ? pick(locale, 'known to bill a subscription', 'conhecido por cobrar assinatura')
    : k.isSubscription === 'maybe' ? pick(locale, 'may bill a subscription', 'pode cobrar assinatura')
    : pick(locale, 'not listed as a subscription', 'a base não lista como assinatura');
  const note = localized(k.note, locale);
  const detail = `${base}${cycles ? ` (${cycles})` : ''}${note ? ` — ${note}` : ''}`;
  return k.sources[0] ? { kind, detail, source: k.sources[0] } : { kind, detail };
}

// ---------- registro ----------

interface Ctx {
  today: string;
  decisions: Record<string, UserDecision>;
  locale: Locale;
  audit: Prepared<RenewalAuditItem>[];
}

/** Como na base: o primeiro item do arquivo cujo trecho casa com alguma cobrança; senão o de nome igual. */
function auditFor(items: Prepared<RenewalAuditItem>[], g: Group): RenewalAuditItem | undefined {
  return (items.find((p) => g.charges.some((t) => longestHit(p, t) >= 0))
    ?? items.find((p) => p.key === g.key || (Boolean(p.name) && g.charges.some((t) => textOf(t).name === p.name))))?.item;
}

/** Os motivos vêm como frases com ponto final: sem ele, juntam bem com "; " */
const riskReasonsOf = (a: RenewalAuditItem | undefined, locale: Locale) =>
  (a?.riskReasons ?? []).map((r) => localized(r, locale)?.trim().replace(/[.;]+$/, '')).filter((r): r is string => Boolean(r));

const RISK_LABEL = { high: { en: 'high', pt: 'alto' }, medium: { en: 'medium', pt: 'médio' }, low: { en: 'low', pt: 'baixo' } } as const;

/** Uma frase por achado da auditoria, com a fonte (termos do site ou email). */
function auditSignals(a: RenewalAuditItem, locale: Locale): SubscriptionSignal[] {
  const out: string[] = [];
  if (a.autoRenew === 'yes') out.push(pick(locale, 'renews on its own unless you cancel', 'renova sozinho se você não cancelar'));
  if (a.autoRenew === 'no') out.push(pick(locale, "doesn't renew on its own", 'não renova sozinho'));
  if (a.noticeBeforeRenewal === 'yes') {
    out.push(a.noticeDays
      ? pick(locale, `emails a reminder ${a.noticeDays} days before renewing`, `avisa por email ${a.noticeDays} dias antes de renovar`)
      : pick(locale, 'emails a reminder before renewing', 'avisa por email antes de renovar'));
  }
  if (a.noticeBeforeRenewal === 'no') out.push(pick(locale, "doesn't email a reminder before renewing", 'não avisa por email antes de renovar'));
  const deadline = localized(a.cancelDeadline, locale);
  if (deadline) out.push(pick(locale, `cancel by: ${deadline}`, `prazo para cancelar: ${deadline}`));
  const refundNote = localized(a.refundNote, locale);
  if (a.refundWindowDays !== undefined) {
    const base = a.refundWindowDays > 0
      ? pick(locale, `refund possible up to ${a.refundWindowDays} days after renewal`, `dá para pedir reembolso até ${a.refundWindowDays} dias depois da renovação`)
      : pick(locale, 'the terms say there is no refund', 'os termos dizem que não há reembolso');
    out.push(refundNote ? `${base} — ${refundNote}` : base);
  } else if (refundNote) out.push(pick(locale, `refund: ${refundNote}`, `reembolso: ${refundNote}`));
  const price = localized(a.priceChangeAtRenewal, locale);
  if (price) out.push(pick(locale, `price at renewal: ${price}`, `preço na renovação: ${price}`));
  const reasons = riskReasonsOf(a, locale);
  const checked = a.checked.map((c) => (c === 'website' ? pick(locale, 'site', 'site') : 'email')).join(pick(locale, ' and ', ' e '));
  const level = RISK_LABEL[a.risk][locale];
  out.push(pick(locale, `risk of a surprise charge: ${level}`, `risco de cobrança sem perceber: ${level}`)
    + (reasons.length ? ` — ${reasons.join('; ')}` : '')
    + pick(locale, ` (checked ${checked} on ${dayText(a.checkedAt)})`, ` (conferido em ${checked} em ${dayText(a.checkedAt)})`));
  const source = a.sources[0] ?? a.manageUrl;
  return out.map((detail): SubscriptionSignal => (source ? { kind: 'audit', detail, source } : { kind: 'audit', detail }));
}

/**
 * Parte da chave de uma sequência extra: o valor cru, sem formatação do idioma. Escrito como as chaves salvas antes
 * do inglês ("YouTube · R$ 50,00" → "youtube-r-50-00"), para não perder respostas; isso vale para BRL e USD, as
 * outras moedas levam o código ("eur-10-00", antes "10-00").
 */
function amountKey(t: Transaction): string {
  const [int, cents] = Math.abs(t.amount).toFixed(2).split('.');
  const symbol = ({ BRL: 'r', USD: 'us' } as Record<string, string>)[t.currency] ?? t.currency.toLowerCase();
  return `${symbol}-${int.replace(/\B(?=(\d{3})+(?!\d))/g, '-')}-${cents}`;
}

/**
 * Com várias assinaturas no estabelecimento, cada email vai para a que cobrou no dia dele (o aviso de renovação, também
 * para a que cobrou no dia avisado), ou para a de valor mais próximo.
 */
function evidenceOf(evs: EvidenceItem[], streams: Transaction[][], index: number): EvidenceItem[] {
  if (streams.length < 2) return evs;
  return evs.filter((e) => {
    const days = [e.emailDate.slice(0, 10), ...(e.kind === 'renewal_notice' && e.periodEnd ? [e.periodEnd.slice(0, 10)] : [])];
    const near = (s: Transaction[]) => s.filter((t) => days.some((d) => Math.abs(daysBetween(d, dayOf(t.date))) <= 2));
    const priceOff = (s: Transaction[]) => {
      const same = s.filter((t) => t.currency === e.currency);
      return e.amount === undefined || !same.length ? Infinity : Math.min(...same.map((t) => Math.abs(t.amount - e.amount!)));
    };
    const byDay = streams.map((s, i) => ({ i, off: priceOff(near(s)) })).filter((x) => near(streams[x.i]).length);
    const pick = byDay.sort((a, b) => a.off - b.off)[0]
      ?? streams.map((s, i) => ({ i, off: priceOff(s) })).filter((x) => x.off < Infinity).sort((a, b) => a.off - b.off)[0];
    return (pick?.i ?? 0) === index;
  });
}

/** Uma assinatura dentro do grupo: a sequência achada (ou nenhuma) e as cobranças do registro, mais antiga primeiro. */
interface Part {
  rec: Recurrence | null;
  charges: Transaction[];
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function evaluate(g: Group, ctx: Ctx): SubscriptionRecord[] {
  const latest = g.charges[g.charges.length - 1];
  if (!latest) return [];
  const { pub, res, know } = g;
  const verdict = know?.p.item.isSubscription;
  const groupEvs = g.evidence;
  const hint = g.charges.some((t) => t.subscriptionHint);
  // a auditoria olhou os termos do serviço da pessoa: "renova sozinho" confirma como o email
  const audit = auditFor(ctx.audit, g);
  const audited = audit?.autoRenew === 'yes';
  if (verdict === 'no' && !groupEvs.length && !audited && !(hint && know && !know.byName)) return [];
  const confirmed = verdict === 'yes' || groupEvs.length > 0 || hint || audited;
  if (NEEDS_CONFIRMATION.has(latest.category ?? '') && !confirmed) return [];
  // recarga de saldo (celular, bilhete, saldo de app) repete o valor por rotina: sem confirmação, fica fora (a mesma regra
  // das duplicatas, no analytics.ts)
  const charges = confirmed ? g.charges : g.charges.filter((t) => !isBalanceTopUp(t));
  if (!charges.length) return [];
  const loose = confirmed || verdict === 'maybe';
  const billing: Billing = { lead: audit?.chargeLeadDays ?? know?.p.item.chargeLeadDays ?? 0, itemized: Boolean(know?.p.item.itemized) };
  const recs = detectRecurrences(charges, loose, billing);
  if (!loose && !recs.length) return [];
  const last = charges[charges.length - 1];
  const bill = !confirmed && (BILL.test(textOf(last).raw) || BILL.test(textOf(last).name));
  if (!loose) {
    // só a recorrência: semanal é rotina (mercado, lavanderia) e, fora das categorias de assinatura, só o valor baixo
    // convence; aluguel, condomínio e seguro passam, como conta recorrente
    const r = recs[0];
    if (r.cycle === 'weekly') return [];
    if (!bill && !SUBSCRIPTION_LIKE.has(last.category ?? '') && median(r.charges.map((t) => t.amountUsd)) > LOW_USD) return [];
  }

  // sem outro sinal, o registro é o estabelecimento inteiro; com sinal, cada sequência é uma assinatura e, item a item
  // (domínios), cada compra que ainda não renovou também. A mais antiga fica com o nome do estabelecimento: o nome não
  // muda quando aparece uma nova
  const inSequence = new Set(recs.flatMap((r) => r.charges));
  const parts: Part[] = !loose ? [{ rec: recs[0], charges }] : [
    ...recs.map((rec) => ({ rec, charges: rec.charges })),
    ...(billing.itemized ? charges.filter((t) => !inSequence.has(t)).map((t) => ({ rec: null, charges: [t] })) : []),
  ].sort((a, b) => byDate(a.charges[0], b.charges[0]));
  if (!parts.length) parts.push({ rec: null, charges });
  const streams = parts.map((p) => p.charges);
  const keys = new Set<string>();
  const { locale } = ctx;
  return parts.map((part, i) => {
    let name = g.name;
    let key = g.key;
    if (i > 0) {
      // o nome mostra o valor formatado no idioma; a chave usa o valor cru
      const first = streams[i][0];
      name = `${g.name} · ${money(first.amount, first.currency)}`.replace(/\u00a0/g, ' ');
      key = `${g.key}-${amountKey(first)}`;
      if (keys.has(key)) {
        const day = Number(first.date.slice(8, 10));
        name = `${name} · ${pick(locale, 'day', 'dia')} ${day}`;
        key = `${key}-dia-${day}`;
      }
      if (keys.has(key)) {
        name = `${name} · ${i + 1}`;
        key = `${key}-${i + 1}`;
      }
    }
    keys.add(key);
    const record = buildRecord({ ...g, key, name }, part, evidenceOf(groupEvs, streams, i), { pub, res, know, hint, loose, bill, billing, audit }, ctx);
    if (parts.length > 1) {
      record.signals.push({
        kind: 'recurrence',
        detail: billing.itemized
          ? pick(locale,
            `${g.name} has ${parts.length} items that renew on their own dates (like domains); each one is listed separately`,
            `${g.name} tem ${parts.length} itens que renovam cada um na sua data (como domínios); cada um aparece separado`)
          : pick(locale,
            `${g.name} has ${parts.length} recurring charges with different amounts; each one is listed separately`,
            `${g.name} tem ${parts.length} cobranças recorrentes com valores diferentes; cada uma aparece separada`),
      });
    }
    return record;
  });
}

type Match = KnownMatch | null;

/** Recibo e confirmação de compra trazem o fim do período pago; o aviso de renovação traz o dia da cobrança. */
const paidUntil = (e: EvidenceItem) => e.kind === 'receipt' || e.kind === 'signup';

/**
 * Cobrança por uso: o valor sobe e desce entre as últimas cobranças (duas mudanças de mais de 25% nas 6 últimas). Um
 * reajuste é uma mudança só, e aí a última cobrança é o preço novo.
 */
function usageBased(paid: Transaction[]): boolean {
  const recent = paid.slice(-6);
  if (recent.length < 3) return false;
  const same = recent.every((t) => t.currency === recent[0].currency);
  const value = (t: Transaction) => (same ? t.amount : t.amountUsd);
  const moves = recent.slice(1).filter((t, i) => {
    const [a, b] = [value(recent[i]), value(t)];
    return Math.max(a, b) > Math.min(a, b) * (1 + STABLE);
  });
  return moves.length >= 2;
}

/**
 * Hosts do serviço na base pública, exatos: o do manageUrl e os de domains. Link de email ou da IA em qualquer outro
 * host é "não verificado", inclusive subdomínio: em script.google.com ou sites.google.com qualquer um publica uma página.
 */
function knownSites(item: KnowledgeItem | undefined): string[] {
  if (!item) return [];
  return [...(item.manageUrl ? [urlHost(item.manageUrl)] : []), ...(item.domains ?? [])].filter(Boolean);
}

/** A fonte do sinal vira link só se for https; o resto (ex.: "email: assunto") vai como texto. Link da IA leva verificação. */
function withSource(s: SubscriptionSignal, sites: string[]): SubscriptionSignal {
  if (!s.source) return s;
  const { source, ...rest } = s;
  const url = safeUrl(source);
  if (!url) return { ...rest, sourceText: source };
  const curated = s.kind === 'knowledge';
  return { ...rest, source: url, sourceVerified: curated || isKnownHost(url, sites) };
}

function buildRecord(
  g: Group,
  part: Part,
  evs: EvidenceItem[],
  m: { pub: Match; res: Match; know: Match; hint: boolean; loose: boolean; bill: boolean; billing: Billing; audit: RenewalAuditItem | undefined },
  ctx: Ctx,
): SubscriptionRecord {
  const { pub, res, know, hint, bill, billing, audit } = m;
  const { rec, charges } = part;
  const { locale } = ctx;
  const verdict = know?.p.item.isSubscription;
  const lastCharge = rec ? rec.charges[rec.charges.length - 1] : charges[charges.length - 1];
  const lastDay = dayOf(lastCharge.date);
  const paid = charges.filter((t) => !after(t, lastCharge));
  const anchor = anchorDay(paid);

  const signals: SubscriptionSignal[] = emailSignals(evs, locale);
  if (rec) {
    const p = Math.round(rec.variation * 100);
    const value = rec.variation <= 0.05 ? pick(locale, 'steady amount', 'valor estável')
      : rec.variation <= 0.5 ? pick(locale, `amount varied up to ${p}%`, `valor variou até ${p}%`)
      : pick(locale, 'amount changes a lot (usage, price change or plan change)', 'valor muda bastante (uso, reajuste ou troca de plano)');
    // o sinal conta as cobranças do registro; sem outro sinal o registro é o estabelecimento inteiro, e a sequência é parte dele
    const n = charges.length;
    const every = n > rec.count
      ? pick(locale, `${n} charges, ${rec.count} of them about every ${rec.avgGap} days`, `${n} cobranças, ${rec.count} delas a cada ~${rec.avgGap} dias`)
      : pick(locale, `${n} charges about every ${rec.avgGap} days`, `${n} cobranças a cada ~${rec.avgGap} dias`);
    signals.push({ kind: 'recurrence', detail: `${every}, ${value}` });
  }
  if (bill) {
    signals.push({
      kind: 'recurrence',
      detail: pick(locale,
        'looks like rent, a condo fee, insurance or school fees: a recurring bill, not a subscription to keep or cancel',
        'parece aluguel, condomínio, seguro ou mensalidade escolar: uma conta recorrente, não uma assinatura para manter ou cancelar'),
    });
  }
  if (hint) signals.push({ kind: 'dictionary', detail: pick(locale, 'on the list of services known to bill subscriptions', 'está no dicionário de serviços que cobram assinatura') });
  if (pub) signals.push(knowledgeSignal(pub.p.item, 'knowledge', locale));
  if (res) signals.push(knowledgeSignal(res.p.item, 'research', locale));
  if (audit) signals.push(...auditSignals(audit, locale));

  const offeredBy = (x: Match) => (x && x.p.item.isSubscription !== 'no' ? knownCycles(x.p.item.cycles) : []);
  const pubCycles = offeredBy(pub);
  const resCycles = offeredBy(res);
  let cycle: Cycle = 'unknown';
  let cycleSource: SubscriptionRecord['cycleSource'] = 'estimate';
  // período pago de mais de um ano no recibo (domínio de 2 ou 5 anos): nem anual nem RRULE; o custo divide pelo prazo
  const receipt = [...evs].reverse().find((e) => e.periodEnd && paidUntil(e));
  const receiptPaid = receipt ? charges.filter((t) => dayOf(t.date) <= addDays(receipt.emailDate, 1)).pop() : undefined;
  const termDays = receipt?.periodEnd && receiptPaid ? daysBetween(dayOf(receiptPaid.date), receipt.periodEnd.slice(0, 10)) - billing.lead : 0;
  const termMonths = termDays > ANNUAL_MAX_DAYS ? Math.round(termDays / (365.25 / 12)) : undefined;
  const fromEmail = termMonths ? null : evidenceCycle(evs, charges);
  if (termMonths) {
    cycleSource = 'email';
    const years = Math.round(termMonths / 12);
    signals.push({
      kind: 'email',
      detail: termMonths % 12 === 0
        ? pick(locale, `paid for ${years} years at once: renews at the end of the term, not every year`, `pago por ${years} anos de uma vez: renova no fim do prazo, não todo ano`)
        : pick(locale, `paid for ${termMonths} months at once`, `pago por ${termMonths} meses de uma vez`),
    });
  } else if (fromEmail) {
    cycle = fromEmail;
    cycleSource = 'email';
  } else if (rec) {
    cycle = rec.cycle;
    cycleSource = 'recurrence';
  } else if (pubCycles.length === 1) {
    cycle = pubCycles[0];
    cycleSource = 'knowledge';
  } else if (resCycles.length === 1) {
    cycle = resCycles[0];
    cycleSource = 'research';
  } else {
    const offered = pubCycles.length > 1 ? pubCycles : resCycles;
    if (offered.length > 1) {
      const est = estimateCycle(offered, lastCharge, anchor, ctx.today, locale);
      cycle = est.cycle;
      signals.push({ kind: pubCycles.length > 1 ? 'knowledge' : 'research', detail: est.detail });
    }
  }

  // Próxima renovação. Quem cobra antes do vencimento (lead: domínios na Vercel, 30 dias) cobra no fim do período
  // pago menos o lead: é essa a data dos avisos, porque depois dela a renovação já não se cancela. O aviso de renovação
  // traz o dia da cobrança, o recibo traz o fim do período. Sem email, a 1ª compra renova em 1 ciclo menos o lead e
  // as renovações seguintes, em 1 ciclo.
  const tolerance = CYCLES[cycle === 'unknown' ? (termMonths ? 'annual' : 'monthly') : cycle].tolerance;
  const dated = [...evs].reverse().find((e) => e.periodEnd);
  const periodEnd = dated?.periodEnd ? addDays(dated.periodEnd.slice(0, 10), paidUntil(dated) ? -billing.lead : 0) : undefined;
  const firstPurchase = billing.lead > 0 && paid.length === 1;
  const nextRenewal = periodEnd && daysBetween(lastDay, periodEnd) > tolerance
    ? periodEnd
    : cycle !== 'unknown' ? addDays(addCycle(lastDay, cycle, anchor), firstPurchase ? -billing.lead : 0) : null;
  const daysUntil = nextRenewal ? daysBetween(ctx.today, nextRenewal) : null;
  if (billing.lead > 0) {
    signals.push({
      kind: audit?.chargeLeadDays !== undefined ? 'audit' : 'knowledge',
      detail: pick(locale,
        `the renewal is charged ${billing.lead} days before the paid period ends: the reminders count from the charge`,
        `a renovação é cobrada ${billing.lead} dias antes do fim do período pago: os avisos contam a partir da cobrança`),
    });
  }

  const decision = ctx.decisions[g.key];
  const latestEv = evs[evs.length - 1];
  // estorno do mesmo tamanho da última cobrança, depois dela: renovação devolvida
  const refunded = g.refunds.some((t) => !after(lastCharge, t) && Math.abs(Math.abs(t.amountUsd) - lastCharge.amountUsd) <= lastCharge.amountUsd * 0.05);
  let status: SubscriptionRecord['status'] = 'active';
  if (decision?.choice === 'not_subscription') status = 'not_subscription';
  else if (latestEv?.kind === 'cancellation' && latestEv.emailDate.slice(0, 10) >= lastDay) status = 'cancelled';
  else if (refunded) {
    status = 'maybe_cancelled';
    signals.push({ kind: 'recurrence', detail: pick(locale, 'the last charge was refunded', 'a última cobrança foi estornada') });
  } else if (nextRenewal && daysUntil !== null && daysUntil < -tolerance) {
    status = 'maybe_cancelled';
    signals.push({
      kind: 'recurrence',
      detail: pick(locale, `the renewal expected on ${dayText(nextRenewal)} didn't show up on the card`, `a renovação esperada em ${dayText(nextRenewal)} não apareceu no cartão`),
    });
  } else if (!nextRenewal && daysBetween(lastDay, ctx.today) > STALE_DAYS) {
    status = 'maybe_cancelled';
    signals.push({ kind: 'recurrence', detail: pick(locale, 'no charge in over a year', 'nenhuma cobrança há mais de um ano') });
  }
  // sem auditoria, plano anual caro que não avisou por email é o caso da renovação "nas letras miúdas"
  const noticed = evs.some((e) => e.kind === 'renewal_notice' || e.kind === 'trial_ending');
  const heuristic = !bill && !audit && cycle === 'annual' && lastCharge.amountUsd >= HEURISTIC_USD && !noticed;
  const risk: RiskLevel = bill ? 'unknown' : audit ? audit.risk : heuristic ? 'high' : 'unknown';
  if (heuristic) {
    const value = money(lastCharge.amount, lastCharge.currency);
    signals.push({
      kind: 'recurrence',
      detail: pick(locale, `annual plan of ${value} and no renewal reminder in email: treated as high risk`, `plano anual de ${value} e nenhum aviso de renovação no email: tratado como risco alto`),
    });
  }
  // conta recorrente não tem aviso nem pergunta: não há o que manter ou cancelar
  const alert = !bill && status === 'active' && daysUntil !== null ? alertFor(daysUntil, risk === 'high') : null;

  // a última cobrança é uma renovação recente ou pendente: ainda dá para pedir reembolso? É renovação quando não é a
  // primeira da sequência, ou quando um aviso de renovação no email anunciou a cobrança naquele dia (a anual costuma ter
  // uma cobrança só no histórico carregado; aí não há valor anterior para comparar)
  let justRenewed: JustRenewed | undefined;
  const index = charges.indexOf(lastCharge);
  const previous = index > 0 ? charges[index - 1] : undefined;
  const announced = evs.some((e) => e.kind === 'renewal_notice' && e.periodEnd && e.emailDate.slice(0, 10) <= lastDay
    && Math.abs(daysBetween(e.periodEnd.slice(0, 10), lastDay)) <= 2);
  const daysAgo = daysBetween(lastDay, ctx.today);
  const pending = lastCharge.status === 'pending';
  if (!bill && (previous || announced) && status !== 'not_subscription' && ((daysAgo >= 0 && daysAgo <= JUST_RENEWED_DAYS) || pending)) {
    const same = previous?.currency === lastCharge.currency;
    const before = previous ? (same ? previous.amount : previous.amountUsd) : 0;
    const priceChanged = previous ? Math.abs((same ? lastCharge.amount : lastCharge.amountUsd) - before) > before * 0.01 : false;
    const window = audit?.refundWindowDays;
    justRenewed = {
      chargeId: lastCharge.id,
      date: lastDay,
      daysAgo,
      pending,
      ...(previous ? { previousAmount: previous.amount, previousCurrency: previous.currency } : {}),
      priceChanged,
      ...(window !== undefined ? { refundWindowDays: window, refundDaysLeft: window > 0 ? window - daysAgo : null } : {}),
    };
    const value = money(lastCharge.amount, lastCharge.currency);
    const was = previous ? money(previous.amount, previous.currency) : '';
    const when = pending ? pick(locale, 'renewal still pending', 'renovação ainda pendente')
      : daysAgo === 0 ? pick(locale, 'renewed today', 'renovou hoje')
      : pick(locale, `renewed ${daysAgo} ${daysAgo === 1 ? 'day' : 'days'} ago`, `renovou há ${daysAgo} ${daysAgo === 1 ? 'dia' : 'dias'}`);
    signals.push({ kind: 'recurrence', detail: `${when}: ${value}${priceChanged ? pick(locale, `, was ${was}`, `, antes ${was}`) : ''}` });
    // a janela de reembolso vem da auditoria: o sinal leva a mesma fonte
    const left = justRenewed.refundDaysLeft;
    const source = audit?.sources[0] ?? audit?.manageUrl;
    if (left === null) {
      signals.push({
        kind: 'audit',
        detail: pick(locale, "the terms don't allow refunds; you can still ask for a courtesy refund", 'os termos não preveem reembolso; dá para pedir um reembolso de cortesia'),
        ...(source ? { source } : {}),
      });
    } else if (left !== undefined) {
      signals.push({
        kind: 'audit',
        ...(source ? { source } : {}),
        detail: left >= 0
          ? pick(locale, `${left} ${left === 1 ? 'day' : 'days'} left to ask for a refund`, `${left === 1 ? 'falta 1 dia' : `faltam ${left} dias`} para pedir reembolso`)
          : pick(locale, `the refund window closed ${-left} ${left === -1 ? 'day' : 'days'} ago`, `o prazo de reembolso acabou há ${-left} ${left === -1 ? 'dia' : 'dias'}`),
      });
    }
  }

  let needsAnswer = false;
  if (status === 'active' && !bill) {
    if (!decision) needsAnswer = alert !== null;
    else if (decision.choice !== 'not_subscription') {
      // decision.at é instante real; date é hora local ("flutuante"): a comparação usa o instante da cobrança
      needsAnswer = decision.forRenewal
        ? nextRenewal !== null && nextRenewal > decision.forRenewal.slice(0, 10)
        : txInstant(lastCharge) > Date.parse(decision.at);
    }
  }
  if (decision?.choice === 'cancel') {
    const again = charges.filter((t) => txInstant(t) > Date.parse(decision.at)).pop();
    if (again) {
      const when = dayText(dayOf(again.date));
      signals.push({
        kind: 'recurrence',
        detail: pick(locale, `charged again on ${when} after you marked it to cancel`, `cobrou de novo em ${when} depois que você marcou para cancelar`),
      });
    }
  }

  // ciclo estimado, ou só a recorrência sem nenhum outro sinal, não passa de "média"
  const recurrenceOnly = !evs.length && !hint && !know && !audit;
  const base: SubscriptionRecord['confidence'] = evs.length || (rec && rec.count >= 3)
    ? 'high'
    : rec || ((verdict === 'yes' || hint) && cycleSource !== 'estimate') ? 'medium' : 'low';
  const confidence = base === 'high' && (cycleSource === 'estimate' || recurrenceOnly) ? 'medium' : base;

  // por uso, a média das 3 últimas; período de vários anos, a cobrança dividida pelo prazo
  const sequence = (rec ? rec.charges : charges).filter((t) => !after(t, lastCharge));
  const costApprox = cycle !== 'unknown' && usageBased(sequence);
  const basis = costApprox ? sequence.slice(-3).reduce((s, t) => s + t.amountUsd, 0) / Math.min(3, sequence.length) : lastCharge.amountUsd;
  const monthly = termMonths ? lastCharge.amountUsd / termMonths : cycle === 'unknown' ? 0 : basis / CYCLES[cycle].months;
  if (costApprox) {
    signals.push({
      kind: 'recurrence',
      detail: pick(locale,
        'billed by usage: the cost per month is the average of the last 3 charges',
        'cobrança por uso: o custo por mês é a média das 3 últimas cobranças'),
    });
  }
  const recent = [...evs].reverse();

  // link de gerenciar: base pública (conferida à mão) > email > auditoria (os termos do serviço da pessoa) > pesquisa;
  // só https. "Verificado" é só o link curado da base: host oficial não basta, porque qualquer um publica uma página
  // (design do Canva, curso da Udemy) no mesmo host. Um email de phishing não troca o link oficial
  const sites = knownSites(pub?.p.item);
  const fromPublic = safeUrl(pub?.p.item.manageUrl);
  const manageUrl = [
    fromPublic, ...recent.map((e) => e.manageUrl), audit?.manageUrl, know?.p.item.manageUrl, res?.p.item.manageUrl,
  ].map(safeUrl).find((u): u is string => Boolean(u));
  const manageUrlVerified = manageUrl ? manageUrl === fromPublic : undefined;

  return {
    key: g.key,
    name: g.name,
    kind: bill ? 'bill' : 'subscription',
    brand: lastCharge.brand,
    category: lastCharge.category,
    cycle,
    ...(termMonths ? { termMonths } : {}),
    cycleSource,
    confidence,
    signals: signals.map((s) => withSource(s, sites)),
    charges,
    lastCharge,
    nextRenewal,
    daysUntil,
    alert,
    status,
    monthlyCostUsd: R2(monthly),
    annualCostUsd: R2(monthly * 12),
    costApprox,
    plan: recent.find((e) => e.plan)?.plan,
    ...(manageUrl ? { manageUrl, manageUrlVerified } : {}),
    ...(sites.length ? { verifiedHosts: sites } : {}),
    decision,
    needsAnswer,
    audit,
    risk,
    riskSource: bill ? undefined : audit ? 'audit' : heuristic ? 'heuristic' : undefined,
    justRenewed,
  };
}

/**
 * Mensal e semanal ativos estão sempre a menos de 45 dias da última cobrança: na lista do relatório só entra a
 * renovação que pede atenção — ciclo mais longo, preço que mudou, cobrança pendente ou reembolso ainda possível.
 * O campo justRenewed do registro continua valendo para todos.
 */
function worthNoticing(r: SubscriptionRecord): boolean {
  const j = r.justRenewed;
  if (!j) return false;
  return (r.cycle !== 'monthly' && r.cycle !== 'weekly') || Boolean(j.priceChanged) || j.pending || (typeof j.refundDaysLeft === 'number' && j.refundDaysLeft >= 0);
}

/** Chave estável para guardar a decisão: "iCloud+" → "icloud-plus", "Claude (Anthropic)" → "claude-anthropic". */
export function subscriptionKey(name: string): string {
  const slug = plain(name).replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'sem-nome';
}

export function analyzeSubscriptions(
  dataset: Dataset,
  opts: { knowledge: KnowledgeItem[]; decisions?: Record<string, UserDecision>; today?: string; locale?: Locale },
): SubscriptionReport {
  const today = (opts.today ?? dataset.referenceDate).slice(0, 10);
  const locale = opts.locale ?? 'en';
  // a tela passa a pesquisa local antes da base pública, na ordem de cada uma; o que veio da pesquisa conta como
  // 'research', e item da pesquisa que a tela não passou entra no fim
  const researchItems = dataset.subscriptionSources?.research?.items ?? [];
  const sameItem = (a: KnowledgeItem, b: KnowledgeItem) => a === b || (plain(a.name) === plain(b.name) && a.sources.join() === b.sources.join());
  const list = [...opts.knowledge, ...researchItems.filter((r) => !opts.knowledge.some((k) => sameItem(k, r)))];
  const known: KnownItem[] = prepare(list).map((p, index) => ({ p, index, research: researchItems.some((r) => sameItem(p.item, r)) }));
  // no mesmo dia, o cancelamento vem depois do recibo
  const evidenceItems = [...(dataset.subscriptionSources?.evidence?.items ?? [])]
    .sort((a, b) => a.emailDate.localeCompare(b.emailDate) || Number(a.kind === 'cancellation') - Number(b.kind === 'cancellation'));
  const groups = groupsOf(dataset.transactions, known, prepare(evidenceItems));

  const ctx: Ctx = { today, decisions: opts.decisions ?? {}, locale, audit: prepare(dataset.subscriptionSources?.audit?.items ?? []) };
  const tag = LOCALES.find((l) => l.value === locale)?.tag;
  const records = groups
    .flatMap((g) => evaluate(g, ctx))
    .sort((a, b) =>
      Number(b.needsAnswer) - Number(a.needsAnswer)
      || (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity)
      || a.name.localeCompare(b.name, tag));

  const byDays = (a: SubscriptionRecord, b: SubscriptionRecord) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0) || a.name.localeCompare(b.name, tag);
  // conta recorrente fica só em records: não tem aviso, renovação para conferir nem entra no custo das assinaturas
  const active = records.filter((r) => r.status === 'active' && r.kind === 'subscription');
  return {
    records,
    upcoming: active.filter((r) => r.daysUntil !== null && r.daysUntil >= 0 && r.daysUntil <= UPCOMING_DAYS).sort(byDays),
    alerts: active.filter((r) => r.alert !== null && r.decision?.choice !== 'not_subscription').sort(byDays),
    monthlyTotalUsd: R2(active.reduce((s, r) => s + r.monthlyCostUsd, 0)),
    annualTotalUsd: R2(active.reduce((s, r) => s + r.annualCostUsd, 0)),
    monthlyApprox: active.some((r) => r.costApprox && r.monthlyCostUsd > 0),
    justRenewed: records.filter(worthNoticing)
      .sort((a, b) => b.justRenewed!.date.localeCompare(a.justRenewed!.date) || a.name.localeCompare(b.name, tag)),
    atRisk: active.filter((r) => r.risk === 'high')
      .sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity) || a.name.localeCompare(b.name, tag)),
  };
}

/** A base que a tela usa: a pesquisa local antes da pública, na ordem de cada uma (a primeira que casa vence). */
export function knowledgeFor(dataset: Dataset): KnowledgeItem[] {
  return [...(dataset.subscriptionSources?.research?.items ?? []), ...SUBSCRIPTION_KNOWLEDGE];
}

const views = new WeakMap<SubscriptionReport, RecurringView>();

/**
 * A fonte única de "recorrente" para o resto do painel: o balde de Gastos, o mês a mês e o alerta de "valor incomum"
 * olham os mesmos registros da aba Assinaturas. Sai "não é assinatura"; conta recorrente fica, com kind 'bill'.
 * O mesmo relatório devolve sempre o mesmo objeto (serve de dependência de useMemo).
 */
export function recurringView(report: SubscriptionReport): RecurringView {
  const hit = views.get(report);
  if (hit) return hit;
  const items: RecurringItem[] = report.records
    .filter((r) => r.status !== 'not_subscription' && r.decision?.choice !== 'not_subscription')
    .map((r) => ({
      key: r.key,
      name: r.name,
      kind: r.kind,
      status: r.status,
      category: r.category,
      cycle: r.cycle,
      monthlyUsd: r.monthlyCostUsd,
      approx: r.costApprox,
      firstDate: r.charges[0]?.date ?? r.lastCharge.date,
      lastDate: r.lastCharge.date,
      chargeIds: r.charges.map((t) => t.id),
    }));
  const ids = (list: RecurringItem[]) => new Set(list.flatMap((i) => i.chargeIds));
  const view: RecurringView = {
    items,
    subscriptionChargeIds: ids(items.filter((i) => i.kind === 'subscription')),
    recurringChargeIds: ids(items),
    monthlyTotalUsd: report.monthlyTotalUsd,
    monthlyApprox: Boolean(report.monthlyApprox),
  };
  views.set(report, view);
  return view;
}

/**
 * Custo fixo por mês das assinaturas que já tinham começado no fim do mês ym (AAAA-MM) e ainda cobravam nele; no mês
 * de hoje em diante, só as ativas, igual ao total da aba Assinaturas.
 */
export function recurringMonthlyAt(view: RecurringView, ym: string, today: string): { totalUsd: number; approx: boolean } {
  const start = `${ym}-01`;
  const end = `${ym}-31`;
  const current = ym >= today.slice(0, 7);
  const live = view.items.filter((i) => i.kind === 'subscription' && i.firstDate.slice(0, 10) <= end
    && (current ? i.status === 'active' : i.status === 'active' || i.lastDate.slice(0, 10) >= start));
  return { totalUsd: R2(live.reduce((s, i) => s + i.monthlyUsd, 0)), approx: live.some((i) => i.approx && i.monthlyUsd > 0) };
}

// ---------- calendário (RFC 5545) ----------

const encoder = new TextEncoder();

// NBSP do Intl e tab viram espaço comum. Toda quebra (CRLF, CR ou LF sozinhos, U+2028/9) vira o "\n" escapado e o
// resto dos controles (C0, DEL, C1) e as marcas de direção saem: um CR isolado num nome ou link vindo de fora fecharia a
// linha e injetaria propriedades no arquivo, e um RLO inverteria o título na agenda
const icsText = (s: string) =>
  s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\u00a0\t]/g, ' ').replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n|\u2028|\u2029/g, '\\n').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

// valor de propriedade que não é texto (o UID): só o que uma chave de assinatura tem; o resto vira "-"
const icsToken = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '-');

/** Tetos do texto livre no calendário: nome (título e alarmes), motivos de risco e prazo, que vêm de fora */
const ICS_MAX = { name: 120, reasons: 500, deadline: 200 };

/** Linhas de até 75 octetos; a continuação começa com espaço e nunca corta um caractere no meio. */
function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
      limit = 74;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function icsStamp(now: string | undefined): string {
  const t = now ? Date.parse(now.length === 10 ? `${now}T00:00:00Z` : now) : NaN;
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Dia 29 a 31 vira "o último entre 28 e o dia", como a conta da próxima renovação; sem isso o RRULE pula o mês. */
function rruleOf(r: SubscriptionRecord): string | null {
  if (r.cycle === 'unknown' || !r.nextRenewal) return null;
  if (r.cycle === 'weekly') return 'FREQ=WEEKLY';
  const next = r.nextRenewal;
  const day = Number(next.slice(8, 10));
  const paid = r.charges.filter((t) => !after(t, r.lastCharge));
  const anchor = isMonthEnd(next) && paid.length ? Math.max(day, anchorDay(paid)) : day;
  if (r.cycle === 'annual') return next.slice(5, 7) === '02' && anchor >= 29 ? 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1' : 'FREQ=YEARLY';
  const interval = CYCLES[r.cycle].months;
  const base = interval > 1 ? `FREQ=MONTHLY;INTERVAL=${interval}` : 'FREQ=MONTHLY';
  if (anchor < 29) return base;
  const days: number[] = [];
  for (let d = 28; d <= anchor; d++) days.push(d);
  return `${base};BYMONTHDAY=${days.join(',')};BYSETPOS=-1`;
}

export function buildIcs(records: SubscriptionRecord[], opts: { calendarName?: string; now?: string; locale?: Locale } = {}): string {
  const locale = opts.locale ?? 'en';
  const stamp = icsStamp(opts.now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Lighthouse for ether.fi Cash//Subscriptions//${pick(locale, 'EN', 'PT-BR')}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(opts.calendarName ?? pick(locale, 'Subscription renewals', 'Renovações de assinaturas'))}`,
  ];
  for (const r of records) {
    // conta recorrente não tem o que manter ou cancelar: fica fora do calendário
    if (r.status !== 'active' || !r.nextRenewal || r.decision?.choice === 'not_subscription' || r.kind === 'bill') continue;
    const next = r.nextRenewal;
    // a data vai crua no DTSTART: só AAAA-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) continue;
    const name = clip(r.name, ICS_MAX.name);
    const value = money(r.lastCharge.amount, r.lastCharge.currency);
    // a sequência extra já leva o valor no nome ("YouTube · R$ 50,00"): não repete no título nem no alarme
    const first = r.charges[0];
    const valued = Boolean(first) && r.name.includes(money(first.amount, first.currency).replace(/\u00a0/g, ' '));
    const manage = safeUrl(r.manageUrl);
    const answer = r.decision && !r.needsAnswer
      ? (r.decision.choice === 'keep' ? pick(locale, 'Keep it', 'Vou manter') : pick(locale, "I'll cancel", 'Vou cancelar'))
      : '';
    const years = r.termMonths ? r.termMonths / 12 : 0;
    const cycle = r.termMonths
      ? (Number.isInteger(years) ? pick(locale, `every ${years} years`, `a cada ${years} anos`) : pick(locale, `every ${r.termMonths} months`, `a cada ${r.termMonths} meses`))
      : r.cycle === 'unknown' ? pick(locale, 'not identified', 'não identificado') : cycleLabel(r.cycle, locale);
    const reasons = clip(riskReasonsOf(r.audit, locale).join('; '), ICS_MAX.reasons);
    const deadline = clip(localized(r.audit?.cancelDeadline, locale) ?? '', ICS_MAX.deadline);
    const lastDay = dayText(dayOf(r.lastCharge.date));
    const description = [
      pick(locale, `Cycle: ${cycle}`, `Ciclo: ${cycle}`),
      pick(locale, `Last charge: ${value} on ${lastDay}`, `Último valor: ${value} em ${lastDay}`),
      !manage ? ''
        : r.manageUrlVerified === true ? pick(locale, `Manage or cancel: ${manage}`, `Gerenciar ou cancelar: ${manage}`)
        : pick(locale, 'Manage or cancel: open the service’s own site (the link was not verified here)', 'Gerenciar ou cancelar: abra o site do próprio serviço (o link não foi verificado aqui)'),
      answer ? pick(locale, `Your answer for this renewal: ${answer}`, `Sua resposta para esta renovação: ${answer}`) : '',
      r.risk === 'high' ? pick(locale, 'High risk of a surprise charge', 'Risco alto de cobrança sem perceber') + (reasons ? `: ${reasons}` : '') : '',
      deadline ? pick(locale, `Cancel by: ${deadline}`, `Prazo para cancelar: ${deadline}`) : '',
    ].filter(Boolean).join('\n');
    const rrule = rruleOf(r);
    lines.push(
      'BEGIN:VEVENT',
      // só a chave, que não muda com o idioma: reimportar depois de uma renovação atualiza o mesmo evento em vez de duplicar a série
      `UID:${icsToken(r.key)}@etherfi-dash`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${next.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(next, 1).replace(/-/g, '')}`,
      `SUMMARY:${icsText(`${pick(locale, 'Renews', 'Renova')}: ${name}${valued ? '' : ` · ${value}`}`)}`,
      `DESCRIPTION:${icsText(description)}`,
      ...(rrule ? [`RRULE:${rrule}`] : []),
      'TRANSP:TRANSPARENT',
    );
    // risco alto ganha o aviso de 30 dias; os outros ficam com 14, 7 e 2
    for (const d of r.risk === 'high' ? HIGH_RISK_ALERT_DAYS : ALERT_DAYS) {
      const amount = valued ? '' : ` (${value})`;
      const text = pick(locale, `${name} renews in ${d} days${amount}: keep or cancel?`, `${name} renova em ${d} dias${amount}: manter ou cancelar?`);
      // o evento de dia inteiro começa à meia-noite: d dias antes às 9h = (d − 1) dias e 15 h antes. A parte em horas do
      // TRIGGER é exata (RFC 5545 §3.3.6): em fuso que troca o horário à meia-noite (America/Santiago), o alarme que
      // atravessa a troca cai às 8h ou às 10h. Aceito: são uns 4 alarmes em 1.460 por ano, e "dias" não daria a hora
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(text)}`, `TRIGGER:-P${d - 1}DT15H`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
