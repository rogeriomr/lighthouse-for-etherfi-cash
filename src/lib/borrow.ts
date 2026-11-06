// Empréstimo (#/borrow): o modo Borrow da ether.fi Cash como a Aave mostra uma posição. A garantia (o que rende no cofre),
// os empréstimos (o que custam ao ano), a distância até a liquidação e o que o rendimento da garantia paga da dívida.
// Funções puras: a tela, o check e quem mais quiser usam a mesma conta.
//
// Parâmetros: a tabela pública "Lending Market Parameters" da ether.fi (mercado Aave V4 na Optimism, conferida em
// 27/08/2026). As taxas de juros mudam a toda hora e o conector não as informa: o padrão é o que o app da ether.fi
// mostrava em 05/11/2026, e a pessoa troca pela do app dela. Informação e cenário, nunca recomendação.

import type { Dataset, Holding } from './types.ts';

// ---------- parâmetros do mercado ----------

/** O que move o preço de uma garantia (ou de uma dívida). 'usd' fica parado: é a moeda da conta. */
export type Underlying = 'usd' | 'eur' | 'eth' | 'btc' | 'hype' | 'ethfi' | 'op' | 'stocks' | 'gold' | 'chf' | 'other';

export interface MarketAsset {
  symbol: string;
  /** Nome curto para a lista "Adicionar garantia" */
  name: string;
  /** Product LTV: o limite que o app usa para o poder de empréstimo (fração) */
  productLtv: number;
  /** Collateral factor: o peso da garantia no health factor, a liquidação (fração) */
  cf: number;
  /** Bônus máximo do liquidante (fração) */
  maxBonus: number;
  underlying: Underlying;
  /** Cofre Liquid (a tela Earn do app): vai no topo da lista "Adicionar garantia" */
  vault?: boolean;
  /** APY que a tela Earn do app mostrava em 05/11/2026 (%), o ponto de partida ao simular; a da conta vence */
  refApy?: number;
}

/** A data dos APYs de referência dos cofres (o print da tela Earn do app). */
export const EARN_APY_DATE = '2026-11-05';

export const MARKET_SOURCE = {
  url: 'https://etherfi.gitbook.io/etherfi/products/borrow/lending-market-parameters',
  checked: '2026-08-27',
  chain: 'Optimism',
  protocol: 'Aave V4',
} as const;

/** "Lending Market Parameters" (27/08/2026): Product LTV, CF e bônus máximo de cada garantia aceita. */
export const MARKET_ASSETS: readonly MarketAsset[] = [
  // os cofres da tela Earn, na ordem do app (USD Bold, USD RWAs, USD, ETH, BTC, EUR), com o APY que ela mostrava
  { symbol: 'liquidBold', name: 'USD Bold', productLtv: 0.64, cf: 0.75, maxBonus: 0.075, underlying: 'usd', vault: true, refApy: 8 },
  { symbol: 'liquidRWA', name: 'USD RWAs', productLtv: 0.75, cf: 0.9, maxBonus: 0.075, underlying: 'usd', vault: true, refApy: 6.08 },
  { symbol: 'liquidUSD', name: 'USD Yield', productLtv: 0.8, cf: 0.9, maxBonus: 0.075, underlying: 'usd', vault: true, refApy: 4.75 },
  { symbol: 'liquidETH', name: 'ETH Yield', productLtv: 0.5, cf: 0.7, maxBonus: 0.15, underlying: 'eth', vault: true, refApy: 3.4 },
  { symbol: 'liquidBTC', name: 'BTC Yield', productLtv: 0.5, cf: 0.7, maxBonus: 0.15, underlying: 'btc', vault: true, refApy: 1.04 },
  { symbol: 'liquidEUR', name: 'EUR Yield', productLtv: 0.8, cf: 0.9, maxBonus: 0.075, underlying: 'eur', vault: true, refApy: 5.61 },
  { symbol: 'liquidReserve', name: 'Liquid Reserve', productLtv: 0.8, cf: 0.9, maxBonus: 0.075, underlying: 'usd', vault: true },
  { symbol: 'USDC', name: 'USDC', productLtv: 0.81, cf: 0.9, maxBonus: 0.05, underlying: 'usd' },
  { symbol: 'USDT', name: 'USDT', productLtv: 0.81, cf: 0.9, maxBonus: 0.05, underlying: 'usd' },
  { symbol: 'frxUSD', name: 'frxUSD', productLtv: 0.81, cf: 0.9, maxBonus: 0.075, underlying: 'usd' },
  { symbol: 'EURC', name: 'EURC', productLtv: 0.81, cf: 0.9, maxBonus: 0.075, underlying: 'eur' },
  { symbol: 'weETH', name: 'Staked ETH', productLtv: 0.55, cf: 0.75, maxBonus: 0.1, underlying: 'eth' },
  { symbol: 'WETH', name: 'Wrapped ETH', productLtv: 0.55, cf: 0.75, maxBonus: 0.1, underlying: 'eth' },
  { symbol: 'eBTC', name: 'ether.fi BTC', productLtv: 0.52, cf: 0.72, maxBonus: 0.125, underlying: 'btc' },
  { symbol: 'WHYPE', name: 'Wrapped HYPE', productLtv: 0.45, cf: 0.65, maxBonus: 0.125, underlying: 'hype' },
  { symbol: 'beHYPE', name: 'Staked HYPE', productLtv: 0.4, cf: 0.6, maxBonus: 0.15, underlying: 'hype' },
  { symbol: 'ETHFI', name: 'ETHFI', productLtv: 0.2, cf: 0.4, maxBonus: 0.15, underlying: 'ethfi' },
  { symbol: 'sETHFI', name: 'Staked ETHFI', productLtv: 0.2, cf: 0.4, maxBonus: 0.2, underlying: 'ethfi' },
  { symbol: 'OP', name: 'Optimism', productLtv: 0.2, cf: 0.4, maxBonus: 0.15, underlying: 'op' },
  { symbol: 'QQQx', name: 'Nasdaq 100 (xStock)', productLtv: 0.66, cf: 0.78, maxBonus: 0.1, underlying: 'stocks' },
  { symbol: 'SPYx', name: 'S&P 500 (xStock)', productLtv: 0.67, cf: 0.78, maxBonus: 0.1, underlying: 'stocks' },
  { symbol: 'TBLLx', name: 'T-Bills (xStock)', productLtv: 0.7, cf: 0.8, maxBonus: 0.1, underlying: 'usd' },
  { symbol: 'PAXG', name: 'Gold (PAXG)', productLtv: 0.68, cf: 0.8, maxBonus: 0.1, underlying: 'gold' },
];

/** O ativo do mercado pelo símbolo exato (sem diferenciar maiúsculas). */
export function marketAsset(symbol: string): MarketAsset | undefined {
  const s = symbol.toLowerCase();
  return MARKET_ASSETS.find((a) => a.symbol.toLowerCase() === s);
}

/**
 * Health factor de cada ação (central de ajuda, "Monitoring your borrow position", 02/10/2026): 1,00 libera a
 * liquidação; gastar no cartão pede 1,1; um empréstimo novo pode pedir até 1,5. A liquidação devolve a posição a 1,24.
 * A tela não mostra o número (o varejo não lê health factor): ela fala em três degraus, "aviso" (1,2, amarelo: a
 * margem começa a encolher; não é regra da ether.fi, é o primeiro sinal da tela), "atenção" (1,1, laranja: o cartão
 * para de gastar) e "liquidação" (1,00, vermelho).
 */
export const HF = { liquidation: 1, spending: 1.1, warning: 1.2, borrowing: 1.5, liquidationTarget: 1.24 } as const;

export const HF_SOURCE = 'https://help.ether.fi/en/articles/558503-monitoring-your-borrow-position-and-liquidation-risk';

export type DebtAsset = 'USDT' | 'USDC' | 'EURC' | 'WETH';
export const DEBT_ASSETS: readonly DebtAsset[] = ['USDT', 'USDC', 'EURC', 'WETH'];
export const DEBT_UNDERLYING: Record<DebtAsset, Underlying> = { USDT: 'usd', USDC: 'usd', EURC: 'eur', WETH: 'eth' };

/** Os grupos da dívida na visão normal: dólar (USDT + USDC juntos), ETH e euro. Os detalhes separam por ativo. */
export type DebtGroup = 'usd' | 'eth' | 'eur';
export const DEBT_GROUPS: readonly DebtGroup[] = ['usd', 'eth', 'eur'];
export const DEBT_GROUP_OF: Record<DebtAsset, DebtGroup> = { USDT: 'usd', USDC: 'usd', EURC: 'eur', WETH: 'eth' };

/** Taxa de cada empréstimo (APR, %) que o app da ether.fi mostrava em 05/11/2026. Variável: muda com o uso do mercado. */
export const OBSERVED_RATES = { date: '2026-11-05', rates: { USDT: 3.55, USDC: 4.1, EURC: 3.38, WETH: 1.48 } as Record<DebtAsset, number> } as const;

/** Candles para o gráfico (Coinbase Exchange, pública), por ativo de referência. */
export const PRICE_PRODUCTS: Partial<Record<Underlying, { product: string; label: string }>> = {
  eth: { product: 'ETH-USD', label: 'ETH' },
  btc: { product: 'BTC-USD', label: 'BTC' },
  op: { product: 'OP-USD', label: 'OP' },
  gold: { product: 'PAXG-USD', label: 'PAXG' },
};

export const UNDERLYING_LABEL: Record<Underlying, string> = {
  usd: 'USD', eur: 'EUR', eth: 'ETH', btc: 'BTC', hype: 'HYPE', ethfi: 'ETHFI', op: 'OP', stocks: 'Stocks', gold: 'Gold', chf: 'CHF', other: '—',
};

export const isVolatile = (u: Underlying) => u !== 'usd';

// ---------- a posição ----------

export interface CollateralLine {
  /** O símbolo (uma linha por ativo) */
  symbol: string;
  name: string;
  valueUsd: number;
  /** APY em % (0 quando não rende) */
  apy: number;
  productLtv: number;
  cf: number;
  underlying: Underlying;
  /** Quantidade, quando a fonte informa: dá o preço unitário */
  quantity?: number;
  /** Veio da conta (e não foi adicionada na simulação) */
  fromAccount: boolean;
}

export interface DebtLine {
  asset: DebtAsset;
  /** Dívida em US$ */
  amount: number;
  /** APR, % */
  apr: number;
}

export interface BorrowPosition {
  collateral: CollateralLine[];
  debts: DebtLine[];
}

/** Ativos da conta que não entram como garantia (fora da tabela pública): a tela diz quais e por quê. */
export interface Uncounted {
  symbol: string;
  name: string;
  valueUsd: number;
}

/** Abaixo disto o ativo é poeira: não aparece na garantia (entra na conta do mesmo jeito, mas não vira linha). */
export const DUST_USD = 1;

/**
 * A garantia da conta: os ativos que sustentam o cartão (backsSpending, ou com LTV publicado) e que estão na tabela do
 * mercado. O LTV do conector (get_deposit_address) vence o da tabela; o CF só existe na tabela. Ativo sem preço fica fora.
 */
export function accountCollateral(holdings: readonly Holding[]): { lines: CollateralLine[]; uncounted: Uncounted[] } {
  const bySymbol = new Map<string, CollateralLine>();
  const uncounted: Uncounted[] = [];
  for (const h of holdings) {
    if (!(h.dollarValue > 0)) continue;
    const backs = h.backsSpending === true || (h.ltv ?? 0) > 0;
    if (!backs) continue;
    const m = marketAsset(h.asset);
    if (!m) {
      uncounted.push({ symbol: h.asset, name: h.name ?? h.asset, valueUsd: h.dollarValue });
      continue;
    }
    const prev = bySymbol.get(m.symbol);
    if (prev) {
      // o mesmo ativo em duas linhas (duas redes): soma valor e quantidade, APY ponderado
      const value = prev.valueUsd + h.dollarValue;
      prev.apy = value > 0 ? (prev.apy * prev.valueUsd + (h.apy ?? 0) * h.dollarValue) / value : prev.apy;
      prev.valueUsd = value;
      prev.quantity = prev.quantity !== undefined && h.quantity !== undefined ? prev.quantity + h.quantity : undefined;
      continue;
    }
    const ltv = h.ltv !== undefined && h.ltv > 0 && h.ltv < m.cf ? h.ltv : m.productLtv;
    bySymbol.set(m.symbol, {
      symbol: m.symbol,
      name: h.name ?? m.name,
      valueUsd: h.dollarValue,
      apy: h.apy !== undefined && Number.isFinite(h.apy) && h.apy > 0 ? h.apy : 0,
      productLtv: ltv,
      cf: m.cf,
      underlying: m.underlying,
      quantity: h.quantity !== undefined && h.quantity > 0 ? h.quantity : undefined,
      fromAccount: true,
    });
  }
  const lines = [...bySymbol.values()].sort((a, b) => b.valueUsd - a.valueUsd);
  return { lines, uncounted };
}

/** Uma linha nova de garantia (simulação) a partir da tabela do mercado. */
export function newCollateralLine(m: MarketAsset, valueUsd: number, apy = m.refApy ?? 0): CollateralLine {
  return { symbol: m.symbol, name: m.name, valueUsd, apy, productLtv: m.productLtv, cf: m.cf, underlying: m.underlying, fromAccount: false };
}

/**
 * A garantia do exemplo (demo e arquivos sintéticos) na tela Empréstimo: só o dólar que rende, o ETH em staking e o
 * ETHFI, como o dono pediu. As outras telas continuam com a carteira inteira do demo.
 */
export const SAMPLE_BORROW_COLLATERAL: readonly string[] = ['liquidUSD', 'weETH', 'ETHFI'];

/**
 * A posição da conta carregada. O conector informa só o total emprestado, não em qual ativo: o total vai para o ativo
 * que a pessoa escolheu (`debtAsset`, USDT por padrão), com a taxa dela. `only`: os símbolos que entram (o exemplo).
 */
export function accountPosition(dataset: Dataset, debtAsset: DebtAsset, apr: number, only?: readonly string[]): { position: BorrowPosition; uncounted: Uncounted[] } {
  const all = dataset.portfolio?.holdings ?? [];
  const keep = only?.map((s) => s.toLowerCase());
  const { lines, uncounted } = accountCollateral(keep ? all.filter((h) => keep.includes(h.asset.toLowerCase())) : all);
  const debt = Math.max(0, dataset.account?.amountBorrowed ?? 0);
  return { position: { collateral: lines, debts: debt > 0 ? [{ asset: debtAsset, amount: debt, apr }] : [] }, uncounted };
}

// ---------- cenários prontos ----------

export type ScenarioId = 'account' | 'big' | 'eth';

/**
 * Os cenários do topo da tela. O 1 é a conta como está (no exemplo, a garantia do demo). O 2 é muita garantia em dólar
 * e pouca dívida (a dívida é 10% da garantia). O 3 é garantia em ETH (o cofre ETH da tela Earn) com dívida perto do
 * limite: US$ 20 mil em liquidETH (LTV 50%) e US$ 5 mil em USD Yield (80%) dão US$ 14 mil de poder de empréstimo, então
 * a dívida é US$ 13 mil, não 15 (o app não deixaria pegar acima do poder). É onde a atenção e a liquidação aparecem.
 */
export function scenarioPosition(id: Exclude<ScenarioId, 'account'>): { collateral: CollateralLine[]; debts: { asset: DebtAsset; amount: number }[] } {
  const usdVault = MARKET_ASSETS.find((a) => a.symbol === 'liquidUSD')!;
  const ethVault = MARKET_ASSETS.find((a) => a.symbol === 'liquidETH')!;
  if (id === 'big') return { collateral: [newCollateralLine(usdVault, 50_000)], debts: [{ asset: 'USDT', amount: 5_000 }] };
  return { collateral: [newCollateralLine(ethVault, 20_000), newCollateralLine(usdVault, 5_000)], debts: [{ asset: 'USDT', amount: 13_000 }] };
}

// ---------- comparar taxas (a dica do empréstimo) ----------

export interface RateTip {
  /** O ativo do empréstimo de hoje e o mais barato da mesma moeda */
  from: DebtAsset;
  to: DebtAsset;
  fromApr: number;
  toApr: number;
  /** Quanto os mesmos valores custariam a menos por ano no mais barato (US$) */
  savingYear: number;
  amount: number;
}

/**
 * Para cada dívida, o ativo da MESMA moeda com taxa menor (USDT × USDC no dólar). Só informação: a tela mostra a
 * diferença e o que muda além da taxa (liquidUSD paga USDC direto, não USDT). null quando já está no mais barato.
 */
export function cheaperSameCurrency(debts: readonly DebtLine[], aprOfAsset: (a: DebtAsset) => number): RateTip | null {
  let best: RateTip | null = null;
  for (const d of debts) {
    if (d.amount <= 0) continue;
    for (const alt of DEBT_ASSETS) {
      if (alt === d.asset || DEBT_GROUP_OF[alt] !== DEBT_GROUP_OF[d.asset]) continue;
      const toApr = aprOfAsset(alt);
      if (toApr >= d.apr) continue;
      const savingYear = (d.amount * (d.apr - toApr)) / 100;
      if (!best || savingYear > best.savingYear) best = { from: d.asset, to: alt, fromApr: d.apr, toApr, savingYear, amount: d.amount };
    }
  }
  return best;
}

export const totalDebt = (p: BorrowPosition) => p.debts.reduce((a, d) => a + Math.max(0, d.amount), 0);

/** A dívida por grupo (dólar, ETH, euro), com a taxa média ponderada de cada um. Grupo sem dívida fica fora. */
export function debtGroups(debts: readonly DebtLine[]): { group: DebtGroup; amount: number; apr: number; assets: DebtAsset[] }[] {
  return DEBT_GROUPS.map((group) => {
    const lines = debts.filter((d) => DEBT_GROUP_OF[d.asset] === group && d.amount > 0);
    const amount = lines.reduce((a, d) => a + d.amount, 0);
    const apr = amount > 0 ? lines.reduce((a, d) => a + d.amount * d.apr, 0) / amount : 0;
    return { group, amount, apr, assets: lines.map((d) => d.asset) };
  }).filter((g) => g.amount > 0);
}

// ---------- o resumo (a linha da Aave) ----------

export interface BorrowSummary {
  collateralUsd: number;
  debt: number;
  /** Σ valor × Product LTV: quanto a garantia deixa pegar emprestado */
  borrowPower: number;
  /** dívida ÷ poder de empréstimo (0–1+); 0 sem garantia */
  borrowPowerUsed: number;
  /** Poder de empréstimo − dívida (nunca negativo) */
  available: number;
  /** Σ valor × CF: a garantia ajustada ao risco */
  riskAdjusted: number;
  /** riskAdjusted ÷ dívida; Infinity sem dívida. Só os alarmes usam (a tela não mostra) */
  hf: number;
  /** Dívida em que o HF chega a 1,00 (liquidação) e a 1,1 (o cartão para) */
  debtAt: { liquidation: number; spending: number };
  /** Rendimento da garantia por ano (Σ valor × APY), em US$ */
  yieldYear: number;
  /** APY médio da garantia, ponderado pelo valor (%) */
  collateralApy: number;
  /** Juros por ano (Σ dívida × APR) */
  interestYear: number;
  /** APR médio da dívida, ponderado (%); 0 sem dívida */
  apr: number;
  /** Rendimento − juros */
  netYear: number;
  netWorth: number;
  /** netYear ÷ patrimônio líquido, como o "Net APY" da Aave (%); null sem patrimônio */
  netApy: number | null;
  /** Dívida em que os juros igualam o rendimento de hoje, na taxa média; null sem taxa */
  breakEvenDebt: number | null;
  /** Quantas vezes o rendimento cobre os juros; null sem juros */
  coverage: number | null;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** `fallbackApr`: a taxa para o "até que dívida" quando ainda não há dívida (a do ativo escolhido). */
export function summarize(p: BorrowPosition, fallbackApr = 0): BorrowSummary {
  const collateralUsd = sum(p.collateral.map((c) => c.valueUsd));
  const borrowPower = sum(p.collateral.map((c) => c.valueUsd * c.productLtv));
  const riskAdjusted = sum(p.collateral.map((c) => c.valueUsd * c.cf));
  const yieldYear = sum(p.collateral.map((c) => (c.valueUsd * c.apy) / 100));
  const debt = totalDebt(p);
  const interestYear = sum(p.debts.map((d) => (Math.max(0, d.amount) * d.apr) / 100));
  const apr = debt > 0 ? (interestYear / debt) * 100 : 0;
  const rateForBreakEven = debt > 0 ? apr : fallbackApr;
  const netYear = yieldYear - interestYear;
  const netWorth = collateralUsd - debt;
  return {
    collateralUsd,
    debt,
    borrowPower,
    borrowPowerUsed: borrowPower > 0 ? debt / borrowPower : debt > 0 ? Infinity : 0,
    available: Math.max(0, borrowPower - debt),
    riskAdjusted,
    hf: debt > 0 ? riskAdjusted / debt : Infinity,
    debtAt: { liquidation: riskAdjusted / HF.liquidation, spending: riskAdjusted / HF.spending },
    yieldYear,
    collateralApy: collateralUsd > 0 ? (yieldYear / collateralUsd) * 100 : 0,
    interestYear,
    apr,
    netYear,
    netWorth,
    netApy: netWorth > 0 ? (netYear / netWorth) * 100 : null,
    breakEvenDebt: rateForBreakEven > 0 ? yieldYear / (rateForBreakEven / 100) : null,
    coverage: interestYear > 0 ? yieldYear / interestYear : null,
  };
}

/**
 * Em palavras de varejo, os mesmos degraus das linhas do gráfico: tranquilo (HF ≥ 1,2), aviso (1,1–1,2, amarelo),
 * atenção (1,0–1,1, laranja: o cartão parou) e perigo (abaixo de 1,00: pode ser liquidado).
 */
export type RiskLevel = 'calm' | 'warning' | 'attention' | 'danger' | 'none';
export function riskLevel(hf: number): RiskLevel {
  if (!Number.isFinite(hf)) return 'none';
  if (hf < HF.liquidation) return 'danger';
  if (hf < HF.spending) return 'attention';
  if (hf < HF.warning) return 'warning';
  return 'calm';
}

// ---------- choque de preço e preço de liquidação ----------

/** Multiplicador de preço por ativo de referência (1 = hoje). O dólar nunca se mexe. */
export type Shock = Partial<Record<Underlying, number>>;

const mult = (shock: Shock, u: Underlying) => (u === 'usd' ? 1 : shock[u] ?? 1);

/** A posição com os preços multiplicados: garantia e dívida (a dívida em WETH sobe com o ETH). */
export function applyShock(p: BorrowPosition, shock: Shock): BorrowPosition {
  return {
    collateral: p.collateral.map((c) => ({ ...c, valueUsd: c.valueUsd * mult(shock, c.underlying) })),
    debts: p.debts.map((d) => ({ ...d, amount: d.amount * mult(shock, DEBT_UNDERLYING[d.asset]) })),
  };
}

export interface PriceTrigger {
  underlying: Underlying;
  /** Multiplicador do preço de hoje em que o HF chega ao alvo; o resto parado */
  factor: number;
  /** 'drop': o perigo é o preço cair até ali; 'rise': subir (dívida no mesmo ativo pesando mais que a garantia) */
  direction: 'drop' | 'rise';
}

/**
 * Em que preço do ativo de referência `u` o HF chega a `target`, com o resto parado. HF(m) = (A·m + B) ÷ (Du·m + Do),
 * com A = Σ valor × CF das garantias em `u`, B = o resto ajustado, Du/Do = a dívida em `u` ou fora dele. Resolve
 * A·m + B = alvo·(Du·m + Do). null quando nenhum preço leva até lá (o resto da garantia sozinho já cobre, ou nada
 * em `u` pesa na conta).
 */
export function priceTrigger(p: BorrowPosition, u: Underlying, target: number = HF.liquidation): PriceTrigger | null {
  if (u === 'usd' || totalDebt(p) <= 0) return null;
  let A = 0;
  let B = 0;
  for (const c of p.collateral) {
    if (c.underlying === u) A += c.valueUsd * c.cf;
    else B += c.valueUsd * c.cf;
  }
  let Du = 0;
  let Do = 0;
  for (const d of p.debts) {
    if (DEBT_UNDERLYING[d.asset] === u) Du += Math.max(0, d.amount);
    else Do += Math.max(0, d.amount);
  }
  const den = A - target * Du;
  if (Math.abs(den) < 1e-12) return null;
  const m = (target * Do - B) / den;
  if (!(m > 0) || !Number.isFinite(m)) return null;
  return { underlying: u, factor: m, direction: den > 0 ? 'drop' : 'rise' };
}

/** Os ativos de referência que mexem no HF desta posição (garantia ou dívida fora do dólar), do maior peso ao menor. */
export function volatileUnderlyings(p: BorrowPosition): Underlying[] {
  const weight = new Map<Underlying, number>();
  for (const c of p.collateral) if (isVolatile(c.underlying) && c.valueUsd > 0) weight.set(c.underlying, (weight.get(c.underlying) ?? 0) + c.valueUsd);
  for (const d of p.debts) {
    const du = DEBT_UNDERLYING[d.asset];
    if (isVolatile(du) && d.amount > 0) weight.set(du, (weight.get(du) ?? 0) + d.amount);
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

/**
 * Queda conjunta: se todos os ativos fora do dólar caíssem juntos pelo mesmo fator, em que fator o HF chega ao alvo.
 * Só faz sentido com toda a dívida em dólar; null quando a parte estável sozinha já cobre a dívida.
 */
export function jointDropTrigger(p: BorrowPosition, target: number = HF.liquidation): number | null {
  const debt = totalDebt(p);
  if (debt <= 0 || p.debts.some((d) => d.amount > 0 && isVolatile(DEBT_UNDERLYING[d.asset]))) return null;
  let stable = 0;
  let vol = 0;
  for (const c of p.collateral) {
    if (isVolatile(c.underlying)) vol += c.valueUsd * c.cf;
    else stable += c.valueUsd * c.cf;
  }
  if (vol <= 0) return null;
  const m = (target * debt - stable) / vol;
  return m > 0 ? m : null;
}

// ---------- projeção no tempo ----------

export interface ProjectionInput {
  /** Gasto no cartão por mês que entra na dívida em dólar (o modo Borrow paga a compra com empréstimo) */
  monthlySpend: number;
  /** Cashback sobre esse gasto, em US$ por mês (o motor de Ganhos estima) */
  monthlyCashback: number;
  /** O gasto do mês entra na dívida */
  spendOnDebt: boolean;
  /** Taxa do gasto que entra (APR, %), quando não há dívida em dólar para somar */
  spendApr?: number;
}

export interface ProjectionPoint {
  month: number;
  collateralUsd: number;
  debt: number;
  hf: number;
  /** Rendimento acumulado da garantia desde hoje */
  cumYield: number;
  /** Juros acumulados desde hoje */
  cumInterest: number;
  cumCashback: number;
}

export const MAX_MONTHS = 600;

/**
 * Mês a mês, com as taxas de hoje paradas: a garantia cresce pelo APY (o rendimento fica no próprio ativo), cada dívida
 * pelos juros dela e, com `spendOnDebt`, a dívida em dólar pelo gasto do mês. Preços parados.
 */
export function project(p: BorrowPosition, input: ProjectionInput, months: number): ProjectionPoint[] {
  const n = Math.max(0, Math.min(MAX_MONTHS, Math.floor(months)));
  const values = p.collateral.map((c) => c.valueUsd);
  const monthlyRate = p.collateral.map((c) => Math.pow(1 + c.apy / 100, 1 / 12) - 1);
  const cfs = p.collateral.map((c) => c.cf);
  const debts = p.debts.map((d) => ({ amount: Math.max(0, d.amount), rate: Math.pow(1 + d.apr / 100, 1 / 12) - 1, usd: DEBT_UNDERLYING[d.asset] === 'usd' }));
  if (input.spendOnDebt && input.monthlySpend > 0 && !debts.some((d) => d.usd)) {
    debts.push({ amount: 0, rate: Math.pow(1 + (input.spendApr ?? OBSERVED_RATES.rates.USDT) / 100, 1 / 12) - 1, usd: true });
  }
  let cumYield = 0;
  let cumInterest = 0;
  let cumCashback = 0;
  const point = (month: number): ProjectionPoint => {
    const collateralUsd = sum(values);
    const risk = sum(values.map((v, i) => v * cfs[i]));
    const debt = sum(debts.map((d) => d.amount));
    return { month, collateralUsd, debt, hf: debt > 0 ? risk / debt : Infinity, cumYield, cumInterest, cumCashback };
  };
  const out: ProjectionPoint[] = [point(0)];
  for (let m = 1; m <= n; m++) {
    for (let i = 0; i < values.length; i++) {
      const y = values[i] * monthlyRate[i];
      values[i] += y;
      cumYield += y;
    }
    for (const d of debts) {
      const interest = d.amount * d.rate;
      d.amount += interest;
      cumInterest += interest;
    }
    if (input.spendOnDebt && input.monthlySpend > 0) {
      const target = debts.find((d) => d.usd);
      if (target) target.amount += input.monthlySpend;
    }
    cumCashback += Math.max(0, input.monthlyCashback);
    out.push(point(m));
  }
  return out;
}

/**
 * "Em quanto tempo o rendimento paga X% da dívida": com a dívida de hoje parada (sem gasto novo), o primeiro mês em que
 * o lucro da garantia (o rendimento menos os juros do empréstimo, acumulados) e, com `withCashback`, o cashback somam
 * `share` do valor emprestado. Para `share` = 1 é o mesmo que o rendimento somar o principal mais os juros. null: não
 * chega em 50 anos. É uma régua, não um plano: o rendimento fica no cofre e a dívida só cai quando alguém paga.
 */
export function paidMonth(points: readonly ProjectionPoint[], share: number, withCashback: boolean): number | null {
  const principal = points[0]?.debt ?? 0;
  for (const pt of points) {
    if (pt.month === 0) continue;
    if (pt.cumYield - pt.cumInterest + (withCashback ? pt.cumCashback : 0) >= share * principal) return pt.month;
  }
  return null;
}

/**
 * A projeção como o gráfico mostra: o azul é o lucro da garantia (rendimento − juros, acumulados) e a linha é o valor
 * emprestado, reta (os juros já saíram do azul). Onde o azul alcança a linha, o lucro pagou o empréstimo.
 */
export function netPoints(points: readonly ProjectionPoint[]): ProjectionPoint[] {
  const principal = points[0]?.debt ?? 0;
  return points.map((p) => ({ ...p, cumYield: p.cumYield - p.cumInterest, debt: principal }));
}

export interface Payoff {
  /** Meses até o rendimento somar tudo o que se deve; null: não chega em 50 anos */
  months: number | null;
  /** O mesmo com o cashback do cartão somado */
  monthsWithCashback: number | null;
}

export function payoff(p: BorrowPosition, monthlyCashback: number): Payoff {
  if (totalDebt(p) <= 0) return { months: 0, monthsWithCashback: 0 };
  const pts = project(p, { monthlySpend: 0, monthlyCashback, spendOnDebt: false }, MAX_MONTHS);
  return { months: paidMonth(pts, 1, false), monthsWithCashback: monthlyCashback > 0 ? paidMonth(pts, 1, true) : paidMonth(pts, 1, false) };
}

/** As marcas do gráfico do "quanto já foi pago": o mês em que o lucro da garantia chega a cada parte do emprestado. */
export const PAID_MARKS = [0.05, 0.1, 0.25, 0.5, 0.75, 1] as const;

export interface HfCrossings {
  /** Mês em que o HF fica abaixo de 1,5 / 1,1 / 1,0; null = não cruza no horizonte */
  borrowing: number | null;
  spending: number | null;
  liquidation: number | null;
}

/** Com o gasto entrando na dívida (ou só os juros), em que mês o HF cruza cada limite. */
export function hfCrossings(points: readonly ProjectionPoint[]): HfCrossings {
  const first = (limit: number) => points.find((pt) => pt.hf < limit)?.month ?? null;
  return { borrowing: first(HF.borrowing), spending: first(HF.spending), liquidation: first(HF.liquidation) };
}

// ---------- alarmes ----------

export type AlarmKind = 'hf_below' | 'debt_above' | 'price_below' | 'price_above';

export interface Alarm {
  id: string;
  kind: AlarmKind;
  value: number;
  /** Só nos de preço: o ativo de referência */
  underlying?: Underlying;
  on: boolean;
}

export interface AlarmState {
  alarm: Alarm;
  /** null: não dá para saber agora (preço não carregado, sem dívida) */
  triggered: boolean | null;
  /** O número de agora que a condição compara */
  current: number | null;
}

export const ALARM_LIMIT = 20;

/** Confere cada alarme contra a posição REAL (não a simulada) e os preços carregados. */
export function evaluateAlarms(alarms: readonly Alarm[], real: BorrowSummary, prices: Partial<Record<Underlying, number>>): AlarmState[] {
  return alarms.map((alarm) => {
    if (!alarm.on) return { alarm, triggered: null, current: null };
    switch (alarm.kind) {
      case 'hf_below': {
        const cur = Number.isFinite(real.hf) ? real.hf : null;
        return { alarm, current: cur, triggered: cur === null ? false : cur < alarm.value };
      }
      case 'debt_above':
        return { alarm, current: real.debt, triggered: real.debt > alarm.value };
      case 'price_below':
      case 'price_above': {
        const price = alarm.underlying ? prices[alarm.underlying] : undefined;
        if (price === undefined) return { alarm, triggered: null, current: null };
        return { alarm, current: price, triggered: alarm.kind === 'price_below' ? price < alarm.value : price > alarm.value };
      }
    }
  });
}

const UNDERLYINGS: readonly Underlying[] = ['usd', 'eur', 'eth', 'btc', 'hype', 'ethfi', 'op', 'stocks', 'gold', 'chf', 'other'];
const KINDS: readonly AlarmKind[] = ['hf_below', 'debt_above', 'price_below', 'price_above'];

export function validateAlarm(raw: unknown): Alarm | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id)) return undefined;
  if (typeof r.kind !== 'string' || !KINDS.includes(r.kind as AlarmKind)) return undefined;
  if (typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value <= 0 || r.value > 1e9) return undefined;
  const kind = r.kind as AlarmKind;
  const isPrice = kind === 'price_below' || kind === 'price_above';
  const u = r.underlying;
  if (isPrice && (typeof u !== 'string' || !UNDERLYINGS.includes(u as Underlying) || u === 'usd')) return undefined;
  return { id: r.id, kind, value: r.value, underlying: isPrice ? (u as Underlying) : undefined, on: r.on !== false };
}

// ---------- preferências (neste navegador) ----------

export interface BorrowPrefs {
  version: 1;
  /** Em que ativo está o empréstimo da conta (o conector só dá o total) */
  debtAsset: DebtAsset;
  /** APR própria por ativo de dívida (%); ausente = a observada */
  apr: Partial<Record<DebtAsset, number>>;
  /** A dívida separada por ativo (USDT, USDC…) em vez de agrupada por moeda */
  details: boolean;
  /** As marcas ligadas no gráfico do "quanto já foi pago" (0,25…1) */
  marks: number[];
  /** O gráfico do pago soma o cashback do cartão (desligado por padrão: o gráfico é o lucro da garantia) */
  chartCashback: boolean;
  /** O período do "depois dos juros" e das barras: 7 dias, 1 mês ou 1 ano */
  period: CarryPeriod;
  /**
   * Taxa de cashback da tela, em % (3 por padrão: a taxa cheia da maioria dos níveis em dólar; quem gasta muito sobe de
   * nível). Simples de propósito: a tela Ganhos é que faz a conta por faixa do plano
   */
  cashbackPct: number;
  alarms: Alarm[];
  /** A pessoa aceitou buscar os candles na Coinbase (os gráficos de preço) */
  prices: boolean;
  /** Notificação do navegador quando um alarme dispara */
  notify: boolean;
}

export const DEFAULT_BORROW_PREFS: BorrowPrefs = {
  version: 1, debtAsset: 'USDT', apr: {}, details: false, marks: [0.5, 1], chartCashback: false, period: '1m', cashbackPct: 3, alarms: [], prices: false, notify: false,
};

/** O período do "depois dos juros": a fração do ano (7 dias, 1 mês, 1 ano). */
export type CarryPeriod = '7d' | '1m' | '1y';
export const CARRY_PERIODS: readonly CarryPeriod[] = ['7d', '1m', '1y'];
export const PERIOD_YEARS: Record<CarryPeriod, number> = { '7d': 7 / 365.25, '1m': 1 / 12, '1y': 1 };

export const APR_MAX = 100;
/** Teto da taxa de cashback que a tela aceita (%): o maior nível público paga 4% */
export const CASHBACK_PCT_MAX = 10;

export function validateBorrowPrefs(raw: unknown): BorrowPrefs | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return undefined;
  const debtAsset = DEBT_ASSETS.includes(r.debtAsset as DebtAsset) ? (r.debtAsset as DebtAsset) : DEFAULT_BORROW_PREFS.debtAsset;
  const apr: Partial<Record<DebtAsset, number>> = {};
  if (r.apr && typeof r.apr === 'object') {
    for (const a of DEBT_ASSETS) {
      const v = (r.apr as Record<string, unknown>)[a];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= APR_MAX) apr[a] = v;
    }
  }
  const alarms = Array.isArray(r.alarms) ? r.alarms.map(validateAlarm).filter((a): a is Alarm => a !== undefined).slice(0, ALARM_LIMIT) : [];
  const marks = Array.isArray(r.marks)
    ? [...new Set(r.marks.filter((x): x is number => typeof x === 'number' && (PAID_MARKS as readonly number[]).includes(x)))]
    : DEFAULT_BORROW_PREFS.marks;
  return {
    version: 1,
    debtAsset,
    apr,
    details: r.details === true,
    marks,
    chartCashback: r.chartCashback === true,
    period: CARRY_PERIODS.includes(r.period as CarryPeriod) ? (r.period as CarryPeriod) : DEFAULT_BORROW_PREFS.period,
    cashbackPct: typeof r.cashbackPct === 'number' && Number.isFinite(r.cashbackPct) && r.cashbackPct >= 0 && r.cashbackPct <= CASHBACK_PCT_MAX ? r.cashbackPct : DEFAULT_BORROW_PREFS.cashbackPct,
    alarms,
    prices: r.prices === true,
    notify: r.notify === true,
  };
}

export const aprOf = (prefs: BorrowPrefs, asset: DebtAsset = prefs.debtAsset): number => prefs.apr[asset] ?? OBSERVED_RATES.rates[asset];
