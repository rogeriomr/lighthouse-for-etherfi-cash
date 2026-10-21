// "Para fazer" de Assinaturas: as perguntas "vai manter?" em lista rápida (uma linha cada), o item completo só para
// "você esperava?" e o caminho do reembolso. Cada resposta registra, mostra um retorno no lugar (com desfazer),
// anuncia numa região de status e leva o foco para a próxima pergunta do mesmo cartão ou para o próximo item.
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronDown, CircleCheck, Undo2 } from 'lucide-react';
import type { SubscriptionRecord } from '../lib/subscriptionTypes';
import { money, num, pctSigned } from '../lib/format';
import { localized, type Locale } from '../lib/locale';
import { txInstant } from '../lib/enrich';
import { cx } from '../lib/cx';
import {
  decide, forget, markCancelled, plansToCancel, restore, setRenewalCheck, snapshotOf, useSubscriptions,
  type AnswerSnapshot, type Checks, type Decisions,
} from '../state/decisions';
import { attentionSections, questionCounts, questionsSummary, useAttentionDetail, waitingLabel, type AttentionItem } from '../state/attention';
import { useLocale, useTr } from '../state/locale';
import { Badge } from './ui';
import { TxAmount } from './money';
import {
  answerBadge, CancelLink, confidenceOf, CopyRefundButton, cycleSourceLabel, cycleText, dayMonth, dayMonthYear, displayName,
  EmailQuote, Foreign, inDays, manageLinkOf, Milestones, NameToggle, refundStatus, renewalIn, renewedAgo, RenewalTerms, RiskBadge,
  SignalList, weekdayDay,
} from './subscriptionParts';

/** Vermelho só para o que é urgente: renova em até 2 dias (ou a data passou) e ainda não foi cancelado. */
const isUrgent = (r: SubscriptionRecord, decisions: Decisions) =>
  (r.alert === 'd2' || r.alert === 'due' || r.alert === 'overdue') && !(plansToCancel(r) && decisions[r.key]?.done);

/** Uma assinatura com pergunta em aberto. `card`: tem a conferência da renovação recente (respondida ou não). */
interface Task {
  r: SubscriptionRecord;
  /** renovação recente ainda sem conferência, ou "não esperava" com algo a fazer */
  check: boolean;
  /** renovação em janela de aviso esperando resposta, ou "vou cancelar" ainda não feito */
  answer: boolean;
  card: boolean;
}

type Section = 'quick' | 'cards';
type Act = 'expected' | 'unexpected' | 'keep' | 'cancel' | 'done' | 'hide' | 'reopen';
/** "mudar": reabre só a conferência, só a resposta da próxima renovação, ou as duas (lista de respondidas) */
type Scope = 'check' | 'answer' | 'all';

/** A última resposta: o retorno no lugar do item (com desfazer) e o que a região de status anuncia. */
interface Last {
  key: string;
  name: string;
  act: Act;
  snap: AnswerSnapshot;
  section: Section;
  index: number;
  /** "vai manter · renova qua, 21/out" */
  label: string;
  /** frase para o leitor de tela, sem a contagem (ela entra depois do render) */
  speech: string;
}

// as perguntas de cada seção vêm do modelo do Início (attentionSections + questionCounts, lib/attentionModel): a regra
// de quantas, de que tipo e em que seção fica num lugar só; "recent" é "Renovaram há pouco", "soon" é "Renovam em breve"
const sectionSummary = (items: AttentionItem[], locale: Locale) => questionsSummary(questionCounts(items), locale, { short: true });

interface TodoCtx {
  act: (r: SubscriptionRecord, what: Act, section: Section, scope?: Scope) => void;
  decisions: Decisions;
  checks: Checks;
  today: string;
  flash: string | null;
}
const Ctx = createContext<TodoCtx | null>(null);
const useTodo = () => useContext(Ctx)!;

/**
 * Põe o elemento à vista sem deixá-lo sob o cabeçalho fixo nem sob a barra inferior do celular
 * (o foco nunca pode ficar coberto: WCAG 2.4.11).
 */
function reveal(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  // a barra inferior do celular é o nav fixo (no desktop o menu da lateral não cobre nada)
  const bar = [...document.querySelectorAll<HTMLElement>('nav')].find((n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().height > 0);
  const navTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
  const header = document.querySelector<HTMLElement>('main > header');
  // no celular o cabeçalho some ao rolar para baixo e volta ao rolar para cima: reserva a altura dele mesmo escondido,
  // para ele não reaparecer por cima do item que acabou de receber o foco
  const top = header && /sticky|fixed/.test(getComputedStyle(header).position)
    ? Math.max(header.getBoundingClientRect().bottom, header.offsetHeight)
    : 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gap = 16;
  let dy = 0;
  if (r.bottom > navTop - gap) dy = r.bottom - navTop + gap;
  if (r.top - dy < top + gap) dy = r.top - top - gap;
  if (dy) window.scrollBy({ top: dy, behavior: reduce ? 'auto' : 'smooth' });
}

/** O primeiro controle da primeira pergunta em aberto de uma tarefa. */
const firstControl = (task: Element) =>
  task.querySelector<HTMLElement>('[data-q] :is(button, a[href])') ?? (task as HTMLElement);

export function TodoPanel({ today, flash }: { today: string; flash: string | null }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { attention, items } = useAttentionDetail();
  const { report, decisions, checks, pending, toCheck } = useSubscriptions();
  const [last, setLast] = useState<Last | null>(null);
  const [live, setLive] = useState('');
  const focusReq = useRef<{ key: string; self: boolean; after: string[]; speech: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // as duas perguntas da mesma assinatura ficam juntas, no mesmo cartão
  const { quick, cards } = useMemo(() => {
    const checkable = new Map((report.justRenewed ?? []).map((r, i) => [r.key, i]));
    const byKey = new Map<string, Task>();
    for (const r of toCheck) byKey.set(r.key, { r, check: true, answer: false, card: true });
    for (const r of pending) {
      const t = byKey.get(r.key);
      if (t) t.answer = true;
      // conferência já respondida ("sim, esperava") com a próxima renovação em aviso: continua no cartão dela
      else byKey.set(r.key, { r, check: false, answer: true, card: checkable.has(r.key) && Boolean(r.justRenewed && checks[r.justRenewed.chargeId]) });
    }
    const all = [...byKey.values()];
    // ordem estável enquanto a pessoa responde: urgência da renovação na lista rápida, cobrança mais recente nos cartões
    const quick = all.filter((t) => !t.card).sort((a, b) => pending.indexOf(a.r) - pending.indexOf(b.r));
    const cards = all.filter((t) => t.card).sort((a, b) => (checkable.get(a.r.key) ?? 0) - (checkable.get(b.r.key) ?? 0));
    return { quick, cards };
  }, [report, toCheck, pending, checks]);

  const order = useMemo(() => [...quick, ...cards].map((t) => t.r.key), [quick, cards]);
  const keys = useMemo(() => new Set(order), [order]);
  // o número da barra e do Início, sem os alertas de compra (que ficam no Início): o que esta aba resolve
  const here = attention.renewals;

  // respondidas: avisos com resposta e renovações recentes já conferidas
  const answered = useMemo(() => {
    const list: SubscriptionRecord[] = [];
    for (const r of report.alerts) if (!keys.has(r.key) && r.status === 'active' && r.decision && !r.needsAnswer) list.push(r);
    for (const r of report.justRenewed ?? []) {
      if (r.status === 'active' && r.justRenewed && checks[r.justRenewed.chargeId] && !keys.has(r.key) && !list.includes(r)) list.push(r);
    }
    return list;
  }, [report, checks, keys]);

  const act = (r: SubscriptionRecord, what: Act, section: Section, scope: Scope = 'all') => {
    const name = displayName(r);
    const snap = snapshotOf(r);
    const index = (section === 'quick' ? quick : cards).findIndex((t) => t.r.key === r.key);
    const i = order.indexOf(r.key);
    const after = i < 0 ? order : [...order.slice(i + 1), ...order.slice(0, i)];
    const next = r.nextRenewal;
    let label = '';
    let speech = '';
    let self = false;
    switch (what) {
      case 'expected':
        setRenewalCheck(r.justRenewed!.chargeId, 'expected');
        label = tr('you expected it', 'você esperava');
        if (next) label += tr(` · next renewal ${weekdayDay(next)}`, ` · próxima renovação ${weekdayDay(next)}`);
        speech = tr(`Saved: ${name}, renewal expected.`, `Registrado: ${name}, renovação esperada.`);
        self = true;
        break;
      case 'unexpected': {
        setRenewalCheck(r.justRenewed!.chargeId, 'unexpected');
        speech = tr(`Saved: you didn't expect the ${name} renewal. ${refundStatus(r.justRenewed!, locale).text}`, `Registrado: você não esperava a renovação de ${name}. ${refundStatus(r.justRenewed!, locale).text}`);
        self = true;
        break;
      }
      case 'keep':
        decide(r, 'keep');
        label = tr('keeping', 'vai manter');
        if (next) label += tr(` · renews ${weekdayDay(next)}`, ` · renova ${weekdayDay(next)}`);
        speech = tr(`Saved: ${name}, keeping.`, `Registrado: ${name}, vai manter.`);
        self = true;
        break;
      case 'cancel':
        decide(r, 'cancel');
        speech = next
          ? tr(`Saved: you'll cancel ${name} before ${weekdayDay(next)}. It stays here until you mark it canceled.`, `Registrado: você vai cancelar ${name} antes de ${weekdayDay(next)}. Fica aqui até você marcar que cancelou.`)
          : tr(`Saved: you'll cancel ${name}.`, `Registrado: você vai cancelar ${name}.`);
        self = true;
        break;
      case 'done':
        markCancelled(r.key);
        label = tr('you canceled · left the reminders file', 'você cancelou · saiu do arquivo de lembretes');
        speech = tr(`Saved: ${name} canceled.`, `Registrado: ${name} cancelada.`);
        break;
      case 'hide':
        decide(r, 'not_subscription');
        label = tr('not a subscription · it\'s under "Not a subscription" below', 'não é assinatura · está em "Não é assinatura", lá embaixo');
        speech = tr(`${name} was removed from the reminders.`, `${name} saiu dos avisos.`);
        break;
      case 'reopen':
        // "mudar": apaga a resposta e a pergunta volta, no mesmo lugar
        if (scope !== 'check' && r.decision && !r.needsAnswer) forget(r.key);
        if (scope !== 'answer' && r.justRenewed && checks[r.justRenewed.chargeId]) setRenewalCheck(r.justRenewed.chargeId, null);
        speech = tr(`Reopened: ${name}.`, `Reaberta: ${name}.`);
        self = true;
        break;
    }
    if (what !== 'reopen') setLast({ key: r.key, name, act: what, snap, section, index: Math.max(0, index), label, speech });
    focusReq.current = { key: r.key, self, after, speech };
  };

  const undo = () => {
    if (!last) return;
    restore(last.snap);
    focusReq.current = { key: last.key, self: true, after: [], speech: tr(`Undone: ${last.name}.`, `Desfeito: ${last.name}.`) };
    setLast(null);
  };

  // depois de cada resposta: foco no lugar certo e o anúncio com o que sobrou. Toda resposta grava uma das duas
  // listas (decisions/checks) ou mexe no retorno (last): o efeito roda depois desse render e consome o pedido uma vez
  useEffect(() => {
    const f = focusReq.current;
    if (!f) return;
    focusReq.current = null;
    const root = listRef.current;
    const task = (key: string) => root?.querySelector(`[data-task="${CSS.escape(key)}"]`) ?? null;
    let el: HTMLElement | null = null;
    const own = f.self ? task(f.key) : null;
    if (own) el = firstControl(own);
    for (const k of f.after) {
      if (el) break;
      const t = task(k);
      if (t) el = firstControl(t);
    }
    el ??= headingRef.current;
    if (el) {
      el.focus({ preventScroll: true });
      reveal(el);
    }
    const rest = here === 0
      ? tr('Nothing else waiting on you here.', 'Nada mais esperando você aqui.')
      : `${waitingLabel(here, locale)}${tr(' here.', ' aqui.')}`;
    // o mesmo texto duas vezes seguidas não é reanunciado: o espaço invisível muda a cada vez
    setLive((prev) => `${f.speech} ${rest}${prev.endsWith('\u200b') ? '' : '\u200b'}`);
  }, [decisions, checks, last, here, locale, tr]);

  const ctx: TodoCtx = { act, decisions, checks, today, flash };
  const ghost = (section: Section, items: Task[]) => {
    const list: (Task | null)[] = [...items];
    if (last && last.section === section && !keys.has(last.key)) list.splice(Math.min(last.index, list.length), 0, null);
    return list;
  };
  const quickList = ghost('quick', quick);
  const cardList = ghost('cards', cards);
  const sections = attentionSections(items);
  const quickQ = sectionSummary(sections.soon, locale);
  const cardQ = sectionSummary(sections.recent, locale);
  const nextUp = report.upcoming.find((r) => !keys.has(r.key));
  const alertsLink = attention.alerts ? (
    <a href="#/spending?item=alerts" className="tap inline-flex min-h-8 items-center whitespace-nowrap pointer-fine:sm:min-h-6 text-muted underline decoration-line2 underline-offset-2 hover:text-ink">
      {tr(`${num(attention.alerts, 0)}\u00a0${attention.alerts === 1 ? 'alert' : 'alerts'} in Spending\u00a0→`, `${num(attention.alerts, 0)}\u00a0${attention.alerts === 1 ? 'alerta' : 'alertas'} em Gastos\u00a0→`)}
    </a>
  ) : null;

  return (
    <Ctx.Provider value={ctx}>
      {/* abaixo de 360 px, menos borda interna: sobra largura para o texto das respostas e do reembolso */}
      <section className="panel p-4 max-[359px]:px-3 sm:p-5" aria-labelledby="todo-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="todo-title" ref={headingRef} tabIndex={-1} className="text-[13px] font-medium uppercase tracking-[0.14em] text-muted">
            {tr('To do', 'Para fazer')}
          </h2>
          {here || attention.alerts ? (
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-faint">
              <span className="tnum">
                {attention.alerts ? tr(`${num(here, 0)}\u00a0here`, `${num(here, 0)}\u00a0aqui`) : waitingLabel(here, locale)}
              </span>
              {alertsLink ? <><span aria-hidden>·</span>{alertsLink}</> : null}
            </p>
          ) : null}
        </div>
        <p role="status" className="sr-only">{live}</p>

        <div ref={listRef} className="space-y-5">
          {quickList.length ? (
            <TaskGroup title={tr('Renewing soon', 'Renovam em breve')} summary={quickQ}>
              <ul className="@container divide-y divide-line rounded-xl border border-line">
                {quickList.map((t) => t ? <QuickRow key={t.r.key} t={t} /> : <Ghost key={`ghost-${last!.key}`} last={last!} onUndo={undo} />)}
              </ul>
            </TaskGroup>
          ) : null}
          {cardList.length ? (
            <TaskGroup title={tr('Just renewed', 'Renovaram há pouco')} summary={cardQ}>
              <ul className="@container divide-y divide-line rounded-xl border border-line">
                {cardList.map((t) => t ? <CheckRow key={t.r.key} t={t} /> : <Ghost key={`ghost-${last!.key}`} last={last!} onUndo={undo} />)}
              </ul>
            </TaskGroup>
          ) : null}
          {!quick.length && !cards.length ? (
            <div className="flex items-start gap-3 rounded-xl border border-line bg-panel2/40 px-4 py-4">
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-ink">{tr('Nothing waiting on you here.', 'Nada esperando você aqui.')}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {nextUp?.nextRenewal && nextUp.daysUntil !== null
                    ? tr(
                      `Next up is ${displayName(nextUp)}: ${renewalIn(nextUp.daysUntil, locale)} (${weekdayDay(nextUp.nextRenewal)}). You'll get a heads-up here 14, 7 and 2 days before.`,
                      `A próxima é ${displayName(nextUp)}: ${renewalIn(nextUp.daysUntil, locale)} (${weekdayDay(nextUp.nextRenewal)}). O aviso aparece aqui 14, 7 e 2 dias antes.`,
                    )
                    : tr('No renewals in the next 60 days. You\'ll get a heads-up here 14, 7 and 2 days before each one.', 'Nenhuma renovação nos próximos 60 dias. O aviso aparece aqui 14, 7 e 2 dias antes de cada uma.')}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {answered.length ? <AnsweredList records={answered} /> : null}
        <p className="mt-4 text-xs text-faint">{tr('Your answers stay in this browser only.', 'Suas respostas ficam só neste navegador.')}</p>
      </section>
    </Ctx.Provider>
  );
}

function TaskGroup({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <h3 id={id} className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium text-ink">{title}</span>
        {summary ? <span className="tnum text-xs text-muted">{summary}</span> : null}
      </h3>
      {children}
    </div>
  );
}

/** Botão de resposta: os dois lados com o mesmo peso, sem cor que sugira a resposta; 44 px no celular. */
/** tone: "Vou manter" em verde e "Vou cancelar" em vermelho; as outras respostas ficam neutras */
function AnswerButton({ onClick, children, className, name, tone }: { onClick: () => void; children: ReactNode; className?: string; name?: string; tone?: 'good' | 'bad' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors max-[359px]:px-2 max-[359px]:text-[13px] pointer-fine:sm:min-h-9 pointer-fine:sm:text-xs',
        tone === 'good'
          ? 'border-good/40 bg-good/10 text-good hover:border-good/60 hover:bg-good/15'
          : tone === 'bad'
            ? 'border-bad/40 bg-bad/10 text-bad hover:border-bad/60 hover:bg-bad/15'
            : 'border-line2 bg-panel text-ink hover:border-faint hover:bg-panel2',
        className,
      )}
    >
      {children}
      {/* o nome da assinatura só para o leitor de tela: "Vou manter Netflix" em vez de seis "Vou manter" iguais */}
      {name ? <span className="sr-only"> {name}</span> : null}
    </button>
  );
}

const linkButton = 'tap inline-flex min-h-8 cursor-pointer items-center text-xs text-faint underline underline-offset-2 hover:text-muted pointer-fine:sm:min-h-6';
// os dois botões dividem a largura no celular; na linha larga, ficam do tamanho do texto
const pairButton = 'flex-1 @xl:flex-none';

/** Abre e fecha os detalhes de uma tarefa (termos, marcos, por que é assinatura). */
function useDetails() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return { open, id, toggle: () => setOpen((v) => !v) };
}

function DetailsPanel({ d, r, showMilestones, section }: { d: ReturnType<typeof useDetails>; r: SubscriptionRecord; showMilestones: boolean; section: Section }) {
  const { today } = useTodo();
  if (!d.open) return null;
  return (
    <div id={d.id} className="mt-3 rounded-lg border border-line bg-panel2/50 px-3 py-2.5 text-xs leading-relaxed text-muted">
      <TaskDetails r={r} today={today} showMilestones={showMilestones} section={section} />
    </div>
  );
}

/** "Vai manter?" numa linha: nome, data, valor e os dois botões; "vou cancelar" vira o lembrete de cancelar no lugar. */
function QuickRow({ t }: { t: Task }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { act, decisions, flash } = useTodo();
  const d = useDetails();
  const { r } = t;
  const name = displayName(r);
  const next = r.nextRenewal;
  const urgent = isUrgent(r, decisions);
  const cancel = plansToCancel(r);
  const previous = r.needsAnswer && r.decision && r.decision.choice !== 'not_subscription' ? r.decision : null;
  // previous.at é um instante real: compara com o instante da cobrança, não com a hora local de date
  const chargedAfterCancel = previous?.choice === 'cancel' && txInstant(r.lastCharge) > Date.parse(previous.at);
  // a data não quebra no meio ("sáb, 17/" / "out")
  const when = next && r.daysUntil !== null
    ? <>{renewalIn(r.daysUntil, locale)} · <span className="whitespace-nowrap">{weekdayDay(next)}</span></>
    : tr('no expected date', 'sem data prevista');
  const passed = r.alert === 'due' || r.alert === 'overdue';

  return (
    <li
      data-task={r.key}
      data-sub={r.key}
      tabIndex={-1}
      aria-label={name}
      className={cx('px-3 py-3 transition-shadow first:rounded-t-xl last:rounded-b-xl sm:px-4', flash === r.key && 'ring-2 ring-inset ring-accent')}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 @xl:grid-cols-[minmax(0,1fr)_auto_6.5rem] @xl:items-center">
        <div className="min-w-0">
          <h4 className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <NameToggle r={r} open={d.open} controls={d.id} onToggle={d.toggle} className="text-ink" />
            {r.risk === 'high' ? <RiskBadge r={r} /> : null}
          </h4>
          <div className={cx('tnum mt-0.5 text-xs', urgent ? 'font-medium text-bad' : 'text-muted')}>
            {cancel
              ? (passed
                ? tr("you'll cancel — the date passed, no charge yet", 'você vai cancelar — a data passou, sem cobrança ainda')
                : <>{tr("you'll cancel before", 'você vai cancelar antes de')} <span className="whitespace-nowrap">{next ? weekdayDay(next) : '—'}</span></>)
              : when}
          </div>
          {!cancel && previous ? (
            <div className="mt-0.5 text-xs text-faint">
              {chargedAfterCancel
                ? tr(`you had marked it to cancel, but it charged again on ${dayMonth(r.lastCharge.date)}`, `você tinha marcado para cancelar, mas cobrou de novo em ${dayMonth(r.lastCharge.date)}`)
                : tr(`last time: ${previous.choice === 'keep' ? 'keep' : 'cancel'}`, `da última vez: ${previous.choice === 'keep' ? 'manter' : 'cancelar'}`)}
            </div>
          ) : null}
          {r.risk === 'high' && !cancel ? (
            <div className="mt-0.5 text-xs text-warn">{tr('Check before it renews — it may charge without a reminder.', 'Confira antes de renovar — pode cobrar sem aviso.')}</div>
          ) : null}
        </div>
        <div className={cx('@xl:order-3', cancel && '@xl:col-start-3')}>
          <TxAmount t={r.lastCharge} compact />
        </div>
        {/* "vou cancelar" traz link, host e "não verificado": numa coluna só, espremia o nome letra por letra; vai para uma linha própria */}
        <div
          data-q
          data-question
          role="group"
          aria-label={cancel ? tr(`Cancel ${name}`, `Cancelar ${name}`) : tr(`Keep ${name}?`, `Manter ${name}?`)}
          className={cx(
            'col-span-2 flex flex-wrap items-center gap-2',
            cancel ? '@xl:order-4 @xl:col-span-3' : '@xl:order-2 @xl:col-span-1 @xl:justify-end',
          )}
        >
          {cancel ? (
            <>
              {manageLinkOf(r)
                ? <CancelLink r={r} />
                : <span className="text-xs text-muted">{tr("no known link: cancel on the service's site or app", 'sem link conhecido: cancele no site ou app do serviço')}</span>}
              <AnswerButton onClick={() => act(r, 'done', 'quick')} name={name}>{tr('Already canceled', 'Já cancelei')}</AnswerButton>
              <button type="button" onClick={() => act(r, 'reopen', 'quick', 'answer')} className={cx(linkButton, 'px-1')}>
                {tr('change', 'mudar')}<span className="sr-only"> {name}</span>
              </button>
            </>
          ) : (
            <>
              <AnswerButton onClick={() => act(r, 'keep', 'quick')} name={name} className={pairButton} tone="good">{tr('Keep it', 'Vou manter')}</AnswerButton>
              <AnswerButton onClick={() => act(r, 'cancel', 'quick')} name={name} className={pairButton} tone="bad">{tr("I'll cancel", 'Vou cancelar')}</AnswerButton>
            </>
          )}
        </div>
      </div>
      <DetailsPanel d={d} r={r} showMilestones section="quick" />
    </li>
  );
}

/**
 * Uma renovação recente: o que aconteceu, "você esperava?" e, junto, a pergunta da próxima renovação.
 * O caminho do reembolso só aparece aqui, depois de "não esperava".
 */
function CheckRow({ t }: { t: Task }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { act, decisions, checks, flash } = useTodo();
  const d = useDetails();
  const titleId = useId();
  const { r } = t;
  const name = displayName(r);
  const j = r.justRenewed!;
  const last = r.lastCharge;
  const check = checks[j.chargeId];
  const urgent = t.answer && isUrgent(r, decisions);
  const prev = j.priceChanged && j.previousAmount !== undefined && j.previousCurrency ? money(j.previousAmount, j.previousCurrency) : null;
  const change = j.previousAmount && j.previousCurrency === last.currency ? ` (${pctSigned(((last.amount - j.previousAmount) / j.previousAmount) * 100)})` : '';
  // aumento de preço em gold (o guia da ether.fi); queda ou troca de moeda fica neutra
  const raised = j.priceChanged && j.previousAmount !== undefined && j.previousCurrency === last.currency && last.amount > j.previousAmount;
  // a pergunta da próxima renovação: em aviso agora, ou depois de "não esperava"
  const second = t.answer || check === 'unexpected';
  const ago = renewedAgo(j, locale);

  return (
    <li
      data-task={r.key}
      data-sub={r.key}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cx('px-3 py-3 transition-shadow first:rounded-t-xl last:rounded-b-xl sm:px-4', urgent && 'bg-bad/[0.04]', flash === r.key && 'ring-2 ring-inset ring-accent')}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 @xl:grid-cols-[minmax(0,1fr)_auto_6.5rem] @xl:items-center">
        <div className="min-w-0">
          <h4 id={titleId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <NameToggle r={r} open={d.open} controls={d.id} onToggle={d.toggle} className="text-ink" />
            {r.risk === 'high' ? <RiskBadge r={r} /> : null}
          </h4>
          <p className="mt-0.5 text-xs text-muted">
            {cycleText(r, locale)} · <span className="text-ink">{ago.charAt(0).toLowerCase() + ago.slice(1)}</span> · <span className="whitespace-nowrap">{weekdayDay(j.date)}</span>
          </p>
          {prev ? (
            <p className="tnum mt-0.5 text-xs text-muted">
              {tr('price', 'preço')} <span className="whitespace-nowrap">{prev}</span> <span className={cx('whitespace-nowrap', raised && 'text-warn')}>→ <span className={raised ? undefined : 'text-ink'}>{money(last.amount, last.currency)}</span>{change}</span>
            </p>
          ) : null}
        </div>
        <div className="@xl:order-3">
          <TxAmount t={last} compact />
        </div>
        {!check ? (
          <div
            data-q
            data-question
            role="group"
            aria-label={tr(`Was the ${name} renewal expected?`, `Você esperava a renovação de ${name}?`)}
            className="col-span-2 flex flex-wrap gap-2 @xl:order-2 @xl:col-span-1 @xl:justify-end"
          >
            <AnswerButton onClick={() => act(r, 'expected', 'cards')} name={name} className={pairButton}>{tr('Yes, expected', 'Sim, esperava')}</AnswerButton>
            <AnswerButton onClick={() => act(r, 'unexpected', 'cards')} name={name} className={pairButton}>{tr("No, I didn't", 'Não esperava')}</AnswerButton>
          </div>
        ) : null}
      </div>

      {check === 'expected' ? (
        <Answered onChange={() => act(r, 'reopen', 'cards', 'check')} name={name}>
          {tr('You expected this renewal', 'Você esperava essa renovação')}
        </Answered>
      ) : check === 'unexpected' ? (
        <UnexpectedRenewal r={r} />
      ) : null}

      {second ? <NextRenewal r={r} urgent={urgent} afterUnexpected={check === 'unexpected'} /> : null}
      <DetailsPanel d={d} r={r} showMilestones={t.answer} section="cards" />
    </li>
  );
}

/** Pergunta já respondida dentro do item: uma linha com "mudar". */
function Answered({ children, onChange, name }: { children: ReactNode; onChange: () => void; name: string }) {
  const tr = useTr();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
      <span>{children}</span>
      <button type="button" onClick={onChange} className={linkButton}>{tr('change', 'mudar')}<span className="sr-only"> {name}</span></button>
    </div>
  );
}

/** "Não esperava": aí sim, o que os termos dizem do reembolso e o pedido pronto. */
function UnexpectedRenewal({ r }: { r: SubscriptionRecord }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { act } = useTodo();
  const j = r.justRenewed!;
  const status = refundStatus(j, locale);
  const refundNote = localized(r.audit?.refundNote, locale);
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-warn">{tr("You didn't expect this renewal", 'Você não esperava essa renovação')}</span>
        <button type="button" onClick={() => act(r, 'reopen', 'cards', 'check')} className={linkButton}>
          {tr('change', 'mudar')}<span className="sr-only"> {displayName(r)}</span>
        </button>
      </div>
      {/* abaixo de 360 px a caixa vai até a borda do item: três molduras aninhadas comiam a largura do texto */}
      <div data-q className={cx('mt-2 rounded-lg border p-3 max-[359px]:-mx-3 max-[359px]:rounded-none max-[359px]:border-x-0', REFUND_BOX[status.tone])}>
        <p className={cx('text-sm font-medium', REFUND_TEXT[status.tone])}>{status.text}</p>
        {/* texto livre do arquivo da IA: vai como nota dela, não como frase do painel */}
        {refundNote ? <p className="mt-0.5 text-xs text-muted">{tr("Your AI's note: ", 'Nota da sua IA: ')}<Foreign text={refundNote} /></p> : null}
        <div className="mt-2.5 flex flex-wrap items-start gap-x-4 gap-y-2">
          <CopyRefundButton r={r} />
          <CancelLink r={r} />
        </div>
      </div>
    </div>
  );
}

const REFUND_BOX = { good: 'border-good/30 bg-good/5', warn: 'border-warn/35 bg-warn/5', neutral: 'border-line bg-panel2/40' } as const;
const REFUND_TEXT = { good: 'text-good', warn: 'text-warn', neutral: 'text-muted' } as const;

/** A segunda pergunta do item: manter ou cancelar a próxima renovação (ou o lembrete de cancelar, se já respondeu). */
function NextRenewal({ r, urgent, afterUnexpected }: { r: SubscriptionRecord; urgent: boolean; afterUnexpected: boolean }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { act } = useTodo();
  const name = displayName(r);
  const next = r.nextRenewal;
  if (plansToCancel(r)) return <CancelPlan r={r} urgent={urgent} afterUnexpected={afterUnexpected} />;
  const when = next ? ((r.daysUntil ?? 0) > 180 ? dayMonthYear(next) : weekdayDay(next)) : null;
  const text = when && r.daysUntil !== null
    ? tr(`Next renewal ${inDays(r.daysUntil, locale)} · ${when} — keep it?`, `Próxima renovação ${inDays(r.daysUntil, locale)} · ${when} — vai manter?`)
    : tr('Keep this subscription?', 'Vai continuar com esta assinatura?');
  return (
    // na linha larga, os botões se alinham com os de "você esperava?" logo acima (antes da coluna do valor)
    <div data-q data-question role="group" aria-label={tr(`Keep ${name}?`, `Manter ${name}?`)} className="mt-3 border-t border-line pt-3 @xl:flex @xl:items-center @xl:justify-between @xl:gap-3 @xl:pr-[7.25rem]">
      <div className="min-w-0">
        <p className={cx('text-xs', urgent ? 'font-medium text-bad' : 'text-muted')}>{text}</p>
        {r.risk === 'high' ? <p className="mt-0.5 text-xs text-warn">{tr('Check before it renews — it may charge without a reminder.', 'Confira antes de renovar — pode cobrar sem aviso.')}</p> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 @xl:mt-0 @xl:shrink-0">
        <AnswerButton onClick={() => act(r, 'keep', 'cards')} name={name} className={pairButton} tone="good">{tr('Keep it', 'Vou manter')}</AnswerButton>
        <AnswerButton onClick={() => act(r, 'cancel', 'cards')} name={name} className={pairButton} tone="bad">{tr("I'll cancel", 'Vou cancelar')}</AnswerButton>
      </div>
    </div>
  );
}

/** "Vou cancelar" no item: neutro com o prazo; vermelho só a 2 dias ou menos e ainda não cancelado. */
function CancelPlan({ r, urgent, afterUnexpected }: { r: SubscriptionRecord; urgent: boolean; afterUnexpected: boolean }) {
  const tr = useTr();
  const { act } = useTodo();
  const name = displayName(r);
  const next = r.nextRenewal;
  const passed = r.alert === 'due' || r.alert === 'overdue';
  return (
    <div data-q data-question className={cx('mt-3 rounded-lg border p-3', urgent ? 'border-bad/35 bg-bad/5' : 'border-info/25 bg-info/5')}>
      <div className={cx('text-sm font-medium', urgent ? 'text-bad' : 'text-ink')}>
        {passed
          ? tr("You'll cancel — the date passed and the charge hasn't shown up yet", 'Você vai cancelar — a data passou e a cobrança ainda não apareceu')
          : next ? tr(`You'll cancel before ${weekdayDay(next)}`, `Você vai cancelar antes de ${weekdayDay(next)}`) : tr("You'll cancel", 'Você vai cancelar')}
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {passed
          ? tr('If there is still time, cancel now.', 'Se ainda dá tempo, cancele agora.')
          : afterUnexpected
            ? tr("Turn off auto-renewal so the next one doesn't charge.", 'Desligue a renovação automática para a próxima não cobrar.')
            : tr("The reminder stays here until then, so you aren't charged again.", 'O aviso fica aqui até lá, para você não ser cobrado de novo.')}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <CancelLink r={r} button />
        {!manageLinkOf(r) ? (
          <span className="text-xs text-muted">
            {tr("No known link: cancel on the service's website or app (or in the app store, if you subscribed there).", 'Sem link conhecido: cancele no site ou app do serviço (ou na loja de apps, se assinou por lá).')}
          </span>
        ) : null}
        <AnswerButton onClick={() => act(r, 'done', 'cards')} name={name}>{tr('Already canceled', 'Já cancelei')}</AnswerButton>
        <button type="button" onClick={() => act(r, 'reopen', 'cards', 'answer')} className={cx(linkButton, 'px-1')}>
          {tr('change', 'mudar')}<span className="sr-only"> {name}</span>
        </button>
      </div>
    </div>
  );
}

/** O que fica fora da linha: plano, marcos de aviso, termos, por que é assinatura, link e "não é assinatura". */
function TaskDetails({ r, today, showMilestones, section }: { r: SubscriptionRecord; today: string; showMilestones: boolean; section: Section }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { act } = useTodo();
  const showTerms = Boolean(r.audit) || r.riskSource === 'heuristic';
  return (
    <div className="space-y-3">
      {r.plan ? <div><EmailQuote text={r.plan} /></div> : null}
      {showMilestones && r.nextRenewal ? <Milestones r={r} today={today} /> : null}
      {showTerms ? <RenewalTerms r={r} className="border-b border-line pb-3" /> : null}
      <SignalList r={r} hideAudit={Boolean(r.audit)} />
      <div className="text-faint">{confidenceOf(r.confidence, locale).label} · {cycleSourceLabel(r.cycleSource, locale)}</div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <CancelLink r={r} />
        <button type="button" onClick={() => act(r, 'hide', section)} className={linkButton}>
          {tr('not a subscription', 'não é assinatura')}<span className="sr-only"> {displayName(r)}</span>
        </button>
      </div>
    </div>
  );
}

/** O retorno no lugar do item respondido: o que ficou registrado, o que vem depois e "desfazer". */
function Ghost({ last, onUndo }: { last: Last; onUndo: () => void }) {
  const tr = useTr();
  return (
    <li
      className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-panel2/40 px-3 py-2.5 text-xs text-muted first:rounded-t-xl last:rounded-b-xl sm:px-4"
    >
      <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-ink">{last.name}</span> · {tr('saved', 'registrado')} · {last.label}
      </span>
      <button type="button" onClick={onUndo} className={cx(linkButton, 'gap-1 text-muted')}>
        <Undo2 className="size-3.5" aria-hidden />
        {tr('undo', 'desfazer')}
        <span className="sr-only"> {last.name}</span>
      </button>
    </li>
  );
}

/** Respondidas: uma linha por assinatura, com "mudar" (reabre as perguntas). Longa: começa fechada. */
function AnsweredList({ records }: { records: SubscriptionRecord[] }) {
  const tr = useTr();
  const [open, setOpen] = useState(records.length <= 4);
  const id = useId();
  return (
    <div className="mt-5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="tap mb-2 inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs font-medium uppercase tracking-[0.12em] text-faint hover:text-muted pointer-fine:sm:min-h-6"
      >
        {tr('Answered', 'Respondidas')} · {num(records.length, 0)}
        <ChevronDown className={cx('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <ul id={id} className="divide-y divide-line rounded-xl border border-line">
          {records.map((r) => <AnsweredRow key={r.key} r={r} />)}
        </ul>
      ) : null}
    </div>
  );
}

function AnsweredRow({ r }: { r: SubscriptionRecord }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { act, decisions, checks } = useTodo();
  const answer = answerBadge(r, decisions, locale);
  const j = r.justRenewed;
  const check = j ? checks[j.chargeId] : undefined;
  const when = r.alert && r.daysUntil !== null
    ? `${renewalIn(r.daysUntil, locale)}${r.nextRenewal ? ` · ${dayMonth(r.nextRenewal)}` : ''}`
    : j ? renewedAgo(j, locale) : '';
  return (
    // nome e "mudar" na mesma linha; quando e as respostas embaixo (no desktop, tudo numa linha só)
    <li className="flex items-center gap-x-3 px-3 py-2 text-sm sm:px-4">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="min-w-0 basis-full [overflow-wrap:anywhere] sm:flex-1 sm:basis-40">{displayName(r)}</span>
        <span className="tnum text-xs text-muted">{when}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {check ? <Badge tone="neutral">{check === 'expected' ? tr('expected', 'esperada') : tr('not expected', 'não esperada')}</Badge> : null}
          {answer ? <Badge tone={answer.tone}>{answer.label}</Badge> : null}
        </span>
      </div>
      <button type="button" onClick={() => act(r, 'reopen', check ? 'cards' : 'quick', 'all')} className={cx(linkButton, 'shrink-0')}>
        {tr('change', 'mudar')}<span className="sr-only"> {displayName(r)}</span>
      </button>
    </li>
  );
}
