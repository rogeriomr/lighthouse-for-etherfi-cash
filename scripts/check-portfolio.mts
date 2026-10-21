// Os estados da tela Portfólio, montados no formato cru do conector (dados fictícios) e passados pelo mesmo caminho do
// app (rawFiles/assembleDataset → enrichDataset → portfolioSummary / recentFx): conta sem depósito, carteira vazia,
// ferramenta que falhou, arquivo que faltou na importação, ativos não listados, saldo sem posições de trading, só
// stablecoin, carteira sem grupos, o câmbio recente (e quando ele some) e o demo.
import { demoDataset } from '../src/lib/demo/dataset.ts';
import { enrichDataset } from '../src/lib/enrich.ts';
import { assembleDataset } from '../src/lib/normalize.ts';
import { bundleFromFiles, datasetFromBundle } from '../src/lib/rawFiles.ts';
import {
  creditUsage, fxSummary, portfolioSummary, recentFx, RECENT_FX_DAYS, RECENT_FX_MAX_AGE_DAYS, RECENT_FX_MIN, sourceCame,
} from '../src/lib/analytics.ts';
import { ASSET_CLASSES, assetClassOf, isVault, KNOWN_ASSETS, type AssetClass } from '../src/lib/assetClass.ts';
import { assetClassLabel } from '../src/lib/labels.ts';

declare const process: { exit(code: number): never };

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const R2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;
const REF = '2026-10-18';

type Raw = Record<string, unknown>;
const acct = (extra: Raw = {}): Raw => ({
  hasVault: true, accountLabel: 'Conta exemplo', address: '0xEXEMPLO', currency: 'USD',
  totalBalance: '1000', availableBalance: '700', creditLimit: '800', borrowed: '200', tradingPositionsIncluded: true, ...extra,
});
const GROUPS = [{ id: 'liquidVaults', label: 'Liquid vaults' }, { id: 'value-accruing', label: 'Staking' }, { id: 'crypto', label: 'Crypto' }];
const holding = (symbol: string, value: number, groupId: string, extra: Raw = {}): Raw => ({
  // `vault` cru como o conector manda: o nome do cofre da conta, não "é cofre Liquid"
  symbol, name: `Ativo ${symbol}`, valueUsd: String(value), collateral: true, apy: 0, groupId, chainId: 10, quantity: null, vault: 'cash', ...extra,
});
const HOLDINGS = [
  holding('AAA', 500, 'liquidVaults', { apy: 6 }),
  holding('BBB', 300, 'value-accruing', { apy: 3 }),
  holding('CCC', 150, 'crypto'),
  holding('DDD', 50, 'crypto', { collateral: false }),
];
const pf = (extra: Raw = {}): Raw => ({ hasVault: true, tradingPositionsIncluded: true, unrenderableAssetCount: 0, groups: GROUPS, holdings: HOLDINGS, ...extra });
const build = (parts: { account?: Raw; portfolio?: Raw; deposit?: Raw; rows?: Raw[] }) => enrichDataset(assembleDataset({
  referenceDate: REF,
  transactionPages: parts.rows ? [{ transactions: parts.rows, nextPage: null }] : undefined,
  mainAccount: parts.account, portfolio: parts.portfolio, deposit: parts.deposit,
}).dataset);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

console.log('== conta completa ==');
const ok = build({ account: acct(), portfolio: pf() });
const s = portfolioSummary(ok, 'pt');
check('saldo da conta, nada parcial', s.total === 1000 && s.totalSource === 'account' && !s.totalPartial && s.partialReasons.length === 0);
check('grupos do maior para o menor, frações somando 1', s.groups.map((g) => g.id).join() === 'liquidVaults,value-accruing,crypto'
  && Math.abs(sum(s.groups.map((g) => g.share)) - 1) < 1e-9 && s.groups[0].share === 0.5);
check('rótulos em português; em inglês, o da fonte', s.groups.map((g) => g.label).join() === 'Cofres Liquid,Staking,Cripto'
  && portfolioSummary(ok, 'en').groups.map((g) => g.label).join() === 'Liquid vaults,Staking,Crypto');
check('ativos do grupo do maior para o menor', s.groups[2].holdings.map((h) => h.asset).join() === 'CCC,DDD');
check('rendimento estimado só dos ativos com APY', s.yield.earning === 800 && s.yield.annual === R2(500 * 0.06 + 300 * 0.03));
check('poder de compra = availableBalance; limite, emprestado e uso à parte', s.spendingPower === 700 && s.creditLimit === 800 && s.borrowed === 200 && s.utilization === 25);
check('nada somado ao saldo: o total não muda com o crédito', portfolioSummary(build({ account: acct({ borrowed: '600', availableBalance: '200' }), portfolio: pf() })).total === 1000);
check('lista completa: nada não detalhado', s.listedTotal === 1000 && s.unlisted === 0);

console.log('\n== conta sem depósito (hasVault false) ==');
const unfunded = build({ account: { hasVault: false }, portfolio: { hasVault: false, holdings: [] }, deposit: { hasVault: false } });
const su = portfolioSummary(unfunded);
check('neverFunded marcado; um estado normal, não falta de fonte', unfunded.neverFunded === true && !su.partialReasons.includes('portfolio_missing') && !su.partialReasons.includes('account_missing'));
check('sem grupos, sem poder de compra inventado, sem crédito', su.groups.length === 0 && su.spendingPower === null && su.creditLimit === 0 && su.utilization === 0);

console.log('\n== carteira vazia × carteira ausente ==');
const empty = portfolioSummary(build({ account: acct(), portfolio: pf({ holdings: [] }) }));
check('vazia: a ferramenta veio, nenhum grupo, nenhum motivo de parcial', empty.groups.length === 0 && empty.partialReasons.length === 0 && empty.total === 1000);
const noPortfolio = build({ account: acct() });
const np = portfolioSummary(noPortfolio);
check('ausente (falhou ou não veio): marcada como ausente, não como vazia', !sourceCame(noPortfolio, 'get_portfolio') && np.partialReasons.join() === 'portfolio_missing');
check('ausente: o saldo da conta continua; nada "não detalhado" inventado', np.total === 1000 && np.totalSource === 'account' && np.unlisted === 0);

console.log('\n== conta ausente ==');
const noAccount = build({ portfolio: pf() });
const na = portfolioSummary(noAccount);
check('saldo = soma da lista, marcado como parcial', na.totalSource === 'holdings' && na.total === 1000 && na.totalPartial && na.partialReasons.join() === 'account_missing');
check('sem poder de compra, limite nem uso', na.spendingPower === null && na.creditLimit === 0 && na.borrowed === 0 && na.utilization === 0);
check('sem nenhuma das duas: zero, com os dois motivos', portfolioSummary(build({ rows: [] })).partialReasons.join() === 'portfolio_missing,account_missing');
check('poder de compra ausente na resposta: null, não zero', portfolioSummary(build({ account: acct({ availableBalance: undefined }), portfolio: pf() })).spendingPower === null);

console.log('\n== ativos não listados e posições de trading ==');
const unr = portfolioSummary(build({ account: acct({ totalBalance: '1250' }), portfolio: pf({ unrenderableAssetCount: 2 }) }));
check('não listados: contagem, motivo e o saldo que a lista não detalha', unr.unrenderableCount === 2 && unr.partialReasons.join() === 'unrenderable' && unr.unlisted === 250 && unr.listedTotal === 1000);
check('não listados: o saldo da conta é completo; as frações são da lista', !unr.totalPartial && unr.total === 1250 && Math.abs(sum(unr.groups.map((g) => g.share)) - 1) < 1e-9);
const tradeAcct = portfolioSummary(build({ account: acct({ tradingPositionsIncluded: false }), portfolio: pf() }));
check('trading fora do saldo da conta: o próprio saldo é parcial', tradeAcct.totalPartial && tradeAcct.partialReasons.join() === 'trading');
const tradeList = portfolioSummary(build({ account: acct(), portfolio: pf({ tradingPositionsIncluded: false }) }));
check('trading fora só da lista: saldo completo, lista parcial', !tradeList.totalPartial && tradeList.partialReasons.join() === 'trading');
check('trading fora não muda poder de compra, limite nem emprestado', tradeAcct.spendingPower === 700 && tradeAcct.creditLimit === 800 && tradeAcct.borrowed === 200);

console.log('\n== composição: só stablecoin, sem grupos, grupo desconhecido ==');
const stable = portfolioSummary(build({ account: acct(), portfolio: pf({ holdings: [holding('USDC', 600, 'crypto'), holding('USDT', 400, 'crypto')] }) }));
check('só stablecoin num grupo: um grupo, fração 1, rendimento zero', stable.groups.length === 1 && stable.groups[0].share === 1 && stable.yield.monthly === 0 && stable.yield.earning === 0);
const noGroups = portfolioSummary(build({ account: acct(), portfolio: pf({ groups: undefined }) }), 'pt');
check('fonte sem grupos: um grupo só ("Ativos") com tudo', noGroups.groups.length === 1 && noGroups.groups[0].id === 'all' && noGroups.groups[0].label === 'Ativos' && noGroups.groups[0].holdings.length === 4);
const odd = portfolioSummary(build({ account: acct(), portfolio: pf({ holdings: [...HOLDINGS, holding('EEE', 10, 'novoGrupo'), holding('FFF', 5, '')] }) }), 'pt');
check('ativo com grupo que a fonte não listou (ou sem grupo): "Outros"', odd.groups.some((g) => g.id === 'other' && g.label === 'Outros' && g.holdings.length === 2));
const zero = portfolioSummary(build({ account: acct(), portfolio: pf({ holdings: [...HOLDINGS, holding('ZZZ', 0, 'novoGrupo')] }) }));
check('grupo só com saldo zero não aparece', !zero.groups.some((g) => g.id === 'other'));

console.log('\n== crédito ==');
const cu = creditUsage(ok.account);
check('crédito livre = limite − emprestado (conta do painel); uso em %', cu.free === 600 && cu.utilization === 25);
check('crédito livre não é o poder de compra', cu.free !== ok.account.availableBalance);
check('sem limite: tudo zero', JSON.stringify(creditUsage(build({ account: acct({ creditLimit: '0', borrowed: '0' }) }).account)) === JSON.stringify({ utilization: 0, free: 0 }));

console.log('\n== câmbio recente ==');
let seq = 0;
const buy = (daysBefore: number, brl: number, usd: number, extra: Raw = {}): Raw => ({
  id: `b${++seq}`, date: new Date(Date.parse(`${REF}T15:00:00Z`) - daysBefore * DAY).toISOString(), type: 'rain_transaction', status: 'CLEARED',
  merchant: 'LOJA EXEMPLO', cardLast4: '1111', amount: String(usd), currency: 'USD', localAmount: String(brl), localCurrency: 'BRL', ...extra,
});
// 10 compras antigas a 5,0 e 6 recentes a 5,5: o recente fica no 5,5; a média do histórico, no meio
const mixed = build({ rows: [...Array.from({ length: 10 }, (_, i) => buy(200 + i, 500, 100)), ...Array.from({ length: 6 }, (_, i) => buy(5 + i * 10, 550, 100))] });
const fx = recentFx(mixed);
check('usa só as compras dos últimos dias, não a média do histórico', fx !== null && Math.abs(fx.localPerUsd - 5.5) < 1e-9 && fx.count === 6
  && Math.abs((fxSummary(mixed)?.localPerUsd ?? 0) - 5.5) > 0.1, fx ? String(fx.localPerUsd) : 'null');
check('moeda, período e contagem', fx?.currency === 'BRL' && fx.from === new Date(Date.parse(`${REF}T15:00:00Z`) - 55 * DAY).toISOString().slice(0, 10) && fx.to === new Date(Date.parse(`${REF}T15:00:00Z`) - 5 * DAY).toISOString().slice(0, 10));
check(`janela de ${RECENT_FX_DAYS} dias: a compra de ${RECENT_FX_DAYS} dias atrás já não entra`, recentFx(build({ rows: [
  ...Array.from({ length: RECENT_FX_MIN }, (_, i) => buy(i + 1, 550, 100)), buy(RECENT_FX_DAYS, 900, 100),
] }))?.count === RECENT_FX_MIN);
const few = recentFx(build({ rows: [...Array.from({ length: 3 }, (_, i) => buy(i + 1, 550, 100)), ...Array.from({ length: 4 }, (_, i) => buy(150 + i, 500, 100))] }));
check(`poucas no período: as últimas ${RECENT_FX_MIN}, com o período dito`, few?.count === RECENT_FX_MIN && few.from === new Date(Date.parse(`${REF}T15:00:00Z`) - 151 * DAY).toISOString().slice(0, 10)
  && Math.abs(few.localPerUsd - (3 * 550 + 2 * 500) / 500) < 1e-9);
check(`compras com mais de ${RECENT_FX_MAX_AGE_DAYS} dias não contam: sem amostra, null`, recentFx(build({ rows: Array.from({ length: 8 }, (_, i) => buy(RECENT_FX_MAX_AGE_DAYS + 1 + i, 500, 100)) })) === null);
check(`menos de ${RECENT_FX_MIN} compras: null`, recentFx(build({ rows: Array.from({ length: RECENT_FX_MIN - 1 }, (_, i) => buy(i + 1, 550, 100)) })) === null);
const noisy = recentFx(build({ rows: [
  ...Array.from({ length: 5 }, (_, i) => buy(i + 1, 550, 100)),
  buy(2, 9999, 100, { status: 'PENDING' }), buy(3, 9999, 100, { status: 'VOID' }), buy(4, 9999, 100, { status: 'DECLINED' }), buy(5, 9999, 100, { status: 'REFUND' }),
] }));
check('pendente, cancelada, recusada e estorno ficam fora', noisy?.count === 5 && Math.abs(noisy.localPerUsd - 5.5) < 1e-9);
check('peso pelo valor (Σ local ÷ Σ USD)', Math.abs((recentFx(build({ rows: [buy(1, 600, 100), buy(2, 50, 10), buy(3, 50, 10), buy(4, 50, 10), buy(5, 50, 10)] }))?.localPerUsd ?? 0) - 800 / 140) < 1e-9);
check('casa em USD: null', recentFx(build({ rows: Array.from({ length: 8 }, (_, i) => buy(i + 1, 100, 100, { localCurrency: 'USD' })) })) === null);
check('sem compras: null', recentFx(build({ account: acct() })) === null);

console.log('\n== importação: arquivos faltando e data do retrato ==');
const file = (name: string, json: Raw, modified?: number) => ({ name, json, modified });
const T = Date.parse('2026-10-18T14:05:00Z');
const onlyTx = datasetFromBundle(bundleFromFiles([file('list_transactions.page1.json', { transactions: [buy(1, 550, 100)], nextPage: null }, T)]).bundle, REF);
const onlyTxSummary = portfolioSummary(enrichDataset(onlyTx));
check('só o extrato importado: conta e carteira marcadas como ausentes', onlyTx.sources?.list_transactions === true && onlyTx.sources.get_portfolio === false && onlyTx.sources.get_main_account === false
  && onlyTxSummary.partialReasons.join() === 'portfolio_missing,account_missing');
check('só o extrato importado: sem data do retrato do saldo', onlyTx.snapshotAt === undefined);
const pulled = bundleFromFiles([
  file('get_main_account.json', acct(), T - 60000),
  file('get_portfolio.json', pf(), T),
  file('list_transactions.page1.json', { transactions: [], nextPage: null }, T + 3 * DAY),
]);
check('retrato = modificação mais recente da conta e da carteira, não a do extrato', datasetFromBundle(pulled.bundle, REF).snapshotAt === new Date(T).toISOString());
check('arquivo sem data: retrato ausente', datasetFromBundle(bundleFromFiles([file('get_main_account.json', acct())]).bundle, REF).snapshotAt === undefined);
const failedTool = assembleDataset({ referenceDate: REF, mainAccount: acct(), portfolio: undefined, deposit: undefined }).dataset;
check('modo conectado, ferramenta que falhou (resposta undefined): ausente', failedTool.sources?.get_portfolio === false && failedTool.sources.get_deposit_address === false);

console.log('\n== classes de ativo ==');
// o catálogo da ether.fi Cash (get_deposit_address.supportedAssets: símbolo e nome como o conector manda), público
const CATALOG: [symbol: string, name: string, cls: AssetClass, currency?: string][] = [
  ['USDC', 'USDC', 'fiat', 'USD'], ['USDT', 'USDT', 'fiat', 'USD'], ['USDT0', 'USDT0', 'fiat', 'USD'], ['EURC', 'EURC', 'fiat', 'EUR'],
  ['eUSD', 'eUSD', 'fiat', 'USD'], ['frxUSD', 'frxUSD', 'fiat', 'USD'], ['ZCHF', 'Swiss Franc', 'fiat', 'CHF'], ['liquidUSD', 'Liquid USD', 'fiat', 'USD'],
  ['liquidReserve', 'Liquid Reserve', 'fiat', 'USD'],
  ['WETH', 'WETH', 'crypto'], ['weETH', 'weETH', 'crypto'], ['liquidETH', 'Liquid ETH', 'crypto'], ['eBTC', 'eBTC', 'crypto'], ['liquidBTC', 'Liquid BTC', 'crypto'],
  ['ETHFI', 'ETHFI', 'crypto'], ['sETHFI', 'sETHFI', 'crypto'], ['OP', 'OP', 'crypto'], ['WHYPE', 'WHYPE', 'crypto'], ['beHYPE', 'beHYPE', 'crypto'],
  ['wSPYx', 'S&P 500', 'stocks'], ['wQQQx', 'Nasdaq', 'stocks'], ['wTBLLx', 'TBLL', 'bonds'], ['PAXG', 'PAXG', 'commodities'], ['PAXGy', 'PAXGy', 'commodities'],
];
check('o catálogo tem os 24 ativos da ether.fi Cash', CATALOG.length === 24 && new Set(CATALOG.map((c) => c[0])).size === 24);
const wrong = CATALOG.filter(([asset, name, cls, currency]) => {
  const got = assetClassOf({ asset, name });
  return got.cls !== cls || got.currency !== currency || got.basis !== 'known';
});
check('os 24 classificados pela tabela, com a moeda das fiat', wrong.length === 0, wrong.map((w) => w[0]).join(', '));
check('toda entrada da tabela tem fonte (um link)', Object.values(KNOWN_ASSETS).every((k) => /https:\/\//.test(k.source)));
check('liquidReserve: dólar (USDC/USDT → PYUSD no Morpho, pelos termos da ether.fi), e cofre', assetClassOf({ asset: 'liquidReserve' }).currency === 'USD' && isVault({ asset: 'liquidReserve' }));
check('fora do catálogo, da tabela de LTV: liquidEUR em euro, xStocks sem o w', assetClassOf({ asset: 'liquidEUR' }).currency === 'EUR'
  && assetClassOf({ asset: 'SPYx' }).cls === 'stocks' && assetClassOf({ asset: 'TBLLx' }).cls === 'bonds');
const pattern = (asset: string, name?: string) => assetClassOf({ asset, name });
check('padrão no símbolo: USD/EUR/CHF viram fiat com a moeda', pattern('PYUSD').cls === 'fiat' && pattern('PYUSD').currency === 'USD' && pattern('EURe').currency === 'EUR'
  && pattern('XCHF').currency === 'CHF' && pattern('PYUSD').basis === 'pattern');
check('padrão no símbolo: BTC e ETH viram cripto', pattern('cbBTC').cls === 'crypto' && pattern('wstETH').cls === 'crypto' && pattern('cbBTC').basis === 'pattern');
check('padrão no nome, por palavra inteira: "Tether USD" é dólar, não ETH', pattern('XYZ', 'Tether USD').cls === 'fiat' && pattern('XYZ', 'Tether USD').currency === 'USD');
check('padrão no nome: "Wrapped Ether", "Bitcoin" e "Euro Coin"', pattern('ZZZ', 'Wrapped Ether').cls === 'crypto' && pattern('ZZZ', 'Bitcoin').cls === 'crypto' && pattern('ZZZ', 'Euro Coin').currency === 'EUR');
check('sem tabela e sem padrão: other, nunca cripto por chute', ['ARB', 'XAUT0', 'SOL', 'AAPLx', '?'].every((a) => pattern(a).cls === 'other' && pattern(a).basis === 'unknown'));
check('cofre: grupo liquidVaults ou símbolo liquid*', isVault({ asset: 'XYZ', groupId: 'liquidVaults' }) && isVault({ asset: 'liquidETH' }) && !isVault({ asset: 'USDC', groupId: 'crypto' }));
check('normalize marca o cofre e ignora o campo cru "vault" da fonte', build({ portfolio: pf() }).portfolio.holdings.map((h) => Boolean(h.vault)).join() === 'true,false,false,false');
const mixedClasses = build({ account: acct({ totalBalance: '1000' }), portfolio: pf({ holdings: [
  holding('liquidUSD', 400, 'liquidVaults', { apy: 6 }), holding('USDC', 100, 'crypto'), holding('EURC', 200, 'crypto'),
  holding('weETH', 150, 'value-accruing', { apy: 3 }), holding('wSPYx', 80, 'crypto'), holding('PAXG', 50, 'crypto'), holding('ARB', 20, 'crypto'),
] }) });
const cl = portfolioSummary(mixedClasses, 'pt');
check('classes do maior para o menor, frações somando 1', cl.classes.map((c) => c.id).join() === 'fiat,crypto,stocks,commodities,other'
  && Math.abs(sum(cl.classes.map((c) => c.share)) - 1) < 1e-9 && cl.classes[0].value === 700);
check('fiat com as moedas da maior para a menor, no rótulo', JSON.stringify(cl.classes[0].currencies) === '["USD","EUR"]' && cl.classes[0].label === 'Fiat · USD, EUR');
check('USDC e o cofre em dólar ficam em fiat, não em cripto', cl.classes[0].holdings.map((h) => h.asset).join() === 'liquidUSD,EURC,USDC');
check('rótulos em português e inglês', cl.classes.map((c) => c.label).slice(1).join() === 'Cripto,Ações,Commodities,Outros'
  && portfolioSummary(mixedClasses, 'en').classes.map((c) => c.label).join() === 'Fiat · USD, EUR,Crypto,Stocks,Commodities,Other');
check('só as outras classes ficam sem moeda', cl.classes.slice(1).every((c) => c.currencies.length === 0));
check('rótulo das classes sem moeda e de fiat sem moeda conhecida', assetClassLabel('bonds', [], 'pt') === 'Renda fixa' && assetClassLabel('fiat', [], 'en') === 'Fiat');
check('ordem fixa das classes (legenda e cores)', ASSET_CLASSES.join() === 'fiat,crypto,stocks,bonds,commodities,other');
const oneClass = portfolioSummary(build({ account: acct(), portfolio: pf({ holdings: [holding('USDC', 600, 'crypto'), holding('liquidUSD', 400, 'liquidVaults')] }) }));
check('uma classe só (só dólar): uma entrada, fração 1', oneClass.classes.length === 1 && oneClass.classes[0].id === 'fiat' && oneClass.classes[0].share === 1);
check('grupos do app continuam ao lado das classes', oneClass.groups.length === 2);

console.log('\n== demo ==');
const demo = enrichDataset(demoDataset);
const sd = portfolioSummary(demo, 'pt');
check('saldo da conta, sem nada parcial', sd.totalSource === 'account' && sd.partialReasons.length === 0 && !sd.totalPartial && sd.total === demo.account.totalBalance);
check('os 3 grupos, frações somando 1', sd.groups.length === 3 && Math.abs(sum(sd.groups.map((g) => g.share)) - 1) < 1e-9);
check('rendendo e crédito em uso para mostrar', sd.yield.monthly > 0 && sd.utilization > 10 && sd.utilization < 30, `${sd.utilization}%`);
check('poder de compra informado', sd.spendingPower === demo.account.availableBalance && sd.spendingPower !== null);
check('casa em USD: sem câmbio recente (o "≈" não aparece no demo)', recentFx(demo) === null);
check('demo: as 5 classes, da maior para a menor (fiat, cripto, ações, ouro, renda fixa)', sd.classes.map((c) => c.id).join() === 'fiat,crypto,stocks,commodities,bonds', sd.classes.map((c) => c.id).join());
check('demo: US$ 25,561.00 na conta, o número que o vídeo mostra', sd.total === 25561 && sd.listedTotal === 25561 && sd.unlisted === 0, String(sd.total));
const fiatClass = sd.classes.find((c) => c.id === 'fiat')!;
check('demo: fiat em dólar e em euro, com o rótulo das moedas', JSON.stringify(fiatClass.currencies) === '["USD","EUR"]' && fiatClass.label === 'Fiat · USD, EUR');
check('demo: todo ativo classificado pela tabela; o cofre em dólar em fiat, marcado como cofre', demo.portfolio.holdings.every((h) => assetClassOf(h).basis === 'known')
  && fiatClass.holdings.some((h) => h.asset === 'liquidUSD' && h.vault));
check('fontes do demo: todas presentes',['list_transactions', 'list_cards', 'get_main_account', 'get_portfolio', 'get_deposit_address'].every((k) => sourceCame(demo, k as 'get_portfolio')));

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
