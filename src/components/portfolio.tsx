import { useEffect, useId, useState } from 'react';
import { ArrowRight, Inbox, Info, Receipt } from 'lucide-react';
import { approxHome, cashbackSummary, fxSummary, periodWindow, rewardsSummary, spendSummary } from '../lib/analytics';
import type { PartialReason, PortfolioClass, PortfolioSummary, RecentFx } from '../lib/analytics';
import type { AssetClass } from '../lib/assetClass';
import { tokenIcon } from '../lib/tokenIcons';
import { dateRange, dateShort, money, nb, num, pct, usd } from '../lib/format';
import { LOCALES, pick, type Locale } from '../lib/locale';
import type { Dataset, Holding } from '../lib/types';
import { cx } from '../lib/cx';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { attentionSummary, useAttention, waitingLabel } from '../state/attention';
import { Badge, Panel, PanelTitle, Stat, Why, WhyBody } from './ui';
import { MonthBars } from './charts';

// Peças da tela Portfólio (views/Portfolio.tsx): o valor com os centavos esmaecidos, o "≈" na moeda da casa, a barra
// "Como está dividido" por tipo de ativo, a lista por tipo, o rendimento e o crédito. Nenhum número aqui é somado ao saldo.

type Tr = ReturnType<typeof useTr>;

const tagOf = (locale: Locale) => LOCALES.find((l) => l.value === locale)?.tag ?? 'en-US';

/**
 * Uma cor fixa por tipo de ativo, a mesma para todo mundo e em toda tela (tokens --color-class-* do app.css): fiat é
 * sempre fiat, não importa quanto vale. No chip, as iniciais ficam na cor do texto sobre a tinta da classe a 20% (8,5:1
 * ou mais): na própria cor, ações, commodities e outros ficavam abaixo de 4,5:1. Os nomes das classes do Tailwind ficam
 * inteiros para ele encontrá-los.
 */
const CLASS_COLORS: Record<AssetClass, { fill: string; chip: string }> = {
  fiat: { fill: 'bg-class-fiat', chip: 'bg-class-fiat/20 text-ink' },
  crypto: { fill: 'bg-class-crypto', chip: 'bg-class-crypto/20 text-ink' },
  stocks: { fill: 'bg-class-stocks', chip: 'bg-class-stocks/20 text-ink' },
  bonds: { fill: 'bg-class-bonds', chip: 'bg-class-bonds/20 text-ink' },
  commodities: { fill: 'bg-class-commodities', chip: 'bg-class-commodities/20 text-ink' },
  other: { fill: 'bg-class-other', chip: 'bg-class-other/20 text-ink' },
};

/** "Fiat · USD, EUR" com o "·" preso ao que vem antes (NBSP): a linha nunca começa com ele. */
const classLabel = (c: PortfolioClass) => nb(c.label);

/** "12.480 dólares e 55 centavos": o leitor de tela ouve o valor inteiro de uma vez, sem picotar nos centavos. */
function spokenUsd(n: number, locale: Locale): string {
  const c = Math.round(Math.abs(Number.isFinite(n) ? n : 0) * 100);
  const whole = Math.floor(c / 100);
  const cents = c % 100;
  const w = new Intl.NumberFormat(tagOf(locale)).format(whole);
  const neg = n < 0 ? pick(locale, 'minus ', 'menos ') : '';
  return pick(
    locale,
    `${neg}${w} ${whole === 1 ? 'dollar' : 'dollars'}${cents ? ` and ${cents} ${cents === 1 ? 'cent' : 'cents'}` : ''}`,
    `${neg}${w} ${whole === 1 ? 'dólar' : 'dólares'}${cents ? ` e ${cents} ${cents === 1 ? 'centavo' : 'centavos'}` : ''}`,
  );
}

/**
 * Valor em dólar com os centavos esmaecidos (cor `faint`: 5,35:1 no cartão; a opacidade 0,34 do guia reprova). Na tela,
 * as partes do Intl; para o leitor de tela, o valor falado inteiro (`aria-label` em span não vale: ARIA 1.2).
 */
export function DimCents({ value }: { value: number }) {
  const { locale } = useLocale();
  const parts = new Intl.NumberFormat(tagOf(locale), { style: 'currency', currency: 'USD' }).formatToParts(Number.isFinite(value) ? value : 0);
  return (
    <>
      <span className="sr-only">{spokenUsd(value, locale)}</span>
      <span aria-hidden className="tnum">
        {parts.map((p, i) => (p.type === 'decimal' || p.type === 'fraction'
          ? <span key={i} className="text-faint">{p.value}</span>
          // sinal de menos de verdade (U+2212), não o hífen do Intl
          : <span key={i}>{p.type === 'minusSign' ? '−' : p.value}</span>))}
      </span>
    </>
  );
}

/**
 * Conversão aproximada sem falsa precisão: 3 algarismos ("R$ 68,5 mil", "R$68,500"), unidades inteiras abaixo de mil.
 * Em português, "mil" e "mi"; em inglês, o número por extenso (sem "K" em dinheiro).
 */
export function approxMoney(n: number, currency: string, locale: Locale): string {
  const opts: Intl.NumberFormatOptions = Math.abs(n) < 1000
    ? { style: 'currency', currency, maximumFractionDigits: 0 }
    : locale === 'pt'
      ? { style: 'currency', currency, notation: 'compact', maximumSignificantDigits: 3 }
      : { style: 'currency', currency, maximumSignificantDigits: 3 };
  try {
    return new Intl.NumberFormat(tagOf(locale), opts).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
}

/**
 * Hora da leitura do saldo ("19 de out., 14:32"). snapshotAt é um instante de verdade (UTC), não a hora local escrita
 * como UTC das transações: formata no fuso dos dados, ou no do navegador.
 */
export function snapshotLabel(iso: string | undefined, timeZone: string | undefined, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const timed = /T\d/.test(iso);
    return new Intl.DateTimeFormat(tagOf(locale), {
      day: 'numeric',
      month: 'short',
      ...(timed ? { hour: 'numeric', minute: '2-digit', timeZone } : { timeZone: 'UTC' }),
    }).format(d).replace(/[ \u202f]/g, '\u00A0');
  } catch {
    return null;
  }
}

/**
 * O gasto deste mês até hoje, da ponte de gastos do Portfólio: se o histórico começa no meio do mês, desde ali. Sem o
 * balde "assinaturas" do resumo: nenhuma definição própria de assinatura aqui (D12).
 */
export function monthToDate(dataset: Dataset) {
  const { coverage } = dataset;
  const ref = dataset.referenceDate;
  const monthStart = `${ref.slice(0, 7)}-01T00:00:00Z`;
  const from = coverage && !coverage.complete && coverage.from > monthStart ? coverage.from : monthStart;
  const to = `${ref}T23:59:59Z`;
  return { ref, monthStart, from, to, month: spendSummary(dataset, [], from, to) };
}

/** Nomes da conta no demo e nos arquivos de exemplo, que vêm em inglês: [en, pt] */
const SAMPLE_ACCOUNT_NAMES: Record<string, [string, string]> = {
  Demo: ['Demo account', 'Conta demo'],
  'Demo account': ['Demo account', 'Conta demo'],
  'Sample account (synthetic)': ['Sample account (synthetic)', 'Conta de exemplo (sintética)'],
};

/** O nome da conta como a fonte manda; nos dados fictícios, na língua da tela. Sem nome, "Conta principal". */
export function useAccountName(): string {
  const { dataset, isSample } = useStore();
  const tr = useTr();
  const label = dataset.account.accountLabel;
  if (!label) return tr('Main account', 'Conta principal');
  const known = isSample ? SAMPLE_ACCOUNT_NAMES[label] : undefined;
  return known ? tr(...known) : label;
}

/** Por que o saldo ou a lista não são completos, em uma frase cada. */
function partialText(r: PartialReason, s: PortfolioSummary, tr: Tr): string {
  switch (r) {
    // o flag de trading pode qualificar o saldo (totalPartial) ou só a lista e a composição
    case 'trading':
      return s.totalPartial
        ? tr('Trading positions aren’t in this total: the source says so.', 'Posições de trading não entram neste total: a fonte avisa.')
        : tr('Trading positions aren’t in the list below: the source says so.', 'Posições de trading não entram na lista abaixo: a fonte avisa.');
    // com o total da conta, o saldo vem inteiro: quem fica sem o ativo é a lista
    case 'unrenderable':
      if (s.totalSource === 'account') {
        return s.unrenderableCount === 1
          ? tr('1 asset couldn’t be valued by the source and doesn’t appear in the list below.', '1 ativo não pôde ser avaliado pela fonte e não aparece na lista abaixo.')
          : tr(`${s.unrenderableCount} assets couldn’t be valued by the source and don’t appear in the list below.`, `${s.unrenderableCount} ativos não puderam ser avaliados pela fonte e não aparecem na lista abaixo.`);
      }
      return s.unrenderableCount === 1
        ? tr('1 asset couldn’t be valued by the source and is left out of this total.', '1 ativo não pôde ser avaliado pela fonte e fica fora deste total.')
        : tr(`${s.unrenderableCount} assets couldn’t be valued by the source and are left out of this total.`, `${s.unrenderableCount} ativos não puderam ser avaliados pela fonte e ficam fora deste total.`);
    case 'portfolio_missing':
      return tr('The asset list didn’t load, so there’s no breakdown below.', 'A lista de ativos não carregou, então não há detalhamento abaixo.');
    case 'account_missing':
      return tr('The account summary didn’t load: the total is the sum of the assets listed, and credit is left out.', 'O resumo da conta não carregou: o total é a soma dos ativos listados, e o crédito fica de fora.');
  }
}

export function PartialNote({ s }: { s: PortfolioSummary }) {
  const tr = useTr();
  if (!s.partialReasons.length) return null;
  return (
    <div className="mt-2 space-y-1">
      <Badge>{tr('Partial', 'Parcial')}</Badge>
      <ul className="space-y-0.5 text-xs leading-relaxed text-muted">
        {s.partialReasons.map((r) => <li key={r}>{partialText(r, s, tr)}</li>)}
      </ul>
    </div>
  );
}

/**
 * "≈ R$ 68,5 mil" sob o valor, e o chip com o câmbio que ele usa. Nunca "cotação": é o câmbio das compras recentes da
 * própria pessoa, que já traz a margem de câmbio do cartão. O chip abre de onde ele vem.
 */
export function FxLine({ total, fx }: { total: number; fx: RecentFx }) {
  const tr = useTr();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const id = useId();
  const one = money(1, 'USD', { compact: true });
  const rate = money(fx.localPerUsd, fx.currency);
  const purchases = tr(`${fx.count}\u00A0card purchases in ${fx.currency}`, `${fx.count}\u00A0compras no cartão em ${fx.currency}`);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-muted">
          <span className="tnum text-lg text-ink sm:text-xl">
            <span aria-hidden>≈{'\u00A0'}</span>
            <span className="sr-only">{tr('about ', 'cerca de ')}</span>
            {approxMoney(total * fx.localPerUsd, fx.currency, locale)}
          </span>{' '}
          <span className="text-sm">{tr('at your recent card rate', 'no câmbio das suas compras recentes')}</span>
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((o) => !o)}
          className="tap inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-line2 px-3 text-xs text-muted transition-colors hover:border-field hover:text-ink active:bg-panel2"
        >
          <span className="tnum whitespace-nowrap">{one}{'\u00A0≈\u00A0'}{rate}</span>
          <span aria-hidden>·</span>
          <span>{tr('Estimate', 'Estimativa')}</span>
          <Info aria-hidden className="size-3.5" />
          <span className="sr-only">{tr(', how it’s calculated', ', como é calculado')}</span>
        </button>
      </div>
      {open ? (
        <WhyBody id={id} className="mt-2 max-w-xl">
          {tr(
            `Average rate of ${purchases}, ${dateRange(fx.from, fx.to)}: what you paid in ${fx.currency} ÷ what left your balance in dollars. It already includes your plan’s FX margin. It’s not a market quote: selling dollars would give a different amount.`,
            `Câmbio médio de ${purchases}, ${dateRange(fx.from, fx.to)}: o que você pagou em ${fx.currency} ÷ o que saiu do saldo em dólar. Já inclui a margem de câmbio do seu plano. Não é cotação de mercado: vender dólar daria outro valor.`,
          )}
        </WhyBody>
      ) : null}
    </div>
  );
}

/**
 * Percentual de cada grupo, pelo maior resto: a soma dá exatamente 100. Com mais de um grupo, nenhum mostra 100%: com
 * 99,5% e 0,5%, o maior resto daria "100%" ao lado de "menos de 1%"; fica "99%" e "menos de 1%".
 */
function percentsOf(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((s, c) => s + c, 0);
  for (const [, i] of raw.map((r, i) => [r - out[i], i] as const).sort((a, b) => b[0] - a[0])) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return values.length > 1 ? out.map((p) => Math.min(p, 99)) : out;
}

/**
 * "Como está dividido": uma barra só, dividida por tipo de ativo (fiat, cripto, ações, renda fixa, commodities, outros),
 * com 2 px de vão na cor do cartão entre as classes e o rótulo de cada uma logo abaixo, com ponto, nome, percentual e
 * valor. Classe que arredonda para 0 vira "<1%", nunca "0%". A barra cresce da esquerda ao abrir (transform: não
 * empurra nada; sem movimento com prefers-reduced-motion). Com uma classe só, a barra não diz nada: fica só a linha.
 */
export function ClassSplit({ s }: { s: PortfolioSummary }) {
  const tr = useTr();
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const classes = s.classes;
  if (classes.length === 1) {
    const c = classes[0];
    return (
      <p className="flex items-baseline gap-2 text-sm">
        <span aria-hidden className={cx('size-2.5 shrink-0 rounded-full', CLASS_COLORS[c.id].fill)} />
        <span className="min-w-0 flex-1 text-ink">{tr(`All of it in ${classLabel(c)}`, `Tudo em ${classLabel(c)}`)}</span>
        <span className="tnum shrink-0">{usd(c.value)}</span>
      </p>
    );
  }
  const shares = percentsOf(classes.map((c) => c.value));
  return (
    <>
      <div
        aria-hidden
        className={cx(
          'flex h-4 origin-left gap-0.5 overflow-hidden rounded-full transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] sm:h-5',
          grown ? 'scale-x-100' : 'scale-x-0',
        )}
      >
        {/* flex-grow pelo valor: os vãos ficam fora da conta e a classe pequena não some (4 px no mínimo) */}
        {classes.map((c) => <div key={c.id} className={cx('h-full min-w-1 basis-0', CLASS_COLORS[c.id].fill)} style={{ flexGrow: c.value }} />)}
      </div>
      {/* colunas automáticas: até 4 classes numa linha no cartão de 8 colunas, e as 6 cabem sem buraco */}
      <ul className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
        {classes.map((c, i) => (
          // o nome numa linha e, embaixo dele, percentual e valor
          <li key={c.id} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 text-sm">
            <span aria-hidden className={cx('size-2.5 rounded-full', CLASS_COLORS[c.id].fill)} />
            <span className="min-w-0 break-words text-ink">{classLabel(c)}</span>
            <span className="tnum col-start-2 text-muted">
              <span className="font-medium text-ink">{shares[i] === 0 ? tr('<1%', 'menos de 1%') : pct(shares[i])}</span>
              {'\u00A0· '}{usd(c.value)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Quantidade legível com o símbolo ("1,2 weETH"): resíduo de poeira não vira "0". */
function qty(h: Holding, tr: Tr): string | null {
  const q = h.quantity;
  if (q === undefined) return null;
  if (q === 0) return `0\u00A0${h.asset}`;
  if (Math.abs(q) < 1e-6) return tr(`less than ${num(0.000001, 6)}\u00A0${h.asset}`, `menos de ${num(0.000001, 6)}\u00A0${h.asset}`);
  return `${num(q, Math.abs(q) < 1 ? 6 : 4)}\u00A0${h.asset}`;
}

/** Duas letras do símbolo para o chip ("weETH" → "WE"). */
const initials = (asset: string) => (asset.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?').toUpperCase();

/**
 * O chip da linha, com 32 px (o mínimo que a Circle pede para o ícone do USDC): o ícone do token quando o site tem um,
 * recortado em círculo (spyx, qqqx, tbllx e ethfi são quadrados cheios); senão, ou se a imagem falhar, as iniciais na
 * tinta da classe. Decorativo (alt vazio): o nome do ativo está logo ao lado. Largura e altura fixas: nada se mexe
 * quando a imagem chega.
 */
function AssetChip({ asset, tint }: { asset: string; tint: string }) {
  const src = tokenIcon(asset);
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={32}
        height={32}
        decoding="async"
        onError={() => setFailed(true)}
        className="size-8 shrink-0 overflow-hidden rounded-full bg-panel2 object-cover"
      />
    );
  }
  return (
    <span aria-hidden className={cx('flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', tint)}>
      {initials(asset)}
    </span>
  );
}

/**
 * Os ativos por tipo, na ordem da barra: um subtítulo por classe com o valor dela ("Fiat · USD"), e as linhas com o chip
 * (ícone do token ou iniciais), o nome, o detalhe (quantidade · cofre Liquid · APY · garante o cartão) e o valor. O cofre
 * continua sinalizado: um liquidUSD é fiat em dólar, guardado num cofre. Abaixo de 1 centavo não é saldo que se use: sai
 * das linhas e vira "+N com saldo abaixo de US$ 0,01" no fim.
 */
export function AssetsByClass({ s }: { s: PortfolioSummary }) {
  const tr = useTr();
  const all = s.classes.flatMap((c) => c.holdings);
  const keep = (h: Holding) => h.dollarValue >= 0.01 || !all.some((x) => x.dollarValue >= 0.01);
  const dust = all.filter((h) => !keep(h)).length;
  return (
    <div className="space-y-4">
      {s.classes.map((c) => {
        const rows = [...c.holdings].filter(keep).sort((a, b) => b.dollarValue - a.dollarValue);
        if (!rows.length) return null;
        return (
          <section key={c.id} aria-labelledby={`class-${c.id}`}>
            <h3 id={`class-${c.id}`} className="flex items-baseline justify-between gap-3 border-b border-line pb-2 text-xs font-medium uppercase tracking-[0.12em] text-faint">
              <span className="min-w-0 break-words">{classLabel(c)}</span>
              <span className="tnum shrink-0 normal-case tracking-normal">{usd(c.value)}</span>
            </h3>
            <ul className="divide-y divide-line">
              {rows.map((h, i) => {
                const detail = [
                  h.name && h.name !== h.asset && h.quantity === undefined ? h.asset : null,
                  qty(h, tr),
                  h.vault ? tr('Liquid vault', 'cofre Liquid') : null,
                  h.apy ? tr(`${pct(h.apy, 1)} a year, variable`, `${pct(h.apy, 1)} ao ano, variável`) : null,
                  h.backsSpending ? tr('backs the card', 'garante o cartão') : null,
                ].filter((x): x is string => Boolean(x));
                return (
                  // nome e valor na primeira linha, o detalhe embaixo na largura toda: não se embaralha a 320px
                  <li key={`${h.asset}|${h.chainId ?? ''}|${i}`} className="flex min-h-12 items-start gap-3 py-2.5">
                    <AssetChip key={h.asset} asset={h.asset} tint={CLASS_COLORS[c.id].chip} />
                    <div className="min-w-0 flex-1">
                      {/* sem espaço para os dois, o valor desce de linha (à direita) em vez de o nome quebrar palavra a palavra */}
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="min-w-0 break-words leading-snug text-ink">{h.name ?? h.asset}</span>
                        <span className="tnum ml-auto shrink-0 text-right">{usd(h.dollarValue)}</span>
                      </div>
                      {detail.length ? <div className="mt-0.5 text-[13px] leading-snug text-faint">{nb(detail.join(' · '))}</div> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {dust ? (
        <p className="text-xs text-faint">
          {dust === 1
            ? tr('+1 asset with a balance under $0.01', '+1 ativo com saldo abaixo de US$\u00A00,01')
            : tr(`+${dust} assets with a balance under $0.01`, `+${dust} ativos com saldo abaixo de US$\u00A00,01`)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Rendendo, poder de compra e emprestado: três números à parte, nenhum somado ao saldo. O poder de compra é o da fonte
 * (availableBalance), não limite − emprestado. Sem limite de crédito, a parte de crédito some.
 */
export function EarningCredit({ s }: { s: PortfolioSummary }) {
  const tr = useTr();
  const y = s.yield;
  const credit = s.creditLimit > 0;
  const high = s.utilization > 80;
  const label = 'text-xs font-medium uppercase tracking-[0.12em] text-faint';
  const figure = 'tnum font-display text-2xl font-semibold tracking-tight';
  return (
    <Panel>
      <PanelTitle>{tr('Earning and credit', 'Rendendo e crédito')}</PanelTitle>
      <dl className="divide-y divide-line">
        <div className="pb-4">
          <dt className={label}>{tr('Earning', 'Rendendo')}</dt>
          {y.earning > 0 ? (
            <>
              <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={figure}>
                  <span aria-hidden>≈{'\u00A0'}</span>
                  <span className="sr-only">{tr('about ', 'cerca de ')}</span>
                  {usd(y.monthly)}
                </span>
                <span className="text-sm text-muted">{tr('a month', 'por mês')}</span>
                <Badge>{tr('Estimate', 'Estimativa')}</Badge>
              </dd>
              <dd className="mt-1 text-xs leading-relaxed text-muted">
                {nb(tr(
                  `average APY ${pct(y.avgApy, 1)}, variable · on ${usd(y.earning)} that reports an APY`,
                  `APY médio ${pct(y.avgApy, 1)}, variável · sobre ${usd(y.earning)} com APY informado`,
                ))}
              </dd>
              {s.borrowed > 0 ? (
                <dd className="mt-1 text-xs leading-relaxed text-faint">
                  {tr('Before interest on what’s borrowed: the source doesn’t report that rate.', 'Antes dos juros do emprestado: a fonte não informa essa taxa.')}
                </dd>
              ) : null}
            </>
          ) : (
            <dd className="mt-1 text-sm text-muted">{tr('No asset reports an APY.', 'Nenhum ativo informa APY.')}</dd>
          )}
        </div>
        {s.spendingPower !== null ? (
          <div className="py-4">
            <dt className={label}>{tr('Spending power', 'Poder de compra')}</dt>
            <dd className={cx(figure, 'mt-1')}>{usd(s.spendingPower)}</dd>
            <dd className="mt-1 text-xs leading-relaxed text-muted">{tr('what the card can spend now, as ether.fi reports it', 'o que o cartão pode gastar agora, como a ether.fi informa')}</dd>
          </div>
        ) : null}
        {credit ? (
          <div className="pt-4">
            <dt className={label}>{tr('Borrowed', 'Emprestado')}</dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className={figure}>{usd(s.borrowed)}</span>
              <span className="whitespace-nowrap text-sm text-muted">{tr(`of ${usd(s.creditLimit)} limit`, `de ${usd(s.creditLimit)} de limite`)}</span>
            </dd>
            {/* o percentual em uso fica escrito ao lado, e a barra é um medidor que o leitor de tela lê (4.1.2) */}
            <dd className="mt-3 flex items-center gap-3">
              <div
                role="meter"
                aria-label={tr('Credit in use', 'Crédito em uso')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, s.utilization)}
                aria-valuetext={tr(`${pct(s.utilization, 1)} of the reported limit`, `${pct(s.utilization, 1)} do limite informado`)}
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line"
              >
                <div className={cx('h-full rounded-full', high ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.min(100, s.utilization)}%` }} />
              </div>
              <span aria-hidden className="tnum shrink-0 text-xs text-muted">{tr(`${pct(s.utilization, 1)} in use`, `${pct(s.utilization, 1)} em uso`)}</span>
            </dd>
            {/* o limite informado se comporta como o de liquidação: o medidor diz isso sempre, e mais alto perto do fim */}
            <dd className={cx('mt-2 text-xs leading-relaxed', high ? 'text-ink' : 'text-muted')}>
              {tr(
                'Of the reported limit, which behaves like the liquidation limit: near 100% is the liquidation zone. Check the Health Factor in the ether.fi app.',
                'Do limite informado, que se comporta como o de liquidação: perto de 100% é a zona de liquidação. Confira o Health Factor no app da ether.fi.',
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-4">
        <Why>
          {tr(
            'Earning = value × APY ÷ 12 for each asset with a reported APY; APY changes, so treat it as a ballpark. Spending power, the limit and what’s borrowed are the figures the ether.fi connector reports. None of them is added to the total above.',
            'Rendendo = valor × APY ÷ 12 de cada ativo com APY informado; o APY muda, então trate como ordem de grandeza. Poder de compra, limite e emprestado são os números que o conector da ether.fi informa. Nenhum deles entra no total lá em cima.',
          )}
        </Why>
      </div>
    </Panel>
  );
}

/**
 * "7 esperando você": renovações para responder e alertas de compra. O "Precisa de atenção" mora em Gastos, e esta
 * linha leva até ele, no mesmo padrão da ponte de gastos. Só aparece quando há algo.
 */
export function AttentionLine({ onOpen }: { onOpen: () => void }) {
  const attention = useAttention();
  const { dataset, isSample, loadError } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  // os dados reais falharam e a tela caiu no demo: o número viria dos dados fictícios (alarme falso), como na barra
  if (!attention.total || (loadError && isSample) || (dataset.neverFunded && !dataset.transactions.length)) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'panel flex min-h-12 w-full cursor-pointer items-center gap-3 p-4 text-left transition-colors hover:border-line2 active:bg-panel2',
        attention.urgent ? 'border-bad/40' : 'border-info/30',
      )}
    >
      <Inbox aria-hidden className={cx('size-4 shrink-0', attention.urgent ? 'text-bad' : 'text-info')} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium text-ink">
          <span className="whitespace-nowrap">{waitingLabel(attention.total, locale)}</span>
          {/* vermelho só com algo urgente, e com a palavra junto (a cor sozinha não basta, 1.4.1) */}
          {attention.urgent ? <Badge tone="bad">{tr('urgent', 'urgente')}</Badge> : null}
        </span>
        <span className="line-clamp-2 block text-xs text-muted">{attentionSummary(attention, locale)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm text-muted">
        <span className="max-[359px]:sr-only">{tr('See in Spending', 'Ver em Gastos')}</span>
        <ArrowRight aria-hidden className="size-4" />
      </span>
    </button>
  );
}

/**
 * Do "tenho" para o "gastei": o gasto do mês até hoje ("≈" pelo câmbio médio do histórico, que soma o que foi pago na
 * moeda local) e o caminho para Gastos.
 */
export function SpendBridge({ onOpen }: { onOpen: () => void }) {
  const { dataset } = useStore();
  const tr = useTr();
  const { from, monthStart, month } = monthToDate(dataset);
  const approx = approxHome(month.rows, fxSummary(dataset));
  const since = from !== monthStart;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="panel flex min-h-12 w-full cursor-pointer items-center gap-3 p-4 text-left transition-colors hover:border-line2 active:bg-panel2"
    >
      <Receipt aria-hidden className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-sm text-muted">
        {month.count ? (
          <>
            {since ? tr(`Since ${dateShort(from)} you spent`, `Desde ${dateShort(from)} você gastou`) : tr('This month you spent', 'Este mês você gastou')}{' '}
            <span className="tnum font-medium text-ink">{usd(month.total)}</span>
            {/* o "·" fica preso ao que vem antes e a linha pode quebrar depois dele: só cada trecho é inteiro */}
            {approx ? <>{'\u00A0· '}<span className="tnum whitespace-nowrap">{approx.replace('≈ ', '≈\u00A0')}</span></> : null}
            {'\u00A0· '}<span className="whitespace-nowrap">{month.count}{'\u00A0'}{month.count === 1 ? tr('purchase', 'compra') : tr('purchases', 'compras')}</span>
          </>
        ) : (
          tr('No card purchases this month yet', 'Nenhuma compra no cartão neste mês ainda')
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm text-muted">
        <span className="max-[359px]:sr-only">{tr('See spending', 'Ver gastos')}</span>
        <ArrowRight aria-hidden className="size-4" />
      </span>
    </button>
  );
}

/**
 * "2 pagamentos · US$ 116,80 ainda a confirmar": quantas linhas e quanto ainda não caiu. Quando nada caiu ainda, diz
 * "aguardando crédito" (repetir o mesmo valor como "pendente" parecia contradizer o "resgatado").
 * words: [en 1, en n, pt 1, pt n]
 */
function rewardSub(r: { count: number; pending: number; total: number }, words: [string, string, string, string], tr: Tr): string {
  const n = tr(`${r.count}\u00A0${r.count === 1 ? words[0] : words[1]}`, `${r.count}\u00A0${r.count === 1 ? words[2] : words[3]}`);
  if (!r.pending) return n;
  if (r.pending >= r.total) return `${n}\u00A0· ${tr('awaiting credit', 'aguardando crédito')}`;
  return `${n}\u00A0· ${tr(`${usd(r.pending)}\u00A0still pending`, `${usd(r.pending)}\u00A0ainda a confirmar`)}`;
}

/** Cashback e indicações do histórico inteiro, com o cashback por mês dos últimos 90 dias (veio da antiga Conta). */
export function RewardsPanel() {
  const { dataset } = useStore();
  const tr = useTr();
  const win = periodWindow(dataset, '90d');
  const cashback = cashbackSummary(dataset, win.from, win.to);
  const rewards = rewardsSummary(dataset);
  if (!rewards.cashback.count && !rewards.referral.count) return null;
  return (
    <Panel>
      <PanelTitle hint={tr('whole history', 'todo o histórico')}>{tr('Rewards', 'Recompensas')}</PanelTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        {rewards.cashback.count ? (
          <Stat
            label={rewards.cashback.kind === 'claimed' ? tr('Cashback claimed', 'Cashback resgatado') : tr('Cashback received', 'Cashback recebido')}
            value={usd(rewards.cashback.total)}
            tone="good"
            sub={rewardSub(rewards.cashback, rewards.cashback.kind === 'claimed' ? ['claim', 'claims', 'resgate', 'resgates'] : ['credit', 'credits', 'crédito', 'créditos'], tr)}
          />
        ) : null}
        {rewards.referral.count ? (
          <Stat label={tr('Referral payouts', 'Indicações pagas')} value={usd(rewards.referral.total)} tone="good" sub={rewardSub(rewards.referral, ['payout', 'payouts', 'pagamento', 'pagamentos'], tr)} />
        ) : null}
      </div>
      {cashback.count ? (
        <div className="mt-4">
          <div className="mb-2 text-xs text-muted">{tr('Cashback per month, last 90\u00A0days', 'Cashback por mês, últimos 90\u00A0dias')}</div>
          <MonthBars data={cashback.byMonth} />
        </div>
      ) : null}
      {rewards.cashback.kind === 'claimed' ? (
        <p className="mt-3 text-xs leading-relaxed text-faint">
          {tr(
            'The connector shows cashback only when you claim it. What each purchase earned and the balance still to claim are in the ether.fi app.',
            'O conector mostra o cashback só quando você resgata. O que cada compra rendeu e o saldo ainda a resgatar estão no app da ether.fi.',
          )}
        </p>
      ) : null}
    </Panel>
  );
}
