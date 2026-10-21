// Classe de cada ativo da carteira (moeda fiduciária, cripto, ações, renda fixa, commodities): o que o ativo é, não o
// grupo em que o app da ether.fi o mostra. Um USDC é dólar, mesmo no grupo "Crypto"; um cofre Liquid em dólar é dólar.
// Primeiro a tabela, com uma fonte por símbolo; depois o padrão no símbolo ou no nome (USD/EUR/CHF → fiat, BTC/ETH →
// cripto); o resto fica em `other`. Nunca se chuta cripto.

import type { Holding } from './types';

export type AssetClass = 'fiat' | 'crypto' | 'stocks' | 'bonds' | 'commodities' | 'other';

/** Ordem fixa das classes (legenda, cores): a barra ordena pelo valor */
export const ASSET_CLASSES: AssetClass[] = ['fiat', 'crypto', 'stocks', 'bonds', 'commodities', 'other'];

export interface AssetClassInfo {
  cls: AssetClass;
  /** Moeda (ISO 4217) das fiat: USD, EUR, CHF */
  currency?: string;
  /** De onde veio: a tabela (com fonte), o padrão no símbolo ou no nome, ou nada (`other`) */
  basis: 'known' | 'pattern' | 'unknown';
}

interface Known {
  cls: AssetClass;
  currency?: string;
  /** O que o ativo é e onde está escrito */
  source: string;
}

const HELP_COLLATERAL = 'https://help.ether.fi/en/articles/304388-how-does-collateral-and-borrowing-work';
const HELP_LIQUID = 'https://help.ether.fi/en/articles/517109-how-liquid-works';

/**
 * Os ativos que a ether.fi Cash aceita (get_deposit_address.supportedAssets e a tabela de LTV da central de ajuda,
 * lida em 19/10/2026). Símbolo exato, como o conector manda.
 */
export const KNOWN_ASSETS: Record<string, Known> = {
  // ---------- moeda fiduciária ----------
  USDC: { cls: 'fiat', currency: 'USD', source: 'Circle, emissor: USD Coin, stablecoin em dólar (https://www.circle.com/usdc)' },
  USDT: { cls: 'fiat', currency: 'USD', source: 'Tether, emissor: stablecoin em dólar (https://tether.to)' },
  USDT0: { cls: 'fiat', currency: 'USD', source: 'USDT0: o USDT da Tether entre redes, que acompanha o dólar (https://usdt0.to)' },
  EURC: { cls: 'fiat', currency: 'EUR', source: 'Circle, emissor: EURC, stablecoin em euro (https://www.circle.com/eurc); paga empréstimo em EURC na ether.fi' },
  eUSD: { cls: 'fiat', currency: 'USD', source: 'ether.fi USD, stablecoin em dólar da ether.fi sobre a infraestrutura da Ethena; o lastro não foi publicado (https://investinglive.com/es/Educacion/ether-fi-se-une-a-la-fiebre-de-las-stablecoins-por-que-toda-plataforma-cripto-quiere-su-propio-dolar/)' },
  frxUSD: { cls: 'fiat', currency: 'USD', source: 'Frax, emissor: Frax USD, stablecoin em dólar (https://frax.com)' },
  ZCHF: { cls: 'fiat', currency: 'CHF', source: 'nome no conector: "Swiss Franc"; Frankencoin, stablecoin em franco suíço (https://www.frankencoin.com)' },
  liquidUSD: { cls: 'fiat', currency: 'USD', source: `nome no conector: "Liquid USD"; cofre Liquid em dólar que paga empréstimo em USDC (${HELP_COLLATERAL}; https://etherfi.gitbook.io/etherfi/products/liquid/live-vaults/liquid-usd-vault)` },
  liquidReserve: { cls: 'fiat', currency: 'USD', source: 'nome no conector: "Liquid Reserve"; nos termos da ether.fi, USDC ou USDT trocados por PYUSD (dólar, Paxos) e depositados no Morpho (https://etherfi.gitbook.io/etherfi/legal/ether.fi-legal/terms-of-use); token liquidRESERVE em USDC na Optimism (https://tradingstrategy.ai/vaults/ether-fi-liquid-reserve)' },
  liquidEUR: { cls: 'fiat', currency: 'EUR', source: `cofre Liquid em euro que paga empréstimo em EURC (${HELP_COLLATERAL})` },
  liquidRWA: { cls: 'fiat', currency: 'USD', source: 'cofre Liquid USD RWAs: rendimento de crédito e renda fixa tokenizados sobre saldo em dólar (https://etherfi.gitbook.io/etherfi/products/liquid/live-vaults/liquid-rwa-vault)' },
  // ---------- cripto ----------
  WETH: { cls: 'crypto', source: 'ether embrulhado (https://ethereum.org/en/wrapped-eth/)' },
  weETH: { cls: 'crypto', source: `ETH em staking da ether.fi; o cofre de ETH aceita wETH e weETH (${HELP_LIQUID})` },
  liquidETH: { cls: 'crypto', source: `nome no conector: "Liquid ETH"; cofre de rendimento em ETH (${HELP_LIQUID})` },
  eBTC: { cls: 'crypto', source: `BTC da ether.fi; o cofre de BTC aceita eBTC (${HELP_LIQUID})` },
  liquidBTC: { cls: 'crypto', source: `nome no conector: "Liquid BTC"; cofre de rendimento em BTC (${HELP_LIQUID})` },
  ETHFI: { cls: 'crypto', source: 'token de governança da ether.fi (https://etherfi.gitbook.io/etherfi)' },
  sETHFI: { cls: 'crypto', source: 'ETHFI em staking, da ether.fi (https://etherfi.gitbook.io/etherfi)' },
  OP: { cls: 'crypto', source: 'token de governança da Optimism (https://community.optimism.io)' },
  WHYPE: { cls: 'crypto', source: 'HYPE embrulhado (1:1), o token nativo da Hyperliquid (https://www.stakingrewards.com/asset/wrapped-hype)' },
  beHYPE: { cls: 'crypto', source: 'HYPE em staking líquido, da Hyperbeat com a ether.fi (https://coindesk.com/tech/2025/07/18/ether-fi-to-expand-to-hyperliquid-introduce-behype-staking-token)' },
  // ---------- ações ----------
  wSPYx: { cls: 'stocks', source: `nome no conector: "S&P 500"; o SPYx da Backed (ETF do S&P 500) num token que não reajusta a quantidade (${HELP_COLLATERAL})` },
  wQQQx: { cls: 'stocks', source: `nome no conector: "Nasdaq"; o QQQx da Backed (ETF da Nasdaq) num token que não reajusta a quantidade (${HELP_COLLATERAL})` },
  SPYx: { cls: 'stocks', source: `S&P 500 xStock, da Backed; na tabela de LTV da ether.fi (${HELP_COLLATERAL})` },
  QQQx: { cls: 'stocks', source: `Nasdaq xStock, da Backed; na tabela de LTV da ether.fi (${HELP_COLLATERAL})` },
  // ---------- renda fixa ----------
  wTBLLx: { cls: 'bonds', source: `nome no conector: "TBLL"; o TBLLx da Backed (ETF de títulos curtos do Tesouro dos EUA) num token que não reajusta a quantidade (${HELP_COLLATERAL})` },
  TBLLx: { cls: 'bonds', source: `TBLL xStock, da Backed; na tabela de LTV da ether.fi (${HELP_COLLATERAL})` },
  // ---------- commodities ----------
  PAXG: { cls: 'commodities', source: 'Paxos, emissor: PAX Gold, ouro tokenizado (https://www.paxos.com/pax-gold)' },
  PAXGy: { cls: 'commodities', source: 'Paxos Labs: PAXG com rendimento pago em ouro (https://thedefiant.io/news/tokens/paxos-labs-launches-paxgy-adding-lending-yield-to-tokenized-gold)' },
};

/** Moeda pelo símbolo ou pelo nome; o nome só por palavra inteira ("Tether" não é ETH, "Liquid USD" é USD) */
const FIAT_SYMBOL: [RegExp, string][] = [[/USD/i, 'USD'], [/EUR/i, 'EUR'], [/CHF/i, 'CHF']];
const FIAT_NAME: [RegExp, string][] = [
  [/\b(?:USD|US dollars?|dollars?)\b/i, 'USD'],
  [/\b(?:EUR|euros?)\b/i, 'EUR'],
  [/\b(?:CHF|Swiss francs?)\b/i, 'CHF'],
];
const CRYPTO_SYMBOL = /BTC|ETH/i;
const CRYPTO_NAME = /\b(?:BTC|bitcoin|ETH|ether|ethereum)\b/i;

/**
 * Classe de um ativo: a tabela pelo símbolo exato; senão o padrão (cripto e moeda no símbolo, depois no nome);
 * senão `other`.
 */
export function assetClassOf(holding: Pick<Holding, 'asset' | 'name'>): AssetClassInfo {
  const known = KNOWN_ASSETS[holding.asset];
  if (known) return { cls: known.cls, ...(known.currency ? { currency: known.currency } : {}), basis: 'known' };
  const symbol = holding.asset;
  const name = holding.name ?? '';
  if (CRYPTO_SYMBOL.test(symbol)) return { cls: 'crypto', basis: 'pattern' };
  const bySymbol = FIAT_SYMBOL.find(([re]) => re.test(symbol));
  if (bySymbol) return { cls: 'fiat', currency: bySymbol[1], basis: 'pattern' };
  if (CRYPTO_NAME.test(name)) return { cls: 'crypto', basis: 'pattern' };
  const byName = FIAT_NAME.find(([re]) => re.test(name));
  if (byName) return { cls: 'fiat', currency: byName[1], basis: 'pattern' };
  return { cls: 'other', basis: 'unknown' };
}

/** Cofre Liquid: o grupo do app ou o símbolo liquid* (liquidUSD, liquidReserve, liquidETH…) */
export const isVault = (h: Pick<Holding, 'asset' | 'groupId'>): boolean => h.groupId === 'liquidVaults' || /^liquid/i.test(h.asset);
