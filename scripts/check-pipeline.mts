// Roda o pipeline de verdade (normalize → enrich → analytics), em vez de replicar as regras.
// Demo: alvos numéricos fixos. Pasta de dados reais (se existir): só invariantes, sem números pessoais no código.
import { isDataFile, resolveDataDir } from './data-dir.mjs';
import { demoDataset } from '../src/lib/demo/dataset.ts';
import { enrichDataset } from '../src/lib/enrich.ts';
import { assembleDataset } from '../src/lib/normalize.ts';
import {
  approxHome, cashbackSummary, detectAnomalies, detectSubscriptions, detectTrips, fxSummary, isBalanceTopUp, isFullMonth, isSpend, monthComparable,
  monthEvolutions, periodWindow, portfolioSummary, recentFx, RECENT_FX_MIN, spendSummary,
} from '../src/lib/analytics.ts';
import { assetClassOf } from '../src/lib/assetClass.ts';
import { monthLabel, monthLabelLong, setFormatLocale } from '../src/lib/format.ts';
import { CATEGORY, categoryLabel, describeMerchant, setLocalMerchantRules, type MerchantRulesFile } from '../src/lib/merchants.ts';

// Tipos mínimos do Node: o projeto não depende de @types/node só por causa deste script
interface Fs {
  existsSync(p: URL): boolean;
  readdirSync(p: URL): string[];
  readFileSync(p: URL, encoding: 'utf8'): string;
}
declare const process: { exit(code: number): never; getBuiltinModule(id: 'node:fs'): Fs };
const { existsSync, readdirSync, readFileSync } = process.getBuiltinModule('node:fs');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const R2 = (n: number) => Math.round(n * 100) / 100;

console.log('== formatação de mês ==');
for (const [locale, expected] of [['en', 'October 2026 / Oct'], ['pt', 'outubro de 2026 / out']] as const) {
  setFormatLocale(locale);
  for (const v of ['2026-10', '2026-10-01', '2026-10-17T22:15:30.250Z']) {
    let out = '';
    try { out = `${monthLabelLong(v)} / ${monthLabel(v)}`; } catch (e) { out = String(e); }
    check(`mês de "${v}" (${locale})`, out.startsWith(expected), out);
  }
}
setFormatLocale('en');

console.log('\n== demo pelo pipeline ==');
const demo = enrichDataset(demoDataset);
const subs = detectSubscriptions(demo);
const w30 = periodWindow(demo, '30d');
const s30 = spendSummary(demo, subs, w30.from, w30.to);
check('total 30d', s30.total === 3425.38, String(s30.total));
check('compras 30d', s30.count === 90, String(s30.count));
check('assinaturas / avulsas / dia a dia', s30.buckets.subscriptions === 157.94 && s30.buckets.oneOffs === 412 && s30.buckets.everyday === 2855.44, JSON.stringify(s30.buckets));
check('moeda da casa', demo.homeCurrency === 'USD', demo.homeCurrency);
const trips = detectTrips(demo);
check('3 viagens: Tóquio, Londres e Paris, Cidade do México', trips.map((t) => `${t.cities.join('>')}=${t.total}`).join(', ') === 'Tokyo=2841.44, London>Paris=3047.6, Mexico City=917.53',
  trips.map((t) => `${t.cities.join('>')}=${t.total}`).join(', '));
const kinds = detectAnomalies(demo, subs).map((a) => `${a.kind}:${a.merchant}`);
for (const k of ['duplicate:Uber Eats', 'unusually_large:Shell', 'first_time:Juniper Books', 'first_time:MindHarbor', 'stuck_pending:Harborview Hotel']) {
  check(`alerta ${k}`, kinds.includes(k));
}
// valor incomum só olha os últimos 30 dias: a compra grande da Apple Store é de dezembro
check('valor incomum antigo (Apple Store, dez/2025) não vira alerta', !kinds.includes('unusually_large:Apple Store'));
check('troca colada a um resgate de cashback não vira pendência', !kinds.some((k) => k.startsWith('stuck_pending') && !k.endsWith('Harborview Hotel')));
const months = monthEvolutions(demo, subs);
check('15 meses inteiros (jul/2025 a set/2026) e outubro parcial', months.filter(isFullMonth).length === 15 && months.at(-1)?.partial === true, String(months.filter(isFullMonth).length));
check('mês a mês: empréstimos em 3 meses e pagamentos em 4', months.filter((m) => m.borrow > 0).length === 3 && months.filter((m) => m.repayment > 0).length === 4);
check('mês a mês: cashback (resgates) em todo mês', months.every((m) => m.cashback > 0));
check('todo cartão das compras existe', demo.transactions.filter((t) => t.cardId).every((t) => demo.cards.some((c) => c.id === t.cardId)));
check('depósito: rede de cada ativo está na lista de redes', (demo.deposit.assetNetworks ?? []).every((a) => a.networks.every((n) => demo.deposit.networks.includes(n))));

// ---------- sintéticos no formato cru do conector (dados fictícios) ----------
type Raw = Record<string, unknown>;
let seq = 0;
const row = (date: string, merchant: string, amount: number, extra: Raw = {}): Raw => ({
  id: `p${++seq}`, date, type: 'rain_transaction', status: 'CLEARED', merchant, cardLast4: '1111', amount: String(amount), currency: 'USD', ...extra,
});
const page = (rows: Raw[], nextPage: number | null, incomplete = false): Raw => ({ transactions: rows, nextPage, incomplete, returned: rows.length });
const build = (opts: { pages?: Raw[]; transactions?: Raw; ref?: string; account?: Raw; portfolio?: Raw; deposit?: Raw }) => enrichDataset(assembleDataset({
  referenceDate: opts.ref ?? '2026-10-18',
  transactionPages: opts.pages,
  transactions: opts.transactions,
  mainAccount: opts.account, portfolio: opts.portfolio, deposit: opts.deposit,
}).dataset);
const monthly = (base: string, n: number, day = 15) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1 + i, day, 15));
  return row(d.toISOString(), 'PADARIA EXEMPLO', 10);
});

console.log('\n== D1: página incomplete = linhas omitidas, não histórico antigo ==');
for (const where of ['primeira', 'meio', 'última'] as const) {
  const flags = [where === 'primeira', where === 'meio', where === 'última'];
  const ds = build({ pages: [page(monthly('2026-08', 3), 2, flags[0]), page(monthly('2026-05', 3), 3, flags[1]), page(monthly('2026-02', 3), null, flags[2])] });
  check(`incomplete na ${where} página: droppedRows e histórico completo`, ds.coverage?.droppedRows === true && ds.coverage.complete === true);
  const evo = monthEvolutions(ds, []);
  check(`incomplete na ${where} página: nenhum mês inteiro, nenhum delta`, !evo.some(isFullMonth) && evo.every((m) => m.deltaPct === null && m.rowsMissing && m.projected === undefined));
}
const older = build({ pages: [page(monthly('2026-08', 3), 2), page(monthly('2026-05', 3), 3)] });
check('nextPage na última página: histórico incompleto, sem linhas omitidas', older.coverage?.complete === false && !older.coverage.droppedRows);
const merged = build({ transactions: { transactions: monthly('2026-05', 6), nextPage: null, incomplete: true } });
check('formato juntado com incomplete (OR das páginas) também marca droppedRows', merged.coverage?.droppedRows === true && merged.coverage.complete);
const clean = build({ pages: [page(monthly('2026-05', 3), 2), page(monthly('2026-02', 3), null)] });
check('sem incomplete e sem nextPage: completo, droppedRows false', clean.coverage?.complete === true && !clean.coverage.droppedRows);
check('páginas: linha repetida na virada conta uma vez', build({ pages: [page([row('2026-09-01T10:00:00Z', 'X', 5, { id: 'dup' })], 2), page([row('2026-09-01T10:00:00Z', 'X', 5, { id: 'dup' })], null)] }).transactions.length === 1);
const allDropped = build({ pages: [page([], null, true)] });
check('nenhuma linha e incomplete: a cobertura existe só para levar o aviso', allDropped.coverage?.droppedRows === true && allDropped.transactions.length === 0);

console.log('\n== D20 e D21: status REFUND e conta sem depósito ==');
const refundRows = build({ pages: [page([row('2026-10-10T12:00:00Z', 'LOJA EXEMPLO', 30, { status: 'REFUND', localAmount: '150', localCurrency: 'BRL' }), row('2026-10-09T12:00:00Z', 'LOJA EXEMPLO', 30)], null)] });
const refunded = refundRows.transactions.find((t) => t.status === 'settled' && t.amountUsd < 0);
check('REFUND com valor positivo entra como estorno (USD e moeda local negativos)', refunded?.amountUsd === -30 && refunded.amount === -150);
check('estorno abate o gasto: 30 − 30 = 0', R2(refundRows.transactions.filter(isSpend).reduce((s, t) => s + t.amountUsd, 0)) === 0);
check('REFUND que já vem negativo continua negativo', build({ pages: [page([row('2026-10-10T12:00:00Z', 'LOJA', -12, { status: 'REFUND' })], null)] }).transactions[0]?.amountUsd === -12);
check('hasVault false: neverFunded', build({ pages: [page([], null)], account: { hasVault: false }, portfolio: { hasVault: false, holdings: [] } }).neverFunded === true);
check('hasVault true: sem neverFunded', build({ pages: [page([], null)], account: { hasVault: true, totalBalance: '10' } }).neverFunded === undefined);

console.log('\n== D3: o mês em que a conta abriu é parcial ==');
const opened = build({ pages: [page([
  { id: 'dep', date: '2025-08-11T12:00:00Z', type: 'top_up', status: 'CLEARED', amount: '100', currency: 'USD' },
  row('2025-08-20T12:00:00Z', 'PADARIA EXEMPLO', 5), ...monthly('2025-09', 3, 10),
], null)], ref: '2025-12-05' });
const openedEvo = monthEvolutions(opened, []);
const aug = openedEvo.find((m) => m.month === '2025-08');
check('agosto (conta aberta no dia 11, histórico completo): startsMidMonth, não é inteiro', Boolean(aug?.startsMidMonth && !isFullMonth(aug) && aug.covered));
check('setembro não se compara com o agosto parcial', openedEvo.find((m) => m.month === '2025-09')?.deltaPct === null);
check('outubro compara com setembro (os dois inteiros)', openedEvo.find((m) => m.month === '2025-10')?.deltaPct === 0 && isFullMonth(openedEvo.find((m) => m.month === '2025-10')!));
check('monthComparable: agosto não, setembro sim', !monthComparable(opened, '2025-08') && monthComparable(opened, '2025-09'));
const dayOne = build({ pages: [page([row('2025-08-01T03:00:00Z', 'PADARIA EXEMPLO', 5), ...monthly('2025-09', 2)], null)], ref: '2025-11-05' });
check('conta aberta no dia 1: o primeiro mês é inteiro', isFullMonth(monthEvolutions(dayOne, [])[0]));

console.log('\n== D10: compra no primeiro segundo do mês ==');
const edgeDs = build({ pages: [page([
  row('2026-09-01T00:00:00.500Z', 'PADARIA EXEMPLO', 7), row('2026-09-30T23:59:59.900Z', 'PADARIA EXEMPLO', 3),
  { id: 'cb', date: '2026-09-01T00:00:00.250Z', type: 'cashback', status: 'CLEARED', amount: '2', currency: 'USD' },
], null)], ref: '2026-10-05' });
check('mês a mês conta a compra das 00:00:00.500 e a das 23:59:59.900', monthEvolutions(edgeDs, []).find((m) => m.month === '2026-09')?.total === 10);
check('janela que começa no dia 1 conta a compra do primeiro segundo', spendSummary(edgeDs, [], '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z').total === 10);
check('cashback do primeiro segundo entra na janela', cashbackSummary(edgeDs, '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z').total === 2);

console.log('\n== D13: mês desfeito por estornos ==');
const refundMonth = build({ pages: [page([
  ...monthly('2026-05', 4, 10),
  row('2026-08-05T12:00:00Z', 'LOJA EXEMPLO', 200), row('2026-09-03T12:00:00Z', 'LOJA EXEMPLO', -200),
  row('2026-09-10T12:00:00Z', 'PADARIA EXEMPLO', 10),
], null)] });
const refundEvo = monthEvolutions(refundMonth, []);
const sep = refundEvo.find((m) => m.month === '2026-09')!;
check('setembro: bruto 10, estornos 200, líquido −190', sep.gross === 10 && sep.refunds === 200 && sep.total === -190);
check('setembro: refundHeavy e sem delta em %', sep.refundHeavy && sep.deltaPct === null);
check('outubro não calcula delta contra o setembro desfeito', refundEvo.find((m) => m.month === '2026-10')?.deltaPct === null);
const jun = refundEvo.find((m) => m.month === '2026-06')!;
check('mês comum: bruto = líquido, sem estornos', jun.gross === jun.total && jun.refunds === 0 && !jun.refundHeavy);

console.log('\n== D23: projeção desconta a parte de hoje que não passou ==');
const sp = 'America/Sao_Paulo';
const paceRaw = assembleDataset({ referenceDate: '2026-10-18', transactionPages: [page([...monthly('2026-08', 2, 5), row('2026-10-05T15:00:00Z', 'PADARIA EXEMPLO', 175)], null)] }).dataset;
const pace = enrichDataset(paceRaw, 'en', sp);
const oct = monthEvolutions(pace, [], 'en', { now: new Date('2026-10-18T15:00:00Z') }).at(-1)!;
check('ao meio-dia do dia 18: 17,5 dias corridos, 18 no rótulo', oct.elapsed === 17.5 && oct.daysElapsed === 18, `${oct.elapsed}`);
check('projeção = 175 / 17,5 × 31 = 310', oct.projected === 310, String(oct.projected));
const late = monthEvolutions(pace, [], 'en', { now: new Date('2026-11-02T15:00:00Z') }).at(-1)!;
check('referenceDate que não é hoje: o dia conta inteiro', late.elapsed === 18);
check('mês corrente sem delta em % contra um mês inteiro', oct.partial && oct.deltaPct === null && oct.deltaAbs === 0);

console.log('\n== fonte única de recorrente (D12) e recarga ==');
const big = row('2026-08-20T12:00:00Z', 'SERVICO ANUAL EXEMPLO', 400, { id: 'anual' });
const oneOff = build({ pages: [page([...monthly('2026-06', 4, 10), big], null)] });
const augOf = (o: Parameters<typeof monthEvolutions>[3]) => monthEvolutions(oneOff, [], 'en', o).find((m) => m.month === '2026-08')!;
check('compra de US$ 400 sem assinatura é "pontual grande"', augOf({}).oneOffBig.some((t) => t.id === 'anual'));
check('a mesma compra atribuída pelo motor a uma assinatura não é', !augOf({ subscriptionCharges: new Set(['anual']) }).oneOffBig.length);
check('isBalanceTopUp: a mesma regra das duplicatas', isBalanceTopUp({ merchantRaw: 'UBERCASH TOPUP' }) && isBalanceTopUp({ merchantRaw: 'RECARGA CELULAR' }) && !isBalanceTopUp({ merchantRaw: 'PADARIA EXEMPLO' }));

console.log('\n== D24: "≈" em unidades inteiras ==');
const brl = build({ pages: [page([row('2026-10-01T12:00:00Z', 'PADARIA EXEMPLO', 10, { localAmount: '50.37', localCurrency: 'BRL' }), row('2026-10-02T12:00:00Z', 'PADARIA EXEMPLO', 20, { localAmount: '100.74', localCurrency: 'BRL' })], null)] });
setFormatLocale('pt');
const approx = approxHome(brl.transactions, fxSummary(brl));
setFormatLocale('en');
check('≈ R$ 151 (sem centavos)', approx === '≈ R$ 151', approx ?? '');

console.log('\n== D8 e rótulos: categorias fora do Brasil ==');
const cat = (raw: string, source?: string) => describeMerchant(raw, source, 'en').category;
const CASES: [string, string | undefined, string][] = [
  ['DOORDASH*CHIPOTLE', 'Rideshare & Delivery', CATEGORY.delivery], ['DELIVEROO', 'Rideshare & Delivery', CATEGORY.delivery],
  ['GRUBHUB*BURGERS', undefined, CATEGORY.delivery], ['INSTACART*HEB', undefined, CATEGORY.delivery], ['GLOVO*PEDIDO', undefined, CATEGORY.delivery],
  ['JUST EAT ORDER', undefined, CATEGORY.delivery], ['BOLT FOOD', 'Rideshare & Delivery', CATEGORY.delivery], ['BOLT.EU/O/2603', 'Rideshare & Delivery', CATEGORY.transport],
  ['LYFT *RIDE TUE 8PM', 'Rideshare & Delivery', CATEGORY.transport], ['WALMART SUPERCENTER #1234', undefined, CATEGORY.groceries],
  ['WHOLE FOODS MARKET #10', undefined, CATEGORY.groceries], ['CVS/PHARMACY #08123', undefined, CATEGORY.health], ['WALGREENS #4411', undefined, CATEGORY.health],
  ['CHEVRON 0091234', undefined, CATEGORY.transport], ['SHELL OIL 5744', undefined, CATEGORY.transport], ['COSTCO GAS #0123', undefined, CATEGORY.transport],
  ['VERIZON WIRELESS PAYMENT', undefined, CATEGORY.phone], ['AT&T BILL PAYMENT', undefined, CATEGORY.phone], ['T-MOBILE POSTPAID', undefined, CATEGORY.phone],
  ['LIDL DIENSTL 4521', undefined, CATEGORY.groceries], ['REWE MARKT GMBH', undefined, CATEGORY.groceries], ['ALDI SUED', undefined, CATEGORY.groceries],
  ['TESCO STORES 2041', undefined, CATEGORY.groceries], ['CARREFOUR CITY', undefined, CATEGORY.groceries], ['MERCADONA VALENCIA', undefined, CATEGORY.groceries],
  ['APOTHEKE AM MARKT', undefined, CATEGORY.health], ['FARMACIA CENTRAL', undefined, CATEGORY.health], ['CORNER GROCERY', undefined, CATEGORY.groceries],
  ['CITY SUPERMARKET', undefined, CATEGORY.groceries], ['QUICK GAS 12', undefined, CATEGORY.transport], ['TANKSTELLE NORD', undefined, CATEGORY.transport],
  ['NORTH WIRELESS', undefined, CATEGORY.phone], ['BILT RENT PMT', undefined, CATEGORY.home], ['EUROPCAR RENT A CAR', undefined, CATEGORY.travel],
  ['TST* LITTLE DINER', undefined, CATEGORY.dining], ['CAFE DE FLORE', undefined, CATEGORY.dining], ['BRITISH MUSEUM', undefined, CATEGORY.leisure],
  ['MERCADO DO BAIRRO', undefined, CATEGORY.groceries], ['MERCADO PAGO*EXEMPLO', undefined, CATEGORY.other], ['MERCADOLIVRE*VENDEDOR', undefined, CATEGORY.shopping],
];
const wrong = CASES.filter(([raw, source, want]) => cat(raw, source) !== want);
check(`${CASES.length} descritores dos EUA e da Europa na categoria certa`, !wrong.length, wrong.map(([raw, source]) => `${raw} → ${cat(raw, source)}`).join('; '));
check('regra só de categoria guarda o nome do descritor', describeMerchant('COSTCO GAS #0123', undefined, 'en').name === 'Costco Gas' && describeMerchant('TST* LITTLE DINER', undefined, 'en').name === 'Little Diner');
check('"constructor" no descritor não quebra o nome', describeMerchant('CONSTRUCTOR SUPPLY', undefined, 'en').name === 'Constructor Supply');
check('rótulos: PT Varejo, EN Home & garden, EN Food delivery', categoryLabel('shopping', 'pt') === 'Varejo' && categoryLabel('home', 'en') === 'Home & garden' && categoryLabel('delivery', 'en') === 'Food delivery' && categoryLabel('delivery', 'pt') === 'Delivery');

console.log('\n== P3/P4: regras locais (merchant-rules.json) ==');
const sample: MerchantRulesFile = {
  rules: [
    { match: '^PADARIA SOL', name: 'Padaria Sol', category: 'dining', brand: 'Sol' },
    { match: 'SERVICO EXEMPLO', name: { en: 'Example service', pt: 'Serviço exemplo' }, category: 'software', subscription: true },
    { match: 'SEM CATEGORIA EXEMPLO', name: 'Sem Categoria' },
  ],
  accents: { ipe: 'ipê' },
};
// o arquivo é escrito à mão: o que não vale é ignorado, sem derrubar o resto
const loaded = setLocalMerchantRules({
  rules: [...(sample.rules ?? []), { match: '(', name: 'regex inválida' }, { match: 'X', name: 'categoria desconhecida', category: 'nope' }, { match: 'Y' }],
  accents: { ...sample.accents, 'Não-Minúscula': 'x' },
});
check('3 regras válidas, 3 ignoradas, 1 acento', loaded.rules === 3 && loaded.skipped === 3 && loaded.accents === 1, JSON.stringify(loaded));
const sol = describeMerchant('PADARIA SOL NASCENTE', undefined, 'en');
check('regra local vence e dá nome, marca e categoria', sol.name === 'Padaria Sol' && sol.brand === 'Sol' && sol.category === CATEGORY.dining);
check('regra local nas duas línguas e com dica de assinatura', describeMerchant('SERVICO EXEMPLO*123', undefined, 'pt').name === 'Serviço exemplo' && describeMerchant('SERVICO EXEMPLO*123', undefined, 'en').subscription);
check('regra local sem categoria: vale a da fonte', describeMerchant('SEM CATEGORIA EXEMPLO', 'Groceries', 'en').category === CATEGORY.groceries);
check('regra local também nomeia o pedido IFD*', describeMerchant('IFD*PADARIA SOL', undefined, 'en').name === 'Padaria Sol · via iFood');
check('acento local no nome limpo', describeMerchant('PADARIA IPE AMARELO', undefined, 'pt').name === 'Padaria Ipê Amarelo');
const withRules = enrichDataset({ ...build({ pages: [page([row('2026-10-01T12:00:00Z', 'PADARIA SOL NASCENTE', 5)], null)] }), merchantRules: sample });
check('enrichDataset aplica as regras do dataset', withRules.transactions[0].merchant === 'Padaria Sol');
const without = enrichDataset({ ...withRules, merchantRules: undefined });
check('dataset sem regras (demo) volta às públicas', without.transactions[0].merchant === 'Padaria Sol Nascente' && setLocalMerchantRules(undefined).rules === 0);
check('arquivo que não é objeto não quebra nada', setLocalMerchantRules('lixo').rules === 0 && setLocalMerchantRules([{ match: 1 }]).skipped === 1);
setLocalMerchantRules(undefined);

console.log('\n== portfólio: conta, carteira e LTV no formato cru ==');
const acct = (extra: Raw = {}): Raw => ({
  hasVault: true, accountLabel: 'Conta exemplo', address: '0xEXEMPLO', currency: 'USD',
  totalBalance: '100', availableBalance: '80', creditLimit: '50', borrowed: '5', tradingPositionsIncluded: true, ...extra,
});
const pf = (extra: Raw = {}): Raw => ({
  hasVault: true, tradingPositionsIncluded: true, unrenderableAssetCount: 0,
  groups: [{ id: 'liquidVaults', label: 'Liquid vaults' }, { id: 'crypto', label: 'Crypto' }],
  holdings: [
    { symbol: 'AAA', name: 'Ativo A', valueUsd: '60', collateral: true, apy: 5, groupId: 'liquidVaults', chainId: 10, quantity: null },
    { symbol: 'BBB', name: 'Ativo B', valueUsd: '40', collateral: false, apy: 0, groupId: 'crypto', chainId: 10, quantity: { amount: '4000000', decimals: 6, symbol: 'BBB' } },
  ],
  ...extra,
});
const dep = (assets: Raw[]): Raw => ({
  hasVault: true, address: '0xEXEMPLO', networks: ['optimism'],
  supportedAssets: assets.map((a) => ({ name: String(a.symbol), decimals: 18, contracts: [{ network: 'optimism', address: '0xC' }], ...a })),
});
const noTx = [page([], null)];
const full = build({ pages: noTx, account: acct(), portfolio: pf(), deposit: dep([{ symbol: 'AAA', ltv: '0.8' }, { symbol: 'BBB', ltv: '0.5' }]) });
check('conta: accountLabel e poder de compra (availableBalance) lidos; saldo completo', full.account.accountLabel === 'Conta exemplo' && full.account.availableBalance === 80 && full.account.balancePartial === undefined);
check('conta sem availableBalance: poder de compra ausente, não zero', build({ pages: noTx, account: acct({ availableBalance: undefined }) }).account.availableBalance === undefined);
check('conta antiga com spendingPower: vira o poder de compra', build({ pages: noTx, account: { totalBalance: '10', spendingPower: '7', creditLimit: '0', borrowed: '0' } }).account.availableBalance === 7);
check('conta: tradingPositionsIncluded false marca só o saldo como parcial', build({ pages: noTx, account: acct({ tradingPositionsIncluded: false }) }).account.balancePartial === true);
check('carteira: grupos, grupo e rede de cada ativo', JSON.stringify(full.portfolio.groups?.map((g) => g.id)) === '["liquidVaults","crypto"]'
  && full.portfolio.holdings.every((h) => h.groupId && h.chainId === 10));
check('carteira: tradingIncluded como veio; sem não listados, sem contagem', full.portfolio.tradingIncluded === true && full.portfolio.unrenderableCount === undefined && !full.portfolio.partial);
const unr = build({ pages: noTx, portfolio: pf({ unrenderableAssetCount: 2 }) });
check('carteira: unrenderableAssetCount fica como contagem e marca a lista como parcial', unr.portfolio.unrenderableCount === 2 && unr.portfolio.partial === true);
check('carteira sem holdings: groups[] não vira lista de ativos', build({ pages: noTx, portfolio: pf({ holdings: undefined }) }).portfolio.holdings.length === 0);
check('LTV: símbolo exato, como fração', full.portfolio.holdings.map((h) => h.ltv).join() === '0.8,0.5');
const ltvOf = (assets: Raw[]) => build({ pages: noTx, portfolio: pf(), deposit: dep(assets) }).portfolio.holdings[0].ltv;
check('LTV: o mesmo símbolo com valores diferentes fica de fora', ltvOf([{ symbol: 'AAA', ltv: '0.8' }, { symbol: 'AAA', ltv: '0.7' }]) === undefined);
check('LTV: o mesmo símbolo repetido com o mesmo valor vale', ltvOf([{ symbol: 'AAA', ltv: '0.8' }, { symbol: 'AAA', ltv: '0.8' }]) === 0.8);
check('LTV: fora de 0–1 fica de fora; 0 vale', ltvOf([{ symbol: 'AAA', ltv: '75' }]) === undefined && ltvOf([{ symbol: 'AAA', ltv: '0' }]) === 0);
check('LTV: símbolo com outra caixa não casa', ltvOf([{ symbol: 'aaa', ltv: '0.8' }]) === undefined);
check('LTV: sem get_deposit_address, nenhum', build({ pages: noTx, portfolio: pf() }).portfolio.holdings.every((h) => h.ltv === undefined));
check('fontes: o que veio fica true, o que faltou false', JSON.stringify(full.sources) === JSON.stringify({
  list_transactions: true, list_cards: false, get_main_account: true, get_portfolio: true, get_deposit_address: true,
}));
check('fontes: carteira vazia continua "veio"', build({ pages: noTx, portfolio: pf({ holdings: [] }) }).sources?.get_portfolio === true);
check('fontes: sem nenhuma página, o extrato não veio', build({ account: acct() }).sources?.list_transactions === false);
check('retrato do saldo: snapshotAt passa como veio; sem ele, ausente',
  assembleDataset({ referenceDate: '2026-10-18', mainAccount: acct(), snapshotAt: '2026-10-18T12:00:00.000Z' }).dataset.snapshotAt === '2026-10-18T12:00:00.000Z'
  && full.snapshotAt === undefined);

// a pasta de dados reais vem do mesmo resolvedor do pull e do vite.config (scripts/data-dir.mjs)
const data = resolveDataDir();
const dir = data.url;
if (!existsSync(dir)) {
  console.log(`\n(sem dados reais em ${data.label}: pulando)`);
} else {
  console.log(`\n== dados reais de ${data.label} pelo pipeline (invariantes) ==`);
  const files = readdirSync(dir).filter(isDataFile).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const pages = files.filter((f) => f.startsWith('list_transactions')).map(read);
  const paged: Record<string, unknown>[] = pages.flatMap((p) => p.transactions);
  // a paginação do conector repete linhas na virada de página; o esperado é contar cada id uma vez
  const rawTx = [...new Map(paged.map((t) => [String(t.id), t])).values()];
  const one = (name: string) => (files.includes(`${name}.json`) ? read(`${name}.json`) : undefined);
  const { dataset: assembled } = assembleDataset({
    referenceDate: rawTx.map((t) => String(t.date)).sort().at(-1)!.slice(0, 10),
    // as páginas como o conector manda: o normalize junta, deduplica e lê incomplete de todas
    transactionPages: pages,
    cards: one('list_cards'),
    mainAccount: one('get_main_account'),
    portfolio: one('get_portfolio'),
    deposit: one('get_deposit_address'),
  });
  const rulesFile = one('merchant-rules');
  const live = enrichDataset({ ...assembled, merchantRules: rulesFile });
  const rulesLoaded = setLocalMerchantRules(rulesFile);
  // só contagens: as regras locais são pessoais
  if (rulesFile) console.log(`  (regras locais: ${rulesLoaded.rules} regras, ${rulesLoaded.accents} acentos, ${rulesLoaded.skipped} ignoradas)`);
  check('regras locais: nenhuma linha do arquivo ignorada', !rulesFile || rulesLoaded.skipped === 0);

  const NOT_SPENT = new Set(['VOID', 'DECLINED']);
  const cardRows = rawTx.filter((t) => t.type === 'rain_transaction' && !NOT_SPENT.has(String(t.status)));
  const expected = R2(cardRows.reduce((s, t) => s + Number(t.amount), 0));
  const got = R2(live.transactions.filter(isSpend).reduce((s, t) => s + t.amountUsd, 0));
  check('linhas repetidas entre páginas contam uma vez', live.transactions.length === rawTx.length, `${live.transactions.length} vs ${rawTx.length} (${paged.length} com repetição)`);
  // só a diferença na saída: o total real é dado pessoal
  check('gasto = soma das compras do cartão não canceladas nem recusadas (estorno abate)', got === expected, got === expected ? '' : `diferença ${R2(got - expected)}`);
  check('todo tipo do conector tem tradução (nada cai em "other" sem querer)', live.transactions.every((t) => t.type !== 'other'), [...new Set(rawTx.filter((r) => live.transactions.find((t) => t.id === r.id)?.type === 'other').map((r) => String(r.type)))].join(', '));
  check('nenhum depósito/aplicação/cripto conta como compra', live.transactions.filter((t) => t.type === 'purchase').length === rawTx.filter((t) => t.type === 'rain_transaction').length);
  check('cancelada fica fora do gasto', live.transactions.filter((t) => t.status === 'void').every((t) => !isSpend(t)));
  check('toda compra com cartão casa com um cartão', live.transactions.filter((t) => t.cardId).every((t) => live.cards.some((c) => c.id === t.cardId)));
  const localCounts = new Map<string, number>();
  for (const t of cardRows) localCounts.set(String(t.localCurrency), (localCounts.get(String(t.localCurrency)) ?? 0) + 1);
  const topLocal = [...localCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  check('moeda da casa = moeda local mais frequente', live.homeCurrency === topLocal, `${live.homeCurrency} vs ${topLocal}`);
  check('cobertura marcada como incompleta quando há nextPage', live.coverage?.complete === (pages.at(-1)?.nextPage == null));
  check('droppedRows = alguma página com incomplete', Boolean(live.coverage?.droppedRows) === pages.some((p) => p.incomplete === true));
  check('hasVault lido: neverFunded só quando a fonte diz false', live.neverFunded === ([one('get_main_account'), one('get_portfolio'), one('get_deposit_address')].some((r) => r?.hasVault === false) || undefined));
  const coverageDays = live.coverage ? (Date.parse(live.coverage.to) - Date.parse(live.coverage.from)) / 86400000 : 0;
  const liveAlerts = detectAnomalies(live, detectSubscriptions(live));
  check('sem "primeira vez" com menos de 60 dias de histórico', coverageDays >= 60 || !liveAlerts.some((a) => a.kind === 'first_time'));
  check('meses fora da cobertura não contam como inteiros', monthEvolutions(live, []).filter(isFullMonth).every((m) => m.covered));
  check('depósito: rede de cada ativo está na lista de redes', (live.deposit.assetNetworks ?? []).every((a) => a.networks.every((n) => live.deposit.networks.includes(n))));
  check('conta: saldo total lido', live.account.totalBalance !== undefined);

  // portfólio: só relações, sem número nenhum na saída
  const rawAccount = one('get_main_account');
  const rawPortfolio = one('get_portfolio');
  if (rawAccount && rawPortfolio) {
    check('conta: poder de compra lido quando a fonte manda availableBalance', ('availableBalance' in rawAccount) === (live.account.availableBalance !== undefined));
    check('conta: accountLabel lido quando a fonte manda', Boolean(rawAccount.accountLabel) === Boolean(live.account.accountLabel));
    check('conta: saldo parcial = tradingPositionsIncluded false', Boolean(live.account.balancePartial) === (rawAccount.tradingPositionsIncluded === false));
    check('carteira: todo grupo dos ativos está na lista de grupos', live.portfolio.holdings.every((h) => !h.groupId || (live.portfolio.groups ?? []).some((g) => g.id === h.groupId)));
    check('carteira: LTV, quando casou, é fração', live.portfolio.holdings.every((h) => h.ltv === undefined || (h.ltv >= 0 && h.ltv <= 1)));
    const ps = portfolioSummary(live);
    const listComplete = rawPortfolio.tradingPositionsIncluded !== false && !(Number(rawPortfolio.unrenderableAssetCount) > 0) && rawAccount.tradingPositionsIncluded !== false;
    check('saldo vem da conta', ps.totalSource === 'account');
    check('lista completa: a soma dos ativos é o saldo (nada não detalhado)', !listComplete || (Math.abs(ps.listedTotal - ps.total) < 0.01 && ps.unlisted === 0));
    check('motivos de parcial batem com os flags da fonte', ps.partialReasons.includes('trading') === (rawAccount.tradingPositionsIncluded === false || rawPortfolio.tradingPositionsIncluded === false)
      && ps.partialReasons.includes('unrenderable') === (Number(rawPortfolio.unrenderableAssetCount) > 0));
    check('grupos: frações somam 1', !ps.groups.length || Math.abs(ps.groups.reduce((s, g) => s + g.share, 0) - 1) < 1e-9);
    check('poder de compra é o availableBalance, não limite − emprestado', ps.spendingPower === (live.account.availableBalance ?? null));
    // classes: só contagens na saída (os símbolos da carteira são da pessoa)
    const unclassified = live.portfolio.holdings.filter((h) => assetClassOf(h).cls === 'other').length;
    check('classes: todo ativo da carteira tem classe (nenhum em "outros")', unclassified === 0, unclassified ? `${unclassified} ativo(s)` : '');
    check('classes: frações somam 1 e cobrem a mesma soma dos grupos', !ps.classes.length || (Math.abs(ps.classes.reduce((s, c) => s + c.share, 0) - 1) < 1e-9
      && Math.abs(ps.classes.reduce((s, c) => s + c.value, 0) - ps.groups.reduce((s, g) => s + g.value, 0)) < 0.02));
    check('cofre = grupo liquidVaults ou símbolo liquid*', live.portfolio.holdings.every((h) => Boolean(h.vault) === (h.groupId === 'liquidVaults' || /^liquid/i.test(h.asset))));
  }
  const rawDeposit = one('get_deposit_address');
  if (rawDeposit && Array.isArray(rawDeposit.supportedAssets)) {
    const catalog = rawDeposit.supportedAssets as { symbol: string; name?: string }[];
    const notKnown = catalog.filter((a) => assetClassOf({ asset: a.symbol, name: a.name }).basis !== 'known').length;
    check('classes: todo ativo que a conta aceita está na tabela (com fonte)', notKnown === 0, notKnown ? `${notKnown} de ${catalog.length} fora da tabela` : '');
  }
  const fx = recentFx(live);
  if (live.homeCurrency && live.homeCurrency !== 'USD') {
    const homeCharges = live.transactions.filter((t) => t.type === 'purchase' && t.status === 'settled' && t.currency === live.homeCurrency && t.amount > 0 && t.amountUsd > 0);
    const rates = homeCharges.map((t) => t.amount / t.amountUsd);
    check('câmbio recente: amostra mínima e período dentro do histórico', !homeCharges.length || (fx !== null && fx.count >= RECENT_FX_MIN && fx.from <= fx.to && fx.to <= live.referenceDate));
    check('câmbio recente entre o menor e o maior câmbio das compras', fx === null || (fx.localPerUsd >= Math.min(...rates) - 1e-9 && fx.localPerUsd <= Math.max(...rates) + 1e-9));
  } else check('casa em USD: sem câmbio recente', fx === null);
}

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
