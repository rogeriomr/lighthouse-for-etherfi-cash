import { Fragment, useId } from 'react';
import { milestoneApprox, partialPct, RATE_MAX, type Earnings, type EarningsPrefs, type EarningsSource } from '../lib/earnings';
import { CASHBACK_PAYOUT, CASHBACK_PLAN_RATES } from '../lib/insights/cashbackPlans';
import type { CashTier } from '../lib/insights/types';

const TIERS: readonly CashTier[] = ['core', 'luxe', 'pinnacle', 'vip'];
import { dateShort, nb, pct, usd, usd0 } from '../lib/format';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';
import { Badge, Panel, PanelTitle, Segmented, Why } from './ui';
import { AsTable } from './charts';
import { EarningsFlow, type FlowSource, type FlowTarget } from './earningsFlow';
import { Ladder } from './earningsParts';
import { colorOfSource, EARN_COLORS, flowOrder } from './earningsData';

// Os painéis da tela Ganhos (views/Earnings.tsx): a cobertura com o medidor, o fluxo das fontes até o que elas pagam,
// as fontes com os controles do cashback e a escada de marcos. Os textos de conta ("por quê?") vêm prontos do motor.

type Tr = ReturnType<typeof useTr>;

export interface PeriodFmt {
  yearly: boolean;
  /** valor do período escolhido (o mensal ou o anual) */
  amt: (monthly: number, annual: number) => string;
  /** "por mês" / "por ano" */
  per: string;
}

export function periodFmt(prefs: EarningsPrefs, tr: Tr): PeriodFmt {
  const yearly = prefs.period === 'annual';
  return { yearly, amt: (m, a) => usd(yearly ? a : m), per: yearly ? tr('a year', 'por ano') : tr('a month', 'por mês') };
}

/**
 * O nome de uma fonte no fluxo, no medidor e na tabela: os cofres pelo símbolo, como o app da ether.fi escreve, e o
 * grupo dos outros ativos com APY pelo nome curto ("Outros com APY"), com os símbolos (weETH) no detalhe.
 */
export function sourceLabel(s: EarningsSource, tr: Tr): string {
  return s.kind === 'other' ? tr('Other APY assets', 'Outros com APY') : s.label;
}

/** Frase do motor com os números em destaque: os dígitos (e o "US$" junto) ficam na cor do texto, o resto esmaecido. */
function Emphasis({ text }: { text: string }) {
  const parts = text.split(/((?:US)?\$\s?[\d.,]+|\d[\d.,]*%?)/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <span key={i} className="text-ink">{p}</span> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

/**
 * A frase-herói em duas partes. O h1 (no máximo 2 linhas): "Seus ganhos cobrem 10 de 13 assinaturas". Embaixo, os
 * valores: "US$ 132,56 de US$ 196,76 por mês (67%) · parte de mais 1", ou a sobra quando cobre tudo. Sem recorrência ou
 * sem ganho, vale a frase do motor inteira.
 */
function heroText(e: Earnings, f: PeriodFmt, tr: Tr): { title: string; sub: string | null } {
  const a = e.allocation;
  const n = a.count;
  if (!n || !(e.totalMonthly > 0)) return { title: e.texts.headline[f.yearly ? 'annual' : 'monthly'].replace(/\.$/, ''), sub: null };
  const subs = a.allSubscriptions;
  const nounEn = (k: number) => (subs ? (k === 1 ? 'subscription' : 'subscriptions') : k === 1 ? 'item' : 'items');
  const nounPt = (k: number) => (subs ? (k === 1 ? 'assinatura' : 'assinaturas') : k === 1 ? 'item' : 'itens');
  const c = a.coveredCount;
  const paid = f.amt(a.coveredMonthly, a.coveredAnnual);
  const total = f.amt(a.totalMonthly, a.totalAnnual);
  const share = pct(a.count > 0 && c === a.count ? 100 : a.coverage > 0 ? partialPct(a.coverage) : 0);
  if (c === n) {
    const left = a.leftoverMonthly > 0.005 ? tr(` · ${f.amt(a.leftoverMonthly, a.leftoverAnnual)} left over`, ` · ${f.amt(a.leftoverMonthly, a.leftoverAnnual)} de sobra`) : '';
    return {
      title: n === 1
        ? tr(`Your earnings cover your ${nounEn(1)}`, `Seus ganhos cobrem ${subs ? 'a sua assinatura' : 'o seu item'}`)
        : tr(`Your earnings cover all ${n} ${nounEn(n)}`, `Seus ganhos cobrem ${subs ? 'todas as' : 'todos os'} ${n} ${nounPt(n)}`),
      sub: `${tr(`${total} ${f.per}`, `${total} ${f.per}`)}${left}`,
    };
  }
  // o trecho não se parte no fim da linha ("parte de / mais 1"): só pode quebrar depois do "·"
  const part = a.partialCount ? tr(' · part of 1 more', ' · parte de mais 1') : '';
  if (c === 0) {
    return {
      title: tr(`Your earnings cover part of 1 of ${n} ${nounEn(n)}`, `Seus ganhos cobrem parte de 1 de ${n} ${nounPt(n)}`),
      sub: tr(`${paid} of ${total} ${f.per} (${share})`, `${paid} de ${total} ${f.per} (${share})`),
    };
  }
  return {
    title: tr(`Your earnings cover ${c} of ${n} ${nounEn(n)}`, `Seus ganhos cobrem ${c} de ${n} ${nounPt(n)}`),
    sub: `${tr(`${paid} of ${total} ${f.per} (${share})`, `${paid} de ${total} ${f.per} (${share})`)}${part}`,
  };
}

/**
 * O topo: a frase-herói (h1 com os números em destaque e a linha dos valores) e, ao lado, por mês ou por ano. Sem
 * `onPeriod` (estado vazio, sem valor para trocar), a alternância não aparece.
 */
export function EarningsHeader({ e, f, period, onPeriod }: { e: Earnings; f: PeriodFmt; period: EarningsPrefs['period']; onPeriod?: (p: EarningsPrefs['period']) => void }) {
  const tr = useTr();
  const { title, sub } = heroText(e, f, tr);
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-4xl">
        <p aria-hidden className="text-xs font-medium uppercase tracking-[0.12em] text-faint">{tr('Earnings', 'Ganhos')}</p>
        <h1 className="mt-1.5 font-display text-[clamp(1.625rem,5.5vw,2.5rem)] leading-[1.1] font-semibold tracking-tight text-balance text-muted">
          <span className="sr-only">{tr('Earnings: ', 'Ganhos: ')}</span>
          <Emphasis text={nb(title)} />
        </h1>
        {/* os valores ("US$ X de US$ Y", a sobra) moram na conta do mês, logo abaixo: aqui fica só o selo */}
        {sub ? <p className="mt-2"><Badge>{tr('Estimate', 'Estimativa')}</Badge></p> : null}
      </div>
      {onPeriod ? (
        <Segmented
          ariaLabel={tr('Show amounts', 'Mostrar valores')}
          value={period}
          onChange={onPeriod}
          options={[
            { value: 'monthly', label: tr('Per month', 'Por mês') },
            { value: 'annual', label: tr('Per year', 'Por ano') },
          ]}
        />
      ) : null}
    </div>
  );
}

// ---------- o fluxo ----------

/**
 * Das fontes ao que elas pagam: o fluxo (SVG próprio), a linha do que ainda não tem cobertura, o gêmeo em tabela e
 * o "por quê?" com a convenção das faixas. Sem ganhos ou sem itens, uma frase no lugar do desenho.
 */
export function FlowPanel({ e, f }: { e: Earnings; f: PeriodFmt }) {
  const tr = useTr();
  const a = e.allocation;
  const holding = (id: string) => [...e.yield.liquid.holdings, ...e.yield.other.holdings].find((h) => `vault:${h.asset}` === id);
  const sources: FlowSource[] = flowOrder(e.sources).map((s) => {
    const h = s.kind === 'vault' ? holding(s.id) : undefined;
    // o cofre com o APY, os outros com os símbolos (weETH), o cashback com a taxa
    const extra = h ? pct(h.apy, 1) : s.kind === 'other' ? s.detail ?? '' : s.kind === 'cashback' && e.cashback.rate !== null ? pct(e.cashback.rate * 100, 2) : '';
    return { id: s.id, label: sourceLabel(s, tr), detail: nb(`${f.amt(s.monthly, s.annual)}${extra ? ` · ${extra}` : ''}`), value: s.monthly, color: colorOfSource(s) };
  });
  const paid = a.rows.filter((r) => r.paidMonthly > 0.005);
  const targets: FlowTarget[] = [
    ...paid.map((r) => ({
      id: r.item.key,
      label: r.item.name,
      kind: r.status === 'covered' ? ('full' as const) : ('partial' as const),
      value: r.paidMonthly,
      // o parcial mostra o item inteiro no desenho (o resto em trilho) e a pizza no rótulo
      ...(r.status === 'partial' ? { whole: r.item.monthly, share: r.share } : {}),
      detail: r.status === 'covered'
        ? f.amt(r.item.monthly, r.item.annual)
        : nb(tr(`${pct(partialPct(r.share))} of ${f.amt(r.item.monthly, r.item.annual)}`, `${pct(partialPct(r.share))} de ${f.amt(r.item.monthly, r.item.annual)}`)),
    })),
    ...(a.leftoverMonthly > 0.005
      ? [{ id: 'leftover', label: tr('Left over', 'Sobra'), kind: 'leftover' as const, value: a.leftoverMonthly, detail: f.amt(a.leftoverMonthly, a.leftoverAnnual) }]
      : []),
  ];
  const open = a.rows.filter((r) => r.status === 'uncovered');
  const openMonthly = open.reduce((s, r) => s + r.item.monthly, 0);
  const openAnnual = open.reduce((s, r) => s + r.item.annual, 0);
  const canDraw = sources.length > 0 && paid.length > 0;
  const subtitle = canDraw
    ? tr(
      'Your estimated earnings, from where they come on the left to what they pay on the right, in the list’s order.',
      'Os seus ganhos estimados: de onde vêm, à esquerda, até o que pagam, à direita, na ordem da lista.',
    )
    : null;
  return (
    <Panel className="flex flex-col">
      <PanelTitle hint={<Badge>{tr('Estimate', 'Estimativa')}</Badge>}>{tr('Where it comes from, what it pays', 'De onde vem, o que paga')}</PanelTitle>
      {subtitle ? <p className="-mt-2 mb-4 text-xs leading-relaxed text-muted">{subtitle}</p> : null}
      {canDraw ? (
        <EarningsFlow
          sources={sources}
          targets={targets}
          ariaSources={tr(`Earnings sources, ${f.per}`, `Fontes de ganho, ${f.per}`)}
          ariaTargets={tr('What they pay', 'O que elas pagam')}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          {!sources.length
            ? tr('No estimated earnings today, so there’s nothing flowing yet.', 'Sem ganhos estimados hoje, então ainda não há o que fluir.')
            : tr('Nothing recurring to pay yet: add an item by hand below.', 'Ainda não há recorrências para pagar: adicione um item à mão abaixo.')}
        </p>
      )}
      {canDraw && open.length ? (
        <p className="tnum mt-3 text-xs text-muted">
          {nb(tr(
            `+ ${open.length} not covered yet · ${f.amt(openMonthly, openAnnual)} ${f.per}`,
            `+ ${open.length} ${open.length === 1 ? 'ainda sem cobertura' : 'ainda sem cobertura'} · ${f.amt(openMonthly, openAnnual)} ${f.per}`,
          ))}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-start gap-x-5 gap-y-2 pt-4">
        {canDraw ? (
          <AsTable label={tr('Sources and what they pay, as a table', 'Fontes e o que pagam, em tabela')}>
            <FlowTable e={e} f={f} />
          </AsTable>
        ) : null}
        <Why>
          <p>
            {tr(
              'Money has no label: the bands show the sum of your earnings paying the list in its order, so the first sources reach the first items. A band’s thickness is its share of the monthly earnings.',
              'Dinheiro não tem carimbo: as faixas mostram a soma dos ganhos pagando a lista na ordem dela, então as primeiras fontes chegam aos primeiros itens. A espessura de cada faixa é a parte dela nos ganhos do mês.',
            )}
          </p>
          <p className="mt-2">{e.texts.why.sources}</p>
        </Why>
      </div>
    </Panel>
  );
}

/** O gêmeo do fluxo: as fontes e o que cada item recebe, sem depender de cor nem de ponteiro. */
function FlowTable({ e, f }: { e: Earnings; f: PeriodFmt }) {
  const tr = useTr();
  const a = e.allocation;
  const th = 'px-3 py-2 font-medium';
  const status = (s: string) => (s === 'covered' ? tr('paid in full', 'pago inteiro') : s === 'partial' ? tr('in part', 'em parte') : tr('not covered', 'sem cobertura'));
  return (
    <div className="space-y-3">
      <table className="w-full min-w-[300px] text-xs">
        <caption className="sr-only">{tr('Earnings sources', 'Fontes de ganho')}</caption>
        <thead>
          <tr className="border-b border-line text-left uppercase tracking-wider text-faint">
            <th scope="col" className={th}>{tr('Source', 'Fonte')}</th>
            <th scope="col" className={cx(th, 'text-right')}>{f.yearly ? tr('Per year', 'Por ano') : tr('Per month', 'Por mês')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {flowOrder(e.sources).map((s) => (
            <tr key={s.id}>
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">{sourceLabel(s, tr)}{s.kind === 'other' && s.detail ? ` (${s.detail})` : ''}</th>
              <td className="tnum px-3 py-1.5 text-right text-ink">{f.amt(s.monthly, s.annual)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="px-3 py-1.5 text-left font-medium text-ink">Total</th>
            <td className="tnum px-3 py-1.5 text-right font-medium text-ink">{f.amt(e.totalMonthly, e.totalAnnual)}</td>
          </tr>
        </tbody>
      </table>
      <table className="w-full min-w-[300px] text-xs">
        <caption className="sr-only">{tr('What the earnings pay, in order', 'O que os ganhos pagam, na ordem')}</caption>
        <thead>
          <tr className="border-b border-line text-left uppercase tracking-wider text-faint">
            <th scope="col" className={th}>#</th>
            <th scope="col" className={th}>{tr('Item', 'Item')}</th>
            <th scope="col" className={cx(th, 'text-right')}>{tr('Paid', 'Pago')}</th>
            <th scope="col" className={cx(th, 'text-right')}>{tr('Cost', 'Custo')}</th>
            <th scope="col" className={th}>{tr('Status', 'Situação')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {a.rows.map((r) => (
            <tr key={r.item.key}>
              <td className="tnum px-3 py-1.5 text-faint">{r.rank}</td>
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-ink">{r.item.name}</th>
              <td className="tnum px-3 py-1.5 text-right text-ink">{f.amt(r.paidMonthly, r.paidAnnual)}</td>
              <td className="tnum px-3 py-1.5 text-right text-muted">{f.amt(r.item.monthly, r.item.annual)}</td>
              <td className="px-3 py-1.5 text-muted">{status(r.status)}</td>
            </tr>
          ))}
          {a.leftoverMonthly > 0.005 ? (
            <tr>
              <td className="px-3 py-1.5" />
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">{tr('Left over', 'Sobra')}</th>
              <td className="tnum px-3 py-1.5 text-right text-ink">{f.amt(a.leftoverMonthly, a.leftoverAnnual)}</td>
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5" />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

// ---------- os controles do cashback ----------

/**
 * Marcas no trilho do controle (a do plano e a observada), na posição da taxa. Longe uma da outra, cada rótulo fica
 * centrado na sua marca. Perto, em duas linhas: a marca da taxa maior tem a haste curta e o rótulo em cima; a da menor,
 * a haste longa e o rótulo embaixo; os dois rótulos saem da própria marca para a direita, e nenhuma haste corta texto.
 */
function RateTicks({ ticks }: { ticks: { key: string; rate: number; label: string }[] }) {
  if (!ticks.length) return null;
  const sorted = [...ticks].sort((x, y) => x.rate - y.rate);
  const frac = (r: number) => Math.min(1, Math.max(0, r / RATE_MAX));
  // o polegar do controle nativo tem ~16 px: a marca segue o centro dele
  const left = (r: number) => `calc(8px + (100% - 16px) * ${frac(r)})`;
  const stacked = sorted.length > 1 && Math.abs(sorted[1].rate - sorted[0].rate) < RATE_MAX * 0.3;
  return (
    <div aria-hidden className={cx('relative', stacked ? 'h-12' : 'h-7')}>
      {sorted.map((t, i) => {
        const long = stacked && i === 0;
        // perto do fim do trilho, o rótulo sai para a esquerda e não passa do cartão
        const side = !stacked ? '-translate-x-1/2' : frac(t.rate) > 0.7 ? '-translate-x-full' : '';
        return (
          <div key={t.key} className="absolute top-0" style={{ left: left(t.rate) }}>
            <span className={cx('absolute top-0 left-0 w-px bg-field', long ? 'h-7' : 'h-1.5')} />
            <span className={cx('absolute left-0 whitespace-nowrap text-xs leading-4 text-faint', long ? 'top-7' : 'top-2', side, stacked && 'pl-1')}>
              {t.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Percentual de um item pago em parte: nunca "100%" (ele não está inteiro) nem "0%" (algo chegou). */
export { partialPct };

/**
 * As fontes: o rendimento de cada cofre Liquid, os outros ativos com APY e o cashback previsto, com os dois controles
 * do cashback (a base de gasto e a taxa, que mostra a observada e a do plano). Tudo o que a pessoa muda fica só neste
 * navegador.
 */
export function SourcesPanel({ e, prefs, onPrefs }: { e: Earnings; prefs: EarningsPrefs; onPrefs: (p: EarningsPrefs) => void }) {
  const tr = useTr();
  const rateId = useId();
  const c = e.cashback;
  const ratePct = (r: number) => pct(r * 100, 2);
  const custom = prefs.rate !== undefined;
  const value = prefs.rate ?? c.autoRate ?? 0;
  const setRate = (r: number | undefined) => {
    const next = { ...prefs };
    if (r === undefined) delete next.rate;
    else next.rate = Math.round(r * 10000) / 10000;
    onPrefs(next);
  };
  // a marca do plano fica na taxa média que as faixas dele dão sobre a base (não na da 1ª faixa)
  const planRate = c.plan ? (c.autoSource === 'plan' && c.autoRate !== null ? c.autoRate : c.plan.rate) : null;
  const ticks = [
    ...(c.plan && planRate !== null ? [{ key: 'plan', rate: planRate, label: tr(`${c.plan.label} plan ${ratePct(planRate)}`, `plano ${c.plan.label} ${ratePct(planRate)}`) }] : []),
    ...(c.observed.ok ? [{ key: 'observed', rate: c.observed.rate, label: tr(`observed ${ratePct(c.observed.rate)}`, `observada ${ratePct(c.observed.rate)}`) }] : []),
  ];
  const tiers = CASHBACK_PLAN_RATES.filter((p) => (TIERS as readonly string[]).includes(p.id));
  const tier = (prefs.tier ?? tiers.find((p) => p.default)?.id ?? 'core') as CashTier;
  const sourceName = c.rateSource === 'custom'
    ? tr('set by you', 'escolhida por você')
    : c.rateSource === 'observed' ? tr('observed in your history', 'observada no seu histórico')
      : c.rateSource === 'plan' && c.plan ? tr(`public rate of the ${c.plan.label} plan`, `taxa pública do plano ${c.plan.label}`) : tr('no rate yet', 'ainda sem taxa');
  const baseValue = c.base.monthly;
  // cashback zero: por que (sem gasto no cartão, histórico curto, nenhuma recorrência no cartão, sem taxa)
  const noCash = !(c.monthly > 0);
  const noCashReason = !noCash ? null
    : baseValue === null ? tr(`No estimate: the history has only ${c.base.card.days} days, too short for a card average.`, `Sem estimativa: o histórico tem só ${c.base.card.days} dias, pouco para uma média do cartão.`)
      : baseValue === 0 && prefs.base === 'card' ? tr(`No card spending in the last ${c.base.card.days} days.`, `Sem gasto no cartão nos últimos ${c.base.card.days} dias.`)
        : baseValue === 0 ? tr('No recurring item paid with the card.', 'Nenhuma recorrência paga no cartão.')
          : c.rate === null ? tr('No cashback rate yet.', 'Ainda sem taxa de cashback.')
            : tr('Your own rate is set to 0%.', 'A sua taxa própria está em 0%.');
  const label = 'text-xs font-medium uppercase tracking-[0.12em] text-faint';
  return (
    <Panel>
      {/* os valores já estão na conta do mês: aqui ficam a conta do cashback, os controles dela e os "por quê?" */}
      <PanelTitle>{tr('Adjust the math', 'Ajustes da conta')}</PanelTitle>

      <section aria-labelledby={`${rateId}-c`} className="grid gap-y-4">
        <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 id={`${rateId}-c`} className={cx(label, 'inline-flex items-center gap-2')}>
            {/* sem cashback, a amostra fica vazada (como o "ainda não coberto"): ele não entra no fluxo */}
            {noCash
              ? <span aria-hidden className="size-2.5 rounded-full border border-field" />
              : <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: EARN_COLORS.cashback }} />}
            {tr('Expected cashback', 'Cashback previsto')}
          </h3>
          {/* o valor já está na conta do mês; sem cashback, a linha de baixo diz o motivo (e o fluxo não tem nó de US$ 0) */}
        </div>
        <p className="tnum mt-1 text-[13px] leading-snug text-faint">
          {noCash && noCashReason
            ? noCashReason
            : baseValue !== null && c.rate !== null
              ? nb(tr(`${usd(baseValue)} a month × ${ratePct(c.rate)}`, `${usd(baseValue)} por mês × ${ratePct(c.rate)}`))
              : baseValue === null ? tr('No spending base yet', 'Ainda sem base de gasto') : tr('No rate yet', 'Ainda sem taxa')}
        </p>
        {/* o cashback chega em token de preço variável: o valor em US$ é sempre estimativa */}
        <p className="mt-0.5 text-xs leading-relaxed text-faint">
          {tr(
            `Paid in ${CASHBACK_PAYOUT.token}, a token whose price varies: the US$ value moves between earning and claiming.`,
            `Pago em ${CASHBACK_PAYOUT.token}, um token de preço variável: o valor em US$ muda entre ganhar e resgatar.`,
          )}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          {tr('Your choices here are saved in this browser only.', 'O que você escolhe aqui fica salvo só neste navegador.')}
        </p>
        </div>

        <div>
        <div>
          <p id={`${rateId}-b`} className="text-sm text-muted">{tr('Spending base', 'Base de gasto')}</p>
          <div className="mt-1.5">
            <Segmented
              ariaLabel={tr('Spending base', 'Base de gasto')}
              value={prefs.base}
              onChange={(base) => onPrefs({ ...prefs, base })}
              options={[
                { value: 'card', label: tr('Card average', 'Média do cartão') },
                { value: 'recurring', label: tr('Recurring only', 'Só recorrências') },
              ]}
            />
          </div>
        </div>

        {/* a taxa: o plano (Core por padrão, pelas faixas do mês) ou, se a pessoa quiser, uma taxa própria no controle */}
        {tiers.length ? (
          <div className="mt-4">
            <p className="text-sm text-muted">{tr('Plan', 'Plano')}</p>
            <div className="mt-1.5">
              <Segmented
                ariaLabel={tr('Your ether.fi Cash plan', 'O seu plano no ether.fi Cash')}
                value={tier}
                onChange={(t) => {
                  const next = { ...prefs, tier: t };
                  // escolher um plano volta a taxa para a dele
                  delete next.rate;
                  onPrefs(next);
                }}
                options={tiers.map((p) => ({ value: p.id as CashTier, label: p.label }))}
              />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-faint">
              {c.planIsDefault
                ? tr('Everyone starts at Core. Your plan is in the ether.fi app; pick it here to use its public rates.', 'Todo mundo começa no Core. O seu plano está no app da ether.fi; escolha aqui para usar as taxas públicas dele.')
                : tr('Saved in this browser only. The connector doesn’t report your plan.', 'Fica salvo só neste navegador. O conector não informa o seu plano.')}
            </p>
          </div>
        ) : null}
        </div>

        <div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink pointer-fine:min-h-8">
            <input
              type="checkbox"
              checked={custom}
              onChange={(ev) => setRate(ev.target.checked ? (c.autoRate ?? 0) : undefined)}
              className="size-5 cursor-pointer accent-[var(--color-accent)] pointer-fine:size-4"
            />
            {tr('Use my own rate', 'Usar uma taxa própria')}
          </label>
          {custom ? (
            <>
              <label htmlFor={rateId} className="mt-2 flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted">{tr('Your rate', 'A sua taxa')}</span>
                <output htmlFor={rateId} className="tnum font-medium text-ink">{ratePct(value)}</output>
              </label>
              <input
                id={rateId}
                type="range"
                min={0}
                max={RATE_MAX * 100}
                step={0.05}
                value={Math.round(value * 10000) / 100}
                onChange={(ev) => setRate(Number(ev.target.value) / 100)}
                aria-valuetext={tr(`${ratePct(value)}, ${sourceName}`, `${ratePct(value)}, ${sourceName}`)}
                className="mt-2 h-11 w-full cursor-pointer accent-[var(--color-accent)] pointer-fine:h-6"
              />
              <RateTicks ticks={ticks} />
            </>
          ) : null}
          {/* uma linha-resumo à vista; as faixas, a conta da observada e a fonte ficam no "por quê? (cashback)" */}
          <p className="mt-1 text-xs text-faint">
            {tr('Rate: ', 'Taxa: ')}{sourceName}{c.rate !== null ? nb(` · ${ratePct(c.rate)}`) : ''}
            {c.observed.ok ? nb(tr(` · observed ${ratePct(c.observed.rate)}`, ` · observada ${ratePct(c.observed.rate)}`)) : ''}
          </p>
          {c.planStale ? (
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {tr('The plan table was checked a while ago and may have changed: confirm in the ether.fi app.', 'A tabela do plano foi conferida há um tempo e pode ter mudado: confira no app da ether.fi.')}
            </p>
          ) : null}
        </div>
      </section>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {/* o "por quê?" do rendimento mora na conta do mês, junto das linhas do Liquid */}
        <Why label={tr('why? (cashback)', 'por quê? (cashback)')}>
          <p>{e.texts.why.cashback}</p>
          {/* a observada nos resgates, para comparar com a previsão (a conta, ou por que ainda não dá para medir) */}
          {e.texts.observed ? <p className="mt-2">{e.texts.observed}</p> : null}
          {c.plan ? (
            <p className="mt-2">
              {tr('Source: ', 'Fonte: ')}
              <a href={c.plan.source.url} target="_blank" rel="noopener noreferrer" className="tap text-muted underline underline-offset-2 hover:text-ink">
                {c.plan.source.label}<span aria-hidden> ↗</span><span className="sr-only">{tr(' (opens in a new tab)', ' (abre em outra aba)')}</span>
              </a>
              {nb(tr(` · checked on ${dateShort(`${c.plan.source.checked.slice(0, 10)}T12:00:00Z`)}`, ` · conferida em ${dateShort(`${c.plan.source.checked.slice(0, 10)}T12:00:00Z`)}`))}
            </p>
          ) : null}
        </Why>
      </div>
    </Panel>
  );
}

// ---------- metas e marcos ----------

/**
 * Quanto no Liquid cobriria 50%, 75% e 100% do custo das recorrências, ao APY de hoje: uma linha por meta, com o total
 * no Liquid em destaque e, embaixo, quanto é a mais que hoje e quantos itens ficariam pagos inteiros. `compact`: a
 * versão do Portfólio, mais justa. `tiles`: um cartão por meta, lado a lado a partir de 640 px (o topo da tela Ganhos).
 * O saldo de hoje e o "por quê?" ficam no resumo (earningsHero.tsx).
 */
export function CoverageTargetsList({ e, compact, tiles }: { e: Earnings; compact?: boolean; tiles?: boolean }) {
  const tr = useTr();
  const t = e.targets;
  const a = e.allocation;
  if (t.kind !== 'targets') return <p className="text-sm leading-relaxed text-muted">{t.text}</p>;
  const noun = a.allSubscriptions ? 'subscriptions' : 'items';
  const inFull = (k: number) => nb(tr(`${k} of ${a.count} ${noun} in full`, `${k} de ${a.count} ${a.allSubscriptions ? 'assinaturas inteiras' : 'itens inteiros'}`));
  if (tiles) {
    return (
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {t.targets.map((x) => (
          <li key={x.share} className="rounded-xl border border-line bg-panel2/40 px-4 py-3">
            <p className="flex items-baseline justify-between gap-3">
              <span className="tnum font-display text-2xl font-semibold tracking-tight text-ink">{pct(x.share * 100)}</span>
              <span className="tnum text-xs text-faint">{nb(tr(`${usd(x.earningsMonthly)} a month`, `${usd(x.earningsMonthly)} por mês`))}</span>
            </p>
            {x.reached ? (
              <p className="mt-2 text-sm text-good">{tr('Your earnings already cover it', 'Os ganhos já cobrem')}</p>
            ) : (
              <>
                <p className="tnum mt-2 text-[15px] font-medium text-ink">{nb(tr(`≈ ${usd0(x.approxTotal)} in Liquid`, `≈ ${usd0(x.approxTotal)} no Liquid`))}</p>
                <p className="mt-0.5 text-xs leading-snug text-faint">{nb(tr(`≈ ${usd0(x.approxExtra)} more than today`, `≈ ${usd0(x.approxExtra)} a mais que hoje`))}</p>
                <p className="text-xs leading-snug text-faint">{inFull(x.coveredCount)}</p>
              </>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={cx('divide-y divide-line', compact ? 'text-sm' : '')}>
      {t.targets.map((x) => (
        <li key={x.share} className={cx('grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-x-3', compact ? 'py-2' : 'py-2.5')}>
          <span className="tnum font-display text-lg font-semibold tracking-tight text-ink">{pct(x.share * 100)}</span>
          {x.reached ? (
            <span className="text-sm text-good">{tr('Your earnings already cover it', 'Os ganhos já cobrem')}</span>
          ) : (
            <span className="min-w-0">
              <span className="tnum text-[15px] font-medium text-ink">{nb(tr(`≈ ${usd0(x.approxTotal)} in Liquid`, `≈ ${usd0(x.approxTotal)} no Liquid`))}</span>
              {/* duas linhas curtas: o que é a mais, e quantos itens ficariam pagos inteiros (nenhuma parte no meio) */}
              <span className="mt-0.5 block text-xs leading-snug text-faint">{nb(tr(`≈ ${usd0(x.approxExtra)} more than today`, `≈ ${usd0(x.approxExtra)} a mais que hoje`))}</span>
              <span className="block text-xs leading-snug text-faint">{inFull(x.coveredCount)}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A escada: os próximos 2 ou 3 itens e o valor a mais no Liquid que cobriria cada um, com o selo e o "por quê?". */
export function MilestonesPanel({ e }: { e: Earnings }) {
  const tr = useTr();
  const m = e.milestones;
  const a = e.allocation;
  const noun = (n: number) => (a.allSubscriptions ? tr(n === 1 ? 'subscription' : 'subscriptions', n === 1 ? 'assinatura' : 'assinaturas') : tr(n === 1 ? 'item' : 'items', n === 1 ? 'item' : 'itens'));
  return (
    <Panel>
      <PanelTitle>{tr('Next milestones', 'Próximos marcos')}</PanelTitle>
      <p className="-mt-2 mb-4"><Badge>{e.texts.note}</Badge></p>
      {m.kind === 'ladder' ? (
        <>
          <Ladder
            steps={m.steps.map((s) => {
              // centenas com "≈": um APY que varia não sustenta US$ 1.590; para cima, para o valor ainda cobrir
              const approx = milestoneApprox(s.extra);
              const name = s.item.name;
              return {
                key: s.item.key,
                lead: nb(tr(`With ≈ ${usd0(approx)} more earning in Liquid,`, `Com ≈ ${usd0(approx)} a mais rendendo no Liquid,`)),
                covers: s.wasPartial
                  ? tr(`your earnings would also cover all of ${name}`, `os ganhos cobririam também ${name} por inteiro`)
                  : tr(`your earnings would also cover ${name}`, `os ganhos cobririam também ${name}`),
                after: tr(`${a.coveredCount + s.step} of ${a.count} ${noun(a.count)} covered`, `${a.coveredCount + s.step} de ${a.count} ${noun(a.count)} ${a.allSubscriptions ? 'cobertas' : 'cobertos'}`),
              };
            })}
          />
          <p className="mt-4 text-xs leading-relaxed text-faint">
            {nb(tr(
              `At today’s average APY of your Liquid vaults (${pct(m.apy, 2)}), with cashback as it is. An informative scenario, not a recommendation.`,
              `Ao APY médio de hoje dos seus cofres Liquid (${pct(m.apy, 2)}), com o cashback como está. Cenário informativo, não recomendação.`,
            ))}
          </p>
        </>
      ) : (
        <p className="text-sm leading-relaxed text-muted">{m.text}</p>
      )}
      {/* um "por quê?" só: a regra e a conta de cada degrau, com os valores exatos */}
      <div className="mt-4">
        <Why>
          <p>{e.texts.why.milestones}</p>
          {m.kind === 'ladder' ? (
            <ul className="mt-2 space-y-1">
              {m.steps.map((s) => <li key={s.item.key}>{s.why}</li>)}
            </ul>
          ) : null}
        </Why>
      </div>
    </Panel>
  );
}
