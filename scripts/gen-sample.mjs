// Gerador determinístico das fixtures sintéticas (fixtures/sample/): respostas CRUAS do conector com a mesma forma
// de fixtures/live/ (chaves, tipos, valores em string, páginas da mais recente para a mais antiga), mas com dados
// 100% inventados, e exemplos dos arquivos da IA e das regras locais. Servem para mexer no normalize, no pipeline e
// nas assinaturas sem ter conta: ?fixtures=sample no dev e scripts/check-sample.mts.
// Rode de novo depois de mudar o cenário: node scripts/gen-sample.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../fixtures/sample');

/** Último dia com movimento: o "hoje" que os checks usam para as fixtures */
const SAMPLE_REF = '2026-10-14';
const START = '2026-04-02';
const DAY = 86400000;
const ACCOUNT_LABEL = 'Sample account (synthetic)';
// visivelmente inválido (não é hexadecimal), com cara de endereço: ninguém manda fundos para cá por engano
const ADDRESS = '0xSAMPLE-FIXTURE-ADDRESS-NOT-REAL-DO-NOT-SEND';

let seed = 20261014;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const between = (a, b) => a + (b - a) * rand();
const int = (a, b) => Math.floor(between(a, b + 1));

/** Decimal em string como o conector manda: sem zeros à direita ("39", "12.5", "4.75"). */
const dec = (n, places = 2) => {
  const s = n.toFixed(places);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};
/** Número com muitas casas (swap/aplicação), com dígitos determinísticos depois das 6 primeiras */
const longDec = (n, places) => {
  let tail = '';
  while (tail.length < places - 6) tail += String(int(0, 9));
  return `${n.toFixed(6)}${tail}`;
};

const at = (day, h, m, s = int(0, 59), ms = int(0, 999)) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCHours(h, m, s, ms);
  return d;
};
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
// compras com cartão: milissegundos e Z; on-chain: segundos e +00:00 (as duas formas aparecem no conector)
const isoCard = (d) => d.toISOString();
const isoChain = (d, withMs = false) => d.toISOString().replace(withMs ? /Z$/ : /\.\d{3}Z$/, '+00:00');

// câmbio fictício (USD por unidade), com uma oscilação pequena e determinística por dia
const BASE_RATE = { USD: 1, EUR: 1.085, GBP: 1.27, JPY: 0.0068, MXN: 0.054 };
const rateOn = (cur, d) => (cur === 'USD' ? 1 : BASE_RATE[cur] * (1 + 0.01 * Math.sin(d.getTime() / (9 * DAY))));

let n = 0;
const txId = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
const txHash = () => `0x${'0'.repeat(56)}${n.toString(16).padStart(8, '0')}`;

const CARDS = {
  daily: { id: '00000000-0000-4000-9000-000000000001', nickname: 'Daily', cardType: 'VIRTUAL', last4: '0001', status: 'ACTIVE', currency: 'USD' },
  online: { id: '00000000-0000-4000-9000-000000000002', nickname: null, cardType: 'VIRTUAL', last4: '0002', status: 'ACTIVE', currency: 'USD' },
  old: { id: '00000000-0000-4000-9000-000000000003', nickname: 'Old travel card', cardType: 'VIRTUAL', last4: '0003', status: 'CANCELLED', currency: 'USD' },
  physical: { id: '00000000-0000-4000-9000-000000000004', nickname: 'Physical', cardType: 'PHYSICAL', last4: '0004', status: 'NOT_ACTIVE', currency: 'USD' },
};

const rows = [];

/** Compra com cartão (rain_transaction): valor em USD (o que saiu do saldo) e o valor local da maquininha. */
function purchase(d, merchant, local, cur, { category, status = 'CLEARED', card = CARDS.daily, usdPlaces = 2 } = {}) {
  const usd = local * rateOn(cur, d);
  const localPlaces = cur === 'JPY' ? 0 : 2;
  rows.push({
    id: txId(),
    date: isoCard(d),
    type: 'rain_transaction',
    direction: 'out',
    amount: dec(usd, usdPlaces),
    currency: 'USD',
    status,
    merchant,
    ...(category ? { category } : {}),
    cardLast4: card.last4,
    localAmount: dec(local, localPlaces),
    localCurrency: cur,
  });
}

/** Movimento on-chain (depósito, aplicação, swap, saque...): sem estabelecimento nem cartão. */
function chain(d, type, direction, amount, token, { status = 'CLEARED', withMs = false } = {}) {
  rows.push({
    id: txId(),
    date: isoChain(d, withMs),
    type,
    direction,
    amount,
    currency: 'USD',
    status,
    txHash: txHash(),
    token,
  });
}

const JAPAN = ['2026-06-10', '2026-06-15'];
const UK = ['2026-08-20', '2026-08-23'];
const away = (day) => (day >= JAPAN[0] && day <= JAPAN[1]) || (day >= UK[0] && day <= UK[1]);

// ---------- dia a dia na moeda da casa (EUR) ----------
const EVERYDAY = [
  { merchant: 'GREENLEAF MARKET 214', category: 'Groceries', every: [6, 8], amount: [28, 95], hours: [9, 19] },
  { merchant: 'CAFE LUMEN', category: 'Food & Dining', every: [2, 4], amount: [2.8, 7.6], hours: [7, 10] },
  { merchant: 'TRATTORIA FINTA', category: 'Food & Dining', every: [10, 14], amount: [24, 58], hours: [19, 21] },
  { merchant: 'QUICKBITE*NONNA PASTA', category: 'Rideshare & Delivery', every: [8, 12], amount: [14, 32], hours: [18, 21] },
  { merchant: 'QUICKBITE*GREEN BOWL', category: 'Rideshare & Delivery', every: [9, 13], amount: [12, 24], hours: [11, 13] },
  { merchant: 'RIDEALONG *TRIP', category: 'Rideshare & Delivery', every: [5, 8], amount: [6, 19], hours: [7, 22] },
  { merchant: 'PHARMA NOVA 03', category: 'Health & Pharmacy', every: [22, 28], amount: [8, 26], hours: [10, 18] },
  { merchant: 'FUELPOINT 77', category: 'Gas & Fuel', every: [13, 17], amount: [45, 70], hours: [8, 19] },
  { merchant: 'PAGEBOUND BOOKS', category: 'Retail & Shopping', every: [17, 23], amount: [12, 34], hours: [11, 19] },
  // sem categoria do conector: o dicionário/regras locais decidem
  { merchant: 'KIOSK 24 CONVENIENCE', every: [7, 11], amount: [2, 9], hours: [7, 22] },
];
for (const m of EVERYDAY) {
  for (let day = addDays(START, int(0, m.every[0])); day <= SAMPLE_REF; day = addDays(day, int(m.every[0], m.every[1]))) {
    if (away(day)) continue;
    // a compra grande da livraria e o estorno são montados à mão, abaixo
    if (m.merchant === 'PAGEBOUND BOOKS' && day >= '2026-09-24') continue;
    purchase(at(day, int(m.hours[0], m.hours[1]), int(0, 59)), m.merchant, between(m.amount[0], m.amount[1]), 'EUR', { category: m.category });
  }
}

// ---------- assinaturas (serviços fictícios) ----------
for (let month = 4; month <= 10; month++) {
  const mm = String(month).padStart(2, '0');
  // mensal em USD, cartão online; a de outubro tem centavos a mais na liquidação (6 casas, como o conector às vezes manda)
  purchase(at(`2026-${mm}-03`, 6, 12), 'PIXELFLOW*STUDIO', 12, 'USD', { card: CARDS.online, usdPlaces: month === 10 ? 6 : 2 });
  // mensal barata, também em USD; em julho a 1ª tentativa é recusada e passa no dia seguinte
  if (month === 7) {
    purchase(at('2026-07-11', 4, 2), 'NIMBUSBOX STORAGE', 2.99, 'USD', { card: CARDS.online, status: 'DECLINED' });
    purchase(at('2026-07-12', 4, 3), 'NIMBUSBOX STORAGE', 2.99, 'USD', { card: CARDS.online });
  } else if (`2026-${mm}-11` <= SAMPLE_REF) {
    purchase(at(`2026-${mm}-11`, 4, 2), 'NIMBUSBOX STORAGE', 2.99, 'USD', { card: CARDS.online });
  }
  // streaming em EUR, cancelada em setembro (o email de cancelamento está em subscription-evidence.json)
  if (month <= 9) purchase(at(`2026-${mm}-21`, 9, 30), 'STREAMORA*MONTHLY', 9.99, 'EUR', { card: CARDS.online });
  // academia em EUR no dia 1; o preço sobe em setembro (email de mudança de preço)
  purchase(at(`2026-${mm}-01`, 8, 0), 'FITPULSE CLUB', month >= 9 ? 44 : 39, 'EUR');
}
// anual em USD, renovada há pouco: dá para pedir reembolso (renewal-audit.json diz 30 dias)
purchase(at('2026-09-28', 3, 41), 'LINGOLEAP*ANNUAL', 119.99, 'USD', { card: CARDS.online });

// ---------- viagens ----------
const japan = [
  ['2026-06-10', 'SORA RAIL PASS', 29650],
  ['2026-06-10', 'KOHAKU RAMEN', 1450],
  ['2026-06-11', 'HOTEL KUMO', 84000],
  ['2026-06-11', 'MOMIJI KONBINI', 780],
  ['2026-06-12', 'TOKIWA SOUVENIRS', 5200],
  ['2026-06-13', 'KOHAKU RAMEN', 1680],
  ['2026-06-14', 'MOMIJI KONBINI', 1120],
];
for (const [day, merchant, yen] of japan) purchase(at(day, int(1, 12), int(0, 59)), merchant, yen, 'JPY', { card: CARDS.old, category: merchant.includes('RAMEN') ? 'Food & Dining' : undefined });
// recusada no free shop do aeroporto (DECLINED: aparece no extrato, nunca no total)
purchase(at('2026-06-15', 2, 40), 'SKYPORT DUTY FREE', 12900, 'JPY', { card: CARDS.old, status: 'DECLINED' });

const uk = [
  ['2026-08-20', 'METROLINE FARES', 7.4],
  ['2026-08-20', 'BRAMBLE HOTEL', 312],
  ['2026-08-21', 'THE GILDED FOX', 42.8],
  ['2026-08-21', 'METROLINE FARES', 7.4],
  ['2026-08-22', 'FOXGLOVE BOOKSHOP', 18.5],
  ['2026-08-23', 'THE GILDED FOX', 36.2],
];
for (const [day, merchant, gbp] of uk) purchase(at(day, int(9, 21), int(0, 59)), merchant, gbp, 'GBP', { category: merchant === 'THE GILDED FOX' ? 'Food & Dining' : undefined });
// estorno parcial do hotel com status REFUND (valor negativo)
purchase(at('2026-08-26', 10, 5), 'BRAMBLE HOTEL', -45, 'GBP', { status: 'REFUND' });
// compra avulsa em outra moeda, sem viagem (menos de 3 compras)
purchase(at('2026-05-09', 20, 15), 'MERCADO PLAZA SOL', 640, 'MXN', { card: CARDS.online, category: 'Retail & Shopping' });

// ---------- estornos, anuladas e o que o painel deve apontar ----------
// estorno (CLEARED com valor negativo) de uma compra dias antes
purchase(at('2026-07-02', 15, 20), 'PAGEBOUND BOOKS', 22, 'EUR', { category: 'Retail & Shopping' });
purchase(at('2026-07-08', 9, 2), 'PAGEBOUND BOOKS', -22, 'EUR', { category: 'Retail & Shopping' });
// anuladas (VOID): a pré-autorização some e a cobrança certa vem depois
purchase(at('2026-05-17', 20, 10), 'TRATTORIA FINTA', 31, 'EUR', { category: 'Food & Dining', status: 'VOID' });
purchase(at('2026-05-17', 20, 12), 'TRATTORIA FINTA', 33.5, 'EUR', { category: 'Food & Dining' });
purchase(at('2026-08-04', 13, 0), 'FUELPOINT 77', 100, 'EUR', { status: 'VOID' });
// muito acima do normal: a livraria costuma ficar entre 12 e 34
purchase(at('2026-09-30', 16, 45), 'PAGEBOUND BOOKS', 268, 'EUR', { category: 'Retail & Shopping' });
// primeira vez nos últimos 30 dias, com bem mais de 60 dias de histórico antes
purchase(at('2026-10-05', 11, 30), 'HOMEWARD GARDEN SUPPLY', 64.9, 'EUR');
// duplicada: mesmo estabelecimento e mesmo valor em 2 minutos
purchase(at('2026-10-08', 19, 12), 'QUICKBITE*NONNA PASTA', 23.4, 'EUR', { category: 'Rideshare & Delivery' });
purchase(at('2026-10-08', 19, 14), 'QUICKBITE*NONNA PASTA', 23.4, 'EUR', { category: 'Rideshare & Delivery' });
// pendente há mais de 14 dias (confira) e uma pendente normal de hoje
purchase(at('2026-09-27', 18, 3), 'RAILHOP TICKETS', 54, 'EUR', { status: 'PENDING' });
purchase(at(SAMPLE_REF, 8, 47), 'CAFE LUMEN', 4.2, 'EUR', { category: 'Food & Dining', status: 'PENDING' });

// ---------- dinheiro entrando, rendendo e saindo (on-chain) ----------
for (let month = 4; month <= 10; month++) {
  const mm = String(month).padStart(2, '0');
  for (const dd of ['01', '15']) {
    const day = `2026-${mm}-${dd}`;
    if (day < START || day > SAMPLE_REF) continue;
    chain(at(day, 12, int(0, 59), int(0, 59), 0), 'topup', 'in', dec(between(650, 900), 2), 'USDC');
  }
  const deposit = `2026-${mm}-02`;
  if (deposit >= START && deposit <= SAMPLE_REF) chain(at(deposit, 13, int(0, 59), int(0, 59), 0), 'liquid_deposit', 'in', longDec(between(150, 400), 6), 'USDC');
}
const swaps = [['2026-04-20', 'WETH'], ['2026-05-28', 'ETHFI'], ['2026-07-19', 'WETH'], ['2026-08-30', 'USDC'], ['2026-09-18', 'weETH'], ['2026-10-10', 'ETHFI']];
for (const [day, token] of swaps) chain(at(day, int(14, 22), int(0, 59), int(0, 59), 0), 'swap', 'out', longDec(between(20, 260), 24), token);
chain(at('2026-06-03', 16, 20, 11, 0), 'completed_withdrawal', 'out', '300', 'USDC');
chain(at('2026-06-21', 17, 5, 41, 0), 'stargate_execute_bridge', 'out', longDec(between(80, 120), 12), 'USDC');
chain(at('2026-07-25', 10, 0, 3, 0), 'liquid_execute_withdrawal', 'out', longDec(between(100, 150), 6), 'USDC');
chain(at('2026-08-12', 21, 9, 30, 0), 'liquid_execute_bridge', 'out', longDec(between(40, 60), 6), 'USDC');
chain(at('2026-09-05', 15, 33, 7, 0), 'repay', 'out', longDec(between(200, 250), 6), 'USDC');
// os pendentes on-chain: indicação, depósito a caminho e cashback a resgatar (este com milissegundos e +00:00)
chain(at('2026-10-02', 9, 0, 0, 0), 'affiliate_payout', 'out', '10.50', 'USDC', { status: 'PENDING' });
chain(at('2026-10-13', 22, 15, 9, 0), 'pending_topup', 'in', longDec(between(300, 500), 6), 'USDC', { status: 'PENDING' });
chain(at('2026-10-11', 7, 45, 12, 318), 'cashback_claim', 'out', dec(between(3, 9), 4), 'SCR', { status: 'PENDING', withMs: true });
// tipo que o painel não conhece: tem de cair em "other", nunca virar compra
chain(at('2026-09-09', 11, 11, 11, 0), 'vault_migration', 'out', '0', 'USDC');

// ---------- páginas: mais recente primeiro; a virada de página repete uma linha (como o conector faz) ----------
rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.id.localeCompare(a.id));
const SIZES = [70, 70, 70];
const pages = [];
let cursor = 0;
for (const size of SIZES) {
  pages.push(rows.slice(cursor, cursor + size));
  cursor += size;
}
pages.push(rows.slice(cursor));
// a última linha da página 1 volta como primeira da 2; idem entre a 3 e a 4
pages[1].unshift(pages[0].at(-1));
pages[3].unshift(pages[2].at(-1));

const page = (transactions, i, extra = {}) => ({
  accountLabel: ACCOUNT_LABEL,
  transactions,
  returned: transactions.length,
  nextPage: i + 1 < pages.length ? i + 2 : null,
  incomplete: false,
  ...extra,
});

const write = (name, body) => {
  const file = resolve(OUT, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
};

pages.forEach((p, i) => write(`list_transactions.page${i + 1}.json`, page(p, i)));
// variante: a página 3 como o conector manda quando omite linhas que não sabe afirmar (incomplete: true).
// Fica numa subpasta para o ?fixtures=sample continuar com o histórico inteiro; o check-sample troca uma pela outra.
const kept = pages[2].filter((_, i) => i % 9 !== 4);
write('incomplete/list_transactions.page3.json', page(kept, 2, { incomplete: true }));

write('list_cards.json', { accountLabel: ACCOUNT_LABEL, cards: Object.values(CARDS) });

const holdings = [
  { symbol: 'liquidUSD', name: 'USD Yield', valueUsd: '2450.18', collateral: true, apy: 6.2, groupId: 'liquidVaults', chainId: 10, quantity: null, vault: 'cash' },
  { symbol: 'USDC', name: 'USD Coin', valueUsd: '812.4', collateral: true, apy: 0, groupId: 'crypto', chainId: 10, quantity: { amount: '812400000', decimals: 6, symbol: 'USDC' }, vault: 'cash' },
  { symbol: 'weETH', name: 'Staked ETH', valueUsd: '3120.55', collateral: true, apy: 2.9, groupId: 'value-accruing', chainId: 10, quantity: { amount: '950000000000000000', decimals: 18, symbol: 'weETH' }, vault: 'cash' },
  { symbol: 'ETHFI', name: 'ether.fi governance token', valueUsd: '96.3', collateral: false, apy: 0, groupId: 'crypto', chainId: 10, quantity: { amount: '107000000000000000000', decimals: 18, symbol: 'ETHFI' }, vault: 'cash' },
];
write('get_portfolio.json', {
  hasVault: true,
  accountLabel: ACCOUNT_LABEL,
  tradingPositionsIncluded: true,
  // 1 ativo que o conector não sabe mostrar: a carteira listada é parcial
  unrenderableAssetCount: 1,
  groups: [
    { id: 'liquidVaults', label: 'Liquid vaults' },
    { id: 'value-accruing', label: 'Staking' },
    { id: 'crypto', label: 'Crypto' },
  ],
  holdings,
});

write('get_main_account.json', {
  hasVault: true,
  accountLabel: ACCOUNT_LABEL,
  address: ADDRESS,
  currency: 'USD',
  totalBalance: dec(holdings.reduce((s, h) => s + Number(h.valueUsd), 0), 2),
  availableBalance: '1840.2',
  creditLimit: '3000',
  borrowed: '412.75',
  tradingPositionsIncluded: true,
});

const contract = (symbol, network) => ({ network, address: `0xSAMPLE-${symbol.toUpperCase()}-${network.toUpperCase()}-CONTRACT` });
const asset = (symbol, name, decimals, ltv, networks) => ({ symbol, name, decimals, ltv, contracts: networks.map((nw) => contract(symbol, nw)) });
write('get_deposit_address.json', {
  hasVault: true,
  address: ADDRESS,
  networks: ['arbitrum', 'base', 'ethereum', 'optimism'],
  supportedAssets: [
    asset('USDC', 'USD Coin', 6, '0.9', ['arbitrum', 'base', 'ethereum', 'optimism']),
    asset('USDT', 'Tether USD', 6, '0.9', ['ethereum', 'optimism']),
    asset('WETH', 'Wrapped Ether', 18, '0.8', ['base', 'ethereum', 'optimism']),
    asset('weETH', 'Staked ETH', 18, '0.75', ['base', 'ethereum', 'optimism']),
    asset('ETHFI', 'ether.fi governance token', 18, '0.5', ['ethereum', 'optimism']),
  ],
});

// ---------- arquivos da IA (formatos de src/lib/subscriptionTypes.ts) ----------
const GENERATED = `${SAMPLE_REF}T09:00:00Z`;
write('subscription-evidence.json', {
  generatedAt: GENERATED,
  source: 'synthetic sample (no real email)',
  items: [
    { name: 'Pixelflow Studio', matchers: ['pixelflow'], kind: 'receipt', emailDate: '2026-10-03', subject: 'Your Pixelflow Studio receipt', plan: 'Creator', amount: 12, currency: 'USD', cycle: 'monthly', periodEnd: '2026-11-03', manageUrl: 'https://pixelflow.example/account/billing' },
    { name: 'Streamora', matchers: ['streamora'], kind: 'cancellation', emailDate: '2026-09-25', subject: 'Streamora: your subscription was cancelled', cycle: 'monthly', periodEnd: '2026-10-21' },
    { name: 'FitPulse Club', matchers: ['fitpulse'], kind: 'price_change', emailDate: '2026-08-20', subject: 'FitPulse: new monthly price from September', plan: 'Flex', amount: 44, currency: 'EUR', cycle: 'monthly' },
    { name: 'Lingoleap', matchers: ['lingoleap'], kind: 'renewal_notice', emailDate: '2026-09-14', subject: 'Lingoleap: your annual plan renews on Sep 28', plan: 'Annual', amount: 119.99, currency: 'USD', cycle: 'annual', periodEnd: '2026-09-28', manageUrl: 'https://lingoleap.example/settings/subscription' },
    { name: 'Lingoleap', matchers: ['lingoleap'], kind: 'receipt', emailDate: '2026-09-28', subject: 'Your Lingoleap receipt', plan: 'Annual', amount: 119.99, currency: 'USD', cycle: 'annual', periodEnd: '2027-09-28' },
  ],
});

write('subscription-research.json', {
  generatedAt: GENERATED,
  items: [
    { matchers: ['pixelflow'], name: 'Pixelflow Studio', isSubscription: 'yes', cycles: ['monthly', 'annual'], note: { en: 'Design app billed monthly or yearly; the plan renews automatically.', pt: 'App de design cobrado por mês ou por ano; o plano renova sozinho.' }, manageUrl: 'https://pixelflow.example/account/billing', domains: ['pixelflow.example'], sources: ['https://pixelflow.example/pricing'] },
    { matchers: ['nimbusbox'], name: 'NimbusBox', isSubscription: 'yes', cycles: ['monthly', 'annual'], note: { en: 'Cloud storage; small monthly charge.', pt: 'Armazenamento na nuvem; cobrança mensal pequena.' }, manageUrl: 'https://nimbusbox.example/settings/plan', domains: ['nimbusbox.example'], sources: ['https://nimbusbox.example/plans'] },
    { matchers: ['streamora'], name: 'Streamora', isSubscription: 'yes', cycles: ['monthly'], note: 'Video streaming, monthly.', manageUrl: 'https://streamora.example/account', domains: ['streamora.example'], sources: ['https://streamora.example/help/billing'] },
    { matchers: ['fitpulse'], name: 'FitPulse Club', isSubscription: 'yes', cycles: ['monthly'], note: { en: 'Gym membership charged on the 1st; cancelling needs 30 days of notice.', pt: 'Academia cobrada no dia 1; cancelar pede 30 dias de aviso.' }, domains: ['fitpulse.example'], sources: ['https://fitpulse.example/membership-terms'] },
    { matchers: ['lingoleap'], name: 'Lingoleap', isSubscription: 'yes', cycles: ['annual', 'monthly'], note: { en: 'Language-learning app; the annual plan renews on the same date each year.', pt: 'App de idiomas; o plano anual renova na mesma data todo ano.' }, manageUrl: 'https://lingoleap.example/settings/subscription', domains: ['lingoleap.example'], sources: ['https://lingoleap.example/terms'] },
    { matchers: ['greenleaf market'], name: 'Greenleaf Market', isSubscription: 'no', cycles: ['unknown'], note: { en: 'Supermarket: frequent purchases, not a subscription.', pt: 'Supermercado: compras frequentes, não é assinatura.' }, sources: ['https://greenleaf.example/about'] },
  ],
});

write('renewal-audit.json', {
  generatedAt: GENERATED,
  items: [
    {
      name: 'Lingoleap', matchers: ['lingoleap'], autoRenew: 'yes', noticeBeforeRenewal: 'yes', noticeDays: 14,
      cancelDeadline: { en: 'Until 24 hours before the renewal date', pt: 'Até 24 horas antes da data de renovação' },
      refundWindowDays: 30,
      refundNote: { en: 'Full refund within 30 days of an annual renewal, on request.', pt: 'Reembolso integral até 30 dias depois da renovação anual, se pedir.' },
      manageUrl: 'https://lingoleap.example/settings/subscription',
      sources: ['https://lingoleap.example/terms', 'email: Lingoleap: your annual plan renews on Sep 28, 2026-09-14'],
      checked: ['website', 'email'], checkedAt: '2026-10-01', risk: 'medium',
      riskReasons: [{ en: 'Annual plan that renews by itself', pt: 'Plano anual que renova sozinho' }, { en: 'Sends a notice 14 days before', pt: 'Avisa 14 dias antes' }],
    },
    {
      name: 'FitPulse Club', matchers: ['fitpulse'], autoRenew: 'yes', noticeBeforeRenewal: 'no',
      cancelDeadline: { en: 'Written notice 30 days before the next charge', pt: 'Aviso por escrito 30 dias antes da próxima cobrança' },
      refundWindowDays: 0,
      priceChangeAtRenewal: { en: 'Price went from 39 to 44 EUR in September', pt: 'O preço passou de 39 para 44 EUR em setembro' },
      sources: ['https://fitpulse.example/membership-terms', 'email: FitPulse: new monthly price from September, 2026-08-20'],
      checked: ['website', 'email'], checkedAt: '2026-10-01', risk: 'high',
      riskReasons: [{ en: 'No reminder before each charge', pt: 'Nenhum aviso antes de cada cobrança' }, { en: '30-day notice to cancel', pt: 'Cancelamento com 30 dias de aviso' }],
    },
    {
      name: 'NimbusBox', matchers: ['nimbusbox'], autoRenew: 'yes', noticeBeforeRenewal: 'no', refundWindowDays: 0,
      manageUrl: 'https://nimbusbox.example/settings/plan', sources: ['https://nimbusbox.example/plans'],
      checked: ['website'], checkedAt: '2026-10-01', risk: 'low',
      riskReasons: [{ en: 'Small monthly charge, cancel any time', pt: 'Cobrança mensal pequena, cancela quando quiser' }],
    },
  ],
});

// ---------- regras locais de estabelecimento (formato MerchantRulesFile de src/lib/merchants.ts) ----------
write('merchant-rules.json', {
  rules: [
    // `match` é expressão regular sobre o descritor, sem diferenciar maiúsculas; vem antes das regras públicas
    { match: '^QUICKBITE\\*', name: 'QuickBite', category: 'delivery', brand: 'QuickBite' },
    { match: 'TRATTORIA FINTA', name: 'Trattoria Finta', category: 'dining' },
    { match: '^KIOSK 24', name: { en: 'Kiosk 24 · convenience store', pt: 'Kiosk 24 · loja de conveniência' }, category: 'groceries' },
    { match: 'HOMEWARD GARDEN', name: 'Homeward Garden Supply', category: 'home' },
    { match: 'PIXELFLOW', name: 'Pixelflow Studio', category: 'software', brand: 'Pixelflow', subscription: true },
    // sem categoria: vale a da fonte
    { match: '^RAILHOP', name: { en: 'Railhop · train tickets', pt: 'Railhop · passagens de trem' } },
  ],
  // palavra que a fatura escreve sem acento, em minúsculas
  accents: { lumen: 'lúmen' },
});

console.log(`fixtures/sample: ${rows.length} linhas em ${pages.length} páginas (+2 repetidas na virada), referência ${SAMPLE_REF}`);
