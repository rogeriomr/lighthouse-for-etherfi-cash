// Roda analyzeSubscriptions e buildIcs de verdade: cenários sintéticos (nomes inventados) para cada regra, o demo com
// alvos fixos e a pasta de dados reais (se existir) só com invariantes, sem nomes nem valores na saída.
// Regras que este check fixa:
// - entra por dicionário, base 'yes'/'maybe', email ou recorrência (≥ 2 cobranças no intervalo de um ciclo, valor até
//   25%; semanal pede 3); delivery, restaurantes, mercado, transporte e saúde só com base 'yes', email ou dicionário;
//   base 'no' exclui, salvo email (ou dicionário, quando a base só casou por trecho);
// - só a recorrência, sem nenhum outro sinal: semanal não entra, recarga não entra, e fora das categorias de assinatura
//   só com valor baixo (≤ US$ 30); aluguel, condomínio, seguro e escola viram conta recorrente (kind 'bill': sem aviso,
//   pergunta, risco, .ics nem total); confiança no máximo média, como com ciclo estimado;
// - item a item (domínios): cada compra é um registro; renovação cobrada antes do vencimento (chargeLeadDays) dá a
//   próxima data = fim do período − lead; período pago de mais de um ano vira termMonths, sem RRULE;
// - cobrança por uso (2 mudanças de mais de 25% nas 6 últimas): custo = média das 3 últimas, com "≈" no total;
// - links: só https (safeUrl); o que veio do email ou da IA fora do site conhecido do serviço sai "não verificado";
// - arquivos da IA passam por validate.ts; recurringView é a fonte única de "recorrente" do resto do painel;
// - o "esperando você" conta cada pergunta: cai 1 a cada resposta;
// - grupo = estabelecimento + item que casou, não marca; na base o primeiro item da lista que casa vence (trecho antes
//   de nome igual); item que casa só pelo texto da fatura com parte das cobranças separa essa parte com o nome dele;
//   emails de mesmo nome sem trecho em comum separam planos ("Nome · Domains"); email que casa só pelo texto da fatura
//   junta outro descritor; duas sequências de valor próprio viram dois registros (a mais antiga fica com o nome);
// - ciclo: email > recorrência > base com um ciclo > pesquisa com um ciclo > estimativa (o ciclo que já teria renovado
//   sai; depois US$ 60+ indica o mais longo, até US$ 25 o mais curto, no meio 'unknown');
// - próxima renovação: periodEnd do email quando passa da última cobrança além da tolerância; senão + 1 ciclo em mês
//   de calendário mantendo o dia (31/01 → 28/02 → 31/03; 29/02 no ano bissexto);
// - janelas: 8–14 d14, 3–7 d7, 0–2 d2, −1 a −3 due, depois sem aviso até a tolerância (mensal 7d) e então talvez
//   cancelada; aviso só na ativa; cancelamento no email depois da última cobrança → cancelada;
// - decisão vale para forRenewal; vencida pergunta de novo; sem decisão pergunta com aviso; 'cancel' seguido de
//   cobrança ganha um sinal;
// - custo mensal = última cobrança em USD / meses do ciclo, anual = mensal × 12, totais só das ativas;
// - .ics: CRLF, um VEVENT por ativa com renovação, 3 VALARM (−14, −7, −2 dias), RRULE do ciclo, texto escapado (CR
//   isolado e controles C0 também), linhas ≤ 75 octetos sem partir caractere, valor que o nome já traz não se repete;
// - idioma: inglês é o padrão; textos (sinais, nomes gerados, .ics) seguem o locale, e a chave e o UID não mudam
//   entre EN e PT (nem com o formato do dinheiro), batendo com as chaves salvas antes do inglês.
// Os cenários sintéticos conferem os textos em português (format.ts em PT, como a tela faria); a seção "inglês"
// repete os principais no padrão e a seção "mesma chave" roda cada cenário nos dois idiomas.
import { isDataFile, resolveDataDir } from './data-dir.mjs';
import { demoDataset } from '../src/lib/demo/dataset.ts';
import { enrichDataset } from '../src/lib/enrich.ts';
import { assembleDataset } from '../src/lib/normalize.ts';
import { CATEGORY } from '../src/lib/merchants.ts';
import { detectAnomalies, detectSubscriptions } from '../src/lib/analytics.ts';
import { dateFull, money, setFormatLocale } from '../src/lib/format.ts';
import { LOCALES, pick, type Locale } from '../src/lib/locale.ts';
import { analyzeSubscriptions, buildIcs, knowledgeFor, recurringMonthlyAt, recurringView, subscriptionKey } from '../src/lib/subscriptions.ts';
import {
  attentionOf, attentionSections, attentionSummary, plansToCancel, questionCounts, questionsSummary, waitingLabel, type AttentionItem,
} from '../src/lib/attentionModel.ts';
import { isKnownHost, safeUrl, serviceSite, siteOf, urlHost } from '../src/lib/url.ts';
import { validateSubscriptionSources } from '../src/lib/validate.ts';
import { SUBSCRIPTION_KNOWLEDGE } from '../src/lib/subscriptionKnowledge.ts';
import type {
  Cycle, EvidenceItem, EvidenceKind, KnowledgeItem, RenewalAuditItem, SubscriptionRecord, SubscriptionReport, UserDecision,
} from '../src/lib/subscriptionTypes.ts';
import type { Dataset, Transaction } from '../src/lib/types.ts';

// Tipos mínimos do Node: o projeto não depende de @types/node só por causa deste script
interface Fs {
  existsSync(p: URL): boolean;
  readdirSync(p: URL): string[];
  readFileSync(p: URL, encoding: 'utf8'): string;
}
declare const process: { exit(code: number): never; getBuiltinModule(id: 'node:fs'): Fs };
const { existsSync, readdirSync, readFileSync } = process.getBuiltinModule('node:fs');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const R2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const close = (a: number, b: number, parts: number) => Math.abs(a - b) <= 0.005 * (parts + 1) + 1e-9;

// Oráculos independentes do motor
const tsOf = (day: string) => Date.parse(`${day}T00:00:00Z`);
const days = (from: string, to: string) => Math.round((tsOf(to) - tsOf(from)) / 86400000);
const windowOf = (d: number, highRisk = false) => (highRisk && d >= 15 && d <= 30 ? 'd30'
  : d >= 8 && d <= 14 ? 'd14' : d >= 3 && d <= 7 ? 'd7' : d >= 0 && d <= 2 ? 'd2' : d >= -3 && d <= -1 ? 'due' : null);
const MONTHS: Record<string, number> = { weekly: 12 / 52, monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const TOLERANCE: Record<string, number> = { weekly: 3, monthly: 7, quarterly: 15, semiannual: 15, annual: 30, unknown: 7 };
const FREQ: Record<string, string> = { weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', quarterly: 'FREQ=MONTHLY;INTERVAL=3', semiannual: 'FREQ=MONTHLY;INTERVAL=6', annual: 'FREQ=YEARLY' };
// alarme às 9h do dia do aviso: o evento de dia inteiro começa à meia-noite, então são d·24 − 9 horas antes
const at9 = (d: number) => {
  const hours = d * 24 - 9;
  return `TRIGGER:-P${Math.floor(hours / 24)}DT${hours % 24}H`;
};
const daysKey = (r: SubscriptionRecord) => r.daysUntil ?? Number.MAX_SAFE_INTEGER;
const tagOf = (locale: Locale) => LOCALES.find((l) => l.value === locale)?.tag;
const recordOrder = (a: SubscriptionRecord, b: SubscriptionRecord, locale: Locale) =>
  Number(b.needsAnswer) - Number(a.needsAnswer) || daysKey(a) - daysKey(b) || a.name.localeCompare(b.name, tagOf(locale));
// data por extenso como o format.ts escreve no idioma corrente
const D = (day: string) => dateFull(`${day}T00:00:00Z`);

// ---------- .ics ----------

const encoder = new TextEncoder();
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// TEXT do RFC 5545: vírgula, ponto e vírgula e barra só escapados; barra só antes de \ ; , n
const validText = (v: string) => /^(?:[^\\,;]|\\[\\,;nN])*$/.test(v);
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '').split('\r\n').slice(0, -1);

function blocks(lines: string[], name: string): string[][] {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const l of lines) {
    if (l === `BEGIN:${name}`) cur = [];
    else if (l === `END:${name}`) {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) cur.push(l);
  }
  return out;
}

function icsChecks(ics: string, records: SubscriptionRecord[], locale: Locale): [string, boolean][] {
  const physical = ics.split('\r\n').slice(0, -1);
  const logical = unfold(ics);
  const expected = records.filter((r) => r.status === 'active' && r.nextRenewal && r.decision?.choice !== 'not_subscription' && r.kind !== 'bill');
  const events = blocks(logical, 'VEVENT');
  const byUid = new Map(events.map((e) => [e.find((l) => l.startsWith('UID:'))?.slice(4) ?? '', e]));
  const stack: string[] = [];
  let balanced = true;
  for (const l of logical) {
    if (l.startsWith('BEGIN:')) stack.push(l.slice(6));
    else if (l.startsWith('END:') && stack.pop() !== l.slice(4)) balanced = false;
  }
  const texts = logical.filter((l) => /^(SUMMARY|DESCRIPTION|X-WR-CALNAME):/.test(l)).map((l) => l.slice(l.indexOf(':') + 1));
  return [
    ['ics: CRLF em toda quebra de linha e no fim', !/\r(?!\n)|(?<!\r)\n/.test(ics) && ics.endsWith('\r\n')],
    ['ics: linhas de até 75 octetos', physical.every((l) => encoder.encode(l).length <= 75)],
    ['ics: a dobra não parte caractere', physical.every((l) => !LONE_SURROGATE.test(l))],
    ['ics: VCALENDAR com VERSION, PRODID e X-WR-CALNAME', logical[0] === 'BEGIN:VCALENDAR' && logical.at(-1) === 'END:VCALENDAR'
      && logical.includes('VERSION:2.0') && logical.some((l) => l.startsWith('PRODID:')) && logical.some((l) => l.startsWith('X-WR-CALNAME:'))],
    ['ics: BEGIN/END equilibrados', balanced && stack.length === 0],
    ['ics: um VEVENT por ativa com renovação', events.length === expected.length],
    ['ics: UID = chave do registro, um por evento', byUid.size === events.length && events.every((e) => /^UID:[a-z0-9-]+@etherfi-dash$/.test(e.find((l) => l.startsWith('UID:')) ?? ''))],
    ['ics: UID estável, DTSTART de dia inteiro, DTSTAMP e SUMMARY em cada evento', expected.every((r) => {
      const e = byUid.get(`${r.key}@etherfi-dash`);
      return Boolean(e && e.includes(`DTSTART;VALUE=DATE:${r.nextRenewal!.replace(/-/g, '')}`)
        && e.some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l)) && e.some((l) => l.startsWith(`SUMMARY:${pick(locale, 'Renews', 'Renova')}: `)));
    })],
    ['ics: 3 VALARM por evento (14, 7 e 2 dias antes, às 9h); 4 no risco alto (mais 30)', expected.every((r) => {
      const e = byUid.get(`${r.key}@etherfi-dash`) ?? [];
      const alarms = blocks(e, 'VALARM');
      const triggers = alarms.map((a) => a.find((l) => l.startsWith('TRIGGER:'))).sort().join();
      const high = r.risk === 'high';
      return alarms.length === (high ? 4 : 3) && triggers === (high ? [30, 14, 7, 2] : [14, 7, 2]).map(at9).sort().join()
        && alarms.every((a) => a.includes('ACTION:DISPLAY') && a.some((l) => l.startsWith('DESCRIPTION:')));
    })],
    ['ics: RRULE só com ciclo conhecido, na frequência do ciclo', expected.every((r) => {
      const rule = byUid.get(`${r.key}@etherfi-dash`)?.find((l) => l.startsWith('RRULE:'));
      if (r.cycle === 'unknown') return rule === undefined;
      return rule !== undefined && rule.slice(6).split(';').filter((p) => !p.startsWith('BY')).join(';') === FREQ[r.cycle];
    })],
    ['ics: texto escapado (vírgula, ponto e vírgula, barra, quebra)', texts.length > 0 && texts.every(validText)],
    ['ics: nenhum controle C0 nem DEL no arquivo além do CRLF', !/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/.test(ics)],
    ['ics: link de gerenciar só https; não verificado sai sem URL', expected.every((r) => {
      const d = byUid.get(`${r.key}@etherfi-dash`)?.find((l) => l.startsWith('DESCRIPTION:')) ?? '';
      const url = safeUrl(r.manageUrl);
      const line = pick(locale, 'Manage or cancel', 'Gerenciar ou cancelar');
      return !url ? !d.includes(line)
        : r.manageUrlVerified === true ? d.includes(url) && d.includes(line)
        : d.includes(line) && !d.includes(url);
    })],
  ];
}

// ---------- invariantes de qualquer relatório ----------

const isChargeTx = (t: Transaction) => t.type === 'purchase' && t.status !== 'void' && t.amountUsd > 0;
const sameSet = (a: SubscriptionRecord[], b: SubscriptionRecord[]) => a.length === b.length && a.every((r) => b.includes(r));
const ascending = (rs: SubscriptionRecord[]) => rs.every((r, i) => i === 0 || daysKey(rs[i - 1]) <= daysKey(r));

function invariantChecks(ds: Dataset, rep: SubscriptionReport, today: string, locale: Locale): [string, boolean][] {
  const recs = rep.records;
  // conta recorrente fica só em records: os totais, avisos e listas são das assinaturas
  const active = recs.filter((r) => r.status === 'active' && r.kind === 'subscription');
  const bills = recs.filter((r) => r.kind === 'bill');
  const ids = recs.flatMap((r) => r.charges.map((t) => t.id));
  const paidOf = (r: SubscriptionRecord) => r.charges.filter((t) => Date.parse(t.date) <= Date.parse(r.lastCharge.date));
  const view = recurringView(rep);
  const subIds = new Set(recs.filter((r) => r.kind === 'subscription' && r.status !== 'not_subscription').flatMap((r) => r.charges.map((t) => t.id)));
  const allIds = new Set(recs.filter((r) => r.status !== 'not_subscription').flatMap((r) => r.charges.map((t) => t.id)));
  const sameIds = (a: ReadonlySet<string>, b: Set<string>) => a.size === b.size && [...b].every((id) => a.has(id));
  return [
    ['todo registro tem cobrança, e a última está entre elas', recs.every((r) => r.charges.length > 0 && r.charges.includes(r.lastCharge))],
    ['cobranças são compras de fato do dataset, da mais antiga para a mais nova', recs.every((r) => r.charges.every((t, i, a) =>
      isChargeTx(t) && ds.transactions.includes(t) && (i === 0 || Date.parse(a[i - 1].date) <= Date.parse(t.date))))],
    ['nenhuma cobrança em dois registros', new Set(ids).size === ids.length],
    // o nome exibido pode mudar com o idioma ("In-flight Wi-Fi" × "Wi-Fi a bordo"); a chave não (ver "mesma chave")
    ['chave estável: só letras minúsculas, números e hífen, sem repetir', recs.every((r) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.key)) && new Set(recs.map((r) => r.key)).size === recs.length],
    ['próxima renovação ≥ última cobrança', recs.every((r) => r.nextRenewal === null || r.nextRenewal >= r.lastCharge.date.slice(0, 10))],
    ['daysUntil = dias corridos até a renovação', recs.every((r) => (r.nextRenewal === null) === (r.daysUntil === null) && (r.nextRenewal === null || r.daysUntil === days(today, r.nextRenewal)))],
    ['aviso só na assinatura ativa, na janela certa (d30 só no risco alto)', recs.every((r) => r.alert === (r.kind === 'subscription' && r.status === 'active' && r.daysUntil !== null ? windowOf(r.daysUntil, r.risk === 'high') : null))],
    ['risco: o da auditoria quando há; sem ela, alto só pela heurística (anual, ≥ US$ 100, sem aviso no email)', recs.every((r) => (r.kind === 'bill'
      ? r.risk === 'unknown' && r.riskSource === undefined
      : r.audit
        ? r.risk === r.audit.risk && r.riskSource === 'audit'
        : r.risk === 'high'
          ? r.riskSource === 'heuristic' && r.cycle === 'annual' && r.lastCharge.amountUsd >= 100
          : r.risk === 'unknown' && r.riskSource === undefined))],
    ['acabou de renovar: renovação (não a primeira, ou anunciada no email) de até 45 dias ou pendente, com os números certos', recs.every((r) => {
      const index = r.charges.indexOf(r.lastCharge);
      const day = r.lastCharge.date.slice(0, 10);
      const ago = days(day, today);
      const pending = r.lastCharge.status === 'pending';
      const inWindow = r.kind === 'subscription' && r.status !== 'not_subscription' && ((ago >= 0 && ago <= 45) || pending);
      const should = inWindow && index > 0;
      // a primeira cobrança só é renovação com aviso de renovação no email (e aí não há valor anterior)
      const noticed = r.signals.some((x) => x.kind === 'email' && /^(renewal notice|aviso de renovação) /.test(x.detail));
      const j = r.justRenewed;
      if (!j) return !should;
      const w = r.audit?.refundWindowDays;
      return (should || (inWindow && index === 0 && noticed)) && j.chargeId === r.lastCharge.id && j.date === day && j.daysAgo === ago && j.pending === pending
        && j.previousAmount === (index > 0 ? r.charges[index - 1].amount : undefined)
        && (w === undefined ? j.refundWindowDays === undefined && j.refundDaysLeft === undefined : j.refundWindowDays === w && j.refundDaysLeft === (w > 0 ? w - ago : null));
    })],
    ['lista de renovações recentes: só as que pedem atenção, da mais recente', (rep.justRenewed ?? []).every((r, i, a) => r.justRenewed && (i === 0 || a[i - 1].justRenewed!.date >= r.justRenewed.date))
      && sameSet(rep.justRenewed ?? [], recs.filter((r) => r.justRenewed && ((r.cycle !== 'monthly' && r.cycle !== 'weekly') || r.justRenewed.priceChanged || r.justRenewed.pending
        || (typeof r.justRenewed.refundDaysLeft === 'number' && r.justRenewed.refundDaysLeft >= 0))))],
    ['em risco = assinaturas ativas com risco alto, da renovação mais próxima', sameSet(rep.atRisk ?? [], active.filter((r) => r.risk === 'high')) && ascending(rep.atRisk ?? [])],
    ['ativa não passou da tolerância do ciclo', recs.filter((r) => r.status === 'active').every((r) => r.daysUntil === null || r.daysUntil >= -(r.termMonths ? TOLERANCE.annual : TOLERANCE[r.cycle]))],
    ['ciclo desconhecido: estimativa e custo zero; período de vários anos: email e cobrança ÷ prazo', recs.every((r) => r.cycle !== 'unknown' || (r.termMonths
      ? r.termMonths > 12 && r.cycleSource === 'email' && r.monthlyCostUsd === R2(r.lastCharge.amountUsd / r.termMonths)
      : r.cycleSource === 'estimate' && r.monthlyCostUsd === 0 && r.annualCostUsd === 0))],
    ['custo mensal = última cobrança em USD / meses do ciclo; por uso, a média das 3 últimas', recs.every((r) => {
      if (r.cycle === 'unknown') return !r.costApprox;
      if (!r.costApprox) return r.monthlyCostUsd === R2(r.lastCharge.amountUsd / MONTHS[r.cycle]);
      const last3 = paidOf(r).slice(-3);
      return r.monthlyCostUsd === R2(sum(last3.map((t) => t.amountUsd)) / last3.length / MONTHS[r.cycle]);
    })],
    ['custo anual = mensal × 12', recs.every((r) => Math.abs(r.annualCostUsd - r.monthlyCostUsd * 12) <= 0.06 + 1e-9)],
    ['totais = soma das assinaturas ativas; "≈" quando alguma é por uso', close(rep.monthlyTotalUsd, sum(active.map((r) => r.monthlyCostUsd)), active.length)
      && close(rep.annualTotalUsd, sum(active.map((r) => r.annualCostUsd)), active.length)
      && rep.monthlyApprox === active.some((r) => r.costApprox && r.monthlyCostUsd > 0)],
    ['próximas = ativas em até 60 dias, da mais próxima', sameSet(rep.upcoming, active.filter((r) => r.daysUntil !== null && r.daysUntil >= 0 && r.daysUntil <= 60)) && ascending(rep.upcoming)],
    ['avisos = ativas na janela sem "não é assinatura", da mais urgente', sameSet(rep.alerts, active.filter((r) => r.alert !== null && r.decision?.choice !== 'not_subscription')) && ascending(rep.alerts)],
    ['conta recorrente: sem aviso, pergunta, risco nem renovação recente', bills.every((r) => r.alert === null && !r.needsAnswer && r.risk === 'unknown' && !r.justRenewed)],
    ['ordem: precisa de resposta, dias até a renovação, nome', recs.every((r, i) => i === 0 || recordOrder(recs[i - 1], r, locale) <= 0)],
    ['pergunta só em ativa', recs.every((r) => !r.needsAnswer || r.status === 'active')],
    ['"não é assinatura" ⇔ decisão', recs.every((r) => (r.status === 'not_subscription') === (r.decision?.choice === 'not_subscription'))],
    ['sem decisão, pergunta só quando há aviso', recs.every((r) => r.decision || r.status !== 'active' || r.needsAnswer === (r.alert !== null))],
    ['cada registro explica por que entrou', recs.every((r) => r.signals.length > 0 && r.signals.every((s) => s.detail.trim().length > 0))],
    ['confiança alta só com email ou 3+ cobranças', recs.every((r) => r.confidence !== 'high' || r.signals.some((s) => s.kind === 'email') || r.charges.length >= 3)],
    ['confiança alta nunca com ciclo estimado nem só com a recorrência', recs.every((r) => r.confidence !== 'high' || (r.cycleSource !== 'estimate' && r.signals.some((s) => s.kind !== 'recurrence')))],
    ['links só https: gerenciar e fontes dos sinais', recs.every((r) => (r.manageUrl === undefined || safeUrl(r.manageUrl) === r.manageUrl)
      && (r.manageUrl === undefined) === (r.manageUrlVerified === undefined)
      && r.signals.every((s) => s.source === undefined || (safeUrl(s.source) === s.source && typeof s.sourceVerified === 'boolean')))],
    ['recurringView: as mesmas cobranças e o mesmo total da aba', sameIds(view.subscriptionChargeIds, subIds) && sameIds(view.recurringChargeIds, allIds)
      && view.monthlyTotalUsd === rep.monthlyTotalUsd && view.items.length === recs.filter((r) => r.status !== 'not_subscription').length
      && recurringView(rep) === view && close(recurringMonthlyAt(view, today.slice(0, 7), today).totalUsd, rep.monthlyTotalUsd, active.length)],
    ...icsChecks(buildIcs(recs, { now: `${today}T12:00:00Z`, locale }), recs, locale),
  ];
}

// ---------- cenários sintéticos ----------

let seq = 0;
const buy = (day: string, merchant: string, amount: number, extra: Partial<Transaction> = {}): Transaction => {
  const currency = extra.currency ?? 'BRL';
  return {
    id: `s${++seq}`,
    type: 'purchase',
    status: 'settled',
    date: `${day}T15:00:00Z`,
    merchant,
    merchantRaw: merchant.toUpperCase(),
    brand: merchant,
    category: CATEGORY.software,
    amount,
    currency,
    // 5 BRL por USD
    amountUsd: currency === 'USD' ? amount : R2(amount / 5),
    ...extra,
  };
};
const dataset = (transactions: Transaction[], referenceDate: string, evidence?: EvidenceItem[], research?: KnowledgeItem[]): Dataset => ({
  referenceDate,
  account: { creditLimit: 0, amountBorrowed: 0, availableBalance: 0, vaultAddress: '', currency: 'USD' },
  cards: [],
  portfolio: { totalValue: 0, holdings: [] },
  deposit: { address: '', networks: [], assets: [] },
  transactions,
  homeCurrency: 'BRL',
  subscriptionSources: {
    evidence: evidence && { generatedAt: referenceDate, source: 'sintético', items: evidence },
    research: research && { generatedAt: referenceDate, items: research },
  },
});
const know = (name: string, isSubscription: KnowledgeItem['isSubscription'], cycles: Cycle[], extra: Partial<KnowledgeItem> = {}): KnowledgeItem =>
  ({ name, matchers: [name.toUpperCase()], isSubscription, cycles, sources: ['https://exemplo.invalid/fonte'], ...extra });
const email = (name: string, kind: EvidenceKind, emailDate: string, extra: Partial<EvidenceItem> = {}): EvidenceItem =>
  ({ name, matchers: [name.toUpperCase()], kind, emailDate, subject: `${name}: aviso`, cycle: 'unknown', ...extra });
const find = (rep: SubscriptionReport, name: string) => rep.records.find((r) => r.name === name);

const runs: { label: string; bad: string[] }[] = [];
// idioma dos cenários: português até a seção "inglês"; o format.ts acompanha, como a tela faz
let LOCALE: Locale = 'pt';
const useLocale = (locale: Locale) => {
  LOCALE = locale;
  setFormatLocale(locale);
};
useLocale('pt');
type RunOpts = { knowledge?: KnowledgeItem[]; decisions?: Record<string, UserDecision>; today?: string; locale?: Locale };
function run(label: string, ds: Dataset, opts: RunOpts = {}): SubscriptionReport {
  const locale = opts.locale ?? LOCALE;
  const rep = analyzeSubscriptions(ds, { knowledge: opts.knowledge ?? [], decisions: opts.decisions, today: opts.today, locale });
  runs.push({ label: `${label} (${locale})`, bad: invariantChecks(ds, rep, opts.today ?? ds.referenceDate, locale).filter(([, ok]) => !ok).map(([name]) => name) });
  return rep;
}

console.log('== chave ==');
for (const [name, key] of [['iCloud+', 'icloud-plus'], ['Claude (Anthropic)', 'claude-anthropic'], ['Pedejá Clube', 'pedeja-clube'], ['Lanches · via App', 'lanches-via-app'], ['', 'sem-nome']]) {
  check(`subscriptionKey("${name}") = ${key}`, subscriptionKey(name) === key, subscriptionKey(name));
}

console.log('\n== mensal recorrente: próxima renovação e janelas de aviso ==');
const TODAY = '2026-10-17';
const aDays = ['2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10'];
const dsA = dataset(aDays.map((d) => buy(d, 'Streamora Plus', 39.9)), TODAY);
const a = find(run('mensal', dsA), 'Streamora Plus');
check('entra só pela recorrência (sem dicionário nem base), ciclo mensal; só a recorrência não passa de confiança média', a?.cycle === 'monthly' && a.cycleSource === 'recurrence' && a.confidence === 'medium' && a.kind === 'subscription', `${a?.cycle} ${a?.cycleSource} ${a?.confidence}`);
check('próxima renovação = última + 1 mês: 10/11, em 24 dias', a?.nextRenewal === '2026-11-10' && a.daysUntil === 24, `${a?.nextRenewal} ${a?.daysUntil}`);
check('sinal "5 cobranças a cada ~N dias, valor estável"', Boolean(a?.signals.some((s) => s.kind === 'recurrence' && /^5 cobranças a cada ~3\d dias, valor estável$/.test(s.detail))), String(a?.signals.map((s) => s.detail).join(' | ')));
check('custo: 39,90 BRL = 7.98 USD por mês, 95.76 por ano', a?.monthlyCostUsd === 7.98 && a.annualCostUsd === 95.76);
const WINDOWS: [string, number, string | null, SubscriptionRecord['status']][] = [
  ['2026-10-26', 15, null, 'active'], ['2026-10-27', 14, 'd14', 'active'], ['2026-11-02', 8, 'd14', 'active'],
  ['2026-11-03', 7, 'd7', 'active'], ['2026-11-07', 3, 'd7', 'active'], ['2026-11-08', 2, 'd2', 'active'],
  ['2026-11-10', 0, 'd2', 'active'], ['2026-11-11', -1, 'due', 'active'], ['2026-11-13', -3, 'due', 'active'],
  ['2026-11-14', -4, null, 'active'], ['2026-11-17', -7, null, 'active'], ['2026-11-18', -8, null, 'maybe_cancelled'],
];
for (const [today, d, alert, status] of WINDOWS) {
  const rep = run(`janela ${d}`, dsA, { today });
  const x = find(rep, 'Streamora Plus');
  check(`${d} dias → ${alert ?? 'sem aviso'}, ${status}`, x?.daysUntil === d && x.alert === alert && x.status === status
    && rep.alerts.includes(x) === (alert !== null) && x.needsAnswer === (alert !== null), `${x?.daysUntil} ${x?.alert} ${x?.status}`);
}
const lapsedA = find(run('renovação vencida', dsA, { today: '2026-11-18' }), 'Streamora Plus');
check('talvez cancelada mantém a data que passou e explica', lapsedA?.nextRenewal === '2026-11-10' && Boolean(lapsedA.signals.some((s) => s.detail.includes(D('2026-11-10')))));

console.log('\n== anual com uma cobrança, base e estimativa ==');
const dsB = dataset([buy('2026-03-15', 'Nuvem Arquivo', 99, { currency: 'USD', merchantRaw: 'NUVEMARQ*PLANO' })], TODAY);
check('uma cobrança sem nenhum sinal fica de fora', !find(run('anual sem base', dsB), 'Nuvem Arquivo'));
const kB = know('NuvemArq', 'yes', ['annual'], { matchers: ['nuvemarq'], manageUrl: 'https://exemplo.invalid/conta' });
const b = find(run('anual com base', dsB, { knowledge: [kB] }), 'Nuvem Arquivo');
check('base casa por trecho do texto da fatura, sem diferenciar maiúsculas', Boolean(b));
check('ciclo anual pela base, confiança média, renova em 15/03/2027', b?.cycle === 'annual' && b.cycleSource === 'knowledge' && b.confidence === 'medium' && b.nextRenewal === '2027-03-15', `${b?.cycle} ${b?.confidence} ${b?.nextRenewal}`);
check('custo anual: 99 / 12 = 8.25 por mês, 99 por ano', b?.monthlyCostUsd === 8.25 && b.annualCostUsd === 99);
check('gerenciar vem da base e o sinal cita a fonte', b !== undefined && b.manageUrl === kB.manageUrl && Boolean(b.signals.some((s) => s.kind === 'knowledge' && s.source === kB.sources[0])));
check('base casa também pelo nome igual ao estabelecimento', find(run('anual pelo nome', dsB, { knowledge: [know('Nuvem Arquivo', 'yes', ['annual'], { matchers: [] })] }), 'Nuvem Arquivo')?.cycle === 'annual');
const kE = know('Estudio Pixel', 'yes', ['monthly', 'annual']);
const estimate = (day: string, usd: number) => find(run(`estimativa ${usd}`, dataset([buy(day, 'Estudio Pixel', usd, { currency: 'USD' })], TODAY), { knowledge: [kE] }), 'Estudio Pixel');
const e1 = estimate('2026-10-07', 120);
check('cobrança única alta de serviço mensal ou anual → anual estimado, confiança baixa', e1?.cycle === 'annual' && e1.cycleSource === 'estimate' && e1.confidence === 'low' && e1.nextRenewal === '2027-10-07', `${e1?.cycle} ${e1?.confidence}`);
const e2 = estimate('2026-07-09', 9);
check('100 dias sem cobrança nova: não é mensal → anual, mesmo com valor baixo', e2?.cycle === 'annual' && e2.status === 'active' && e2.nextRenewal === '2027-07-09' && Boolean(e2.signals.some((s) => s.detail.includes('não é mensal'))), `${e2?.cycle}`);
const e3 = estimate('2026-10-07', 40);
check('valor do meio e cobrança recente → ciclo desconhecido, sem renovação nem custo', e3?.cycle === 'unknown' && e3.nextRenewal === null && e3.monthlyCostUsd === 0 && e3.alert === null && e3.status === 'active');
const e4 = estimate('2026-10-07', 12);
check('cobrança única baixa e recente → mensal estimado', e4?.cycle === 'monthly' && e4.cycleSource === 'estimate' && e4.nextRenewal === '2026-11-07');
const kPub = know('Revista Trimestral', 'yes', ['monthly', 'annual'], { sources: ['https://exemplo.invalid/publica'] });
const kRes = know('Revista Trimestral', 'yes', ['quarterly'], { sources: ['https://exemplo.invalid/pesquisa'] });
const rr = find(run('pesquisa', dataset([buy('2026-09-20', 'Revista Trimestral', 30)], TODAY, undefined, [kRes]), { knowledge: [kPub, kRes] }), 'Revista Trimestral');
check('base com vários ciclos + pesquisa com um só → ciclo da pesquisa', rr?.cycle === 'quarterly' && rr.cycleSource === 'research' && rr.nextRenewal === '2026-12-20', `${rr?.cycle} ${rr?.cycleSource}`);
check('sinais separam base pública e pesquisa', Boolean(rr?.signals.some((s) => s.kind === 'knowledge') && rr.signals.some((s) => s.kind === 'research')));
const leap = find(run('anual 29/02', dataset([buy('2028-02-29', 'Plano Bissexto', 120, { currency: 'USD' })], '2028-03-10'), { knowledge: [know('Plano Bissexto', 'yes', ['annual'])] }), 'Plano Bissexto');
check('anual em 29/02 → 28/02 do ano seguinte', leap?.nextRenewal === '2029-02-28', String(leap?.nextRenewal));

console.log('\n== email: periodEnd, ciclo deduzido, cancelamento ==');
const evC = email('Streamora Max', 'renewal_notice', '2026-10-12', { cycle: 'monthly', periodEnd: '2026-11-15', plan: 'Família', manageUrl: 'https://exemplo.invalid/streamora' });
const dsC = (ev: EvidenceItem[]) => dataset(aDays.map((d) => buy(d, 'Streamora Max', 55.9)), TODAY, ev);
const c = find(run('email sobre recorrência', dsC([evC])), 'Streamora Max');
check('periodEnd do email vence a conta da recorrência (15/11, não 10/11)', c?.nextRenewal === '2026-11-15' && c.cycleSource === 'email' && c.confidence === 'high', String(c?.nextRenewal));
check('plano e gerenciar vêm do email', c?.plan === 'Família' && c.manageUrl === evC.manageUrl);
check('sinal do email primeiro, com data e plano', c?.signals[0]?.kind === 'email' && c.signals[0].detail.startsWith(`aviso de renovação no email em ${D('2026-10-12')}: Família (mensal)`), String(c?.signals[0]?.detail));
const c2 = find(run('periodEnd colado', dsC([email('Streamora Max', 'receipt', '2026-09-10', { cycle: 'monthly', periodEnd: '2026-10-11' })])), 'Streamora Max');
check('periodEnd colado na última cobrança é a renovação que já aconteceu: conta pelo ciclo', c2?.nextRenewal === '2026-11-10', String(c2?.nextRenewal));
const d1 = find(run('ciclo pelo periodEnd', dataset([buy('2026-09-01', 'Revista Digital', 59, { currency: 'USD' })], TODAY, [email('Revista Digital', 'receipt', '2026-09-01', { periodEnd: '2027-09-01' })])), 'Revista Digital');
check('só o email põe dentro; sem ciclo dito, periodEnd − cobrança = 365 dias → anual', d1?.cycle === 'annual' && d1.cycleSource === 'email' && d1.nextRenewal === '2027-09-01' && d1.confidence === 'high', `${d1?.cycle} ${d1?.nextRenewal}`);
check('recibo sem plano mas com ciclo: "plano anual"', find(run('recibo anual', dataset([buy('2026-10-11', 'Revista Digital', 59, { currency: 'USD' })], TODAY, [email('Revista Digital', 'receipt', '2026-10-11', { cycle: 'annual' })])), 'Revista Digital')?.signals[0]?.detail === `recibo no email em ${D('2026-10-11')}: plano anual`);
const dDays = ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'];
const dsD = (emailDate: string) => dataset(dDays.map((d) => buy(d, 'Musica Livre', 21.9)), TODAY, [email('Musica Livre', 'cancellation', emailDate, { cycle: 'monthly' })]);
const repD = run('cancelamento', dsD('2026-10-08'));
const dd = find(repD, 'Musica Livre');
check('cancelamento no email depois da última cobrança → cancelada, sem aviso nem próximas', dd?.status === 'cancelled' && dd.alert === null && !repD.alerts.length && !repD.upcoming.length, String(dd?.status));
check('cancelada fica fora dos totais e mostra a renovação que não deve acontecer', repD.monthlyTotalUsd === 0 && dd?.nextRenewal === '2026-11-05');
check('cancelamento antes da última cobrança (voltou a assinar) → ativa', find(run('cancelamento antigo', dsD('2026-08-20')), 'Musica Livre')?.status === 'active');
const refunded = find(run('estorno', dataset([...dDays.map((d) => buy(d, 'Musica Livre', 21.9)), buy('2026-10-07', 'Musica Livre', -21.9)], TODAY)), 'Musica Livre');
check('última cobrança estornada → talvez cancelada', refunded?.status === 'maybe_cancelled' && Boolean(refunded.signals.some((s) => s.detail.includes('estornada'))), String(refunded?.status));
const twoGroups = dataset([
  ...dDays.map((d) => buy(d, 'Nuvem Fotos', 9.9)),
  ...dDays.map((d) => buy(d, 'Nuvem Musica', 14.9)),
], TODAY, [email('Nuvem Fotos Pro', 'receipt', '2026-10-05', { matchers: ['NUVEM'], cycle: 'monthly' })]);
const repTwo = run('email com trecho genérico', twoGroups);
check('email de trecho genérico vai só para o grupo de nome mais parecido', Boolean(find(repTwo, 'Nuvem Fotos')?.signals.some((s) => s.kind === 'email')) && !find(repTwo, 'Nuvem Musica')?.signals.some((s) => s.kind === 'email'));

console.log('\n== renovação perdida, base "não", categorias que pedem confirmação ==');
const lost = find(run('renovação perdida', dataset(['2026-06-20', '2026-07-20', '2026-08-20'].map((d) => buy(d, 'Curso Online Atlas', 89)), TODAY)), 'Curso Online Atlas');
check('renovação de 20/09 passou da tolerância → talvez cancelada, sem aviso', lost?.status === 'maybe_cancelled' && lost.nextRenewal === '2026-09-20' && lost.daysUntil === -27 && lost.alert === null, `${lost?.status} ${lost?.daysUntil}`);
const fDays = ['2026-07-02', '2026-08-02', '2026-09-02', '2026-10-02'];
const dsF = (ev?: EvidenceItem[]) => dataset(fDays.map((d) => buy(d, 'Papelaria Central', 45, { category: CATEGORY.shopping })), TODAY, ev);
const kNo = know('Papelaria Central', 'no', []);
check('sem base, a recorrência põe dentro', Boolean(find(run('no: sem base', dsF()), 'Papelaria Central')));
check('base "não é assinatura" exclui', !find(run('no: com base', dsF(), { knowledge: [kNo] }), 'Papelaria Central'));
check('base "não" com email que confirma: entra', Boolean(find(run('no: com email', dsF([email('Papelaria Central', 'receipt', '2026-10-02', { cycle: 'monthly' })]), { knowledge: [kNo] }), 'Papelaria Central')));
const hinted = dataset(fDays.map((d) => buy(d, 'Video Clube', 30, { subscriptionHint: true })), TODAY);
check('dicionário vence base "não" que só casou por trecho', Boolean(find(run('no: trecho', hinted, { knowledge: [know('Video', 'no', [], { matchers: ['VIDEO'] })] }), 'Video Clube')));
check('base "não" com o mesmo nome vence o dicionário', !find(run('no: nome', hinted, { knowledge: [know('Video Clube', 'no', [])] }), 'Video Clube'));
const gDays = ['2026-07-12', '2026-08-12', '2026-09-12', '2026-10-12'];
const lanche = dataset(gDays.map((d) => buy(d, 'Lanches Tia Nena · via Pedejá', 35, { category: CATEGORY.delivery })), TODAY);
check('delivery recorrente sem base fica de fora', !run('delivery', lanche).records.length);
check('delivery com base "sim" entra', Boolean(find(run('delivery com base', lanche, { knowledge: [know('Lanches Tia Nena · via Pedejá', 'yes', ['monthly'])] }), 'Lanches Tia Nena · via Pedejá')));
const padaria = dataset(gDays.map((d) => buy(d, 'Padaria Sol Nascente', 28, { category: CATEGORY.dining })), TODAY);
check('restaurante recorrente sem base fica de fora', !run('restaurante', padaria).records.length);
check('restaurante com base "talvez" continua de fora (pede "sim" ou email)', !run('restaurante talvez', padaria, { knowledge: [know('Padaria Sol Nascente', 'maybe', ['monthly'])] }).records.length);
for (const [category, merchant] of [[CATEGORY.groceries, 'Hortifruti Bairro'], [CATEGORY.transport, 'Estacionamento Centro']]) {
  check(`${category} recorrente sem base fica de fora`, !run(category, dataset(gDays.map((d) => buy(d, merchant, 60, { category })), TODAY)).records.length);
}
check('saúde com dicionário (academia) entra', Boolean(find(run('academia', dataset(gDays.map((d) => buy(d, 'Academia Forma', 99, { category: CATEGORY.health, subscriptionHint: true })), TODAY)), 'Academia Forma')));
check('saúde sem dicionário nem base fica de fora', !run('saúde', dataset(gDays.map((d) => buy(d, 'Clinica Vida', 99, { category: CATEGORY.health })), TODAY)).records.length);

console.log('\n== agrupamento ==');
const app = dataset([
  ...gDays.map((d) => buy(d, 'Pedejá', 5.95, { category: CATEGORY.delivery, merchantRaw: 'PEDEJA CLUBE' })),
  buy('2026-08-20', 'Pedejá', 64, { category: CATEGORY.delivery, merchantRaw: 'PEDEJA*PEDIDO' }),
  buy('2026-10-14', 'Pedejá', 41.5, { category: CATEGORY.delivery, merchantRaw: 'PEDEJA*PEDIDO' }),
], TODAY);
const repApp = run('clube dentro do app', app, { knowledge: [know('Pedejá Clube', 'yes', ['monthly'], { matchers: ['PEDEJA CLUBE'] })] });
const clube = find(repApp, 'Pedejá Clube');
check('item que casa só com parte das cobranças vira grupo próprio', clube?.key === 'pedeja-clube' && clube.charges.length === 4 && clube.charges.every((t) => t.merchantRaw === 'PEDEJA CLUBE'), `${clube?.charges.length}`);
check('a última cobrança é a do clube, não o pedido mais recente', Boolean(clube?.lastCharge.date.startsWith('2026-10-12')) && clube?.nextRenewal === '2026-11-12');
check('o resto do app (pedidos) não vira assinatura', repApp.records.length === 1, repApp.records.map((r) => r.name).join(', '));
const store = dataset([
  ...['2026-07-01', '2026-07-19', '2026-08-03', '2026-09-27'].map((d) => buy(d, 'Loja Grande', 120, { brand: 'Loja Grande', category: CATEGORY.shopping })),
  ...gDays.map((d) => buy(d, 'Loja Grande Prime', 19.9, { brand: 'Loja Grande', subscriptionHint: true })),
], TODAY);
const repStore = run('estabelecimento, não marca', store);
check('agrupa por estabelecimento, não por marca (o clube da loja ≠ compras na loja)', repStore.records.length === 1 && find(repStore, 'Loja Grande Prime')?.charges.length === 4);
const canal = dataset([
  ...['2026-05-03', '2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'].map((d) => buy(d, 'Canal Video', 14.99, { subscriptionHint: true })),
  ...['2026-08-16', '2026-09-16', '2026-10-16'].map((d) => buy(d, 'Canal Video', 39.99, { subscriptionHint: true })),
  buy('2026-09-20', 'Canal Video', 60, { subscriptionHint: true }),
], TODAY);
const repCanal = run('duas assinaturas no mesmo estabelecimento', canal);
const canal1 = find(repCanal, 'Canal Video');
const canal2 = find(repCanal, 'Canal Video · R$ 39,99');
check('duas sequências no mesmo estabelecimento: dois registros, cada um com a sua renovação', canal1?.nextRenewal === '2026-11-03' && canal2?.nextRenewal === '2026-11-16'
  && canal1.charges.length === 6 && canal2.charges.length === 3, `${canal1?.nextRenewal} ${canal2?.nextRenewal}`);
check('a mais antiga fica com o nome; a cobrança avulsa não vira terceira assinatura', repCanal.records.length === 2, repCanal.records.map((r) => r.name).join(', '));
const usage = find(run('cobrança por uso', dataset(
  ['2026-04-30', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((d, i) => buy(d, 'Banco Nuvem', [0.7, 7.6, 31.3, 37.6, 39.4, 30.2][i], { currency: 'USD', subscriptionHint: true })),
  TODAY)), 'Banco Nuvem');
check('com sinal, a data manda: cobrança por uso de valor variável é mensal', usage?.cycle === 'monthly' && usage.charges.length === 6 && usage.nextRenewal === '2026-11-01'
  && Boolean(usage.signals.some((s) => s.detail.includes('valor muda bastante'))), `${usage?.cycle} ${usage?.charges.length}`);
const filled = find(run('uso no meio', dataset([
  ...['2026-02-12', '2026-03-12', '2026-04-12', '2026-05-12', '2026-07-12', '2026-08-12', '2026-09-12'].map((d) => buy(d, 'Hospeda Web', 20, { currency: 'USD', subscriptionHint: true })),
  buy('2026-06-12', 'Hospeda Web', 67.4, { currency: 'USD', subscriptionHint: true }),
  buy('2026-10-12', 'Hospeda Web', 79.7, { currency: 'USD', subscriptionHint: true }),
  buy('2026-09-24', 'Hospeda Web', 15, { currency: 'USD', subscriptionHint: true }),
], TODAY)), 'Hospeda Web');
check('cobrança de valor diferente na data esperada completa a sequência (uso) e a avulsa fica de fora', filled?.charges.length === 9 && filled.lastCharge.amount === 79.7 && filled.nextRenewal === '2026-11-12', `${filled?.charges.length}`);
const paused = find(run('pausa', dataset(['2026-01-08', '2026-02-08', '2026-03-08', '2026-07-08', '2026-08-08', '2026-10-08'].map((d) => buy(d, 'Revista Pausa', 25, { subscriptionHint: true })), TODAY)), 'Revista Pausa');
check('pausa e volta no mesmo valor continuam a mesma assinatura', paused?.charges.length === 6 && paused.nextRenewal === '2026-11-08' && paused.status === 'active', `${paused?.charges.length} ${paused?.nextRenewal}`);
const interleaved = dataset([
  ...['2026-07-02', '2026-08-02', '2026-09-02'].map((d) => buy(d, 'Livraria Rua', 45, { category: CATEGORY.shopping })),
  buy('2026-08-15', 'Livraria Rua', 130, { category: CATEGORY.shopping }),
], TODAY);
check('sem sinal, compra no meio da sequência desfaz a recorrência', !run('sem sinal, intercalada', interleaved).records.length);

console.log('\n== divisão pelo item da base e pelo email ==');
const hostTx = () => [
  ...['2026-06-12', '2026-07-12', '2026-08-12', '2026-09-12', '2026-10-12'].map((d) => buy(d, 'Nuvem Hospeda', 20, { currency: 'USD', merchantRaw: 'NUVEM HOSPEDA INC' })),
  ...['2025-09-24', '2026-09-24'].map((d) => buy(d, 'Nuvem Hospeda', 15, { currency: 'USD', merchantRaw: 'NUVEM HOSPEDA DOMAINS' })),
];
const repHost = run('dois planos pelo email', dataset(hostTx(), TODAY, [
  email('Nuvem Hospeda', 'receipt', '2026-10-12', { matchers: ['NUVEM HOSPEDA INC'], cycle: 'monthly', periodEnd: '2026-11-12' }),
  email('Nuvem Hospeda', 'renewal_notice', '2026-09-17', { matchers: ['NUVEM HOSPEDA DOMAINS'], cycle: 'annual', periodEnd: '2027-09-24' }),
]));
const hostPro = find(repHost, 'Nuvem Hospeda');
const hostDomains = find(repHost, 'Nuvem Hospeda · Domains');
check('emails de mesmo nome com trechos diferentes separam os dois planos do estabelecimento', repHost.records.length === 2 && hostPro?.charges.length === 5 && hostDomains?.charges.length === 2
  && hostPro.charges.every((t) => t.merchantRaw === 'NUVEM HOSPEDA INC'), repHost.records.map((r) => `${r.name} (${r.charges.length})`).join(', '));
check('cada plano fica com o seu email, ciclo e renovação', hostPro?.cycle === 'monthly' && hostPro.nextRenewal === '2026-11-12' && hostDomains?.cycle === 'annual'
  && hostDomains.cycleSource === 'email' && hostDomains.nextRenewal === '2027-09-24'
  && hostPro.signals.filter((s) => s.kind === 'email').length === 1 && hostDomains.signals.filter((s) => s.kind === 'email').length === 1);
const kDomains = know('Nuvem Hospeda Domains', 'yes', ['annual'], { matchers: ['NUVEM HOSPEDA DOMAINS'] });
const kHost = know('Nuvem Hospeda', 'yes', ['monthly'], { matchers: ['NUVEM HOSPEDA'] });
const repK = run('dois planos pela base', dataset(hostTx(), TODAY), { knowledge: [kDomains, kHost] });
check('base do específico para o genérico: o item que casa só pelo texto da fatura separa a parte, com o nome dele', repK.records.length === 2
  && find(repK, 'Nuvem Hospeda Domains')?.charges.length === 2 && find(repK, 'Nuvem Hospeda')?.charges.length === 5, repK.records.map((r) => r.name).join(', '));
check('cada parte com o ciclo e a base do seu item', find(repK, 'Nuvem Hospeda Domains')?.cycle === 'annual' && find(repK, 'Nuvem Hospeda')?.cycle === 'monthly'
  && Boolean(find(repK, 'Nuvem Hospeda Domains')?.signals.some((s) => s.kind === 'knowledge' && s.detail.includes('(anual)'))));
const repKr = run('base fora de ordem', dataset(hostTx(), TODAY), { knowledge: [kHost, kDomains] });
check('o primeiro item que casa vence: o genérico antes do específico fica com todas as cobranças', !find(repKr, 'Nuvem Hospeda Domains')
  && repKr.records.every((r) => r.signals.some((s) => s.kind === 'knowledge' && s.detail.includes('(mensal)'))), repKr.records.map((r) => r.name).join(', '));
const repAssist = run('"não" antes do "sim"', dataset([
  ...gDays.map((d) => buy(d, 'Assistente IA', 20, { currency: 'USD', merchantRaw: 'ASSISTENTE IA *PLUS' })),
  ...['2026-08-03', '2026-09-03', '2026-10-03'].map((d) => buy(d, 'Assistente IA', 5, { currency: 'USD', merchantRaw: 'ASSISTENTE IA *API' })),
], TODAY), { knowledge: [know('Assistente IA API', 'no', [], { matchers: ['ASSISTENTE IA *API'] }), know('Assistente IA', 'yes', ['monthly'], { matchers: ['ASSISTENTE IA'] })] });
check('"não" específico antes do "sim" genérico: a assinatura entra, os créditos de uso (mesmo mensais) não', repAssist.records.length === 1
  && find(repAssist, 'Assistente IA')?.charges.every((t) => t.merchantRaw === 'ASSISTENTE IA *PLUS') === true, repAssist.records.map((r) => r.name).join(', '));
const repGamer = run('dois itens com o mesmo nome', dataset([
  ...['2025-09-20', '2026-09-20'].map((d) => buy(d, 'Chat Gamer', 50, { currency: 'USD', merchantRaw: 'CHAT GAMER*NITRO' })),
  ...['2026-08-05', '2026-09-05', '2026-10-05'].map((d) => buy(d, 'Chat Gamer', 3, { currency: 'USD', merchantRaw: 'CHAT GAMER BOOST' })),
], TODAY), { knowledge: [know('Chat Gamer', 'yes', ['annual'], { matchers: ['CHAT GAMER*NITRO'] }), know('Chat Gamer', 'maybe', ['monthly'], { matchers: ['CHAT GAMER'] })] });
check('trecho antes de nome igual: o item específico não leva as outras cobranças só por ter o mesmo nome', find(repGamer, 'Chat Gamer · Nitro')?.cycle === 'annual'
  && find(repGamer, 'Chat Gamer · Nitro')?.charges.length === 2 && find(repGamer, 'Chat Gamer')?.charges.length === 3, repGamer.records.map((r) => r.name).join(', '));
const repFoto = run('email junta descritores', dataset([
  ...['2026-05-06', '2026-06-06'].map((d) => buy(d, 'Pagamento Digital', 49.9, { merchantRaw: 'DL*PAGDIG FOTONUVEM' })),
  ...['2026-07-06', '2026-08-06', '2026-09-06', '2026-10-06'].map((d) => buy(d, 'Foto Nuvem', 49.9, { merchantRaw: 'FOTO NUVEM 2TB' })),
], TODAY, [
  // os dois recibos não têm trecho em comum; o aviso, mais recente, cita os dois descritores e liga as duas partes
  email('Foto Nuvem', 'receipt', '2026-06-06', { matchers: ['DL*PAGDIG FOTONUVEM'], cycle: 'monthly' }),
  email('Foto Nuvem', 'receipt', '2026-10-06', { matchers: ['FOTO NUVEM'], cycle: 'monthly' }),
  email('Foto Nuvem', 'renewal_notice', '2026-10-15', { matchers: ['FOTO NUVEM', 'DL*PAGDIG FOTONUVEM'], cycle: 'monthly' }),
]));
const foto = find(repFoto, 'Foto Nuvem');
check('email que casa só pelo texto da fatura junta outro descritor da mesma assinatura', repFoto.records.length === 1 && foto?.charges.length === 6 && foto.nextRenewal === '2026-11-06'
  && foto.signals.filter((s) => s.kind === 'email').length === 2, repFoto.records.map((r) => `${r.name} (${r.charges.length})`).join(', '));

console.log('\n== decisões ==');
const keyA = subscriptionKey('Streamora Plus');
const decide = (choice: UserDecision['choice'], at: string, forRenewal?: string): Record<string, UserDecision> => ({ [keyA]: forRenewal ? { choice, at, forRenewal } : { choice, at } });
const AT_D7 = '2026-11-03';
const noDecision = find(run('sem decisão', dsA, { today: AT_D7 }), 'Streamora Plus');
check('sem decisão e com aviso: pergunta', noDecision?.needsAnswer === true && noDecision.decision === undefined);
check('sem decisão e sem aviso: não pergunta', find(run('sem decisão sem aviso', dsA, { today: '2026-10-20' }), 'Streamora Plus')?.needsAnswer === false);
const keep = find(run('manter', dsA, { today: AT_D7, decisions: decide('keep', '2026-10-30T12:00:00Z', '2026-11-10') }), 'Streamora Plus');
check('"manter" para esta renovação: não pergunta e o aviso continua', keep?.needsAnswer === false && keep.alert === 'd7' && keep.decision?.choice === 'keep');
const expired = find(run('decisão vencida', dsA, { today: '2026-10-20', decisions: decide('keep', '2026-09-30T12:00:00Z', '2026-10-10') }), 'Streamora Plus');
check('decisão de uma renovação que já passou venceu: pergunta de novo, mesmo sem aviso', expired?.needsAnswer === true && expired.alert === null && expired.decision?.forRenewal === '2026-10-10');
check('decisão sem forRenewal vale até a próxima cobrança', find(run('sem forRenewal', dsA, { today: '2026-10-20', decisions: decide('keep', '2026-09-15T12:00:00Z') }), 'Streamora Plus')?.needsAnswer === true);
const repNot = run('não é assinatura', dsA, { today: AT_D7, decisions: decide('not_subscription', '2026-10-30T12:00:00Z') });
const not = find(repNot, 'Streamora Plus');
check('"não é assinatura": status próprio, sem aviso nem pergunta, fora dos totais e do calendário', not?.status === 'not_subscription' && not.alert === null && !not.needsAnswer
  && !repNot.alerts.length && repNot.monthlyTotalUsd === 0 && !buildIcs(repNot.records).includes('BEGIN:VEVENT'));
const cancelAgain = find(run('cancelar e cobrou', dsA, { decisions: decide('cancel', '2026-10-01T12:00:00Z', '2026-10-10') }), 'Streamora Plus');
check('"cancelar" e cobrou de novo: mantém a decisão, explica e pergunta de novo', cancelAgain?.decision?.choice === 'cancel' && cancelAgain.needsAnswer
  && Boolean(cancelAgain.signals.some((s) => s.detail === `cobrou de novo em ${D('2026-10-10')} depois que você marcou para cancelar`)), String(cancelAgain?.signals.map((s) => s.detail).join(' | ')));
const cancelOk = find(run('cancelar sem cobrança', dsA, { today: AT_D7, decisions: decide('cancel', '2026-10-11T12:00:00Z', '2026-11-10') }), 'Streamora Plus');
check('"cancelar" sem cobrança nova: sem esse sinal, não pergunta, aviso continua', cancelOk?.needsAnswer === false && cancelOk.alert === 'd7' && !cancelOk.signals.some((s) => s.detail.includes('cobrou de novo')));
// dados reais: date é a hora local escrita com Z e dateUtc o instante; a resposta guarda o instante real. A cobrança
// 1 h depois da resposta aparece 2 h antes dela na hora local (São Paulo, UTC−3)
const localTx = [...dsA.transactions.slice(0, -1), buy('2026-10-10', 'Streamora Plus', 39.9, { date: '2026-10-10T14:00:00Z', dateUtc: '2026-10-10T17:00:00Z' })];
const localDs = dataset(localTx, TODAY);
const localCancel = find(run('hora local: cancelar', localDs, { decisions: decide('cancel', '2026-10-10T16:00:00Z', '2026-10-10') }), 'Streamora Plus');
check('hora local: cobrança 1 h depois da resposta "cancelar" conta como nova, mesmo com a hora local antes', localCancel?.signals.some((s) => s.detail.startsWith('cobrou de novo em')) === true);
check('hora local: decisão sem forRenewal vence com a cobrança que veio depois do instante da resposta',
  find(run('hora local: sem forRenewal', localDs, { today: '2026-10-20', decisions: decide('keep', '2026-10-10T16:00:00Z') }), 'Streamora Plus')?.needsAnswer === true);
const repOrder = run('ordem', dataset([...dsA.transactions, ...dsB.transactions, ...dDays.map((d) => buy(d, 'Musica Livre', 21.9))], TODAY), { knowledge: [kB], today: AT_D7, decisions: decide('keep', '2026-10-30T12:00:00Z', '2026-11-10') });
check('quem precisa de resposta vem antes', repOrder.records[0]?.name === 'Musica Livre' && repOrder.records[0].needsAnswer, repOrder.records.map((r) => `${r.name}${r.needsAnswer ? '?' : ''}`).join(', '));

console.log('\n== fim de mês ==');
const monthEnd = (dates: string[], today: string) => find(run(`fim de mês ${today}`, dataset(dates.map((d) => buy(d, 'Plano Virada', 25)), today)), 'Plano Virada');
const MONTH_END: [string[], string, string][] = [
  [['2026-12-31', '2027-01-31'], '2027-02-01', '2027-02-28'],
  [['2026-12-31', '2027-01-31', '2027-02-28'], '2027-03-01', '2027-03-31'],
  [['2027-12-31', '2028-01-31'], '2028-02-01', '2028-02-29'],
  [['2027-12-31', '2028-01-31', '2028-02-29'], '2028-03-01', '2028-03-31'],
  [['2026-12-30', '2027-01-30', '2027-02-28'], '2027-03-01', '2027-03-30'],
];
for (const [dates, today, next] of MONTH_END) {
  const r = monthEnd(dates, today);
  check(`${dates.map((d) => d.slice(5).split('-').reverse().join('/')).join(' → ')} → ${next.slice(5).split('-').reverse().join('/')}`, r?.nextRenewal === next, String(r?.nextRenewal));
}
const endIcs = unfold(buildIcs([monthEnd(['2026-12-31', '2027-01-31'], '2027-02-01')!]));
check('RRULE do dia 31: último dia de cada mês', endIcs.includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1'), String(endIcs.find((l) => l.startsWith('RRULE'))));
check('RRULE do anual em 29/02: 28/02 nos anos sem 29', unfold(buildIcs([leap!])).includes('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1'));

console.log('\n== custos ==');
const weeklyDays = ['2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15'];
const weekly = find(run('semanal', dataset(weeklyDays.map((d) => buy(d, 'Jornal da Semana', 10, { currency: 'USD', subscriptionHint: true })), TODAY)), 'Jornal da Semana');
check('semanal: 10 × 52 / 12 = 43.33 por mês, 520 por ano; renova em 22/10', weekly?.cycle === 'weekly' && weekly.monthlyCostUsd === 43.33 && weekly.annualCostUsd === 520 && weekly.nextRenewal === '2026-10-22', `${weekly?.monthlyCostUsd} ${weekly?.annualCostUsd}`);
check('semanal com só 2 cobranças não conta como semanal', find(run('semanal curto', dataset(weeklyDays.slice(2).map((d) => buy(d, 'Jornal da Semana', 10, { currency: 'USD', subscriptionHint: true })), TODAY)), 'Jornal da Semana')?.cycleSource !== 'recurrence');
check('semanal só pela recorrência (sem outro sinal) não entra: é rotina', !find(run('semanal sem sinal', dataset(weeklyDays.map((d) => buy(d, 'Jornal da Semana', 10, { currency: 'USD' })), TODAY)), 'Jornal da Semana'));
const quarterly = find(run('trimestral', dataset(['2026-01-10', '2026-04-10', '2026-07-10', '2026-10-10'].map((d) => buy(d, 'Caixa do Trimestre', 150)), TODAY)), 'Caixa do Trimestre');
check('trimestral: 30 / 3 = 10 por mês, 120 por ano; renova em 10/01', quarterly?.cycle === 'quarterly' && quarterly.monthlyCostUsd === 10 && quarterly.annualCostUsd === 120 && quarterly.nextRenewal === '2027-01-10');
const semiannual = find(run('semestral', dataset(['2025-10-05', '2026-04-05'].map((d) => buy(d, 'Clube Semestral', 600)), '2026-10-01')), 'Clube Semestral');
check('semestral: 120 / 6 = 20 por mês, 240 por ano; renova em 05/10, aviso d7', semiannual?.cycle === 'semiannual' && semiannual.monthlyCostUsd === 20 && semiannual.annualCostUsd === 240 && semiannual.alert === 'd7');
const lostTx = ['2026-06-20', '2026-07-20', '2026-08-20'].map((d) => buy(d, 'Curso Online Atlas', 89));
const repTotals = run('totais', dataset([...dsA.transactions, ...dsB.transactions, ...dDays.map((d) => buy(d, 'Musica Livre', 21.9)), ...lostTx], TODAY,
  [email('Musica Livre', 'cancellation', '2026-10-08', { cycle: 'monthly' })]), { knowledge: [kB] });
check('totais só das ativas: 7.98 + 8.25 = 16.23 por mês, 194.76 por ano', repTotals.monthlyTotalUsd === 16.23 && repTotals.annualTotalUsd === 194.76 && repTotals.records.length === 4, `${repTotals.monthlyTotalUsd} ${repTotals.annualTotalUsd}`);

console.log('\n== calendário (.ics) ==');
const LONG_URL = 'https://exemplo.invalid/conta/assinaturas/gerenciar?plano=leitura-digital&origem=painel-de-assinaturas&idioma=pt-BR';
const ODD = 'Clube, Leitura; Digital \\ Edição Coração 📚📚';
const repIcs = run('calendário', dataset([
  ...aDays.map((d) => buy(d, ODD, 19.9)),
  ...['2026-01-10', '2026-04-10', '2026-07-10', '2026-10-10'].map((d) => buy(d, 'Caixa do Trimestre', 150)),
  ...weeklyDays.map((d) => buy(d, 'Jornal da Semana', 10, { currency: 'USD', subscriptionHint: true })),
  ...dsB.transactions,
  ...lostTx,
  buy('2026-10-07', 'Estudio Pixel', 40, { currency: 'USD' }),
], TODAY, [email(ODD, 'receipt', '2026-10-10', { cycle: 'monthly', manageUrl: LONG_URL })]), {
  knowledge: [kB, kE],
  decisions: { [subscriptionKey('Jornal da Semana')]: { choice: 'not_subscription', at: '2026-10-16T10:00:00Z' } },
});
const NOW = '2026-10-17T12:00:00Z';
const ics = buildIcs(repIcs.records, { now: NOW, calendarName: 'Assinaturas, teste', locale: 'pt' });
const lines = unfold(ics);
// o .ics escapa vírgula e troca NBSP do Intl por espaço: a data por extenso entra assim
const NBSP = String.fromCharCode(160);
const icsD = (day: string) => D(day).split(NBSP).join(' ').replace(/,/g, '\\,');
for (const [name, ok] of icsChecks(ics, repIcs.records, 'pt')) check(name, ok);
check('3 eventos: mensal, trimestral e anual (talvez cancelada, ciclo desconhecido e "não é assinatura" ficam fora)', (ics.match(/BEGIN:VEVENT/g) ?? []).length === 3);
check('mesmo relatório e mesmo now → mesmo arquivo (UID estável)', ics === buildIcs(repIcs.records, { now: NOW, calendarName: 'Assinaturas, teste', locale: 'pt' }));
check('DTSTAMP vem do now; nome do calendário escapado', lines.includes('DTSTAMP:20261017T120000Z') && lines.includes('X-WR-CALNAME:Assinaturas\\, teste'));
check('SUMMARY escapado: vírgula, ponto e vírgula e barra', lines.includes('SUMMARY:Renova: Clube\\, Leitura\\; Digital \\\\ Edição Coração 📚📚 · R$ 19\\,90'), String(lines.find((l) => l.startsWith('SUMMARY:Renova: Clube'))));
check('DESCRIPTION com quebras escapadas e sem o link não verificado', lines.some((l) =>
  l.startsWith(`DESCRIPTION:Ciclo: mensal\\nÚltimo valor: R$ 19\\,90 em ${icsD('2026-10-10')}\\nGerenciar ou cancelar: abra o site do próprio serviço`) && !l.includes(LONG_URL)), String(lines.find((l) => l.startsWith('DESCRIPTION:Ciclo'))));
check('linha longa foi dobrada (continuação começa com espaço)', ics.split('\r\n').some((l) => l.startsWith(' ')));
check('UID = só a chave da assinatura (reimportar atualiza a série)', lines.includes(`UID:${subscriptionKey(ODD)}@etherfi-dash`) && lines.includes('UID:caixa-do-trimestre@etherfi-dash'));
const afterRenewal = run('depois da renovação', dataset([...dsA.transactions, buy('2026-11-10', 'Streamora Plus', 39.9)], '2026-11-12'));
const uidOf = (rep: SubscriptionReport) => unfold(buildIcs(rep.records, { now: NOW })).find((l) => l.startsWith('UID:'));
check('depois da renovação o UID é o mesmo (o evento é atualizado, a série não duplica)', uidOf(afterRenewal) === 'UID:streamora-plus@etherfi-dash'
  && uidOf(afterRenewal) === uidOf(run('antes da renovação', dsA)) && find(afterRenewal, 'Streamora Plus')?.nextRenewal === '2026-12-10', String(uidOf(afterRenewal)));
const canalUids = unfold(buildIcs(repCanal.records, { now: NOW })).filter((l) => l.startsWith('UID:'));
check('duas assinaturas no mesmo estabelecimento: dois UIDs diferentes', canalUids.length === 2 && new Set(canalUids).size === 2, canalUids.join(' '));
check('RRULE mensal, trimestral e anual', lines.includes('RRULE:FREQ=MONTHLY') && lines.includes('RRULE:FREQ=MONTHLY;INTERVAL=3') && lines.includes('RRULE:FREQ=YEARLY'));
check('RRULE semanal e semestral', unfold(buildIcs([weekly!])).includes('RRULE:FREQ=WEEKLY') && unfold(buildIcs([semiannual!])).includes('RRULE:FREQ=MONTHLY;INTERVAL=6'));
check('alarmes às 9h do dia do aviso, nunca à meia-noite (14 dias antes = -P13DT15H)', lines.includes('TRIGGER:-P13DT15H') && lines.includes('TRIGGER:-P6DT15H')
  && lines.includes('TRIGGER:-P1DT15H') && !lines.some((l) => /^TRIGGER:-P\d+D$/.test(l)));
check('PRODID com o nome do produto', lines.includes('PRODID:-//Lighthouse for ether.fi Cash//Subscriptions//PT-BR'));
check('calendário vazio em português continua válido', buildIcs([], { locale: 'pt' })
  === 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lighthouse for ether.fi Cash//Subscriptions//PT-BR\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Renovações de assinaturas\r\nEND:VCALENDAR\r\n');
const noteKb = { ...kB, note: { en: 'Renews every year on the same day.', pt: 'Renova todo ano no mesmo dia.' } };
check('nota da base em português (LocalizedText), nunca o objeto', find(run('nota em português', dsB, { knowledge: [noteKb] }), 'Nuvem Arquivo')?.signals
  .some((s) => s.kind === 'knowledge' && s.detail === 'conhecido por cobrar assinatura (anual) — Renova todo ano no mesmo dia.') === true);

console.log('\n== auditoria de renovação ==');
const REF = '2026-10-18';
const auditOf = (name: string, extra: Partial<RenewalAuditItem> = {}): RenewalAuditItem => ({
  name,
  matchers: [name.toUpperCase()],
  autoRenew: 'yes',
  noticeBeforeRenewal: 'no',
  cancelDeadline: { en: 'before the billing date, in settings', pt: 'antes da data de cobrança, nas configurações' },
  refundWindowDays: 0,
  refundNote: { en: 'Refunds only case by case.', pt: 'Reembolso só caso a caso.' },
  priceChangeAtRenewal: { en: 'the first-year discount ends', pt: 'o desconto do 1º ano acaba' },
  sources: ['https://exemplo.invalid/termos'],
  checked: ['website', 'email'],
  checkedAt: REF,
  risk: 'high',
  riskReasons: [{ en: 'Annual plan that renews on its own.', pt: 'Plano anual que renova sozinho.' }, { en: 'No reminder by email.', pt: 'Sem aviso por email.' }],
  ...extra,
});
const withAudit = (ds: Dataset, items: RenewalAuditItem[]): Dataset => ({ ...ds, subscriptionSources: { ...ds.subscriptionSources, audit: { generatedAt: REF, items } } });
// o caso que motivou a auditoria: anual que renovou sozinho, mais caro, sem aviso e sem reembolso nos termos
const painelTx = [
  buy('2025-10-17', 'Painel Cripto', 499.8, { currency: 'USD', merchantRaw: 'PAINELCRIPTO.IO' }),
  buy('2026-10-17', 'Painel Cripto', 588, { currency: 'USD', merchantRaw: 'PAINELCRIPTO.IO', status: 'pending' }),
];
const painelAudit = auditOf('Painel Cripto', { matchers: ['painelcripto'] });
const painelDs = withAudit(dataset(painelTx, REF), [painelAudit]);
const repPainel = run('renovação anual nas letras miúdas', painelDs);
const painel = find(repPainel, 'Painel Cripto');
check('auditoria casa por trecho do texto da fatura (sem diferenciar maiúsculas) e dá o risco', painel?.audit === painelAudit && painel.risk === 'high' && painel.riskSource === 'audit', `${painel?.risk} ${painel?.riskSource}`);
check('renovação pendente: acabou de renovar, preço subiu, termos sem reembolso (null)', painel?.justRenewed?.pending === true && painel.justRenewed.daysAgo === 1
  && painel.justRenewed.previousAmount === 499.8 && painel.justRenewed.previousCurrency === 'USD' && painel.justRenewed.priceChanged === true
  && painel.justRenewed.refundWindowDays === 0 && painel.justRenewed.refundDaysLeft === null, JSON.stringify(painel?.justRenewed));
check('entra na lista de renovações recentes e na de risco', repPainel.justRenewed?.[0] === painel && repPainel.atRisk?.[0] === painel);
check('próxima renovação um ano depois, ciclo anual', painel?.nextRenewal === '2027-10-17' && painel.cycle === 'annual');
check('sinais da renovação e do reembolso de cortesia', painel?.signals.some((s) => s.detail === `renovação ainda pendente: ${money(588, 'USD')}, antes ${money(499.8, 'USD')}`) === true
  && painel.signals.some((s) => s.detail === 'os termos não preveem reembolso; dá para pedir um reembolso de cortesia'), String(painel?.signals.map((s) => s.detail).join(' | ')));
const PT_AUDIT = ['renova sozinho se você não cancelar', 'não avisa por email antes de renovar', 'prazo para cancelar: antes da data de cobrança, nas configurações',
  'os termos dizem que não há reembolso — Reembolso só caso a caso.', 'preço na renovação: o desconto do 1º ano acaba'];
check('sinais da auditoria com tipo próprio e a fonte: renova sozinho, aviso, prazo, reembolso, preço e risco', PT_AUDIT.every((d) => painel?.signals.some((s) => s.detail === d && s.kind === 'audit' && s.source === 'https://exemplo.invalid/termos'))
  && painel?.signals.some((s) => s.kind === 'audit' && s.source === 'https://exemplo.invalid/termos' && s.detail.startsWith('os termos não preveem reembolso')) === true
  && painel?.signals.some((s) => s.detail === `risco de cobrança sem perceber: alto — Plano anual que renova sozinho; Sem aviso por email (conferido em site e email em ${D(REF)})`) === true);
const D30: [string, number, string | null][] = [['2027-09-16', 31, null], ['2027-09-17', 30, 'd30'], ['2027-09-27', 20, 'd30'], ['2027-10-02', 15, 'd30'], ['2027-10-03', 14, 'd14']];
for (const [today, d, alert] of D30) {
  const rep = run(`risco alto ${d}`, painelDs, { today });
  const x = find(rep, 'Painel Cripto');
  check(`risco alto, ${d} dias → ${alert ?? 'sem aviso'}`, x?.daysUntil === d && x.alert === alert && x.needsAnswer === (alert !== null) && rep.alerts.includes(x) === (alert !== null), `${x?.daysUntil} ${x?.alert}`);
}
const lowDs = withAudit(dataset(painelTx, REF), [auditOf('Painel Cripto', { matchers: ['painelcripto'], risk: 'low' })]);
check('risco baixo, 20 dias → sem aviso (o d30 é só do risco alto)', find(run('risco baixo 20', lowDs, { today: '2027-09-27' }), 'Painel Cripto')?.alert === null);
const painelIcs = unfold(buildIcs(repPainel.records, { now: NOW, locale: 'pt' }));
check('.ics do risco alto: 4 alarmes, com o de 30 dias', painelIcs.filter((l) => l === 'BEGIN:VALARM').length === 4 && painelIcs.includes(at9(30)));
check('.ics do risco alto explica o risco e o prazo para cancelar', painelIcs.some((l) =>
  l.includes('\\nRisco alto de cobrança sem perceber: Plano anual que renova sozinho\\; Sem aviso por email\\nPrazo para cancelar: antes da data de cobrança\\, nas configurações')));
check('.ics do risco baixo: 3 alarmes', unfold(buildIcs(run('risco baixo', lowDs).records, { now: NOW })).filter((l) => l === 'BEGIN:VALARM').length === 3);
const genericAudit = auditOf('Painel', { matchers: ['PAINEL'], risk: 'low' });
const specificAudit = auditOf('Painel Cripto Pro', { matchers: ['PAINELCRIPTO.IO'] });
check('o primeiro item da auditoria que casa vence', find(run('auditoria em ordem', withAudit(dataset(painelTx, REF), [specificAudit, genericAudit])), 'Painel Cripto')?.audit === specificAudit
  && find(run('auditoria fora de ordem', withAudit(dataset(painelTx, REF), [genericAudit, specificAudit])), 'Painel Cripto')?.audit === genericAudit);
check('sem trecho que case, a auditoria casa pelo nome', find(run('auditoria pelo nome', withAudit(dataset(painelTx, REF), [auditOf('Painel Cripto', { matchers: ['NADA A VER'] })])), 'Painel Cripto')?.audit?.name === 'Painel Cripto');
const editorTx = ['2026-07-08', '2026-08-08', '2026-09-08', '2026-10-08'].map((d) => buy(d, 'Editor Online', 99, { merchantRaw: 'EDITORONLINE' }));
const editorDs = withAudit(dataset(editorTx, REF), [auditOf('Editor Online', { matchers: ['EDITORONLINE'], refundWindowDays: 14, risk: 'medium', refundNote: undefined, priceChangeAtRenewal: undefined })]);
const repEditor = run('reembolso aberto', editorDs);
const editor = find(repEditor, 'Editor Online');
check('janela de reembolso aberta: 14 − 10 dias = faltam 4', editor?.justRenewed?.refundWindowDays === 14 && editor.justRenewed.refundDaysLeft === 4 && editor.justRenewed.pending === false
  && editor.justRenewed.priceChanged === false && editor.signals.some((s) => s.detail === 'faltam 4 dias para pedir reembolso' && s.kind === 'audit'), JSON.stringify(editor?.justRenewed));
check('sem auditoria, nenhum sinal do tipo auditoria', !find(run('sem auditoria, sem sinal', dataset(editorTx, REF)), 'Editor Online')?.signals.some((s) => s.kind === 'audit'));
check('reembolso ainda possível põe a mensal na lista de renovações recentes', repEditor.justRenewed?.includes(editor!) === true);
const repEditorLate = run('reembolso fechado', editorDs, { today: '2026-10-28' });
const editorLate = find(repEditorLate, 'Editor Online');
check('20 dias depois: o prazo acabou há 6 dias, e a mensal sai da lista (o registro mantém o campo)', editorLate?.justRenewed?.refundDaysLeft === -6
  && editorLate.signals.some((s) => s.detail === 'o prazo de reembolso acabou há 6 dias') && !repEditorLate.justRenewed?.length);
const noAudit = find(run('renovou sem auditoria', dataset(editorTx, REF)), 'Editor Online');
check('sem auditoria: acabou de renovar, sem números de reembolso, risco desconhecido', noAudit?.justRenewed?.daysAgo === 10 && noAudit.justRenewed.refundWindowDays === undefined
  && noAudit.justRenewed.refundDaysLeft === undefined && noAudit.risk === 'unknown' && noAudit.riskSource === undefined);
const firstOnly = find(run('primeira cobrança', withAudit(dataset([painelTx[1]], REF), [painelAudit])), 'Painel Cripto');
check('auditoria "renova sozinho" confirma: uma cobrança só entra, e a primeira não é renovação', firstOnly !== undefined && !firstOnly.justRenewed && firstOnly.risk === 'high');
const settledTx = [painelTx[0], buy('2026-10-17', 'Painel Cripto', 588, { currency: 'USD', merchantRaw: 'PAINELCRIPTO.IO' })];
const old = find(run('renovou há 60 dias', withAudit(dataset(settledTx, '2026-12-16'), [painelAudit])), 'Painel Cripto');
check('renovação de 60 dias atrás já não é "acabou de renovar"; pendente continua sendo', old !== undefined && !old.justRenewed
  && find(run('pendente há 60 dias', withAudit(dataset(painelTx, '2026-12-16'), [painelAudit])), 'Painel Cripto')?.justRenewed?.daysAgo === 60);
check('auditoria confirma em categoria que pede confirmação (restaurante)', Boolean(find(run('auditoria em restaurante',
  withAudit(dataset([buy('2026-03-01', 'Clube Bistro', 300, { category: CATEGORY.dining, merchantRaw: 'CLUBEBISTRO' })], REF), [auditOf('Clube Bistro', { matchers: ['CLUBEBISTRO'] })])), 'Clube Bistro')));
const annualTx = (merchant: string, first: number, second: number) => [buy('2025-10-17', merchant, first, { currency: 'USD' }), buy('2026-10-17', merchant, second, { currency: 'USD' })];
const heuristicDs = dataset(annualTx('Painel Grafico', 480, 520), REF);
const heur = find(run('heurística', heuristicDs), 'Painel Grafico');
check('sem auditoria: anual ≥ US$ 100 sem aviso no email → risco alto pela heurística, explicado', heur?.risk === 'high' && heur.riskSource === 'heuristic'
  && heur.signals.some((s) => s.detail === `plano anual de ${money(520, 'USD')} e nenhum aviso de renovação no email: tratado como risco alto`) && run('heurística (lista)', heuristicDs).atRisk?.[0]?.name === 'Painel Grafico');
check('a heurística também ganha o d30 e o alarme de 30 dias', find(run('heurística 20', heuristicDs, { today: '2027-09-27' }), 'Painel Grafico')?.alert === 'd30'
  && unfold(buildIcs([heur!])).includes(at9(30)));
check('com aviso de renovação no email, a heurística não dispara', find(run('heurística com aviso', dataset(annualTx('Painel Grafico', 480, 520), REF,
  [email('Painel Grafico', 'renewal_notice', '2026-10-01', { cycle: 'annual' })])), 'Painel Grafico')?.risk === 'unknown');
check('anual abaixo de US$ 100 e mensal caro: risco desconhecido', find(run('anual barato', dataset(annualTx('Painel Mini', 49, 49), REF)), 'Painel Mini')?.risk === 'unknown'
  && find(run('mensal caro', dataset(['2026-08-17', '2026-09-17', '2026-10-17'].map((d) => buy(d, 'Painel Max', 150, { currency: 'USD' })), REF)), 'Painel Max')?.risk === 'unknown');

console.log('\n== só a recorrência: contas, recargas e rotina (D6, D15) ==');
const plusDays = (day: string, n: number) => new Date(tsOf(day) + n * 86400000).toISOString().slice(0, 10);
// mesmo valor todo mês, mas não é assinatura (o cenário da avaliação, com nomes inventados)
const NS_FROM = '2026-03-27';
const NS_TODAY = '2026-10-15';
const monthly = (offset: number) => Array.from({ length: 7 }, (_, m) => plusDays(NS_FROM, Math.round(m * 30.4) + offset));
const nsTx = [
  ...monthly(0).map((d) => buy(d, 'Imobiliária Lar Feliz', 2500, { merchantRaw: 'IMOBILIARIA LAR FELIZ', category: CATEGORY.home })),
  ...monthly(2).map((d) => buy(d, 'Claro', 30, { merchantRaw: 'CLARO RECARGA', category: CATEGORY.phone })),
  ...monthly(3).map((d) => buy(d, 'Bilhete Único', 100, { merchantRaw: 'BILHETE UNICO RECARGA', category: CATEGORY.other })),
  ...monthly(4).map((d) => buy(d, 'Condomínio Ed. Solar', 800, { merchantRaw: 'CONDOMINIO ED SOLAR', category: CATEGORY.home })),
  ...monthly(6).map((d) => buy(d, 'Porto Seguro Auto', 350, { merchantRaw: 'PORTO SEGURO AUTO', category: CATEGORY.other })),
  ...monthly(8).map((d) => buy(d, 'Escola ABC', 1500, { merchantRaw: 'ESCOLA ABC MENSALIDADE', category: CATEGORY.education })),
  ...monthly(9).map((d) => buy(d, 'Clube de Tiro Alvo', 1500, { merchantRaw: 'CLUBE DE TIRO ALVO', category: CATEGORY.other })),
  ...monthly(10).map((d) => buy(d, 'Clube do Livro Online', 29.9, { merchantRaw: 'CLUBE LIVRO ONLINE', category: CATEGORY.other })),
  ...Array.from({ length: 29 }, (_, w) => buy(plusDays(NS_FROM, w * 7), 'Lavanderia Bolha', 40, { merchantRaw: 'LAVANDERIA BOLHA', category: CATEGORY.other })),
];
const repNs = run('não é assinatura', dataset(nsTx, NS_TODAY));
const nsBills = ['Imobiliária Lar Feliz', 'Condomínio Ed. Solar', 'Porto Seguro Auto', 'Escola ABC'].map((n) => find(repNs, n));
check('aluguel, condomínio, seguro e escola viram conta recorrente', nsBills.every((r) => r?.kind === 'bill' && r.cycle === 'monthly'), nsBills.map((r) => `${r?.name}:${r?.kind}`).join(', '));
check('conta recorrente: sem "manter ou cancelar?", sem aviso (nem vermelho), fora dos totais, das listas e do .ics', nsBills.every((r) => r && r.alert === null && !r.needsAnswer && r.risk === 'unknown')
  && !repNs.alerts.some((r) => r.kind === 'bill') && !repNs.upcoming.some((r) => r.kind === 'bill') && !(repNs.justRenewed ?? []).some((r) => r.kind === 'bill')
  && !unfold(buildIcs(repNs.records, { now: NOW })).some((l) => /Imobili|Condom|Porto Seguro|Escola/.test(l)));
check('conta recorrente explica o porquê', nsBills.every((r) => r?.signals.some((s) => s.detail.includes('conta recorrente'))));
check('recarga de celular e de bilhete não vira assinatura', !find(repNs, 'Claro') && !find(repNs, 'Bilhete Único'));
check('lavanderia semanal não vira assinatura (semanal só pela recorrência é rotina)', !find(repNs, 'Lavanderia Bolha'));
check('mensalidade alta fora das categorias de assinatura não entra só pela recorrência', !find(repNs, 'Clube de Tiro Alvo'));
check('mensalidade escolar (mesmo em Educação) vira conta recorrente', find(repNs, 'Escola ABC')?.kind === 'bill');
const livro = find(repNs, 'Clube do Livro Online');
check('valor baixo todo mês entra, com confiança no máximo média', livro?.kind === 'subscription' && livro.confidence === 'medium' && livro.cycle === 'monthly', `${livro?.kind} ${livro?.confidence}`);
check('o total por mês é só da assinatura', repNs.monthlyTotalUsd === livro?.monthlyCostUsd, `${repNs.monthlyTotalUsd}`);
const nsView = recurringView(repNs);
check('recurringView: conta recorrente fora do balde de assinaturas, dentro do "recorrente" (fora do valor incomum)', nsBills.every((r) => r!.charges.every((t) => !nsView.subscriptionChargeIds.has(t.id) && nsView.recurringChargeIds.has(t.id)))
  && livro!.charges.every((t) => nsView.subscriptionChargeIds.has(t.id)) && nsView.items.filter((i) => i.kind === 'bill').length === 4);
check('com base "sim", o mesmo descritor de seguro é assinatura', find(run('seguro na base', dataset(nsTx.filter((t) => t.merchantRaw === 'PORTO SEGURO AUTO'), NS_TODAY),
  { knowledge: [know('Porto Seguro Auto', 'yes', ['monthly'])] }), 'Porto Seguro Auto')?.kind === 'subscription');
// EUA: mercado a cada 8 dias e aluguel pelo app de aluguel
const usFrom = '2026-05-01';
const usTx = [
  ...Array.from({ length: 21 }, (_, i) => buy(plusDays(usFrom, 5 + i * 8), 'Instacart*Heb', 60, { currency: 'USD', merchantRaw: 'INSTACART*HEB', category: CATEGORY.other })),
  ...Array.from({ length: 6 }, (_, m) => buy(plusDays(usFrom, Math.round(m * 30.4) + 1), 'Bilt Rent Pmt', 2400, { currency: 'USD', merchantRaw: 'BILT RENT PMT', category: CATEGORY.other })),
  ...Array.from({ length: 6 }, (_, m) => buy(plusDays(usFrom, Math.round(m * 30.4) + 10), 'Netflix.com', 15.49, { currency: 'USD', merchantRaw: 'NETFLIX.COM', category: CATEGORY.other })),
];
const repUs = run('EUA', dataset(usTx, '2026-10-18'), { knowledge: SUBSCRIPTION_KNOWLEDGE });
check('EUA: mercado a cada 8 dias não vira assinatura semanal (nem aviso vermelho)', !find(repUs, 'Instacart*Heb') && !repUs.alerts.some((r) => r.alert === 'd2'));
check('EUA: aluguel vira conta recorrente; streaming segue assinatura', find(repUs, 'Bilt Rent Pmt')?.kind === 'bill' && find(repUs, 'Netflix.com')?.kind === 'subscription');
// D15: ciclo estimado não passa de "média", mesmo com email
const repChat = run('estimativa com email', dataset([buy('2026-10-01', 'Assistente Chat', 20, { currency: 'USD' })], TODAY,
  [email('Assistente Chat', 'signup', '2026-10-01')]), { knowledge: [know('Assistente Chat', 'yes', ['monthly', 'annual'])] });
const chatR = find(repChat, 'Assistente Chat');
check('ciclo estimado (1 cobrança e email de assinatura): confiança média', chatR?.cycleSource === 'estimate' && chatR.cycle === 'monthly' && chatR.confidence === 'medium', `${chatR?.cycleSource} ${chatR?.confidence}`);

// anual com uma cobrança só no histórico: o aviso de renovação no email prova que foi renovação (reembolso ainda aberto)
const annualOnce = find(run('anual renovada, 1 cobrança', withAudit(dataset([buy('2026-09-28', 'Painel Anual', 240, { currency: 'USD', merchantRaw: 'PAINELANUAL' })], '2026-10-14', [
  email('Painel Anual', 'renewal_notice', '2026-09-14', { matchers: ['PAINELANUAL'], cycle: 'annual', periodEnd: '2026-09-28' }),
  email('Painel Anual', 'receipt', '2026-09-28', { matchers: ['PAINELANUAL'], cycle: 'annual', periodEnd: '2027-09-28' }),
]), [auditOf('Painel Anual', { matchers: ['PAINELANUAL'], refundWindowDays: 30, risk: 'medium' })])), 'Painel Anual');
check('anual com 1 cobrança e aviso de renovação no email: acabou de renovar, sem valor anterior, reembolso 30 − 16 = 14 dias', annualOnce?.justRenewed?.daysAgo === 16
  && annualOnce.justRenewed.refundDaysLeft === 14 && annualOnce.justRenewed.previousAmount === undefined && annualOnce.justRenewed.priceChanged === false, JSON.stringify(annualOnce?.justRenewed));
check('anual com 1 cobrança sem aviso de renovação: é a compra, não renovação', !find(run('anual comprada, 1 cobrança', dataset([buy('2026-09-28', 'Painel Anual', 240, { currency: 'USD', merchantRaw: 'PAINELANUAL' })], '2026-10-14', [
  email('Painel Anual', 'signup', '2026-09-28', { matchers: ['PAINELANUAL'], cycle: 'annual', periodEnd: '2027-09-28' }),
])), 'Painel Anual')?.justRenewed);

console.log('\n== domínios: um registro por domínio, cobrança antes do vencimento, vários anos (D7) ==');
const kDom = know('Nuvem Domínios', 'yes', ['annual'], { matchers: ['NUVEM DOMINIOS'], itemized: true, chargeLeadDays: 30, manageUrl: 'https://nuvem.exemplo/dominios' });
const domTx = [
  // domínio A: compra com preço de 1º ano e renovação 335 dias depois (30 antes do vencimento); domínio B: comprado depois
  buy('2025-10-24', 'Nuvem Domínios', 75, { merchantRaw: 'NUVEM DOMINIOS' }),
  buy('2026-02-18', 'Nuvem Domínios', 60, { merchantRaw: 'NUVEM DOMINIOS' }),
  buy('2026-09-24', 'Nuvem Domínios', 100, { merchantRaw: 'NUVEM DOMINIOS' }),
];
const domEv = [
  // o aviso traz o dia da cobrança; o recibo traz o fim do período pago
  email('Nuvem Domínios', 'renewal_notice', '2026-09-19', { matchers: ['NUVEM DOMINIOS'], cycle: 'annual', periodEnd: '2026-09-24', amount: 100, currency: 'BRL' }),
  email('Nuvem Domínios', 'receipt', '2026-09-24', { matchers: ['NUVEM DOMINIOS'], cycle: 'annual', periodEnd: '2027-10-24', amount: 100, currency: 'BRL' }),
];
const domDs = dataset(domTx, REF, domEv);
const repDom = run('domínios', domDs, { knowledge: [kDom] });
const domA = find(repDom, 'Nuvem Domínios');
const domB = find(repDom, `Nuvem Domínios · ${money(60, 'BRL').split(String.fromCharCode(160)).join(' ')}`);
check('um registro por domínio: o renovado (2 cobranças) e o comprado depois (1)', repDom.records.length === 2 && domA?.charges.length === 2 && domB?.charges.length === 1,
  repDom.records.map((r) => `${r.name} (${r.charges.length})`).join(', '));
check('o mais antigo fica com a chave de antes; o novo tem chave própria', domA?.key === 'nuvem-dominios' && domB?.key === 'nuvem-dominios-r-60-00', `${domA?.key} ${domB?.key}`);
check('renovado: próxima cobrança = vencimento do recibo − 30 dias (24/09/2027), ciclo anual pelo email', domA?.nextRenewal === '2027-09-24' && domA.cycle === 'annual' && domA.cycleSource === 'email', String(domA?.nextRenewal));
check('comprado depois: próxima cobrança = compra + 1 ano − 30 dias (19/01/2027)', domB?.nextRenewal === '2027-01-19' && domB.cycle === 'annual', String(domB?.nextRenewal));
check('o sinal explica a cobrança antes do vencimento', domA?.signals.some((s) => s.detail.startsWith('a renovação é cobrada 30 dias antes do fim do período pago')) === true);
check('os avisos contam da cobrança: 14 dias antes de 19/01/2027 é d14', find(run('domínio d14', domDs, { knowledge: [kDom], today: '2027-01-05' }), domB!.name)?.alert === 'd14');
const domIcs = unfold(buildIcs(repDom.records, { now: NOW, locale: 'pt' }));
check('.ics dos domínios: dois eventos, UIDs próprios, RRULE anual a partir da data de cobrança', blocks(domIcs, 'VEVENT').length === 2 && domIcs.includes('UID:nuvem-dominios@etherfi-dash')
  && domIcs.includes('UID:nuvem-dominios-r-60-00@etherfi-dash') && domIcs.includes('DTSTART;VALUE=DATE:20270924') && domIcs.includes('DTSTART;VALUE=DATE:20270119')
  && domIcs.filter((l) => l === 'RRULE:FREQ=YEARLY').length === 2);
const kReg = know('Registro Web', 'maybe', ['monthly', 'annual'], { matchers: ['REGISTRO WEB'], itemized: true });
const repReg = run('vários anos', dataset([
  buy('2025-10-10', 'Registro Web', 300, { currency: 'USD', merchantRaw: 'REGISTRO WEB' }),
  buy('2025-10-11', 'Registro Web', 450, { currency: 'USD', merchantRaw: 'REGISTRO WEB' }),
], REF, [
  email('Registro Web', 'receipt', '2025-10-10', { matchers: ['REGISTRO WEB'], periodEnd: '2027-10-10', amount: 300, currency: 'USD' }),
  email('Registro Web', 'receipt', '2025-10-11', { matchers: ['REGISTRO WEB'], periodEnd: '2030-10-11', amount: 450, currency: 'USD' }),
]), { knowledge: [kReg] });
const reg2 = find(repReg, 'Registro Web');
const reg5 = repReg.records.find((r) => r !== reg2);
check('período pago de 2 e de 5 anos: ciclo sem RRULE anual, prazo em meses e a data do recibo', reg2?.cycle === 'unknown' && reg2.termMonths === 24 && reg2.nextRenewal === '2027-10-10'
  && reg5?.cycle === 'unknown' && reg5.termMonths === 60 && reg5.nextRenewal === '2030-10-11', `${reg2?.termMonths} ${reg5?.termMonths}`);
check('custo por mês correto: cobrança ÷ prazo (300/24 e 450/60), não ÷ 12', reg2?.monthlyCostUsd === 12.5 && reg5?.monthlyCostUsd === 7.5 && repReg.monthlyTotalUsd === 20, `${reg2?.monthlyCostUsd} ${reg5?.monthlyCostUsd}`);
const regIcs = unfold(buildIcs(repReg.records, { now: NOW, locale: 'pt' }));
check('.ics de vários anos: evento na data do fim do prazo, sem RRULE, ciclo "a cada N anos"', blocks(regIcs, 'VEVENT').length === 2 && !regIcs.some((l) => l.startsWith('RRULE:'))
  && regIcs.some((l) => l.startsWith('DESCRIPTION:Ciclo: a cada 2 anos')) && regIcs.some((l) => l.startsWith('DESCRIPTION:Ciclo: a cada 5 anos')));

console.log('\n== cobrança por uso (D14) ==');
const repUsage = run('uso: custo médio', dataset(
  ['2026-04-30', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((d, i) => buy(d, 'Banco Nuvem', [0.7, 7.6, 31.3, 37.6, 39.4, 30.2][i], { currency: 'USD', subscriptionHint: true })),
  TODAY));
const usageR = find(repUsage, 'Banco Nuvem');
check('valor que sobe e desce: custo por mês = média das 3 últimas (37,60, 39,40, 30,20 → 35,73), marcado como aproximado', usageR?.costApprox === true && usageR.monthlyCostUsd === 35.73
  && repUsage.monthlyApprox === true && usageR.signals.some((s) => s.detail.startsWith('cobrança por uso')), `${usageR?.costApprox} ${usageR?.monthlyCostUsd}`);
const raised = find(run('reajuste', dataset([...aDays.slice(0, 4).map((d) => buy(d, 'Streamora Plus', 39.9)), buy('2026-10-10', 'Streamora Plus', 49.9)], TODAY,
  [email('Streamora Plus', 'price_change', '2026-09-20', { cycle: 'monthly' })])), 'Streamora Plus');
check('reajuste (uma mudança só) não é cobrança por uso: o custo é o preço novo', raised?.costApprox === false && raised.monthlyCostUsd === R2(49.9 / 5), `${raised?.costApprox} ${raised?.monthlyCostUsd}`);
check('valor estável: custo exato, sem "≈"', a?.costApprox === false && !run('estável', dsA).monthlyApprox);

console.log('\n== plano de operadora (D16) ==');
const carrierTx = [
  ...['2026-05-12', '2026-06-12', '2026-07-12', '2026-08-12', '2026-09-12', '2026-10-12'].map((d, i) => buy(d, 'Vivo', [30, 30, 32, 30, 34, 30][i], { merchantRaw: 'VIVO EASY', category: CATEGORY.phone })),
  // outras compras da mesma operadora no meio da sequência: recarga avulsa e loja
  ...['2026-06-20', '2026-08-20'].map((d) => buy(d, 'Vivo', 20, { merchantRaw: 'VIVO RECARGA', category: CATEGORY.phone })),
  buy('2026-07-25', 'Vivo', 150, { merchantRaw: 'VIVO LOJA', category: CATEGORY.phone }),
];
check('sem a base, outra compra da operadora no meio desfaz a sequência (o falso negativo)', !run('operadora sem base', dataset(carrierTx, TODAY)).records.length);
const repCarrier = run('operadora com a base', dataset(carrierTx, TODAY), { knowledge: SUBSCRIPTION_KNOWLEDGE });
const plan = find(repCarrier, 'Vivo · Easy');
check('com o item genérico da base ("maybe", mensal): o plano entra mesmo com compras no meio, com o nome da operadora', plan?.cycle === 'monthly' && plan.charges.length === 6
  && plan.charges.every((t) => t.merchantRaw === 'VIVO EASY') && plan.nextRenewal === '2026-11-12' && plan.signals.some((s) => s.kind === 'knowledge'), repCarrier.records.map((r) => `${r.name} (${r.charges.length})`).join(', '));
check('a recarga avulsa e a loja não viram assinatura', repCarrier.records.length === 1);

console.log('\n== textos: valor no nome e contagem do sinal (D18, D22) ==');
const canalIcs = unfold(buildIcs(repCanal.records, { now: NOW, locale: 'pt' }));
check('SUMMARY da sequência extra não repete o valor que o nome já traz', canalIcs.includes('SUMMARY:Renova: Canal Video · R$ 39\\,99')
  && canalIcs.includes('SUMMARY:Renova: Canal Video · R$ 14\\,99'), canalIcs.filter((l) => l.startsWith('SUMMARY:')).join(' | '));
check('o alarme também não repete o valor', canalIcs.includes('DESCRIPTION:Canal Video · R$ 39\\,99 renova em 14 dias: manter ou cancelar?'));
check('UID das duas sequências igual ao de antes (só a chave)', canalIcs.filter((l) => l.startsWith('UID:')).sort().join(' ') === 'UID:canal-video-r-39-99@etherfi-dash UID:canal-video@etherfi-dash');
const shelf = find(run('sinal conta o registro', dataset([
  buy('2026-01-03', 'Livraria Digital', 80), buy('2026-02-20', 'Livraria Digital', 15),
  ...fDays.map((d) => buy(d, 'Livraria Digital', 45)),
], TODAY)), 'Livraria Digital');
check('sem outro sinal, o registro é o estabelecimento inteiro e o sinal conta as cobranças dele', shelf?.charges.length === 6
  && shelf.signals.some((s) => /^6 cobranças, 4 delas a cada ~3\d dias, valor estável$/.test(s.detail)), String(shelf?.signals.map((s) => s.detail).join(' | ')));

console.log('\n== links (S3) ==');
check('safeUrl: só https com host', safeUrl('javascript:alert(1)') === undefined && safeUrl('http://exemplo.invalid/x') === undefined && safeUrl('data:text/html,oi') === undefined
  && safeUrl('  https://exemplo.invalid/a  ') === 'https://exemplo.invalid/a' && safeUrl('https://banco.exemplo@golpe.exemplo/') === undefined
  && safeUrl(`https://exemplo.invalid/a${String.fromCharCode(13)}ATTACH:x`) === undefined && safeUrl('exemplo.invalid/a') === undefined && safeUrl(42) === undefined);
check('urlHost e siteOf', urlHost('https://www.vercel.com/x') === 'vercel.com' && urlHost('nada') === '' && siteOf('ajuda.semparar.com.br') === 'semparar.com.br'
  && siteOf('support.claude.com') === 'claude.com' && serviceSite('https://suporte.zendesk.com/x') === 'suporte.zendesk.com');
// red team 20/10: "verificado" é o host exato da base; subdomínio não vale (script.google.com passava por google.com)
check('isKnownHost: host exato da base (com ou sem www.); subdomínio, parecido, outro site ou outra conta da central de ajuda não',
  isKnownHost('https://servico.exemplo/x', ['https://servico.exemplo/conta']) && isKnownHost('https://www.servico.app/x', ['servico.app'])
  && !isKnownHost('https://conta.servico.exemplo/x', ['https://servico.exemplo/conta']) && !isKnownHost('https://servico-exemplo.golpe.exemplo/x', ['https://servico.exemplo/conta'])
  && isKnownHost('https://servico.app/x', ['servico.app']) && !isKnownHost('https://golpe.zendesk.com/x', ['https://servico.zendesk.com/hc'])
  && isKnownHost('https://servico.zendesk.com/y', ['https://servico.zendesk.com/hc']) && !isKnownHost('https://servico.exemplo/x', []));
const kLink = know('Servico Video', 'yes', ['monthly'], { manageUrl: 'https://servico.exemplo/conta', domains: ['servico.app'] });
const linkOf = (manageUrl: string) => find(run(`link ${manageUrl.slice(0, 20)}`, dataset(aDays.map((d) => buy(d, 'Servico Video', 39.9)), TODAY,
  [email('Servico Video', 'receipt', '2026-10-10', { cycle: 'monthly', manageUrl })]), { knowledge: [kLink] }), 'Servico Video');
const jsLink = linkOf('javascript:alert(1)');
check('link javascript: do email não vira href: fica o da base, verificado', jsLink?.manageUrl === 'https://servico.exemplo/conta' && jsLink.manageUrlVerified === true, `${jsLink?.manageUrl}`);
check('link http: do email também não', linkOf('http://servico.exemplo/cancelar')?.manageUrl === 'https://servico.exemplo/conta');
check('com link na base, o do email não troca o oficial (nem no site do serviço)', ['https://conta.servico.exemplo/cancelar', 'https://servico.app/cancelar']
  .every((u) => { const r = linkOf(u); return r?.manageUrl === 'https://servico.exemplo/conta' && r.manageUrlVerified === true; }));
const phish = linkOf('https://servico-exemplo.golpe.exemplo/cancelar');
check('link de phishing do email não troca o oficial da base', phish?.manageUrl === 'https://servico.exemplo/conta' && phish.manageUrlVerified === true);
const domainLinkOf = (manageUrl: string) => find(run(`link domínio ${manageUrl.slice(8, 28)}`, dataset(aDays.map((d) => buy(d, 'Servico Video', 39.9)), TODAY,
  [email('Servico Video', 'receipt', '2026-10-10', { cycle: 'monthly', manageUrl })]), { knowledge: [know('Servico Video', 'yes', ['monthly'], { domains: ['servico.app'] })] }), 'Servico Video');
check('base sem link, só com domínio: o do email nunca sai verificado (host oficial não basta)',
  domainLinkOf('https://servico.app/cancelar')?.manageUrlVerified === false && domainLinkOf('https://golpe.servico.app/cancelar')?.manageUrlVerified === false);
check('sem base, link do email nunca sai verificado', find(run('link sem base', dataset(aDays.map((d) => buy(d, 'Servico Video', 39.9)), TODAY,
  [email('Servico Video', 'receipt', '2026-10-10', { cycle: 'monthly', manageUrl: 'https://servico.exemplo/conta' })])), 'Servico Video')?.manageUrlVerified === false);
const srcRep = run('fontes', withAudit(dataset(editorTx, REF), [auditOf('Editor Online', { matchers: ['EDITORONLINE'], sources: ['email: aviso de renovação, 2026-10-01'], manageUrl: 'https://outro.exemplo/x' })]),
  { knowledge: [know('Editor Online', 'yes', ['monthly'], { manageUrl: 'https://editor.exemplo/conta' })] });
const srcR = find(srcRep, 'Editor Online');
check('fonte que não é link vira texto; fonte da base sai verificada', srcR?.signals.some((s) => s.kind === 'audit' && !s.source && s.sourceText === 'email: aviso de renovação, 2026-10-01') === true
  && srcR.signals.some((s) => s.kind === 'knowledge' && s.source === 'https://exemplo.invalid/fonte' && s.sourceVerified === true));
check('com link na base, o da auditoria não troca o oficial', srcR?.manageUrl === 'https://editor.exemplo/conta' && srcR.manageUrlVerified === true);
const auditOnly = find(run('auditoria sem link na base', withAudit(dataset(editorTx, REF), [auditOf('Editor Online', { matchers: ['EDITORONLINE'], manageUrl: 'https://outro.exemplo/x' })]),
  { knowledge: [know('Editor Online', 'yes', ['monthly'])] }), 'Editor Online');
check('sem link na base, o da auditoria fora do site da base: "não verificado"', auditOnly?.manageUrl === 'https://outro.exemplo/x' && auditOnly.manageUrlVerified === false);

console.log('\n== .ics: quebra de linha e controles vindos de fora (S4) ==');
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const evil = `Clube${CR}END:VEVENT${CR}BEGIN:VEVENT${CR}SUMMARY:golpe`;
const evilLink = `https://exemplo.invalid/a${CR}ATTACH:https://golpe.exemplo/x`;
const repEvil = run('CR isolado', dataset(aDays.map((d) => buy(d, evil, 19.9, { merchantRaw: 'CLUBE EVIL' })), TODAY,
  [email(evil, 'receipt', '2026-10-10', { matchers: ['CLUBE EVIL'], cycle: 'monthly', manageUrl: evilLink })]));
const evilRec = repEvil.records[0];
const evilIcs = buildIcs(repEvil.records, { now: NOW, locale: 'pt' });
const evilLines = unfold(evilIcs);
check('CR isolado no nome não abre nem fecha evento: um VEVENT só, sem SUMMARY injetado', blocks(evilLines, 'VEVENT').length === 1
  && evilLines.filter((l) => l.startsWith('SUMMARY:')).length === 1 && evilLines.filter((l) => l === 'END:VEVENT').length === 1, String(blocks(evilLines, 'VEVENT').length));
check('o CR do nome vira "\\n" escapado no texto', evilLines.some((l) => l.startsWith('SUMMARY:Renova: Clube\\nEND:VEVENT\\nBEGIN:VEVENT\\nSUMMARY:golpe')));
check('link com CR isolado não entra (safeUrl) e não injeta ATTACH', evilRec?.manageUrl === undefined && !evilLines.some((l) => l.startsWith('ATTACH')));
const forged: SubscriptionRecord = { ...evilRec!, name: `Nome${String.fromCharCode(7)}com\tcontrole${CR}${LF}e quebra`, manageUrl: evilLink, manageUrlVerified: false };
const forgedIcs = buildIcs([forged], { now: NOW, locale: 'pt' });
const forgedLines = unfold(forgedIcs);
check('registro montado à mão com link de CR: o .ics passa o link por safeUrl e não o escreve', !forgedLines.some((l) => l.startsWith('ATTACH')) && !forgedIcs.includes('golpe.exemplo'));
check('controles C0 saem, tab vira espaço, CRLF vira um "\\n"', forgedLines.some((l) => l.startsWith('SUMMARY:Renova: Nomecom controle\\ne quebra')));
for (const [name, ok] of icsChecks(forgedIcs, [forged], 'pt')) check(`registro forjado: ${name}`, ok);

console.log('\n== arquivos da IA: validação (E8) ==');
const goodEvidence = email('Streamora Max', 'receipt', '2026-10-10', { cycle: 'monthly', amount: 55.9, currency: 'BRL', manageUrl: 'javascript:alert(1)' });
const vs = validateSubscriptionSources({
  evidence: { generatedAt: '2026-10-17', source: 'teste', items: [goodEvidence, { name: '' }, { name: 'X', kind: 'boleto', emailDate: '2026-01-01' }, null, 'texto', { name: 'Y', kind: 'receipt', emailDate: 'ontem' }] },
  research: 'não é um arquivo',
  audit: { items: [{ name: 'A', risk: 'extremo', checkedAt: '2026-01-01' }, { name: 'Editor Online', matchers: ['EDITORONLINE'], risk: 'medium', checkedAt: '2026-10-01', manageUrl: 'javascript:x' }] },
});
check('itens inválidos saem e são contados; o arquivo com outra forma é ignorado inteiro', vs.dropped === 6 && vs.invalidFiles.join() === 'research'
  && vs.sources.evidence?.items.length === 1 && vs.sources.audit?.items.length === 1 && !vs.sources.research, `${vs.dropped} ${vs.invalidFiles.join()}`);
const vEv = vs.sources.evidence?.items[0];
const vAu = vs.sources.audit?.items[0];
check('campo opcional malformado some (link javascript:), o resto do item fica', vEv !== undefined && vEv.manageUrl === undefined && vEv.amount === 55.9
  && vAu !== undefined && vAu.manageUrl === undefined && vAu.checked.length === 0 && vAu.autoRenew === 'unknown');
let threw = false;
try {
  for (const raw of [null, 42, 'x', [], { items: 'x' }, { items: [[], 1, { name: 1 }] }]) validateSubscriptionSources({ evidence: raw, research: raw, audit: raw });
} catch {
  threw = true;
}
check('lixo de qualquer forma não derruba o validador', !threw);
// sem validar, um campo faltando (checked) derruba a análise; validado, ela roda
const brokenAudit = { generatedAt: REF, items: [{ name: 'Editor Online', matchers: ['EDITORONLINE'], autoRenew: 'yes', noticeBeforeRenewal: 'no', sources: [], checkedAt: REF, risk: 'high', riskReasons: [] }] };
const rawDs: Dataset = { ...dataset(editorTx, REF), subscriptionSources: { audit: brokenAudit as unknown as NonNullable<Dataset['subscriptionSources']>['audit'] } };
let rawThrew = false;
try {
  analyzeSubscriptions(rawDs, { knowledge: [] });
} catch {
  rawThrew = true;
}
const fixedDs: Dataset = { ...dataset(editorTx, REF), subscriptionSources: validateSubscriptionSources({ audit: brokenAudit }).sources };
check('auditoria sem "checked": crua derruba a análise, validada roda', rawThrew && find(run('auditoria validada', fixedDs), 'Editor Online')?.risk === 'high');

console.log('\n== fonte única de "recorrente" (D12) ==');
const viewTotals = recurringView(repTotals);
check('recurringView: o mesmo total por mês da aba Assinaturas', viewTotals.monthlyTotalUsd === repTotals.monthlyTotalUsd && viewTotals.monthlyApprox === false);
check('recurringView: cada cobrança de assinatura conta pelo id, não pelo nome do estabelecimento', recurringView(repStore).subscriptionChargeIds.size === 4
  && store.transactions.filter((t) => t.merchant === 'Loja Grande').every((t) => !recurringView(repStore).recurringChargeIds.has(t.id)));
const viewNot = recurringView(repNot);
check('"não é assinatura" sai de recurringView', !viewNot.items.length && !viewNot.subscriptionChargeIds.size);
check('recorrência fixa de um mês passado: só o que já tinha começado', recurringMonthlyAt(viewTotals, '2026-02', TODAY).totalUsd === 0
  && recurringMonthlyAt(viewTotals, '2026-07', TODAY).totalUsd === R2(7.98 + 8.25 + 4.38 + 17.8) && recurringMonthlyAt(viewTotals, '2026-10', TODAY).totalUsd === repTotals.monthlyTotalUsd);
check('knowledgeFor: a pesquisa local antes da base pública', knowledgeFor(dataset([], TODAY, undefined, [kRes]))[0] === kRes
  && knowledgeFor(dataset([], TODAY))[0] === SUBSCRIPTION_KNOWLEDGE[0]);
// D11 (attention.ts): a cobrança de uso que dispara numa assinatura não é "valor incomum" quando o motor a conhece
const spikeDs = dataset(['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'].map((d, i) => buy(d, 'Nuvem Banco Dados', [20, 21, 20, 22, 350][i], { currency: 'USD' })), TODAY);
const spikeView = recurringView(run('pico de uso', spikeDs));
const unusualOf = (opts: Parameters<typeof detectAnomalies>[3]) => detectAnomalies(spikeDs, detectSubscriptions(spikeDs), 'pt', opts).filter((x) => x.kind === 'unusually_large').length;
check('valor incomum: o detector antigo não reconhece a assinatura de uso e avisa; com as cobranças do motor, não', unusualOf({}) === 1
  && unusualOf({ subscriptionCharges: spikeView.recurringChargeIds }) === 0 && spikeView.recurringChargeIds.size === 5, `${unusualOf({})} → ${unusualOf({ subscriptionCharges: spikeView.recurringChargeIds })}`);

console.log('\n== "esperando você": cai a cada resposta (tarefas) ==');
// uma assinatura com as duas perguntas: renovou com preço novo há 24 dias e a próxima está no aviso de 7 dias
const twoQ = dataset([...aDays.slice(0, 4).map((d) => buy(d, 'Streamora Plus', 39.9)), buy('2026-10-10', 'Streamora Plus', 44.9)], AT_D7);
type Checks = Record<string, 'expected' | 'unexpected'>;
// o mesmo critério de subscriptionParts (useSubscriptions): pending e toCheck
const tasksOf = (rep: SubscriptionReport, checks: Checks, done: Set<string>) => ({
  pending: rep.alerts.filter((r) => r.status === 'active' && r.alert && (r.needsAnswer || (r.decision?.choice === 'cancel' && !done.has(r.key)))),
  toCheck: (rep.justRenewed ?? []).filter((r) => {
    const c = r.justRenewed && checks[r.justRenewed.chargeId];
    return r.status === 'active' && (!c || (c === 'unexpected' && (!r.decision || r.needsAnswer || (r.decision.choice === 'cancel' && !done.has(r.key)))));
  }),
});
const twoAlerts = [{ kind: 'duplicate', urgent: false, group: 'check_now' }, { kind: 'first_time', urgent: false, group: 'worth_knowing' }] as unknown as Parameters<typeof attentionOf>[0]['alerts'];
const countAt = (decisions: Record<string, UserDecision>, checks: Checks, done = new Set<string>()) => {
  const rep = analyzeSubscriptions(twoQ, { knowledge: [], decisions, today: AT_D7, locale: 'pt' });
  const tasks = tasksOf(rep, checks, done);
  const unexpected = new Set(tasks.toCheck.filter((r) => r.justRenewed && checks[r.justRenewed.chargeId] === 'unexpected').map((r) => r.key));
  const answered = new Set((rep.justRenewed ?? []).filter((r) => r.justRenewed && checks[r.justRenewed.chargeId] !== undefined).map((r) => r.key));
  return attentionOf({ ...tasks, unexpected, answered, alerts: twoAlerts, renewalUrgent: false });
};
const chargeId = twoQ.transactions.at(-1)!.id;
const s0 = countAt({}, {});
check('as duas perguntas da mesma assinatura: um item, 2 no total da assinatura (+2 alertas = 4)', s0.attention.total === 4 && s0.attention.toCheck === 1 && s0.attention.toAnswer === 1
  && s0.attention.renewals === 2 && s0.items.filter((it) => it.kind !== 'alert').length === 1 && s0.items.some((it) => it.kind === 'check' && it.next === 'answer'),
  `${s0.attention.total} ${s0.attention.toCheck} ${s0.attention.toAnswer}`);
const s1 = countAt({}, { [chargeId]: 'expected' });
check('"sim, esperava": o total cai 1 (4 → 3) e a pergunta da próxima renovação continua', s1.attention.total === 3 && s1.attention.toCheck === 0 && s1.attention.toAnswer === 1, String(s1.attention.total));
const keepNow = { [keyA]: { choice: 'keep' as const, at: '2026-11-02T12:00:00Z', forRenewal: '2026-11-10' } };
const s2 = countAt(keepNow, { [chargeId]: 'expected' });
check('"vou manter": cai mais 1 (3 → 2), só os alertas ficam', s2.attention.total === 2 && s2.attention.renewals === 0, String(s2.attention.total));
const s1b = countAt(keepNow, {});
check('na outra ordem também cai 1 por resposta (4 → 3 → 2)', s1b.attention.total === 3 && s1b.attention.toCheck === 1 && s1b.attention.toAnswer === 0);
const cancelNow = { [keyA]: { choice: 'cancel' as const, at: '2026-11-02T12:00:00Z', forRenewal: '2026-11-10' } };
const s3 = countAt(cancelNow, { [chargeId]: 'expected' });
const s4 = countAt(cancelNow, { [chargeId]: 'expected' }, new Set([keyA]));
check('"vou cancelar" vira 1 para cancelar; "já cancelei" zera', s3.attention.toCancel === 1 && s3.attention.total === 3 && s4.attention.total === 2 && s4.attention.renewals === 0
  && plansToCancel(analyzeSubscriptions(twoQ, { knowledge: [], decisions: cancelNow, today: AT_D7 }).records[0]));
const s5 = countAt({}, { [chargeId]: 'unexpected' });
check('"não esperava": a conferência está respondida e sobra decidir; conta 1 (4 → 3), como pergunta da renovação', s5.attention.total === 3 && s5.attention.toCheck === 0
  && s5.attention.toAnswer === 1 && s5.items.some((it) => it.kind === 'answer'), `${s5.attention.total} ${s5.attention.toCheck} ${s5.attention.toAnswer}`);
const s6 = countAt(keepNow, { [chargeId]: 'unexpected' });
check('"não esperava" e depois "vou manter": zera a assinatura (só os alertas)', s6.attention.total === 2);
check('a composição soma o total', [s0, s1, s2, s3, s4, s5, s6].every((s) => s.attention.toAnswer + s.attention.toCancel + s.attention.toCheck + s.attention.alerts === s.attention.total));
// uma divisão só: o resumo do Início e as seções da aba Assinaturas contam as perguntas pelo tipo
const [rX, rY, rZ, rW] = repTotals.records;
const mixed: AttentionItem[] = [{ kind: 'check', r: rX, next: 'answer' }, { kind: 'answer', r: rY }, { kind: 'cancel', r: rZ }, { kind: 'check', r: rW }];
const sections = attentionSections(mixed);
const cRecent = questionCounts(sections.recent);
const cSoon = questionCounts(sections.soon);
const cAll = questionCounts(mixed);
check('seções da aba: renovaram há pouco = os itens "check" (com a pergunta seguinte); renovam em breve = responder e cancelar', sections.recent.length === 2 && sections.soon.length === 2
  && cRecent.toCheck === 2 && cRecent.toAnswer === 1 && cSoon.toAnswer === 1 && cSoon.toCancel === 1);
check('a soma das seções é a divisão do resumo do Início, tipo a tipo', cRecent.toAnswer + cSoon.toAnswer === cAll.toAnswer && cRecent.toCancel + cSoon.toCancel === cAll.toCancel
  && cRecent.toCheck + cSoon.toCheck === cAll.toCheck && cAll.toAnswer === 2 && cAll.toCancel === 1 && cAll.toCheck === 2);
// "não esperava" com a decisão pendente: a pergunta é responder, mas fica na seção da renovação recente (reembolso)
const s5Sections = attentionSections(s5.items);
check('"não esperava" à espera da decisão: fica em "renovaram há pouco", contado como responder', s5Sections.recent.length === 1 && !s5Sections.soon.length
  && questionCounts(s5Sections.recent).toAnswer === 1 && questionCounts(s5Sections.recent).toCheck === 0);
const s1Sections = attentionSections(s1.items);
check('"sim, esperava" com a próxima renovação em aviso: a pergunta que sobra fica no cartão da renovação recente', s1Sections.recent.length === 1 && !s1Sections.soon.length
  && questionCounts(s1Sections.recent).toAnswer === 1);
check('sem renovação recente conferida, a pergunta da renovação fica em "renovam em breve"', attentionSections(s1b.items).recent.every((it) => it.kind === 'check')
  && attentionSections(countAt(keepNow, {}).items).soon.length === 0);
const NBSP_ = String.fromCharCode(160);
check('número e palavra presos por NBSP, e o "·" preso ao item anterior, no resumo, nas seções e no total', questionsSummary(cRecent, 'pt', { short: true }) === `1${NBSP_}para responder${NBSP_}· 2${NBSP_}para conferir`
  && questionsSummary(cAll, 'pt') === `2${NBSP_}renovações para responder${NBSP_}· 1${NBSP_}para cancelar${NBSP_}· 2${NBSP_}renovações para conferir`
  && questionsSummary(cSoon, 'en') === `1${NBSP_}renewal to answer${NBSP_}· 1${NBSP_}to cancel`
  && attentionSummary(s0.attention, 'pt') === `1${NBSP_}renovação para responder${NBSP_}· 1${NBSP_}renovação para conferir${NBSP_}· 2${NBSP_}alertas`
  && waitingLabel(17, 'pt') === `17${NBSP_}esperando você` && waitingLabel(1, 'en') === `1${NBSP_}waiting on you`,
  attentionSummary(s0.attention, 'pt'));

console.log('\n== inglês (padrão) ==');
useLocale('en');
const enPainel = find(run('renovação anual nas letras miúdas', painelDs), 'Painel Cripto');
const EN_AUDIT = ['renews on its own unless you cancel', "doesn't email a reminder before renewing", 'cancel by: before the billing date, in settings',
  'the terms say there is no refund — Refunds only case by case.', 'price at renewal: the first-year discount ends'];
check('auditoria em inglês', EN_AUDIT.every((d) => enPainel?.signals.some((s) => s.detail === d))
  && enPainel?.signals.some((s) => s.detail === `risk of a surprise charge: high — Annual plan that renews on its own; No reminder by email (checked site and email on ${D(REF)})`) === true,
  String(enPainel?.signals.map((s) => s.detail).join(' | ')));
check('acabou de renovar em inglês', enPainel?.signals.some((s) => s.detail === `renewal still pending: ${money(588, 'USD')}, was ${money(499.8, 'USD')}`) === true
  && enPainel.signals.some((s) => s.detail === "the terms don't allow refunds; you can still ask for a courtesy refund"));
check('.ics em inglês explica o risco e o prazo', unfold(buildIcs([enPainel!], { now: NOW })).some((l) =>
  l.includes('\\nHigh risk of a surprise charge: Annual plan that renews on its own\\; No reminder by email\\nCancel by: before the billing date\\, in settings')));
check('janela de reembolso e heurística em inglês', find(run('reembolso aberto', editorDs), 'Editor Online')?.signals.some((s) => s.detail === '4 days left to ask for a refund') === true
  && find(run('heurística', heuristicDs), 'Painel Grafico')?.signals.some((s) => s.detail === `annual plan of ${money(520, 'USD')} and no renewal reminder in email: treated as high risk`) === true);
const enA = find(run('mensal', dsA), 'Streamora Plus');
check('sinal da recorrência em inglês', Boolean(enA?.signals.some((s) => /^5 charges about every 3\d days, steady amount$/.test(s.detail))), String(enA?.signals.map((s) => s.detail).join(' | ')));
check('sem locale, analyzeSubscriptions sai em inglês', analyzeSubscriptions(dsA, { knowledge: [] }).records[0]?.signals.some((s) => s.detail.startsWith('5 charges about every')) === true);
const enLapsed = find(run('renovação vencida', dsA, { today: '2026-11-18' }), 'Streamora Plus');
check('talvez cancelada explica em inglês, com a data por extenso', enLapsed?.signals.some((s) => s.detail === `the renewal expected on ${D('2026-11-10')} didn't show up on the card`) === true,
  String(enLapsed?.signals.map((s) => s.detail).join(' | ')));
const enEmail = find(run('email sobre recorrência', dsC([evC])), 'Streamora Max');
check('email em inglês: tipo, data, plano (dado, não traduz) e ciclo', enEmail?.signals[0]?.detail === `renewal notice in email on ${D('2026-10-12')}: Família (monthly); next renewal ${D('2026-11-15')}`,
  String(enEmail?.signals[0]?.detail));
check('recibo sem plano: "annual plan"', find(run('recibo anual', dataset([buy('2026-10-11', 'Revista Digital', 59, { currency: 'USD' })], TODAY,
  [email('Revista Digital', 'receipt', '2026-10-11', { cycle: 'annual' })])), 'Revista Digital')?.signals[0]?.detail === `receipt in email on ${D('2026-10-11')}: annual plan`);
const enEstimate = find(run('estimativa', dataset([buy('2026-07-09', 'Estudio Pixel', 9, { currency: 'USD' })], TODAY), { knowledge: [kE] }), 'Estudio Pixel');
check('estimativa em inglês', enEstimate?.signals.some((s) => s.detail === 'no new charge in 100 days, so not monthly; annual cycle estimated') === true, String(enEstimate?.signals.map((s) => s.detail).join(' | ')));
check('nota da base em inglês', find(run('nota em inglês', dsB, { knowledge: [noteKb] }), 'Nuvem Arquivo')?.signals
  .some((s) => s.kind === 'knowledge' && s.detail === 'known to bill a subscription (annual) — Renews every year on the same day.') === true);
const enCanal = run('duas assinaturas no mesmo estabelecimento', canal);
check('sequência extra mostra o valor no formato do idioma, com a mesma chave de antes', find(enCanal, 'Canal Video · R$39.99')?.key === 'canal-video-r-39-99'
  && find(enCanal, 'Canal Video · R$39.99')?.nextRenewal === '2026-11-16', enCanal.records.map((r) => `${r.name} → ${r.key}`).join(', '));
check('sinal das várias sequências em inglês', find(enCanal, 'Canal Video')?.signals.some((s) => s.detail === 'Canal Video has 2 recurring charges with different amounts; each one is listed separately') === true);
const enCancel = find(run('cancelar e cobrou', dsA, { decisions: decide('cancel', '2026-10-01T12:00:00Z', '2026-10-10') }), 'Streamora Plus');
check('"cancelar" e cobrou de novo, em inglês', enCancel?.signals.some((s) => s.detail === `charged again on ${D('2026-10-10')} after you marked it to cancel`) === true);
const enRefund = find(run('estorno', dataset([...dDays.map((d) => buy(d, 'Musica Livre', 21.9)), buy('2026-10-07', 'Musica Livre', -21.9)], TODAY)), 'Musica Livre');
check('estorno em inglês', enRefund?.signals.some((s) => s.detail === 'the last charge was refunded') === true);
const enRepIcs = run('calendário', dataset(repIcs.records.flatMap((r) => r.charges), TODAY, [email(ODD, 'receipt', '2026-10-10', { cycle: 'monthly', manageUrl: LONG_URL })]), {
  knowledge: [kB, kE],
  decisions: { [subscriptionKey('Jornal da Semana')]: { choice: 'not_subscription', at: '2026-10-16T10:00:00Z' } },
});
const enIcs = buildIcs(enRepIcs.records, { now: NOW });
const enLines = unfold(enIcs);
for (const [name, ok] of icsChecks(enIcs, enRepIcs.records, 'en')) check(`em inglês: ${name}`, ok);
check('SUMMARY em inglês, com o dinheiro do idioma', enLines.includes('SUMMARY:Renews: Clube\\, Leitura\\; Digital \\\\ Edição Coração 📚📚 · R$19.90'), String(enLines.find((l) => l.startsWith('SUMMARY:Renews: Clube'))));
check('DESCRIPTION em inglês', enLines.some((l) => l.startsWith(`DESCRIPTION:Cycle: monthly\\nLast charge: R$19.90 on ${icsD('2026-10-10')}\\nManage or cancel: open the service`) && !l.includes(LONG_URL)),
  String(enLines.find((l) => l.startsWith('DESCRIPTION:Cycle'))));
check('lembrete em inglês', enLines.includes('DESCRIPTION:Clube\\, Leitura\\; Digital \\\\ Edição Coração 📚📚 renews in 14 days (R$19.90): keep or cancel?'));
check('em inglês também: alarmes às 9h e PRODID do produto', enLines.includes('TRIGGER:-P13DT15H') && !enLines.some((l) => /^TRIGGER:-P\d+D$/.test(l))
  && enLines.includes('PRODID:-//Lighthouse for ether.fi Cash//Subscriptions//EN'));
check('calendário vazio em inglês (padrão)', buildIcs([])
  === 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lighthouse for ether.fi Cash//Subscriptions//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Subscription renewals\r\nEND:VCALENDAR\r\n');
const kept = run('resposta no calendário', dsA, { today: AT_D7, decisions: decide('keep', '2026-10-30T12:00:00Z', '2026-11-10') });
check('resposta da pessoa no calendário pelo glossário (Keep it / Vou manter)', unfold(buildIcs(kept.records)).some((l) => l.endsWith('\\nYour answer for this renewal: Keep it'))
  && unfold(buildIcs(kept.records, { locale: 'pt' })).some((l) => l.endsWith('\\nSua resposta para esta renovação: Vou manter')));
// nada gerado em português no modo inglês (nomes e planos são dados e ficam como vieram)
const PT_WORDS = /\b(cobranças?|não|assinatura|renovação|renova|mensal|anual|valor|dias|estornada|você|ciclo|último|gerenciar|manter|cancelar|semanal|trimestral|semestral)\b/i;
const enTexts = [enA, enLapsed, enEmail, enEstimate, enCancel, enRefund, enPainel, ...enCanal.records, ...enRepIcs.records]
  .flatMap((r) => r?.signals.map((s) => s.detail) ?? []);
const enIcsText = enLines.filter((l) => /^(SUMMARY|DESCRIPTION|X-WR-CALNAME):/.test(l))
  .map((l) => l.replace(/Clube\\, Leitura\\; Digital \\\\ Edição Coração 📚📚/g, '').replace(/https?:\/\/\S+/g, ''));
const leftovers = [...enTexts, ...enIcsText].filter((s) => PT_WORDS.test(s));
check('nenhum texto gerado em português no modo inglês', !leftovers.length, leftovers.slice(0, 3).join(' | '));

console.log('\n== mesma chave em EN e PT ==');
const both = (label: string, make: (locale: Locale) => Dataset, opts: RunOpts = {}) => {
  const out: Partial<Record<Locale, SubscriptionReport>> = {};
  for (const locale of ['en', 'pt'] as const) {
    useLocale(locale);
    out[locale] = run(label, make(locale), { ...opts, locale });
  }
  useLocale('en');
  return out as Record<Locale, SubscriptionReport>;
};
const signature = (rep: SubscriptionReport) => rep.records
  .map((r) => `${r.key}|${r.nextRenewal}|${r.status}|${r.cycle}|${r.alert}|${r.needsAnswer}|${r.monthlyCostUsd}|${r.risk}|${r.audit?.name ?? ''}`
    + `|${r.justRenewed ? `${r.justRenewed.daysAgo},${r.justRenewed.refundDaysLeft},${r.justRenewed.priceChanged}` : ''}|${r.charges.map((t) => t.id).join(',')}`)
  .sort().join('\n');
const uidList = (rep: SubscriptionReport, locale: Locale) => unfold(buildIcs(rep.records, { now: NOW, locale })).filter((l) => l.startsWith('UID:')).sort().join(' ');
const sameInBoth = (label: string, reps: Record<Locale, SubscriptionReport>) => {
  check(`${label}: mesma chave, renovação, status e cobranças; mesmo UID no .ics`, reps.en.records.length > 0 && signature(reps.en) === signature(reps.pt)
    && uidList(reps.en, 'en') === uidList(reps.pt, 'pt'), reps.en.records.map((r) => r.key).join(', '));
};
const canalBoth = both('duas assinaturas', () => canal);
sameInBoth('duas assinaturas no mesmo estabelecimento', canalBoth);
check('a chave da sequência extra é a mesma de antes do inglês ("· R$ 39,99" → "-r-39-99")', canalBoth.en.records.some((r) => r.key === 'canal-video-r-39-99')
  && subscriptionKey('Canal Video · R$ 39,99') === 'canal-video-r-39-99');
// em real a pontuação some na chave ("R$39.99" e "R$ 39,99" dão o mesmo); em dólar não ("$49.00" × "US$ 49,00")
const usdCanal = dataset([
  ...['2026-05-03', '2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'].map((d) => buy(d, 'Canal Dolar', 4.99, { currency: 'USD', subscriptionHint: true })),
  ...['2026-08-16', '2026-09-16', '2026-10-16'].map((d) => buy(d, 'Canal Dolar', 1049, { currency: 'USD', subscriptionHint: true })),
], TODAY);
const usdBoth = both('sequência extra em dólar', () => usdCanal);
sameInBoth('sequência extra em dólar', usdBoth);
check('chave da sequência extra em dólar: valor cru, com milhar, igual à de antes do inglês', usdBoth.en.records.some((r) => r.key === 'canal-dolar-us-1-049-00')
  && subscriptionKey('Canal Dolar · US$ 1.049,00') === 'canal-dolar-us-1-049-00', usdBoth.en.records.map((r) => `${r.name} → ${r.key}`).join(', '));
// cada conjunto é montado uma vez: os dois idiomas olham as mesmas transações (mesmos ids)
const hostEmailDs = dataset(hostTx(), TODAY, [
  email('Nuvem Hospeda', 'receipt', '2026-10-12', { matchers: ['NUVEM HOSPEDA INC'], cycle: 'monthly', periodEnd: '2026-11-12' }),
  email('Nuvem Hospeda', 'renewal_notice', '2026-09-17', { matchers: ['NUVEM HOSPEDA DOMAINS'], cycle: 'annual', periodEnd: '2027-09-24' }),
]);
sameInBoth('dois planos pelo email', both('dois planos pelo email', () => hostEmailDs));
const hostKnowledgeDs = dataset(hostTx(), TODAY);
sameInBoth('dois planos pela base', both('dois planos pela base', () => hostKnowledgeDs, { knowledge: [kDomains, kHost] }));
sameInBoth('decisões', both('decisões', () => dsA, { today: AT_D7, decisions: decide('keep', '2026-10-30T12:00:00Z', '2026-11-10') }));
sameInBoth('auditoria, risco e renovação recente', both('auditoria', () => painelDs));
sameInBoth('auditoria no aviso de 30 dias', both('auditoria d30', () => painelDs, { today: '2027-09-27' }));
sameInBoth('janela de reembolso', both('reembolso', () => editorDs));
sameInBoth('calendário', both('calendário', () => dataset(repIcs.records.flatMap((r) => r.charges), TODAY), { knowledge: [kB, kE] }));
// nome que o merchants.ts traduz: "In-flight Wi-Fi" × "Wi-Fi a bordo"; a chave sai do nome em português nos dois
const wifiRaw = dataset(gDays.map((d) => buy(d, 'WIFI ONBOARD', 30, { merchantRaw: 'WIFI ONBOARD', category: undefined })), TODAY);
const wifi = both('nome traduzido', (locale) => enrichDataset(wifiRaw, locale));
sameInBoth('nome do estabelecimento traduzido', wifi);
check('o nome muda com o idioma, a chave não', find(wifi.en, 'In-flight Wi-Fi')?.key === 'wi-fi-a-bordo' && find(wifi.pt, 'Wi-Fi a bordo')?.key === 'wi-fi-a-bordo',
  `${wifi.en.records.map((r) => `${r.name} → ${r.key}`)} / ${wifi.pt.records.map((r) => `${r.name} → ${r.key}`)}`);

console.log('\n== demo ==');
const demo = enrichDataset(demoDataset);
const repDemo = run('demo', demo);
const DEMO: Record<string, string> = {
  'Claude (Anthropic)': '2026-10-14', 'Uber One': '2026-10-15', YouTube: '2026-10-18', Spotify: '2026-10-23',
  'ChatGPT (OpenAI)': '2026-11-02', 'iCloud+': '2026-11-05', Netflix: '2026-11-11',
  StreamBox: '2026-10-14', 'Pinecell Wireless': '2026-11-08',
};
for (const [name, next] of Object.entries(DEMO)) {
  const r = find(repDemo, name);
  check(`${name}: mensal pela recorrência, renova em ${next.slice(8)}/${next.slice(5, 7)}`, r?.cycle === 'monthly' && r.cycleSource === 'recurrence' && r.nextRenewal === next && r.status === 'active', `${r?.cycle} ${r?.nextRenewal}`);
}
check('só essas 15: 13 ativas, a academia cancelada e o curso que parou (lojas, viagens, restaurantes, ingressos e o cinema de vez em quando ficam de fora)',
  repDemo.records.length === 15 && repDemo.records.filter((r) => r.status === 'active').length === 13, repDemo.records.map((r) => r.name).join(', '));
check('avisos: Claude e StreamBox em 2 dias (d2), Uber One e YouTube na semana (d7), Spotify em 11 (d14), PhotoVault em 21 (d30, risco alto)',
  repDemo.alerts.map((r) => `${r.name}:${r.alert}`).join() === 'Claude (Anthropic):d2,StreamBox:d2,Uber One:d7,YouTube:d7,Spotify:d14,PhotoVault:d30', repDemo.alerts.map((r) => `${r.name}:${r.alert}`).join());
check('total mensal 196.76 (anual ÷ 12 incluído)', repDemo.monthlyTotalUsd === 196.76 && repDemo.annualTotalUsd === 2361.13, `${repDemo.monthlyTotalUsd} / ${repDemo.annualTotalUsd}`);
const icsDemo = buildIcs(repDemo.records);
check('calendário do demo: 13 eventos (as ativas), o alarme de 30 dias só nas 2 de risco alto', (icsDemo.match(/BEGIN:VEVENT/g) ?? []).length === 13
  && (icsDemo.match(/TRIGGER:-P29DT15H/g) ?? []).length === 2);
const fitpal = find(repDemo, 'FitPal');
check('anual que renovou hoje sem lembrete: FitPal com risco alto da auditoria, 14 dias para pedir reembolso, em "renovaram há pouco"', fitpal?.cycle === 'annual'
  && fitpal.justRenewed?.daysAgo === 0 && fitpal.justRenewed.refundDaysLeft === 14 && fitpal.risk === 'high' && fitpal.riskSource === 'audit'
  && (repDemo.justRenewed ?? []).map((r) => r.name).join() === 'FitPal,Netflix,Kestrel Notes', `${fitpal?.justRenewed?.daysAgo} ${fitpal?.justRenewed?.refundDaysLeft} ${fitpal?.risk}`);
const vault = find(repDemo, 'PhotoVault');
check('anual cara sem lembrete: PhotoVault renova em 21 dias, ciclo pela pesquisa, risco alto da auditoria', vault?.cycle === 'annual' && vault.cycleSource === 'research'
  && vault.nextRenewal === '2026-11-02' && vault.risk === 'high' && vault.alert === 'd30', `${vault?.cycle} ${vault?.nextRenewal} ${vault?.alert}`);
check('"confira antes de renovar": as 2 ativas de risco alto, a mais próxima primeiro', (repDemo.atRisk ?? []).map((r) => r.name).join() === 'PhotoVault,FitPal');
const lingua = find(repDemo, 'LinguaLeap');
check('possivelmente cancelada: LinguaLeap, a renovação de 20/09 não veio e não há email', lingua?.status === 'maybe_cancelled' && lingua.nextRenewal === '2026-09-20'
  && !lingua.signals.some((s) => s.kind === 'email'), `${lingua?.status} ${lingua?.nextRenewal}`);
const trial = find(repDemo, 'MindHarbor');
check('teste grátis que virou cobrança: MindHarbor mensal pelo email do fim do teste, renova em 05/11', trial?.status === 'active' && trial.cycle === 'monthly'
  && trial.cycleSource === 'email' && trial.nextRenewal === '2026-11-05' && trial.signals.some((s) => /trial ends|teste acaba/.test(s.detail)), `${trial?.cycle} ${trial?.nextRenewal}`);
check('plano de celular só pela recorrência: categoria pelo nome, confiança média', find(repDemo, 'Pinecell Wireless')?.category === CATEGORY.phone
  && find(repDemo, 'Pinecell Wireless')?.confidence === 'medium');
const kestrel = find(repDemo, 'Kestrel Notes');
check('anual que acabou de renovar (email): 19 dias para pedir reembolso, risco médio da auditoria', kestrel?.cycle === 'annual' && kestrel.cycleSource === 'email'
  && kestrel.justRenewed?.refundDaysLeft === 19 && kestrel.risk === 'medium' && kestrel.riskSource === 'audit', `${kestrel?.cycle} ${kestrel?.justRenewed?.refundDaysLeft} ${kestrel?.risk}`);
const gym = find(repDemo, 'FitLab Gym');
check('a academia parou: cancelada pelo email, risco alto da auditoria, entra pela pesquisa local', gym?.status === 'cancelled' && gym.risk === 'high'
  && gym.signals.some((s) => s.kind === 'research') && gym.signals.some((s) => s.kind === 'email'));
check('Netflix: o aumento na última renovação', find(repDemo, 'Netflix')?.justRenewed?.priceChanged === true);
const repDemoKb = run('demo com a base pública', demo, { knowledge: SUBSCRIPTION_KNOWLEDGE });
check('com a base pública: as mesmas 15, com as mesmas renovações e o mesmo total', repDemoKb.records.length === 15 && repDemoKb.monthlyTotalUsd === 196.76
  && Object.entries(DEMO).every(([name, next]) => find(repDemoKb, name)?.nextRenewal === next), repDemoKb.records.map((r) => r.name).join(', '));
sameInBoth('demo com a base pública, enriquecido em cada idioma', both('demo nos dois idiomas', (locale) => enrichDataset(demoDataset, locale), { knowledge: SUBSCRIPTION_KNOWLEDGE }));

const broken = runs.filter((x) => x.bad.length);
check(`invariantes nos ${runs.length} relatórios sintéticos e do demo`, !broken.length, broken.map((x) => `${x.label}: ${x.bad.join(', ')}`).join(' | '));

// a pasta de dados reais vem do mesmo resolvedor do pull e do vite.config (scripts/data-dir.mjs)
const data = resolveDataDir();
const dir = data.url;
if (!existsSync(dir)) {
  console.log(`\n(sem dados reais em ${data.label}: pulando)`);
} else {
  console.log(`\n== dados reais de ${data.label} (invariantes) ==`);
  const files = readdirSync(dir).filter(isDataFile).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const pages = files.filter((f) => f.startsWith('list_transactions')).map(read);
  const paged: Record<string, unknown>[] = pages.flatMap((p) => p.transactions);
  // a paginação do conector repete linhas na virada de página; cada id conta uma vez
  const rawTx = [...new Map(paged.map((t) => [String(t.id), t])).values()];
  const one = (name: string) => (files.includes(`${name}.json`) ? read(`${name}.json`) : undefined);
  const { dataset: assembled } = assembleDataset({
    referenceDate: rawTx.map((t) => String(t.date)).sort().at(-1)!.slice(0, 10),
    transactions: { ...pages.at(-1), transactions: rawTx },
    cards: one('list_cards'),
    mainAccount: one('get_main_account'),
    portfolio: one('get_portfolio'),
    deposit: one('get_deposit_address'),
  });

  // email e pesquisa locais, se já existirem: reconhecidos pelo formato, não pelo nome do arquivo
  const fields = (x: unknown) => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {});
  const isEvidence = (x: unknown): x is EvidenceItem => {
    const o = fields(x);
    return typeof o.name === 'string' && Array.isArray(o.matchers) && typeof o.kind === 'string' && typeof o.emailDate === 'string' && typeof o.cycle === 'string';
  };
  const isKnowledge = (x: unknown): x is KnowledgeItem => {
    const o = fields(x);
    return typeof o.name === 'string' && Array.isArray(o.matchers) && typeof o.isSubscription === 'string' && Array.isArray(o.cycles) && Array.isArray(o.sources);
  };
  const isAudit = (x: unknown): x is RenewalAuditItem => {
    const o = fields(x);
    return typeof o.name === 'string' && Array.isArray(o.matchers) && typeof o.autoRenew === 'string' && typeof o.risk === 'string' && Array.isArray(o.riskReasons);
  };
  const evidence: EvidenceItem[] = [];
  const research: KnowledgeItem[] = [];
  const audit: RenewalAuditItem[] = [];
  for (const f of files.filter((name) => !name.startsWith('list_') && !name.startsWith('get_'))) {
    let items: unknown[] = [];
    try {
      const parsed = fields(read(f));
      items = Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
      continue; // arquivo sendo escrito por outro processo
    }
    if (items.length && items.every(isEvidence)) evidence.push(...items);
    else if (items.length && items.every(isKnowledge)) research.push(...items);
    else if (items.length && items.every(isAudit)) audit.push(...items);
  }
  // como a store carrega: cada arquivo passa pelo validate.ts (só a contagem sai na tela)
  const validated = validateSubscriptionSources({
    evidence: evidence.length ? { generatedAt: '', source: 'fixtures/live', items: evidence } : undefined,
    research: research.length ? { generatedAt: '', items: research } : undefined,
    audit: audit.length ? { generatedAt: '', items: audit } : undefined,
  });
  check('arquivos locais da IA passam pela validação sem perder item', validated.dropped === 0 && !validated.invalidFiles.length, `${validated.dropped} descartado(s)`);
  const sources = validated.sources;
  const variants: [string, boolean, KnowledgeItem[]][] = [['só cartão e dicionário', false, []]];
  if (evidence.length || research.length || audit.length) variants.push(['com email, pesquisa e auditoria locais', true, sources.research?.items ?? []]);
  // como a tela vai passar: pesquisa local antes da base pública
  variants.push(['com email, pesquisa e base pública', true, [...(sources.research?.items ?? []), ...SUBSCRIPTION_KNOWLEDGE]]);
  for (const [label, withSources, knowledge] of variants) {
    const reps: Partial<Record<Locale, SubscriptionReport>> = {};
    for (const locale of ['en', 'pt'] as const) {
      useLocale(locale);
      // como a tela: o store enriquece no idioma e o format.ts acompanha
      const ds: Dataset = { ...enrichDataset(assembled, locale), subscriptionSources: withSources ? sources : undefined };
      const started = Date.now();
      const rep = analyzeSubscriptions(ds, { knowledge, locale });
      const elapsed = Date.now() - started;
      reps[locale] = rep;
      if (locale === 'en') {
        const count = (s: SubscriptionRecord['status']) => rep.records.filter((r) => r.status === s).length;
        console.log(`(${label}: ${rep.records.length} registros — ${count('active')} ativas, ${count('maybe_cancelled')} talvez canceladas, ${count('cancelled')} canceladas; `
          + `${rep.alerts.length} avisos; ${rep.records.filter((r) => r.audit).length} com auditoria, ${rep.atRisk?.length ?? 0} em risco alto, ${rep.justRenewed?.length ?? 0} renovações recentes na lista)`);
      }
      const bad = invariantChecks(ds, rep, ds.referenceDate, locale).filter(([, ok]) => !ok).map(([name]) => name);
      check(`${label} (${locale}): todas as invariantes`, !bad.length, bad.join(', '));
      check(`${label} (${locale}): roda em menos de 2 s`, elapsed < 2000);
    }
    useLocale('en');
    const en = reps.en!;
    const pt = reps.pt!;
    // só a contagem sai na tela: nos dados reais, nunca nomes nem valores
    check(`${label}: mesma chave, renovação, status e cobranças em EN e PT; mesmo UID`, signature(en) === signature(pt) && uidList(en, 'en') === uidList(pt, 'pt'),
      `${en.records.length} × ${pt.records.length} registros`);
    // plano do email e nota da pesquisa local são dados: o que se confere é o texto que o motor gera
    const EN_EMAIL = /^((receipt|renewal notice|trial-ending notice|cancellation|price-change notice|sign-up confirmation) in email on |paid for \d+ (years|months) at once)/;
    // na auditoria o começo da frase é do motor; o resto (prazo, nota, motivos) é dado
    const EN_KNOWLEDGE = /^(known to bill a subscription|may bill a subscription|not listed as a subscription|renews on its own|doesn't renew|emails a reminder|doesn't email|cancel by:|refund|the terms|price at renewal:|risk of a surprise charge:|\d+ days? left|the refund window|the renewal is charged \d+ days before)/;
    const leaks = en.records.flatMap((r) => r.signals).filter((s) => (s.kind === 'email' ? !EN_EMAIL.test(s.detail)
      : s.kind === 'knowledge' || s.kind === 'research' || s.kind === 'audit' ? !EN_KNOWLEDGE.test(s.detail) && PT_WORDS.test(s.detail)
      : PT_WORDS.test(s.detail))).length;
    check(`${label}: sinais gerados em inglês no modo inglês`, leaks === 0, `${leaks} sinal(is) com palavra em português`);
  }
}

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
