import { useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import { BellRing, FlaskConical, RotateCcw, ShieldCheck } from 'lucide-react';
import type { Navigate } from '../lib/nav';
import {
  HF_SOURCE,
  MARKET_SOURCE,
  MAX_MONTHS,
  OBSERVED_RATES,
  PAID_MARKS,
  UNDERLYING_LABEL,
  applyShock,
  aprOf,
  cheaperSameCurrency,
  scenarioPosition,
  type ScenarioId,
  jointDropTrigger,
  marketAsset,
  newCollateralLine,
  netPoints,
  paidMonth,
  priceTrigger,
  project,
  summarize,
  volatileUnderlyings,
  type Alarm,
  type BorrowPosition,
  type CollateralLine,
  type DebtAsset,
  type DebtLine,
  type Shock,
  type Underlying,
} from '../lib/borrow';
import { dateShort, nb, num, pctSigned } from '../lib/format';
import { useLocale, useTr } from '../state/locale';
import { useStore } from '../state/store';
import { useBorrowPrefs } from '../state/borrowPrefs';
import { useEarnings } from '../components/earningsData';
import { useAlarmStates, useRealBorrow, alarmText } from '../components/borrowData';
import { BorrowPanel, CarryPanel, CollateralPanel, HeroStats, type BorrowTip } from '../components/borrowParts';
import { ProjectionChart } from '../components/borrowCharts';
import { PriceCard } from '../components/borrowPrice';
import { AlarmsPanel } from '../components/borrowAlarms';
import { Badge, Button, ExternalLink, Panel, PanelTitle, Segmented } from '../components/ui';

/**
 * Empréstimo: o modo Borrow da ether.fi Cash como a Aave mostra uma posição, em palavras de varejo (sem health factor
 * na tela). No topo, a faixa de números. Logo abaixo, o ouro (o dono pediu): o que a garantia rende contra o que o
 * empréstimo custa, e o gráfico de quanto o rendimento já pagou, com marcas de 25/50/75/100% que a pessoa liga. Depois
 * a garantia (só o que está ativo) e o empréstimo (agrupado por moeda, com "Detalhes"), os candles de cada garantia de
 * preço variável lado a lado, com atenção e liquidação, e os alarmes. Calculado neste navegador: informação e cenário,
 * nunca recomendação.
 */
type Horizon = 12 | 24 | 60 | 120;

export function BorrowView({ onNavigate }: { onNavigate: Navigate }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { source, loading, refresh, isSample } = useStore();
  const [prefs, save] = useBorrowPrefs();
  const real = useRealBorrow();
  const e = useEarnings();
  const states = useAlarmStates();

  // a simulação: cada parte mexida sobrepõe a conta; null = como está
  const [collateral, setCollateral] = useState<CollateralLine[] | null>(null);
  const [debtEdit, setDebtEdit] = useState<{ asset: DebtAsset; amount: number }[] | null>(null);
  const [spendEdit, setSpendEdit] = useState<number | null>(null);
  const [shock, setShock] = useState<Shock>({});
  const [horizonEdit, setHorizon] = useState<Horizon | null>(null);
  const [scenario, setScenario] = useState<ScenarioId>('account');

  // a taxa de cada dívida vem sempre das preferências (a do app de 05/11 ou a da pessoa)
  const debts: DebtLine[] = useMemo(
    () => (debtEdit ?? real.position.debts).map((d) => ({ asset: d.asset, amount: d.amount, apr: aprOf(prefs, d.asset) })),
    [debtEdit, real.position.debts, prefs],
  );
  const lines = collateral ?? real.position.collateral;
  const base: BorrowPosition = useMemo(() => ({ collateral: lines, debts }), [lines, debts]);
  const shocked = useMemo(() => applyShock(base, shock), [base, shock]);
  const s = useMemo(() => summarize(shocked, aprOf(prefs)), [shocked, prefs]);
  const shockOn = Object.values(shock).some((m) => m !== undefined && m !== 1);
  const simulating = collateral !== null || debtEdit !== null || shockOn;

  // o gasto do cartão e o cashback vêm do motor de Ganhos (a média do cartão e a taxa do plano)
  // o gasto vem da média do cartão (o motor de Ganhos); a taxa é a desta tela, 3% por padrão, simples de propósito
  const cardMonthly = e.cashback.base.card.monthly ?? e.cashback.base.monthly ?? 0;
  const spend = spendEdit ?? Math.round(cardMonthly * 100) / 100;
  const monthlyCashback = (spend * prefs.cashbackPct) / 100;

  // o "quanto já foi pago": a projeção longa dá o mês de cada marca; o gráfico mostra a janela escolhida
  const long = useMemo(() => project(shocked, { monthlySpend: 0, monthlyCashback, spendOnDebt: false }, MAX_MONTHS), [shocked, monthlyCashback]);
  const paidMonths = useMemo(() => Object.fromEntries(PAID_MARKS.map((m) => [m, s.debt > 0 ? paidMonth(long, m, false) : null])) as Record<number, number | null>, [long, s.debt]);
  const lastMark = paidMonths[1] ?? 0;
  const autoHorizon: Horizon = lastMark > 60 ? 120 : lastMark > 24 ? 60 : lastMark > 12 ? 24 : 12;
  const horizon = horizonEdit ?? autoHorizon;
  // o gráfico: o lucro da garantia (rendimento − juros) contra o valor emprestado, reto
  const points = useMemo(() => netPoints(long.slice(0, horizon + 1)), [long, horizon]);

  const vols = volatileUnderlyings(base);
  const share = (u: Underlying) => (s.collateralUsd > 0 ? base.collateral.filter((c) => c.underlying === u).reduce((a, c) => a + c.valueUsd, 0) / base.collateral.reduce((a, c) => a + c.valueUsd, 0) : 0);
  // um cartão com candles para quem pesa (10% da garantia ou mais, ou a dívida em ETH), até quatro; os pequenos viram uma linha
  const mainVols = vols.filter((u, i) => i === 0 || share(u) >= 0.1 || debts.some((d) => d.asset === 'WETH' && u === 'eth')).slice(0, 4);
  const minorVols = vols.filter((u) => !mainVols.includes(u));
  const joint = vols.length > 1 ? jointDropTrigger(base) : null;
  const firing = states.filter((x) => x.triggered === true);
  const empty = base.collateral.length === 0 && s.debt <= 0;

  const accountLoan = debtEdit === null;
  const debtRows = () => debtEdit ?? real.position.debts.map((d) => ({ asset: d.asset, amount: d.amount }));
  const setAmount = (asset: DebtAsset, amount: number) => setDebtEdit(debtRows().map((d) => (d.asset === asset ? { ...d, amount } : d)));
  const editLine = (symbol: string, patch: Partial<CollateralLine>) => setCollateral(lines.map((c) => (c.symbol === symbol ? { ...c, ...patch } : c)));
  const reset = () => {
    setCollateral(null);
    setDebtEdit(null);
    setSpendEdit(null);
    setShock({});
    setScenario('account');
  };
  // os cenários do topo: o 1 é a conta (volta ao que ela é); o 2 e o 3 trocam garantia e dívida de uma vez
  const pickScenario = (id: ScenarioId) => {
    setShock({});
    setScenario(id);
    if (id === 'account') {
      setCollateral(null);
      setDebtEdit(null);
      return;
    }
    const sc = scenarioPosition(id);
    setCollateral(sc.collateral);
    setDebtEdit(sc.debts);
  };
  // a dica do empréstimo: um ativo mais barato na mesma moeda, ou a confirmação de que o dólar já está no mais barato
  const cheaper = cheaperSameCurrency(debts, (a) => aprOf(prefs, a));
  const usdDebt = debts.find((d) => d.amount > 0 && (d.asset === 'USDT' || d.asset === 'USDC'));
  const tip: BorrowTip | null = cheaper
    ? { kind: 'cheaper', t: cheaper }
    : usdDebt
      ? { kind: 'lowest', asset: usdDebt.asset, apr: usdDebt.apr, other: usdDebt.asset === 'USDT' ? 'USDC' : 'USDT', otherApr: aprOf(prefs, usdDebt.asset === 'USDT' ? 'USDC' : 'USDT') }
      : null;
  const example = () => {
    const usdVault = marketAsset('liquidUSD');
    if (!usdVault) return;
    setCollateral([newCollateralLine(usdVault, 10_000, 4.75)]);
    setDebtEdit([{ asset: 'USDT', amount: 300 }]);
  };
  const sync = () => {
    if (source === 'live') refresh();
    else onNavigate('portfolio', { accountTab: 'connect' });
  };
  const setAlarms = (alarms: Alarm[]) => save({ ...prefs, alarms });
  const suggestions = [
    { kind: 'hf_below' as const, value: 1.5 },
    { kind: 'hf_below' as const, value: 1.25 },
  ].filter((sug) => !prefs.alarms.some((a) => a.kind === sug.kind && a.value === sug.value));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-3xl">
          <p aria-hidden className="text-xs font-medium uppercase tracking-[0.12em] text-faint">{tr('Borrow', 'Empréstimo')}</p>
          <h1 className="mt-1.5 font-display text-[clamp(1.625rem,5.5vw,2.5rem)] leading-[1.1] font-semibold tracking-tight text-balance text-ink">
            <span className="sr-only">{tr('Borrow: ', 'Empréstimo: ')}</span>
            {tr('Your loan against the vault, side by side with what it earns', 'O seu empréstimo contra o cofre, lado a lado com o que ele rende')}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {tr(
              'Whether the collateral’s yield pays for the loan, how long until it has paid it all, and how far a price drop would be from liquidation. Change any number to simulate.',
              'Se o rendimento da garantia paga o empréstimo, em quanto tempo ele já pagou tudo e a que distância uma queda de preço ficaria da liquidação. Mude qualquer número para simular.',
            )}
          </p>
        </div>
        {simulating ? (
          <div className="flex items-center gap-2">
            <Badge tone="accent"><FlaskConical aria-hidden className="size-3" />{tr('Simulating', 'Simulando')}</Badge>
            <Button onClick={reset}>
              <RotateCcw aria-hidden className="size-4" />
              {tr('Back to my account', 'Voltar à minha conta')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tr('Scenarios', 'Cenários')}>
        {([
          ['account', tr('1 · Your account', '1 · A sua conta'), isSample ? tr('the sample wallet', 'a carteira de exemplo') : tr('as it is today', 'como está hoje')],
          ['big', tr('2 · Lots of collateral', '2 · Muita garantia'), tr('$50k USD Yield · $5k USDT (10%)', 'US$ 50 mil no USD Yield · US$ 5 mil USDT (10%)')],
          ['eth', tr('3 · ETH collateral', '3 · Garantia em ETH'), tr('$20k ETH Yield + $5k USD · $13k USDT', 'US$ 20 mil no ETH Yield + 5 mil USD · 13 mil USDT')],
        ] as [ScenarioId, string, string][]).map(([id, name, sub]) => (
          <button
            key={id}
            type="button"
            aria-pressed={scenario === id}
            onClick={() => pickScenario(id)}
            className={cx(
              'tap flex min-w-0 cursor-pointer flex-col items-start rounded-xl border px-3.5 py-2 text-left transition-colors',
              scenario === id ? 'border-accent/60 bg-accent/10' : 'border-line2 hover:bg-panel2',
            )}
          >
            <span className={cx('text-sm font-medium', scenario === id ? 'text-accent' : 'text-ink')}>{name}</span>
            <span className="text-xs text-faint">{sub}</span>
          </button>
        ))}
      </div>

      {firing.length ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          <BellRing aria-hidden className="mt-0.5 size-4 shrink-0 text-bad" />
          <div>
            <p className="font-medium text-ink">{tr(`${firing.length} alarm${firing.length > 1 ? 's' : ''} firing`, `${firing.length} alarme${firing.length > 1 ? 's' : ''} disparado${firing.length > 1 ? 's' : ''}`)}</p>
            <p className="mt-0.5 text-muted">{firing.map((f) => alarmText(f.alarm, locale)).join(' · ')}. {tr('Check your position in the ether.fi app.', 'Confira a posição no app da ether.fi.')}</p>
          </div>
        </div>
      ) : null}

      {empty && !simulating ? (
        <Panel className="text-center">
          <h2 className="font-display text-xl font-semibold text-ink">{tr('No collateral and no loan in the loaded data', 'Sem garantia e sem empréstimo nos dados carregados')}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
            {tr(
              'Try the classic case: US$ 10,000 in USD Yield at 4.75% and US$ 300 borrowed in USDT at 3.55%. Every number can be changed.',
              'Experimente o caso clássico: US$ 10.000 no USD Yield a 4,75% e US$ 300 emprestados em USDT a 3,55%. Todo número pode ser mudado.',
            )}
          </p>
          <Button variant="primary" className="mt-4" onClick={example}>
            <FlaskConical aria-hidden className="size-4" />
            {tr('Simulate this example', 'Simular este exemplo')}
          </Button>
        </Panel>
      ) : null}

      <HeroStats s={s} simulating={simulating} />

      <CarryPanel
        s={s}
        period={prefs.period}
        onPeriod={(period) => save({ ...prefs, period })}
        paidMonths={paidMonths}
        horizonControl={
          <Segmented
            ariaLabel={tr('Projection length', 'Tamanho da projeção')}
            value={String(horizon) as `${Horizon}`}
            onChange={(v) => setHorizon(Number(v) as Horizon)}
            options={[
              { value: '12', label: tr('1Y', '1A') },
              { value: '24', label: tr('2Y', '2A') },
              { value: '60', label: tr('5Y', '5A') },
              { value: '120', label: tr('10Y', '10A') },
            ]}
          />
        }
        chart={
          <ProjectionChart
            points={points}
            marks={PAID_MARKS.flatMap((m) => (paidMonths[m] !== null && paidMonths[m] !== undefined ? [{ share: m, month: paidMonths[m]! }] : []))}
            showCashback={false}
            start={new Date()}
            locale={locale}
            label={tr('The collateral’s profit (yield minus loan interest) against what you borrowed, month by month', 'O lucro da garantia (rendimento menos juros) contra o que você pegou emprestado, mês a mês')}
          />
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <CollateralPanel
          lines={lines}
          uncounted={real.uncounted}
          total={s.collateralUsd}
          apy={s.collateralApy}
          power={s.borrowPower}
          onChange={editLine}
          onRemove={(symbol) => setCollateral(lines.filter((c) => c.symbol !== symbol))}
          onAdd={(m) => setCollateral([...lines, newCollateralLine(m, 1000)])}
          onSync={sync}
          syncing={loading}
        />
        <BorrowPanel
          debts={debts}
          details={prefs.details}
          onDetails={(v) => save({ ...prefs, details: v })}
          accountAsset={prefs.debtAsset}
          onAccountAsset={(a) => save({ ...prefs, debtAsset: a })}
          accountLoan={accountLoan}
          onAmount={setAmount}
          onApr={(asset, n) => save({ ...prefs, apr: { ...prefs.apr, [asset]: n } })}
          onAprReset={(asset) => {
            const next = { ...prefs.apr };
            delete next[asset];
            save({ ...prefs, apr: next });
          }}
          aprCustom={(asset) => prefs.apr[asset] !== undefined}
          onAdd={(asset) => {
            setDebtEdit([...debtRows(), { asset, amount: 100 }]);
            if (!prefs.details) save({ ...prefs, details: true });
          }}
          onRemove={(asset) => setDebtEdit(debtRows().filter((d) => d.asset !== asset))}
          spend={spend}
          onSpend={setSpendEdit}
          cashbackPct={prefs.cashbackPct}
          onCashbackPct={(n) => save({ ...prefs, cashbackPct: n })}
          monthlyCashback={monthlyCashback}
          s={s}
          tip={tip}
        />
      </div>

      {vols.length ? (
        <section aria-labelledby="borrow-prices" className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="borrow-prices" className="text-[13px] font-medium uppercase tracking-[0.1em] text-muted sm:tracking-[0.14em]">{tr('Volatile collateral', 'Garantia volátil')}</h2>
            {joint !== null ? (
              <p className="text-xs text-faint">
                {nb(tr(
                  `If ${vols.map((u) => UNDERLYING_LABEL[u]).join(', ')} all fell together: liquidation at ${pctSigned((joint - 1) * 100)}.`,
                  `Se ${vols.map((u) => UNDERLYING_LABEL[u]).join(', ')} caíssem juntos: liquidação em ${pctSigned((joint - 1) * 100)}.`,
                ))}
              </p>
            ) : null}
          </div>
          <div className={cx('grid grid-cols-1 items-stretch gap-5', mainVols.length > 1 && 'xl:grid-cols-2')}>
            {mainVols.map((u) => (
              <PriceCard
                key={u}
                u={u}
                position={base}
                shock={shock[u] ?? 1}
                onShock={(m) => setShock((prev) => ({ ...prev, [u]: m }))}
                shockedHf={s.hf}
                pricesOn={prefs.prices}
                onPricesOn={() => save({ ...prefs, prices: true })}
                alarms={prefs.alarms
                  .filter((a) => (a.kind === 'price_below' || a.kind === 'price_above') && a.underlying === u)
                  .map((a) => ({ id: a.id, price: a.value }))}
                onAlarm={(price, kind) => setAlarms([...prefs.alarms, { id: `a${Date.now().toString(36)}`, kind, value: price, underlying: u, on: true }])}
              />
            ))}
          </div>
          {minorVols.length ? (
            <Panel>
              <PanelTitle>{tr('Smaller price exposure', 'Exposição menor a preço')}</PanelTitle>
              <ul className="divide-y divide-line">
                {minorVols.map((u) => {
                  const t = priceTrigger(base, u);
                  return (
                    <li key={u} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                      <span className="text-ink">{UNDERLYING_LABEL[u]} <span className="tnum text-xs text-faint">{tr(`${num(share(u) * 100, 0)}% of collateral`, `${num(share(u) * 100, 0)}% da garantia`)}</span></span>
                      <span className="tnum text-muted">
                        {t
                          ? tr(`liquidation if it ${t.direction === 'drop' ? 'falls' : 'rises'} ${num(Math.abs(t.factor - 1) * 100, 0)}%`, `liquidação se ${t.direction === 'drop' ? 'cair' : 'subir'} ${num(Math.abs(t.factor - 1) * 100, 0)}%`)
                          : tr('doesn’t liquidate alone', 'não liquida sozinho')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </section>
      ) : base.collateral.length ? (
        <Panel className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {tr(
              'All collateral is in dollars against a dollar loan, so ETH or BTC moves don’t put the loan at risk. Add weETH or eBTC to the simulation to see the candles with the attention and liquidation lines.',
              'Toda a garantia está em dólar contra um empréstimo em dólar, então ETH e BTC não põem o empréstimo em risco. Adicione weETH ou eBTC na simulação para ver os candles com as linhas de atenção e liquidação.',
            )}
          </p>
          <Button
            className="shrink-0"
            onClick={() => {
              const eth = marketAsset('weETH');
              const btc = marketAsset('eBTC');
              const add = [eth, btc].filter((m): m is NonNullable<typeof m> => Boolean(m)).map((m) => newCollateralLine(m, 1500));
              setCollateral([...lines, ...add]);
            }}
          >
            {tr('Simulate with weETH and eBTC', 'Simular com weETH e eBTC')}
          </Button>
        </Panel>
      ) : null}

      <AlarmsPanel
        states={states}
        alarms={prefs.alarms}
        onChange={setAlarms}
        notify={prefs.notify}
        onNotify={(on) => save({ ...prefs, notify: on })}
        priceUnderlyings={[...new Set<Underlying>([...vols, 'eth', 'btc'])]}
        suggestions={suggestions}
      />

      <div className="space-y-2 text-xs leading-relaxed text-faint">
        <p className="flex items-start gap-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {tr(
            'Simulation calculated in this browser from the data loaded; nothing about your account leaves it. Loan rates and APY are variable, prices change and ether.fi can change the parameters. Information and scenarios, not financial advice: the ether.fi app is the source of truth for your loan and limits.',
            'Simulação calculada neste navegador com os dados carregados; nada da sua conta sai dele. Taxas de empréstimo e APY são variáveis, os preços mudam e a ether.fi pode alterar os parâmetros. Informação e cenário, não conselho financeiro: o app da ether.fi é a fonte da verdade do seu empréstimo e dos limites.',
          )}
        </p>
        <p className="pl-5.5">
          {tr('Parameters: ', 'Parâmetros: ')}
          <ExternalLink href={MARKET_SOURCE.url} className="hover:text-muted">{tr('ether.fi Lending Market Parameters', 'Lending Market Parameters da ether.fi')}</ExternalLink>
          {nb(tr(` (${MARKET_SOURCE.protocol} on ${MARKET_SOURCE.chain}, ${dateShort(MARKET_SOURCE.checked)})`, ` (${MARKET_SOURCE.protocol} na ${MARKET_SOURCE.chain}, ${dateShort(MARKET_SOURCE.checked)})`))}
          {' · '}
          <ExternalLink href={HF_SOURCE} className="hover:text-muted">{tr('attention and liquidation limits', 'limites de atenção e liquidação')}</ExternalLink>
          {nb(tr(` · loan rates seen in the app on ${dateShort(OBSERVED_RATES.date)}`, ` · taxas vistas no app em ${dateShort(OBSERVED_RATES.date)}`))}
          {' · '}
          <button type="button" onClick={() => onNavigate('earnings')} className="tap cursor-pointer underline decoration-dotted underline-offset-2 hover:text-muted">
            {tr('cashback comes from Earnings', 'o cashback vem de Ganhos')}
          </button>
        </p>
      </div>
    </div>
  );
}
