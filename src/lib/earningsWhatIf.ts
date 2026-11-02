// Os cenários "e se" da tela Ganhos, do resumo para a IA e do npm run earnings: mais saldo rendendo no Liquid, ou
// outro APY nos cofres. Funções puras sobre o dataset: devolvem uma cópia, e o motor (buildEarnings) faz a conta de
// sempre. O cashback não muda em nenhum cenário: não existe "e se eu gastar mais".
import { isVault } from './assetClass.ts';
import type { Dataset, Holding } from './types';

export interface WhatIf {
  /** US$ a mais nos cofres Liquid, repartidos na proporção do que cada cofre com APY já tem (o APY médio não muda) */
  extraLiquidUsd?: number;
  /** APY (%) que passa a valer em todos os cofres Liquid com saldo */
  liquidApy?: number;
}

export const WHAT_IF_LIMITS = { extraLiquidUsd: 100_000_000, apy: 100 } as const;

export type WhatIfError =
  /** valor a mais inválido (negativo, não numérico ou acima do limite) */
  | 'extra_invalid'
  /** APY inválido (negativo, não numérico ou acima de 100%) */
  | 'apy_invalid'
  /** mais Liquid sem nenhum cofre com APY e sem um APY informado: não há taxa para a conta */
  | 'no_liquid';

const isLiquid = (h: Holding) => Boolean(h.vault) || isVault(h);
const earning = (h: Holding) => isLiquid(h) && (h.apy ?? 0) > 0 && h.dollarValue > 0;
const withValue = (h: Holding) => isLiquid(h) && h.dollarValue > 0;

/** O que há de errado no cenário para este dataset; lista vazia = dá para aplicar. */
export function whatIfErrors(dataset: Dataset, w: WhatIf): WhatIfError[] {
  const out: WhatIfError[] = [];
  const extra = w.extraLiquidUsd;
  if (extra !== undefined && (!Number.isFinite(extra) || extra < 0 || extra > WHAT_IF_LIMITS.extraLiquidUsd)) out.push('extra_invalid');
  const apy = w.liquidApy;
  if (apy !== undefined && (!Number.isFinite(apy) || apy < 0 || apy > WHAT_IF_LIMITS.apy)) out.push('apy_invalid');
  if (!out.length && extra && extra > 0 && !dataset.portfolio.holdings.some(earning) && !(apy && apy > 0)) out.push('no_liquid');
  return out;
}

export function whatIfErrorText(code: WhatIfError, tr: (en: string, pt: string) => string): string {
  switch (code) {
    case 'extra_invalid': return tr('The extra amount must be a number from 0 to 100,000,000.', 'O valor a mais precisa ser um número de 0 a 100.000.000.');
    case 'apy_invalid': return tr('The APY must be a percentage from 0 to 100.', 'O APY precisa ser um percentual de 0 a 100.');
    case 'no_liquid': return tr('Nothing earns in Liquid today: give an APY for the scenario too.', 'Nada rende no Liquid hoje: informe também um APY para o cenário.');
  }
}

/**
 * O dataset com o cenário aplicado. Primeiro o APY (todos os cofres Liquid com saldo passam a render `liquidApy`),
 * depois o valor a mais: repartido na proporção do que cada cofre com APY tem, a quantidade junto (o preço fica). Sem
 * cofre com APY e com `liquidApy`, entra um cofre "Liquid" só com o valor a mais. Cenário inválido: erro (confira com
 * whatIfErrors antes).
 */
export function applyWhatIf(dataset: Dataset, w: WhatIf): Dataset {
  const errors = whatIfErrors(dataset, w);
  if (errors.length) throw new Error(`what-if: ${errors.join(', ')}`);
  let holdings = dataset.portfolio.holdings.map((h) => (w.liquidApy !== undefined && withValue(h) ? { ...h, apy: w.liquidApy } : { ...h }));
  const extra = w.extraLiquidUsd ?? 0;
  if (extra > 0) {
    const pool = holdings.filter(earning);
    const base = pool.reduce((s, h) => s + h.dollarValue, 0);
    if (pool.length && base > 0) {
      holdings = holdings.map((h) => {
        if (!pool.includes(h)) return h;
        const factor = 1 + (extra * (h.dollarValue / base)) / h.dollarValue;
        return { ...h, dollarValue: h.dollarValue * factor, ...(h.quantity !== undefined ? { quantity: h.quantity * factor } : {}) };
      });
    } else {
      holdings = [...holdings, { asset: 'Liquid', dollarValue: extra, apy: w.liquidApy ?? 0, groupId: 'liquidVaults', vault: true }];
    }
  }
  return { ...dataset, portfolio: { ...dataset.portfolio, holdings } };
}
