import { ArrowRight } from 'lucide-react';
import { coverageOf } from '../lib/earnings';
import { pct } from '../lib/format';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';
import { useSubscriptions } from '../state/decisions';
import { useEarnings } from './earningsData';

// O atalho para a tela Ganhos em Assinaturas (custo por mês: "≈ X% coberto pelos seus ganhos →"). No Portfólio, o
// resumo inteiro mora em earningsHero.tsx. Usam o mesmo motor e as mesmas preferências da tela.

const linkClass = 'tap -my-1 inline-flex cursor-pointer items-center gap-1 py-1 text-left font-medium text-accent underline-offset-2 hover:underline';

/**
 * "≈ 62% coberto pelos seus ganhos →", sob o custo por mês de Assinaturas: o que a alocação da tela Ganhos paga das
 * assinaturas ÷ o custo delas (coverageOf do motor, o mesmo número da lista de lá). Link de verdade (#/earnings).
 */
export function EarningsCoverageLink({ className }: { className?: string }) {
  const tr = useTr();
  const e = useEarnings();
  const { report } = useSubscriptions();
  const cov = coverageOf(e.allocation, 'subscription');
  if (!(report.monthlyTotalUsd > 0) || !(cov.totalMonthly > 0) || !(e.totalMonthly > 0)) return null;
  // 100% só com todas pagas inteiras
  const share = cov.covered === cov.count ? 100 : Math.min(99, Math.round(cov.share * 100));
  return (
    <a href="#/earnings" className={cx(linkClass, 'text-xs', className)}>
      <span>
        <span aria-hidden>≈{' '}</span>
        <span className="sr-only">{tr('about ', 'cerca de ')}</span>
        {tr(`${pct(share)} covered by your earnings`, `${pct(share)} coberto pelos seus ganhos`)}
      </span>
      <ArrowRight aria-hidden className="size-3.5 shrink-0" />
    </a>
  );
}
