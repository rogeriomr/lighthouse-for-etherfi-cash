import { memo, useMemo, useState } from 'react';
import {
  approxHome, isFullMonth, PERIODS, periodWindow, spendSummary, windowBeyondCoverage, type PeriodKey,
} from '../lib/analytics';
import { dateFull, dateRange, dateShort, daysAgo, money, nb, pct, pctSigned, usd, usd0 } from '../lib/format';
import { categoryColor, hasCategoryColor } from '../lib/categoryColors';
import { VIEW_SLUG, type Navigate } from '../lib/nav';
import { cx } from '../lib/cx';
import { useAttention } from '../state/attention';
import { useSpendAnalyses } from '../state/analyses';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { categoryLabel } from '../lib/merchants';
import { Button, Empty, hintLinkClass, Panel, PanelTitle, Segmented, Stat, Why } from '../components/ui';
import { BarChart, Donut, HBars } from '../components/charts';
import { spendStacks } from '../components/spendStacks';
import { useNeedsAttention } from '../components/attentionPanel';
import { DroppedRowsNote } from '../components/coverageNote';
import { homeCost, useSubscriptions } from '../components/subscriptionParts';
import { EvolutionSection } from './Evolution';
import { TripsSection } from './Trips';
import { ArrowRight, CircleAlert, Repeat, Wallet } from 'lucide-react';

const DAY = 86400000;

type SpendingProps = {
  onOpenMonth: (month: string) => void;
  onOpenSubscriptions: () => void;
  onNavigate: Navigate;
  /** "alerts" ou "alerts:AAAA-MM" abrem a lista inteira do "Precisa de atenção"; "attention" só rola até ele */
  target?: string | null;
  /** "ver todos" abriu ou fechou: o endereço passa a dizer isso */
  onListChange?: (open: boolean, month: string | null) => void;
};

/**
 * memo: os callbacks só navegam e chegam novos a cada render do Shell; sem isso, um estado do cabeçalho (esconder ao
 * rolar) refaria a tela inteira no meio da rolagem. A tela segue os dados, o idioma, o próprio estado e o `target` (um
 * link para os alertas com a tela já aberta).
 */
export const SpendingView = memo(function SpendingView({ onOpenMonth, onOpenSubscriptions, onNavigate, target, onListChange }: SpendingProps) {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const { report: subsReport } = useSubscriptions();
  const attention = useAttention();
  const { months, trips, fx, recurring } = useSpendAnalyses();
  const subsHome = homeCost(subsReport.records, fx);
  const activeSubs = subsReport.records.filter((r) => r.status === 'active').length;
  const nextSub = subsReport.upcoming[0];
  const win = periodWindow(dataset, period);
  // o resumo só muda com os dados e a janela: responder uma assinatura não refaz a conta. Sem o detector antigo de
  // recorrência ([]): os baldes do resumo ficam de fora e saem logo abaixo, da fonte única
  const s = useMemo(() => spendSummary(dataset, [], win.from, win.to), [dataset, win.from, win.to]);
  // os baldes: assinatura é a mesma lista da aba Assinaturas (D12); o resto se divide em dia a dia e avulsas
  const buckets = useMemo(() => {
    const out = { subscriptions: 0, everyday: 0, oneOffs: 0 };
    for (const t of s.rows) {
      if (recurring.subscriptionChargeIds.has(t.id)) out.subscriptions += t.amountUsd;
      else if (t.amountUsd >= 200) out.oneOffs += t.amountUsd;
      else out.everyday += t.amountUsd;
    }
    return out;
  }, [s, recurring]);
  const approx = approxHome(s.rows, fx);
  const beyond = windowBeyondCoverage(dataset, win.from);
  const fullMonths = months.filter(isFullMonth).length;
  const dropped = Boolean(dataset.coverage?.droppedRows);
  // conta que nunca recebeu depósito: um estado normal, explicado no topo (antes, no Início)
  const unfunded = Boolean(dataset.neverFunded) && dataset.transactions.length === 0;
  // o "Precisa de atenção" que morava no Início: no desktop, a coluna à direita do gráfico; no celular, logo depois dos números
  const needs = useNeedsAttention({ target, onNavigate, onListChange, className: 'lg:col-start-3 lg:row-start-1 lg:self-start' });

  // "vs os 30 dias anteriores": só quando a janela anterior inteira está no histórico (o histórico começa antes dela) e a
  // fonte não omitiu linhas, a mesma cautela do mês a mês. "Tudo" não tem anterior
  const prev = useMemo(() => {
    const c = dataset.coverage;
    if (period === 'all' || !c || c.droppedRows) return null;
    const start = Date.parse(win.from.slice(0, 10));
    const prevFrom = new Date(start - win.days * DAY).toISOString().slice(0, 10);
    const prevTo = new Date(start - DAY).toISOString().slice(0, 10);
    if (c.from.slice(0, 10) > prevFrom) return null;
    return spendSummary(dataset, [], `${prevFrom}T00:00:00Z`, `${prevTo}T23:59:59Z`);
  }, [dataset, period, win.from, win.days]);
  const delta = prev && prev.total > 0 ? ((s.total - prev.total) / prev.total) * 100 : null;

  // as 5 maiores categorias com cor própria; o resto (inclusive "Outros") num cinza só, como no Histórico
  const named = s.byCategory.filter((c) => hasCategoryColor(c.name)).slice(0, 5);
  const namedIds = new Set(named.map((c) => c.name));
  const donutData = named.map((c) => ({ name: categoryLabel(c.name, locale), total: c.total, color: categoryColor(c.name) }));
  const others = s.byCategory.filter((c) => !namedIds.has(c.name)).reduce((acc, c) => acc + c.total, 0);
  const donutFull = others > 0 ? [...donutData, { name: tr('Everything else', 'Tudo o resto'), total: Math.round(others * 100) / 100, rest: true }] : donutData;
  // a rosca só tem categorias positivas: estorno maior que as compras da própria categoria fica fora dela, e a soma
  // das fatias passa do total do período. A diferença vai escrita embaixo, para a conta fechar
  const refundGap = Math.round((donutFull.reduce((acc, d) => acc + d.total, 0) - s.total) * 100) / 100;
  // "a confirmar" é o normal nos primeiros dias; só pede atenção (âmbar) depois de 3 dias
  const now = `${dataset.referenceDate}T23:59:59Z`;
  const stalePending = s.rows.filter((t) => t.status === 'pending' && daysAgo(t.date, now) > 3).length;
  // no celular os números dividem a linha em dois: o valor encolhe um pouco para caber
  const kpi = (v: string) => <span className="text-lg sm:text-2xl">{v}</span>;

  // cada dia empilhado por categoria, nas cores de "Por categoria"; o maior dia vem na dica e no cartão "Maior dia"
  const stacks = useMemo(() => spendStacks(s, locale), [s, locale]);
  const dailyBars = s.byDay.map((d) => ({ label: dateShort(`${d.day}T12:00:00Z`), value: d.total, segments: stacks.get(d.day) }));
  const purchases = (n: number) => (n === 1 ? tr(`${n} purchase`, `${n} compra`) : tr(`${n} purchases`, `${n} compras`));
  // "próxima: em 5 dias" — curto, sem o "renova" da frase inteira
  const renewsIn = (d: number) =>
    d < -1 ? tr(`was due ${-d} days ago`, `era para ter renovado há ${-d} dias`)
      : d === -1 ? tr('was due yesterday', 'era para ter renovado ontem')
        : d === 0 ? tr('today', 'hoje')
          : d === 1 ? tr('tomorrow', 'amanhã')
            : tr(`in ${d} days`, `em ${d} dias`);
  const share = (v: number) => (s.total > 0 ? pct(Math.max(0, (v / s.total) * 100)) : '—');
  const kinds = [
    { key: 'subs', label: tr('Subscriptions', 'Assinaturas'), value: buckets.subscriptions, sub: tr('same list as the Subscriptions tab', 'a mesma lista da aba Assinaturas') },
    { key: 'everyday', label: tr('Everyday', 'Dia a dia'), value: buckets.everyday, sub: tr(`everything else under ${usd0(200)}`, `o resto abaixo de ${usd0(200)}`) },
    { key: 'oneoff', label: tr('One-off purchases', 'Compras avulsas'), value: buckets.oneOffs, sub: tr(`${usd0(200)} or more`, `${usd0(200)} ou mais`) },
  ];

  return (
    <div className="space-y-5">
      {needs.status}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{tr('Spending', 'Gastos')}</h1>
          <p className="mt-0.5 text-sm text-muted">{tr('Card purchases only: by category, merchant, subscription and month.', 'Só compras no cartão: por categoria, estabelecimento, assinatura e mês.')}</p>
        </div>
        <Segmented
          ariaLabel={tr('Period', 'Período')}
          value={period}
          onChange={setPeriod}
          fill
          options={PERIODS.map((p) => ({ value: p.key, label: p.key === 'all' ? tr('All', 'Tudo') : p.label }))}
        />
      </div>

      {unfunded ? (
        <Panel>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line2 bg-panel2">
              <Wallet aria-hidden className="size-5 text-accent" />
            </span>
            <div className="min-w-0">
              <h2 className="font-medium">{tr('This account hasn’t been funded yet', 'Esta conta ainda não foi financiada')}</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
                {tr(
                  'That’s a normal state, not an error. Make the first deposit in the ether.fi app; this page fills in after the first card purchase.',
                  'É um estado normal, não um erro. Faça o primeiro depósito pelo app da ether.fi; esta página se preenche depois da primeira compra no cartão.',
                )}
              </p>
              <Button className="mt-4 pointer-coarse:min-h-11" onClick={() => onNavigate('portfolio', { accountTab: 'deposit' })}>
                {tr('How to deposit', 'Como depositar')} <ArrowRight aria-hidden className="size-4" />
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}

      <DroppedRowsNote />
      {beyond && dataset.coverage ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-xs text-muted">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          {tr(
            `The selected period starts before the history loaded (${dateFull(dataset.coverage.from)}). The numbers only cover the part that exists.`,
            `O período pedido começa antes do histórico carregado (${dateFull(dataset.coverage.from)}). Os números cobrem só a parte que existe.`,
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat
          label={tr('Total for the period', 'Total no período')}
          value={kpi(usd(s.total))}
          sub={(
            <>
              {nb(`${purchases(s.count)}${approx ? ` · ${approx}` : ''}`)}
              {delta !== null ? <span className="block">{nb(tr(`${pctSigned(delta)} vs the previous ${win.days} days`, `${pctSigned(delta)} vs os ${win.days} dias anteriores`))}</span> : null}
            </>
          )}
        />
        <Stat label={tr('Daily average', 'Média por dia')} value={kpi(usd(s.avgPerDay))} sub={nb(tr(`over ${win.days} days`, `em ${win.days} dias`))} />
        {/* a mesma precisão nos quatro: todos com centavos */}
        <Stat
          label={tr('Biggest day', 'Maior dia')}
          value={kpi(s.busiestDay ? usd(s.busiestDay.total) : '—')}
          sub={s.busiestDay ? dateShort(`${s.busiestDay.day}T12:00:00Z`) : undefined}
        />
        <Stat
          label={tr('Pending', 'A confirmar')}
          value={kpi(s.pendingCount ? usd(s.pendingTotal) : '—')}
          sub={nb(!s.pendingCount
            ? tr('nothing pending', 'nada pendente')
            : s.pendingCount === 1
              ? tr('1 purchase still pending', '1 compra ainda pendente')
              : tr(`${s.pendingCount} purchases still pending`, `${s.pendingCount} compras ainda pendentes`))}
          tone={stalePending ? 'warn' : undefined}
          why={tr(
            'Purchases the merchant hasn\'t settled yet. That\'s normal for the first few days; it only turns amber when something has been pending for more than 3 days.',
            'Compras que o estabelecimento ainda não confirmou. Nos primeiros dias isso é normal; só fica âmbar quando alguma passa de 3 dias a confirmar.',
          )}
        />
      </div>

      {/*
        desktop: o gráfico e os tipos de compra numa coluna de duas, e o "Precisa de atenção" na terceira (colunas
        independentes: a altura de um lado não abre vão no outro); celular: a atenção vem antes do gráfico
      */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {unfunded ? null : needs.panel}
        <div className={cx('space-y-5', unfunded ? 'lg:col-span-3' : 'lg:col-span-2 lg:col-start-1 lg:row-start-1')}>
          <Panel>
            <PanelTitle hint={nb(tr(`${win.days} days`, `${win.days} dias`))}>{tr('Spending per day', 'Gasto por dia')}</PanelTitle>
            {/* um dia por barra, empilhado por categoria; apontar, tocar ou as setas mostram o dia, o total e as maiores categorias */}
            <BarChart
              data={dailyBars}
              height={150}
              average={{ value: s.avgPerDay, label: tr(`avg ${usd(s.avgPerDay)}/day`, `média ${usd(s.avgPerDay)}/dia`) }}
              ariaLabel={tr(`Spending per day, last ${win.days} days`, `Gasto por dia, últimos ${win.days} dias`)}
              table={[tr('Day', 'Dia'), tr('Spent', 'Gasto')]}
              axis={s.byDay.length ? [dateShort(`${s.byDay[0].day}T12:00:00Z`), dateShort(`${s.byDay[s.byDay.length - 1].day}T12:00:00Z`)] : undefined}
            />
          </Panel>
          {/* os três tipos num painel só, embaixo do gráfico: no celular, três linhas curtas em vez de três cartões altos */}
          <Panel>
            <PanelTitle>{tr('By type of purchase', 'Por tipo de compra')}</PanelTitle>
            <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:gap-4 sm:divide-y-0">
              {kinds.map((k) => (
                <div key={k.key} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0 max-[359px]:block sm:block sm:py-0">
                  <dt className="min-w-0">
                    <div className="text-sm text-ink sm:text-xs sm:font-medium sm:uppercase sm:tracking-[0.12em] sm:text-faint">{k.label}</div>
                    <div className="text-xs text-muted sm:hidden">{k.sub}</div>
                  </dt>
                  <dd className="shrink-0 text-right max-[359px]:mt-1 max-[359px]:text-left sm:mt-1.5 sm:text-left">
                    <span className="tnum font-display text-lg font-semibold tracking-tight sm:text-2xl">{usd(k.value)}</span>
                    <span className="tnum ml-2 text-xs text-faint sm:ml-0 sm:mt-1 sm:block sm:text-muted">
                      <span className="hidden sm:inline">{k.sub} · </span>{share(k.value)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3">
              <Why>
                {tr(
                  `Subscriptions are the charges from the list in the Subscriptions tab (not the "Subscriptions & software" category). Everything else splits by amount: under ${usd0(200)} is everyday spending (food, transport, groceries); ${usd0(200)} or more is a one-off purchase, the kind that moves a month's total the most. The % is of the period's total.`,
                  `Assinaturas são as cobranças da lista da aba Assinaturas (não a categoria "Assinaturas e software"). O resto se divide pelo valor: abaixo de ${usd0(200)} é o dia a dia (comida, transporte, mercado); ${usd0(200)} ou mais é compra avulsa, a que mais mexe no total de um mês. O % é sobre o total do período.`,
                )}
              </Why>
            </div>
          </Panel>
        </div>
      </div>
      {needs.allList}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle>{tr('By category', 'Por categoria')}</PanelTitle>
          {donutFull.length ? (
            <>
              <Donut data={donutFull} centerLabel={refundGap > 0 ? tr('in purchases', 'em compras') : undefined} />
              {refundGap > 0 ? (
                <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
                  {tr(
                    `Refunds beyond their category's purchases: −${usd(refundGap)} (not in the chart). Net total for the period: ${usd(s.total)}.`,
                    `Estornos acima das compras da própria categoria: −${usd(refundGap)} (fora da rosca). Total líquido do período: ${usd(s.total)}.`,
                  )}
                </p>
              ) : null}
            </>
          ) : <div className="py-10 text-center text-sm text-faint">{tr('No purchases in this period', 'Sem compras no período')}</div>}
        </Panel>
        <Panel>
          <PanelTitle>{tr('Merchants', 'Estabelecimentos')}</PanelTitle>
          {s.byMerchant.length ? (
            <HBars data={s.byMerchant.slice(0, 8).map((m) => ({ label: m.name, value: m.total }))} />
          ) : (
            <div className="py-10 text-center text-sm text-faint">{tr('No purchases in this period', 'Sem compras no período')}</div>
          )}
        </Panel>
      </div>

      {/* resumo só: a análise (e a lista) mora na aba Assinaturas, para não haver duas listas que discordam */}
      <Panel>
        <PanelTitle hint={<button className={hintLinkClass} onClick={onOpenSubscriptions}>{tr('see full analysis', 'ver análise completa')}</button>}>
          <span className="inline-flex items-center gap-2"><Repeat className="size-3.5" aria-hidden="true" /> {tr('Subscriptions', 'Assinaturas')}</span>
        </PanelTitle>
        {subsReport.records.length ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <div className="tnum text-2xl font-semibold tracking-tight">{activeSubs}</div>
                <div className="text-xs text-muted">{activeSubs === 1 ? tr('active', 'ativa') : tr('active', 'ativas')}</div>
              </div>
              <div>
                <div className="tnum text-2xl font-semibold tracking-tight">{usd0(subsReport.monthlyTotalUsd)}<span className="text-sm font-normal text-faint">{tr('/mo', '/mês')}</span></div>
                <div className="tnum text-xs text-muted">
                  {subsHome && fx ? `≈ ${money(subsHome.monthly, fx.currency, { compact: true })} · ` : ''}{usd0(subsReport.annualTotalUsd)} {tr('a year', 'por ano')}
                </div>
              </div>
              {nextSub?.nextRenewal && nextSub.daysUntil !== null ? (
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{nextSub.name}</div>
                  <div className="text-xs text-muted">{nb(`${tr('next', 'próxima')}: ${renewsIn(nextSub.daysUntil)} · ${dateShort(`${nextSub.nextRenewal}T12:00:00Z`)}`)}</div>
                </div>
              ) : null}
            </div>
            {/* cada parte do "esperando você" leva aonde ela se resolve: renovações em Assinaturas, alertas no "Precisa de atenção" desta tela */}
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              {attention.renewals ? (
                <Button variant="primary" className="justify-center text-balance" onClick={onOpenSubscriptions}>
                  {attention.renewals === 1 ? tr('1 renewal waiting on you', '1 renovação esperando você') : tr(`${attention.renewals} renewals waiting on you`, `${attention.renewals} renovações esperando você`)}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button variant="outline" className="justify-center" onClick={onOpenSubscriptions}>
                  {tr('See full analysis', 'Ver análise completa')}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              )}
              {attention.alerts ? (
                // 44 px de verdade no toque (sem o .tap, cuja área invisível encostaria no botão de cima e no "por quê?")
                <a href={`#/${VIEW_SLUG.spending}?item=alerts`} className="inline-flex min-h-11 items-center justify-center gap-1 text-xs text-muted underline-offset-2 hover:text-ink hover:underline sm:justify-end pointer-fine:sm:min-h-6">
                  {attention.alerts === 1 ? tr('+ 1 purchase alert in Needs attention', '+ 1 alerta de compra em Precisa de atenção') : tr(`+ ${attention.alerts} purchase alerts in Needs attention`, `+ ${attention.alerts} alertas de compra em Precisa de atenção`)}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <Empty title={tr('No subscriptions in the history loaded.', 'Nenhuma assinatura no histórico carregado.')} />
        )}
        <div className="mt-3">
          <Why>
            {tr(
              'The same numbers as the Subscriptions tab: card charges matched against services known to bill subscriptions (and against your emails, when available). Cost per month = last charge ÷ months in the cycle, only for active ones with a known cycle.',
              'Os mesmos números da aba Assinaturas: cobranças do cartão cruzadas com serviços conhecidos por cobrar assinatura (e com os emails, quando disponíveis). Custo por mês = última cobrança ÷ meses do ciclo, só das ativas com ciclo conhecido.',
            )}
          </Why>
        </div>
      </Panel>

      <section className="space-y-3" aria-labelledby="month-by-month">
        <h2 id="month-by-month" className="text-lg font-semibold tracking-tight">{tr('Month by month', 'Mês a mês')}</h2>
        {fullMonths >= 2 || (dropped && months.length >= 2) ? (
          <EvolutionSection onOpenMonth={onOpenMonth} />
        ) : (
          <Empty
            title={tr('Shows up once the history has 2 full months.', 'Aparece quando houver 2 meses inteiros no histórico.')}
            hint={dataset.coverage
              ? tr(
                  `History loaded: ${dateRange(dataset.coverage.from, dataset.coverage.to)}. Comparing a partial month with a full one would lead to a false conclusion.`,
                  `Histórico carregado: ${dateRange(dataset.coverage.from, dataset.coverage.to)}. Comparar mês incompleto com mês inteiro daria uma conclusão falsa.`,
                )
              : undefined}
          />
        )}
      </section>

      {trips.length ? (
        <section className="space-y-3" aria-labelledby="trips">
          <h2 id="trips" className="text-lg font-semibold tracking-tight">{tr('Trips', 'Viagens')}</h2>
          <TripsSection />
        </section>
      ) : null}
    </div>
  );
}, (a, b) => a.target === b.target);
