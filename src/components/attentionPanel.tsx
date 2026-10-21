import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { ALERT_WINDOW_DAYS, type Anomaly } from '../lib/analytics';
import { monthYearLabel } from '../lib/format';
import type { Navigate } from '../lib/nav';
import { cx } from '../lib/cx';
import { pick } from '../lib/locale';
import { useLocale, useTr } from '../state/locale';
import { attentionSummary, questionsOf, useAttentionDetail, waitingLabel, type AttentionItem } from '../state/attention';
import { hintLinkClass, Panel, PanelTitle, Why } from './ui';
import { useMedia } from './useMedia';
import { AlertRow, alertId, useDismissed } from './alerts';
import { RenewalAlertRow, RenewalCheckAlertRow, renewalCheckOf, useSubscriptions } from './subscriptionParts';

// "Precisa de atenção": renovações para responder ou conferir e alertas de compra, numa lista só. Morava no Início e
// agora fica em Gastos, perto do topo. O Portfólio leva até ele pela linha "N esperando você" (target "attention").

/** Os 3 do topo, sem que um tipo esconda o outro: com alertas abertos, as assinaturas ocupam no máximo 2 lugares. */
function topAttention(items: AttentionItem[]): AttentionItem[] {
  const maxSubs = items.some((it) => it.kind === 'alert') ? 2 : 3;
  const top: AttentionItem[] = [];
  let subs = 0;
  for (const it of items) {
    if (top.length === 3) break;
    if (it.kind !== 'alert' && subs++ >= maxSubs) continue;
    top.push(it);
  }
  return top;
}

type Filter = Exclude<AttentionItem['kind'], 'alert'> | Anomaly['kind'];
const filterOf = (it: AttentionItem): Filter => (it.kind === 'alert' ? it.a.kind : it.kind);
/** Os tipos em que o item conta: a assinatura com as duas perguntas entra em "conferir" e também na da próxima renovação. */
const filtersOf = (it: AttentionItem): Filter[] => (it.kind === 'check' && it.next ? [it.kind, it.next] : [filterOf(it)]);
const FILTER_LABEL: Record<Filter, [en: string, pt: string]> = {
  answer: ['Renewals to answer', 'Renovações para responder'],
  cancel: ['To cancel', 'Para cancelar'],
  check: ['Renewals to check', 'Renovações para conferir'],
  duplicate: ['Possible duplicates', 'Possíveis duplicadas'],
  unusually_large: ['Above usual', 'Acima do usual'],
  first_time: ['First time', 'Primeira vez'],
  stuck_pending: ['Pending a long time', 'A confirmar há muito tempo'],
};
const FILTERS = Object.keys(FILTER_LABEL) as Filter[];

/** O que o link pede: a lista inteira ("alerts") ou só os alertas de um mês ("alerts:AAAA-MM"). */
function openedBy(target: string | null | undefined): { month: string | null } | null {
  if (!target?.startsWith('alerts')) return null;
  const m = target.slice('alerts:'.length);
  return { month: /^\d{4}-\d{2}$/.test(m) ? m : null };
}

/** Rola até um elemento (a margem do cabeçalho fixo vem do scroll-padding) e leva o foco para ele. */
export function bringTo(el: HTMLElement | null) {
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

/**
 * O painel e a lista inteira, para a tela pôr cada um no seu lugar: `panel` perto do topo; `allList` (o "ver todos"),
 * no desktop, num painel de largura total abaixo da grade (no celular ele abre dentro do próprio painel); `status`, a
 * região que o leitor de tela ouve quando um alerta some. `target`: "alerts" ou "alerts:AAAA-MM" abrem a lista
 * inteira; "attention" só rola até o painel e põe o foco no título.
 */
export function useNeedsAttention({ target, onNavigate, onListChange, className }: {
  target?: string | null;
  onNavigate: Navigate;
  /** "ver todos" abriu ou fechou: o endereço passa a dizer isso (o voltar reabre a lista onde ela estava) */
  onListChange?: (open: boolean, month: string | null) => void;
  className?: string;
}): { panel: ReactNode; allList: ReactNode; status: ReactNode } {
  const { dismiss, restoreAll } = useDismissed();
  const { locale } = useLocale();
  const tr = useTr();
  // a mesma lista e a mesma contagem da barra de navegação, do Portfólio e de Assinaturas
  const { checks } = useSubscriptions();
  const { attention, items, older, hidden } = useAttentionDetail();
  const top = topAttention(items);
  const summary = attentionSummary(attention, locale);
  // vale ao abrir a tela e a cada target novo (ajuste no render, sem efeito em cascata)
  const opened = openedBy(target);
  const [showAll, setShowAll] = useState(Boolean(opened));
  const [showOlder, setShowOlder] = useState(Boolean(opened?.month));
  const [allMonth, setAllMonth] = useState<string | null>(opened?.month ?? null);
  // aberto por link (e não pelo botão): a tela rola até a lista, mesmo quando ela abre no lugar, no celular
  const [reveal, setReveal] = useState(Boolean(opened));
  const [seenTarget, setSeenTarget] = useState(target);
  if (target !== seenTarget) {
    setSeenTarget(target);
    setAllMonth(opened?.month ?? null);
    if (opened) {
      setShowOlder(Boolean(opened.month));
      setShowAll(true);
      setReveal(true);
    }
  }
  // "attention" (a linha do Portfólio): depois do foco que a navegação põe no h1, rola até o painel e foca o título
  useEffect(() => {
    if (target !== 'attention') return;
    const id = requestAnimationFrame(() => bringTo(document.getElementById('needs-attention-title')));
    return () => cancelAnimationFrame(id);
  }, [target]);
  const seeAllRef = useRef<HTMLButtonElement>(null);
  // desktop: "ver todos" abre num painel largo abaixo da grade; celular: no próprio "Precisa de atenção"
  const wide = useMedia('(min-width: 1024px)');

  // "Já conferi": o cartão some; o foco vai para o próximo cartão da mesma lista (senão o título) e o leitor de tela
  // ouve o que aconteceu, em vez de cair no <body> e voltar ao topo
  const [announce, setAnnounce] = useState('');
  const dismissAlert = (a: Anomaly, list: string, index: number) => {
    dismiss(alertId(a));
    // depois do commit: o cartão que ocupou o mesmo lugar (ou o anterior, se era o último), senão o título da lista
    requestAnimationFrame(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(`[data-attn-list="${list}"] > *`)];
      const card = cards[index] ?? cards[index - 1];
      const next = card?.querySelector<HTMLElement>('button:not([aria-expanded])')
        ?? document.getElementById(list === 'top' ? 'needs-attention-title' : 'attention-all');
      next?.focus();
    });
    // quem foi "conferido" sai da conta só se estava nela (alerta recente); o antigo não conta
    const left = list === 'older' ? attention.total : Math.max(0, attention.total - 1);
    setAnnounce(`${tr('Alert hidden', 'Alerta escondido')} · ${waitingLabel(left, locale)}`);
  };

  const openSubscription = (key: string) => onNavigate('subscriptions', { target: key });
  const openAlert = (a: Anomaly) => onNavigate('statement', { month: a.date.slice(0, 7), target: a.relatedIds[0] });
  const row = (list: string) => (it: AttentionItem, index: number) => it.kind === 'alert'
    ? <AlertRow key={alertId(it.a)} a={it.a} onDismiss={() => dismissAlert(it.a, list, index)} onOpen={() => openAlert(it.a)} />
    : it.kind === 'check'
      // com `next`, o mesmo cartão mostra também a pergunta da próxima renovação (conta 2 no total)
      ? <RenewalCheckAlertRow key={`check-${it.r.key}`} r={it.r} check={renewalCheckOf(it.r, checks)} next={it.next} onOpen={() => openSubscription(it.r.key)} />
      : <RenewalAlertRow key={`renewal-${it.r.key}`} r={it.r} onOpen={() => openSubscription(it.r.key)} />;
  const olderRow = (a: Anomaly, index: number) => <AlertRow key={alertId(a)} a={a} quiet onDismiss={() => dismissAlert(a, 'older', index)} onOpen={() => openAlert(a)} />;

  // abrir e fechar "ver todos" também atualiza o endereço (sem criar entrada no histórico)
  const setList = (open: boolean, m: string | null = null) => {
    setShowAll(open);
    setReveal(false);
    setAllMonth(m);
    onListChange?.(open, m);
  };
  const closeAll = () => {
    setList(false);
    seeAllRef.current?.focus();
  };
  const more = items.length > top.length;
  const seeAll = more || older.length || hidden ? (
    <button
      ref={seeAllRef}
      aria-expanded={showAll}
      aria-controls={showAll ? 'attention-all' : undefined}
      className={hintLinkClass}
      onClick={() => {
        if (!showAll && !more) setShowOlder(true);
        setList(!showAll);
      }}
    >
      {showAll
        ? tr('hide list', 'esconder lista')
        : more ? tr(`see all\u00A0(${attention.total})`, `ver todos\u00A0(${attention.total})`) : tr('older alerts', 'alertas antigos')}
    </button>
  ) : undefined;
  const allList = showAll ? (
    <AllAttention
      inline={!wide}
      reveal={reveal}
      summary={summary}
      items={items}
      older={older}
      hidden={hidden}
      month={allMonth}
      showOlder={showOlder}
      onShowOlder={setShowOlder}
      onClearMonth={() => setList(true, null)}
      onRestore={restoreAll}
      onClose={closeAll}
      row={row('all')}
      olderRow={olderRow}
    />
  ) : null;

  const panel = (
    <Panel id="needs-attention" className={className}>
      <PanelTitle id="needs-attention-title" hint={seeAll}>{tr('Needs attention', 'Precisa de atenção')}</PanelTitle>
      {summary ? <p className="-mt-2 mb-3 text-xs text-muted">{summary}</p> : null}
      {showAll && !wide ? allList : top.length ? (
        <div className="space-y-2.5" data-attn-list="top">{top.map(row('top'))}</div>
      ) : (
        <div className="flex items-start gap-2.5 py-2 text-sm text-muted">
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-good" />
          {tr('Nothing waiting on you right now.', 'Nada esperando você agora.')}
        </div>
      )}
      <div className="mt-3">
        <Why>
          {tr(
            `One list for everything waiting on you: renewals to answer or check (from Subscriptions) and alerts on charges from the last ${ALERT_WINDOW_DAYS} days. A duplicate is the same amount at the same merchant within 3 hours; same-amount balance top-ups and repeats that happen often are routine. "First time" skips new places on a platform you already use (say, a new restaurant on a delivery app) and groups new places from the same day. Rewards waiting to be credited (cashback, referral) aren't alerts. Red only for what can't wait: a renewal 2 days away or a repeat charge that's still pending.`,
            `Uma lista só para tudo o que espera você: renovações para responder ou conferir (de Assinaturas) e alertas de cobranças dos últimos ${ALERT_WINDOW_DAYS} dias. Duplicata é o mesmo valor no mesmo estabelecimento em até 3 horas; recarga de saldo de mesmo valor e repetição frequente são rotina. "Primeira vez" ignora lugar novo numa plataforma que você já usa (um restaurante novo no app de entrega, por exemplo) e junta os lugares novos do mesmo dia. Recompensa esperando crédito (cashback, indicação) não é alerta. Vermelho só para o que não pode esperar: renovação a 2 dias ou cobrança repetida ainda a confirmar.`,
          )}
        </Why>
      </div>
    </Panel>
  );

  return { panel, allList: wide ? allList : null, status: <p role="status" className="sr-only">{announce}</p> };
}

/**
 * "Ver todos": no desktop, painel de largura total abaixo da grade; no celular (`inline`), a lista inteira abre dentro do
 * próprio "Precisa de atenção", sem pular para o fim da página. Filtro por tipo e os alertas antigos à parte. Esc fecha.
 */
function AllAttention({
  inline, reveal, summary, items, older, hidden, month, showOlder, onShowOlder, onClearMonth, onRestore, onClose, row, olderRow,
}: {
  inline: boolean;
  /** aberto por link: rola até a lista mesmo no lugar */
  reveal: boolean;
  summary: string;
  items: AttentionItem[];
  older: Anomaly[];
  hidden: number;
  /** só os alertas deste mês (AAAA-MM), quando veio do mês a mês */
  month: string | null;
  showOlder: boolean;
  onShowOlder: (v: boolean) => void;
  onClearMonth: () => void;
  onRestore: () => void;
  onClose: () => void;
  row: (it: AttentionItem, index: number) => ReactNode;
  olderRow: (a: Anomaly, index: number) => ReactNode;
}) {
  const tr = useTr();
  const { locale } = useLocale();
  const [filter, setFilter] = useState<Filter | 'all'>('all');
  const boxRef = useRef<HTMLDivElement>(null);

  // depois do efeito da tela (que pode focar o h1), traz o painel à vista e o foco para ele; aberto no lugar, só o foco
  useEffect(() => {
    const id = requestAnimationFrame(() => (inline && !reveal ? boxRef.current?.focus({ preventScroll: true }) : bringTo(boxRef.current)));
    return () => cancelAnimationFrame(id);
  }, [month, inline, reveal]);

  // Esc fecha e devolve o foco a "ver todos" (de dentro do painel, ou sem foco em lugar nenhum)
  const onEscape = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const active = document.activeElement;
    if (active && active !== document.body && !boxRef.current?.contains(active)) return;
    e.preventDefault();
    onClose();
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onEscape(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const inMonth = (a: Anomaly) => !month || a.date.slice(0, 7) === month;
  const pool = month ? items.filter((it) => it.kind === 'alert' && inMonth(it.a)) : items;
  const counts = new Map<Filter, number>();
  // contagem por pergunta, como o total da barra: "All" bate com o "ver todos (N)"
  for (const it of pool) for (const f of filtersOf(it)) counts.set(f, (counts.get(f) ?? 0) + 1);
  const poolQuestions = pool.reduce((n, it) => n + questionsOf(it), 0);
  const options = FILTERS.filter((f) => counts.get(f));
  const shown = filter === 'all' ? pool : pool.filter((it) => filtersOf(it).includes(filter));
  const olderShown = older.filter((a) => inMonth(a) && (filter === 'all' || a.kind === filter));
  const chip = (active: boolean) => cx(
    'tap inline-flex min-h-8 shrink-0 cursor-pointer snap-start items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs transition-colors active:bg-panel2',
    active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink',
  );

  const body = (
    <>
      {options.length > 1 || month ? (
        // celular: os chips numa faixa só, rolando de lado (antes ocupavam 3 linhas)
        <div
          role="group"
          aria-label={tr('Filter by type', 'Filtrar por tipo')}
          className="mb-4 flex gap-2 py-1.5 max-lg:-mx-5 max-lg:snap-x max-lg:snap-mandatory max-lg:scroll-px-5 max-lg:overflow-x-auto max-lg:px-5 max-lg:[mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-1rem),transparent)] max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden lg:flex-wrap"
        >
            {month ? (
              <button onClick={onClearMonth} className={chip(true)} title={tr('Show every month', 'Mostrar todos os meses')}>
                {monthYearLabel(month)} <X className="size-3" aria-label={tr('clear month', 'limpar mês')} />
              </button>
            ) : null}
            {(options.length > 1 ? (['all', ...options] as const) : []).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={chip(filter === f)}>
                {f === 'all' ? tr('All', 'Todos') : pick(locale, ...FILTER_LABEL[f])}
                {/* no chip escolhido o número herda o acento (o cinza dava 3,99:1 sobre o fundo do chip) */}
                <span className={cx('tnum', filter === f ? 'text-accent' : 'text-faint')}>{f === 'all' ? poolQuestions : counts.get(f)}</span>
              </button>
            ))}
        </div>
      ) : null}
      {/* o leitor de tela ouve quantos itens o filtro deixou (4.1.3) */}
      <p role="status" className="sr-only">
        {shown.length === 1 ? tr('1 item shown', '1 item na lista') : tr(`${shown.length} items shown`, `${shown.length} itens na lista`)}
      </p>

      {shown.length ? (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2" data-attn-list="all">{shown.map(row)}</div>
      ) : month ? null : (
        <p className="text-sm text-muted">{tr('Nothing of this type right now.', 'Nada deste tipo agora.')}</p>
      )}

      {olderShown.length ? (
        <div className="mt-5 border-t border-line pt-4">
            <button aria-expanded={showOlder} onClick={() => onShowOlder(!showOlder)} className="tap min-h-6 cursor-pointer text-xs font-medium text-muted hover:text-ink">
              {showOlder
                ? tr('Hide older alerts', 'Esconder alertas antigos')
                : tr(`Older than ${ALERT_WINDOW_DAYS} days (${olderShown.length})`, `Com mais de ${ALERT_WINDOW_DAYS} dias (${olderShown.length})`)}
            </button>
            <p className="mt-1 text-xs text-faint">
              {tr(
                'They don’t count as waiting on you. Each month’s alerts also show up in Month by month, below.',
                'Não contam como esperando você. Os de cada mês também aparecem no Mês a mês, mais abaixo.',
              )}
            </p>
            {showOlder ? <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-2" data-attn-list="older">{olderShown.map(olderRow)}</div> : null}
          </div>
        ) : null}

        {hidden ? (
          <div className="mt-4 text-xs text-faint">
            {hidden === 1 ? tr('1 alert marked “Got it”.', '1 alerta marcado como “Já conferi”.') : tr(`${hidden} alerts marked “Got it”.`, `${hidden} alertas marcados como “Já conferi”.`)}{' '}
            <button onClick={onRestore} className="tap cursor-pointer underline decoration-dotted underline-offset-2 hover:text-muted">
              {tr('Show again', 'Mostrar de novo')}
            </button>
          </div>
        ) : null}
    </>
  );

  if (inline) {
    // dentro do "Precisa de atenção": o título e o "esconder lista" já estão no painel
    return (
      <div ref={boxRef} id="attention-all" tabIndex={-1} role="region" aria-labelledby="needs-attention-title" className="outline-none">
        {body}
      </div>
    );
  }
  return (
    <div ref={boxRef} id="attention-all" tabIndex={-1} role="region" aria-labelledby="attention-all-title" className="outline-none">
      <Panel>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 id="attention-all-title" className="text-[13px] font-medium uppercase tracking-[0.14em] text-muted">
            {tr('Everything waiting on you', 'Tudo o que espera você')}
          </h2>
          <button onClick={onClose} aria-keyshortcuts="Escape" className="tap -my-1 inline-flex cursor-pointer items-center gap-1 py-1 text-xs text-faint hover:text-muted">
            <X aria-hidden className="size-3.5" /> {tr('Close', 'Fechar')}
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">{summary || tr('Nothing waiting on you right now.', 'Nada esperando você agora.')}</p>
        {body}
      </Panel>
    </div>
  );
}
