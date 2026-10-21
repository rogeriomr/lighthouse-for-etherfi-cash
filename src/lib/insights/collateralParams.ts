// Parâmetros públicos do crédito da ether.fi Cash (mercado Aave LendGateway na Optimism), copiados da documentação
// com a data em que foram conferidos. Não vêm do conector: o conector traz o limite, o emprestado e um LTV por ativo
// que, no USDC, segue a tabela legada. A ether.fi pode mudar tudo isto; o app dela é a fonte da verdade.

import type { InsightSource } from './types';

/** Dia em que a tabela foi conferida (a página diz "last updated August 27, 2026") */
export const PARAMS_CHECKED = '2026-10-19';
export const PARAMS_UPDATED = '2026-08-27';

export const PARAMS_SOURCE: InsightSource = {
  label: 'ether.fi · Lending market parameters',
  url: 'https://etherfi.gitbook.io/etherfi/products/borrow/lending-market-parameters',
  checked: PARAMS_CHECKED,
};
export const LIQUIDATION_SOURCE: InsightSource = {
  label: 'ether.fi · Borrowing power, health factor and liquidation',
  url: 'https://etherfi.gitbook.io/etherfi/products/borrow/borrowing-power-and-liquidation',
  checked: PARAMS_CHECKED,
};
export const MODES_SOURCE: InsightSource = {
  label: 'ether.fi · Borrow Mode vs Direct Pay Mode',
  url: 'https://help.ether.fi/en/articles/326983-understanding-your-cash-card-borrow-mode-vs-direct-pay-mode',
  checked: PARAMS_CHECKED,
};
export const REPAY_SOURCE: InsightSource = {
  label: 'ether.fi · Repay with Liquid vault tokens',
  url: 'https://help.ether.fi/en/articles/866312',
  checked: PARAMS_CHECKED,
};
export const BORROW_SOURCE: InsightSource = {
  label: 'ether.fi · How Borrow works',
  url: 'https://help.ether.fi/en/articles/764754-how-borrow-works',
  checked: PARAMS_CHECKED,
};

export interface CollateralParams {
  /** Product LTV: o limite de empréstimo que o app aplica (fração) */
  productLtv: number;
  /** CF, fator de colateral = limiar de liquidação (fração): é o que entra no fator de saúde */
  cf: number;
  /** Pode ser tomado emprestado (USDC e WETH) */
  borrowable?: boolean;
}

/** Símbolo exato, como o conector manda. Os embrulhados (wSPYx, wQQQx, wTBLLx) não estão na tabela: sem parâmetro */
export const COLLATERAL: Record<string, CollateralParams> = {
  USDC: { productLtv: 0.81, cf: 0.9, borrowable: true },
  USDT: { productLtv: 0.81, cf: 0.9 },
  EURC: { productLtv: 0.81, cf: 0.9 },
  frxUSD: { productLtv: 0.81, cf: 0.9 },
  weETH: { productLtv: 0.55, cf: 0.75 },
  WETH: { productLtv: 0.55, cf: 0.75, borrowable: true },
  eBTC: { productLtv: 0.52, cf: 0.72 },
  ETHFI: { productLtv: 0.2, cf: 0.4 },
  sETHFI: { productLtv: 0.2, cf: 0.4 },
  OP: { productLtv: 0.2, cf: 0.4 },
  WHYPE: { productLtv: 0.45, cf: 0.65 },
  beHYPE: { productLtv: 0.4, cf: 0.6 },
  liquidETH: { productLtv: 0.5, cf: 0.7 },
  liquidBTC: { productLtv: 0.5, cf: 0.7 },
  liquidUSD: { productLtv: 0.8, cf: 0.9 },
  liquidReserve: { productLtv: 0.8, cf: 0.9 },
  liquidEUR: { productLtv: 0.8, cf: 0.9 },
  liquidRWA: { productLtv: 0.75, cf: 0.9 },
  QQQx: { productLtv: 0.66, cf: 0.78 },
  SPYx: { productLtv: 0.67, cf: 0.78 },
  PAXG: { productLtv: 0.68, cf: 0.8 },
  TBLLx: { productLtv: 0.7, cf: 0.8 },
};

/** Ativos cujo preço segue o do ETH: o simulador de queda os derruba juntos */
export const ETH_BASED = new Set(['WETH', 'weETH', 'liquidETH']);

/** Modelo de juros de duas inclinações (fração ao ano): base, inclinação até a quebra, inclinação depois dela */
export interface RateModel {
  base: number;
  slope1: number;
  slope2: number;
  /** Uso do mercado em que a inclinação muda */
  kink: number;
}

export const RATE_MODELS: Record<'USDC' | 'WETH', RateModel> = {
  USDC: { base: 0.03, slope1: 0.0125, slope2: 0.1, kink: 0.85 },
  WETH: { base: 0.01, slope1: 0.015, slope2: 0.14, kink: 0.85 },
};

/**
 * Taxa anual do modelo num uso do mercado (0–1), pela fórmula usual do modelo de duas inclinações: até a quebra,
 * base + slope1 × uso ÷ quebra; depois, base + slope1 + slope2 × (uso − quebra) ÷ (1 − quebra). A página publica os
 * parâmetros, não a fórmula; o uso do mercado não vem no conector, por isso o app só mostra faixas.
 */
export function modelRate(model: RateModel, utilization: number): number {
  const u = Math.min(1, Math.max(0, utilization));
  if (u <= model.kink) return model.base + (model.slope1 * u) / model.kink;
  return model.base + model.slope1 + (model.slope2 * (u - model.kink)) / (1 - model.kink);
}

/** Faixa publicada: mercado ocioso, na quebra (o uso usual) e com 100% de uso */
export function rateRange(model: RateModel): { low: number; usual: number; max: number } {
  return { low: modelRate(model, 0), usual: modelRate(model, model.kink), max: modelRate(model, 1) };
}

/** Limites do pagamento com token de cofre, em 24 h móveis (US$), pela ajuda da ether.fi */
export const REPAY_WITH_VAULT: Record<'liquidUSD' | 'liquidRWA' | 'liquidEUR', { pays: 'USDC' | 'EURC'; limitKyc: number; limitNoKyc: number }> = {
  liquidUSD: { pays: 'USDC', limitKyc: 10000, limitNoKyc: 10000 },
  liquidRWA: { pays: 'USDC', limitKyc: 10000, limitNoKyc: 2500 },
  liquidEUR: { pays: 'EURC', limitKyc: 10000, limitNoKyc: 2500 },
};

/** O Direct Pay gasta USDC e, depois, liquidUSD; os outros ativos não pagam compra direta */
export const DIRECT_PAY_ASSETS = ['USDC', 'liquidUSD'] as const;
