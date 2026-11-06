// O motor da tela Empréstimo (src/lib/borrow.ts): o caso clássico com alvos fixos (US$ 10.000 no USD Yield a 4,75%
// contra US$ 300 em USDT a 3,55%), vários empréstimos agrupados por moeda, o preço de liquidação com dívida em dólar e
// em WETH, a projeção e as marcas do "quanto o rendimento já pagou" (25/50/75/100%), os alarmes, a validação das
// preferências e dos candles. E as linhas vermelhas nos textos da tela. Nos dados reais, só invariantes, sem número
// nenhum na saída.
import { demoDataset } from '../src/lib/demo/dataset.ts';
import { shiftDemo } from '../src/lib/demo/shift.ts';
import { enrichDataset } from '../src/lib/enrich.ts';
import { bundleFromFiles, datasetFromBundle } from '../src/lib/rawFiles.ts';
import {
  accountCollateral, accountPosition, applyShock, debtGroups, DEFAULT_BORROW_PREFS, evaluateAlarms, HF, hfCrossings, jointDropTrigger, MARKET_ASSETS, marketAsset,
  newCollateralLine, netPoints, OBSERVED_RATES, SAMPLE_BORROW_COLLATERAL, scenarioPosition, cheaperSameCurrency, PERIOD_YEARS, paidMonth, payoff, priceTrigger, project, riskLevel, summarize, totalDebt, validateAlarm, validateBorrowPrefs, volatileUnderlyings,
  type BorrowPosition,
} from '../src/lib/borrow.ts';
import { validateCandles } from '../src/lib/prices.ts';
import type { Dataset } from '../src/lib/types.ts';
import { isDataFile, resolveDataDir } from './data-dir.mjs';

// sem @types/node no projeto: os módulos do Node chegam por getBuiltinModule, tipados aqui (mesmo jeito dos outros checks)
interface Fs { existsSync(p: URL | string): boolean; readdirSync(p: URL | string): string[]; readFileSync(p: URL | string, encoding: 'utf8'): string; statSync(p: URL | string): { mtimeMs: number } }
declare const process: { exit(code: number): never; getBuiltinModule(id: 'node:fs'): Fs; getBuiltinModule(id: 'node:url'): { fileURLToPath(u: URL): string } };
const { existsSync, readFileSync, readdirSync, statSync } = process.getBuiltinModule('node:fs');
const { fileURLToPath } = process.getBuiltinModule('node:url');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const near = (a: number | null | undefined, b: number, eps = 0.01) => typeof a === 'number' && Math.abs(a - b) <= eps;
const m = (symbol: string) => {
  const a = marketAsset(symbol);
  if (!a) throw new Error(`sem ${symbol} na tabela`);
  return a;
};

// ---------- a tabela pública ----------

check('tabela: Product LTV sempre abaixo do CF (a ether.fi exige)', MARKET_ASSETS.every((a) => a.productLtv < a.cf && a.cf < 1 && a.productLtv > 0));
check('tabela: liquidUSD 80% / 90% (27/08/2026)', m('liquidUSD').productLtv === 0.8 && m('liquidUSD').cf === 0.9);
check('tabela: weETH 55% / 75%', m('weETH').productLtv === 0.55 && m('weETH').cf === 0.75);
check('cofres do Earn: Bold 64/75, RWAs 75/90, USD 80/90, ETH e BTC 50/70, EUR 80/90', [['liquidBold', 0.64, 0.75], ['liquidRWA', 0.75, 0.9], ['liquidUSD', 0.8, 0.9], ['liquidETH', 0.5, 0.7], ['liquidBTC', 0.5, 0.7], ['liquidEUR', 0.8, 0.9]].every(([sym, ltv, cf]) => m(sym as string).vault === true && m(sym as string).productLtv === ltv && m(sym as string).cf === cf));
check('cofres do Earn: APY de referência do app (8 / 6,08 / 4,75 / 3,4 / 1,04 / 5,61) entra ao simular', newCollateralLine(m('liquidBold'), 100).apy === 8 && newCollateralLine(m('liquidRWA'), 100).apy === 6.08 && newCollateralLine(m('liquidEUR'), 100).apy === 5.61 && newCollateralLine(m('weETH'), 100).apy === 0);
check('tabela: símbolos únicos', new Set(MARKET_ASSETS.map((a) => a.symbol.toLowerCase())).size === MARKET_ASSETS.length);
check('taxas vistas no app: USDT 3,55%, USDC 4,1%', OBSERVED_RATES.rates.USDT === 3.55 && OBSERVED_RATES.rates.USDC === 4.1);
// tokenIcons.ts usa import.meta.env (do Vite): aqui a conferência é pelo arquivo do mapa e pela pasta public/tokens
const iconMap = readFileSync(fileURLToPath(new URL('../src/lib/tokenIcons.ts', import.meta.url)), 'utf8');
const iconFiles = ['liquidusd', 'liquidbold', 'liquidrwa', 'liquideth', 'liquidbtc', 'liquideur', 'weeth', 'ebtc', 'ethfi', 'btc'].map((k) => iconMap.match(new RegExp(`(^|[ ,{])${k}: '([^']+)'`, 'm'))?.[2]);
check('ícones: liquidUSD, weETH, eBTC, ETHFI e BTC têm ícone, e o arquivo existe', iconFiles.every((f) => f !== undefined && existsSync(fileURLToPath(new URL(`../public/tokens/${f}`, import.meta.url)))), JSON.stringify(iconFiles));

// ---------- o caso clássico: US$ 10.000 no USD Yield a 4,75%, US$ 300 de USDT a 3,55% ----------

const classic: BorrowPosition = { collateral: [newCollateralLine(m('liquidUSD'), 10_000, 4.75)], debts: [{ asset: 'USDT', amount: 300, apr: 3.55 }] };
const s = summarize(classic);
check('clássico: rendimento 475,00/ano', near(s.yieldYear, 475));
check('clássico: juros 10,65/ano', near(s.interestYear, 10.65));
check('clássico: líquido 464,35/ano', near(s.netYear, 464.35));
check('clássico: HF = 9.000 ÷ 300 = 30 (só os alarmes usam)', near(s.hf, 30));
check('clássico: poder 8.000, usado 3,75%', near(s.borrowPower, 8000) && near(s.borrowPowerUsed, 0.0375, 1e-6));
check('clássico: liquidação com dívida de 9.000; atenção (cartão para) em 8.181,82', near(s.debtAt.liquidation, 9000) && near(s.debtAt.spending, 8181.82));
check('clássico: juros abaixo do rendimento até 13.380,28 de dívida', near(s.breakEvenDebt, 13380.28));
check('clássico: rendimento cobre os juros 44,6×', near(s.coverage, 44.6, 0.01));
check('clássico: APY líquido = 464,35 ÷ 9.700', near(s.netApy, (464.35 / 9700) * 100, 0.001));
check('clássico: APR médio = 3,55%', near(s.apr, 3.55, 1e-9));
check('clássico: sem preço que liquide (tudo em dólar)', priceTrigger(classic, 'eth') === null && volatileUnderlyings(classic).length === 0);
check('níveis: tranquilo ≥ 1,2, aviso 1,1–1,2, atenção 1,0–1,1, perigo < 1,00', riskLevel(s.hf) === 'calm' && riskLevel(Infinity) === 'none' && riskLevel(1.3) === 'calm' && riskLevel(1.15) === 'warning' && riskLevel(1.05) === 'attention' && riskLevel(0.95) === 'danger');
check('degraus em ordem: liquidação 1,00 < atenção 1,1 < aviso 1,2', HF.liquidation < HF.spending && HF.spending < HF.warning);
check('sem dívida: o "até que dívida" usa a taxa do ativo escolhido', near(summarize({ ...classic, debts: [] }, 3.55).breakEvenDebt, 13380.28));

const pay = payoff(classic, 0);
// 10.000 × (1,0475^(1/12) − 1) ≈ 38,75 por mês: 7 meses dão ≈ 272, 8 meses ≈ 311, acima dos ≈ 307 devidos
check('clássico: tudo pago pelo rendimento em 8 meses', pay.months === 8, String(pay.months));
check('clássico: com cashback de US$ 50/mês, antes', (payoff(classic, 50).monthsWithCashback ?? 99) < 8);
const long = project(classic, { monthlySpend: 0, monthlyCashback: 0, spendOnDebt: false }, 600);
const marks = [0.25, 0.5, 0.75, 1].map((share) => paidMonth(long, share, false));
check('marcas: 25% em 2 meses, 50% em 4, 75% em 6, 100% em 8', JSON.stringify(marks) === JSON.stringify([2, 4, 6, 8]), JSON.stringify(marks));
check('marcas: em ordem (cada parte nunca vem antes da menor)', marks.every((x, i) => i === 0 || (x ?? 0) >= (marks[i - 1] ?? 0)));
const net = netPoints(long.slice(0, 13));
check('gráfico: o azul é rendimento − juros e a linha é o emprestado, reta', near(net[12].cumYield, long[12].cumYield - long[12].cumInterest, 1e-9) && net.every((pt) => pt.debt === 300));
check('gráfico: "tudo pago" pelo lucro = o rendimento somando o principal + juros (mesmo mês)', paidMonth(long, 1, false) === long.slice(1).find((pt) => pt.cumYield >= pt.debt)?.month);
const pts = project(classic, { monthlySpend: 0, monthlyCashback: 0, spendOnDebt: false }, 12);
check('projeção: 13 pontos, mês 0 = hoje', pts.length === 13 && pts[0].debt === 300 && pts[0].cumYield === 0);
check('projeção: 12 meses de rendimento ≈ 475 (composto mês a mês = APY)', near(pts[12].cumYield, 475, 0.05));
check('projeção: dívida em 12 meses ≈ 310,65', near(pts[12].debt, 310.65, 0.02));
check('projeção: HF sobe sem gasto novo (rendimento > juros)', pts[12].hf > pts[0].hf);

// juros maiores que o rendimento: nunca soma
const upside: BorrowPosition = { collateral: [newCollateralLine(m('liquidUSD'), 400, 2)], debts: [{ asset: 'USDT', amount: 300, apr: 12 }] };
check('juros > rendimento: payoff null', payoff(upside, 0).months === null);

// gasto entrando na dívida em dólar: os cruzamentos, em ordem
const cross = hfCrossings(project(classic, { monthlySpend: 1000, monthlyCashback: 0, spendOnDebt: true }, 600));
check('gasto de 1.000/mês: cruza 1,5, depois 1,1, depois 1,00', cross.borrowing !== null && cross.spending !== null && cross.liquidation !== null && cross.borrowing <= cross.spending && cross.spending <= cross.liquidation);
check('gasto de 1.000/mês: 1,5 no 6º mês (dívida ≈ 6.000)', cross.borrowing === 6, String(cross.borrowing));

// ---------- vários empréstimos ----------

const multi: BorrowPosition = {
  collateral: [newCollateralLine(m('liquidUSD'), 10_000, 4.75)],
  debts: [{ asset: 'USDT', amount: 200, apr: 3.55 }, { asset: 'USDC', amount: 100, apr: 4.1 }, { asset: 'EURC', amount: 50, apr: 3.38 }],
};
const groups = debtGroups(multi.debts);
check('grupos: USDT + USDC juntos no dólar, EURC no euro, nunca somados entre si', groups.length === 2 && groups[0].group === 'usd' && near(groups[0].amount, 300) && groups[1].group === 'eur' && near(groups[1].amount, 50));
check('grupos: taxa do dólar ponderada (200 a 3,55 + 100 a 4,1)', near(groups[0].apr, (200 * 3.55 + 100 * 4.1) / 300, 1e-9));
const ms = summarize(multi);
check('vários: dívida total 350 e juros somados', near(ms.debt, 350) && near(ms.interestYear, 7.1 + 4.1 + 1.69, 0.001));
check('vários: euro na dívida vira risco de preço (EUR)', volatileUnderlyings(multi).includes('eur'));
check('vários: totalDebt ignora valor negativo', totalDebt({ ...multi, debts: [...multi.debts, { asset: 'WETH', amount: -10, apr: 1 }] }) === 350);

// ---------- cenários e dica de taxa ----------

const big = scenarioPosition('big');
const bigS = summarize({ collateral: big.collateral, debts: big.debts.map((d) => ({ ...d, apr: 3.55 })) });
check('cenário 2: US$ 50 mil no USD Yield, US$ 5 mil em USDT (10% da garantia)', near(bigS.collateralUsd, 50_000) && near(bigS.debt, 5_000) && near(bigS.debt / bigS.collateralUsd, 0.1, 1e-9));
const eth3 = scenarioPosition('eth');
const eth3P: BorrowPosition = { collateral: eth3.collateral, debts: eth3.debts.map((d) => ({ ...d, apr: 3.55 })) };
const eth3S = summarize(eth3P);
check('cenário 3: US$ 20 mil em liquidETH + 5 mil em USD Yield, dívida 13 mil, dentro do poder (14 mil)', near(eth3S.collateralUsd, 25_000) && near(eth3S.borrowPower, 14_000) && eth3S.debt < eth3S.borrowPower);
const eth3Liq = priceTrigger(eth3P, 'eth');
const eth3Att = priceTrigger(eth3P, 'eth', HF.spending);
// (20000·0,7·m + 4500) ÷ 13000 = 1 → m = 8500 ÷ 14000 ≈ 0,607 (queda de 39%); atenção: (14300 − 4500) ÷ 14000 = 0,70
check('cenário 3: liquidação se o ETH cair ≈ 39%, atenção em ≈ 30%: as duas linhas cabem no gráfico', eth3Liq !== null && near(eth3Liq.factor, 8500 / 14000, 1e-9) && eth3Att !== null && near(eth3Att.factor, 0.7, 1e-9));
const eth3Warn = priceTrigger(eth3P, 'eth', HF.warning);
// (15600 − 4500) ÷ 14000 = 0,793: o aviso amarelo vem antes da atenção (queda de ≈ 21%)
check('cenário 3: aviso amarelo em ≈ −21%, antes da atenção laranja e da liquidação', eth3Warn !== null && near(eth3Warn.factor, 11100 / 14000, 1e-9) && eth3Warn.factor > eth3Att!.factor);
const tipUsdc = cheaperSameCurrency([{ asset: 'USDC', amount: 1000, apr: 4.1 }], (a) => OBSERVED_RATES.rates[a]);
check('dica: USDC a 4,1% → USDT a 3,55% custaria 5,50 a menos por ano', tipUsdc !== null && tipUsdc.to === 'USDT' && near(tipUsdc.savingYear, 5.5));
check('dica: já em USDT, nenhuma mais barata no dólar; o WETH não entra (outra moeda)', cheaperSameCurrency([{ asset: 'USDT', amount: 1000, apr: 3.55 }], (a) => OBSERVED_RATES.rates[a]) === null);
check('período: 7 dias, 1 mês e 1 ano em fração do ano', near(PERIOD_YEARS['1m'], 1 / 12, 1e-12) && near(PERIOD_YEARS['1y'], 1, 1e-12) && near(PERIOD_YEARS['7d'] * 365.25, 7, 1e-9));

// ---------- preço de liquidação ----------

// 2 weETH a US$ 3.000 (6.000) + 1.000 em USD Yield; dívida 3.000 em USDC
const eth: BorrowPosition = {
  collateral: [{ ...newCollateralLine(m('weETH'), 6000), quantity: 2 }, newCollateralLine(m('liquidUSD'), 1000, 4.75)],
  debts: [{ asset: 'USDC', amount: 3000, apr: 4.1 }],
};
const liq = priceTrigger(eth, 'eth');
// HF(m) = (6000·0,75·m + 900) ÷ 3000 = 1  →  m = 2100 ÷ 4500 = 0,4667
check('weETH: liquidação se o ETH cair 53,3%', liq !== null && liq.direction === 'drop' && near(liq.factor, 2100 / 4500, 1e-9));
check('weETH: com o choque no fator, HF = 1', liq !== null && near(summarize(applyShock(eth, { eth: liq.factor })).hf, 1, 1e-9));
const att = priceTrigger(eth, 'eth', HF.spending);
check('weETH: a atenção (HF 1,1) vem antes da liquidação', att !== null && liq !== null && att.factor > liq.factor);
check('weETH: queda conjunta = a do único ativo variável', near(jointDropTrigger(eth), 2100 / 4500, 1e-9));
// dívida em WETH contra dólar: o perigo é o ETH SUBIR
const wethDebt: BorrowPosition = { collateral: [newCollateralLine(m('liquidUSD'), 10_000, 4.75)], debts: [{ asset: 'WETH', amount: 3000, apr: 1.48 }] };
const rise = priceTrigger(wethDebt, 'eth');
check('dívida em WETH: liquidação se o ETH subir 200%', rise !== null && rise.direction === 'rise' && near(rise.factor, 3, 1e-9));
check('dívida em WETH: o ETH aparece como risco de preço', volatileUnderlyings(wethDebt).includes('eth'));
check('dívida em WETH: sem queda conjunta (a dívida também se mexe)', jointDropTrigger(wethDebt) === null);
check('resto cobre a dívida: sem preço de liquidação', priceTrigger({ ...eth, debts: [{ asset: 'USDC', amount: 500, apr: 4.1 }] }, 'eth') === null);

// ---------- garantia da conta ----------

const holdings = [
  { asset: 'liquidUSD', dollarValue: 1000, backsSpending: true, apy: 5, ltv: 0.8 },
  { asset: 'liquidUSD', dollarValue: 500, backsSpending: true, apy: 3 },
  { asset: 'wSPYx', dollarValue: 300, backsSpending: true },
  { asset: 'ETH', dollarValue: 999, backsSpending: false },
  { asset: 'weETH', dollarValue: 0, backsSpending: true },
];
const acc = accountCollateral(holdings);
check('conta: liquidUSD em duas linhas vira uma, APY ponderado', acc.lines.length === 1 && near(acc.lines[0].valueUsd, 1500) && near(acc.lines[0].apy, (5000 + 1500) / 1500, 1e-9));
check('conta: fora da tabela pública vai para "não contam"', acc.uncounted.length === 1 && acc.uncounted[0].symbol === 'wSPYx');
check('conta: ativo que não garante e saldo zero ficam fora', !acc.lines.some((l) => l.symbol === 'weETH' || l.symbol === 'ETH'));
check('conta: LTV do conector acima do CF é ignorado (vale a tabela)', accountCollateral([{ asset: 'liquidUSD', dollarValue: 100, backsSpending: true, ltv: 0.95 }]).lines[0].productLtv === 0.8);

// ---------- alarmes e preferências ----------

const states = evaluateAlarms([
  { id: 'a1', kind: 'hf_below', value: 40, on: true },
  { id: 'a2', kind: 'debt_above', value: 1000, on: true },
  { id: 'a3', kind: 'price_below', value: 2000, underlying: 'eth', on: true },
  { id: 'a4', kind: 'price_above', value: 2000, underlying: 'btc', on: true },
  { id: 'a5', kind: 'hf_below', value: 40, on: false },
], s, { eth: 1900 });
check('alarmes: HF 30 < 40 dispara; dívida 300 < 1.000 não', states[0].triggered === true && states[1].triggered === false);
check('alarmes: preço com cotação dispara; sem cotação fica "esperando"', states[2].triggered === true && states[3].triggered === null);
check('alarmes: pausado não confere', states[4].triggered === null);
check('alarmes: HF infinito (sem dívida) não dispara', evaluateAlarms([{ id: 'x', kind: 'hf_below', value: 2, on: true }], summarize({ ...classic, debts: [] }), {})[0].triggered === false);
check('validação: alarme de preço sem ativo é recusado', validateAlarm({ id: 'a', kind: 'price_below', value: 10 }) === undefined);
check('validação: id com caractere estranho é recusado', validateAlarm({ id: '<x>', kind: 'hf_below', value: 1.5 }) === undefined);
check('validação: valor negativo é recusado', validateAlarm({ id: 'a', kind: 'hf_below', value: -1 }) === undefined);
const prefs = validateBorrowPrefs({ version: 1, debtAsset: 'XYZ', apr: { USDT: 3, USDC: -1, WETH: 500 }, alarms: [{ id: 'ok', kind: 'hf_below', value: 1.5 }, { bad: 1 }], prices: 'yes', marks: [0.5, 0.3, 1, 1], details: 1, period: '2w' });
check('validação: ativo de dívida desconhecido volta ao padrão', prefs?.debtAsset === DEFAULT_BORROW_PREFS.debtAsset);
check('validação: APR fora de 0–100 sai, a válida fica', prefs?.apr.USDT === 3 && prefs?.apr.USDC === undefined && prefs?.apr.WETH === undefined);
check('validação: alarme inválido sai, o válido fica (ligado)', prefs?.alarms.length === 1 && prefs.alarms[0].on === true);
check('validação: preços e detalhes só com true explícito', prefs?.prices === false && prefs?.details === false);
check('validação: marcas só 25/50/75/100%, sem repetir', JSON.stringify(prefs?.marks) === JSON.stringify([0.5, 1]));
check('validação: período desconhecido volta a 1M', prefs?.period === '1m');
check('cashback da tela: 3% por padrão; fora de 0–10% volta a 3', DEFAULT_BORROW_PREFS.cashbackPct === 3 && validateBorrowPrefs({ version: 1, cashbackPct: 4 })?.cashbackPct === 4 && validateBorrowPrefs({ version: 1, cashbackPct: 40 })?.cashbackPct === 3 && validateBorrowPrefs({ version: 1, cashbackPct: -1 })?.cashbackPct === 3);
check('validação: versão errada é recusada', validateBorrowPrefs({ version: 2 }) === undefined);

// ---------- candles (Coinbase: [s, mínima, máxima, abertura, fechamento, volume]) ----------

const candles = validateCandles([[300, 9, 12, 10, 11, 5], [100, 8, 10, 9, 9.5, 1], [200, 9, 8, 9, 9, 1], [200, 9, 11, 10, 10.5, 1], ['x', 1, 2, 1, 2, 1], [400, 5, 12, 13, 11, 1]]);
check('candles: ordena, tira mínima > máxima e abertura fora da faixa, s → ms', JSON.stringify(candles) === JSON.stringify([
  { t: 100000, o: 9, h: 10, l: 8, c: 9.5 }, { t: 200000, o: 10, h: 11, l: 9, c: 10.5 }, { t: 300000, o: 10, h: 12, l: 9, c: 11 },
]));
check('candles: menos de 2 = null', validateCandles([[1, 1, 2, 1, 2, 1]]) === null && validateCandles({}) === null && validateCandles(null) === null);

// ---------- demo ----------

const demo = enrichDataset(shiftDemo(demoDataset, new Date().toISOString().slice(0, 10)), 'en');
const dp = accountPosition(demo, 'USDT', 3.55);
const ds = summarize(dp.position);
check('demo: dívida e garantia vêm da conta (o total no ativo escolhido)', totalDebt(dp.position) === demo.account.amountBorrowed && dp.position.debts.length === 1 && dp.position.debts[0].asset === 'USDT');
check('demo: HF finito e acima de 1', Number.isFinite(ds.hf) && ds.hf > 1);
check('demo: weETH e eBTC dão risco de preço (carteira inteira)', volatileUnderlyings(dp.position).includes('eth') && volatileUnderlyings(dp.position).includes('btc'));
const dsample = accountPosition(demo, 'USDT', 3.55, SAMPLE_BORROW_COLLATERAL);
check('demo na tela Empréstimo: só LiquidUSD, weETH e ETHFI, sem "não contam"', JSON.stringify(dsample.position.collateral.map((c) => c.symbol).sort()) === JSON.stringify(['ETHFI', 'liquidUSD', 'weETH']) && dsample.uncounted.length === 0);
check('demo na tela Empréstimo: a mesma dívida da conta', totalDebt(dsample.position) === demo.account.amountBorrowed);

// ---------- linhas vermelhas nos textos da tela ----------

const FORBIDDEN = [
  /\byou should\b/i, /\bwe recommend\b/i, /\bvocê deveria\b/i, /\brecomend(o|amos)\b/i,
  /\b(deposit|invest|buy|sell|spend more|borrow more)\b/i, /\b(deposite|depositar|invista|investir|aplique|compre|venda|gaste mais|pegue mais)\b/i,
  /\bguarantee|garantid[oa]\b/i,
  // o varejo não lê "health factor": a tela fala em atenção e liquidação (só o alarme diz "HF", entre parênteses)
  /\bhealth factor\b/i,
];
const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = ['views/Borrow.tsx', ...readdirSync(`${root}components`).filter((f) => f.startsWith('borrow')).map((f) => `components/${f}`)];
const literals: string[] = [];
for (const f of files) {
  const src = readFileSync(root + f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  // só o que está entre aspas ou crases (o texto da tela), não os nomes nem os comentários do código
  for (const mm of src.matchAll(/(['`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) if (/\s/.test(mm[2])) literals.push(mm[2]);
}
const hits = literals.filter((t) => FORBIDDEN.some((re) => re.test(t)));
check(`textos: nenhum recomenda, manda agir ou fala "health factor" (${files.length} arquivos, ${literals.length} textos)`, hits.length === 0, hits.slice(0, 3).join(' | '));
check('textos: a simulação diz que não é conselho, nas duas línguas', literals.some((t) => /not financial advice/.test(t)) && literals.some((t) => /não conselho financeiro/.test(t)));

// ---------- dados reais: só invariantes ----------

const data = resolveDataDir();
let real: Dataset | null = null;
if (existsSync(data.url)) {
  const names = readdirSync(data.url).filter(isDataFile);
  if (names.length) {
    const raws = names.map((name) => ({ name, json: JSON.parse(readFileSync(new URL(name, data.url), 'utf8')), modified: statSync(new URL(name, data.url)).mtimeMs }));
    const { bundle } = bundleFromFiles(raws);
    real = enrichDataset(datasetFromBundle(bundle, new Date().toISOString().slice(0, 10)), 'en', 'America/Sao_Paulo');
  }
}
if (!real) {
  console.log('… sem dados reais na pasta de dados: as invariantes da conta real ficam para quem tem');
} else {
  const rp = accountPosition(real, 'USDT', OBSERVED_RATES.rates.USDT);
  const rs = summarize(rp.position);
  const rdebt = totalDebt(rp.position);
  check('real: dívida = amountBorrowed da conta, nunca negativa', rdebt === Math.max(0, real.account.amountBorrowed ?? 0));
  check('real: toda garantia está na tabela pública, com LTV < CF', rp.position.collateral.every((c) => marketAsset(c.symbol) !== undefined && c.productLtv < c.cf));
  check('real: garantia + fora da conta ≤ soma dos ativos', rs.collateralUsd + rp.uncounted.reduce((a, u) => a + u.valueUsd, 0) <= (real.portfolio?.holdings ?? []).reduce((a, h) => a + Math.max(0, h.dollarValue), 0) + 0.01);
  check('real: HF = garantia ajustada ÷ dívida (ou infinito)', rdebt > 0 ? near(rs.hf, rs.riskAdjusted / rdebt, 1e-9) : rs.hf === Infinity);
  const rlong = project(rp.position, { monthlySpend: 0, monthlyCashback: 0, spendOnDebt: false }, 600);
  const rmarks = [0.25, 0.5, 0.75, 1].map((share) => paidMonth(rlong, share, false));
  check('real: as marcas vêm em ordem', rmarks.every((x, i) => i === 0 || x === null || (rmarks[i - 1] !== null && x >= rmarks[i - 1]!)));
}

console.log(failed ? `\n${failed} falha(s).` : '\nTudo certo.');
process.exit(failed ? 1 : 0);
