import { pick, type Locale } from './locale.ts';
import type { AssetClass } from './assetClass.ts';
import type { CardStatus, Transaction, TxType } from './types';

/** O que o dinheiro fez: o eixo principal do extrato. Só "spend" entra em "quanto gastei". */
export type TxGroup = 'spend' | 'money' | 'yield' | 'rewards' | 'referral' | 'credit' | 'other';

const GROUP_NAME: Record<TxGroup, [en: string, pt: string]> = {
  spend: ['Card spending', 'Gasto no cartão'],
  money: ['Money in & out', 'Entrou e saiu'],
  yield: ['Yield', 'Rendimento'],
  rewards: ['Crypto & rewards', 'Cripto e recompensas'],
  referral: ['Referrals', 'Indicações'],
  credit: ['Credit', 'Crédito'],
  other: ['Other', 'Outros'],
};

export const groupLabel = (g: TxGroup, locale: Locale) => pick(locale, ...GROUP_NAME[g]);

const TYPE_GROUP: Record<TxType, TxGroup> = {
  purchase: 'spend',
  top_up: 'money',
  withdrawal: 'money',
  yield_deposit: 'yield',
  yield_withdrawal: 'yield',
  bridge: 'other',
  swap: 'rewards',
  cashback: 'rewards',
  cashback_claim: 'rewards',
  referral: 'referral',
  borrow: 'credit',
  repayment: 'credit',
  liquidation: 'credit',
  other: 'other',
};

const TYPE_NAME: Record<TxType, [en: string, pt: string]> = {
  purchase: ['Purchase', 'Compra'],
  top_up: ['Deposit', 'Depósito'],
  withdrawal: ['Withdrawal', 'Saque'],
  yield_deposit: ['Moved to yield', 'Aplicado no rendimento'],
  yield_withdrawal: ['Withdrawn from yield', 'Resgatado do rendimento'],
  bridge: ['Transfer between networks', 'Transferência entre redes'],
  swap: ['Crypto swap', 'Troca de cripto'],
  cashback: ['Cashback received', 'Cashback recebido'],
  cashback_claim: ['Cashback claim', 'Resgate de cashback'],
  referral: ['Referral', 'Indicação'],
  borrow: ['Loan', 'Empréstimo'],
  repayment: ['Loan repayment', 'Pagamento do empréstimo'],
  liquidation: ['Liquidation', 'Liquidação'],
  other: ['Transaction', 'Movimentação'],
};

export const typeLabel = (type: TxType, locale: Locale) => pick(locale, ...TYPE_NAME[type]);

export const txGroup = (t: Transaction): TxGroup => TYPE_GROUP[t.type];

/** Título da linha: estabelecimento nas compras; nos demais tipos, o que aconteceu (e com qual ativo). */
export function txTitle(t: Transaction, locale: Locale): string {
  if (t.type === 'purchase') return t.merchant ?? typeLabel('purchase', locale);
  const token = t.token && t.token !== 'USDC' ? ` · ${t.token}` : '';
  return `${typeLabel(t.type, locale)}${token}`;
}

/** Sinal do valor no extrato. Mover entre bolsos (rendimento, troca) não tem sinal. */
export function txSign(t: Transaction): '+' | '−' | '' {
  if (t.type === 'purchase') return t.amountUsd < 0 ? '+' : '';
  if (t.type === 'yield_deposit' || t.type === 'yield_withdrawal' || t.type === 'bridge' || t.type === 'swap' || t.type === 'cashback_claim') return '';
  // recompensa sempre chega: o conector marca o pagamento de indicação como "out"
  if (t.type === 'cashback' || t.type === 'referral') return '+';
  if (t.direction) return t.direction === 'in' ? '+' : '−';
  if (t.type === 'top_up' || t.type === 'borrow') return '+';
  if (t.type === 'withdrawal' || t.type === 'repayment' || t.type === 'liquidation') return '−';
  return '';
}

export const isRefund = (t: Transaction) => t.type === 'purchase' && t.amountUsd < 0;

const CARD_STATUS_NAME: Record<CardStatus, [en: string, pt: string]> = {
  active: ['active', 'ativo'],
  frozen: ['frozen', 'congelado'],
  locked: ['locked', 'bloqueado'],
  cancelled: ['canceled', 'cancelado'],
  inactive: ['not activated', 'não ativado'],
  unknown: ['status unknown', 'status desconhecido'],
};

export const cardStatusLabel = (s: CardStatus, locale: Locale) => pick(locale, ...CARD_STATUS_NAME[s]);

const CARD_TYPE_NAME: Record<string, [en: string, pt: string]> = {
  physical: ['physical', 'físico'],
  virtual: ['virtual', 'virtual'],
  metal: ['metal', 'metal'],
};

export const cardTypeLabel = (type: string, locale: Locale) => (CARD_TYPE_NAME[type] ? pick(locale, ...CARD_TYPE_NAME[type]) : type);

/**
 * Grupos da carteira no app da ether.fi (get_portfolio.groups, mesmos ids em toda conta). `all` e `other` são do
 * painel: carteira sem grupos da fonte e ativo cujo grupo a fonte não listou.
 */
const ASSET_GROUP_NAME: Record<string, [en: string, pt: string]> = {
  liquidVaults: ['Liquid vaults', 'Cofres Liquid'],
  'value-accruing': ['Staking', 'Staking'],
  crypto: ['Crypto', 'Cripto'],
  all: ['Assets', 'Ativos'],
  other: ['Other', 'Outros'],
};

/** Nome do grupo: em inglês, o rótulo da fonte (é o do app); em português, o nosso; id desconhecido fica como veio. */
export function assetGroupLabel(id: string, sourceLabel: string | undefined, locale: Locale): string {
  const known = ASSET_GROUP_NAME[id];
  if (locale === 'en' && sourceLabel) return sourceLabel;
  return known ? pick(locale, ...known) : sourceLabel || id;
}

const ASSET_CLASS_NAME: Record<AssetClass, [en: string, pt: string]> = {
  fiat: ['Fiat', 'Fiat'],
  crypto: ['Crypto', 'Cripto'],
  stocks: ['Stocks', 'Ações'],
  bonds: ['Bonds', 'Renda fixa'],
  commodities: ['Commodities', 'Commodities'],
  other: ['Other', 'Outros'],
};

/** Nome da classe; nas fiat, com as moedas presentes na ordem dada: "Fiat · USD" ou "Fiat · USD, EUR". */
export function assetClassLabel(id: AssetClass, currencies: string[] | undefined, locale: Locale): string {
  const name = pick(locale, ...ASSET_CLASS_NAME[id]);
  return id === 'fiat' && currencies?.length ? `${name} · ${currencies.join(', ')}` : name;
}

const NETWORK_LABEL: Record<string, string> = {
  arbitrum: 'Arbitrum',
  base: 'Base',
  ethereum: 'Ethereum',
  hyperevm: 'HyperEVM',
  optimism: 'Optimism',
  scroll: 'Scroll',
};

export const networkLabel = (n: string) => NETWORK_LABEL[n.toLowerCase()] ?? n;
