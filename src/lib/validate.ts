// Os arquivos da análise de assinaturas (fixtures/live/*.json ou importados) são escritos pela IA da pessoa: chegam como
// JSON qualquer. Aqui cada item é conferido campo a campo; o item sem o essencial sai e entra na contagem, o campo
// opcional malformado só some. Nada daqui lança: um arquivo ruim não pode derrubar a tela de Assinaturas.
import type { LocalizedText } from './locale';
import type {
  Cycle, EvidenceFile, EvidenceItem, EvidenceKind, KnowledgeFile, KnowledgeItem, RenewalAuditFile, RenewalAuditItem,
} from './subscriptionTypes';
import type { PtaxRate, PtaxSeries } from './types';
import { safeUrl } from './url.ts';
import { cleanText, clip } from './cleanText.ts';

/** O arquivo conferido e quantos itens saíram; `value` fica ausente quando o arquivo não veio ou não tem a forma { items: [] } */
export interface Validated<T> {
  value?: T;
  dropped: number;
  /** true quando o arquivo veio, mas sem a forma esperada: foi ignorado inteiro */
  invalid: boolean;
}

type Obj = Record<string, unknown>;

const CYCLES: readonly Cycle[] = ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'unknown'];
const KINDS: readonly EvidenceKind[] = ['receipt', 'renewal_notice', 'trial_ending', 'cancellation', 'price_change', 'signup'];
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?=$|[T ])/;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Teto do texto livre (assunto, motivo, prazo, nota) e do nome: o que passa termina em "…" */
const MAX_TEXT = 2000;
const MAX_NAME = 200;
/** Teto de itens por arquivo da IA: um "arquivo" de 200 mil itens travaria a aba antes de qualquer análise */
const MAX_ITEMS = 5000;
/** Teto de entradas em listas internas (matchers, fontes, domínios, motivos) */
const MAX_LIST = 100;
// texto de terceiros: sem controles nem marcas de direção (cleanText.ts) e com teto de tamanho
const text = (v: unknown, max = MAX_TEXT): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = cleanText(v).trim();
  return s ? clip(s, max) : undefined;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.slice(0, MAX_LIST).map((x) => text(x)).filter((s): s is string => Boolean(s)) : []);
const day = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const m = DAY_RE.exec(v);
  if (!m) return undefined;
  const year = Number(m[1]);
  if (year < 2000 || year > 2100) return undefined;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(time)) return undefined;
  // data impossível (2026-02-31) não volta do Date igual ao texto: recusa em vez de deixar o Date normalizar
  return new Date(time).toISOString().slice(0, 10) === iso ? iso : undefined;
};
const count = (v: unknown, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);

function localizedText(v: unknown): LocalizedText | undefined {
  if (typeof v === 'string') return text(v);
  if (isObj(v) && typeof v.en === 'string' && typeof v.pt === 'string') return { en: text(v.en) ?? '', pt: text(v.pt) ?? '' };
  return undefined;
}

/** Só põe a chave quando o valor existe: o objeto final não carrega `undefined` explícito. */
function withOptional<T extends object>(base: T, extra: Partial<T>): T {
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) Object.assign(base, { [k]: v });
  return base;
}

function validateFile<T, F>(raw: unknown, item: (v: unknown) => T | null, build: (raw: Obj, items: T[]) => F): Validated<F> {
  if (raw === undefined || raw === null) return { dropped: 0, invalid: false };
  if (!isObj(raw) || !Array.isArray(raw.items)) return { dropped: 0, invalid: true };
  const items: T[] = [];
  let dropped = 0;
  for (let i = 0; i < raw.items.length; i++) {
    if (items.length >= MAX_ITEMS) {
      dropped += raw.items.length - i;
      break;
    }
    const ok = item(raw.items[i]);
    if (ok) items.push(ok);
    else dropped += 1;
  }
  return { value: build(raw, items), dropped, invalid: false };
}

function knowledgeItem(v: unknown): KnowledgeItem | null {
  if (!isObj(v)) return null;
  const name = text(v.name, MAX_NAME);
  const isSubscription = oneOf(v.isSubscription, ['yes', 'no', 'maybe'] as const);
  if (!name || !isSubscription) return null;
  const cycles = Array.isArray(v.cycles) ? v.cycles.filter((c): c is Cycle => CYCLES.includes(c as Cycle)) : [];
  return withOptional<KnowledgeItem>(
    { matchers: strings(v.matchers), name, isSubscription, cycles: cycles.length ? cycles : ['unknown'], sources: strings(v.sources) },
    {
      note: localizedText(v.note),
      manageUrl: safeUrl(v.manageUrl),
      domains: Array.isArray(v.domains) ? strings(v.domains) : undefined,
      itemized: v.itemized === true ? true : undefined,
      generic: v.generic === true ? true : undefined,
      chargeLeadDays: count(v.chargeLeadDays, 120),
    },
  );
}

function evidenceItem(v: unknown): EvidenceItem | null {
  if (!isObj(v)) return null;
  const name = text(v.name, MAX_NAME);
  const kind = oneOf(v.kind, KINDS);
  const emailDate = day(v.emailDate);
  if (!name || !kind || !emailDate) return null;
  const amount = typeof v.amount === 'number' && Number.isFinite(v.amount) && v.amount >= 0 ? v.amount : undefined;
  const currency = typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency) ? v.currency : undefined;
  return withOptional<EvidenceItem>(
    { name, matchers: strings(v.matchers), kind, emailDate, subject: text(v.subject) ?? '', cycle: oneOf(v.cycle, CYCLES) ?? 'unknown' },
    {
      plan: text(v.plan),
      // valor sem moeda não se compara com cobrança nenhuma
      amount: currency ? amount : undefined,
      currency: amount !== undefined ? currency : undefined,
      periodEnd: day(v.periodEnd),
      manageUrl: safeUrl(v.manageUrl),
    },
  );
}

function auditItem(v: unknown): RenewalAuditItem | null {
  if (!isObj(v)) return null;
  const name = text(v.name, MAX_NAME);
  const risk = oneOf(v.risk, ['high', 'medium', 'low'] as const);
  const checkedAt = day(v.checkedAt);
  if (!name || !risk || !checkedAt) return null;
  const tri = (x: unknown) => oneOf(x, ['yes', 'no', 'unknown'] as const) ?? 'unknown';
  return withOptional<RenewalAuditItem>(
    {
      name,
      matchers: strings(v.matchers),
      autoRenew: tri(v.autoRenew),
      noticeBeforeRenewal: tri(v.noticeBeforeRenewal),
      sources: strings(v.sources),
      checked: Array.isArray(v.checked) ? v.checked.filter((c): c is 'website' | 'email' => c === 'website' || c === 'email') : [],
      checkedAt,
      risk,
      riskReasons: Array.isArray(v.riskReasons) ? v.riskReasons.map(localizedText).filter((r): r is LocalizedText => r !== undefined) : [],
    },
    {
      noticeDays: count(v.noticeDays, 365),
      cancelDeadline: localizedText(v.cancelDeadline),
      refundWindowDays: count(v.refundWindowDays, 365),
      refundNote: localizedText(v.refundNote),
      priceChangeAtRenewal: localizedText(v.priceChangeAtRenewal),
      chargeLeadDays: count(v.chargeLeadDays, 120),
      manageUrl: safeUrl(v.manageUrl),
    },
  );
}

const generatedAt = (r: Obj) => text(r.generatedAt) ?? '';

export function validateKnowledgeFile(raw: unknown): Validated<KnowledgeFile> {
  return validateFile(raw, knowledgeItem, (r, items): KnowledgeFile => ({ generatedAt: generatedAt(r), items }));
}

export function validateEvidenceFile(raw: unknown): Validated<EvidenceFile> {
  return validateFile(raw, evidenceItem, (r, items): EvidenceFile => ({ generatedAt: generatedAt(r), source: text(r.source) ?? '', items }));
}

export function validateAuditFile(raw: unknown): Validated<RenewalAuditFile> {
  return validateFile(raw, auditItem, (r, items): RenewalAuditFile => ({ generatedAt: generatedAt(r), items }));
}

/** Reais por US$ fora disto não é PTAX (erro de digitação, outra moeda, cotação invertida) */
const PTAX_RANGE: [number, number] = [1, 50];

function ptaxRate(v: unknown): PtaxRate | null {
  if (!isObj(v)) return null;
  // o formato do npm run pull ({ date, sell }) e o cru da API do BCB ({ dataHoraCotacao, cotacaoVenda })
  const date = day(v.date) ?? day(v.dataHoraCotacao);
  const sell = typeof v.sell === 'number' ? v.sell : typeof v.cotacaoVenda === 'number' ? v.cotacaoVenda : undefined;
  if (!date || sell === undefined || !Number.isFinite(sell) || sell < PTAX_RANGE[0] || sell > PTAX_RANGE[1]) return null;
  return { date: date.slice(0, 10), sell };
}

/**
 * A série da PTAX (ptax.json): o arquivo do npm run pull, { kind: 'ptax', rates: [{ date, sell }] }, ou a resposta crua
 * da API do BCB, { value: [{ cotacaoVenda, dataHoraCotacao }] }. O dia repetido fica com o último valor; a série sai
 * ordenada. Sem nenhum dia válido, o arquivo é inválido.
 */
export function validatePtaxFile(raw: unknown): Validated<PtaxSeries> {
  if (raw === undefined || raw === null) return { dropped: 0, invalid: false };
  if (!isObj(raw)) return { dropped: 0, invalid: true };
  const list = Array.isArray(raw.rates) ? raw.rates : Array.isArray(raw.value) ? raw.value : null;
  if (!list) return { dropped: 0, invalid: true };
  const byDay = new Map<string, number>();
  let dropped = 0;
  for (const v of list) {
    const r = ptaxRate(v);
    if (r) byDay.set(r.date, r.sell);
    else dropped += 1;
  }
  if (!byDay.size) return { dropped, invalid: true };
  const rates = [...byDay.entries()].map(([date, sell]) => ({ date, sell })).sort((a, b) => a.date.localeCompare(b.date));
  const fetchedAt = text(raw.fetchedAt);
  return { value: withOptional<PtaxSeries>({ rates }, { fetchedAt: fetchedAt && Number.isFinite(Date.parse(fetchedAt)) ? fetchedAt : undefined }), dropped, invalid: false };
}

export interface ValidatedSources {
  /** Pronto para Dataset.subscriptionSources: só os arquivos que vieram com a forma certa */
  sources: { evidence?: EvidenceFile; research?: KnowledgeFile; audit?: RenewalAuditFile };
  /** Itens descartados nos três arquivos */
  dropped: number;
  /** Arquivos que vieram com outra forma e foram ignorados inteiros */
  invalidFiles: ('evidence' | 'research' | 'audit')[];
}

/** Os três arquivos da IA de uma vez, como a store carrega (fixtures/live ou importação). */
export function validateSubscriptionSources(files: { evidence?: unknown; research?: unknown; audit?: unknown }): ValidatedSources {
  const evidence = validateEvidenceFile(files.evidence);
  const research = validateKnowledgeFile(files.research);
  const audit = validateAuditFile(files.audit);
  const sources: ValidatedSources['sources'] = {};
  if (evidence.value) sources.evidence = evidence.value;
  if (research.value) sources.research = research.value;
  if (audit.value) sources.audit = audit.value;
  const named = [['evidence', evidence], ['research', research], ['audit', audit]] as const;
  return {
    sources,
    dropped: evidence.dropped + research.dropped + audit.dropped,
    invalidFiles: named.filter(([, v]) => v.invalid).map(([k]) => k),
  };
}
