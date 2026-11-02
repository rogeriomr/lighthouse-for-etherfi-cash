import { ArrowRight, Bell } from 'lucide-react';
import { nb, pct, usd } from '../lib/format';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';
import { colorOfSource, flowOrder, useEarnings, useEarningsNews } from './earningsData';
import { CoverageTargetsList, periodFmt, sourceLabel, type PeriodFmt } from './earningsPanels';
import { CoverageBlocks } from './earningsReceipt';
import { Badge, Panel, Why } from './ui';
import { DEFAULT_EARNINGS_PREFS, type Earnings } from '../lib/earnings';

// "O que os seus ganhos pagam", o ouro da tela Ganhos: quanto os ganhos rendem, de onde vêm, a barra do que eles pagam
// (com a dica de cada item) e quanto no Liquid cobriria 50%, 75% e 100%. Mora em dois lugares, com o mesmo motor e as
// mesmas preferências: no topo da tela Ganhos (EarningsSummary, com mês ou ano) e no Portfólio, logo abaixo do saldo
// (EarningsHero, sempre por mês, com o atalho para a conta inteira).

const MONTHLY = { ...DEFAULT_EARNINGS_PREFS, period: 'monthly' as const };

/** O total, as fontes coloridas (a cor de cada uma é a do recibo e do fluxo) e a barra de cobertura com a legenda. */
function SummaryHead({ e, f, badge }: { e: Earnings; f: PeriodFmt; badge?: boolean }) {
  const tr = useTr();
  const sources = flowOrder(e.sources);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium uppercase tracking-[0.1em] text-muted sm:tracking-[0.14em]">{tr('What your earnings pay', 'O que os seus ganhos pagam')}</h2>
          <p className="mt-2 font-display text-[clamp(1.5rem,6vw,2.25rem)] leading-tight font-semibold tracking-tight text-ink">
            <span className="tnum">{f.amt(e.totalMonthly, e.totalAnnual)}</span>{' '}
            <span className="text-base font-normal text-faint sm:text-lg">
              {f.yearly ? tr('a year in estimated earnings', 'por ano de ganhos estimados') : tr('a month in estimated earnings', 'por mês de ganhos estimados')}
            </span>
          </p>
        </div>
        {badge ? <Badge>{tr('Estimate', 'Estimativa')}</Badge> : null}
      </div>
      {sources.length ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {sources.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-[3px]" style={{ backgroundColor: colorOfSource(s) }} />
              <span>{sourceLabel(s, tr)}</span>
              <span className="tnum text-ink">{f.amt(s.monthly, s.annual)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <CoverageBlocks e={e} f={f} />
    </>
  );
}

const hasSummary = (e: Earnings) => !e.empty && (e.allocation.count > 0 || e.totalMonthly > 0);

/**
 * O topo da tela Ganhos: o total, as fontes e a barra na largura toda (blocos largos, fáceis de apontar) e, embaixo,
 * quanto no Liquid cobriria 50%, 75% e 100%, um cartão por meta, com o saldo de hoje e o "por quê?". O recibo item a
 * item fica embaixo, na conta do mês.
 */
export function EarningsSummary({ e, f }: { e: Earnings; f: PeriodFmt }) {
  const tr = useTr();
  if (!hasSummary(e)) return null;
  const t = e.targets;
  return (
    <Panel>
      <SummaryHead e={e} f={f} />
      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-[13px] font-medium uppercase tracking-[0.1em] text-muted sm:tracking-[0.14em]">{tr('How much in Liquid would cover', 'Quanto no Liquid cobriria')}</h3>
        {t.kind === 'targets' ? (
          <p className="mt-1 mb-3 text-sm leading-relaxed text-muted">
            {nb(tr(
              `Today you have ${usd(t.liquidValue)} in Liquid, earning ≈ ${pct(t.apy, 1)} a year. At today’s APY, with cashback as it is:`,
              `Hoje você tem ${usd(t.liquidValue)} no Liquid, rendendo ≈ ${pct(t.apy, 1)} ao ano. Ao APY de hoje, com o cashback como está:`,
            ))}
          </p>
        ) : null}
        <CoverageTargetsList e={e} tiles />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge>{e.texts.note}</Badge>
          <Why>{e.texts.why.targets}</Why>
        </div>
      </div>
    </Panel>
  );
}

/** O resumo no Portfólio: sempre por mês, as metas lado a lado a partir de 640 px e o atalho para a tela Ganhos. */
export function EarningsHero({ onOpen }: { onOpen: () => void }) {
  const tr = useTr();
  const e = useEarnings();
  const news = useEarningsNews();
  if (!hasSummary(e)) return null;
  const f = periodFmt(MONTHLY, tr);
  return (
    <Panel className="relative">
      <SummaryHead e={e} f={f} badge />

      {e.targets.kind === 'targets' ? (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-xs font-medium text-muted">{tr('How much in Liquid would cover, at today’s APY', 'Quanto no Liquid cobriria, ao APY de hoje')}</h3>
          {/* no celular, uma meta por linha; a partir de 640px, as três lado a lado (a lista vira as células da grade) */}
          <div className="mt-1 sm:grid sm:grid-cols-3 sm:gap-4 sm:[&_li]:border-0 sm:[&_li]:py-1 sm:[&_ul]:contents">
            <CoverageTargetsList e={e} compact />
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onOpen}
          className="tap -my-1 inline-flex cursor-pointer items-center gap-1 py-1 text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          {tr('See the full sum', 'Ver a conta inteira')}
          <ArrowRight aria-hidden className="size-3.5" />
        </button>
        {news.changes.length ? (
          <button
            type="button"
            onClick={onOpen}
            className={cx('tap -my-1 inline-flex cursor-pointer items-center gap-1.5 py-1 text-xs text-muted transition-colors hover:text-ink')}
          >
            <Bell aria-hidden className="size-3.5 text-accent" />
            {nb(news.changes.length === 1
              ? tr('1 change since your last visit', '1 novidade desde a sua última visita')
              : tr(`${news.changes.length} changes since your last visit`, `${news.changes.length} novidades desde a sua última visita`))}
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
