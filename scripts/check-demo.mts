// O contrato do dataset de demonstração (src/lib/demo/dataset.ts, gerado por scripts/gen-demo.mjs): os alvos que o
// gerador promete, conferidos direto nas linhas cruas (sem o pipeline, que o check-pipeline cobre), e o demo "visto
// hoje" (shiftDemo): andar o calendário não pode mudar totais, intervalos, alertas, assinaturas nem o retrato.
import { demoDataset } from '../src/lib/demo/dataset.ts';
import { shiftDemo } from '../src/lib/demo/shift.ts';
import { enrichDataset } from '../src/lib/enrich.ts';
import { detectAnomalies, detectSubscriptions } from '../src/lib/analytics.ts';
import { setFormatLocale } from '../src/lib/format.ts';
import { analyzeSubscriptions } from '../src/lib/subscriptions.ts';
import { SUBSCRIPTION_KNOWLEDGE } from '../src/lib/subscriptionKnowledge.ts';
import { validateAuditFile, validateEvidenceFile, validateKnowledgeFile } from '../src/lib/validate.ts';
import { assetClassOf } from '../src/lib/assetClass.ts';
import { COLLATERAL } from '../src/lib/insights/collateralParams.ts';
import { PRICE_BOOK } from '../src/lib/insights/priceBook.ts';
import { sinceSnapshot, validateSnapshot } from '../src/lib/insights/summary.ts';
import type { Dataset, Transaction } from '../src/lib/types.ts';

declare const process: { exit(code: number): never };

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const R2 = (n: number) => Math.round(n * 100) / 100;
const sum = (list: Transaction[]) => R2(list.reduce((s, t) => s + t.amountUsd, 0));
const DAY = 86400000;

const d: Dataset = demoDataset;
const tx = d.transactions;
const REF = '2026-10-12';
const purchases = (from: string, to: string) => tx.filter((t) => t.type === 'purchase' && t.date >= from && t.date <= to);
const of = (type: Transaction['type']) => tx.filter((t) => t.type === type);

console.log('== dataset ==');
check('referenceDate fixo do gerador', d.referenceDate === REF, d.referenceDate);
check('1433 movimentos', tx.length === 1433, String(tx.length));
check('em ordem crescente de data', tx.every((t, i) => i === 0 || tx[i - 1].date <= t.date));
check('datas em ISO com Z, sem milissegundos, de jul/2025 a out/2026', tx.every((t) => /^20(25|26)-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(t.date)));
check('nenhuma data depois do referenceDate', tx.every((t) => t.date.slice(0, 10) <= REF));
check('ids únicos', new Set(tx.map((t) => t.id)).size === tx.length);
check('valores finitos', tx.every((t) => Number.isFinite(t.amount) && Number.isFinite(t.amountUsd)));
const types: Record<string, number> = {};
for (const t of tx) types[t.type] = (types[t.type] ?? 0) + 1;
const TYPES: Record<string, number> = { purchase: 1374, top_up: 16, yield_deposit: 6, swap: 8, cashback_claim: 16, borrow: 3, repayment: 4, withdrawal: 2, bridge: 2, referral: 2 };
const byKey = (o: Record<string, number>) => JSON.stringify(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0])));
check('tipos: compras, depósitos, aplicações, trocas, resgates de cashback, empréstimos, pagamentos, saques, pontes e indicações', byKey(types) === byKey(TYPES), JSON.stringify(types));
check('16 meses (jul/2025 a out/2026), todos com compras', new Set(tx.filter((t) => t.type === 'purchase').map((t) => t.date.slice(0, 7))).size === 16);
check('a conta abre com um depósito, antes da primeira compra', tx[0].type === 'top_up' && tx[0].date < tx.find((t) => t.type === 'purchase')!.date);

console.log('\n== cartões ==');
check('3 cartões: um físico, dois virtuais, um congelado', d.cards.length === 3 && d.cards.filter((c) => c.type === 'physical').length === 1
  && d.cards.filter((c) => c.type === 'virtual').length === 2 && d.cards.filter((c) => c.status === 'frozen').length === 1);
check('toda compra com cartão casa com um cartão; cada cartão tem compras', tx.filter((t) => t.cardId).every((t) => d.cards.some((c) => c.id === t.cardId))
  && d.cards.every((c) => tx.some((t) => t.type === 'purchase' && t.cardId === c.id)));
const frozen = d.cards.find((c) => c.status === 'frozen')!;
check('o cartão congelado não tem compra depois de maio', tx.filter((t) => t.cardId === frozen.id).every((t) => t.date < '2026-05-01'));
check('viagens no cartão Travel', tx.filter((t) => t.type === 'purchase' && t.city).every((t) => t.cardId === 'c2'));

console.log('\n== totais de compras ==');
check('7 dias: 713.58', sum(purchases('2026-10-06T00:00:00Z', '2026-10-12T23:59:59Z')) === 713.58);
check('30 dias: 3425.38 em 91 linhas', sum(purchases('2026-09-13T00:00:00Z', '2026-10-12T23:59:59Z')) === 3425.38 && purchases('2026-09-13T00:00:00Z', '2026-10-12T23:59:59Z').length === 91);
check('90 dias: 13429.33', sum(purchases('2026-07-15T00:00:00Z', '2026-10-12T23:59:59Z')) === 13429.33);
check('tudo: 60145.12 (~40% acima dos 43014.07 da versão anterior)', sum(tx.filter((t) => t.type === 'purchase')) === 60145.12);
const TARGET: Record<string, number> = {
  '2025-07': 3140, '2025-08': 3340, '2025-09': 3230, '2025-10': 3610, '2025-11': 4270, '2025-12': 5270,
  '2026-01': 2930, '2026-02': 3050, '2026-03': 5610, '2026-04': 3460, '2026-05': 3670, '2026-06': 3140,
  '2026-07': 3910, '2026-08': 3570, '2026-09': 6070,
};
const spentIn = (ym: string) => sum(tx.filter((t) => t.type === 'purchase' && t.status !== 'void' && t.date.startsWith(ym)));
const offTarget = Object.entries(TARGET).filter(([ym, target]) => Math.abs(spentIn(ym) - target) > 8);
check('cada mês inteiro no alvo do gerador (até US$ 8), viagens e dezembro acima', offTarget.length === 0, offTarget.map(([ym]) => `${ym}: ${spentIn(ym)}`).join(', '));
check('estornos: Amazon e Target, cada um do mesmo valor de uma compra anterior', ['Amazon', 'Target'].every((m) => tx.some((r) => r.merchant === m && r.amountUsd < 0
  && tx.some((p) => p.merchant === m && p.amountUsd === -r.amountUsd && p.date < r.date))));
check('duas compras anuladas (pré-autorização cancelada e uma recusada na viagem)', tx.filter((t) => t.type === 'purchase' && t.status === 'void').length === 2
  && tx.some((t) => t.status === 'void' && t.city === 'Tokyo'));

console.log('\n== viagens ==');
const clusters: Transaction[][] = [];
let cur: Transaction[] = [];
for (const t of tx.filter((x) => x.type === 'purchase' && x.status !== 'void' && (x.currency !== 'USD' || x.city))) {
  if (cur.length && (Date.parse(t.date) - Date.parse(cur[cur.length - 1].date)) / DAY <= 4) cur.push(t);
  else {
    if (cur.length >= 3) clusters.push(cur);
    cur = [t];
  }
}
if (cur.length >= 3) clusters.push(cur);
const trips = clusters.map((c) => `${c[0].date.slice(0, 10)}|${[...new Set(c.map((t) => t.city).filter(Boolean))].join('>')}|${[...new Set(c.map((t) => t.currency))].sort().join('+')}|${c.length}|${sum(c)}`);
check('3 viagens: Cidade do México (MXN), Londres e Paris (GBP, EUR), Tóquio (JPY)', trips.join(' ; ') === [
  '2025-11-06|Mexico City|MXN+USD|9|917.53',
  '2026-03-12|London>Paris|EUR+GBP+USD|13|3047.6',
  '2026-09-04|Tokyo|JPY+USD|10|2841.44',
].join(' ; '), trips.join(' ; '));
const dcc = tx.filter((t) => t.type === 'purchase' && t.currency === 'USD' && t.city === 'Tokyo' && t.category !== 'Travel');
check('DCC provável: uma compra em US$ numa loja de Tóquio, no meio da viagem', dcc.length === 1 && dcc[0].merchant === 'Ginza Camera'
  && tx.some((t) => t.currency === 'JPY' && t.city === 'Tokyo' && Math.abs(Date.parse(t.date) - Date.parse(dcc[0].date)) <= 2 * DAY));

console.log('\n== o que o demo existe para mostrar ==');
const ue = tx.filter((t) => t.merchant === 'Uber Eats' && t.amount === 38.4 && t.date.startsWith('2026-10-08'));
check('duplicata: 2 pedidos iguais do Uber Eats em 2 minutos', ue.length === 2 && Date.parse(ue[1].date) - Date.parse(ue[0].date) <= 2 * 60000);
const shellBig = tx.find((t) => t.merchant === 'Shell' && t.amount === 186.2);
const shellHist = tx.filter((t) => t.merchant === 'Shell' && t.amountUsd < 100);
check('muito acima do normal: Shell 186.20 contra 15 abastecimentos abaixo de 100', Boolean(shellBig) && shellHist.length === 15 && shellBig!.date.startsWith('2026-10-09'));
const booking = tx.find((t) => t.merchant === 'Harborview Hotel' && t.status === 'pending');
const pendingDays = booking ? Math.floor((Date.parse(`${REF}T23:59:59Z`) - Date.parse(booking.date)) / DAY) : -1;
check('pendente há 9 dias: a reserva do Harborview Hotel', booking?.amountUsd === 412 && pendingDays === 9, `${booking?.amountUsd} · ${pendingDays} dias`);
check('primeira vez: Juniper Books só aparece no fim', tx.filter((t) => t.merchant === 'Juniper Books').map((t) => t.date.slice(0, 10)).join() === '2026-10-10');

console.log('\n== assinaturas (nas linhas cruas) ==');
const charges = (m: string) => tx.filter((t) => t.type === 'purchase' && t.merchant === m && t.status !== 'void');
const net = charges('Netflix');
check('aumento: Netflix 17.99 até setembro, 19.99 na última renovação', net.at(-1)?.amount === 19.99 && net.slice(0, -1).every((t) => t.amount === 17.99) && net.length === 16);
check('Spotify subiu em fevereiro (11.99 → 12.99) e seguiu', charges('Spotify Premium').filter((t) => t.date < '2026-02').every((t) => t.amount === 11.99)
  && charges('Spotify Premium').filter((t) => t.date > '2026-02').every((t) => t.amount === 12.99));
check('parou de cobrar: a academia, a última em abril', charges('FitLab Gym').at(-1)?.date.startsWith('2026-04-01') === true && charges('FitLab Gym').length === 10);
check('sobreposição: Claude e ChatGPT, os dois ativos em outubro ou setembro', charges('Claude.ai').at(-1)!.date >= '2026-09' && charges('ChatGPT Plus').at(-1)!.date >= '2026-10');
check('anual: Kestrel Notes duas vezes, com um ano entre elas', charges('Kestrel Notes').map((t) => t.date.slice(0, 10)).join() === '2025-10-01,2026-10-01');
check('clube: Uber One desde janeiro, e corridas de Uber em todo mês', charges('Uber One')[0]?.date.startsWith('2026-01') === true
  && new Set(charges('Uber').filter((t) => t.currency === 'USD').map((t) => t.date.slice(0, 7))).size === 16);
check('o cartão congelado tirou as assinaturas dele: depois de maio vão para o Everyday', charges('Netflix').filter((t) => t.date >= '2026-05').every((t) => t.cardId === 'c1'));
// os casos fictícios que o vídeo mostra (datas relativas ao referenceDate)
check('anual que renova hoje: FitPal 119.99 duas vezes, com um ano entre elas, a última no referenceDate', charges('FitPal').map((t) => `${t.date.slice(0, 10)}:${t.amount}`).join() === `2025-10-12:119.99,${REF}:119.99`);
check('renova em 2 dias: StreamBox 15.99 todo mês, a última em 14/09', charges('StreamBox').every((t) => t.amount === 15.99) && charges('StreamBox').at(-1)?.date.startsWith('2026-09-14') === true
  && charges('StreamBox').length === 7);
check('anual cara (≥ US$ 100) que renova em 3 semanas: PhotoVault, uma cobrança só, em 02/11/2025', charges('PhotoVault').map((t) => `${t.date.slice(0, 10)}:${t.amount}`).join() === '2025-11-02:129.99');
check('parou sem email: LinguaLeap todo mês de janeiro a agosto, nada depois', charges('LinguaLeap').length === 8 && charges('LinguaLeap').at(-1)?.date.startsWith('2026-08-20') === true);
check('teste grátis que virou cobrança: MindHarbor, a primeira e única cobrança no dia em que o teste acabou', charges('MindHarbor').map((t) => t.date.slice(0, 10)).join() === '2026-10-05'
  && d.subscriptionSources?.evidence?.items.some((i) => i.name === 'MindHarbor' && i.kind === 'trial_ending' && i.periodEnd === '2026-10-05') === true);
check('plano de celular sem categoria conhecida (o nome diz "Wireless"), todo mês', charges('Pinecell Wireless').length === 16 && charges('Pinecell Wireless').every((t) => t.category === 'Utilities'));
// cada assinatura com preço de tabela casa com a base pública (1%), para os cartões de Economia aparecerem com fonte
const book = (service: string, amount: number, terms = false) => PRICE_BOOK.some((e) => e.service === service && e.country === 'US' && e.currency === 'USD'
  && (terms ? (e.terms ?? []).some((x) => Math.abs(x.total - amount) <= amount * 0.01) : e.monthly !== undefined && Math.abs(e.monthly - amount) <= amount * 0.01));
check('preços da base pública (EUA): Claude Pro, Netflix, Spotify, YouTube pela loja e Uber One', book('claude-anthropic', charges('Claude.ai').at(-1)!.amount)
  && book('netflix', 19.99) && book('spotify', 12.99) && book('youtube', charges('YouTube Premium').at(-1)!.amount) && book('uber-one', charges('Uber One').at(-1)!.amount));

console.log('\n== conta, carteira e crédito ==');
const holdingSum = R2(d.portfolio.holdings.reduce((s, h) => s + h.dollarValue, 0));
check('conta no formato do conector: totalBalance = soma dos ativos, com nome e saldo completo', d.account.totalBalance === holdingSum && d.portfolio.totalValue === holdingSum
  && Boolean(d.account.accountLabel) && !d.account.balancePartial);
check('o saldo que o vídeo mostra: US$ 25,561.00', d.account.totalBalance === 25561, String(d.account.totalBalance));
const classes = new Set(d.portfolio.holdings.map((h) => assetClassOf(h).cls));
check('as 5 classes de ativo, tudo pela tabela (com fonte)', ['fiat', 'crypto', 'stocks', 'bonds', 'commodities'].every((c) => classes.has(c as never))
  && d.portfolio.holdings.every((h) => assetClassOf(h).basis === 'known'));
check('fiat em dólar (USDC e o cofre liquidUSD) e um pouco em euro (EURC)', assetClassOf({ asset: 'EURC' }).currency === 'EUR'
  && d.portfolio.holdings.some((h) => h.asset === 'EURC') && d.portfolio.holdings.filter((h) => h.vault).map((h) => h.asset).join() === 'liquidUSD');
check('cripto com BTC: weETH, WETH, eBTC e ETHFI', ['weETH', 'WETH', 'eBTC', 'ETHFI'].every((a) => d.portfolio.holdings.some((h) => h.asset === a)));
const GROUP_IDS = ['liquidVaults', 'value-accruing', 'crypto'];
check('os 3 grupos do app, todo ativo num deles, com nome e rede', JSON.stringify(d.portfolio.groups?.map((g) => g.id)) === JSON.stringify(GROUP_IDS)
  && d.portfolio.holdings.every((h) => GROUP_IDS.includes(h.groupId ?? '') && Boolean(h.name) && h.chainId !== undefined));
// os embrulhados (wSPYx...) usam o parâmetro do xStock publicado (SPYx...)
const params = (asset: string) => COLLATERAL[asset] ?? COLLATERAL[asset.replace(/^w/, '')];
check('LTV de cada ativo = o Product LTV publicado, abaixo do fator de colateral', d.portfolio.holdings.every((h) => h.ltv === params(h.asset)?.productLtv && h.ltv! <= params(h.asset)!.cf));
const collateral = d.portfolio.holdings.filter((h) => h.backsSpending);
const cfLimit = R2(collateral.reduce((s, h) => s + h.dollarValue * params(h.asset)!.cf, 0));
check('limite = Σ valor × fator de colateral publicado (o limite de liquidação, como numa conta real)', d.account.creditLimit === cfLimit, `${d.account.creditLimit} vs ${cfLimit}`);
const borrows = R2(of('borrow').reduce((s, t) => s + t.amount, 0));
const repays = R2(of('repayment').reduce((s, t) => s + t.amount, 0));
check('empréstimos − pagamentos = emprestado da conta (3500)', R2(borrows - repays) === 3500 && d.account.amountBorrowed === 3500);
check('poder de compra = Σ valor × Product LTV − emprestado (Borrow Mode)', d.account.availableBalance === R2(collateral.reduce((s, h) => s + h.dollarValue * h.ltv!, 0) - 3500));
const usePct = (d.account.amountBorrowed / d.account.creditLimit) * 100;
check('crédito em uso visível (entre 10% e 30%)', usePct >= 10 && usePct <= 30, `${R2(usePct)}%`);
check('empréstimos e pagamentos espalhados no histórico (3 e 4, em 7 meses)', of('borrow').length === 3 && of('repayment').length === 4
  && new Set([...of('borrow'), ...of('repayment')].map((t) => t.date.slice(0, 7))).size === 7);
check('variedade na carteira: rende e garante, só garante, não garante, sem quantidade',
  d.portfolio.holdings.some((h) => (h.apy ?? 0) > 0 && h.backsSpending) && d.portfolio.holdings.some((h) => !h.apy && h.backsSpending)
  && d.portfolio.holdings.some((h) => !h.backsSpending) && d.portfolio.holdings.some((h) => h.quantity === undefined));

console.log('\n== movimentos ==');
let flow = 0;
let minFlow = Infinity;
for (const t of tx) {
  if (t.status === 'void') continue;
  if (t.type === 'top_up' && t.status === 'settled') flow += t.amountUsd;
  else if (t.type === 'withdrawal' && t.status === 'settled') flow -= t.amountUsd;
  else if (t.type === 'purchase') flow -= t.amountUsd;
  else if ((t.type === 'cashback_claim' || t.type === 'referral') && t.status === 'settled') flow += t.amountUsd;
  minFlow = Math.min(minFlow, flow);
}
const netWorth = R2(holdingSum - d.account.amountBorrowed);
const gap = netWorth - R2(flow);
check('o fluxo líquido acumulado nunca fica negativo', minFlow >= 0, R2(minFlow).toString());
check('patrimônio líquido − fluxo líquido: positivo e abaixo de 10% (rendimento e preço)', gap > 0 && gap < netWorth * 0.1, `${R2(gap)} de ${netWorth}`);
const ups = of('top_up');
check('toda aplicação no rendimento vem até 10 minutos depois de um depósito de valor igual ou maior', of('yield_deposit')
  .every((y) => ups.some((u) => u.amount >= y.amount && Date.parse(y.date) - Date.parse(u.date) > 0 && Date.parse(y.date) - Date.parse(u.date) <= 10 * 60000)));
const claims = of('cashback_claim');
check('resgate de cashback em 15 meses, o último ainda a confirmar', new Set(claims.filter((t) => t.status === 'settled').map((t) => t.date.slice(0, 7))).size === 15
  && claims.at(-1)?.status === 'pending');
check('uma troca colada (1 minuto) a um resgate: a perna do resgate', of('swap').some((s) => claims.some((c) => Math.abs(Date.parse(s.date) - Date.parse(c.date)) <= 5 * 60000)));
check('indicações: uma paga e uma a confirmar', of('referral').map((t) => t.status).join() === 'settled,pending');
check('trocas para cada classe da carteira, pontes e saques', ['weETH', 'PAXG', 'wSPYx', 'wQQQx', 'EURC', 'wTBLLx', 'eBTC'].every((tok) => of('swap').some((s) => s.token === tok))
  && of('bridge').length === 2 && of('withdrawal').length === 2);

console.log('\n== retrato da importação anterior ==');
const snap = validateSnapshot(d.previousSnapshot);
check('retrato válido, antes do referenceDate, com a última transação que ele via', Boolean(snap) && snap!.at < `${REF}T00:00:00Z`
  && snap!.lastTxAt === tx.filter((t) => t.date <= snap!.at).reduce((m, t) => Math.max(m, Date.parse(t.date)), 0));
check('retrato: emprestado de antes = de hoje + os pagamentos depois dele', snap!.borrowed === 3500 + R2(of('repayment').filter((t) => Date.parse(t.date) > snap!.lastTxAt).reduce((s, t) => s + t.amount, 0)));
const since = sinceSnapshot(snap, enrichDataset(d), new Date('2026-10-12T20:00:00Z'));
check('desde a importação: o extrato explica tudo menos os 170 de preço e rendimento', since !== null && Math.abs(since.unexplained - 170) < 0.02, String(since?.unexplained));

console.log('\n== arquivos da IA ==');
const src = d.subscriptionSources!;
const ev = validateEvidenceFile(src.evidence);
const rs = validateKnowledgeFile(src.research);
const au = validateAuditFile(src.audit);
check('email, pesquisa e auditoria passam pela validação sem descarte', Boolean(ev.value && rs.value && au.value) && ev.dropped + rs.dropped + au.dropped === 0);
check('emails: renovação anual avisada e cobrada, cancelamento da academia, fim do teste grátis e o recibo da anual sem aviso',
  src.evidence!.items.map((i) => `${i.name}:${i.kind}`).join() === 'Kestrel Notes:renewal_notice,Kestrel Notes:receipt,FitLab Gym:cancellation,MindHarbor:trial_ending,FitPal:receipt');
check('sem lembrete: nenhum aviso de renovação da FitPal nem da PhotoVault, e nenhum email de cancelamento da LinguaLeap',
  !src.evidence!.items.some((i) => (i.name === 'FitPal' || i.name === 'PhotoVault') && i.kind === 'renewal_notice') && !src.evidence!.items.some((i) => i.name === 'LinguaLeap'));
const audit = (name: string) => src.audit!.items.find((i) => i.name === name);
check('auditoria: reembolso em 30 dias na Kestrel, risco alto na academia', audit('Kestrel Notes')?.refundWindowDays === 30 && audit('FitLab Gym')?.risk === 'high');
check('auditoria: FitPal e PhotoVault renovam sozinhas, sem aviso, com risco alto; a FitPal reembolsa em 14 dias', ['FitPal', 'PhotoVault'].every((n) => audit(n)?.autoRenew === 'yes'
  && audit(n)?.noticeBeforeRenewal === 'no' && audit(n)?.risk === 'high') && audit('FitPal')?.refundWindowDays === 14);
check('pesquisa: os 5 serviços fictícios novos, cada um com o link de gerenciar', ['FitPal', 'PhotoVault', 'StreamBox', 'LinguaLeap', 'MindHarbor']
  .every((n) => src.research!.items.some((i) => i.name === n && Boolean(i.manageUrl))));
check('só serviços fictícios nos arquivos da IA (domínios .example)', [...src.research!.items.flatMap((i) => [...i.sources, ...(i.domains ?? [])]), ...src.audit!.items.flatMap((i) => i.sources.filter((s) => s.startsWith('http')))]
  .every((u) => /\.example(\/|$)/.test(u)));

console.log('\n== depósito e privacidade ==');
const validAddress = /^0x[0-9a-fA-F]{40}$/;
check('endereço do demo visivelmente inválido (ninguém manda fundos para ele por engano)',
  !validAddress.test(d.account.vaultAddress) && !validAddress.test(d.deposit.address) && d.deposit.address.length > 0);
check('depósito: rede de cada ativo está na lista de redes', (d.deposit.assetNetworks ?? []).every((a) => a.networks.every((n) => d.deposit.networks.includes(n))));
check('fontes marcadas como presentes', Object.values(d.sources ?? {}).length === 5 && Object.values(d.sources ?? {}).every(Boolean));

console.log('\n== demo visto hoje (shiftDemo) ==');
check('hoje = referenceDate: o mesmo objeto', shiftDemo(d, d.referenceDate) === d);
setFormatLocale('en');
const baseline = enrichDataset(d);
const alertsOf = (x: Dataset) => detectAnomalies(x, detectSubscriptions(x)).map((a) => `${a.kind}:${a.merchant}`).sort().join(' | ');
const subsOf = (x: Dataset) => analyzeSubscriptions(x, { knowledge: SUBSCRIPTION_KNOWLEDGE }).records.map((r) => `${r.name}:${r.status}:${r.cycle}:${r.justRenewed?.refundDaysLeft ?? ''}`).sort().join(' | ');
const baseAlerts = alertsOf(baseline);
const baseSubs = subsOf(baseline);
// dias que mudam o calendário de jeitos diferentes: mês de 31, fevereiro, ano bissexto, virada de ano
for (const today of ['2026-10-18', '2026-12-31', '2027-03-01', '2028-02-29', '2029-07-15']) {
  const s = shiftDemo(d, today);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${REF}T00:00:00Z`)) / DAY);
  const label = `${today} (+${days} d)`;
  check(`${label}: referenceDate cai hoje e nenhuma data passa dele`, s.referenceDate === today && s.transactions.every((t) => t.date.slice(0, 10) <= today));
  check(`${label}: intervalos e ordem iguais`, s.transactions.every((t, i) => Date.parse(t.date) - Date.parse(tx[i].date) === days * DAY && t.id === tx[i].id));
  check(`${label}: valores iguais`, s.transactions.every((t, i) => t.amountUsd === tx[i].amountUsd && t.amount === tx[i].amount));
  check(`${label}: retrato e emails andam junto`, s.previousSnapshot!.lastTxAt === d.previousSnapshot!.lastTxAt + days * DAY
    && Date.parse(s.previousSnapshot!.at) - Date.parse(d.previousSnapshot!.at) === days * DAY
    && s.subscriptionSources!.evidence!.items.every((it, i) => Date.parse(it.emailDate) - Date.parse(src.evidence!.items[i].emailDate) === days * DAY));
  const e = enrichDataset(s);
  check(`${label}: os mesmos alertas`, alertsOf(e) === baseAlerts, alertsOf(e) === baseAlerts ? '' : alertsOf(e));
  check(`${label}: as mesmas assinaturas, status, ciclos e prazo de reembolso`, subsOf(e) === baseSubs, subsOf(e) === baseSubs ? '' : subsOf(e));
}

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
