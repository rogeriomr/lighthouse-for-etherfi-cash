// Fronteira com o conector sem precisar de conta: lê fixtures/sample/ (respostas CRUAS sintéticas, versionadas) pelo
// mesmo caminho do ?fixtures e da importação local (rawFiles → assembleDataset → normalize) e confere, contra os
// próprios JSON crus, o que o normalize promete: páginas juntas com a linha repetida contada uma vez, tipos do
// conector traduzidos, valores em string, estorno, anulada e recusada, outras moedas, datas nos dois formatos,
// cartões, conta, carteira e depósito; depois o pipeline (moeda da casa, viagens, alertas) e as assinaturas com os
// 3 arquivos da IA de exemplo. Variantes montadas aqui: página `incomplete`, página faltando, página duplicada e
// arquivo renomeado. Os números esperados saem dos arquivos crus, não do código que está sendo testado.
import { enrichDataset } from '../src/lib/enrich.ts';
import { assembleDataset } from '../src/lib/normalize.ts';
import { bundleFromFiles, datasetFromBundle, type RawFile } from '../src/lib/rawFiles.ts';
import { detectAnomalies, detectSubscriptions, detectTrips, isSpend, portfolioSummary, recentFx, RECENT_FX_MIN } from '../src/lib/analytics.ts';
import { setFormatLocale } from '../src/lib/format.ts';
import { analyzeSubscriptions } from '../src/lib/subscriptions.ts';
import { SUBSCRIPTION_KNOWLEDGE } from '../src/lib/subscriptionKnowledge.ts';
import { validateAuditFile, validateEvidenceFile, validateKnowledgeFile } from '../src/lib/validate.ts';
import { setLocalMerchantRules, type MerchantRulesFile } from '../src/lib/merchants.ts';
import type { Dataset, Transaction } from '../src/lib/types.ts';

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
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

type Dict = Record<string, unknown>;
type RawTx = Dict & { id: string; date: string; type: string; status: string; amount: string };

const dir = new URL('../fixtures/sample/', import.meta.url);
if (!existsSync(dir)) {
  console.log('✗ fixtures/sample/ não existe (rode node scripts/gen-sample.mjs)');
  process.exit(1);
}
const names = readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'));
const files: RawFile[] = names.map((name) => ({ name, json: readJson(new URL(name, dir)), modified: 1 }));
const raw = (name: string) => files.find((f) => f.name === name)?.json as Dict;

const pageFiles = files.filter((f) => f.name.startsWith('list_transactions.page'));
const pages = pageFiles.map((f) => f.json as Dict & { transactions: RawTx[] });
const paged = pages.flatMap((p) => p.transactions);
const unique = [...new Map(paged.map((t) => [t.id, t])).values()];
const REF = unique.map((t) => t.date).sort().at(-1)!.slice(0, 10);
const cardRows = unique.filter((t) => t.type === 'rain_transaction');
const NOT_SPENT = new Set(['VOID', 'DECLINED']);
const UNKNOWN_TYPES = new Set(['vault_migration']);

console.log('== os arquivos de exemplo ==');
check('há várias páginas do extrato', pages.length >= 3, `${pages.length}`);
check('a última página fecha o histórico (nextPage null) e as outras apontam a seguinte', pages.every((p, i) => (i === pages.length - 1 ? p.nextPage === null : p.nextPage === i + 2)));
check('alguma linha se repete entre páginas (como o conector faz)', paged.length > unique.length, `${paged.length - unique.length}`);
check('valores em string', paged.every((t) => typeof t.amount === 'string' && (t.localAmount === undefined || typeof t.localAmount === 'string')));
check('tem compra com cartão (rain_transaction), estorno, anulada, recusada e pendente',
  cardRows.length > 0 && cardRows.some((t) => t.amount.startsWith('-')) && cardRows.some((t) => t.status === 'VOID')
  && cardRows.some((t) => t.status === 'DECLINED') && cardRows.some((t) => t.status === 'REFUND') && cardRows.some((t) => t.status === 'PENDING'));
const localCurrencies = new Set(cardRows.map((t) => String(t.localCurrency)));
check('tem compras em várias moedas', localCurrencies.size >= 4, [...localCurrencies].join(', '));
check('datas nos dois formatos do conector (ms + Z e +00:00)', paged.some((t) => t.date.endsWith('Z')) && paged.some((t) => t.date.endsWith('+00:00')));
check('nenhum endereço 0x com formato válido nem email nos exemplos', names.every((n) => !/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])|[\w.+-]+@[\w-]+\.[\w.]+/.test(readFileSync(new URL(n, dir), 'utf8'))));

console.log('\n== leitura dos arquivos (rawFiles) ==');
const { bundle, verdicts } = bundleFromFiles(files);
const notUsed = verdicts.filter((v) => v.status !== 'used');
check('todo arquivo de exemplo é reconhecido e usado', notUsed.length === 0, notUsed.map((v) => `${v.name}: ${v.status}`).join(', '));
check('arquivos da IA passam pela validação sem descarte', verdicts.filter((v) => v.dropped).length === 0);
for (const [label, result] of [
  ['email', validateEvidenceFile(raw('subscription-evidence.json'))],
  ['pesquisa', validateKnowledgeFile(raw('subscription-research.json'))],
  ['auditoria', validateAuditFile(raw('renewal-audit.json'))],
] as const) {
  check(`validação direta: ${label} válido, nada descartado`, Boolean(result.value) && result.dropped === 0 && !result.invalid, `${result.dropped} descartado(s)`);
}

const base = datasetFromBundle(bundle, REF);
const tx = base.transactions;
const byId = new Map(tx.map((t) => [t.id, t]));

console.log('\n== normalize: extrato ==');
check('linha repetida entre páginas conta uma vez', tx.length === unique.length, `${tx.length} vs ${unique.length} (${paged.length} com repetição)`);
check('toda rain_transaction vira compra, e só elas', tx.filter((t) => t.type === 'purchase').length === cardRows.length && cardRows.every((r) => byId.get(r.id)?.type === 'purchase'));
const known = unique.filter((r) => !UNKNOWN_TYPES.has(r.type));
check('todo tipo conhecido do conector tem tradução (nada cai em "other")', known.every((r) => byId.get(r.id)?.type !== 'other'),
  [...new Set(known.filter((r) => byId.get(r.id)?.type === 'other').map((r) => r.type))].join(', '));
check('tipo desconhecido, sem estabelecimento nem cartão, vira "other" (nunca compra)', unique.filter((r) => UNKNOWN_TYPES.has(r.type)).every((r) => byId.get(r.id)?.type === 'other'));
check('VOID e DECLINED viram anuladas (void)', unique.filter((r) => NOT_SPENT.has(r.status)).every((r) => byId.get(r.id)?.status === 'void'));
check('PENDING vira pendente', unique.filter((r) => r.status === 'PENDING').every((r) => byId.get(r.id)?.status === 'pending'));
check('CLEARED e REFUND contam como liquidadas', unique.filter((r) => r.status === 'CLEARED' || r.status === 'REFUND').every((r) => byId.get(r.id)?.status === 'settled'));
check('compra: valor em USD = amount da fonte, com sinal', cardRows.every((r) => byId.get(r.id)?.amountUsd === Number(r.amount)));
check('compra: valor local = localAmount, na moeda local', cardRows.every((r) => {
  const t = byId.get(r.id);
  return t?.amount === Number(r.localAmount) && t.currency === r.localCurrency;
}));
check('estorno (valor negativo) fica negativo e abate o gasto', cardRows.filter((r) => r.amount.startsWith('-')).every((r) => {
  const t = byId.get(r.id);
  return Boolean(t && t.amountUsd < 0 && t.amount < 0 && isSpend(t));
}));
check('não-compra: valor sempre positivo (o sentido vem de direction)', unique.filter((r) => r.type !== 'rain_transaction').every((r) => {
  const t = byId.get(r.id);
  return Boolean(t && t.amountUsd >= 0 && t.direction === r.direction);
}));
check('valores com muitas casas decimais viram número finito', tx.every((t) => Number.isFinite(t.amount) && Number.isFinite(t.amountUsd)));
check('câmbio efetivo = USD / local nas compras em outra moeda', tx.filter((t) => t.type === 'purchase' && t.currency !== 'USD' && t.amount !== 0)
  .every((t) => Math.abs((t.exchangeRate ?? 0) - Math.abs(t.amountUsd / t.amount)) < 1e-6));
check('datas em ISO com Z, mesmo instante da fonte', unique.every((r) => {
  const t = byId.get(r.id);
  return Boolean(t && /Z$/.test(t.date) && Date.parse(t.date) === Date.parse(r.date));
}));
const expectedSpend = R2(sum(cardRows.filter((r) => !NOT_SPENT.has(r.status)).map((r) => Number(r.amount))));
const gotSpend = R2(sum(tx.filter(isSpend).map((t) => t.amountUsd)));
check('gasto = compras do cartão menos anuladas e recusadas, com estorno abatendo', gotSpend === expectedSpend, `${gotSpend} vs ${expectedSpend}`);
check('cobertura: da linha mais antiga, completa (última página sem nextPage), sem linhas faltando',
  base.coverage?.from === new Date(Date.parse(unique.map((t) => t.date).sort((a, b) => Date.parse(a) - Date.parse(b))[0])).toISOString()
  && base.coverage?.complete === true && !base.coverage?.droppedRows);

console.log('\n== normalize: cartões, conta, carteira e depósito ==');
const rawCards = (raw('list_cards.json').cards as Dict[]);
check('todos os cartões lidos', base.cards.length === rawCards.length);
check('tipo do cartão em minúsculas (VIRTUAL/PHYSICAL)', base.cards.every((c) => c.type === 'virtual' || c.type === 'physical'));
const statusOf = (last4: string) => base.cards.find((c) => c.lastFour === last4)?.status;
check('status: ACTIVE, CANCELLED e NOT_ACTIVE', rawCards.every((c) => statusOf(String(c.last4)) === ({ ACTIVE: 'active', CANCELLED: 'cancelled', NOT_ACTIVE: 'inactive' } as Dict)[String(c.status)]));
check('cartão sem apelido (null) ganha um nome', base.cards.every((c) => typeof c.nickname === 'string' && c.nickname.length > 0));
const rawAccount = raw('get_main_account.json');
check('conta: borrowed, creditLimit e availableBalance em string viram número',
  base.account.amountBorrowed === Number(rawAccount.borrowed) && base.account.creditLimit === Number(rawAccount.creditLimit)
  && base.account.availableBalance === Number(rawAccount.availableBalance));
check('conta: saldo total lido; poder de compra = availableBalance (o "spending power" da descrição da ferramenta)',
  base.account.totalBalance === Number(rawAccount.totalBalance) && base.account.availableBalance === Number(rawAccount.availableBalance) && !('spendingPower' in base.account));
check('conta: accountLabel como veio', base.account.accountLabel === rawAccount.accountLabel);
check('conta: tradingPositionsIncluded true não marca o saldo como parcial', rawAccount.tradingPositionsIncluded === true && base.account.balancePartial === undefined);
check('conta: endereço como veio', base.account.vaultAddress === rawAccount.address);
const rawPortfolio = raw('get_portfolio.json');
const rawHoldings = rawPortfolio.holdings as Dict[];
check('carteira: todos os ativos, valor em string vira número', base.portfolio.holdings.length === rawHoldings.length
  && base.portfolio.holdings.every((h, i) => h.dollarValue === Number(rawHoldings[i].valueUsd)));
check('carteira: quantidade {amount, decimals} em unidades base; null fica ausente', base.portfolio.holdings.every((h, i) => {
  const q = rawHoldings[i].quantity as Dict | null;
  return q === null ? h.quantity === undefined : Math.abs((h.quantity ?? NaN) - Number(q.amount) / 10 ** Number(q.decimals)) < 1e-9;
}));
check('carteira: collateral vira "garante o gasto"', base.portfolio.holdings.every((h, i) => h.backsSpending === rawHoldings[i].collateral));
check('carteira: unrenderableAssetCount > 0 marca a lista como parcial', base.portfolio.partial === true);
check('carteira: a contagem de não listados fica', base.portfolio.unrenderableCount === rawPortfolio.unrenderableAssetCount);
check('carteira: tradingPositionsIncluded como veio', base.portfolio.tradingIncluded === rawPortfolio.tradingPositionsIncluded);
check('carteira: total = soma dos ativos listados', base.portfolio.totalValue === R2(sum(rawHoldings.map((h) => Number(h.valueUsd)))));
const rawGroups = rawPortfolio.groups as { id: string; label: string }[];
check('carteira: grupos do app lidos (id e rótulo, na ordem da fonte)', JSON.stringify(base.portfolio.groups) === JSON.stringify(rawGroups.map((g) => ({ id: g.id, label: g.label }))));
check('carteira: cada ativo com o grupo e a rede da fonte', base.portfolio.holdings.every((h, i) => h.groupId === rawHoldings[i].groupId && h.chainId === rawHoldings[i].chainId));
const rawDeposit = raw('get_deposit_address.json');
const rawSupported = rawDeposit.supportedAssets as { symbol: string; ltv: string }[];
check('carteira: LTV publicado do mesmo símbolo, como fração', base.portfolio.holdings.every((h) => {
  const s = rawSupported.find((a) => a.symbol === h.asset);
  return s ? h.ltv === Number(s.ltv) && h.ltv >= 0 && h.ltv <= 1 : h.ltv === undefined;
}));
check('carteira: o exemplo tem ativo sem LTV publicado e ativo com LTV que não garante', base.portfolio.holdings.some((h) => h.ltv === undefined && h.backsSpending)
  && base.portfolio.holdings.some((h) => h.ltv !== undefined && !h.backsSpending));
check('fontes: as 5 ferramentas marcadas como presentes', ['list_transactions', 'list_cards', 'get_main_account', 'get_portfolio', 'get_deposit_address']
  .every((k) => base.sources?.[k as keyof NonNullable<Dataset['sources']>] === true));
check('retrato do saldo: a data dos arquivos da conta e da carteira', base.snapshotAt === new Date(1).toISOString(), String(base.snapshotAt));
check('depósito: endereço (visivelmente inválido no exemplo) como veio', base.deposit.address === rawDeposit.address && !/^0x[0-9a-fA-F]{40}$/.test(base.deposit.address));
check('depósito: redes de cada ativo saem dos contratos e estão na lista de redes',
  (base.deposit.assetNetworks ?? []).length === (rawDeposit.supportedAssets as Dict[]).length
  && (base.deposit.assetNetworks ?? []).every((a) => a.networks.length > 0 && a.networks.every((nw) => base.deposit.networks.includes(nw))));
check('depósito: um ativo que só vale em 2 redes fica só com elas', base.deposit.assetNetworks?.find((a) => a.symbol === 'USDT')?.networks.join() === 'ethereum,optimism');

console.log('\n== variantes ==');
const variantUrl = new URL('incomplete/list_transactions.page3.json', dir);
if (!existsSync(variantUrl)) check('variante incomplete existe', false, 'fixtures/sample/incomplete/list_transactions.page3.json');
else {
  const variant = readJson(variantUrl) as Dict & { transactions: RawTx[] };
  const swapped = files.map((f) => (f.name === 'list_transactions.page3.json' ? { ...f, json: variant } : f));
  const inc = datasetFromBundle(bundleFromFiles(swapped).bundle, REF);
  const keptIds = new Set([...pages.filter((_, i) => i !== 2).flatMap((p) => p.transactions), ...variant.transactions].map((t) => t.id));
  check('página incomplete: linhas faltando marcadas (droppedRows), separado de "histórico mais antigo"', inc.coverage?.droppedRows === true && inc.coverage?.complete === true);
  check('página incomplete: as linhas que vieram continuam lá', inc.transactions.length === keptIds.size, `${inc.transactions.length} vs ${keptIds.size}`);
}
const withoutPage2 = datasetFromBundle(bundleFromFiles(files.filter((f) => f.name !== 'list_transactions.page2.json')).bundle, REF);
check('página faltando no meio também marca linhas faltando', withoutPage2.coverage?.droppedRows === true);
const twice = bundleFromFiles([...files, { name: 'list_transactions.page2 (1).json', json: raw('list_transactions.page2.json'), modified: 0 }]);
check('a mesma página duas vezes: uma fica, a outra é marcada como repetida', twice.verdicts.filter((v) => v.status === 'duplicate').length === 1
  && datasetFromBundle(twice.bundle, REF).transactions.length === tx.length);
const renamed = bundleFromFiles(files.map((f) => (f.name === 'get_portfolio.json' ? { ...f, name: 'my-portfolio-export.json' } : f)));
check('arquivo renomeado é reconhecido pela forma', renamed.verdicts.find((v) => v.name === 'my-portfolio-export.json')?.kind === 'portfolio');
const lastPage = pages.at(-1)!;
const cut = assembleDataset({ referenceDate: REF, transactions: { ...pages[0], transactions: pages[0].transactions } }).dataset;
check('só a 1ª página (nextPage pendente): histórico marcado como incompleto', cut.coverage?.complete === false && lastPage.nextPage === null);

console.log('\n== regras locais de estabelecimento ==');
const rulesFile = raw('merchant-rules.json') as MerchantRulesFile;
check('rawFiles leva merchant-rules.json para o Dataset', base.merchantRules !== undefined);
// enquanto o carregador não levar, as regras entram à mão para o resto do check continuar valendo
const withRules: Dataset = base.merchantRules ? base : { ...base, merchantRules: rulesFile };
check('todas as regras de exemplo são válidas', setLocalMerchantRules(rulesFile).skipped === 0 && setLocalMerchantRules(rulesFile).rules === (rulesFile.rules ?? []).length);
setLocalMerchantRules(undefined);

console.log('\n== pipeline (EN e PT, fuso de Lisboa) ==');
const knowledge = [...(bundle.research?.items ?? []), ...SUBSCRIPTION_KNOWLEDGE];
for (const locale of ['en', 'pt'] as const) {
  setFormatLocale(locale);
  let live: Dataset | undefined;
  try {
    live = enrichDataset(withRules, locale, 'Europe/Lisbon');
  } catch (e) {
    check(`enrichDataset (${locale}) não lança`, false, String(e));
    continue;
  }
  const purchases = live.transactions.filter((t) => t.type === 'purchase');
  const named = (descriptor: string) => purchases.filter((t) => t.merchantRaw === descriptor);
  check(`[${locale}] moeda da casa = moeda local mais frequente (EUR)`, live.homeCurrency === 'EUR', String(live.homeCurrency));
  check(`[${locale}] toda compra casa com um cartão`, purchases.every((t) => live.cards.some((c) => c.id === t.cardId)));
  check(`[${locale}] toda compra tem nome e categoria`, purchases.every((t) => Boolean(t.merchant) && Boolean(t.category)));
  check(`[${locale}] regra local: o delivery ganha nome, marca e categoria`, purchases.filter((t) => t.merchantRaw?.startsWith('QUICKBITE*'))
    .every((t) => t.merchant === 'QuickBite' && t.brand === 'QuickBite' && t.category === 'delivery'));
  check(`[${locale}] regra local com nome nas duas línguas`, named('RAILHOP TICKETS').every((t) => t.merchant === (locale === 'pt' ? 'Railhop · passagens de trem' : 'Railhop · train tickets')));
  check(`[${locale}] acento local`, locale === 'en' || named('CAFE LUMEN').every((t) => t.merchant?.includes('Lúmen')), named('CAFE LUMEN')[0]?.merchant ?? '');
  check(`[${locale}] regra local não mexe em quem não casa`, named('GREENLEAF MARKET 214').every((t) => t.merchant === 'Greenleaf Market'), named('GREENLEAF MARKET 214')[0]?.merchant ?? '');
  const trips = detectTrips(live);
  const tripCurrencies = trips.map((t) => t.currencies.join('+')).sort();
  check(`[${locale}] viagens: Japão (JPY) e Reino Unido (GBP); a compra avulsa em MXN não é viagem`, tripCurrencies.join() === 'GBP,JPY', tripCurrencies.join(' | '));

  const alerts = detectAnomalies(live, detectSubscriptions(live), locale);
  const kinds = (kind: string) => alerts.filter((a) => a.kind === kind);
  const rawOf = (a: { relatedIds: string[] }) => a.relatedIds.map((id) => unique.find((r) => r.id === id)).filter((r): r is RawTx => Boolean(r));
  const merchantOf = (a: { relatedIds: string[] }) => [...new Set(rawOf(a).map((r) => String(r.merchant)))].join();
  check(`[${locale}] alerta: cobrança duplicada no delivery`, kinds('duplicate').some((a) => merchantOf(a) === 'QUICKBITE*NONNA PASTA'), kinds('duplicate').map(merchantOf).join(' | '));
  check(`[${locale}] alerta: muito acima do normal na livraria`, kinds('unusually_large').some((a) => merchantOf(a) === 'PAGEBOUND BOOKS'), kinds('unusually_large').map(merchantOf).join(' | '));
  check(`[${locale}] alerta: primeira vez no estabelecimento novo`, kinds('first_time').some((a) => merchantOf(a) === 'HOMEWARD GARDEN SUPPLY'), kinds('first_time').map(merchantOf).join(' | '));
  const regulars = new Set(cardRows.filter((r) => Date.parse(r.date) < Date.parse(`${REF}T00:00:00Z`) - 60 * 86400000).map((r) => String(r.merchant)));
  check(`[${locale}] primeira vez nunca num estabelecimento que já aparecia antes`, kinds('first_time').every((a) => rawOf(a).every((r) => !regulars.has(String(r.merchant)))));
  check(`[${locale}] alerta: pendente há mais de 14 dias`, kinds('stuck_pending').some((a) => rawOf(a).some((r) => r.merchant === 'RAILHOP TICKETS')));
  check(`[${locale}] nenhuma anulada ou recusada vira alerta`, alerts.every((a) => rawOf(a).every((r) => !NOT_SPENT.has(r.status))));
  check(`[${locale}] alertas com texto e valor finito`, alerts.every((a) => a.title.length > 0 && a.rationale.length > 0 && Number.isFinite(a.amountUsd)));

  const report = analyzeSubscriptions(live, { knowledge, today: live.referenceDate, locale });
  // o registro pelo texto da fatura das cobranças: o nome exibido é decisão do motor
  const rec = (descriptor: string) => report.records.find((r) => r.charges.some((c: Transaction) => c.merchantRaw === descriptor));
  const active = ['PIXELFLOW*STUDIO', 'NIMBUSBOX STORAGE', 'FITPULSE CLUB', 'LINGOLEAP*ANNUAL'];
  check(`[${locale}] assinaturas ativas pela pesquisa local, recorrência e email`, active.every((d) => rec(d)?.status === 'active'),
    active.map((d) => `${d}: ${rec(d)?.status ?? 'ausente'}`).join(', '));
  check(`[${locale}] email de cancelamento: a de streaming fica cancelada`, rec('STREAMORA*MONTHLY')?.status === 'cancelled', rec('STREAMORA*MONTHLY')?.status ?? 'ausente');
  check(`[${locale}] pesquisa "não é assinatura": o mercado não vira assinatura ativa`, rec('GREENLEAF MARKET 214')?.status !== 'active');
  check(`[${locale}] nada do dia a dia vira assinatura ativa`, ['CAFE LUMEN', 'TRATTORIA FINTA', 'RIDEALONG *TRIP', 'FUELPOINT 77'].every((d) => rec(d)?.status !== 'active'));
  const lingo = rec('LINGOLEAP*ANNUAL');
  check(`[${locale}] anual renovada há pouco: ciclo do email e prazo de reembolso da auditoria`, lingo?.cycle === 'annual' && lingo.justRenewed?.refundWindowDays === 30
    && lingo.justRenewed.refundDaysLeft === 30 - Math.round((Date.parse(`${live.referenceDate}T00:00:00Z`) - Date.parse(`${lingo.justRenewed.date}T00:00:00Z`)) / 86400000),
  `${lingo?.cycle} · ${lingo?.justRenewed?.refundDaysLeft}`);
  check(`[${locale}] risco alto vem da auditoria e ganha o aviso de 30 dias`, rec('FITPULSE CLUB')?.risk === 'high' && rec('FITPULSE CLUB')?.riskSource === 'audit' && rec('FITPULSE CLUB')?.alert === 'd30');
  check(`[${locale}] mudança de preço: a última cobrança é a do preço novo (44 EUR)`, rec('FITPULSE CLUB')?.lastCharge.amount === 44);
  check(`[${locale}] links de gerenciar só https`, report.records.every((r) => !r.manageUrl || r.manageUrl.startsWith('https://')));
  check(`[${locale}] totais finitos`, Number.isFinite(report.monthlyTotalUsd) && Number.isFinite(report.annualTotalUsd) && report.monthlyTotalUsd > 0);
  check(`[${locale}] recusada não conta como cobrança da assinatura`, report.records.every((r) => r.charges.every((c: Transaction) => c.status !== 'void')));
}
setFormatLocale('en');

console.log('\n== portfólio (portfolioSummary e recentFx) ==');
const enriched = enrichDataset(withRules, 'en', 'Europe/Lisbon');
const ps = portfolioSummary(enriched, 'pt');
check('saldo da conta, não a soma da lista', ps.totalSource === 'account' && ps.total === Number(rawAccount.totalBalance));
check('lista parcial avisada (unrenderable), sem outro motivo', JSON.stringify(ps.partialReasons) === '["unrenderable"]', ps.partialReasons.join());
check('grupos: ids da fonte, do maior para o menor, frações somando 1', ps.groups.every((g) => rawGroups.some((r) => r.id === g.id))
  && ps.groups.every((g, i) => i === 0 || ps.groups[i - 1].value >= g.value) && Math.abs(sum(ps.groups.map((g) => g.share)) - 1) < 1e-9);
check('grupos: rótulo em português', ps.groups.some((g) => g.id === 'crypto' && g.label === 'Cripto'));
check('cofre: só o ativo do grupo liquidVaults, e o campo cru "vault" não conta', base.portfolio.holdings.every((h, i) => Boolean(h.vault) === (rawHoldings[i].groupId === 'liquidVaults'))
  && rawHoldings.every((h) => typeof h.vault === 'string'));
check('classes: o USDC do grupo "Crypto" e o cofre em dólar ficam em Fiat · USD', ps.classes[0]?.id === 'fiat' && ps.classes[0].label === 'Fiat · USD'
  && ['USDC', 'liquidUSD'].every((a) => ps.classes[0].holdings.some((h) => h.asset === a)));
check('classes: frações somando 1, do maior para o menor', Math.abs(sum(ps.classes.map((c) => c.share)) - 1) < 1e-9 && ps.classes.every((c, i) => i === 0 || ps.classes[i - 1].value >= c.value));
check('grupos: todo ativo listado com valor está em um grupo', sum(ps.groups.map((g) => g.holdings.length)) === base.portfolio.holdings.filter((h) => h.dollarValue > 0).length);
check('poder de compra = availableBalance; uso = emprestado ÷ limite', ps.spendingPower === Number(rawAccount.availableBalance)
  && ps.utilization === R2((Number(rawAccount.borrowed) / Number(rawAccount.creditLimit)) * 100));
check('poder de compra não é limite − emprestado no exemplo (são números diferentes)', ps.spendingPower !== R2(Number(rawAccount.creditLimit) - Number(rawAccount.borrowed)));
const fx = recentFx(enriched);
const eurCharges = enriched.transactions.filter((t) => t.type === 'purchase' && t.status === 'settled' && t.currency === 'EUR' && t.amount > 0);
const rates = eurCharges.map((t) => t.amount / t.amountUsd);
check('câmbio recente (EUR): amostra mínima, período dentro do histórico', fx !== null && fx.currency === 'EUR' && fx.count >= RECENT_FX_MIN
  && fx.from <= fx.to && fx.to <= enriched.referenceDate, fx ? `${fx.count} compras` : 'null');
check('câmbio recente entre o menor e o maior câmbio das compras', fx !== null && fx.localPerUsd >= Math.min(...rates) - 1e-9 && fx.localPerUsd <= Math.max(...rates) + 1e-9);

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
