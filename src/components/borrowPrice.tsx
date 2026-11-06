import { useId, useState } from 'react';
import { BellPlus, CandlestickChart, RotateCcw } from 'lucide-react';
import {
  HF,
  PRICE_PRODUCTS,
  UNDERLYING_LABEL,
  priceTrigger,
  riskLevel,
  totalDebt,
  type BorrowPosition,
  type Underlying,
} from '../lib/borrow';
import { nb, num, pctSigned, usd } from '../lib/format';
import { cx } from '../lib/cx';
import { tokenIcon } from '../lib/tokenIcons';
import { PRICE_RANGES, PRICE_SOURCE_NAME, PRICE_SOURCE_URL, type PriceRange } from '../lib/prices';
import { useTr } from '../state/locale';
import { useCandles } from '../state/prices';
import { CandleChart, type PriceLine } from './borrowCharts';
import { Button, ExternalLink, Panel, Segmented, Spinner } from './ui';

// Um cartão por ativo de preço variável na garantia (ETH, BTC…), lado a lado quando há mais de um: o preço com os
// candles, a linha de atenção (o cartão para de gastar) e a de liquidação potencial, a régua da distância até elas e o
// "e se o preço mudasse X%", que mexe na tela toda. Os candles só são buscados depois de a pessoa ligar os gráficos.

const ICON: Partial<Record<Underlying, string>> = { eth: 'eth', btc: 'btc', op: 'op', gold: 'paxg', hype: 'whype', ethfi: 'ethfi' };

export function PriceCard({ u, position, shock, onShock, shockedHf, pricesOn, onPricesOn, alarms, onAlarm }: {
  u: Underlying;
  /** A posição sem choque (os preços de mercado de hoje) */
  position: BorrowPosition;
  /** Multiplicador do preço deste ativo na simulação (1 = hoje) */
  shock: number;
  onShock: (m: number) => void;
  /** O HF da tela com o choque aplicado (vira palavra: tranquilo, atenção, perigo) */
  shockedHf: number;
  pricesOn: boolean;
  onPricesOn: () => void;
  alarms: { id: string; price: number }[];
  onAlarm: (price: number, kind: 'price_below' | 'price_above') => void;
}) {
  const tr = useTr();
  const sliderId = useId();
  const [range, setRange] = useState<PriceRange>('3M');
  const name = UNDERLYING_LABEL[u];
  const canChart = Boolean(PRICE_PRODUCTS[u]);
  const { state, retry } = useCandles(u, range, pricesOn && canChart);
  const liq = priceTrigger(position, u, HF.liquidation);
  const att = priceTrigger(position, u, HF.spending);
  const warnT = priceTrigger(position, u, HF.warning);
  // um degrau já passado (o preço de hoje já está do lado de lá) não vira linha
  const ahead = (t: ReturnType<typeof priceTrigger>) => (t && !(t.direction === 'drop' ? t.factor >= 1 : t.factor <= 1) ? t : null);
  const warn = ahead(warnT);
  const attA = ahead(att);
  const holdings = position.collateral.filter((c) => c.underlying === u);
  const held = holdings.reduce((a, c) => a + c.valueUsd, 0);
  const total = position.collateral.reduce((a, c) => a + c.valueUsd, 0);
  const candles = state.status === 'ok' ? state.series.candles : null;
  const market = candles ? candles[candles.length - 1].c : null;
  const first = candles ? candles[0].o : null;
  const change = market !== null && first !== null ? ((market - first) / first) * 100 : null;
  // o preço para escrever "a US$ X": o de mercado (gráfico ligado), senão o unitário da garantia, quando a quantidade é conhecida
  const unit = holdings.length === 1 && holdings[0].quantity ? { label: holdings[0].symbol, price: holdings[0].valueUsd / holdings[0].quantity } : null;
  const ref = market !== null ? { label: name, price: market } : unit;
  const movePct = Math.round((shock - 1) * 100);
  const level = riskLevel(shockedHf);
  const hasDebt = totalDebt(position) > 0;
  const icon = ICON[u] ? tokenIcon(ICON[u]!) : null;

  const lines: PriceLine[] = [];
  if (market !== null) {
    if (warn) lines.push({ id: 'warn', price: market * warn.factor, label: tr('Warning', 'Aviso'), tone: 'caution', style: 'dashed' });
    if (attA) lines.push({ id: 'att', price: market * attA.factor, label: tr('Attention', 'Atenção'), tone: 'orange', style: 'dashed' });
    if (liq) lines.push({ id: 'liq', price: market * liq.factor, label: tr('Liquidation', 'Liquidação'), tone: 'bad', style: 'solid' });
    for (const a of alarms) lines.push({ id: a.id, price: a.price, label: tr('Alarm', 'Alarme'), tone: 'info', style: 'dotted' });
    if (shock !== 1) lines.push({ id: 'sim', price: market * shock, label: tr('Simulated', 'Simulado'), tone: 'info', style: 'dashed' });
  }
  const statusText = !hasDebt
    ? tr('No loan: price moves don’t put anything at risk.', 'Sem empréstimo: o preço não põe nada em risco.')
    : !liq
      ? tr(`Calm: no ${name} price liquidates the loan alone; the rest of the collateral covers it.`, `Tranquilo: nenhum preço do ${name} liquida o empréstimo sozinho; o resto da garantia cobre.`)
      : level === 'danger'
        ? tr('Liquidation: at this price the loan can be liquidated.', 'Liquidação: neste preço o empréstimo pode ser liquidado.')
        : level === 'attention'
          ? tr(`Attention: the card stops spending; ${name} would need to ${liq.direction === 'drop' ? 'fall' : 'rise'} ${num(Math.abs(liq.factor / shock - 1) * 100, 0)}% more to liquidate.`, `Atenção: o cartão para de gastar; o ${name} precisaria ${liq.direction === 'drop' ? 'cair' : 'subir'} mais ${num(Math.abs(liq.factor / shock - 1) * 100, 0)}% para liquidar.`)
          : level === 'warning'
            ? tr(`Warning: the margin is getting thin; ${name} would need to ${liq.direction === 'drop' ? 'fall' : 'rise'} ${num(Math.abs(liq.factor / shock - 1) * 100, 0)}% more to liquidate.`, `Aviso: a margem está encolhendo; o ${name} precisaria ${liq.direction === 'drop' ? 'cair' : 'subir'} mais ${num(Math.abs(liq.factor / shock - 1) * 100, 0)}% para liquidar.`)
            : tr(`Calm: ${name} would need to ${liq.direction === 'drop' ? 'fall' : 'rise'} ${num(Math.abs(liq.factor / shock - 1) * 100, 0)}% to liquidate.`, `Tranquilo: o ${name} precisaria ${liq.direction === 'drop' ? 'cair' : 'subir'} ${num(Math.abs(liq.factor / shock - 1) * 100, 0)}% para liquidar.`);

  return (
    <Panel className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? <img src={icon} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full" /> : <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-panel2 text-xs font-semibold text-muted">{name.slice(0, 3)}</span>}
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-baseline gap-x-2 font-display text-lg font-semibold text-ink">
              {name}
              {market !== null ? <span className="tnum">{usd(market)}</span> : null}
              {change !== null ? <span className={cx('tnum text-sm font-medium', change >= 0 ? 'text-good' : 'text-bad')}>{pctSigned(change)} <span className="font-normal text-faint">{range}</span></span> : null}
            </h3>
            <p className="truncate text-xs text-faint">
              {holdings.map((h) => `${h.symbol} ${usd(h.valueUsd)}`).join(' · ')}
              {total > 0 && held > 0 ? tr(` · ${num((held / total) * 100, 0)}% of collateral`, ` · ${num((held / total) * 100, 0)}% da garantia`) : ''}
            </p>
          </div>
        </div>
        {canChart && pricesOn ? <Segmented ariaLabel={tr(`${name} chart window`, `Janela do gráfico do ${name}`)} value={range} onChange={setRange} options={PRICE_RANGES.map((r) => ({ value: r, label: r }))} /> : null}
      </div>

      <p className={cx('mt-3 rounded-lg px-3 py-2 text-sm', !hasDebt || !liq || level === 'calm' ? 'bg-good/8 text-good' : level === 'warning' ? 'bg-caution/10 text-caution' : level === 'attention' ? 'bg-orange/10 text-orange' : 'bg-bad/10 text-bad')}>{statusText}</p>

      <div className="mt-3">
        {!canChart ? (
          <p className="text-xs text-faint">{tr(`No public candles for ${name} here: the numbers below still hold.`, `Sem candles públicos do ${name} aqui: os números abaixo continuam valendo.`)}</p>
        ) : !pricesOn ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-4">
            <p className="text-xs leading-relaxed text-muted">
              {tr(
                `The chart fetches ${name}’s public candles from ${PRICE_SOURCE_NAME}. Nothing about your account goes with it, and nothing is fetched until you turn it on.`,
                `O gráfico busca os candles públicos do ${name} na ${PRICE_SOURCE_NAME}. Nada da sua conta vai junto, e nada é buscado antes de você ligar.`,
              )}
            </p>
            <Button onClick={onPricesOn}>
              <CandlestickChart aria-hidden className="size-4" />
              {tr('Show price charts', 'Mostrar os gráficos de preço')}
            </Button>
          </div>
        ) : state.status === 'loading' ? (
          <div className="flex h-[250px] items-center justify-center gap-2 rounded-xl bg-panel2/40 text-xs text-faint sm:h-[300px]"><Spinner />{tr('Loading candles…', 'Carregando os candles…')}</div>
        ) : state.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4 text-xs text-muted">
            {state.reason === 'rate_limited'
              ? tr('The price source is limiting requests right now. Try again in a minute.', 'A fonte de preços está limitando pedidos agora. Tente de novo em um minuto.')
              : tr('Couldn’t load the candles.', 'Não deu para carregar os candles.')}
            <Button onClick={retry}>{tr('Try again', 'Tentar de novo')}</Button>
          </div>
        ) : candles ? (
          <CandleChart
            candles={candles}
            lines={lines}
            zone={liq || attA || warn ? {
              liquidation: liq && market !== null ? market * liq.factor : null,
              attention: attA && market !== null ? market * attA.factor : null,
              warning: warn && market !== null ? market * warn.factor : null,
              direction: (liq ?? attA ?? warn)!.direction,
            } : null}
            label={tr(`${name} price, ${range}, with the warning, attention and liquidation zones`, `Preço do ${name}, ${range}, com as zonas de aviso, atenção e liquidação`)}
            unit={name}
            intraday={range === '1M'}
          />
        ) : null}
      </div>

      {/* a régua: hoje, atenção, liquidação, como distância do preço de hoje */}
      {hasDebt && liq ? <DistanceRuler warn={warn?.factor ?? null} att={attA?.factor ?? null} liq={liq.factor} sim={shock} direction={liq.direction} refPrice={ref} /> : null}

      <div className="mt-4">
        <label htmlFor={sliderId} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="text-muted">{tr(`What if ${name} moved`, `E se o ${name} mudasse`)}</span>
          <output htmlFor={sliderId} className="tnum">
            <span className={cx('font-medium', movePct < 0 ? 'text-bad' : movePct > 0 ? 'text-good' : 'text-ink')}>{movePct === 0 ? '0%' : pctSigned(movePct)}</span>
            {ref && movePct !== 0 ? <span className="ml-2 text-xs text-faint">{ref.label} ≈ {usd(ref.price * shock)}</span> : null}
          </output>
        </label>
        <div className="flex items-center gap-2">
          <input
            id={sliderId}
            type="range"
            min={-90}
            max={100}
            step={1}
            value={movePct}
            onChange={(e) => onShock(1 + Number(e.target.value) / 100)}
            aria-valuetext={tr(`${name} ${movePct}%`, `${name} ${movePct}%`)}
            className="h-11 w-full cursor-pointer accent-[var(--color-accent)] pointer-fine:h-6"
          />
          {shock !== 1 ? (
            <button type="button" onClick={() => onShock(1)} aria-label={tr(`Back to today’s ${name} price`, `Voltar ao preço de hoje do ${name}`)} className="tap flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-faint hover:bg-panel2 hover:text-ink">
              <RotateCcw aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        <p className="text-xs text-faint">
          {pricesOn && canChart ? <>{tr('Candles: ', 'Candles: ')}<ExternalLink href={PRICE_SOURCE_URL} className="hover:text-muted">{PRICE_SOURCE_NAME}</ExternalLink> · </> : null}
          {tr('lines hold the rest of the position still', 'as linhas supõem o resto da posição parado')}
        </p>
        {warn && market !== null ? (
          <Button variant="ghost" className="text-xs" onClick={() => onAlarm(Math.round(market * warn.factor * 100) / 100, warn.direction === 'drop' ? 'price_below' : 'price_above')}>
            <BellPlus aria-hidden className="size-4 text-caution" />
            {nb(tr(`Alarm at the yellow warning (${usd(market * warn.factor)})`, `Alarme no aviso amarelo (${usd(market * warn.factor)})`))}
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Régua da distância: de hoje (0%) até a liquidação, com os degraus no meio (aviso amarelo, atenção laranja,
 * liquidação vermelha) e o "e se" marcado. Em queda vai da esquerda (hoje) para a direita (−100%); em alta, até +200%.
 * Os rótulos ficam numa legenda embaixo: soltos sobre a barra, degraus próximos se atropelavam.
 */
function DistanceRuler({ warn, att, liq, sim, direction, refPrice }: {
  warn: number | null;
  att: number | null;
  liq: number;
  sim: number;
  direction: 'drop' | 'rise';
  refPrice: { label: string; price: number } | null;
}) {
  const tr = useTr();
  const span = direction === 'drop' ? 1 : 2;
  const pos = (f: number) => Math.min(100, Math.max(0, (Math.abs(f - 1) / span) * 100));
  const liqPos = pos(liq);
  const attPos = att !== null ? pos(att) : null;
  const warnPos = warn !== null ? pos(warn) : null;
  const simPos = sim !== 1 && (direction === 'drop' ? sim < 1 : sim > 1) ? pos(sim) : null;
  const pctOf = (f: number) => pctSigned((f - 1) * 100);
  const steps = [
    warn !== null ? { key: 'warn', f: warn, name: tr('Warning', 'Aviso'), dot: 'bg-caution', text: 'text-caution' } : null,
    att !== null ? { key: 'att', f: att, name: tr('Attention', 'Atenção'), dot: 'bg-orange', text: 'text-orange' } : null,
    { key: 'liq', f: liq, name: tr('Liquidation', 'Liquidação'), dot: 'bg-bad', text: 'text-bad' },
  ].filter((x): x is NonNullable<typeof x> => x !== null);
  return (
    <div className="mt-4">
      <div
        role="img"
        aria-label={tr(
          `Distance from today: ${steps.map((x) => `${x.name.toLowerCase()} at ${pctOf(x.f)}`).join(', ')}`,
          `Distância de hoje: ${steps.map((x) => `${x.name.toLowerCase()} em ${pctOf(x.f)}`).join(', ')}`,
        )}
        className="relative h-2 rounded-full bg-good/25"
      >
        {warnPos !== null ? <div className="absolute inset-y-0 bg-caution/40" style={{ left: `${warnPos}%`, right: `${100 - (attPos ?? liqPos)}%` }} /> : null}
        {attPos !== null ? <div className="absolute inset-y-0 bg-orange/50" style={{ left: `${attPos}%`, right: `${100 - liqPos}%` }} /> : null}
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-bad/55" style={{ left: `${liqPos}%` }} />
        {warnPos !== null ? <div className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-caution" style={{ left: `${warnPos}%` }} /> : null}
        {attPos !== null ? <div className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-orange" style={{ left: `${attPos}%` }} /> : null}
        <div className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-bad" style={{ left: `${liqPos}%` }} />
        <div className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-[3px] border-panel bg-ink" style={{ left: '0%' }} />
        {simPos !== null ? <div className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-[3px] border-panel bg-info" style={{ left: `${simPos}%` }} /> : null}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        <li className="inline-flex items-center gap-1.5 text-muted"><span aria-hidden className="size-2 rounded-full bg-ink" />{tr('Today', 'Hoje')}</li>
        {steps.map((x) => (
          <li key={x.key} className={cx('tnum inline-flex items-center gap-1.5', x.text)}>
            <span aria-hidden className={cx('size-2 rounded-full', x.dot)} />
            {x.name} {pctOf(x.f)}
            {refPrice ? <span className="text-faint">· {refPrice.label} {usd(refPrice.price * x.f)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
