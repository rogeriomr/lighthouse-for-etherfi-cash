import type {
  Card, CardStatus, Dataset, DepositInfo, Holding, MainAccount, Portfolio, Transaction, TxStatus, TxType,
} from './types';
import { isVault } from './assetClass.ts';
import { cleanText, clip } from './cleanText.ts';

type Dict = Record<string, unknown>;

// todo texto da fonte sai sem controles nem marcas de direção (cleanText.ts)
const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = cleanText(v).trim();
  return s || undefined;
};
// código de moeda: letras e dígitos em caixa alta ("USD", "BRL"); o resto (ex.: um CRLF que iria parar no .ics) vale o padrão
const CURRENCY = /^[A-Z0-9]{2,10}$/;
const currencyOf = (v: unknown, fallback: string): string => {
  const c = str(v)?.toUpperCase();
  return c && CURRENCY.test(c) ? c : fallback;
};
/**
 * Número vindo como texto. O separador decimal é o último que aparece: "1.234,56" e "1,234.56" viram 1234.56,
 * "1.234.567" (só milhar) vira 1234567. Símbolo de moeda, espaço e apóstrofo saem; parênteses = negativo.
 * Ambíguo demais ("12,34,567") é recusado em vez de virar um valor 1000x errado.
 */
function parseAmountText(input: string): number | undefined {
  let s = input.trim();
  if (!s) return undefined;
  // menos tipográfico (U+2212) e figure dash são sinais, não lixo: sem isso um débito vira crédito
  s = s.replace(/[\u2212\u2012]/g, '-');
  // notação científica ("1e308", "1E+12"): recusada depois pelo teto de valor, mas não pode virar "1308"
  const compact = s.replace(/[\s\u00a0\u202f']/g, '');
  if (/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)[eE][+-]?\d+$/.test(compact)) {
    const n = Number(compact.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  let negative = /^\(.*\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  s = s.replace(/[\s\u00a0\u202f']/g, '').replace(/[^\d.,+-]/g, '');
  if (!/\d/.test(s)) return undefined;
  if (s.startsWith('-')) negative = true;
  s = s.replace(/[+-]/g, '');
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  const groupsOf3 = (sep: string) => s.split(sep).slice(1).every((g) => g.length === 3);
  let dec: ',' | '.' | null = null;
  if (commas && dots) dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  else if (commas) dec = commas > 1 && groupsOf3(',') ? null : ',';
  else if (dots) dec = dots > 1 && groupsOf3('.') ? null : '.';
  let t = s;
  if (dec) {
    t = t.split(dec === ',' ? '.' : ',').join('');
    t = t.split(dec).join('.');
  } else {
    t = t.replace(/[.,]/g, '');
  }
  if (t.startsWith('.')) t = `0${t}`;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

const numv = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return parseAmountText(v);
  return undefined;
};

function pick(obj: Dict | null | undefined, keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/** Procura um array em estruturas {items|transactions|data|results|...} ou array direto. */
function pluckArray(result: Dict | undefined, keys: string[]): unknown[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  for (const k of keys) {
    const v = result[k];
    if (Array.isArray(v)) return v;
  }
  for (const v of Object.values(result)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v as unknown[];
  }
  return [];
}

const TYPE_MAP: Record<string, TxType> = {
  purchase: 'purchase', card_purchase: 'purchase', card: 'purchase', spend: 'purchase', spending: 'purchase',
  rain_transaction: 'purchase', card_transaction: 'purchase',
  top_up: 'top_up', topup: 'top_up', pending_topup: 'top_up', deposit: 'top_up', funding: 'top_up',
  withdrawal: 'withdrawal', completed_withdrawal: 'withdrawal', withdraw: 'withdrawal', atm: 'withdrawal', send: 'withdrawal',
  liquid_deposit: 'yield_deposit', yield_deposit: 'yield_deposit',
  liquid_withdrawal: 'yield_withdrawal', liquid_withdraw: 'yield_withdrawal', liquid_execute_withdrawal: 'yield_withdrawal', yield_withdrawal: 'yield_withdrawal',
  stargate_execute_bridge: 'bridge', liquid_execute_bridge: 'bridge', bridge: 'bridge',
  swap: 'swap', trade: 'swap',
  cashback: 'cashback', reward: 'cashback', rewards: 'cashback',
  cashback_claim: 'cashback_claim',
  affiliate_payout: 'referral', referral: 'referral', referral_reward: 'referral',
  borrow: 'borrow', loan: 'borrow',
  repayment: 'repayment', repay: 'repayment',
  liquidation: 'liquidation',
};

/** Tipo desconhecido nunca vira compra às cegas: só com estabelecimento e cartão. */
function mapType(v: unknown, looksLikeCardSpend: boolean): TxType {
  const s = str(v)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (s && TYPE_MAP[s]) return TYPE_MAP[s];
  return looksLikeCardSpend ? 'purchase' : 'other';
}

const VOID_STATUS = new Set(['void', 'voided', 'declined', 'failed', 'cancelled', 'canceled', 'reversed', 'rejected', 'expired']);
/** Estorno conta (abate o gasto); o sinal vem daqui, não do valor, que algumas fontes mandam positivo */
const REFUND_STATUS = new Set(['refund', 'refunded']);

function mapStatus(v: unknown): TxStatus {
  const s = str(v)?.toLowerCase();
  if (s === 'pending' || s === 'processing' || s === 'authorized') return 'pending';
  if (s && VOID_STATUS.has(s)) return 'void';
  return 'settled';
}

/** Anos aceitos: fora disso é data quebrada ou adulterada (2286, +275760), que esticaria gráficos e janelas */
const YEARS: [number, number] = [2000, 2100];

/** Converte datas variadas em ISO; sem data válida, a transação é descartada (null). */
function toIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const ms = /^\d{10}$/.test(s) ? Number(s) * 1000 : /^\d{13}$/.test(s) ? Number(s) : Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getUTCFullYear();
  return year >= YEARS[0] && year <= YEARS[1] ? new Date(ms).toISOString() : null;
}

/** Valor acima disso não é de cartão nem de carteira: arquivo adulterado (somas viram Infinity e saem "US$ 0,00") */
const MAX_AMOUNT = 1e12;
/** Teto do nome do estabelecimento (os reais têm até umas 4 dezenas de caracteres) */
const MAX_MERCHANT = 160;

function parseCardRef(v: unknown): string | undefined {
  if (typeof v === 'number') return String(v);
  return str(v);
}

const R6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function normalizeTransaction(raw: Dict): Transaction | null {
  // descritor de fatura tem dezenas de caracteres: o teto limita também o custo das regras (públicas e locais) sobre ele
  const descriptor = str(pick(raw, ['merchant', 'merchantName', 'counterparty', 'name', 'description', 'label']));
  const merchant = descriptor && clip(descriptor, MAX_MERCHANT);
  const cardId = parseCardRef(pick(raw, ['cardId', 'card_id', 'card', 'cardLast4', 'cardLastFour', 'lastFour']));
  const type = mapType(pick(raw, ['type', 'kind', 'transactionType', 'tx_type']), Boolean(merchant && cardId));

  // valor de liquidação (o que sai do saldo) e valor local (o que apareceu na maquininha)
  const settleCurrency = currencyOf(pick(raw, ['currency', 'settlementCurrency']), 'USD');
  const settleAmount = numv(pick(raw, ['amount', 'value', 'total']));
  // sem valor não há transação: zero inventado entraria em todo total e em toda janela
  if (settleAmount === undefined) return null;
  const localCurrency = currencyOf(pick(raw, ['localCurrency', 'merchantCurrency']), settleCurrency);
  const localAmount = numv(pick(raw, ['localAmount', 'merchantAmount'])) ?? (localCurrency === settleCurrency ? settleAmount : undefined);
  const explicitUsd = numv(pick(raw, ['amountUsd', 'usdAmount', 'amount_usd', 'usdValue', 'usd', 'dollarValue', 'amountUSD']));
  const rate = numv(pick(raw, ['exchangeRate', 'rate', 'fxRate', 'usdExchangeRate']));
  // câmbio negativo ou zero inverteria o sinal do valor: fora
  const fxRate = rate !== undefined && rate > 0 ? rate : undefined;
  // moeda que não é USD só vira USD com valor explícito ou câmbio: 1:1 seria um erro silencioso
  const amountUsd = explicitUsd ?? (settleCurrency === 'USD' ? settleAmount : fxRate ? settleAmount * fxRate : undefined);
  if (amountUsd === undefined) return null;

  const date = toIso(pick(raw, ['date', 'timestamp', 'createdAt', 'created_at', 'postedAt', 'time']));
  // sem data válida, a transação não tem uso analítico: descarta em vez de virar 1970
  if (!date) return null;
  if ([settleAmount, localAmount ?? 0, amountUsd].some((n) => Math.abs(n) > MAX_AMOUNT)) return null;

  // em compras o sinal importa (negativo = estorno, e status REFUND é sempre estorno); nos demais tipos o sentido
  // vem de direction
  const rawStatus = pick(raw, ['status', 'state']);
  const refund = REFUND_STATUS.has(str(rawStatus)?.toLowerCase() ?? '');
  const signed = (n: number) => (type !== 'purchase' ? Math.abs(n) : refund ? -Math.abs(n) : n);
  const amount = localAmount ?? settleAmount;
  // o sinal do valor em USD segue o da compra (estorno incluído): uma fonte que manda um dos dois com sinal trocado
  // não pode transformar um gasto em crédito
  const usdSign = type !== 'purchase' ? 1 : refund || amount < 0 ? -1 : 1;
  const amountUsdSigned = Math.abs(amountUsd) * usdSign;
  const direction = str(pick(raw, ['direction']))?.toLowerCase();

  return {
    id: str(pick(raw, ['id', 'transactionId', 'txId', 'txnId', 'uuid'])) ?? crypto.randomUUID(),
    type,
    status: mapStatus(rawStatus),
    date,
    merchant,
    category: str(pick(raw, ['category', 'categoryName', 'merchantCategory', 'mcc'])),
    amount: signed(amount),
    currency: localAmount !== undefined ? localCurrency : settleCurrency,
    amountUsd: amountUsdSigned,
    direction: direction === 'in' || direction === 'out' ? direction : undefined,
    token: str(pick(raw, ['token', 'asset', 'symbol'])),
    cardId,
    city: str(pick(raw, ['city', 'merchantCity', 'locationCity'])),
    country: str(pick(raw, ['country', 'merchantCountry', 'locationCountry'])),
    exchangeRate: localAmount && localCurrency !== 'USD' && amountUsd ? R6(Math.abs(amountUsd / localAmount)) : fxRate,
  };
}

export function normalizeTransactions(result: Dict | undefined): Transaction[] {
  // a paginação do conector repete linhas na virada de página: o id decide, a primeira ocorrência fica
  const seen = new Set<string>();
  return pluckArray(result, ['transactions', 'items', 'data', 'results', 'rows'])
    .filter((r): r is Dict => typeof r === 'object' && r !== null)
    .map(normalizeTransaction)
    .filter((t): t is Transaction => t !== null && !seen.has(t.id) && Boolean(seen.add(t.id)));
}

const CARD_STATUS: Record<string, CardStatus> = {
  active: 'active',
  frozen: 'frozen', paused: 'frozen',
  locked: 'locked', blocked: 'locked',
  cancelled: 'cancelled', canceled: 'cancelled', closed: 'cancelled', terminated: 'cancelled',
  not_active: 'inactive', inactive: 'inactive', pending_activation: 'inactive', not_activated: 'inactive',
};

export function normalizeCard(raw: Dict): Card {
  const status = str(pick(raw, ['status', 'state']))?.toLowerCase().replace(/[\s-]+/g, '_');
  return {
    id: str(pick(raw, ['id', 'cardId', 'card_id', 'uuid'])) ?? crypto.randomUUID(),
    nickname: str(pick(raw, ['nickname', 'name', 'label', 'displayName'])) ?? 'Cartão',
    type: (str(pick(raw, ['type', 'cardType', 'kind'])) ?? 'physical').toLowerCase(),
    lastFour: str(pick(raw, ['lastFour', 'last_four', 'last4', 'cardLastFour', 'number']))?.replace(/\D/g, '').slice(-4) ?? '0000',
    // status que a fonte não manda (ou manda num nome novo) não pode virar "ativo": cartão bloqueado não é utilizável
    status: (status && CARD_STATUS[status]) || 'unknown',
    currency: currencyOf(pick(raw, ['currency', 'settlementCurrency']), 'USD'),
  };
}

export function normalizeCards(result: Dict | undefined): Card[] {
  return pluckArray(result, ['cards', 'items', 'data', 'results'])
    .filter((r): r is Dict => typeof r === 'object' && r !== null)
    .map(normalizeCard);
}

export function normalizeMainAccount(result: Dict | undefined): MainAccount {
  const d = result ?? {};
  const nested = (pick(d, ['account', 'mainAccount', 'data']) as Dict) ?? {};
  const maybe = (keys: string[]): number | undefined => numv(pick(d, keys)) ?? numv(pick(nested, keys));
  const trading = pick(d, ['tradingPositionsIncluded']) ?? pick(nested, ['tradingPositionsIncluded']);
  const label = str(pick(d, ['accountLabel'])) ?? str(pick(nested, ['accountLabel']));
  // o "spending power" da descrição da ferramenta é availableBalance; os outros nomes são de fontes antigas
  const spending = maybe(['availableBalance', 'available_balance', 'spendingPower', 'spending_power', 'availableSpending', 'available', 'balance']);
  return {
    totalBalance: maybe(['totalBalance', 'total_balance']),
    ...(trading === false ? { balancePartial: true } : {}),
    creditLimit: maybe(['creditLimit', 'credit_limit', 'limit']) ?? 0,
    amountBorrowed: maybe(['amountBorrowed', 'amount_borrowed', 'borrowed', 'outstandingDebt']) ?? 0,
    ...(spending !== undefined ? { availableBalance: spending } : {}),
    vaultAddress: str(pick(d, ['vaultAddress', 'vault_address', 'address', 'walletAddress'])) ?? '',
    currency: currencyOf(pick(d, ['currency']), 'USD'),
    ...(label ? { accountLabel: label } : {}),
  };
}

/** Quantidade como número, ou {amount, decimals} em unidades base. */
function quantityOf(v: unknown): number | undefined {
  const direct = numv(v);
  if (direct !== undefined) return direct;
  if (v && typeof v === 'object') {
    const amount = numv((v as Dict).amount);
    const decimals = numv((v as Dict).decimals) ?? 0;
    if (amount !== undefined) return amount / 10 ** decimals;
  }
  return undefined;
}

export function normalizePortfolio(result: Dict | undefined): Portfolio {
  const d = result ?? {};
  // groups[] não é a lista de ativos: sem holdings, o pluckArray genérico não pode cair nele
  const rows = pluckArray(Array.isArray(d) ? d : { ...d, groups: undefined }, ['holdings', 'assets', 'positions', 'items', 'data']);
  const holdings = rows
    .filter((r): r is Dict => typeof r === 'object' && r !== null)
    .map((h): Holding => {
      const backing = pick(h, ['backsSpending', 'backs_spending', 'backing', 'backsSpendingPower', 'collateral', 'isCollateral']);
      const groupId = str(pick(h, ['groupId', 'group_id', 'group']));
      const chainId = numv(pick(h, ['chainId', 'chain_id']));
      const asset = str(pick(h, ['asset', 'symbol', 'token', 'name'])) ?? '?';
      return {
        asset,
        name: str(pick(h, ['name', 'displayName'])),
        quantity: quantityOf(pick(h, ['quantity', 'qty', 'amount', 'balance'])),
        dollarValue: numv(pick(h, ['dollarValue', 'valueUsd', 'usdValue', 'value', 'dollar_value'])) ?? 0,
        backsSpending: backing === true || backing === 'true' || backing === 1,
        apy: numv(pick(h, ['apy', 'APY', 'yield', 'yieldRate'])),
        ...(groupId ? { groupId } : {}),
        ...(chainId !== undefined ? { chainId } : {}),
        // o campo cru `vault` da fonte é outra coisa (o nome do cofre da conta, ex.: "cash"): o sinal sai do grupo
        ...(isVault({ asset, groupId }) ? { vault: true } : {}),
      };
    });
  const total = numv(pick(d, ['totalValue', 'total', 'portfolioValue', 'totalUsd'])) ?? R2(holdings.reduce((s, h) => s + h.dollarValue, 0));
  const unrenderable = numv(pick(d, ['unrenderableAssetCount'])) ?? 0;
  const groups = Array.isArray(d.groups)
    ? d.groups
      .filter((g): g is Dict => typeof g === 'object' && g !== null)
      .map((g) => ({ id: str(g.id), label: str(g.label) ?? str(g.name) ?? str(g.id) }))
      .filter((g): g is { id: string; label: string } => Boolean(g.id && g.label))
    : [];
  return {
    totalValue: total,
    holdings,
    partial: d.tradingPositionsIncluded === false || unrenderable > 0,
    ...(groups.length ? { groups } : {}),
    ...(unrenderable > 0 ? { unrenderableCount: unrenderable } : {}),
    ...(typeof d.tradingPositionsIncluded === 'boolean' ? { tradingIncluded: d.tradingPositionsIncluded } : {}),
  };
}

/**
 * LTV publicado por símbolo (supportedAssets[].ltv de get_deposit_address). Só o casamento seguro: símbolo exato, um
 * valor só (o mesmo símbolo com LTVs diferentes fica de fora) e fração entre 0 e 1.
 */
export function ltvBySymbol(result: Dict | undefined): Map<string, number> {
  const supported = pick(result ?? {}, ['supportedAssets']);
  const seen = new Map<string, number | null>();
  if (!Array.isArray(supported)) return new Map();
  for (const a of supported) {
    if (typeof a !== 'object' || a === null) continue;
    const symbol = str((a as Dict).symbol);
    const ltv = numv((a as Dict).ltv);
    if (!symbol || ltv === undefined) continue;
    const valid = ltv >= 0 && ltv <= 1 ? ltv : null;
    const prev = seen.get(symbol);
    seen.set(symbol, prev === undefined ? valid : prev === valid ? prev : null);
  }
  return new Map([...seen].filter((e): e is [string, number] => e[1] !== null));
}

/** Põe em cada ativo o LTV publicado do mesmo símbolo, quando o casamento é seguro (ltvBySymbol). */
export function withLtv(portfolio: Portfolio, deposit: Dict | undefined): Portfolio {
  const ltv = ltvBySymbol(deposit);
  if (!ltv.size) return portfolio;
  return {
    ...portfolio,
    holdings: portfolio.holdings.map((h) => (ltv.has(h.asset) ? { ...h, ltv: ltv.get(h.asset) } : h)),
  };
}

export function normalizeDeposit(result: Dict | undefined): DepositInfo {
  const d = result ?? {};
  const arr = (keys: string[]): string[] => {
    const v = pick(d, keys);
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String((x as Dict)?.symbol ?? (x as Dict)?.name ?? x)));
    if (typeof v === 'string') return v.split(/[,\s]+/).filter(Boolean);
    return [];
  };
  // supportedAssets[].contracts[].network: cada ativo só vale nas redes listadas para ele
  const supported = pick(d, ['supportedAssets']);
  const assetNetworks = Array.isArray(supported)
    ? supported
      .filter((a): a is Dict => typeof a === 'object' && a !== null)
      .map((a) => ({
        symbol: str(a.symbol) ?? '?',
        name: str(a.name) ?? str(a.symbol) ?? '?',
        networks: Array.isArray(a.contracts)
          ? [...new Set((a.contracts as Dict[]).map((c) => str(c?.network)).filter((n): n is string => Boolean(n)))]
          : [],
      }))
      .filter((a) => a.networks.length > 0)
    : undefined;
  return {
    address: str(pick(d, ['address', 'depositAddress', 'deposit_address', 'vaultAddress'])) ?? '',
    networks: arr(['networks', 'chains', 'supportedNetworks', 'networkList']),
    assets: arr(['assets', 'tokens', 'supportedAssets', 'assetList']),
    assetNetworks: assetNetworks?.length ? assetNetworks : undefined,
  };
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * O endereço de depósito confere com a conta? Um arquivo importado (até com nome inocente: o tipo sai da forma) pode
 * trazer o endereço de qualquer um, e o resto da tela continuaria sendo a conta da pessoa. Só 'match' liga o QR e o
 * "Copiar": formato de endereço, igual ao `address` de get_main_account e os arquivos todos da mesma conta (o
 * accountLabel que cada resposta traz).
 */
function depositCheck(address: string, account: MainAccount, labels: (string | undefined)[], splitImport: boolean): DepositInfo['check'] {
  if (!address) return undefined;
  if (!EVM_ADDRESS.test(address)) return 'invalid';
  if (!EVM_ADDRESS.test(account.vaultAddress)) return 'no_account';
  const named = new Set(labels.filter(Boolean));
  // contas diferentes, ou uma conta sem nome no meio de arquivos que têm: não dá para dizer de quem é o endereço
  if (named.size > 1 || (named.size === 1 && !account.accountLabel)) return 'mixed_accounts';
  if (address.toLowerCase() !== account.vaultAddress.toLowerCase()) return 'mismatch';
  // conta e depósito somados depois do resto (rawFiles.ts): coerentes entre si, mas não confirmam nada
  return splitImport ? 'separate_import' : 'match';
}

const R2 = (n: number) => Math.round(n * 100) / 100;

export interface ToolErrors {
  list_transactions?: string;
  list_cards?: string;
  get_main_account?: string;
  get_portfolio?: string;
  get_deposit_address?: string;
}

export interface Assembled {
  dataset: Dataset;
  errors: ToolErrors;
}

/**
 * Reúne resultados das 5 tools em um Dataset (falls back para campos vazios quando scope falta).
 * O extrato chega de um de dois jeitos: `transactionPages`, as respostas cruas de list_transactions na ordem (página 1
 * primeiro), ou `transactions` já juntado, com o `incomplete` de todas as páginas somado (OR) e o nextPage da última.
 */
export function assembleDataset(parts: {
  referenceDate: string;
  transactions?: Dict | undefined;
  transactionPages?: Dict[];
  cards?: Dict | undefined;
  mainAccount?: Dict | undefined;
  portfolio?: Dict | undefined;
  deposit?: Dict | undefined;
  errors?: ToolErrors;
  /** Quando o saldo foi lido (ISO), se a origem sabe */
  snapshotAt?: string;
  /** Importação: os arquivos da conta vieram de importações diferentes (RawBundle.splitImport) */
  splitImport?: boolean;
  /** true só na conexão ao vivo: é o que autoriza o QR do endereço de depósito */
  live?: boolean;
}): Assembled {
  const pages = parts.transactionPages?.length ? parts.transactionPages : parts.transactions ? [parts.transactions] : [];
  const transactions = normalizeTransactions({ transactions: pages.flatMap((p) => pluckArray(p, ['transactions', 'items', 'data', 'results', 'rows'])) });
  const referenceDate = parts.referenceDate;
  const earliest = transactions.reduce<string | null>((a, t) => (a === null || t.date < a ? t.date : a), null);
  // nextPage na última página lida = existe histórico mais antigo que não foi carregado
  const moreHistory = pages.at(-1)?.nextPage != null;
  // incomplete em qualquer página = o conector deixou linhas de fora: totais parciais, não "histórico antigo"
  const droppedRows = pages.some((p) => p.incomplete === true);
  // hasVault: false em qualquer resposta = conta que nunca recebeu depósito
  const neverFunded = [parts.mainAccount, parts.portfolio, parts.deposit].some((r) => r?.hasVault === false);
  const to = `${referenceDate}T23:59:59Z`;
  // o que veio de fato: resposta que falhou (ou arquivo que não foi importado) chega undefined
  const sources: NonNullable<Dataset['sources']> = {
    list_transactions: pages.length > 0,
    list_cards: Boolean(parts.cards),
    get_main_account: Boolean(parts.mainAccount),
    get_portfolio: Boolean(parts.portfolio),
    get_deposit_address: Boolean(parts.deposit),
  };
  const account = normalizeMainAccount(parts.mainAccount);
  const deposit = normalizeDeposit(parts.deposit);
  const label = (r: Dict | undefined) => str(pick(r ?? {}, ['accountLabel']));
  const check = depositCheck(deposit.address, account, [
    account.accountLabel, label(parts.portfolio), label(parts.cards), label(parts.deposit), ...pages.map(label),
  ], Boolean(parts.splitImport));
  // arquivo de depósito que não é desta conta também não dita o LTV dos ativos
  const tampered = check === 'mismatch' || check === 'mixed_accounts' || check === 'separate_import';
  return {
    dataset: {
      referenceDate,
      account,
      cards: normalizeCards(parts.cards),
      portfolio: withLtv(normalizePortfolio(parts.portfolio), tampered ? undefined : parts.deposit),
      deposit: { ...deposit, ...(check ? { check } : {}), ...(parts.live ? { trusted: true } : {}) },
      transactions,
      // sem nenhuma linha, a cobertura só existe para levar o aviso de linhas omitidas
      coverage: earliest
        ? { from: earliest, to, complete: !moreHistory, droppedRows }
        : droppedRows ? { from: `${referenceDate}T00:00:00Z`, to, complete: !moreHistory, droppedRows } : undefined,
      ...(neverFunded ? { neverFunded } : {}),
      sources,
      ...(parts.snapshotAt ? { snapshotAt: parts.snapshotAt } : {}),
    },
    errors: parts.errors ?? {},
  };
}
