import { Fragment, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, CircleAlert, Download, Mail } from 'lucide-react';
import { fxSummary } from '../lib/analytics';
import { dateFull, money, monthLabelLong, num, usd, usd0 } from '../lib/format';
import type { SubscriptionRecord } from '../lib/subscriptionTypes';
import { cx } from '../lib/cx';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { attentionSummary, useAttention } from '../state/attention';
import { decide, forget, useSubscriptions, type Decisions } from '../state/decisions';
import { downloadFile, icsFor } from '../state/calendar';
import { Badge, Button, Empty, Panel, PanelTitle, Why } from '../components/ui';
import { TxAmount } from '../components/money';
import {
  addDays, answerBadge, CancelLink, ChargeDots, confidenceOf, cycleSourceLabel, cycleText, dayMonth, dayMonthYear, displayName,
  EmailQuote, Foreign, homeCost, inDays, NameToggle, nb, renewalIn, RenewalTerms, RiskBadge, riskReasons, SignalList, STAGE,
  useCanHover, weekday, weekdayDay,
} from '../components/subscriptionParts';
import { TodoPanel } from '../components/subscriptionTodo';

const UPCOMING_DAYS = 60;
const WARN_DAYS = 14;
/** No celular, listas longas mostram este tanto e "mostrar todas" */
const MOBILE_ROWS = 5;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// nomes dos arquivos da IA no aviso em PT (em EN vão como estão: evidence, research, audit)
const AI_FILE_PT = { evidence: 'evidências do email', research: 'pesquisa', audit: 'auditoria de renovação' } as const;

// largura de desktop (lg): acompanha a janela, para a lista do celular encurtar e a do desktop ficar inteira
const LG = '(min-width: 1024px)';
const subscribeLg = (cb: () => void) => {
  const m = window.matchMedia(LG);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const useDesktop = () => useSyncExternalStore(subscribeLg, () => window.matchMedia(LG).matches, () => true);

export function SubscriptionsView({ target }: { target?: string | null }) {
  const { dataset, isSample, aiFileIssues } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  const attention = useAttention();
  const { report, decisions, error } = useSubscriptions();
  const fx = useMemo(() => fxSummary(dataset), [dataset]);
  const ics = useMemo(() => icsFor(report, decisions, locale), [report, decisions, locale]);
  const [flash, setFlash] = useState<string | null>(null);
  // "não é assinatura" e "é assinatura, sim" na lista de todas: a linha muda de grupo, então o foco vai junto e o leitor ouve
  const [moved, setMoved] = useState('');
  const today = dataset.referenceDate;

  const evidence = dataset.subscriptionSources?.evidence;
  const evCount = evidence?.items.length ?? 0;
  const resCount = dataset.subscriptionSources?.research?.items.length ?? 0;
  const notSubByAi = dataset.subscriptionSources?.research?.items.filter((i) => i.isSubscription === 'no').length ?? 0;

  // contas recorrentes (aluguel, condomínio, mensalidade) ficam num grupo próprio: não são assinatura, não têm aviso
  // nem entram nos totais
  const groups = useMemo(() => {
    const subs = report.records.filter((r) => r.kind !== 'bill');
    const of = (s: SubscriptionRecord['status']) => subs.filter((r) => r.status === s);
    return {
      active: of('active'), maybe: of('maybe_cancelled'), cancelled: of('cancelled'),
      notSub: report.records.filter((r) => r.status === 'not_subscription'),
      bills: report.records.filter((r) => r.kind === 'bill' && r.status !== 'not_subscription'),
    };
  }, [report]);

  // vindo de outra tela com um item: rola até ele, destaca por um instante e leva o foco
  useEffect(() => {
    if (!target) return;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-sub="${CSS.escape(target)}"]`);
      if (!el) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
      setFlash(target);
    });
    const done = setTimeout(() => setFlash(null), 2400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [target, report.records.length]);

  // na aba, o erro da análise aparece (ErrorBoundary) em vez de virar "nenhuma assinatura"
  if (error) throw error;
  if (!report.records.length) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">{tr('Subscriptions', 'Assinaturas')}</h1>
        <Empty
          title={tr('No subscriptions in the loaded history.', 'Nenhuma assinatura no histórico carregado.')}
          hint={tr(
            'Anything that charges the card at regular intervals, or is known to bill subscriptions, shows up here, with a heads-up 14, 7 and 2 days before each renewal.',
            'Aparece aqui quem cobra no cartão em intervalos regulares ou é conhecido por cobrar assinatura, com aviso 14, 7 e 2 dias antes de cada renovação.',
          )}
        />
      </div>
    );
  }

  const home = homeCost(report.records, fx);
  const soon = report.upcoming.filter((r) => (r.daysUntil ?? Infinity) <= WARN_DAYS);
  const soonUsd = soon.reduce((s, r) => s + r.lastCharge.amountUsd, 0);
  const atRisk = report.atRisk ?? [];
  // prazo de vários anos (termMonths) é ciclo conhecido: "a cada N anos"
  const unknownCycle = groups.active.filter((r) => r.cycle === 'unknown' && !r.termMonths).length;
  const axisFrom = dataset.coverage?.from ?? report.records.map((r) => r.charges[0]?.date ?? r.lastCharge.date).sort()[0];
  const axisTo = `${addDays(today, 35)}T12:00:00Z`;
  const homeName = fx ? (fx.currency === 'BRL' ? tr('BRL', 'reais') : fx.currency) : '';
  const maybeCount = groups.maybe.length;
  // cobrança por uso entra pela média: o total sai com "≈"
  const approx = report.monthlyApprox ? '≈\u00a0' : '';

  const download = () => downloadFile(ics.text, tr('subscription-reminders.ics', 'lembretes-assinaturas.ics'), 'text/calendar;charset=utf-8');

  // a mesma composição da barra, do Início e de Gastos
  const waiting = attentionSummary(attention, locale);

  const toggleNotSub = (r: SubscriptionRecord) => {
    const name = displayName(r);
    if (r.status === 'not_subscription') {
      forget(r.key);
      setMoved(tr(`${name} is back in the reminders.`, `${name} voltou para os avisos.`));
    } else {
      decide(r, 'not_subscription');
      setMoved(tr(`${name} moved to "Not a subscription".`, `${name} foi para "Não é assinatura".`));
    }
    // a linha sai do grupo aberto: o foco vai para o cabeçalho do grupo de destino
    const back = r.kind === 'bill' ? 'grupo-bills' : 'grupo-active';
    requestAnimationFrame(() => document.getElementById(r.status === 'not_subscription' ? back : 'grupo-notSub')?.focus());
  };

  const kpis: Kpi[] = [
    {
      label: tr('Waiting on you', 'Esperando você'),
      value: num(attention.total, 0),
      // a mesma cor da barra e do Início: azul quando há algo, vermelho só no urgente
      tone: attention.urgent ? 'bad' : attention.total ? 'info' : undefined,
      sub: waiting || tr('all answered', 'tudo respondido'),
      why: tr(
        'The same number as the menu, Portfolio and Spending. To answer: a renewal 14, 7 or 2 days away (30 for high risk) with no answer yet. To cancel: you said you\'d cancel and haven\'t marked it done. To check: a renewal that just happened, until you say whether you expected it. Alerts: purchase alerts from the last 30 days, shown in Spending › Needs attention.',
        'O mesmo número do menu, do Portfólio e de Gastos. Para responder: renovação a 14, 7 ou 2 dias (30 no risco alto) ainda sem resposta. Para cancelar: você disse que ia cancelar e ainda não marcou como feito. Para conferir: renovação que acabou de acontecer, até você dizer se esperava. Alertas: alertas de compra dos últimos 30 dias, que ficam em Gastos › Precisa de atenção.',
      ),
    },
    {
      label: tr('Active', 'Ativas'),
      value: num(groups.active.length, 0),
      sub: maybeCount
        ? tr(`+ ${num(maybeCount, 0)} possibly canceled`, `+ ${num(maybeCount, 0)} ${maybeCount === 1 ? 'possivelmente cancelada' : 'possivelmente canceladas'}`)
        : tr('all billing on time', 'todas cobrando em dia'),
      why: tr(
        "Active: charged on the card and the next renewal isn't overdue yet. It counts services known to bill subscriptions (by name, research or emails) and anything that charges a similar amount at regular intervals.",
        'Ativa: cobrou no cartão e a renovação seguinte ainda não passou do prazo. Entra quem é conhecido por cobrar assinatura (pelo nome do serviço, pela pesquisa ou pelos emails) ou quem cobra valor parecido em intervalos regulares.',
      ),
    },
    {
      label: tr('Cost per month', 'Custo por mês'),
      value: `${approx}${usd0(report.monthlyTotalUsd)}`,
      sub: (
        <>
          {home ? <span className="tnum block">≈&nbsp;{money(home.monthly, fx!.currency, { compact: true })} {tr('per month', 'por mês')}</span> : null}
          <span className="tnum block">
            {approx}{usd0(report.annualTotalUsd)} {tr('per year', 'por ano')}
            {home ? <span className="whitespace-nowrap"> ≈&nbsp;{money(home.annual, fx!.currency, { compact: true })}</span> : null}
          </span>
        </>
      ),
      why: (
        <>
          {tr(
            `Each active subscription counts as its last charge in US$ divided by the months in its cycle (yearly ÷ 12, weekly × 52 ÷ 12); per year = month × 12. Exact: ${usd(report.monthlyTotalUsd)} per month, ${usd(report.annualTotalUsd)} per year.`,
            `Cada ativa entra com a última cobrança em US$ dividida pelos meses do ciclo (anual ÷ 12, semanal × 52 ÷ 12); por ano = mês × 12. Exato: ${usd(report.monthlyTotalUsd)} por mês, ${usd(report.annualTotalUsd)} por ano.`,
          )}
          {report.monthlyApprox
            ? tr(
              ' Usage-based charges count at the average of their last charges, so the total is approximate (≈).',
              ' Cobranças por uso entram pela média das últimas cobranças, então o total é aproximado (≈).',
            )
            : ''}
          {groups.bills.length
            ? tr(
              ' Recurring bills (rent, condo fees, tuition) are not subscriptions and are left out.',
              ' Contas recorrentes (aluguel, condomínio, mensalidade) não são assinaturas e ficam fora.',
            )
            : ''}
          {unknownCycle
            ? tr(
              ` ${num(unknownCycle, 0)} ${unknownCycle === 1 ? 'subscription with an unknown cycle is' : 'subscriptions with an unknown cycle are'} left out.`,
              ` ${num(unknownCycle, 0)} ${unknownCycle === 1 ? 'assinatura com ciclo desconhecido fica' : 'assinaturas com ciclo desconhecido ficam'} fora.`,
            )
            : ''}
          {home
            ? tr(
              ` The ≈ uses the amount in ${homeName} when the charge was in ${homeName} and converts the rest at the average rate of your purchases (≈ ${money(home.monthly, fx!.currency, { compact: true })} per month, ≈ ${money(home.annual, fx!.currency, { compact: true })} per year).`,
              ` O ≈ usa o valor em ${homeName} quando a cobrança foi em ${homeName} e converte o resto pelo câmbio médio das suas compras (≈ ${money(home.monthly, fx!.currency, { compact: true })} por mês, ≈ ${money(home.annual, fx!.currency, { compact: true })} por ano).`,
            )
            : ''}
        </>
      ),
    },
    {
      label: tr('Next 14\u00a0days', 'Próximos 14\u00a0dias'),
      value: num(soon.length, 0),
      sub: soon.length
        ? tr(`${soon.length === 1 ? 'renewal' : 'renewals'} · ${usd(soonUsd)} based on the last charge`, `${soon.length === 1 ? 'renovação' : 'renovações'} · ${usd(soonUsd)} pela última cobrança`)
        : tr('no renewals', 'nenhuma renovação'),
      why: tr(
        "Active subscriptions due to renew between today and 14 days from now, at the amount of the last charge. The date comes from the email when it says so; otherwise it's the last charge + 1 cycle, on the same day of the month.",
        'Ativas com renovação prevista de hoje até daqui a 14 dias, pelo valor da última cobrança. A data vem do email quando ele informa; senão, é a última cobrança + 1 ciclo, no mesmo dia do mês.',
      ),
    },
  ];

  const intro = tr(
    "A heads-up 14, 7 and 2\u00a0days before each renewal, so there's time to cancel what you no longer want.",
    'Aviso 14, 7 e 2\u00a0dias antes de cada renovação, para dar tempo de cancelar o que você não quer mais.',
  );
  const emailLine = (
    <span className="inline-flex items-center gap-1.5 text-xs text-faint">
      <Mail className="size-3.5 shrink-0" aria-hidden />
      {evidence?.generatedAt
        ? tr(`${num(evCount, 0)} ${evCount === 1 ? 'email' : 'emails'} read up to ${dateFull(evidence.generatedAt)}`, `${num(evCount, 0)} ${evCount === 1 ? 'email lido' : 'emails lidos'} até ${dateFull(evidence.generatedAt)}`)
        : tr(`${num(evCount, 0)} ${evCount === 1 ? 'email' : 'emails'} from the last read`, `${num(evCount, 0)} ${evCount === 1 ? 'email' : 'emails'} da última leitura`)}
    </span>
  );
  const noEmail = (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-info/25 bg-info/5 px-2 py-1 text-xs text-muted">
      <CircleAlert className="size-3.5 shrink-0 text-info" aria-hidden />
      {isSample
        ? tr('Sample data · no emails in this analysis', 'Dados fictícios · sem emails nesta análise')
        : tr('No emails in this analysis: card charges and public info only', 'Sem emails nesta análise: só as cobranças do cartão e a base pública')}
    </span>
  );
  const howItWorks = (
    <>
      <p>
        {tr(
          `Card charges are matched against services known to bill subscriptions${resCount ? ', plus research on your merchants' : ''}${evCount ? ` and ${num(evCount, 0)} ${evCount === 1 ? 'email' : 'emails'} (receipts, renewals and cancellations)` : ''}.`,
          `As cobranças do cartão são cruzadas com serviços conhecidos por cobrar assinatura${resCount ? ', com a pesquisa sobre os seus estabelecimentos' : ''}${evCount ? ` e com ${num(evCount, 0)} ${evCount === 1 ? 'email' : 'emails'} de recibo, renovação e cancelamento` : ''}.`,
        )}
        {/* a pesquisa da IA também tira estabelecimentos desta tela: a pessoa precisa saber que isso aconteceu */}
        {notSubByAi
          ? tr(
            ` Your AI's research marks ${num(notSubByAi, 0)} ${notSubByAi === 1 ? 'merchant' : 'merchants'} as not a subscription: they stay out of this screen, and their charges stay in the statement.`,
            ` A pesquisa da sua IA marca ${num(notSubByAi, 0)} ${notSubByAi === 1 ? 'estabelecimento' : 'estabelecimentos'} como "não é assinatura": ${notSubByAi === 1 ? 'ele fica' : 'eles ficam'} fora desta tela, e as cobranças continuam no extrato.`,
          )
          : null}
      </p>
      {evCount ? (
        <p className="mt-2">
          {tr(
            "These emails were read by your AI, not by the dashboard: its file should carry only the date, amount, plan and period end of each one, never the message text. Text quoted from an email stays in its own language.",
            'Quem leu esses emails foi a sua IA, não o painel: o arquivo dela deve trazer só data, valor, plano e fim do período de cada um, nunca o texto da mensagem. O que vem citado de um email fica na língua dele.',
          )}
        </p>
      ) : (
        <p className="mt-2">
          {isSample ? tr('This is sample data. ', 'Estes são dados fictícios. ') : ''}
          {tr(
            "Without emails, the analysis uses only card charges and what's publicly known about each service. Receipts, renewal notices and cancellations from email only come in when the dashboard runs with the local file; without them, a new yearly plan or a cancellation you already made may not show up.",
            'Sem emails, a análise usa só as cobranças do cartão e o que se sabe publicamente de cada serviço. Os recibos, avisos de renovação e cancelamentos do email só entram quando o painel roda com o arquivo local; sem eles, um plano anual recém-assinado ou um cancelamento já feito podem não aparecer.',
          )}
        </p>
      )}
    </>
  );
  // celular: a faixa curta no lugar dos cartões (o "esperando você" já está no título do "Para fazer")
  const summary = [
    <>{tr(`${num(groups.active.length, 0)}\u00a0active`, `${num(groups.active.length, 0)}\u00a0${groups.active.length === 1 ? 'ativa' : 'ativas'}`)}</>,
    <>{approx}{usd0(report.monthlyTotalUsd)}{tr('/mo', '/mês')}</>,
    <>{soon.length
      ? tr(`${num(soon.length, 0)}\u00a0in the next 14\u00a0days`, `${num(soon.length, 0)}\u00a0nos próximos 14\u00a0dias`)
      : tr('none in the next 14\u00a0days', 'nenhuma nos próximos 14\u00a0dias')}</>,
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{tr('Subscriptions', 'Assinaturas')}</h1>
        {/* desktop: subtítulo, de onde vêm os dados e "como funciona" à vista; os números logo abaixo, em cartões */}
        <div className="hidden space-y-2 lg:block">
          <p className="max-w-3xl text-sm text-muted">{intro}</p>
          <Disclosure label={tr('how it works', 'como funciona')} lead={evCount ? emailLine : noEmail}>
            {howItWorks}
          </Disclosure>
        </div>
        <MobileSummary items={summary} intro={intro} notice={evCount ? null : noEmail}>
          {evCount ? <p className="mt-2 flex items-start gap-1.5">{emailLine}</p> : null}
          {howItWorks}
          <dl className="mt-3 space-y-2 border-t border-line pt-3">
            {kpis.map((k) => (
              <div key={k.label}>
                <dt className="font-medium text-ink">{k.label}</dt>
                <dd>{k.why}</dd>
              </div>
            ))}
          </dl>
        </MobileSummary>
        {aiFileIssues ? (
          // discreto: a análise segue com o que veio inteiro; o aviso só diz que parte dos arquivos da IA ficou de fora
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <CircleAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden />
            <span>
              {aiFileIssues.dropped
                ? tr(
                  `${num(aiFileIssues.dropped, 0)} ${aiFileIssues.dropped === 1 ? 'item from your AI files was' : 'items from your AI files were'} skipped (malformed).`,
                  `${num(aiFileIssues.dropped, 0)} ${aiFileIssues.dropped === 1 ? 'item dos arquivos da IA foi ignorado' : 'itens dos arquivos da IA foram ignorados'} (malformados).`,
                )
                : ''}
              {aiFileIssues.invalidFiles.length
                ? tr(
                  ` ${aiFileIssues.invalidFiles.length === 1 ? 'One AI file was' : `${aiFileIssues.invalidFiles.length} AI files were`} left out (${aiFileIssues.invalidFiles.join(', ')}).`,
                  ` ${aiFileIssues.invalidFiles.length === 1 ? 'Um arquivo da IA ficou' : `${aiFileIssues.invalidFiles.length} arquivos da IA ficaram`} de fora (${aiFileIssues.invalidFiles.map((f) => AI_FILE_PT[f]).join(', ')}).`,
                )
                : ''}
            </span>
          </p>
        ) : null}
      </div>

      <div className="hidden lg:block">
        <KpiStrip items={kpis} />
      </div>

      {/* items-start: as tarefas variam de 0 a muitas e a coluna do lado também; nenhum painel estica com vazio */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <TodoPanel today={today} flash={flash} />
          {atRisk.length ? <HighRiskPanel records={atRisk} /> : null}
        </div>

        <div className="space-y-5">
          <Panel>
            <PanelTitle>{tr('Calendar reminders', 'Lembretes no calendário')}</PanelTitle>
            <p className="text-sm leading-relaxed text-muted">
              {tr(
                'Each active subscription becomes an event on its renewal date, with alarms 14, 7 and 2\u00a0days before (and 30 for high risk), repeating on its cycle.',
                'Cada assinatura ativa vira um evento no dia da renovação, com alarmes 14, 7 e 2\u00a0dias antes (e 30 no risco alto), repetindo no ciclo dela.',
              )}
            </p>
            <Button variant="primary" className="mt-4 min-h-11 w-full justify-center pointer-fine:sm:min-h-0" onClick={download} disabled={!ics.events}>
              <Download className="size-4" aria-hidden /> {tr('Download reminders (.ics)', 'Baixar lembretes (.ics)')}
            </Button>
            <div className="mt-2 text-xs text-faint">
              {tr(
                `${num(ics.events, 0)} ${ics.events === 1 ? 'subscription' : 'subscriptions'} in the file · generated here in the browser, nothing leaves your computer.`,
                `${num(ics.events, 0)} ${ics.events === 1 ? 'assinatura' : 'assinaturas'} no arquivo · gerado aqui no navegador, nada sai do computador.`,
              )}
            </div>
            <div className="mt-3">
              <Why label={tr('how to import on iPhone', 'como importar no iPhone')}>
                <ol className="list-decimal space-y-1 pl-4">
                  <li>{tr('Send the file to your iPhone: AirDrop, the Files app (iCloud Drive), or an email to yourself.', 'Mande o arquivo para o iPhone: por AirDrop, pelo app Arquivos (iCloud Drive) ou num email para você mesmo.')}</li>
                  <li>
                    {tr('Open the file on the iPhone, tap ', 'Abra o arquivo no iPhone, toque em ')}
                    <span className="text-ink">{tr('Add All', 'Adicionar todos')}</span>
                    {tr(' and pick the calendar.', ' e escolha o calendário.')}
                  </li>
                  <li>{tr('Something changed (a renewal, a new answer)? Download and import again: events keep the same ID and get updated.', 'Mudou algo (renovou, você respondeu)? Baixe e importe de novo: os eventos têm o mesmo identificador e são atualizados.')}</li>
                </ol>
                <p className="mt-2">
                  {tr(
                    'High-risk subscriptions (they renew on their own without a reminder email) get an extra alarm 30 days before, with the cancellation deadline in the event notes, so there is time to read the terms and cancel.',
                    'Assinaturas de risco alto (renovam sozinhas sem aviso por email) ganham um alarme a mais, 30 dias antes, com o prazo para cancelar nas notas do evento, para dar tempo de ler os termos e cancelar.',
                  )}
                </p>
                <p className="mt-2">
                  {tr(
                    'The file has the names and amounts of your subscriptions: keep and share it as you would a statement. Anything you marked as canceled or "not a subscription" is left out of the file; if the event is already on your iPhone, delete it there.',
                    'O arquivo tem os nomes e os valores das suas assinaturas: guarde e envie como faria com um extrato. O que você marcou como cancelado ou como "não é assinatura" sai do arquivo; se o evento já estava no iPhone, apague por lá.',
                  )}
                </p>
              </Why>
            </div>
          </Panel>

          <UpcomingPanel records={report.upcoming} decisions={decisions} />
        </div>
      </div>

      <section className="space-y-3" aria-labelledby="todas-assinaturas">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="todas-assinaturas" className="text-lg font-semibold tracking-tight">{tr('All', 'Todas')}</h2>
          <div className="flex items-center gap-3 text-xs text-faint" aria-hidden>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-accent" /> {tr(`charge since ${monthLabelLong(axisFrom)}`, `cobrança desde ${monthLabelLong(axisFrom)}`)}
            </span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-accent" /> {tr('next', 'próxima')}</span>
          </div>
        </div>
        <p role="status" className="sr-only">{moved}</p>
        {/* no celular a lista das ativas começa fechada: a página já tem as tarefas acima */}
        <StatusGroup
          id="grupo-active"
          title={tr('Active', 'Ativas')}
          records={groups.active}
          axis={[axisFrom, axisTo]}
          today={today}
          decisions={decisions}
          target={target}
          flash={flash}
          onToggleNotSub={toggleNotSub}
          collapsible
          defaultOpen={typeof window !== 'undefined' && window.matchMedia(LG).matches}
          showMonthly
        />
        <StatusGroup
          id="grupo-bills"
          title={tr('Recurring bills', 'Contas recorrentes')}
          note={tr(
            "Rent, condo fees, insurance or tuition that charge the card at regular intervals. They're not subscriptions: no reminders, not in the calendar or the totals.",
            'Aluguel, condomínio, seguro ou mensalidade que cobram o cartão em intervalos regulares. Não são assinaturas: ficam fora dos avisos, do calendário e dos totais.',
          )}
          records={groups.bills}
          axis={[axisFrom, axisTo]}
          today={today}
          decisions={decisions}
          target={target}
          flash={flash}
          onToggleNotSub={toggleNotSub}
          collapsible
          showMonthly
        />
        <StatusGroup
          id="grupo-maybe"
          title={tr('Possibly canceled', 'Possivelmente canceladas')}
          note={tr(
            'The expected renewal passed with no charge on the card (or the last charge was refunded). It may have been canceled, or is now paid another way.',
            'A renovação esperada passou sem cobrança no cartão (ou a última cobrança foi estornada). Pode ter sido cancelada, ou passou a ser paga de outro jeito.',
          )}
          records={groups.maybe}
          axis={[axisFrom, axisTo]}
          today={today}
          decisions={decisions}
          target={target}
          flash={flash}
          onToggleNotSub={toggleNotSub}
          collapsible
        />
        <StatusGroup
          id="grupo-cancelled"
          title={tr('Canceled', 'Canceladas')}
          // o cancelamento vem só de um email lido pela IA: a nota diz que os avisos pararam por causa dele
          note={tr(
            "Your AI found a cancellation email on or after the date of the last charge, so these left the reminders and the calendar. Check in each service's account that it's really canceled: a new charge brings it back to active.",
            'A sua IA achou um email de cancelamento na data da última cobrança ou depois dela, e por isso estas saíram dos avisos e do calendário. Confira na conta de cada serviço se foi mesmo cancelada: uma cobrança nova a traz de volta para ativas.',
          )}
          records={groups.cancelled}
          axis={[axisFrom, axisTo]}
          today={today}
          decisions={decisions}
          target={target}
          flash={flash}
          onToggleNotSub={toggleNotSub}
          collapsible
        />
        <StatusGroup
          id="grupo-notSub"
          title={tr('Not a subscription', 'Não é assinatura')}
          note={tr(
            "You marked these as not subscriptions: they're left out of reminders, the calendar and the totals.",
            'Você marcou que não são assinaturas: ficam fora dos avisos, do calendário e dos totais.',
          )}
          records={groups.notSub}
          axis={[axisFrom, axisTo]}
          today={today}
          decisions={decisions}
          target={target}
          flash={flash}
          onToggleNotSub={toggleNotSub}
          collapsible
        />
      </section>
    </div>
  );
}

/** Uma linha curta à vista e o resto atrás de um toque; o painel abre embaixo da linha inteira. */
function Disclosure({ lead, label, children }: { lead: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {lead}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="tap inline-flex min-h-8 cursor-pointer items-center text-xs text-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-muted pointer-fine:sm:min-h-6"
        >
          {label}
        </button>
      </div>
      {open ? (
        <div id={id} className="mt-2 max-w-3xl rounded-lg border border-line bg-panel2/50 px-3 py-2 text-xs leading-relaxed text-muted">{children}</div>
      ) : null}
    </div>
  );
}

interface Kpi {
  label: string;
  value: ReactNode;
  tone?: 'bad' | 'info';
  sub: ReactNode;
  why: ReactNode;
}

/** Os números do topo, no desktop: um cartão por número, como nas outras telas. No celular, ver MobileSummary. */
function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="panel min-w-0 p-4">
          <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{k.label}</dt>
          <dd className={cx('tnum mt-1.5 font-display text-2xl font-semibold tracking-tight', k.tone === 'bad' && 'text-bad', k.tone === 'info' && 'text-info')}>
            {k.value}
          </dd>
          <dd className="mt-1 text-xs text-muted">{k.sub}</dd>
          <dd className="mt-1.5"><Why>{k.why}</Why></dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Celular: logo abaixo do título, uma faixa de uma linha com os números e "como funciona"; a introdução e o porquê
 * de cada número moram lá dentro. Assim o "Para fazer" (o trabalho da tela) começa na primeira dobra, até a 320 px.
 */
function MobileSummary({ items, intro, notice, children }: { items: ReactNode[]; intro: ReactNode; notice: ReactNode; children: ReactNode }) {
  const tr = useTr();
  return (
    <div className="space-y-2 lg:hidden">
      {notice}
      <Disclosure
        label={tr('how it works', 'como funciona')}
        lead={
          <p className="tnum text-sm text-muted">
            {items.map((it, i) => (
              // cada número fica inteiro; a linha quebra no espaço depois do "·" (que fica preso ao item de antes,
              // nunca no começo da linha seguinte)
              <Fragment key={i}>
                {i ? ' ' : null}
                <span className="whitespace-nowrap">{it}{i < items.length - 1 ? <span aria-hidden>{'\u00a0·'}</span> : null}</span>
              </Fragment>
            ))}
          </p>
        }
      >
        <p>{intro}</p>
        {children}
      </Disclosure>
    </div>
  );
}

/** Próximos 60 dias: uma régua com a zona de aviso e a lista por mês. */
function UpcomingPanel({ records, decisions }: { records: SubscriptionRecord[]; decisions: Decisions }) {
  const tr = useTr();
  const desktop = useDesktop();
  const hover = useCanHover();
  const [all, setAll] = useState(false);
  const total = records.reduce((s, r) => s + r.lastCharge.amountUsd, 0);
  const inZone = records.filter((r) => (r.daysUntil ?? 99) <= WARN_DAYS).length;
  // no celular a lista começa curta: a régua já mostra as 60 dias inteiras
  const shown = desktop || all ? records : records.slice(0, MOBILE_ROWS);
  const months: { month: string; rows: SubscriptionRecord[]; total: number }[] = [];
  for (const r of records) {
    const m = r.nextRenewal!.slice(0, 7);
    let g = months[months.length - 1];
    if (g?.month !== m) {
      g = { month: m, rows: [], total: 0 };
      months.push(g);
    }
    g.total += r.lastCharge.amountUsd;
    if (shown.includes(r)) g.rows.push(r);
  }
  // renovações no mesmo par de dias se empilham (no meio, acima, abaixo…) para os pontos não se cobrirem
  const stack = new Map<number, number>();

  return (
    <Panel>
      <PanelTitle hint={records.length ? <span className="tnum whitespace-nowrap">{num(records.length, 0)} · {usd(total)}</span> : undefined}>
        {tr('Next 60\u00a0days', 'Próximos 60\u00a0dias')}
      </PanelTitle>
      {records.length ? (
        <>
          {/* celular: no lugar da régua, a mesma informação em texto (os pontos de 8 px se sobrepunham e só falavam no hover) */}
          <p className="mb-3 text-xs text-muted lg:hidden">
            {nb(tr(
              `${num(inZone, 0)} of ${num(records.length, 0)} in the 14-day reminder zone`,
              `${num(inZone, 0)} de ${num(records.length, 0)} na zona de aviso de 14 dias`,
            ))}
          </p>
          <div
            className="relative mb-1 hidden h-10 lg:block"
            role="img"
            aria-label={tr(
              `${num(records.length, 0)} ${records.length === 1 ? 'renewal' : 'renewals'} in the next ${UPCOMING_DAYS} days; ${num(inZone, 0)} in the 14-day reminder zone.`,
              `${num(records.length, 0)} ${records.length === 1 ? 'renovação' : 'renovações'} nos próximos ${UPCOMING_DAYS} dias; ${num(inZone, 0)} na zona de aviso de 14 dias.`,
            )}
          >
            <span className="absolute inset-y-0 left-0 rounded-l-md bg-warn/10" style={{ width: `${(WARN_DAYS / UPCOMING_DAYS) * 100}%` }} />
            <span className="absolute inset-x-0 top-1/2 h-px bg-line2" />
            {[2, 7].map((d) => (
              <span key={d} className="absolute inset-y-1.5 w-px bg-warn/30" style={{ left: `${(d / UPCOMING_DAYS) * 100}%` }} />
            ))}
            {records.map((r) => {
              const d = Math.max(0, r.daysUntil ?? 0);
              const bucket = Math.floor(d / 2);
              const k = stack.get(bucket) ?? 0;
              stack.set(bucket, k + 1);
              const offset = Math.min(2, Math.ceil(k / 2)) * (k % 2 ? -7 : 7);
              const tone = r.alert ? STAGE[r.alert].dot : 'bg-muted';
              return (
                <span
                  key={r.key}
                  title={hover ? `${displayName(r)} · ${weekdayDay(r.nextRenewal!)}` : undefined}
                  className={cx('absolute size-2 -translate-x-1/2 rounded-full ring-2 ring-panel', tone)}
                  style={{ left: `${(d / UPCOMING_DAYS) * 100}%`, top: `calc(50% - 4px + ${offset}px)` }}
                />
              );
            })}
          </div>
          <div className="mb-4 hidden justify-between gap-2 text-xs text-faint lg:flex" aria-hidden>
            <span>{tr('today', 'hoje')}</span>
            <span className="text-center text-warn">{tr('reminder zone · 14\u00a0days', 'zona de aviso · 14\u00a0dias')}</span>
            <span className="whitespace-nowrap">{tr(`${UPCOMING_DAYS} days`, `${UPCOMING_DAYS} dias`)}</span>
          </div>
          <div className="space-y-4">
            {months.filter((g) => g.rows.length).map((g) => (
              <div key={g.month}>
                <h3 className="mb-1 flex items-baseline justify-between text-xs font-medium uppercase tracking-[0.12em] text-faint">
                  <span>{capitalize(monthLabelLong(g.month))}</span>
                  <span className="tnum normal-case tracking-normal">{usd(g.total)}</span>
                </h3>
                <ul className="divide-y divide-line">
                  {g.rows.map((r) => <UpcomingRow key={r.key} r={r} decisions={decisions} />)}
                </ul>
              </div>
            ))}
          </div>
          {shown.length < records.length || (all && !desktop) ? (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll((v) => !v)}
              className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line2 text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink"
            >
              {all ? tr('Show fewer', 'Mostrar menos') : tr(`Show all ${num(records.length, 0)}`, `Mostrar todas as ${num(records.length, 0)}`)}
              <ChevronDown className={cx('size-4 transition-transform', all && 'rotate-180')} aria-hidden />
            </button>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed text-faint">
            {tr('Amount based on the last charge; the renewal may differ with price changes or exchange rates.', 'Valor pela última cobrança; o da renovação pode mudar com reajuste ou câmbio.')}
          </p>
        </>
      ) : (
        <Empty title={tr('No renewals expected in the next 60 days.', 'Nenhuma renovação prevista nos próximos 60 dias.')} />
      )}
    </Panel>
  );
}

function UpcomingRow({ r, decisions }: { r: SubscriptionRecord; decisions: Decisions }) {
  const tr = useTr();
  const { locale } = useLocale();
  const next = r.nextRenewal!;
  const answer = answerBadge(r, decisions, locale);
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="w-9 shrink-0 text-center leading-tight">
        <div className="tnum text-base font-semibold">{next.slice(8, 10)}</div>
        <div className="text-xs uppercase text-faint">{weekday(next)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm [overflow-wrap:anywhere]">{displayName(r)}</div>
        {/* dentro da janela, a cor acompanha o aviso que está valendo (o texto já diz em quantos dias); fora, quando chega o primeiro */}
        <div className={cx('text-xs', r.alert ? STAGE[r.alert].text : 'text-faint')}>
          {r.alert
            ? renewalIn(r.daysUntil ?? 0, locale)
            : tr(`1st reminder on ${dayMonth(addDays(next, -WARN_DAYS))}`, `1º aviso em ${dayMonth(addDays(next, -WARN_DAYS))}`)}
          {answer ? <span className="text-muted"> · {answer.label}</span> : null}
          {r.risk === 'high' ? <span className="text-warn"> · {tr('high risk', 'risco alto')}</span> : null}
        </div>
      </div>
      <TxAmount t={r.lastCharge} compact />
    </li>
  );
}

/** Risco alto: renova sozinho sem aviso (pelos termos) ou plano anual caro sem aviso no email (estimado). */
function HighRiskPanel({ records }: { records: SubscriptionRecord[] }) {
  const tr = useTr();
  const desktop = useDesktop();
  const [all, setAll] = useState(false);
  const shown = desktop || all ? records : records.slice(0, MOBILE_ROWS);
  return (
    <Panel>
      <PanelTitle hint={<span className="hidden sm:inline">{tr('high risk · expected date and amount', 'risco alto · data e valor esperados')}</span>}>{tr('Check before they renew', 'Confira antes de renovar')}</PanelTitle>
      <ul className="divide-y divide-line">
        {shown.map((r) => <HighRiskRow key={r.key} r={r} />)}
      </ul>
      {shown.length < records.length || (all && !desktop) ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line2 text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink"
        >
          {all ? tr('Show fewer', 'Mostrar menos') : tr(`Show all ${num(records.length, 0)}`, `Mostrar todas as ${num(records.length, 0)}`)}
          <ChevronDown className={cx('size-4 transition-transform', all && 'rotate-180')} aria-hidden />
        </button>
      ) : null}
      <div className="mt-3 text-xs leading-relaxed text-faint">
        <Why label={tr('what is high risk?', 'o que é risco alto?')}>
          {tr(
            'High risk: the terms say it renews on its own without a reminder email, or (estimated) a yearly plan of US$ 100 or more with no renewal reminder in your email. These get an extra reminder 30 days before the renewal.',
            'Risco alto: os termos dizem que renova sozinho sem aviso por email ou (estimado) plano anual de US$ 100 ou mais sem aviso de renovação no seu email. Esses ganham um aviso a mais, 30 dias antes da renovação.',
          )}
        </Why>
      </div>
    </Panel>
  );
}

function HighRiskRow({ r }: { r: SubscriptionRecord }) {
  const tr = useTr();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const id = useId();
  const reason = riskReasons(r, locale)[0];
  const next = r.nextRenewal;
  const when = next ? ((r.daysUntil ?? 0) > 180 ? dayMonthYear(next) : weekdayDay(next)) : null;
  const rel = r.daysUntil !== null ? ` (${inDays(r.daysUntil, locale)})` : '';
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* o nome abre os termos (como nas tarefas): uma linha de "ver termos" a menos por item */}
          <NameToggle r={r} open={open} controls={id} onToggle={() => setOpen((v) => !v)} />
          <div className={cx('mt-0.5 text-xs', r.alert ? STAGE[r.alert].text : 'text-muted')}>
            {when ? <>{tr('renews', 'renova')} <span className="whitespace-nowrap">{when}</span>{rel}</> : tr('no expected date', 'sem data prevista')} · {cycleText(r, locale)}
          </div>
          {/* o motivo inteiro, sem reticências (cortado, ele só existiria nos termos) */}
          {reason ? <div className="mt-0.5 text-xs text-faint"><Foreign text={nb(reason)} /></div> : null}
        </div>
        <div className="shrink-0 text-right">
          <TxAmount t={r.lastCharge} compact />
          <div className="text-xs text-faint">{tr('expected', 'esperado')}</div>
        </div>
      </div>
      {open ? (
        <div id={id} className="mt-2 rounded-lg border border-line bg-panel2/50 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <RenewalTerms r={r} />
          <div className="mt-2"><CancelLink r={r} /></div>
        </div>
      ) : null}
    </li>
  );
}

/** Um grupo de "Todas". Os que não pedem ação (paradas, canceladas, não é assinatura) começam fechados. */
function StatusGroup({ id, title, note, records, axis, today, decisions, target, flash, onToggleNotSub, collapsible, defaultOpen, showMonthly }: {
  id: string;
  title: string;
  note?: string;
  records: SubscriptionRecord[];
  axis: [string, string];
  today: string;
  decisions: Decisions;
  target?: string | null;
  flash: string | null;
  onToggleNotSub: (r: SubscriptionRecord) => void;
  collapsible?: boolean;
  defaultOpen?: boolean;
  showMonthly?: boolean;
}) {
  const tr = useTr();
  const [open, setOpen] = useState(!collapsible || Boolean(defaultOpen));
  if (!records.length) return null;
  // um item pedido por outra tela abre o grupo dele
  const isOpen = open || (target != null && records.some((r) => r.key === target));
  const monthly = records.reduce((s, r) => s + r.monthlyCostUsd, 0);
  return (
    <Panel className="!p-0 overflow-hidden">
      {collapsible ? (
        <button
          id={id}
          type="button"
          aria-expanded={isOpen}
          onClick={() => setOpen(!isOpen)}
          className="flex min-h-11 w-full cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-panel2/40 px-4 py-2.5 text-left text-xs transition-colors hover:bg-panel2"
        >
          <span className="font-medium text-muted">{title} · {num(records.length, 0)}</span>
          <span className="inline-flex shrink-0 items-center gap-3 text-faint">
            {showMonthly ? <span className="tnum">{usd(monthly)} {tr('per month', 'por mês')}</span> : null}
            <span className="inline-flex items-center gap-1">
              {isOpen ? tr('hide', 'esconder') : tr('show', 'mostrar')}
              <ChevronDown className={cx('size-3.5 transition-transform', isOpen && 'rotate-180')} aria-hidden />
            </span>
          </span>
        </button>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-panel2/40 px-4 py-2 text-xs">
          <span className="font-medium text-muted">{title} · {num(records.length, 0)}</span>
          {showMonthly ? <span className="tnum text-faint">{usd(monthly)} {tr('per month', 'por mês')}</span> : null}
        </div>
      )}
      {note ? <p className="border-t border-line px-4 py-2 text-xs text-faint">{note}</p> : null}
      {isOpen ? (
        <div className="divide-y divide-line border-t border-line">
          {records.map((r) => <RecordRow key={r.key} r={r} axis={axis} today={today} decisions={decisions} highlighted={flash === r.key} onToggleNotSub={onToggleNotSub} />)}
        </div>
      ) : null}
    </Panel>
  );
}

function RecordRow({ r, axis, today, decisions, highlighted, onToggleNotSub }: {
  r: SubscriptionRecord;
  axis: [string, string];
  today: string;
  decisions: Decisions;
  highlighted: boolean;
  onToggleNotSub: (r: SubscriptionRecord) => void;
}) {
  const tr = useTr();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const id = useId();
  const hover = useCanHover();
  const answer = answerBadge(r, decisions, locale);
  const t = r.lastCharge;
  const showTerms = Boolean(r.audit) || r.riskSource === 'heuristic';

  let next: string;
  if (r.status === 'cancelled') next = tr('canceled per an email · check your account', 'cancelada segundo email · confira na conta');
  else if (r.status === 'not_subscription') next = tr('left out of reminders', 'fora dos avisos');
  else if (!r.nextRenewal) next = tr('no expected date', 'sem data prevista');
  else if (r.status === 'maybe_cancelled') {
    next = tr(`expected renewal on ${dayMonthYear(r.nextRenewal)} didn't come`, `renovação esperada em ${dayMonthYear(r.nextRenewal)} não veio`);
  } else {
    // longe (plano anual), sem o ano a data parece a deste ano
    const when = (r.daysUntil ?? 0) > 180 ? dayMonthYear(r.nextRenewal) : weekdayDay(r.nextRenewal);
    const rel = r.daysUntil !== null ? ` (${inDays(r.daysUntil, locale)})` : '';
    next = tr(`next ${when}${rel}`, `próxima ${when}${rel}`);
  }

  return (
    <div
      data-sub={r.key}
      tabIndex={-1}
      role="group"
      aria-label={displayName(r)}
      className={cx(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3.5 transition-shadow lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_8.5rem] lg:items-center',
        highlighted && 'ring-2 ring-inset ring-accent',
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* o nome abre os termos e os detalhes: uma linha de "ver termos" a menos em cada uma das dezenas de linhas */}
          <NameToggle r={r} open={open} controls={id} onToggle={() => setOpen((v) => !v)} className={r.status !== 'active' ? 'text-muted' : undefined} />
          {/* um selo por linha: a resposta da pessoa, senão o risco quando ele pede atenção */}
          {answer
            ? <Badge tone={answer.tone}>{answer.label}</Badge>
            : r.risk === 'high' || r.risk === 'medium' ? <RiskBadge r={r} /> : null}
        </div>
        <div className="mt-1 text-xs text-faint">
          {cycleText(r, locale)}
          {r.plan ? <> · <EmailQuote text={r.plan} /></> : null}
        </div>
        <div className="tnum mt-0.5 text-xs text-faint">
          {tr('last', 'última')} {dayMonthYear(t.date)} · {money(t.amount, t.currency)} · {next}
        </div>
      </div>

      <div className="text-right lg:order-3">
        {r.monthlyCostUsd ? (
          <>
            <div className={cx('tnum text-sm font-medium', r.status !== 'active' && 'text-muted')}>
              {/* cobrança por uso: a média das últimas cobranças, por isso o "≈" */}
              {r.costApprox ? <span title={hover ? tr('Usage-based: average of the last charges', 'Cobrança por uso: média das últimas cobranças') : undefined}>≈&nbsp;</span> : null}
              {usd(r.monthlyCostUsd)}<span className="text-xs font-normal text-faint">{tr('/mo', '/mês')}</span>
            </div>
            <div className="tnum text-xs text-faint">{r.costApprox ? '≈\u00a0' : ''}{usd(r.annualCostUsd)}{tr('/yr', '/ano')}</div>
          </>
        ) : (
          <div className="text-xs text-faint">{tr('left out of the total', 'fora do total')}<br />{tr('(unknown cycle)', '(ciclo desconhecido)')}</div>
        )}
      </div>

      <div className="col-span-2 lg:order-2 lg:col-span-1">
        <ChargeDots r={r} from={axis[0]} to={axis[1]} today={today} />
      </div>

      {open ? (
        <div id={id} className="col-span-2 rounded-lg border border-line bg-panel2/50 px-3 py-2.5 text-xs leading-relaxed text-muted lg:order-4 lg:col-span-3">
          <div className="space-y-3">
            {showTerms ? <RenewalTerms r={r} className="border-b border-line pb-3" /> : null}
            <SignalList r={r} hideAudit={Boolean(r.audit)} />
            <div className="text-faint">{confidenceOf(r.confidence, locale).label} · {cycleSourceLabel(r.cycleSource, locale)}</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {r.status !== 'not_subscription' ? <CancelLink r={r} /> : null}
              <button
                type="button"
                onClick={() => onToggleNotSub(r)}
                className="tap inline-flex min-h-8 cursor-pointer items-center text-xs text-faint underline underline-offset-2 hover:text-muted pointer-fine:sm:min-h-6"
              >
                {r.status === 'not_subscription'
                  ? (r.kind === 'bill' ? tr('it is a recurring bill', 'é conta recorrente, sim') : tr('it is a subscription', 'é assinatura, sim'))
                  : (r.kind === 'bill' ? tr('not a recurring bill', 'não é conta recorrente') : tr('not a subscription', 'não é assinatura'))}
                <span className="sr-only"> {displayName(r)}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
