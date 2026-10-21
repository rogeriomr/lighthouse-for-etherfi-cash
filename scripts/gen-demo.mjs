// Gerador determinístico do dataset de demonstração: uma pessoa nos EUA (casa em dólar), 15 meses de histórico
// (jul/2025 a 12/out/2026), tudo fictício. O app desloca as datas para "hoje" (shiftDemo); os checks usam as daqui.
// Saída: src/lib/demo/dataset.ts (literal JSON satisfies Dataset). Mesmo resultado a cada execução.
//
// O que o demo existe para mostrar: US$ 25.561,00 na conta, com as 5 classes de ativo e crédito em uso; empréstimos e
// pagamentos; depósitos, saques, trocas, pontes, aplicações no rendimento, resgates de cashback e indicações; 3 cartões
// (um congelado); 3 viagens (MXN, GBP/EUR, JPY) com um caso de DCC provável; 13 assinaturas ativas, mensais e anuais:
// um aumento, uma anual que renovou hoje sem aviso (risco alto), uma anual cara que renova em 3 semanas sem aviso, uma
// que renova em 2 dias, um teste grátis que virou cobrança, uma sobreposição e um clube; uma que parou com email de
// cancelamento e uma que parou sem email ("possivelmente cancelada"); arquivos da IA (email, pesquisa e auditoria); o
// retrato da importação anterior; alertas de duplicata, valor acima do usual, pendência antiga e primeira vez.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/lib/demo/dataset.ts');

const REF = '2026-10-12';
const FIRST_MONTH = '2025-07';
const R2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

// preços que casam com a base pública (src/lib/insights/priceBook.ts): a cobrança precisa bater com a tabela (1%)
// (Netflix Standard 17,99 → 19,99, anunciado em 27/03/2026; Spotify Individual 11,99 → 12,99 desde a fatura de fevereiro)
const PRICE = {
  netflixOld: 17.99,
  netflixNew: 19.99,
  spotifyOld: 11.99,
  spotifyNew: 12.99,
  claudePro: 20,
  chatgptPlus: 20,
  youtubeIos: 20.99,
  uberOne: 9.99,
};

// ---------- relógio determinístico ----------
let seed = 4242;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const clock = (h0 = 8, h1 = 21) => `${pad(h0 + Math.floor(rnd() * (h1 - h0)))}:${pad(Math.floor(rnd() * 60))}:${pad(Math.floor(rnd() * 60))}Z`;

const ymAdd = (ym, n) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthsFrom = (from, to) => {
  const out = [];
  for (let ym = from; ym <= to; ym = ymAdd(ym, 1)) out.push(ym);
  return out;
};
const MONTHS = monthsFrom(FIRST_MONTH, REF.slice(0, 7));

// ---------- cartões: um físico, dois virtuais; o "Online" foi congelado em maio ----------
const cards = [
  { id: 'c1', nickname: 'Everyday', type: 'physical', lastFour: '4417', status: 'active', currency: 'USD' },
  { id: 'c2', nickname: 'Travel', type: 'virtual', lastFour: '0932', status: 'active', currency: 'USD' },
  { id: 'c3', nickname: 'Online', type: 'virtual', lastFour: '2281', status: 'frozen', currency: 'USD' },
];
const FROZEN_ON = '2026-05-01';
const onlineCard = (day) => (day < FROZEN_ON ? 'c3' : 'c1');

// ---------- linhas ----------
const txns = [];
let seq = 0;
function add(type, status, day, o = {}) {
  seq += 1;
  const currency = o.currency ?? 'USD';
  const amount = R2(o.amount);
  const rate = o.rate ?? 1;
  const t = {
    id: `tx-${String(seq).padStart(4, '0')}`,
    type,
    status,
    date: o.at ?? `${day}T${clock(o.h0, o.h1)}`,
    merchant: o.merchant,
    category: o.category,
    amount,
    currency,
    amountUsd: currency === 'USD' ? amount : R2(amount * rate),
    cardId: o.cardId,
    city: o.city,
    country: o.country,
    exchangeRate: currency === 'USD' ? undefined : rate,
    token: o.token,
  };
  txns.push(t);
  return t;
}
const buy = (day, merchant, category, amount, o = {}) => add('purchase', o.status ?? 'settled', day, { cardId: 'c1', ...o, merchant, category, amount });
const minutesAfter = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString().replace('.000Z', 'Z');

// ---------- a conta abre com um depósito (o valor sai no fim, para o patrimônio fechar com o extrato) ----------
const opening = add('top_up', 'settled', '', { merchant: 'Transfer from Coinbase', amount: 0, token: 'USDC', at: '2025-07-01T08:05:00Z' });
add('yield_deposit', 'settled', '', { amount: 5000, token: 'liquidUSD', at: '2025-07-01T08:09:00Z' });
add('swap', 'settled', '', { amount: 5000, token: 'weETH', at: '2025-07-02T10:31:00Z' });

// ---------- assinaturas ----------
// [estabelecimento, categoria da fonte, valor, dia, primeiro mês, último mês, cartão]
const SUBS = [
  ['FitLab Gym', 'Health & Fitness', 49, 1, '2025-07', '2026-04', () => 'c1'],
  ['Netflix', 'Subscriptions', PRICE.netflixOld, 11, '2025-07', '2026-09', onlineCard],
  ['Spotify Premium', 'Subscriptions', PRICE.spotifyOld, 23, '2025-07', '2026-01', onlineCard],
  ['Spotify Premium', 'Subscriptions', PRICE.spotifyNew, 23, '2026-02', '2026-09', onlineCard],
  ['iCloud+', 'Subscriptions', 2.99, 5, '2025-07', '2026-10', onlineCard],
  ['Claude.ai', 'Subscriptions', PRICE.claudePro, 14, '2025-09', '2026-09', onlineCard],
  ['ChatGPT Plus', 'Subscriptions', PRICE.chatgptPlus, 2, '2026-02', '2026-10', onlineCard],
  ['YouTube Premium', 'Subscriptions', PRICE.youtubeIos, 18, '2026-01', '2026-09', onlineCard],
  ['Uber One', 'Subscriptions', PRICE.uberOne, 15, '2026-01', '2026-09', onlineCard],
  // fictícios: o streaming que renova em 2 dias, o plano de celular (a categoria vem do nome) e o curso que parou sem email
  ['StreamBox', 'Subscriptions', 15.99, 14, '2026-03', '2026-09', onlineCard],
  ['Pinecell Wireless', 'Utilities', 35, 8, '2025-07', '2026-10', () => 'c1'],
  ['LinguaLeap', 'Subscriptions', 12.99, 20, '2026-01', '2026-08', onlineCard],
];
for (const [merchant, category, amount, day, from, to, card] of SUBS) {
  for (const ym of monthsFrom(from, to)) {
    const d = `${ym}-${pad(day)}`;
    if (d <= REF) buy(d, merchant, category, amount, { cardId: card(d), h0: 6, h1: 10 });
  }
}
// o aumento chega na última renovação, como a pessoa vê na fatura
buy('2026-10-11', 'Netflix', 'Subscriptions', PRICE.netflixNew, { cardId: 'c1', h0: 6, h1: 10 });
// anual: renovou há 11 dias (o arquivo da auditoria dá 30 dias para pedir reembolso)
buy('2025-10-01', 'Kestrel Notes', 'Subscriptions', 59.99, { cardId: 'c3', at: '2025-10-01T07:12:40Z' });
buy('2026-10-01', 'Kestrel Notes', 'Subscriptions', 59.99, { cardId: 'c1', at: '2026-10-01T07:12:40Z' });
// anual sem lembrete que renovou hoje (risco alto): só o recibo chega depois
buy('2025-10-12', 'FitPal', 'Subscriptions', 119.99, { cardId: 'c3', at: '2025-10-12T10:42:15Z' });
buy('2026-10-12', 'FitPal', 'Subscriptions', 119.99, { cardId: 'c1', at: '2026-10-12T10:42:15Z' });
// anual cara, sem lembrete, que renova em 3 semanas: a única cobrança no histórico
buy('2025-11-02', 'PhotoVault', 'Subscriptions', 129.99, { cardId: 'c1', at: '2025-11-02T08:27:51Z' });
// o teste grátis acabou e virou a primeira cobrança (o email avisou o fim do teste)
buy('2026-10-05', 'MindHarbor', 'Subscriptions', 12.99, { cardId: 'c1', at: '2026-10-05T09:03:26Z' });

// ---------- âncoras: histórico para "acima do usual" e compras avulsas grandes ----------
const SHELL = [48.9, 52.4, 50.1, 55.1, 51.9, 49.6, 53.3, 47.8, 54.2, 50.7, 52.0, 49.1, 51.4, 53.8, 50.5];
MONTHS.slice(0, -1).forEach((ym, i) => buy(`${ym}-20`, 'Shell', 'Transport', SHELL[i % SHELL.length]));
buy('2025-12-12', 'Apple Store', 'Electronics', 1199);
buy('2026-04-18', 'IKEA', 'Home', 230.4);
buy('2026-07-25', 'Best Buy', 'Electronics', 349.99);
buy('2025-08-09', 'Sushi Yama', 'Food & Dining', 64.2);
// cinema em datas soltas: uma vez por mês com o mesmo valor viraria "assinatura"
for (const [d, v] of [['2025-08-16', 31.2], ['2025-12-27', 46.8], ['2026-03-28', 29.8], ['2026-07-11', 34.6]]) buy(d, 'AMC Theatres', 'Entertainment', v);
buy('2026-01-24', 'Sushi Yama', 'Food & Dining', 71.1);
buy('2026-05-30', 'Sushi Yama', 'Food & Dining', 68.5);
// estorno de uma compra da Amazon (mesmo valor, seis dias depois)
buy('2026-02-14', 'Amazon', 'Retail & Shopping', 54.9, { cardId: 'c3' });
buy('2026-02-20', 'Amazon', 'Retail & Shopping', -54.9, { cardId: 'c3' });
// pré-autorização de hotel cancelada
buy('2026-07-19', 'Lakeside Inn', 'Accommodation', 260, { cardId: 'c2', status: 'void' });
// lazer, casa, roupa e curso em datas soltas (repetir todo mês com valor parecido viraria "assinatura")
for (const [d, v] of [['2025-09-19', 128.4], ['2026-02-06', 86.5], ['2026-06-12', 154.2]]) buy(d, 'Ticketmaster', 'Entertainment', v);
for (const [d, v] of [['2026-01-31', 58.4], ['2026-07-03', 72.6]]) buy(d, 'Bowlero', 'Entertainment', v);
buy('2025-12-06', 'Crate & Barrel', 'Home', 189);
buy('2026-08-22', 'Crate & Barrel', 'Home', 96.5);
buy('2026-04-04', 'Nike', 'Retail & Shopping', 124.99);
buy('2026-09-26', 'Nike', 'Retail & Shopping', 89.97);
// a categoria vem do nome ("School"): a fonte manda uma que o app não conhece
for (const [d, v] of [['2025-10-14', 85], ['2026-02-21', 120], ['2026-06-06', 95]]) buy(d, 'Harbor Art School', 'Education', v);

// ---------- viagens (cartão Travel, com cidade) ----------
const RATE = { MXN: 0.055, GBP: 1.27, EUR: 1.08, JPY: 0.0068 };
const trip = (day, merchant, category, amount, currency, city, country, extra = {}) =>
  buy(day, merchant, category, amount, { cardId: 'c2', currency, rate: RATE[currency] ?? 1, city, country, ...extra });

// Cidade do México, 6 a 10 de novembro
trip('2025-11-06', 'Delta Air Lines', 'Travel', 352.4, 'USD', 'Mexico City', 'Mexico');
trip('2025-11-06', 'Casa Lumbre Hotel', 'Accommodation', 7200, 'MXN', 'Mexico City', 'Mexico');
trip('2025-11-06', 'Taqueria El Faro', 'Food & Dining', 420, 'MXN', 'Mexico City', 'Mexico');
trip('2025-11-07', 'Mercado Roma', 'Food & Dining', 380, 'MXN', 'Mexico City', 'Mexico');
trip('2025-11-07', 'Museo de la Ciudad', 'Activities', 180, 'MXN', 'Mexico City', 'Mexico');
trip('2025-11-08', 'Uber', 'Transport', 145, 'MXN', 'Mexico City', 'Mexico');
trip('2025-11-08', 'Contramar', 'Food & Dining', 1450, 'MXN', 'Mexico City', 'Mexico');
trip('2025-11-09', 'Cafe Avellaneda', 'Food & Dining', 120, 'MXN', 'Mexico City', 'Mexico');
trip('2025-11-10', 'Taxi aeropuerto', 'Transport', 380, 'MXN', 'Mexico City', 'Mexico');

// Londres (12 a 15) e Paris (16 a 19 de março)
trip('2026-03-12', 'United Airlines', 'Travel', 812, 'USD', 'London', 'United Kingdom');
trip('2026-03-12', 'Thameside Hotel', 'Accommodation', 690, 'GBP', 'London', 'United Kingdom');
trip('2026-03-13', 'Borough Market', 'Food & Dining', 34.5, 'GBP', 'London', 'United Kingdom');
trip('2026-03-13', 'TfL Travel', 'Transport', 18.2, 'GBP', 'London', 'United Kingdom');
trip('2026-03-14', 'Dishoom', 'Food & Dining', 62, 'GBP', 'London', 'United Kingdom');
trip('2026-03-15', 'Tate Modern Shop', 'Activities', 28, 'GBP', 'London', 'United Kingdom');
trip('2026-03-16', 'Eurostar', 'Transport', 145, 'GBP', 'London', 'United Kingdom');
trip('2026-03-16', 'Hotel Rive Gauche', 'Accommodation', 760, 'EUR', 'Paris', 'France');
trip('2026-03-17', 'Le Petit Zinc', 'Food & Dining', 78, 'EUR', 'Paris', 'France');
trip('2026-03-17', 'Boulangerie Moreau', 'Food & Dining', 9.4, 'EUR', 'Paris', 'France');
trip('2026-03-18', 'RATP', 'Transport', 16.9, 'EUR', 'Paris', 'France');
trip('2026-03-18', 'Musee d Orsay', 'Activities', 32, 'EUR', 'Paris', 'France');
trip('2026-03-19', 'Cafe de Flore', 'Food & Dining', 24, 'EUR', 'Paris', 'France');

// Tóquio, 4 a 10 de setembro: a câmera cobrada em US$ numa loja de Tóquio é o DCC provável
trip('2026-09-04', 'All Nippon Airways', 'Travel', 1180, 'USD', 'Tokyo', 'Japan');
trip('2026-09-04', 'Hotel Aozora Shinjuku', 'Accommodation', 168000, 'JPY', 'Tokyo', 'Japan');
trip('2026-09-05', 'Ramen Kaze', 'Food & Dining', 1980, 'JPY', 'Tokyo', 'Japan');
trip('2026-09-05', 'Suica Charge', 'Transport', 5000, 'JPY', 'Tokyo', 'Japan');
trip('2026-09-06', 'Sushi Hanabi', 'Food & Dining', 14500, 'JPY', 'Tokyo', 'Japan');
trip('2026-09-07', 'Lumina Art Museum', 'Activities', 3800, 'JPY', 'Tokyo', 'Japan');
trip('2026-09-07', 'Tsukiji Stall', 'Food & Dining', 3200, 'JPY', 'Tokyo', 'Japan');
trip('2026-09-08', 'Ginza Camera', 'Retail & Shopping', 238, 'USD', 'Tokyo', 'Japan');
trip('2026-09-09', 'Sky Deck Shibuya', 'Activities', 2500, 'JPY', 'Tokyo', 'Japan', { status: 'void' });
trip('2026-09-09', 'Izakaya Tomo', 'Food & Dining', 9600, 'JPY', 'Tokyo', 'Japan');
trip('2026-09-10', 'Narita Express', 'Transport', 3250, 'JPY', 'Tokyo', 'Japan');

// ---------- o dia a dia: cadência por mês, com o total do mês num alvo ----------
const POOLS = {
  'Whole Foods': [42.4, 51.2, 44.2, 47.3, 49.1, 55.6, 53.2, 46.7, 52.4, 55.1, 48.2, 59.8, 50.9, 57.3],
  "Trader Joe's": [38.9, 44.6, 52.1, 48.3, 55.7, 61.4, 43.5],
  Sweetgreen: [17.1, 18.0, 16.9, 17.2, 18.4, 17.6, 17.7, 18.1, 17.3, 18.6],
  'Blue Bottle': [6.1, 6.2, 6.4, 6.2],
  Starbucks: [5.75, 5.9, 5.8, 6.1],
  CVS: [13.4, 15.2, 18.9, 14.6, 19.8, 12.9, 16.4],
  Amazon: [36.9, 32.4, 78.9, 61.3, 45.1, 28.6, 84.2, 38.4, 54.9],
  Target: [52.4, 38.6, 47.2, 41.8, 45.3, 39.6],
  Uber: [19.4, 22.1, 17.8, 20.6, 18.9, 21.1, 23.4, 19.8],
  'Uber Eats': [27.3, 32.4, 28.9, 35.6, 30.1, 27.5, 33.8, 29.4],
  Chipotle: [13.6, 13.9, 14.2, 14.5, 14.3, 14.1],
  Costco: [142.6, 168.3, 155.9, 131.4, 177.2, 149.8],
  'Panera Bread': [13.2, 14.8, 12.9, 15.4],
  'Shake Shack': [18.6, 21.3, 19.9, 22.4],
  Walgreens: [16.8, 21.4, 12.6, 19.3],
  Etsy: [28.5, 41.9, 33.2, 46.7],
  Sephora: [48.2, 62.5, 55.9, 71.3],
  'Home Depot': [58.4, 83.9, 66.2, 94.7],
  'AMC Theatres': [29.8, 34.6, 31.2],
  DoorDash: [31.4, 36.8, 29.9, 38.2],
  Safeway: [36.8, 44.1, 39.5, 47.2, 41.9],
  'Tartine Bakery': [11.4, 13.8, 12.6, 9.9],
  Grubhub: [26.4, 31.8, 29.2, 34.7],
  Lyft: [16.2, 21.7, 18.4, 24.9],
  Chevron: [44.6, 47.9, 51.3],
  'Lotus Yoga Studio': [24, 24, 28],
  Petco: [38.6, 52.4, 44.9, 61.7],
  // acima de US$ 30: valor baixo repetido todo mês viraria "assinatura" pela recorrência
  'Barber & Blade': [32, 35, 38],
  Uniqlo: [39.9, 59.9, 49.9, 44.9],
};
const CADENCE = [
  ['Whole Foods', 'Groceries', 5], ["Trader Joe's", 'Groceries', 4], ['Costco', 'Groceries', 1],
  ['Sweetgreen', 'Food & Dining', 4], ['Blue Bottle', 'Food & Dining', 3], ['Starbucks', 'Food & Dining', 4],
  ['Panera Bread', 'Food & Dining', 2], ['Shake Shack', 'Food & Dining', 2], ['Chipotle', 'Food & Dining', 2],
  ['CVS', 'Retail & Shopping', 2], ['Walgreens', 'Health & Pharmacy', 1], ['Amazon', 'Retail & Shopping', 3],
  ['Target', 'Retail & Shopping', 2], ['Etsy', 'Retail & Shopping', 1], ['Sephora', 'Retail & Shopping', 1],
  ['Home Depot', 'Home', 1], ['Uber', 'Transport', 5],
  ['Uber Eats', 'Food & Dining', 3], ['DoorDash', 'Food & Dining', 2],
  ['Safeway', 'Groceries', 2], ['Tartine Bakery', 'Food & Dining', 2], ['Grubhub', 'Food & Dining', 2],
  ['Lyft', 'Transport', 2], ['Chevron', 'Transport', 1], ['Lotus Yoga Studio', 'Health & Fitness', 2],
  ['Petco', 'Retail & Shopping', 1], ['Barber & Blade', 'Personal Care', 1], ['Uniqlo', 'Retail & Shopping', 1],
];
// o que completa o mês: lugares do bairro (restaurante e mercado precisam de confirmação para virar assinatura; a loja
// passa de US$ 30)
const FILLERS = [
  ['Corner Bistro', 'Food & Dining'], ['Luna Cafe', 'Food & Dining'], ['Harbor Diner', 'Food & Dining'], ['Maple Kitchen', 'Food & Dining'],
  ['Saffron House', 'Food & Dining'], ['Golden Wok', 'Food & Dining'], ['Bella Trattoria', 'Food & Dining'],
  ['Greenleaf Market', 'Groceries'], ['Willow & Co', 'Retail & Shopping'], ['Northside Outfitters', 'Retail & Shopping'],
];
// alvo de gasto (compras, estornos descontados) de cada mês inteiro: o mês da viagem e dezembro sobem. O dia a dia é
// 48% maior que o da primeira versão do demo; as viagens ficaram como eram (no total, as compras sobem ~40%)
const TARGET = {
  '2025-07': 3140, '2025-08': 3340, '2025-09': 3230, '2025-10': 3610, '2025-11': 4270, '2025-12': 5270,
  '2026-01': 2930, '2026-02': 3050, '2026-03': 5610, '2026-04': 3460, '2026-05': 3670, '2026-06': 3140,
  '2026-07': 3910, '2026-08': 3570, '2026-09': 6070,
};

function hashStr(s) {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return h;
}
function pickDays(key, times, maxDay = 28) {
  const base = hashStr(key);
  return [...new Set(Array.from({ length: times }, (_, i) => Math.max(1, Math.min(maxDay, ((base + i * 6) % maxDay) + 1))))].sort((a, b) => a - b);
}
const monthTotal = (ym) => R2(txns.filter((t) => t.type === 'purchase' && t.status !== 'void' && t.date.startsWith(ym)).reduce((s, t) => s + t.amountUsd, 0));

for (const [ym, target] of Object.entries(TARGET)) {
  const added = [];
  for (const [merchant, category, times] of CADENCE) {
    const pool = POOLS[merchant];
    pickDays(`${ym}-${merchant}`, times).forEach((day, i) => {
      const d = `${ym}-${pad(day)}`;
      const online = merchant === 'Amazon' || merchant === 'Target' || merchant === 'Etsy';
      added.push(buy(d, merchant, category, pool[(hashStr(ym + merchant) + i * 3) % pool.length], { cardId: online ? onlineCard(d) : 'c1' }));
    });
  }
  // passou do alvo: tira as maiores do dia a dia; faltou: refeições pequenas espalhadas no mês
  while (monthTotal(ym) - target > 8 && added.length) {
    const i = added.reduce((bi, t, k) => (t.amountUsd > added[bi].amountUsd ? k : bi), 0);
    txns.splice(txns.indexOf(added[i]), 1);
    added.splice(i, 1);
  }
  let k = 0;
  while (target - monthTotal(ym) > 8) {
    const amount = R2(Math.min(72 + (k % 3), target - monthTotal(ym)));
    const [merchant, category] = FILLERS[k % FILLERS.length];
    buy(`${ym}-${pad(3 + ((k * 5) % 24))}`, merchant, category, amount);
    k += 1;
  }
}

// ---------- outubro até o dia 12: fixo, com os alertas que o demo existe para mostrar ----------
const OCT = [
  ['2026-10-01', 'Sweetgreen', 'Food & Dining', 17.8], ['2026-10-01', 'Amazon', 'Retail & Shopping', 38.2],
  ['2026-10-02', 'Whole Foods', 'Groceries', 58.2], ['2026-10-02', 'Target', 'Retail & Shopping', 45.3],
  ['2026-10-03', 'Starbucks', 'Food & Dining', 5.9], ['2026-10-03', 'Uber', 'Transport', 21.4],
  ['2026-10-04', 'Blue Bottle', 'Food & Dining', 6.2], ['2026-10-05', 'Chipotle', 'Food & Dining', 14.5],
  ['2026-10-05', 'Sweetgreen', 'Food & Dining', 17.3], ['2026-10-06', "Trader Joe's", 'Groceries', 49.8],
  ['2026-10-07', 'Starbucks', 'Food & Dining', 5.9], ['2026-10-07', 'Uber', 'Transport', 18.9],
  ['2026-10-08', 'Sweetgreen', 'Food & Dining', 17.7], ['2026-10-09', 'Whole Foods', 'Groceries', 64.1],
  ['2026-10-10', 'Starbucks', 'Food & Dining', 6.1], ['2026-10-11', 'Uber', 'Transport', 22.7],
  ['2026-10-01', 'Safeway', 'Groceries', 46.3], ['2026-10-02', 'Chevron', 'Transport', 47.9],
  ['2026-10-02', 'Lyft', 'Transport', 19.6], ['2026-10-03', 'Tartine Bakery', 'Food & Dining', 12.4],
  ['2026-10-04', 'Grubhub', 'Food & Dining', 33.7], ['2026-10-06', 'Lotus Yoga Studio', 'Health & Fitness', 24],
  ['2026-10-07', 'Shake Shack', 'Food & Dining', 21.3], ['2026-10-08', 'CVS', 'Retail & Shopping', 17.2],
  ['2026-10-09', 'Lyft', 'Transport', 23.1], ['2026-10-11', 'Sweetgreen', 'Food & Dining', 18.1],
];
for (const [d, merchant, category, amount] of OCT) buy(d, merchant, category, amount);
// o estorno da Target, quatro dias depois
buy('2026-10-06', 'Target', 'Retail & Shopping', -45.3);
// duplicata: o mesmo pedido duas vezes em 2 minutos
buy('2026-10-08', 'Uber Eats', 'Food & Dining', 38.4, { at: '2026-10-08T12:14:22Z' });
buy('2026-10-08', 'Uber Eats', 'Food & Dining', 38.4, { at: '2026-10-08T12:16:05Z' });
// acima do usual: o posto de sempre, três vezes a mediana
buy('2026-10-09', 'Shell', 'Transport', 186.2);
// primeira vez num lugar novo
buy('2026-10-10', 'Juniper Books', 'Retail & Shopping', 32);
// reserva ainda a confirmar há 9 dias
buy('2026-10-03', 'Harborview Hotel', 'Accommodation', 412, { cardId: 'c2', status: 'pending', at: '2026-10-03T00:12:00Z' });

// ---------- dinheiro que entra e sai ----------
for (const ym of MONTHS.slice(1)) {
  const top = add('top_up', 'settled', `${ym}-03`, { merchant: 'ACH transfer', amount: 4600, token: 'USDC', h0: 9, h1: 11 });
  // parte de alguns depósitos vai para o rendimento minutos depois
  if (['2025-09', '2025-12', '2026-03', '2026-06', '2026-09'].includes(ym)) add('yield_deposit', 'settled', '', { amount: 500, token: 'liquidUSD', at: minutesAfter(top.date, 3) });
}
add('withdrawal', 'settled', '2025-12-15', { merchant: 'Transfer to bank', amount: 1500, token: 'USDC' });
add('withdrawal', 'settled', '2026-06-20', { merchant: 'ATM withdrawal', amount: 200, token: 'USDC' });
add('bridge', 'settled', '2026-02-10', { amount: 1000, token: 'USDC' });
add('bridge', 'settled', '2026-06-18', { amount: 500, token: 'USDC' });
add('swap', 'settled', '2025-12-05', { amount: 700, token: 'PAXG' });
add('swap', 'settled', '2026-01-08', { amount: 650, token: 'wSPYx' });
add('swap', 'settled', '2026-02-15', { amount: 600, token: 'wQQQx' });
add('swap', 'settled', '2026-03-25', { amount: 900, token: 'EURC' });
add('swap', 'settled', '2026-04-20', { amount: 600, token: 'wTBLLx' });
add('swap', 'settled', '2026-06-02', { amount: 2500, token: 'eBTC' });

// crédito: três empréstimos (com as viagens) e quatro pagamentos; emprestado no fim = 3.500
add('borrow', 'settled', '2025-11-20', { merchant: 'Borrow against vault', amount: 2000 });
add('repayment', 'settled', '2025-12-20', { merchant: 'Repayment', amount: 1000 });
add('repayment', 'settled', '2026-01-20', { merchant: 'Repayment', amount: 1000 });
add('borrow', 'settled', '2026-03-10', { merchant: 'Borrow against vault', amount: 2500 });
add('repayment', 'settled', '2026-05-05', { merchant: 'Repayment', amount: 1500 });
add('borrow', 'settled', '2026-09-03', { merchant: 'Borrow against vault', amount: 3000 });
add('repayment', 'settled', '2026-10-02', { merchant: 'Repayment', amount: 500 });

// recompensas: o resgate do cashback no fim de cada mês (1,5% do gasto do mês), o de outubro ainda a confirmar
for (const ym of MONTHS.slice(0, -1)) {
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const claim = add('cashback_claim', 'settled', `${ym}-${pad(last)}`, { amount: R2(monthTotal(ym) * 0.015), token: 'USDC', h0: 18, h1: 20 });
  // a troca que sai junto com um resgate é a perna dele, não dinheiro novo
  if (ym === '2026-08') add('swap', 'settled', '', { amount: claim.amount, token: 'ETHFI', at: minutesAfter(claim.date, 1) });
}
add('cashback_claim', 'pending', '2026-10-10', { amount: 9.1, token: 'USDC' });
add('referral', 'settled', '2026-03-15', { amount: 25, token: 'USDC' });
add('referral', 'pending', '2026-10-09', { amount: 25, token: 'USDC' });

txns.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

// ---------- carteira: as 5 classes de ativo, com o LTV publicado e crédito coerente ----------
const GROUPS = [
  { id: 'liquidVaults', label: 'Liquid vaults' },
  { id: 'value-accruing', label: 'Staking' },
  { id: 'crypto', label: 'Crypto' },
];
// Product LTV e fator de colateral (CF) da tabela pública da ether.fi (27/08/2026); os embrulhados usam o do xStock
const P = { USDC: [0.81, 0.9], liquidUSD: [0.8, 0.9], EURC: [0.81, 0.9], weETH: [0.55, 0.75], WETH: [0.55, 0.75], eBTC: [0.52, 0.72], ETHFI: [0.2, 0.4], wSPYx: [0.67, 0.78], wQQQx: [0.66, 0.78], wTBLLx: [0.7, 0.8], PAXG: [0.68, 0.8] };
const h = (asset, name, groupId, dollarValue, extra = {}) => ({
  asset, name, ...(extra.quantity !== undefined ? { quantity: extra.quantity } : {}), dollarValue, backsSpending: extra.backs ?? true,
  apy: extra.apy ?? 0, groupId, chainId: extra.chainId ?? 10, ...(extra.vault ? { vault: true } : {}), ltv: P[asset][0],
});
// o total é o que o vídeo mostra ("You have $25,561.00 at ether.fi"): o USDC fecha a conta
const TOTAL = 25561;
const holdings = [
  h('liquidUSD', 'USD Yield', 'liquidVaults', 8000, { apy: 6.2, vault: true }),
  h('weETH', 'Staked ETH', 'value-accruing', 5787.6, { quantity: 1.4, apy: 2.9 }),
  h('eBTC', 'ether.fi BTC', 'value-accruing', 2750, { quantity: 0.025 }),
  h('USDC', 'USD Coin', 'crypto', 2667.18, { quantity: 2667.18 }),
  h('WETH', 'Wrapped Ether', 'crypto', 2340, { quantity: 0.6 }),
  h('wSPYx', 'S&P 500', 'crypto', 750, { quantity: 1, chainId: 1 }),
  h('EURC', 'Euro Coin', 'crypto', 900, { quantity: 833.33 }),
  h('wQQQx', 'Nasdaq', 'crypto', 720, { quantity: 1, chainId: 1 }),
  h('wTBLLx', 'TBLL', 'crypto', 624, { quantity: 12, chainId: 1 }),
  h('PAXG', 'Pax Gold', 'crypto', 800, { quantity: 0.2, chainId: 1 }),
  h('ETHFI', 'ether.fi governance token', 'crypto', 222.22, { quantity: 200, backs: false }),
];
const totalBalance = R2(holdings.reduce((s, x) => s + x.dollarValue, 0));
if (totalBalance !== TOTAL) throw new Error(`a carteira soma ${totalBalance}, não ${TOTAL}`);
const collateral = holdings.filter((x) => x.backsSpending);
// o limite que o conector informa se comporta como Σ valor × CF (o limite de liquidação, coerente com o modelo publicado)
const creditLimit = R2(collateral.reduce((s, x) => s + x.dollarValue * P[x.asset][1], 0));
const borrowed = R2(txns.filter((t) => t.type === 'borrow').reduce((s, t) => s + t.amount, 0) - txns.filter((t) => t.type === 'repayment').reduce((s, t) => s + t.amount, 0));
// no Borrow Mode, o poder de compra é o que a garantia permite tomar (Σ valor × Product LTV) menos o emprestado
const availableBalance = R2(collateral.reduce((s, x) => s + x.dollarValue * P[x.asset][0], 0) - borrowed);

// ---------- o depósito inicial fecha o patrimônio com o extrato (~5% de rendimento e preço) ----------
const settledSum = (pred) => R2(txns.filter((t) => t.status === 'settled' && pred(t)).reduce((s, t) => s + t.amountUsd, 0));
const spentAll = R2(txns.filter((t) => t.type === 'purchase' && t.status !== 'void').reduce((s, t) => s + t.amountUsd, 0));
const flowWithoutOpening = R2(settledSum((t) => t.type === 'top_up' && t !== opening) - settledSum((t) => t.type === 'withdrawal') - spentAll
  + settledSum((t) => t.type === 'cashback_claim' || t.type === 'referral'));
const netWorth = R2(totalBalance - borrowed);
opening.amount = Math.round((netWorth * 0.95 - flowWithoutOpening) / 100) * 100;
opening.amountUsd = opening.amount;
const flow = R2(opening.amount + flowWithoutOpening);

// ---------- o retrato da importação anterior (20 dias antes), para "o que mudou desde a última importação" ----------
const SNAP_AT = '2026-09-22T12:00:00Z';
const lastTxAt = txns.filter((t) => t.date <= SNAP_AT).reduce((m, t) => Math.max(m, Date.parse(t.date)), 0);
const after = txns.filter((t) => Date.parse(t.date) > lastTxAt);
const afterSettled = (pred) => R2(after.filter((t) => t.status === 'settled' && pred(t)).reduce((s, t) => s + Math.abs(t.amountUsd), 0));
const explained = R2(afterSettled((t) => t.type === 'top_up') - afterSettled((t) => t.type === 'withdrawal')
  + afterSettled((t) => t.type === 'cashback' || t.type === 'cashback_claim' || t.type === 'referral')
  - R2(after.filter((t) => t.type === 'purchase' && t.status !== 'void').reduce((s, t) => s + t.amountUsd, 0)));
const PRICE_EFFECT = 170;
const borrowedBefore = R2(borrowed - afterSettled((t) => t.type === 'borrow') + afterSettled((t) => t.type === 'repayment'));
const totalBefore = R2(netWorth - (explained + PRICE_EFFECT) + borrowedBefore);
const scale = totalBefore / totalBalance;
const previousSnapshot = {
  version: 1,
  at: SNAP_AT,
  totalBalance: totalBefore,
  borrowed: borrowedBefore,
  lastTxAt,
  holdings: holdings.map((x) => ({ asset: x.asset, value: R2(x.dollarValue * scale), ...(x.quantity !== undefined ? { quantity: x.quantity } : {}) })),
};

// ---------- depósito: redes de cada ativo aceito ----------
const assetNetworks = [
  { symbol: 'USDC', name: 'USD Coin', networks: ['arbitrum', 'base', 'ethereum', 'hyperevm', 'optimism'] },
  { symbol: 'USDT', name: 'Tether USD', networks: ['ethereum', 'optimism'] },
  { symbol: 'EURC', name: 'Euro Coin', networks: ['ethereum', 'optimism'] },
  { symbol: 'WETH', name: 'Wrapped Ether', networks: ['base', 'ethereum', 'optimism'] },
  { symbol: 'weETH', name: 'ether.fi Staked ETH', networks: ['base', 'ethereum', 'optimism'] },
  { symbol: 'eBTC', name: 'ether.fi BTC', networks: ['base', 'ethereum', 'optimism'] },
  { symbol: 'PAXG', name: 'Pax Gold', networks: ['ethereum'] },
];

// ---------- arquivos da IA (formatos de src/lib/subscriptionTypes.ts): serviços fictícios e .example ----------
const GENERATED = `${REF}T09:00:00Z`;
const subscriptionSources = {
  evidence: {
    generatedAt: GENERATED,
    source: 'demo (fictitious, no real email)',
    items: [
      { name: 'Kestrel Notes', matchers: ['kestrel notes'], kind: 'renewal_notice', emailDate: '2026-09-17', subject: 'Kestrel Notes: your annual plan renews on Oct 1', plan: 'Annual', amount: 59.99, currency: 'USD', cycle: 'annual', periodEnd: '2026-10-01', manageUrl: 'https://kestrelnotes.example/account/billing' },
      { name: 'Kestrel Notes', matchers: ['kestrel notes'], kind: 'receipt', emailDate: '2026-10-01', subject: 'Your Kestrel Notes receipt', plan: 'Annual', amount: 59.99, currency: 'USD', cycle: 'annual', periodEnd: '2027-10-01' },
      { name: 'FitLab Gym', matchers: ['fitlab'], kind: 'cancellation', emailDate: '2026-04-12', subject: 'FitLab: your membership was cancelled', cycle: 'monthly', periodEnd: '2026-05-01' },
      { name: 'MindHarbor', matchers: ['mindharbor'], kind: 'trial_ending', emailDate: '2026-10-02', subject: 'Your MindHarbor free trial ends on Oct 5', plan: 'Premium', amount: 12.99, currency: 'USD', cycle: 'monthly', periodEnd: '2026-10-05', manageUrl: 'https://mindharbor.example/account' },
      // sem lembrete antes: só o recibo, no dia da cobrança
      { name: 'FitPal', matchers: ['fitpal'], kind: 'receipt', emailDate: '2026-10-12', subject: 'Your FitPal Premium receipt', plan: 'Premium Annual', amount: 119.99, currency: 'USD', cycle: 'annual', periodEnd: '2027-10-12' },
    ],
  },
  research: {
    generatedAt: GENERATED,
    items: [
      { matchers: ['kestrel notes'], name: 'Kestrel Notes', isSubscription: 'yes', cycles: ['annual', 'monthly'], note: { en: 'Note-taking app; the annual plan renews on the same date each year.', pt: 'App de notas; o plano anual renova na mesma data todo ano.' }, manageUrl: 'https://kestrelnotes.example/account/billing', domains: ['kestrelnotes.example'], sources: ['https://kestrelnotes.example/terms'] },
      { matchers: ['fitlab'], name: 'FitLab Gym', isSubscription: 'yes', cycles: ['monthly'], note: { en: 'Gym membership charged on the 1st; cancelling needs 30 days of notice.', pt: 'Academia cobrada no dia 1; cancelar pede 30 dias de aviso.' }, domains: ['fitlab.example'], sources: ['https://fitlab.example/membership-terms'] },
      { matchers: ['fitpal'], name: 'FitPal', isSubscription: 'yes', cycles: ['annual', 'monthly'], note: { en: 'Workout app; the annual plan renews by itself on the same date.', pt: 'App de treino; o plano anual renova sozinho na mesma data.' }, manageUrl: 'https://fitpal.example/account', domains: ['fitpal.example'], sources: ['https://fitpal.example/terms'] },
      { matchers: ['photovault'], name: 'PhotoVault', isSubscription: 'yes', cycles: ['annual'], note: { en: 'Photo storage sold only as a yearly plan.', pt: 'Armazenamento de fotos vendido só em plano anual.' }, manageUrl: 'https://photovault.example/billing', domains: ['photovault.example'], sources: ['https://photovault.example/terms'] },
      { matchers: ['streambox'], name: 'StreamBox', isSubscription: 'yes', cycles: ['monthly'], note: { en: 'Video streaming billed every month; cancel any time before the next charge.', pt: 'Streaming de vídeo cobrado todo mês; dá para cancelar antes da próxima cobrança.' }, manageUrl: 'https://streambox.example/account/cancel', domains: ['streambox.example'], sources: ['https://streambox.example/help/billing'] },
      { matchers: ['lingualeap'], name: 'LinguaLeap', isSubscription: 'yes', cycles: ['monthly'], note: { en: 'Language-learning app billed every month.', pt: 'App de idiomas cobrado todo mês.' }, manageUrl: 'https://lingualeap.example/settings/plan', domains: ['lingualeap.example'], sources: ['https://lingualeap.example/help/plans'] },
      { matchers: ['mindharbor'], name: 'MindHarbor', isSubscription: 'yes', cycles: ['monthly', 'annual'], note: { en: 'Meditation app; the free trial turns into a monthly plan unless you cancel.', pt: 'App de meditação; o teste grátis vira plano mensal se você não cancelar.' }, manageUrl: 'https://mindharbor.example/account', domains: ['mindharbor.example'], sources: ['https://mindharbor.example/terms'] },
    ],
  },
  audit: {
    generatedAt: GENERATED,
    items: [
      {
        name: 'Kestrel Notes', matchers: ['kestrel notes'], autoRenew: 'yes', noticeBeforeRenewal: 'yes', noticeDays: 14,
        cancelDeadline: { en: 'Until 24 hours before the renewal date', pt: 'Até 24 horas antes da data de renovação' },
        refundWindowDays: 30,
        refundNote: { en: 'Full refund within 30 days of an annual renewal, on request.', pt: 'Reembolso integral até 30 dias depois da renovação anual, se pedir.' },
        manageUrl: 'https://kestrelnotes.example/account/billing',
        sources: ['https://kestrelnotes.example/terms', 'email: Kestrel Notes: your annual plan renews on Oct 1, 2026-09-17'],
        checked: ['website', 'email'], checkedAt: '2026-10-02', risk: 'medium',
        riskReasons: [{ en: 'Annual plan that renews by itself', pt: 'Plano anual que renova sozinho' }, { en: 'Sends a notice 14 days before', pt: 'Avisa 14 dias antes' }],
      },
      {
        name: 'FitLab Gym', matchers: ['fitlab'], autoRenew: 'yes', noticeBeforeRenewal: 'no',
        cancelDeadline: { en: 'Written notice 30 days before the next charge', pt: 'Aviso por escrito 30 dias antes da próxima cobrança' },
        refundWindowDays: 0,
        sources: ['https://fitlab.example/membership-terms', 'email: FitLab: your membership was cancelled, 2026-04-12'],
        checked: ['website', 'email'], checkedAt: '2026-10-02', risk: 'high',
        riskReasons: [{ en: 'No reminder before each charge', pt: 'Nenhum aviso antes de cada cobrança' }, { en: '30-day notice to cancel', pt: 'Cancelamento com 30 dias de aviso' }],
      },
      {
        name: 'FitPal', matchers: ['fitpal'], autoRenew: 'yes', noticeBeforeRenewal: 'no',
        cancelDeadline: { en: 'Before the renewal date, in the app settings', pt: 'Antes da data de renovação, nos ajustes do app' },
        refundWindowDays: 14,
        refundNote: { en: 'Refund on request within 14 days of an annual renewal.', pt: 'Reembolso, se pedir, até 14 dias depois da renovação anual.' },
        manageUrl: 'https://fitpal.example/account',
        sources: ['https://fitpal.example/terms', 'email: Your FitPal Premium receipt, 2026-10-12'],
        checked: ['website', 'email'], checkedAt: '2026-10-12', risk: 'high',
        riskReasons: [{ en: 'Annual plan that renews by itself', pt: 'Plano anual que renova sozinho' }, { en: 'No reminder before the yearly charge', pt: 'Nenhum aviso antes da cobrança anual' }],
      },
      {
        name: 'PhotoVault', matchers: ['photovault'], autoRenew: 'yes', noticeBeforeRenewal: 'no',
        cancelDeadline: { en: 'At least 7 days before the renewal date', pt: 'Pelo menos 7 dias antes da data de renovação' },
        refundWindowDays: 0,
        manageUrl: 'https://photovault.example/billing',
        sources: ['https://photovault.example/terms'],
        checked: ['website'], checkedAt: '2026-10-02', risk: 'high',
        riskReasons: [{ en: 'Annual plan that renews by itself', pt: 'Plano anual que renova sozinho' }, { en: 'No reminder before renewal', pt: 'Nenhum aviso antes da renovação' }, { en: 'Cancel at least 7 days before', pt: 'Cancelar pelo menos 7 dias antes' }],
      },
    ],
  },
};

const dataset = {
  referenceDate: REF,
  account: {
    totalBalance, creditLimit, amountBorrowed: borrowed, availableBalance,
    // visivelmente inválido (não é hexadecimal), com o tamanho de um endereço: ninguém manda fundos para cá por engano
    vaultAddress: '0xDEMO-SAMPLE-ADDRESS-NOT-REAL-DO-NOT-SEND',
    currency: 'USD',
    accountLabel: 'Demo',
  },
  cards,
  portfolio: { totalValue: totalBalance, holdings, groups: GROUPS, tradingIncluded: true },
  deposit: {
    address: '0xDEMO-SAMPLE-ADDRESS-NOT-REAL-DO-NOT-SEND',
    networks: ['arbitrum', 'base', 'ethereum', 'hyperevm', 'optimism'],
    assets: assetNetworks.map((a) => a.symbol),
    assetNetworks,
  },
  transactions: txns,
  sources: { list_transactions: true, list_cards: true, get_main_account: true, get_portfolio: true, get_deposit_address: true },
  subscriptionSources,
  previousSnapshot,
};

// ---------- resumo no terminal (tudo fictício) ----------
const purchases = txns.filter((t) => t.type === 'purchase');
console.log('linhas', txns.length, '· compras', purchases.length, '· meses', MONTHS.length);
console.log('gasto por mês', Object.fromEntries(MONTHS.map((ym) => [ym, monthTotal(ym)])));
console.log('saldo', totalBalance, '· limite', creditLimit, '· emprestado', borrowed, `(${R2((borrowed / creditLimit) * 100)}%)`, '· poder de compra', availableBalance);
console.log('depósito inicial', opening.amount, '· fluxo líquido', flow, '· patrimônio líquido', netWorth, '· diferença', R2(netWorth - flow));
console.log('retrato anterior', previousSnapshot.totalBalance, '· emprestado antes', borrowedBefore, '· explicado', explained);

mkdirSync(dirname(OUT), { recursive: true });
// uma transação por linha (o resto indentado): metade do tamanho, e o diff de uma mudança continua legível
const TX_SLOT = '"__TRANSACTIONS__"';
const pretty = JSON.stringify({ ...dataset, transactions: '__TRANSACTIONS__' }, null, 2);
const txLines = txns.map((t) => `    ${JSON.stringify(t)}`).join(',\n');
const body = `import type { Dataset } from '../types';

export const demoDataset = ${pretty.replace(TX_SLOT, `[\n${txLines}\n  ]`)} satisfies Dataset;
`;
writeFileSync(OUT, body, 'utf8');
console.log('written', OUT, `${Math.round(Buffer.byteLength(body) / 1024)} KB`);
