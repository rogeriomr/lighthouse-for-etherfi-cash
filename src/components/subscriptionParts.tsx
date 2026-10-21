import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, CalendarClock, Check, ChevronDown, Copy, ExternalLink, Hourglass, RotateCcw, ShieldAlert } from 'lucide-react';
import { ALERT_DAYS, HIGH_RISK_ALERT_DAYS } from '../lib/subscriptionTypes';
import type { AlertStage, Cycle, JustRenewed, RiskLevel, SubscriptionRecord, SubscriptionSignal } from '../lib/subscriptionTypes';
import type { Fx } from '../lib/analytics';
import { LOCALES, localized, pick, type Locale } from '../lib/locale';
import { dateFull, dateShort, formatLocale, money, usd } from '../lib/format';
import { isKnownHost, safeUrl, urlHost } from '../lib/url';
import { langAttr } from '../lib/quoteLang';
import { cx } from '../lib/cx';
import { plansToCancel, type Decisions, type RenewalCheck } from '../state/decisions';
import { useLocale, useTr } from '../state/locale';
import { Badge } from './ui';
import { TxAmount } from './money';
// as ações das linhas do Início iguais às dos alertas ao lado (12 px, 44 px de alvo no toque)
import { rowActionClass } from './alerts';

// a persistência e o .ics moraram aqui; quem ainda importa deste arquivo continua funcionando
export {
  awaitsYou, byUrgency, decide, forget, markCancelled, needsCheck, plansToCancel, renewalCheckOf, setRenewalCheck, useSubscriptions,
} from '../state/decisions';
export type { Checks, Decisions, RenewalCheck, StoredDecision } from '../state/decisions';
export { downloadFile, icsFor } from '../state/calendar';

/** A resposta que ainda vale, como selo neutro (a escolha é da pessoa: nenhuma cor sugere que foi boa ou ruim). */
export function answerBadge(r: SubscriptionRecord, decisions: Decisions, locale: Locale): { label: string; tone: 'info' | 'neutral' } | null {
  if (r.status !== 'active' || !r.decision || r.needsAnswer) return null;
  if (r.decision.choice === 'keep') return { label: pick(locale, 'keeping', 'vai manter'), tone: 'neutral' };
  if (r.decision.choice !== 'cancel') return null;
  return decisions[r.key]?.done
    ? { label: pick(locale, 'you canceled', 'você cancelou'), tone: 'neutral' }
    : { label: pick(locale, 'canceling', 'vai cancelar'), tone: 'info' };
}

/** Custo em moeda da casa: valor local quando a cobrança foi nela, câmbio médio no resto (por isso "≈"). */
export function homeCost(records: SubscriptionRecord[], fx: Fx | null): { monthly: number; annual: number } | null {
  if (!fx) return null;
  let monthly = 0;
  for (const r of records) {
    const t = r.lastCharge;
    // conta recorrente (aluguel, condomínio) não é assinatura: fica fora, como no total em US$
    if (r.kind !== 'subscription' || r.status !== 'active' || !r.monthlyCostUsd || t.amountUsd <= 0) continue;
    const local = t.currency === fx.currency ? t.amount : t.amountUsd * fx.localPerUsd;
    monthly += local * (r.monthlyCostUsd / t.amountUsd);
  }
  return { monthly, annual: monthly * 12 };
}

// ---------- rótulos e datas ----------

/** Número preso à palavra seguinte ("2 dias", "6 perguntas") e moeda presa ao valor ("US$ 99"): a linha nunca quebra entre os dois. */
export const nb = (s: string) => s
  .replace(/(\d) (?=[\p{L}(])/gu, '$1\u00a0')
  .replace(/(US\$|R\$|€|£) (?=\d)/g, '$1\u00a0')
  // data ISO ("2026-11-28") com hífen que não quebra
  .replace(/(\d{4})-(\d{2})-(\d{2})/g, '$1\u2011$2\u2011$3');

// title é dica de mouse: no toque ele não abre, então só vai para a página onde há hover de verdade. O que ele diz
// também está no texto visível ou nos detalhes (o nome abre os termos e as últimas cobranças)
const HOVER = '(hover: hover) and (pointer: fine)';
const subscribeHover = (cb: () => void) => {
  const m = window.matchMedia(HOVER);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
export const useCanHover = () => useSyncExternalStore(subscribeHover, () => window.matchMedia(HOVER).matches, () => true);

type Pair = [en: string, pt: string];

const CYCLE_LABEL: Record<Cycle, Pair> = {
  weekly: ['weekly', 'semanal'],
  monthly: ['monthly', 'mensal'],
  quarterly: ['quarterly', 'trimestral'],
  semiannual: ['every 6 months', 'semestral'],
  annual: ['yearly', 'anual'],
  unknown: ['unknown cycle', 'ciclo desconhecido'],
};
export const cycleLabel = (c: Cycle, locale: Locale) => pick(locale, ...CYCLE_LABEL[c]);

/** O ciclo de um registro: período pago de mais de um ano (domínio de 2 ou 5 anos) vira "a cada N anos". */
export function cycleText(r: SubscriptionRecord, locale: Locale): string {
  const m = r.termMonths;
  if (!m) return cycleLabel(r.cycle, locale);
  return m % 12 === 0
    ? pick(locale, `every ${m / 12} years`, `a cada ${m / 12} anos`)
    : pick(locale, `every ${m} months`, `a cada ${m} meses`);
}

// email e pesquisa chegam pelos arquivos da IA da pessoa: o rótulo diz isso, para não parecer conferido pelo app
const CYCLE_SOURCE_LABEL: Record<SubscriptionRecord['cycleSource'], Pair> = {
  email: ['cycle from email, read by your AI', 'ciclo pelo email, lido pela sua IA'],
  recurrence: ['cycle from the gap between charges', 'ciclo pelo intervalo das cobranças'],
  knowledge: ["cycle from what's known about the service", 'ciclo pelo que se sabe do serviço'],
  research: ["cycle from your AI's research on the service", 'ciclo pela pesquisa da sua IA sobre o serviço'],
  estimate: ['estimated cycle', 'ciclo estimado'],
};
export const cycleSourceLabel = (s: SubscriptionRecord['cycleSource'], locale: Locale) => pick(locale, ...CYCLE_SOURCE_LABEL[s]);

const CONFIDENCE: Record<SubscriptionRecord['confidence'], { label: Pair; tone: 'good' | 'info' | 'neutral' }> = {
  high: { label: ['high confidence', 'confiança alta'], tone: 'good' },
  medium: { label: ['medium confidence', 'confiança média'], tone: 'info' },
  low: { label: ['low confidence', 'confiança baixa'], tone: 'neutral' },
};
export const confidenceOf = (c: SubscriptionRecord['confidence'], locale: Locale) => ({ label: pick(locale, ...CONFIDENCE[c].label), tone: CONFIDENCE[c].tone });

const SIGNAL_LABEL: Record<SubscriptionSignal['kind'], Pair> = {
  recurrence: ['Card', 'Cartão'],
  dictionary: ['Dictionary', 'Dicionário'],
  knowledge: ['Public info', 'Base pública'],
  research: ["Your AI's research", 'Pesquisa da sua IA'],
  email: ['Email (your AI)', 'Email (sua IA)'],
  audit: ["Your AI's reading of the terms", 'Termos, pela sua IA'],
};

/** Cor por janela de aviso: quanto mais perto, mais forte. */
export const STAGE: Record<AlertStage, { label: Pair; text: string; dot: string; card: string; icon: typeof CalendarClock }> = {
  d2: { label: ['2-day reminder', 'aviso de 2 dias'], text: 'text-bad', dot: 'bg-bad', card: 'border-bad/45 bg-bad/[0.06]', icon: CalendarClock },
  due: { label: ['date passed', 'a data passou'], text: 'text-warn', dot: 'bg-warn', card: 'border-warn/30 bg-warn/[0.03]', icon: Hourglass },
  overdue: { label: ['date passed', 'a data passou'], text: 'text-warn', dot: 'bg-warn', card: 'border-warn/30 bg-warn/[0.03]', icon: Hourglass },
  d7: { label: ['7-day reminder', 'aviso de 7 dias'], text: 'text-warn', dot: 'bg-warn', card: 'border-warn/35 bg-panel2/40', icon: CalendarClock },
  d14: { label: ['14-day reminder', 'aviso de 14 dias'], text: 'text-info', dot: 'bg-info', card: 'border-line bg-panel2/40', icon: CalendarClock },
  d30: { label: ['30-day reminder', 'aviso de 30 dias'], text: 'text-info', dot: 'bg-info', card: 'border-line bg-panel2/40', icon: CalendarClock },
};
export const stageLabel = (s: AlertStage, locale: Locale) => pick(locale, ...STAGE[s].label);

const noon = (day: string) => `${day.slice(0, 10)}T12:00:00Z`;
// dia da semana curto no idioma da formatação ("Wed" / "qua"); o resto das datas vem de format.ts
const weekdayFmts = new Map<string, Intl.DateTimeFormat>();
export function weekday(day: string): string {
  const tag = LOCALES.find((l) => l.value === formatLocale())?.tag ?? 'en-US';
  let f = weekdayFmts.get(tag);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' });
    weekdayFmts.set(tag, f);
  }
  return f.format(new Date(noon(day))).replace('.', '');
}

export const dayMonth = (day: string) => dateShort(noon(day));
export const dayMonthYear = (day: string) => dateFull(noon(day));
export const weekdayDay = (day: string) => `${weekday(day)}, ${dayMonth(day)}`;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function renewalIn(days: number, locale: Locale): string {
  if (days < -1) return pick(locale, `was due to renew ${-days}\u00a0days ago`, `era para ter renovado há ${-days}\u00a0dias`);
  if (days === -1) return pick(locale, 'was due to renew yesterday', 'era para ter renovado ontem');
  if (days === 0) return pick(locale, 'renews today', 'renova hoje');
  if (days === 1) return pick(locale, 'renews tomorrow', 'renova amanhã');
  return pick(locale, `renews in ${days}\u00a0days`, `renova em ${days}\u00a0dias`);
}

/** "em 3 dias" sem o verbo, para "próxima: …" */
export function inDays(days: number, locale: Locale): string {
  if (days === 0) return pick(locale, 'today', 'hoje');
  if (days === 1) return pick(locale, 'tomorrow', 'amanhã');
  if (days < 0) return pick(locale, `${-days}\u00a0days ago`, `há ${-days}\u00a0dias`);
  return pick(locale, `in ${days}\u00a0days`, `em ${days}\u00a0dias`);
}

// ---------- texto de fora (email, pesquisa, termos) ----------

/**
 * Trecho que veio de fora do código e fica na língua de origem (nota da pesquisa, termos lidos pela IA, plano do
 * email): com o `lang` dele quando é outra língua que a da tela, para o leitor de tela pronunciar certo.
 */
export function Foreign({ text, className }: { text: string; className?: string }) {
  const { locale } = useLocale();
  // o motor às vezes junta a frase dele com a nota da pesquisa ("known to bill… — Hoje há um só plano…"): cada parte
  // ganha o idioma dela
  const parts = text.split(' — ');
  if (parts.length > 1) {
    return (
      <span className={className}>
        {parts.map((p, i) => <span key={i}>{i ? ' — ' : ''}<Foreign text={p} /></span>)}
      </span>
    );
  }
  const lang = langAttr(text, locale);
  if (!lang && !className) return <>{text}</>;
  return <span lang={lang} className={className}>{text}</span>;
}

/** Dado vindo do email (nome do plano, assunto): em citação, para não parecer tradução que faltou. */
export function EmailQuote({ text, className }: { text: string; className?: string }) {
  const tr = useTr();
  const { locale } = useLocale();
  return (
    <span className={className}>
      {tr('per the email', 'segundo o email')}: <q lang={langAttr(text, locale)} className="italic">{text}</q>
    </span>
  );
}

// ---------- nome que abre os detalhes ----------

/**
 * O nome da assinatura é o botão dos detalhes (com a seta): poupa uma linha de "ver termos" em cada item do celular.
 * Em bloco com o texto, a seta acompanha a última palavra quando o nome quebra. O nome acessível começa pelo nome
 * visível e diz o que abre.
 */
export function NameToggle({ r, open, controls, onToggle, className }: { r: SubscriptionRecord; open: boolean; controls: string; onToggle: () => void; className?: string }) {
  const tr = useTr();
  // a seta fica presa à última palavra: nunca sozinha numa linha
  const name = displayName(r);
  const cut = name.lastIndexOf(' ') + 1;
  const hover = 'group-hover:underline group-hover:decoration-line2 group-hover:underline-offset-2';
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cx('tap group -mx-1 -my-1 min-h-8 min-w-0 cursor-pointer rounded-md px-1 py-1 text-left font-medium [overflow-wrap:anywhere] pointer-fine:sm:min-h-6', className)}
    >
      {cut ? <span className={hover}>{name.slice(0, cut)}</span> : null}
      {/* inline-block: só quebra por dentro se a palavra sozinha não couber */}
      <span className="inline-block">
        <span className={hover}>{name.slice(cut)}</span>
        <ChevronDown className={cx('ml-1 inline-block size-4 align-[-3px] text-faint transition-transform group-hover:text-muted', open && 'rotate-180')} aria-hidden />
      </span>
      <span className="sr-only">, {r.audit ? tr('see terms', 'ver termos') : tr('details', 'detalhes')}</span>
    </button>
  );
}

// ---------- links ----------

/** Link para fora vindo de dado (fonte, termos): só https; o texto quebra dentro do cartão em vez de esticar a página. */
function ManageLink({ url, children, className }: { url: string; children: ReactNode; className?: string }) {
  const tr = useTr();
  const href = safeUrl(url);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(
        // alvo de 32 px no celular e 24 no desktop sem mudar o desenho: o padding fica dentro do link
        'tap inline-flex min-h-8 min-w-0 items-center gap-1 text-xs text-muted underline decoration-line2 underline-offset-2 transition-colors [overflow-wrap:anywhere] hover:text-ink hover:decoration-faint pointer-fine:sm:min-h-6',
        className,
      )}
    >
      <span className="min-w-0">{children}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">{tr(' (opens in a new tab)', ' (abre em nova aba)')}</span>
    </a>
  );
}

/**
 * Onde gerenciar ou cancelar. O link pode ter vindo de um email ou da pesquisa da IA (texto de terceiros):
 * o host fica sempre à vista e, fora do site conhecido do serviço, ganha "não verificado".
 */
export function manageLinkOf(r: SubscriptionRecord): { href: string; host: string; verified: boolean } | null {
  const href = safeUrl(r.manageUrl);
  if (!href) return null;
  // o motor marca false quando o link veio do email ou da IA e o host não é um site conhecido do serviço
  return { href, host: urlHost(href), verified: r.manageUrlVerified !== false };
}

export function CancelLink({ r, button, className }: { r: SubscriptionRecord; button?: boolean; className?: string }) {
  const tr = useTr();
  const link = manageLinkOf(r);
  if (!link) return null;
  return (
    <span className={cx('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        className={button
          ? 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line2 bg-panel px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-faint hover:bg-panel2 pointer-fine:sm:min-h-9 pointer-fine:sm:text-xs'
          : 'tap inline-flex min-h-8 items-center gap-1 text-xs text-muted underline decoration-line2 underline-offset-2 transition-colors hover:text-ink hover:decoration-faint pointer-fine:sm:min-h-6'}
      >
        {tr('Manage or cancel', 'Gerenciar ou cancelar')}
        <ExternalLink className="size-3 shrink-0" aria-hidden />
        <span className="sr-only">
          {tr(` at ${link.host}`, ` em ${link.host}`)}
          {link.verified ? '' : tr(', link not verified', ', link não verificado')}
          {tr(' (opens in a new tab)', ' (abre em nova aba)')}
        </span>
      </a>
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-faint [overflow-wrap:anywhere]" aria-hidden>
        <span className="min-w-0">{link.host}</span>
        {link.verified ? null : <Unverified />}
      </span>
    </span>
  );
}

// ---------- peças ----------

/** Os três avisos antes da renovação: os que já chegaram ficam preenchidos, o da janela atual na cor dela. */
export function Milestones({ r, today, className }: { r: SubscriptionRecord; today: string; className?: string }) {
  const tr = useTr();
  if (!r.nextRenewal) return null;
  const next = r.nextRenewal;
  // risco alto ganha o aviso de 30 dias
  const days = r.risk === 'high' ? HIGH_RISK_ALERT_DAYS : ALERT_DAYS;
  const marks = days.map((d) => ({ d, date: addDays(next, -d), reached: addDays(next, -d) <= today }));
  const currentIdx = marks.map((m) => m.reached).lastIndexOf(true);
  const tone = r.alert ? STAGE[r.alert].text : 'text-muted';
  return (
    <ol className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs', className)} aria-label={tr('Reminders before the renewal', 'Avisos antes da renovação')}>
      {marks.map((m, i) => (
        <li
          key={m.d}
          className={cx('inline-flex items-center gap-1.5 whitespace-nowrap', i === currentIdx ? tone : m.reached ? 'text-muted' : 'text-faint')}
        >
          <span className={cx('size-1.5 shrink-0 rounded-full', m.reached ? 'bg-current' : 'border border-current')} />
          <span className="tnum">{tr(`${m.d}\u00a0days`, `${m.d}\u00a0dias`)} · {dayMonth(m.date)}</span>
          <span className="sr-only">{m.reached ? tr(' (reached)', ' (já chegou)') : tr(' (not yet)', ' (ainda não)')}</span>
        </li>
      ))}
    </ol>
  );
}

/** Cobranças no tempo, numa régua comum a todas as linhas: dá para ver a regularidade (e o buraco). */
export function ChargeDots({ r, from, to, today }: { r: SubscriptionRecord; from: string; to: string; today: string }) {
  const tr = useTr();
  const hover = useCanHover();
  const a = Date.parse(from);
  const span = Math.max(1, Date.parse(to) - a);
  const pos = (iso: string) => `${Math.min(100, Math.max(0, ((Date.parse(iso) - a) / span) * 100))}%`;
  const showNext = r.status === 'active' && r.nextRenewal && r.nextRenewal <= to.slice(0, 10);
  const first = r.charges[0];
  const muted = r.status !== 'active';
  const n = r.charges.length;
  const range = first ? tr(` from ${dateFull(first.date)} to ${dateFull(r.lastCharge.date)}`, ` de ${dateFull(first.date)} a ${dateFull(r.lastCharge.date)}`) : '';
  return (
    <div
      className="relative h-5 w-full"
      role="img"
      aria-label={tr(`${n} ${n === 1 ? 'charge' : 'charges'} on the card${range}`, `${n} ${n === 1 ? 'cobrança' : 'cobranças'} no cartão${range}`)}
    >
      <span className="absolute inset-x-0 top-1/2 h-px bg-line2" />
      <span className="absolute top-1 bottom-1 w-px bg-faint/60" style={{ left: pos(`${today}T12:00:00Z`) }} title={hover ? tr('today', 'hoje') : undefined} />
      {r.charges.map((t) => (
        <span
          key={t.id}
          title={hover ? `${dayMonthYear(t.date)} · ${money(t.amount, t.currency)}` : undefined}
          className={cx('absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel', muted ? 'bg-faint' : 'bg-accent')}
          style={{ left: pos(t.date) }}
        />
      ))}
      {showNext ? (
        <span
          title={hover ? tr(`next renewal: ${weekdayDay(r.nextRenewal!)}`, `próxima renovação: ${weekdayDay(r.nextRenewal!)}`) : undefined}
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-panel"
          style={{ left: pos(`${r.nextRenewal}T12:00:00Z`) }}
        />
      ) : null}
    </div>
  );
}

/** Por que o painel acha que é assinatura: as frases do motor, com a fonte quando há link. */
export function SignalList({ r, hideAudit }: { r: SubscriptionRecord; hideAudit?: boolean }) {
  const tr = useTr();
  const { locale } = useLocale();
  const recent = r.charges.slice(-6).reverse();
  const n = r.charges.length;
  // com o modelo de renovação à vista, os achados da auditoria não se repetem aqui
  const signals = hideAudit ? r.signals.filter((s) => s.kind !== 'audit') : r.signals;
  return (
    <div className="space-y-3">
      {/* no celular, rótulo em cima do valor: duas colunas deixariam ~150 px para a frase */}
      <ul className="space-y-2 sm:space-y-1.5">
        {signals.map((s, i) => (
          <li key={i} className="flex flex-col sm:flex-row sm:gap-2">
            <span className="shrink-0 text-faint sm:w-24">{pick(locale, ...SIGNAL_LABEL[s.kind])}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <Foreign text={s.detail} />
              {s.source || s.sourceText ? (
                <>
                  {' '}
                  <span className="inline-flex flex-wrap items-center gap-x-1.5 align-middle">
                    <SourceRef source={s.source ?? s.sourceText!} label />
                    {s.source && s.sourceVerified === false ? <Unverified /> : null}
                  </span>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {recent.length ? (
        <div>
          <div className="mb-1 text-faint">
            {n > recent.length
              ? tr(`Last ${recent.length} of ${n} charges`, `Últimas ${recent.length} de ${n} cobranças`)
              : n === 1 ? tr('The charge', 'A cobrança') : tr(`The ${n} charges`, `As ${n} cobranças`)}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {recent.map((t) => (
              <li key={t.id} className="tnum rounded-md border border-line px-2 py-0.5 text-xs text-muted">
                {dayMonthYear(t.date)} · {money(t.amount, t.currency)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Link que veio da IA para fora do site conhecido do serviço: o host já está à vista, e o aviso diz para conferir. */
function Unverified() {
  const tr = useTr();
  const hover = useCanHover();
  return (
    <span
      className="whitespace-nowrap text-xs text-warn"
      title={hover ? tr(
        "This link came from an email or from research, and isn't on the service's known site. Check the address before signing in.",
        'Este link veio de um email ou da pesquisa e não é do site conhecido do serviço. Confira o endereço antes de entrar com a sua senha.',
      ) : undefined}
    >
      <ShieldAlert className="inline size-3 align-[-2px]" aria-hidden /> {tr('not verified', 'não verificado')}
    </span>
  );
}

/**
 * Fonte: link pelo nome do site; email ("email: <assunto>, <data>") como citação. Com `known` (os hosts da base pública,
 * nas fontes da auditoria), o link fora deles leva "não verificado" à vista, como o de gerenciar.
 */
function SourceRef({ source, label, known }: { source: string; label?: boolean; known?: readonly string[] }) {
  const tr = useTr();
  const host = urlHost(source);
  if (host) {
    const link = <ManageLink url={source} className="text-faint">{label ? `${tr('source', 'fonte')}: ` : ''}{host}</ManageLink>;
    if (!known || isKnownHost(source, known)) return link;
    return <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">{link}<Unverified /></span>;
  }
  const email = source.match(/^email:\s*(.+)$/i);
  return <span className="min-w-0 text-xs text-faint">{email ? <EmailQuote text={email[1]} /> : <Foreign text={source} />}</span>;
}

// "·" preso ao item de antes: a linha nunca começa com ele
const DOT = '\u00a0· ';

/** O valor principal da linha em texto (o mesmo do TxAmount): moeda local quando a compra foi nela. */
const amountText = (t: SubscriptionRecord['lastCharge']) => (t.currency !== 'USD' ? money(Math.abs(t.amount), t.currency) : usd(Math.abs(t.amountUsd)));

/**
 * Abaixo de 360 px o valor sai do cabeçalho e abre a linha de metadados: o título usa a largura toda (antes, 3 a 4
 * linhas espremidas). Mesmo padrão do AlertRow, que fica ao lado na lista do Início.
 */
function RowAmount({ t }: { t: SubscriptionRecord['lastCharge'] }) {
  return <div className="max-[359px]:hidden"><TxAmount t={t} compact /></div>;
}
function MetaAmount({ t }: { t: SubscriptionRecord['lastCharge'] }) {
  return <span className="tnum font-semibold whitespace-nowrap text-ink min-[360px]:hidden">{amountText(t)}{DOT}</span>;
}

/** Renovação na lista "Precisa de atenção" da Home, no formato dos alertas de lá. */
export function RenewalAlertRow({ r, onOpen }: { r: SubscriptionRecord; onOpen: () => void }) {
  const tr = useTr();
  const { locale } = useLocale();
  const st = STAGE[r.alert ?? 'd14'];
  const Icon = st.icon;
  const cancel = plansToCancel(r);
  return (
    <div className="rounded-xl border border-line bg-panel2/40 p-3.5">
      <div className="flex items-start gap-2.5">
        <Icon className={cx('mt-0.5 size-4 shrink-0', st.text)} />
        <span className="min-w-0 flex-1 text-sm font-medium">
          {displayName(r)} {r.daysUntil !== null ? renewalIn(r.daysUntil, locale) : ''}
        </span>
        <RowAmount t={r.lastCharge} />
      </div>
      <div className="mt-1 pl-6.5 text-xs text-faint">
        <MetaAmount t={r.lastCharge} />
        {cycleText(r, locale)}{r.nextRenewal ? <>{DOT}<span className="whitespace-nowrap">{weekdayDay(r.nextRenewal)}</span></> : ''}{DOT}
        {cancel ? tr("you said you'll cancel", 'você disse que vai cancelar') : tr('keep or cancel?', 'vai manter ou cancelar?')}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-6.5">
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={r.alert === 'd2' ? 'bad' : r.alert === 'd14' || r.alert === 'd30' ? 'info' : 'warn'}>
            {cancel ? tr('cancel before the date', 'cancelar antes da data') : stageLabel(r.alert ?? 'd14', locale)}
          </Badge>
          {r.risk === 'high' ? <Badge tone="warn">{tr('check before it renews', 'confira antes de renovar')}</Badge> : null}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className={rowActionClass}
        >
          {cancel ? tr('View', 'Ver') : tr('Answer', 'Responder')} <ArrowRight className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ---------- risco e modelo de renovação ----------

// risco alto em âmbar: é aviso para conferir antes de renovar, não alarme
const RISK: Record<RiskLevel, { label: Pair; tone: 'warn' | 'info' | 'neutral' }> = {
  high: { label: ['high risk', 'risco alto'], tone: 'warn' },
  medium: { label: ['medium risk', 'risco médio'], tone: 'info' },
  low: { label: ['low risk', 'risco baixo'], tone: 'neutral' },
  unknown: { label: ['risk unknown', 'risco desconhecido'], tone: 'neutral' },
};

/**
 * Risco de cobrança sem perceber. "Conferido" fica só para a ação da pessoa: a origem do risco vai no tooltip
 * (a leitura dos termos pela IA da pessoa, com a data) e, na estimativa, no próprio selo.
 */
export function RiskBadge({ r }: { r: SubscriptionRecord }) {
  const tr = useTr();
  const { locale } = useLocale();
  const hover = useCanHover();
  const risk = RISK[r.risk];
  const reviewed = r.audit?.checkedAt ? dayMonth(r.audit.checkedAt) : '';
  const title = r.riskSource === 'audit'
    ? tr(`Risk of a surprise charge · per your AI's reading of the terms (${reviewed})`, `Risco de cobrança sem perceber · pela leitura da sua IA dos termos (${reviewed})`)
    : r.riskSource === 'heuristic'
      ? tr('Estimated: yearly plan of US$ 100 or more with no renewal reminder in your email', 'Estimado: plano anual de US$ 100 ou mais sem aviso de renovação no seu email')
      : tr('Renewal terms not reviewed yet', 'Regras de renovação ainda não revisadas');
  return (
    <span title={hover ? title : undefined}>
      <Badge tone={risk.tone}>{pick(locale, ...risk.label)}{r.riskSource === 'heuristic' ? ` · ${tr('estimated', 'estimado')}` : ''}</Badge>
    </span>
  );
}

/**
 * Nome para a tela. A segunda assinatura do mesmo lugar vem do motor com o valor no nome ("YouTube · R$ 100,00");
 * quando há plano, o plano diferencia e o valor sai (ele já aparece ao lado).
 */
export const displayName = (r: SubscriptionRecord) => (r.plan ? r.name.split(' · ')[0] : r.name);

/** Motivos do risco no idioma da tela; na estimativa, a regra que disparou. */
export function riskReasons(r: SubscriptionRecord, locale: Locale): string[] {
  if (r.audit) return r.audit.riskReasons.map((x) => localized(x, locale)?.trim()).filter((x): x is string => Boolean(x));
  if (r.riskSource === 'heuristic') {
    return [pick(locale, 'Yearly plan of US$ 100 or more with no renewal reminder in your email', 'Plano anual de US$ 100 ou mais sem aviso de renovação no seu email')];
  }
  return [];
}

/** O modelo de renovação inteiro: o que a auditoria leu nos termos e no email, e o que ela não conseguiu confirmar. */
export function RenewalTerms({ r, className }: { r: SubscriptionRecord; className?: string }) {
  const tr = useTr();
  const { locale } = useLocale();
  const a = r.audit;
  const unconfirmed = <span className="text-warn">{tr('not confirmed', 'não confirmado')}</span>;
  if (!a) {
    return (
      <div className={className}>
        <div className="mb-1 font-medium text-ink">{tr('Renewal terms', 'Regras de renovação')}</div>
        <p>
          {r.riskSource === 'heuristic'
            ? tr(
              "Not reviewed yet. Treated as high risk because it's a yearly plan of US$ 100 or more and no renewal reminder showed up in your email.",
              'Ainda não revisadas. Tratado como risco alto porque é um plano anual de US$ 100 ou mais e nenhum aviso de renovação apareceu no seu email.',
            )
            : tr('Not reviewed yet.', 'Ainda não revisadas.')}
        </p>
      </div>
    );
  }
  const deadline = localized(a.cancelDeadline, locale);
  const refundNote = localized(a.refundNote, locale);
  const price = localized(a.priceChangeAtRenewal, locale);
  const reasons = riskReasons(r, locale);
  const rows: [string, ReactNode][] = [
    [tr('Renews on its own', 'Renova sozinho'), a.autoRenew === 'yes' ? tr('yes, unless you cancel', 'sim, se você não cancelar') : a.autoRenew === 'no' ? tr('no', 'não') : unconfirmed],
    [
      tr('Reminder before renewing', 'Aviso antes de renovar'),
      a.noticeBeforeRenewal === 'yes'
        ? (a.noticeDays ? tr(`yes, ${a.noticeDays} days before`, `sim, ${a.noticeDays} dias antes`) : tr('yes', 'sim'))
        : a.noticeBeforeRenewal === 'no' ? <span className="text-warn">{tr('no', 'não')}</span> : unconfirmed,
    ],
    [tr('Cancel by', 'Prazo para cancelar'), deadline ? <Foreign text={deadline} /> : unconfirmed],
    [
      tr('Refund', 'Reembolso'),
      <>
        {a.refundWindowDays === undefined ? unconfirmed
          : a.refundWindowDays > 0 ? tr(`up to ${a.refundWindowDays} days after renewal`, `até ${a.refundWindowDays} dias depois da renovação`)
          : <span className="text-warn">{tr('none, per your AI', 'não há, segundo a sua IA')}</span>}
        {refundNote ? <span className="text-faint"> — <Foreign text={refundNote} /></span> : null}
      </>,
    ],
    [tr('Price at renewal', 'Preço na renovação'), price ? <Foreign text={price} /> : unconfirmed],
  ];
  const where = a.checked.map((c) => (c === 'website' ? tr('website', 'site') : 'email'));
  // o que foi lido, sem "confirmado só em parte": a linha "não confirmado" de cada item já diz o que faltou
  const read = where.length === 1 ? tr(` (${where[0]} only)`, ` (só ${where[0] === 'email' ? 'o email' : 'o site'})`) : where.length ? ` (${where.join(' / ')})` : '';
  return (
    <div className={className}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{tr('Renewal terms, per your AI', 'Regras de renovação, pela sua IA')}</span>
        <RiskBadge r={r} />
      </div>
      {/* no celular, rótulo em cima do valor: duas colunas deixariam ~110 px para o texto */}
      <dl className="grid grid-cols-1 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:gap-x-3 sm:gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="mt-1.5 text-faint first:mt-0 sm:mt-0">{k}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {reasons.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4">
          {reasons.map((x) => <li key={x}><Foreign text={x} /></li>)}
        </ul>
      ) : null}
      {/* quem leu os termos foi a IA da pessoa, não o painel: a linha diz isso e pede para conferir na fonte */}
      <div className="mt-2 text-faint">
        {a.checkedAt ? tr(`Read by your AI on ${dayMonthYear(a.checkedAt)}`, `Lido pela sua IA em ${dayMonthYear(a.checkedAt)}`) : tr('Read by your AI', 'Lido pela sua IA')}
        {read}
        {tr(' · check the terms before relying on these dates', ' · confira nos termos antes de contar com essas datas')}
      </div>
      {a.sources.length ? (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0 [overflow-wrap:anywhere]">
          {a.sources.map((s) => <li key={s} className="min-w-0"><SourceRef source={s} known={r.verifiedHosts ?? []} /></li>)}
        </ul>
      ) : null}
    </div>
  );
}

// ---------- acabou de renovar ----------

export function renewedAgo(j: JustRenewed, locale: Locale): string {
  if (j.pending) return pick(locale, 'Renewal still pending', 'Renovação ainda a confirmar');
  if (j.daysAgo <= 0) return pick(locale, 'Renewed today', 'Renovou hoje');
  if (j.daysAgo === 1) return pick(locale, 'Renewed yesterday', 'Renovou ontem');
  return pick(locale, `Renewed ${j.daysAgo}\u00a0days ago`, `Renovou há ${j.daysAgo}\u00a0dias`);
}

/** O que dá para fazer sobre o reembolso agora, com o tom do aviso. */
export function refundStatus(j: JustRenewed, locale: Locale): { text: string; tone: 'good' | 'warn' | 'neutral' } {
  const st = refundStatusText(j, locale);
  return { ...st, text: nb(st.text) };
}

// o prazo vem da leitura dos termos pela IA da pessoa (renewal-audit.json), que pode ter errado ou sido enganada: o
// texto diz de onde veio e nunca usa o verde de "garantido"
function refundStatusText(j: JustRenewed, locale: Locale): { text: string; tone: 'good' | 'warn' | 'neutral' } {
  const left = j.refundDaysLeft;
  if (left === null) {
    return {
      tone: 'warn',
      text: j.pending
        ? pick(locale, "Per your AI's reading, the terms don't offer refunds — ask for a courtesy refund, ideally while the charge is still pending.", 'Pela leitura da sua IA, os termos não preveem reembolso — peça um reembolso de cortesia, de preferência enquanto a cobrança está a confirmar.')
        : pick(locale, "Per your AI's reading, the terms don't offer refunds — you can still ask for a courtesy refund.", 'Pela leitura da sua IA, os termos não preveem reembolso — ainda dá para pedir um reembolso de cortesia.'),
    };
  }
  if (left === undefined) {
    return {
      tone: j.pending ? 'warn' : 'neutral',
      text: pick(locale, "Refund policy not checked: ask the service, while it's recent.", 'Política de reembolso não conferida: pergunte ao serviço enquanto é recente.'),
    };
  }
  if (left < 0) {
    return {
      tone: 'neutral',
      text: pick(locale,
        `Per your AI's reading of the terms, the refund window closed ${-left} ${left === -1 ? 'day' : 'days'} ago. Check the terms: you can still ask.`,
        `Pela leitura da sua IA dos termos, o prazo de reembolso acabou há ${-left} ${left === -1 ? 'dia' : 'dias'}. Confira nos termos: ainda dá para pedir.`),
    };
  }
  const until = dayMonth(addDays(j.date, j.refundWindowDays ?? 0));
  if (left === 0) {
    return {
      tone: 'warn',
      text: pick(locale, `Last day to ask for a refund (${until}), per your AI's reading of the terms. Check them.`, `Último dia para pedir reembolso (${until}), pela leitura da sua IA dos termos. Confira.`),
    };
  }
  return {
    tone: left <= 3 ? 'warn' : 'neutral',
    text: pick(locale,
      `${left} ${left === 1 ? 'day' : 'days'} left to ask for a refund (until ${until}), per your AI's reading of the terms. Check them.`,
      `${left === 1 ? 'Falta 1 dia' : `Faltam ${left} dias`} para pedir reembolso (até ${until}), pela leitura da sua IA dos termos. Confira.`),
  };
}

// o pedido sai sempre em inglês, nos dois idiomas da tela: o suporte desses serviços costuma atender em inglês
const enMoney = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'code' }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
};
const enDate = (day: string) => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(noon(day)));

/** Texto curto e educado para o suporte; o painel só copia, nunca envia. */
function refundRequestText(r: SubscriptionRecord): string {
  const j = r.justRenewed;
  const t = r.lastCharge;
  const date = enDate(j?.date ?? t.date);
  // a segunda assinatura do mesmo lugar leva o valor no nome ("YouTube · R$ 100,00"): para o suporte, só o serviço
  const service = r.name.split(' · ')[0];
  const raised = j?.priceChanged && j.previousAmount !== undefined && j.previousCurrency === t.currency && t.amount > j.previousAmount;
  return [
    `Subject: Refund request for my ${service} renewal on ${date}`,
    '',
    'Hello,',
    '',
    `My ${service} subscription renewed automatically on ${date} and I was charged ${enMoney(t.amount, t.currency)}${raised ? `, up from ${enMoney(j!.previousAmount!, j!.previousCurrency!)} last time` : ''}.`,
    "I did not intend to renew, I haven't used the service since the renewal, and I have already turned off auto-renewal.",
    j?.pending
      ? 'The charge is still pending on my card. Could you please cancel this renewal and refund the charge, or void it before it settles?'
      : 'Could you please cancel this renewal and refund the charge?',
    '',
    'Thank you,',
  ].join('\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // sem permissão de área de transferência: o caminho antigo ainda funciona na maioria dos navegadores
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Copia o pedido de reembolso e mostra o texto antes; nada sai daqui. */
export function CopyRefundButton({ r }: { r: SubscriptionRecord }) {
  const tr = useTr();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [show, setShow] = useState(false);
  const text = refundRequestText(r);
  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    if (!ok) setShow(true);
    else setTimeout(() => setState('idle'), 2500);
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium whitespace-nowrap text-accent-ink transition hover:brightness-110 pointer-fine:sm:min-h-9 pointer-fine:sm:text-xs"
        >
          {state === 'copied' ? <Check className="size-3.5 shrink-0" aria-hidden /> : <Copy className="size-3.5 shrink-0" aria-hidden />}
          {state === 'copied'
            ? tr('Copied', 'Copiado')
            : <>
              {/* a 320 px o rótulo inteiro quebraria em 2 linhas; a caixa em volta já diz que é o reembolso */}
              <span className="max-[359px]:hidden">{tr('Copy refund request', 'Copiar pedido de reembolso')}</span>
              <span className="min-[360px]:hidden">{tr('Copy request', 'Copiar pedido')}</span>
            </>}
        </button>
        <button
          type="button"
          aria-expanded={show}
          onClick={() => setShow((v) => !v)}
          className="tap min-h-8 cursor-pointer text-xs text-faint underline decoration-dotted underline-offset-2 hover:text-muted pointer-fine:sm:min-h-6"
        >
          {show ? tr('hide text', 'esconder texto') : tr('see text', 'ver texto')}
        </button>
        <span role="status" className="text-xs text-faint">
          {state === 'failed' ? tr("Couldn't copy: select the text below.", 'Não deu para copiar: selecione o texto abaixo.') : state === 'copied' ? <span className="sr-only">{tr('Refund request copied.', 'Pedido de reembolso copiado.')}</span> : ''}
        </span>
      </div>
      {show ? (
        <pre lang="en" className="mt-2 overflow-x-auto rounded-lg border border-line bg-bg/60 p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap text-muted select-all">{text}</pre>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed text-faint">
        {tr(
          "In English, since support usually answers in English. It says you already turned off auto-renewal: do that first. Nothing is sent from here.",
          'Em inglês, porque o suporte costuma atender em inglês. O texto diz que você já desligou a renovação automática: faça isso antes. Nada é enviado daqui.',
        )}
      </p>
    </div>
  );
}

/**
 * Renovação recente na lista "Precisa de atenção" da Home: um convite a conferir, não um alarme. `next`: a mesma
 * assinatura também espera a pergunta da próxima renovação (o item conta 2); ela aparece numa linha do cartão.
 */
export function RenewalCheckAlertRow({ r, check, next, onOpen }: { r: SubscriptionRecord; check?: RenewalCheck; next?: 'answer' | 'cancel'; onOpen: () => void }) {
  const tr = useTr();
  const { locale } = useLocale();
  const j = r.justRenewed!;
  const t = r.lastCharge;
  const prev = j.priceChanged && j.previousAmount !== undefined && j.previousCurrency ? `${money(j.previousAmount, j.previousCurrency)}\u00a0→ ${money(t.amount, t.currency)}` : '';
  // aumento de preço em gold (o guia da ether.fi); queda ou troca de moeda fica neutra
  const raised = j.priceChanged && j.previousAmount !== undefined && j.previousCurrency === t.currency && t.amount > j.previousAmount;
  const unexpected = check === 'unexpected';
  return (
    <div className="rounded-xl border border-line bg-panel2/40 p-3.5">
      <div className="flex items-start gap-2.5">
        <RotateCcw className={cx('mt-0.5 size-4 shrink-0', unexpected ? 'text-warn' : 'text-info')} />
        <span className="min-w-0 flex-1 text-sm font-medium">{displayName(r)}{DOT}{renewedAgo(j, locale).toLowerCase()}</span>
        <RowAmount t={t} />
      </div>
      <div className="mt-1 pl-6.5 text-xs text-faint">
        <MetaAmount t={t} />
        {cycleText(r, locale)}{DOT}<span className="whitespace-nowrap">{weekdayDay(j.date)}</span>{prev ? <>{DOT}<span className={cx('whitespace-nowrap', raised && 'text-warn')}>{prev}</span></> : ''}
      </div>
      {next ? (
        <div className={cx('mt-1 pl-6.5 text-xs', r.alert === 'd2' ? 'text-bad' : 'text-muted')}>
          {r.daysUntil !== null
            ? tr(`+ next renewal ${inDays(r.daysUntil, locale)}`, `+ próxima renovação ${inDays(r.daysUntil, locale)}`)
            : tr('+ next renewal', '+ próxima renovação')}
          {': '}
          {next === 'cancel' ? tr("you said you'll cancel", 'você disse que vai cancelar') : tr('keep or cancel?', 'vai manter ou cancelar?')}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-6.5">
        <Badge tone={unexpected ? 'warn' : 'info'}>
          {unexpected ? tr("you didn't expect it", 'você não esperava') : tr('check this renewal', 'confira esta renovação')}
        </Badge>
        <button
          type="button"
          onClick={onOpen}
          className={rowActionClass}
        >
          {unexpected ? tr('See options', 'Ver opções') : tr('Check', 'Conferir')} <ArrowRight className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}
