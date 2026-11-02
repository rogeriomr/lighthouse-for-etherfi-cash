// O motor da tela Ganhos (src/lib/earnings.ts): os alvos fixos do demo, os casos de borda com dados fictícios montados
// aqui (zero Liquid, zero cashback, só resgates a confirmar, resgate único, período curto, item manual anual e em
// outra moeda, ordem fixa, exclusão, marcos cumulativos), a validação das preferências guardadas no navegador e o
// "Esquecer tudo". E as linhas vermelhas: nenhum texto recomenda, nenhum marco é de gasto. Nos dados reais, só
// invariantes, sem número nenhum na saída.
import { demoDataset } from '../src/lib/demo/dataset.ts';
import { shiftDemo } from '../src/lib/demo/shift.ts';
import { enrichDataset } from '../src/lib/enrich.ts';
import { yieldSummary } from '../src/lib/analytics.ts';
import { setFormatLocale } from '../src/lib/format.ts';
import { analyzeSubscriptions, knowledgeFor } from '../src/lib/subscriptions.ts';
import { bundleFromFiles, datasetFromBundle } from '../src/lib/rawFiles.ts';
import { forgetEverything, KEYS, readStore, writeStore } from '../src/lib/storage.ts';
import {
  allocate, buildEarnings, cashbackForecast, CLAIM_LAG_DAYS, cleanItemName, coverageOf, DEFAULT_EARNINGS_PREFS, earningsItems, manualErrorText, manualItemErrors,
  manualKey, MANUAL_LIMITS, membershipSuggestions, MILESTONE_STEPS, milestoneLadder, moveInOrder, observedRate, OBSERVED_MIN_CLAIMS, OBSERVED_MIN_DAYS, planCashback,
  PLAN_STALE_DAYS, RATE_MAX, recurringKey, removeManual, spendBase, suggestionToManual, toggleExcluded, upsertManual, validateEarningsPrefs, validateManualItem, yieldGroups,
  type Earnings, type EarningsItem, type EarningsPrefs, type ManualItem, type PlanRate, type YieldGroup,
} from '../src/lib/earnings.ts';
import { COVERAGE_TARGETS, milestoneApprox } from '../src/lib/earnings.ts';
import { applyWhatIf, whatIfErrors } from '../src/lib/earningsWhatIf.ts';
import { demoBaseline, earningsChanges, nextWhatIf, snapshotOf, validateSnapshot, type EarningsSnapshot } from '../src/lib/earningsChanges.ts';
import { earningsJson, earningsMarkdown } from '../src/lib/earningsReport.ts';
import { usd } from '../src/lib/format.ts';
import { CASHBACK_PAYOUT, CASHBACK_PLANS, CASHBACK_RATES_UPDATED } from '../src/lib/insights/cashbackPlans.ts';
import type { Locale } from '../src/lib/locale.ts';
import type { SubscriptionRecord, SubscriptionReport } from '../src/lib/subscriptionTypes.ts';
import type { Dataset, Holding, Transaction } from '../src/lib/types.ts';
import { isDataFile, resolveDataDir } from './data-dir.mjs';

declare const process: { exit(code: number): never };

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const near = (a: number | null | undefined, b: number, eps = 0.006) => typeof a === 'number' && Math.abs(a - b) <= eps;
const R2 = (n: number) => Math.round(n * 100) / 100;
/** os formatadores usam espaço não separável (US$ + U+00A0 + 300): para comparar com o texto esperado, vira espaço */
const sp = (s: string) => s.replace(/\u00a0/g, ' ');
const DAY = 86400000;
const tr = (locale: Locale) => (en: string, pt: string) => (locale === 'pt' ? pt : en);

// ---------- linhas vermelhas e coerência, para qualquer resultado ----------

const FORBIDDEN = [
  /\byou should\b/i, /\bwe recommend\b/i, /\bvocê deveria\b/i, /\brecomend(o|amos)\b/i,
  /\b(deposit|invest|move|buy|sell|spend more)\b/i, /\b(deposite|depositar|invista|investir|aplique|mova|mover|compre|venda|gaste mais|gastar mais)\b/i,
  /\bIOF\b/, /\bguarantee|garantid[oa]\b/i,
  // decisão do coordenador: o plano só aparece como "dependem do seu plano; confira", nunca como meta
  /\b(reach|get to|upgrade to|chegue ao|chegar ao|suba para|alcance o)\b/i,
];

function texts(e: Earnings): string[] {
  const t = e.texts;
  return [
    t.headline.monthly, t.headline.annual, t.note, t.rate, t.base, t.observed, t.why.sources, t.why.cashback, t.why.allocation, t.why.milestones,
    ...(e.milestones.kind === 'ladder' ? e.milestones.steps.flatMap((s) => [s.text, s.why]) : [e.milestones.text]),
    ...e.sources.map((s) => `${s.label} ${s.detail ?? ''}`),
    // as metas de 50/75/100% e o "por quê?" delas: entram no lint como as outras
    ...(e.targets.kind === 'targets' ? e.targets.targets.map((t) => t.text) : [e.targets.text]), t.why.targets,
  ];
}
const lint = (e: Earnings) => texts(e).flatMap((s) => FORBIDDEN.filter((re) => re.test(s)).map((re) => String(re)));

/**
 * O que vale para todo resultado: somas que fecham, a ordem dos estados, a escada cumulativa, nenhum texto proibido.
 * `real`: nenhum detalhe na saída (nem a sequência de estados, que diria quantos itens a pessoa tem).
 */
function invariants(e: Earnings, label: string, dataset?: Dataset, real = false) {
  const a = e.allocation;
  const srcSum = e.sources.reduce((s, x) => s + x.monthly, 0);
  check(`${label}: as fontes somam os ganhos (o fluxo fecha)`, near(srcSum, e.totalMonthly) && near(e.yield.monthly + e.cashback.monthly, e.totalMonthly));
  if (dataset) {
    const ys = yieldSummary(dataset);
    const n = e.yield.liquid.holdings.length + e.yield.other.holdings.length;
    check(`${label}: rendimento igual ao do Portfólio (yieldSummary), a menos do arredondamento por ativo`, near(e.yield.monthly, ys.monthly, 0.006 * Math.max(1, n)));
  }
  const states = a.rows.map((r) => r.status[0]).join('');
  check(`${label}: cobertos primeiro, no máximo um em parte, depois os descobertos`, /^c*p?u*$/.test(states), real ? '' : states);
  check(`${label}: pago + sobra = ganhos, no mês e no ano; pago nunca passa do custo`, (a.count === 0 || (near(a.coveredMonthly + a.leftoverMonthly, e.totalMonthly, 0.006 * Math.max(1, a.count))
    && (a.coveredAnnual > e.totalAnnual + 0.006 ? false : a.partialCount === 0 || near(a.coveredAnnual + a.leftoverAnnual, e.totalAnnual, 0.006 * Math.max(1, a.count)))))
    && a.coveredMonthly <= a.totalMonthly + 0.006 && a.rows.every((r) => r.paidMonthly <= r.item.monthly + 0.006 && r.paidAnnual <= r.item.annual + 0.006 && r.share >= 0 && r.share <= 1)
    && a.coverage >= 0 && a.coverage <= 1);
  const rc = e.receipt;
  check(`${label}: recibo fecha no centavo: cashback dos itens + resto = cashback total (mês e ano); Liquid + outros + cashback = ganhos; item fora do cartão sem cashback`,
    R2(rc.itemsCashback.monthly + (rc.rest?.cashbackMonthly ?? 0)) === (rc.itemsCashback.monthly > 0 || rc.rest ? rc.cashback.monthly : rc.itemsCashback.monthly)
    && R2(rc.itemsCashback.annual + (rc.rest?.cashbackAnnual ?? 0)) === (rc.itemsCashback.annual > 0 || rc.rest ? rc.cashback.annual : rc.itemsCashback.annual)
    && near(rc.liquid.monthly + (rc.other?.monthly ?? 0) + rc.cashback.monthly, rc.total.monthly) && rc.rows === a.rows
    && rc.rows.every((x) => x.item.onCard || x.item.cashbackMonthly === 0) && (rc.rest === null || rc.rest.spendMonthly > 0));
  check(`${label}: chaves únicas; excluído fora das linhas`, new Set(e.items.map((i) => i.key)).size === e.items.length
    && a.rows.every((r) => !r.item.excluded) && a.excluded.every((i) => i.excluded));
  if (e.milestones.kind === 'ladder') {
    const m = e.milestones;
    const steps = m.steps;
    check(`${label}: escada com até ${MILESTONE_STEPS} degraus, cumulativa e crescente, só com Liquid`, steps.length > 0 && steps.length <= MILESTONE_STEPS && m.liquidValue > 0 && m.apy > 0
      && steps.every((s, i) => s.extraRounded >= s.extra - 0.005 && near(s.extra, (s.gapMonthly * 1200) / m.apy, 0.02 + s.extra * 1e-6) && (i === 0 || (s.extra > steps[i - 1].extra && s.gapMonthly > steps[i - 1].gapMonthly))));
    check(`${label}: todo degrau é de um item ainda não coberto; nenhum cita nível de plano`, steps.every((s) => a.rows.find((r) => r.item.key === s.item.key)?.status !== 'covered'
      && !/\b(core|luxe|pinnacle|vip)\b/i.test(`${s.text} ${s.why}`.replace(s.item.name, ''))));
  }
  check(`${label}: o "por quê?" do cashback diz que as faixas dependem do plano e que o pagamento é em ETHFI`, e.texts.why.cashback.includes('ETHFI')
    && /(depend on your ether\.fi plan|dependem do seu plano na ether\.fi)/.test(e.texts.why.cashback));
  check(`${label}: textos preenchidos, nenhuma frase proibida (recomendação, depósito, "gaste mais", IOF)`, texts(e).slice(0, 10).every((s, i) => i === 5 || s.length > 0) && lint(e).length === 0, lint(e).join(', '));
}

// ---------- demo: os alvos ----------

console.log('== demo ==');
const demo = enrichDataset(demoDataset, 'en');
const report = analyzeSubscriptions(demo, { knowledge: knowledgeFor(demo), today: demo.referenceDate, locale: 'en' });
for (const locale of ['en', 'pt'] as const) {
  setFormatLocale(locale);
  const e = buildEarnings(demo, { report }, locale);
  invariants(e, `[${locale}] demo`, demo);
  if (locale === 'pt') {
    check('as âncoras do demo intactas: US$ 25.561,00, FitPal, StreamBox, Kestrel e Netflix; 17 assinaturas ativas com as caras (v2)', demo.account.totalBalance === 25561
      && report.records.filter((r) => r.status === 'active' && r.kind === 'subscription').length === 17
      && ['FitPal', 'StreamBox', 'Kestrel Notes', 'Netflix', 'Claude (Anthropic)', 'Higgsfield', 'ElevenLabs', 'Midjourney', 'Peloton'].every((n) => e.items.some((i) => i.name === n)));
    check('rendimento: liquidUSD 41,33 + outros com APY (weETH) 13,99 = 55,32 por mês', e.yield.liquid.holdings.map((h) => `${h.asset}:${h.monthly}`).join() === 'liquidUSD:41.33'
      && e.yield.other.holdings.map((h) => `${h.asset}:${h.monthly}`).join() === 'weETH:13.99' && e.yield.monthly === 55.32 && e.yield.liquid.avgApy === 6.2);
    const o = e.cashback.observed;
    check(`taxa observada nos resgates (comparação): 1,51%, 15 resgates, gasto de 01/07/2025 a 21/09/2026 (o último resgate − ${CLAIM_LAG_DAYS} dias)`, o.ok && o.method === 'claims' && o.rate === 0.0151
      && o.from === '2025-07-01' && o.to === '2026-09-21' && o.count === 15, JSON.stringify(o.ok ? { rate: o.rate, from: o.from, to: o.to, count: o.count } : o));
    check('o resgate de outubro, a confirmar, fica fora', o.ok && !o.relatedIds.some((id) => demo.transactions.find((t) => t.id === id)?.status !== 'settled'));
    check('comparação ao lado da previsão: "Taxa observada nos resgates…", e nessa taxa a base daria US$ 67,45', e.cashback.observedMonthly === 67.45
      && e.texts.observed.startsWith('Taxa observada nos resgates: US$') && e.texts.observed.includes('daria US$ 67,45 por mês'), e.texts.observed);
    check('base: média dos últimos 90 dias (15/07 a 12/10), US$ 13.208,84 sem as anuladas → US$ 4.467,16 por mês', e.cashback.base.mode === 'card' && e.cashback.base.card.days === 90
      && e.cashback.base.card.from === '2026-07-15' && e.cashback.base.card.spend === 13208.84 && e.cashback.base.monthly === 4467.16 && !e.cashback.base.lifted);
    check('previsão pelo plano Core (padrão): 2.000 × 3% + 1.000 × 1% + 1.467,16 × 0,5% = US$ 77,34 (1,73%); ganhos US$ 132,66 por mês e US$ 1.591,87 por ano',
      e.cashback.rateSource === 'plan' && e.cashback.plan?.id === 'core' && e.cashback.planIsDefault && e.cashback.monthly === 77.34 && e.cashback.rate === 0.0173
      && e.totalMonthly === 132.66 && e.totalAnnual === 1591.87, `${e.cashback.monthly} ${e.totalMonthly} ${e.totalAnnual}`);
    check('fontes do fluxo: liquidUSD, outros com APY e cashback', e.sources.map((s) => s.id).join() === 'vault:liquidUSD,other-apy,cashback');
    const a = e.allocation;
    check('17 itens, US$ 647,75 por mês (o mesmo total da aba Assinaturas)', a.count === 17 && a.totalMonthly === report.monthlyTotalUsd && a.totalMonthly === 647.75);
    check('do mais barato ao mais caro: iCloud+ primeiro, Claude Ultra por último', a.order === 'cheapest' && a.rows[0].item.name === 'iCloud+' && a.rows.at(-1)!.item.name === 'Claude (Anthropic)'
      && a.rows.every((r, i) => i === 0 || r.item.monthly >= a.rows[i - 1].item.monthly));
    check('10 cobertos, ChatGPT em parte (95%), as caras descobertas', a.coveredCount === 10 && a.partialCount === 1
      && a.rows[10].item.name === 'ChatGPT (OpenAI)' && near(a.rows[10].share, 0.945, 0.001) && a.rows.slice(11).every((r) => r.status === 'uncovered'));
    check('anual pela conta do item: Kestrel 59,99 por ano, 5,00 por mês', a.rows.some((r) => r.item.name === 'Kestrel Notes' && r.item.annual === 59.99 && r.item.monthly === 5 && r.paidAnnual === 59.99));
    check('visão anual: o item em parte fica com a sobra do ano, e pago = ganhos do ano no centavo', a.coveredAnnual === e.totalAnnual && a.leftoverAnnual === 0);
    const cov = coverageOf(a, 'subscription');
    check('atalho de Assinaturas (coverageOf): US$ 132,66 de US$ 647,75 = 20%, 10 de 17', cov.paidMonthly === 132.66 && cov.totalMonthly === 647.75 && near(cov.share, 0.2048, 0.0001)
      && cov.covered === 10 && cov.count === 17);
    // a conta de somar (v2): custo → cashback por item, o resto do cartão, o Liquid por cofre, fechando no centavo
    const r = e.receipt;
    const claude = r.rows.find((x) => x.item.name === 'Claude (Anthropic)')!;
    check('recibo: Claude Ultra US$ 200,00 → cashback ≈ US$ 3,46 (200 × 77,34 ÷ 4.467,16); Higgsfield 129 → 2,23; ElevenLabs 99 → 1,71', claude.item.monthly === 200 && claude.item.cashbackMonthly === 3.46
      && r.rows.find((x) => x.item.name === 'Higgsfield')?.item.cashbackMonthly === 2.23 && r.rows.find((x) => x.item.name === 'ElevenLabs')?.item.cashbackMonthly === 1.71);
    check('recibo: cashback dos itens US$ 11,21 + resto do cartão US$ 66,13 (sobre US$ 3.819,41) = cashback total US$ 77,34, no mês e no ano', r.itemsCashback.monthly === 11.21
      && r.rest?.spendMonthly === 3819.41 && r.rest.cashbackMonthly === 66.13 && R2(r.itemsCashback.monthly + r.rest.cashbackMonthly) === r.cashback.monthly && r.cashback.monthly === 77.34
      && R2(r.itemsCashback.annual + r.rest.cashbackAnnual) === r.cashback.annual, JSON.stringify({ items: r.itemsCashback, rest: r.rest }));
    check('recibo: Liquid em destaque, US$ 8.000,00 a 6,2% → US$ 41,33/mês; weETH à parte, US$ 13,99; ganhos US$ 132,66', r.liquid.holdings.map((h) => `${h.asset}:${h.value}:${h.apy}:${h.monthly}`).join() === 'liquidUSD:8000:6.2:41.33'
      && r.other?.monthly === 13.99 && r.total.monthly === 132.66 && R2(r.liquid.monthly + (r.other?.monthly ?? 0) + r.cashback.monthly) === r.total.monthly);
    check('recibo: o detalhe do resto e o "por quê?" com a conta', e.texts.receipt.restLabel === 'Cashback do resto do cartão' && e.texts.receipt.restDetail.startsWith('US$ 3.819,41 por mês')
      && e.texts.why.receipt.includes('Cashback de cada item = o custo dele × a taxa média') && e.texts.why.receipt.includes('liquidUSD US$ 8.000,00 × 6,2% ÷ 12 = US$ 41,33'));
    const m = e.milestones;
    check('escada: US$ 220 (o resto do ChatGPT), US$ 4.280 (YouTube), US$ 10.100 (Midjourney), ao APY de 6,2%', m.kind === 'ladder' && m.apy === 6.2
      && m.steps.map((s) => `${s.item.name}:${s.extraRounded}`).join() === 'ChatGPT (OpenAI):220,YouTube:4280,Midjourney:10100' && m.steps[0].wasPartial,
      m.kind === 'ladder' ? m.steps.map((s) => `${s.item.name}:${s.extraRounded}`).join() : m.kind);
    check('frase do marco: "Com mais US$ 220 rendendo no Liquid, ao APY de hoje, os ganhos cobririam também…"', m.kind === 'ladder'
      && m.steps[0].text.startsWith('Com mais US$ 220 rendendo no Liquid, ao APY de hoje, os ganhos cobririam também ChatGPT (OpenAI) por inteiro'), m.kind === 'ladder' ? m.steps[0].text : '');
    check('demo sem anuidade de nível no extrato: nenhuma sugestão', e.suggestions.length === 0);
    check('resumo: "Seus ganhos cobrem 10 de 17 assinaturas por inteiro e parte de mais 1"', e.texts.headline.monthly.startsWith('Seus ganhos cobrem 10 de 17 assinaturas por inteiro e parte de mais 1:')
      && e.texts.headline.annual.includes('por ano'));
    check('aviso fixo: "Estimativa · o APY varia · não é recomendação"', e.texts.note === 'Estimativa · o APY varia · não é recomendação');

    // o demo visto hoje: a base é uma janela móvel e a taxa vai de resgate a resgate, então andar o calendário não muda nada
    const shifted = enrichDataset(shiftDemo(demoDataset, '2026-11-01'), 'pt');
    const es = buildEarnings(shifted, {}, 'pt');
    check('demo visto hoje (shiftDemo): mesmos ganhos, mesma alocação, mesma escada, mesmo recibo', es.totalMonthly === e.totalMonthly && es.cashback.rate === e.cashback.rate
      && es.allocation.rows.map((x) => `${x.item.key}:${x.paidMonthly}:${x.item.cashbackMonthly}`).join() === a.rows.map((x) => `${x.item.key}:${x.paidMonthly}:${x.item.cashbackMonthly}`).join()
      && es.receipt.rest?.cashbackMonthly === r.rest?.cashbackMonthly
      && JSON.stringify(es.milestones.kind === 'ladder' ? es.milestones.steps.map((s) => s.extraRounded) : []) === JSON.stringify(m.kind === 'ladder' ? m.steps.map((s) => s.extraRounded) : []));

    // preferências sobre o demo
    const onlyRec = buildEarnings(demo, { report, prefs: { ...DEFAULT_EARNINGS_PREFS, base: 'recurring' } }, 'pt');
    check('base "só recorrências": US$ 647,75, toda na 1ª faixa do Core (3%) = US$ 19,43; sem a linha do resto, e as linhas dos itens somam o total', onlyRec.cashback.base.monthly === 647.75
      && onlyRec.cashback.monthly === 19.43 && onlyRec.receipt.rest === null && onlyRec.receipt.itemsCashback.monthly === 19.43 && onlyRec.receipt.itemsCashback.annual === onlyRec.cashback.annual);
    const custom = buildEarnings(demo, { report, prefs: { ...DEFAULT_EARNINGS_PREFS, rate: 0.02 } }, 'pt');
    check('taxa própria (2%): vale ela, a do plano continua dita e a frase neutra do plano fica no "por quê?"', custom.cashback.rateSource === 'custom' && custom.cashback.rate === 0.02
      && custom.cashback.autoRate === 0.0173 && custom.texts.rate.includes('Sem ela, 1,73% (plano Core)') && custom.texts.why.cashback.includes('confira o seu no app'), custom.texts.rate);
    const luxeDemo = buildEarnings(demo, { report, prefs: { ...DEFAULT_EARNINGS_PREFS, tier: 'luxe' } }, 'pt');
    check('seletor de plano (Luxe): 4.467,16 × 3% = US$ 134,01, e os ganhos vão a US$ 189,33', luxeDemo.cashback.plan?.id === 'luxe' && !luxeDemo.cashback.planIsDefault
      && luxeDemo.cashback.monthly === 134.01 && luxeDemo.totalMonthly === 189.33, `${luxeDemo.cashback.monthly} ${luxeDemo.totalMonthly}`);
    const exclClaude = buildEarnings(demo, { report, prefs: { ...DEFAULT_EARNINGS_PREFS, excluded: [claude.item.key] } }, 'pt');
    check('excluir o Claude Ultra: sai das linhas, o cashback dele vai para o resto do cartão e o total não muda', !exclClaude.receipt.rows.some((x) => x.item.key === claude.item.key)
      && exclClaude.cashback.monthly === e.cashback.monthly && exclClaude.receipt.rest?.spendMonthly === R2(3819.41 + 200)
      && R2(exclClaude.receipt.itemsCashback.monthly + exclClaude.receipt.rest.cashbackMonthly) === e.cashback.monthly && exclClaude.texts.why.receipt.includes('Os itens excluídos continuam pagos no cartão'));
  }
}

// ---------- dados fictícios ----------

const REF = '2026-10-18';
let seq = 0;
const tx = (day: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++seq}`, type: 'purchase', status: 'settled', date: `${day}T15:00:00Z`, amount: 100, currency: 'USD', amountUsd: 100, ...extra,
});
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Uma compra de US$ 100 por dia, de from a to */
const daily = (from: string, to: string, usd = 100): Transaction[] => {
  const out: Transaction[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(tx(d, { amount: usd, amountUsd: usd }));
  return out;
};
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const monthEnd = (ym: string) => `${ym}-${lastDay(ym)}`;
/**
 * Resgates como a ether.fi faz: o do dia d paga rate × o gasto que já destravou, de (resgate anterior − atraso) a
 * (d − atraso); o primeiro, desde `start`. O atraso é CLAIM_LAG_DAYS (liquidação + trava de 7 dias)
 */
const lagClaims = (rows: Transaction[], days: string[], rate: number, start = '2026-01-01', extra: Partial<Transaction> = {}): Transaction[] => days.map((d, i) => {
  const from = i === 0 ? start : addDays(days[i - 1], 1 - CLAIM_LAG_DAYS);
  const to = addDays(d, -CLAIM_LAG_DAYS);
  const spent = rows.filter((t) => t.date.slice(0, 10) >= from && t.date.slice(0, 10) <= to).reduce((s, t) => s + t.amountUsd, 0);
  return tx(d, { type: 'cashback_claim', amount: R2(spent * rate), amountUsd: R2(spent * rate), token: 'ETHFI', ...extra });
});
const holding = (asset: string, dollarValue: number, extra: Partial<Holding> = {}): Holding => ({ asset, dollarValue, backsSpending: true, ...extra });
const HOLDINGS = [
  holding('liquidUSD', 12000, { apy: 5, groupId: 'liquidVaults', vault: true }),
  holding('liquidETH', 6000, { apy: 3, groupId: 'liquidVaults', vault: true }),
  holding('weETH', 4000, { apy: 3, groupId: 'value-accruing' }),
  holding('USDC', 1000, { groupId: 'crypto' }),
];
const ds = (over: Partial<Dataset> = {}): Dataset => ({
  referenceDate: REF,
  account: { totalBalance: 23000, creditLimit: 0, amountBorrowed: 0, vaultAddress: '', currency: 'USD' },
  cards: [],
  portfolio: { totalValue: 23000, holdings: HOLDINGS },
  deposit: { address: '', networks: [], assets: [] },
  transactions: [],
  homeCurrency: 'USD',
  coverage: { from: '2026-01-01T00:00:00Z', to: `${REF}T23:59:59Z`, complete: true },
  ...over,
});
const EMPTY_REPORT: SubscriptionReport = { records: [], upcoming: [], alerts: [], monthlyTotalUsd: 0, annualTotalUsd: 0 };
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const spend = daily('2026-01-01', REF);
const claims2 = lagClaims(spend, MONTHS.map(monthEnd), 0.02);
const manual = (id: string, name: string, amount: number, extra: Partial<ManualItem> = {}): ManualItem => ({ id, name, amount, currency: 'USD', cycle: 'monthly', onCard: false, ...extra });
const PLAN: PlanRate = { id: 'core', label: 'Core', rate: 0.01, default: true, source: { label: 'ether.fi · plano', url: 'https://help.ether.fi/exemplo', checked: '2026-10-30' } };
const PLAN_LUXE: PlanRate = { id: 'luxe', label: 'Luxe', rate: 0.03, source: { label: 'ether.fi · plano', url: 'https://help.ether.fi/exemplo', checked: '2026-10-30' } };
setFormatLocale('pt');

console.log('\n== rendimento por cofre ==');
const yg = yieldGroups(ds());
check('cofres Liquid um por um (liquidUSD 50, liquidETH 15), outros com APY à parte (weETH 10), USDC sem APY fora', yg.liquid.holdings.map((h) => `${h.asset}:${h.monthly}`).join() === 'liquidUSD:50,liquidETH:15'
  && yg.other.holdings.map((h) => `${h.asset}:${h.monthly}`).join() === 'weETH:10' && yg.liquid.monthly === 65 && yg.other.monthly === 10);
check('APY médio ponderado dos cofres Liquid: (600 + 180) ÷ 18.000 = 4,33%', yg.liquid.avgApy === 4.33 && yg.liquid.value === 18000);
check('cofre pelo símbolo liquid* mesmo sem o grupo da fonte', yieldGroups(ds({ portfolio: { totalValue: 1000, holdings: [holding('liquidBTC', 1000, { apy: 2 })] } })).liquid.holdings.length === 1);

console.log('\n== taxa observada ==');
const base = ds({ transactions: [...spend, ...claims2] });
const o1 = observedRate(base);
check(`histórico desde a abertura: do começo ao último resgate − ${CLAIM_LAG_DAYS} dias, todos os resgates → 2%`, o1.ok && o1.rate === 0.02 && o1.method === 'claims' && o1.from === '2026-01-01'
  && o1.to === '2026-09-21' && o1.count === 9, JSON.stringify(o1));
const o2 = observedRate({ ...base, coverage: { ...base.coverage!, complete: false } });
check('histórico incompleto: do primeiro resgate − atraso ao último − atraso, o primeiro fica fora → 2%', o2.ok && o2.rate === 0.02 && o2.from === '2026-01-23' && o2.count === 8, JSON.stringify(o2));
const one = lagClaims(spend, ['2026-03-31'], 0.02);
check(`um resgate só, mesmo com o histórico desde a abertura: recusa (few_claims, menos de ${OBSERVED_MIN_CLAIMS}) e cai na tabela do plano`, (() => {
  const d = ds({ transactions: [...spend, ...one] });
  const o = observedRate(d);
  const c = cashbackForecast(d, [], DEFAULT_EARNINGS_PREFS, [PLAN]);
  return !o.ok && o.reason === 'few_claims' && o.count === 1 && c.rateSource === 'plan';
})());
check('dois resgates, histórico incompleto: recusa (few_claims) e diz quantos', (() => {
  const d = ds({ transactions: [...spend, ...lagClaims(spend, ['2026-03-31', '2026-06-30'], 0.02)], coverage: { from: '2026-01-01T00:00:00Z', to: REF, complete: false } });
  const o = observedRate(d);
  return !o.ok && o.reason === 'few_claims' && buildEarnings(d, { report: EMPTY_REPORT }, 'pt').texts.observed === 'Taxa observada nos resgates: ainda não dá para medir (há só 2 resgates de cashback (são precisos 3: o resgate vem em bloco, quando você escolhe)).';
})());
check('três resgates no mesmo dia, histórico incompleto: recusa (não se sabe de que período são)', (() => {
  const same = [1, 2, 3].map(() => tx('2026-06-30', { type: 'cashback_claim', amount: 20, amountUsd: 20 }));
  const o = observedRate(ds({ transactions: [...spend, ...same], coverage: { from: '2026-01-01T00:00:00Z', to: REF, complete: false } }));
  return !o.ok && o.reason === 'few_claims' && o.count === 3;
})());
const augOn = daily('2026-08-01', REF);
const shortSet = ds({
  transactions: [...augOn, ...lagClaims(augOn, ['2026-08-31', '2026-09-30', '2026-10-15'], 0.02, '2026-08-01')],
  coverage: { from: '2026-08-01T00:00:00Z', to: REF, complete: true },
});
check(`período curto (3 resgates, gasto de 01/08 a 06/10 = 67 dias, menos de ${OBSERVED_MIN_DAYS}): recusa e diz quantos dias`, (() => { const o = observedRate(shortSet); return !o.ok && o.reason === 'short_period' && o.days === 67; })());
check('só resgate a confirmar: recusa (pending_only)', (() => { const o = observedRate(ds({ transactions: [...spend, ...lagClaims(spend, ['2026-09-30'], 0.02, '2026-01-01', { status: 'pending' })] })); return !o.ok && o.reason === 'pending_only'; })());
check('nenhum cashback: recusa (no_cashback); indicação não conta', (() => { const o = observedRate(ds({ transactions: [...spend, tx('2026-05-01', { type: 'referral', amount: 25, amountUsd: 25 })] })); return !o.ok && o.reason === 'no_cashback'; })());
check('linhas omitidas pelo conector: recusa (dropped_rows)', (() => { const o = observedRate({ ...base, coverage: { ...base.coverage!, droppedRows: true } }); return !o.ok && o.reason === 'dropped_rows'; })());
check('resgate de 20% do gasto: recusa (implausible) e guarda o resultado', (() => { const o = observedRate(ds({ transactions: [...spend, ...lagClaims(spend, MONTHS.map(monthEnd), 0.2)] })); return !o.ok && o.reason === 'implausible' && o.rate === 0.2; })());
check('resgates sem gasto correspondente: recusa (no_spend)', (() => {
  const o = observedRate(ds({ transactions: ['2026-04-30', '2026-05-31', '2026-06-30'].map((d) => tx(d, { type: 'cashback_claim', amount: 30, amountUsd: 30 })) }));
  return !o.ok && o.reason === 'no_spend';
})());
check('resgate anulado não conta', (() => { const o = observedRate(ds({ transactions: [...spend, ...claims2, tx('2026-09-15', { type: 'cashback_claim', status: 'void', amount: 500, amountUsd: 500 })] })); return o.ok && o.rate === 0.02; })());
const credited = ds({ transactions: [...spend, ...spend.map((t) => tx(t.date.slice(0, 10), { type: 'cashback', amount: 1, amountUsd: 1 }))] });
check('cashback por compra (linhas cashback): na janela da base, 1%', (() => { const o = observedRate(credited); return o.ok && o.method === 'credits' && o.rate === 0.01 && o.days === 90; })());

console.log('\n== base de gasto e taxa ==');
const sb = spendBase(base, [], 'card');
check('base do cartão: US$ 100 por dia nos últimos 90 dias → 100 × 30,44 = US$ 3.043,75 por mês', sb.monthly === 3043.75 && sb.card.days === 90 && sb.card.from === addDays(REF, -89));
const young = ds({ transactions: daily(addDays(REF, -9), REF), coverage: { from: `${addDays(REF, -9)}T00:00:00Z`, to: REF, complete: true } });
const ys = spendBase(young, [], 'card');
check('histórico de 10 dias: sem média do cartão (short_history), cashback zero e o texto diz por quê', ys.monthly === null && ys.card.reason === 'short_history'
  && buildEarnings(young, { report: EMPTY_REPORT }, 'pt').cashback.monthly === 0 && buildEarnings(young, { report: EMPTY_REPORT }, 'pt').texts.base.includes('só 10 dias'));
const noRate = buildEarnings(ds({ transactions: spend }), { report: EMPTY_REPORT, plans: [] }, 'pt');
check('zero cashback: sem tabela de plano nem taxa observada → taxa nenhuma, cashback 0, e o texto diz que dá para escolher uma taxa própria', noRate.cashback.rate === null && noRate.cashback.rateSource === 'none'
  && noRate.cashback.monthly === 0 && !noRate.sources.some((s) => s.kind === 'cashback') && noRate.texts.rate.includes('Dá para escolher uma taxa própria'));
invariants(noRate, 'zero cashback');
const withPlan = cashbackForecast(ds({ transactions: spend }), [], DEFAULT_EARNINGS_PREFS, [PLAN, PLAN_LUXE]);
check('sem nível escolhido: a pública do plano padrão (Core 1%)', withPlan.rateSource === 'plan' && withPlan.rate === 0.01 && withPlan.plan?.id === 'core');
check('nível escolhido pela pessoa: o plano dele (Luxe 3%)', cashbackForecast(ds({ transactions: spend }), [], { ...DEFAULT_EARNINGS_PREFS, tier: 'luxe' }, [PLAN, PLAN_LUXE]).rate === 0.03);
check('plano com fonte fora de https fica de fora', cashbackForecast(ds({ transactions: spend }), [], DEFAULT_EARNINGS_PREFS, [{ ...PLAN, source: { ...PLAN.source, url: 'http://x' } }]).rateSource === 'none');
check('a previsão é a do plano; a observada fica ao lado, como comparação (base × 2%)', (() => {
  const c = cashbackForecast(base, [], DEFAULT_EARNINGS_PREFS, [PLAN]);
  return c.rateSource === 'plan' && c.observed.ok && c.observedMonthly === R2(3043.75 * 0.02);
})());
check('sem tabela de plano, a observada vira a previsão', cashbackForecast(base, [], DEFAULT_EARNINGS_PREFS, []).rateSource === 'observed');
check('taxa própria em 0%: vale (cashback zero), não volta ao plano', (() => { const c = cashbackForecast(base, [], { ...DEFAULT_EARNINGS_PREFS, rate: 0 }, [PLAN]); return c.rateSource === 'custom' && c.rate === 0 && c.monthly === 0 && c.autoRate === 0.01; })());
// a tabela da pesquisa (CASHBACK_PLAN_RATES) é o padrão: faixas do mês civil, Core para quem não diz o nível
const core = buildEarnings(ds({ transactions: spend }), { report: EMPTY_REPORT }, 'pt');
check('plano padrão da pesquisa (Core) pelas faixas: 2.000 × 3% + 1.000 × 1% + 43,75 × 0,5% = US$ 70,22 (2,31% na média)', core.cashback.rateSource === 'plan'
  && core.cashback.plan?.id === 'core' && core.cashback.planIsDefault && core.cashback.monthly === 70.22 && core.cashback.rate === 0.0231 && core.cashback.unpricedSpend === 0, `${core.cashback.monthly} ${core.cashback.rate}`);
check('texto do plano: as faixas, a fonte com a data, o Core por falta de escolha e a frase neutra do coordenador', core.texts.rate.includes('3% até US$ 2.000 de gasto no mês, 1% até US$ 3.000, 0,5% acima')
  && core.texts.rate.includes('conferidas em') && core.texts.rate.includes('Sem plano escolhido, vale o Core')
  && core.texts.rate.endsWith('As faixas de cashback dependem do seu plano na ether.fi (Core, Luxe…); confira o seu no app.')
  && core.texts.observed === 'Taxa observada nos resgates: ainda não dá para medir (ainda não há cashback no histórico).', core.texts.rate);
check('pago em ETHFI, travado 7 dias, resgate manual a partir de US$ 5: o "por quê?" diz', core.texts.why.cashback.includes('pago em ETHFI, e o valor em US$ muda com o preço do token')
  && core.texts.why.cashback.includes('travado 7 dias') && core.texts.why.cashback.includes('a partir de US$ 5'));
const luxe = cashbackForecast(ds({ transactions: spend }), [], { ...DEFAULT_EARNINGS_PREFS, tier: 'luxe' });
check('nível Luxe informado: 3% até US$ 10.000 → US$ 91,31, e não é mais "o padrão"', luxe.plan?.id === 'luxe' && luxe.monthly === 91.31 && !luxe.planIsDefault);
check('faixa com fim e sem taxa acima (VIP): o gasto acima fica sem preço, fora da conta', (() => {
  const v = planCashback({ ...PLAN, bands: [{ upToUsd: 50000, rate: 0.04 }] }, 60000);
  return v.usd === 2000 && v.unpriced === 10000 && near(v.effectiveRate, 2000 / 60000, 1e-9);
})());
check('sem faixas: gasto × taxa', planCashback(PLAN, 1000).usd === 10);
check(`tabela conferida há mais de ${PLAN_STALE_DAYS} dias: "pode ter mudado"`, cashbackForecast(ds({ transactions: spend }), [], DEFAULT_EARNINGS_PREFS, [{ ...PLAN, source: { ...PLAN.source, checked: '2026-01-02' } }]).planStale
  && !cashbackForecast(ds({ transactions: spend }), [], DEFAULT_EARNINGS_PREFS, [PLAN]).planStale);

console.log('\n== recorrências: manuais, anuais, outra moeda, detectadas ==');
const annual = manual('a1', 'Seguro', 120, { cycle: 'annual', onCard: true });
const itemsA = earningsItems(ds(), EMPTY_REPORT, { ...DEFAULT_EARNINGS_PREFS, manual: [annual, manual('m1', 'Aluguel', 1500)] });
const seg = itemsA.items.find((i) => i.key === manualKey('a1'));
check('item manual anual: 120 por ano = 10 por mês, ciclo anual', seg?.monthly === 10 && seg.annual === 120 && seg.cycle === 'annual' && seg.origin === 'manual');
const sbManual = spendBase(base, itemsA.items, 'card');
check('item manual pago no cartão entra na base (média + 10); o que não é no cartão, não', sbManual.manualOnCard === 10 && sbManual.monthly === 3053.75);
check('base "só recorrências": só os itens pagos no cartão', spendBase(base, itemsA.items, 'recurring').monthly === 10 && spendBase(base, itemsA.items, 'recurring').recurring.count === 1);
const brlRows = Array.from({ length: 6 }, (_, i) => tx(addDays(REF, -10 - i), { amount: 500, currency: 'BRL', amountUsd: 100 }));
const brl = earningsItems(ds({ homeCurrency: 'BRL', transactions: brlRows }), EMPTY_REPORT, { ...DEFAULT_EARNINGS_PREFS, manual: [manual('b1', 'Academia', 50, { currency: 'BRL' })] });
check('item em reais: convertido pelo câmbio recente das compras (R$ 5 = US$ 1) e marcado "≈"', brl.items[0]?.monthly === 10 && brl.items[0].approx);
const noFx = earningsItems(ds(), EMPTY_REPORT, { ...DEFAULT_EARNINGS_PREFS, manual: [manual('b1', 'Academia', 50, { currency: 'BRL' })] });
check('item em reais sem câmbio para converter: fica fora, sem preço (no_fx)', noFx.items.length === 0 && noFx.unpriced[0]?.reason === 'no_fx');
const rec = (key: string, extra: Partial<SubscriptionRecord>): SubscriptionRecord => ({
  key, name: key, kind: 'subscription', status: 'active', cycle: 'monthly', monthlyCostUsd: 10, annualCostUsd: 120, costApprox: false, ...extra,
} as unknown as SubscriptionRecord);
const fakeReport: SubscriptionReport = {
  ...EMPTY_REPORT,
  records: [
    rec('stream', { monthlyCostUsd: 9.99, annualCostUsd: 119.88 }),
    rec('aluguel', { kind: 'bill', monthlyCostUsd: 1000, annualCostUsd: 12000 }),
    rec('parou', { status: 'cancelled' }),
    rec('nao-e', { decision: { choice: 'not_subscription', at: '2026-10-01T00:00:00Z' } }),
    rec('sem-ciclo', { cycle: 'unknown', monthlyCostUsd: 0, annualCostUsd: 0 }),
    rec('stream', { name: 'stream 2', monthlyCostUsd: 5, annualCostUsd: 60 }),
  ],
};
const det = earningsItems(ds(), fakeReport, DEFAULT_EARNINGS_PREFS);
check('detectados: só os ativos, sem "não é assinatura"; conta recorrente como bill; pagos no cartão', det.items.map((i) => `${i.key}:${i.origin}`).join() === 'rec:stream:subscription,rec:aluguel:bill,rec:stream~2:subscription'
  && det.items.every((i) => i.onCard));
check('ciclo desconhecido sem custo: fica fora, sem preço (unknown_cost)', det.unpriced.map((u) => `${u.key}:${u.reason}`).join() === 'rec:sem-ciclo:unknown_cost');
const withBill = buildEarnings(ds({ transactions: [...spend, ...claims2] }), { report: fakeReport }, 'pt');
check('com conta recorrente na lista, o resumo fala em "itens", não em "assinaturas"', !withBill.allocation.allSubscriptions && withBill.texts.headline.monthly.includes('itens'));
invariants(withBill, 'com conta recorrente');

console.log('\n== alocação: ordem, exclusão, parcial ==');
const it = (key: string, monthly: number, extra: Partial<EarningsItem> = {}): EarningsItem => ({
  key, name: key, origin: 'manual', cycle: 'monthly', monthly, annual: monthly * 12, approx: false, onCard: false, excluded: false, cashbackMonthly: 0, cashbackAnnual: 0, ...extra,
});
const ABCD = [it('D', 40), it('B', 20), it('C', 30), it('A', 10)];
const al = allocate(ABCD, 45);
check('do mais barato ao mais caro: A e B inteiros, C pela metade, D sem nada, sobra zero', al.rows.map((r) => `${r.item.key}:${r.status}:${r.paidMonthly}`).join() === 'A:covered:10,B:covered:20,C:partial:15,D:uncovered:0'
  && al.rows[2].share === 0.5 && al.leftoverMonthly === 0 && al.coveredMonthly === 45 && al.order === 'cheapest');
const fixedOrder = allocate(ABCD, 45, { order: ['D', 'A'] });
check('ordem fixa: D e A primeiro, nessa ordem; os outros depois, do mais barato', fixedOrder.order === 'custom' && fixedOrder.rows.map((r) => `${r.item.key}:${r.status}`).join() === 'D:covered,A:partial,B:uncovered,C:uncovered');
const excl = allocate(ABCD.map((i) => (i.key === 'B' ? { ...i, excluded: true } : i)), 45);
check('exclusão: B sai das linhas e do total e fica listado à parte', excl.rows.map((r) => r.item.key).join() === 'A,C,D' && excl.excluded.map((i) => i.key).join() === 'B'
  && excl.totalMonthly === 80 && excl.rows[2].status === 'partial');
check('ganhos acima do total: tudo coberto e a sobra aparece', (() => { const x = allocate(ABCD, 130); return x.coveredCount === 4 && x.leftoverMonthly === 30 && x.leftoverAnnual === 360; })());
check('ordem com chave que não existe mais: ignorada', allocate(ABCD, 45, { order: ['sumiu'] }).order === 'cheapest');

console.log('\n== marcos ==');
const liquid = (value: number, avgApy: number): YieldGroup => ({ id: 'liquid', value, avgApy, monthly: (value * avgApy) / 1200, annual: (value * avgApy) / 100, holdings: [] });
const lad = milestoneLadder(al, 45, liquid(10000, 5), tr('pt'));
check('marcos cumulativos: C precisa de +15/mês (US$ 3.600 a 5%), C e D juntos de +55/mês (US$ 13.200)', lad.kind === 'ladder'
  && lad.steps.map((s) => `${s.item.key}:${s.gapMonthly}:${s.extra}:${s.extraRounded}`).join() === 'C:15:3600:3600,D:55:13200:13200' && lad.steps[0].wasPartial && !lad.steps[1].wasPartial);
check('o texto do marco é informativo ("cobririam"), com o valor arredondado para cima', lad.kind === 'ladder' && lad.steps[1].text === 'Com mais US$ 13.200 rendendo no Liquid, ao APY de hoje, os ganhos cobririam também D.'
  && lad.steps[1].why.includes('cumulativo'));
const many = allocate([it('A', 1), it('B', 2), it('C', 3), it('D', 4), it('E', 5)], 0.5);
check(`no máximo ${MILESTONE_STEPS} degraus`, (() => { const m = milestoneLadder(many, 0.5, liquid(1000, 4), tr('pt')); return m.kind === 'ladder' && m.steps.length === MILESTONE_STEPS; })());
check('arredondamento: abaixo de US$ 10 mil na dezena, acima na centena, sempre para cima', (() => {
  const m = milestoneLadder(allocate([it('X', 17.45)], 0), 0, liquid(8000, 6.2), tr('pt'));
  const big = milestoneLadder(allocate([it('Y', 74.72)], 0), 0, liquid(8000, 6.2), tr('pt'));
  return m.kind === 'ladder' && m.steps[0].extra === 3377.42 && m.steps[0].extraRounded === 3380 && big.kind === 'ladder' && big.steps[0].extraRounded === 14500;
})());
const noLiquid = milestoneLadder(al, 45, liquid(0, 0), tr('pt'));
check('zero Liquid: nenhum marco, só a linha neutra "Sem saldo rendendo no Liquid hoje."', noLiquid.kind === 'no_liquid' && noLiquid.text === 'Sem saldo rendendo no Liquid hoje.');
check('cofre Liquid sem APY informado: também sem marco', milestoneLadder(al, 45, liquid(5000, 0), tr('pt')).kind === 'no_liquid');
check('tudo coberto: sem escada, com a sobra', milestoneLadder(allocate(ABCD, 130), 130, liquid(1000, 5), tr('pt')).kind === 'all_covered');
check('nada para cobrir: sem escada', milestoneLadder(allocate([], 10), 10, liquid(1000, 5), tr('pt')).kind === 'no_items');
const noLiq = buildEarnings(ds({ transactions: [...spend, ...claims2], portfolio: { totalValue: 4000, holdings: [holding('weETH', 4000, { apy: 3 })] } }), { report: fakeReport }, 'pt');
check('conta sem Liquid: o rendimento dos outros continua, a escada não aparece', noLiq.milestones.kind === 'no_liquid' && noLiq.yield.other.monthly === 10 && noLiq.yield.liquid.value === 0);
invariants(noLiq, 'sem Liquid');
for (const locale of ['en', 'pt'] as const) {
  setFormatLocale(locale);
  const full = buildEarnings(ds({ transactions: [...spend, ...claims2] }), {
    report: fakeReport,
    prefs: { ...DEFAULT_EARNINGS_PREFS, manual: [annual, manual('m1', 'Aluguel', 1500)], excluded: [recurringKey('aluguel')], order: [manualKey('a1')] },
  }, locale);
  invariants(full, `[${locale}] fictício completo (manual anual, exclusão, ordem fixa)`);
  check(`[${locale}] ordem fixa respeitada e exclusão fora da conta`, full.allocation.rows[0].item.key === manualKey('a1') && full.allocation.excluded.map((i) => i.key).join() === recurringKey('aluguel'));
}
setFormatLocale('pt');
const empty = buildEarnings(ds({ portfolio: { totalValue: 0, holdings: [] } }), { report: EMPTY_REPORT }, 'pt');
check('conta vazia: estado vazio, resumo neutro', empty.empty && empty.texts.headline.monthly === 'Ainda não há recorrências para cobrir.' && empty.milestones.kind === 'no_items');

console.log('\n== anuidade de nível comprado (recorrência sugerida) ==');
const member = (merchant: string, usd: number, day = '2026-03-10', extra: Partial<Transaction> = {}) => tx(day, { merchant, merchantRaw: merchant.toUpperCase(), amount: usd, amountUsd: usd, ...extra });
const sug = membershipSuggestions(ds({ transactions: [member('ether.fi Luxe membership', 199)] }), DEFAULT_EARNINGS_PREFS);
check('cobrança "ether.fi Luxe" de US$ 199 no cartão: sugere "ether.fi Luxe", anual, pago no cartão, com a linha de prova', sug.length === 1 && sug[0].id === 'ethfi-luxe'
  && sug[0].name === 'ether.fi Luxe' && sug[0].amount === 199 && sug[0].cycle === 'annual' && sug[0].onCard && sug[0].evidenceIds.length === 1);
check('aceitar a sugestão vira um item manual válido', validateManualItem(suggestionToManual(sug[0])) !== undefined);
check('sem prova não sugere: outro valor, sem o nome do nível, sem a ether.fi, há mais de 400 dias, ou já adicionado', [
  [member('ether.fi Luxe membership', 150)], [member('ether.fi membership', 199)], [member('Luxe Spa', 199)], [member('ether.fi Luxe', 199, '2025-08-01')],
].every((rows) => membershipSuggestions(ds({ transactions: rows }), DEFAULT_EARNINGS_PREFS).length === 0)
  && membershipSuggestions(ds({ transactions: [member('ether.fi Luxe', 199)] }), { ...DEFAULT_EARNINGS_PREFS, manual: [suggestionToManual(sug[0])] }).length === 0);
check('Pinnacle de US$ 999 também; resgate de cashback com esse valor, não', membershipSuggestions(ds({ transactions: [member('ETHER.FI PINNACLE', 999)] }), DEFAULT_EARNINGS_PREFS)[0]?.plan === 'pinnacle'
  && membershipSuggestions(ds({ transactions: [member('ether.fi Pinnacle', 999, '2026-03-10', { type: 'cashback_claim' })] }), DEFAULT_EARNINGS_PREFS).length === 0);
check('a sugestão chega no buildEarnings e fica fora da conta até a pessoa aceitar', (() => {
  const e = buildEarnings(ds({ transactions: [...spend, member('ether.fi Luxe membership', 199)] }), { report: EMPTY_REPORT }, 'pt');
  return e.suggestions.length === 1 && !e.items.some((i) => i.key === manualKey('ethfi-luxe'));
})());

console.log('\n== formulário do item manual ==');
check('erros por campo: nome vazio, valor zero, moeda inválida, ciclo semanal', manualItemErrors({ name: '  ', amount: 0, currency: 'brl', cycle: 'weekly' }).map((x) => `${x.field}:${x.code}`).join()
  === 'name:name_empty,amount:amount_invalid,currency:currency_invalid,cycle:cycle_invalid');
check('valor acima do teto: amount_too_big; item certo: nenhum erro', manualItemErrors({ name: 'Aluguel', amount: MANUAL_LIMITS.amount + 1, cycle: 'monthly' })[0]?.code === 'amount_too_big'
  && manualItemErrors({ name: 'Aluguel', amount: 1500, currency: 'BRL', cycle: 'annual' }).length === 0);
check('texto de cada erro nos dois idiomas', (['name_empty', 'amount_invalid', 'amount_too_big', 'currency_invalid', 'cycle_invalid'] as const)
  .every((c) => manualErrorText(c, 'en').length > 0 && manualErrorText(c, 'pt').length > 0 && manualErrorText(c, 'en') !== manualErrorText(c, 'pt')));

console.log('\n== preferências guardadas no navegador ==');
check('lixo ou outra versão: vale o padrão', validateEarningsPrefs(null) === undefined && validateEarningsPrefs([]) === undefined && validateEarningsPrefs({ version: 2 }) === undefined);
const dirty = validateEarningsPrefs({
  version: 1, base: 'recurring', rate: 0.5, tier: 'gold', period: 'annual',
  manual: [manual('ok', '  Academia‮  nova\n', 49.999), { id: 'ok', name: 'dup', amount: 1, cycle: 'monthly', onCard: true }, { id: 'x y', name: 'n', amount: 1, cycle: 'monthly', onCard: true },
    { id: 'neg', name: 'n', amount: -5, cycle: 'monthly', onCard: true }, { id: 'cyc', name: 'n', amount: 5, cycle: 'weekly', onCard: true }, { id: 'brl', name: 'Luz', amount: 200, currency: 'BRL', cycle: 'monthly', onCard: false }],
  excluded: ['rec:a', 'rec:a', 7, 'x'.repeat(200)], order: [],
});
check('descarta só o estragado: taxa fora de 0–10%, nível desconhecido, item repetido, id inválido, valor negativo, ciclo semanal', dirty !== undefined && dirty.base === 'recurring' && dirty.rate === undefined
  && dirty.tier === undefined && dirty.period === 'annual' && dirty.manual.map((m) => m.id).join() === 'ok,brl' && dirty.excluded.join() === 'rec:a' && dirty.order === undefined);
check('nome limpo (sem marca de direção nem quebra de linha) e valor em centavos', dirty?.manual[0].name === 'Academia nova' && dirty.manual[0].amount === 50 && cleanItemName('a'.repeat(100)).length === MANUAL_LIMITS.name);
check(`taxa válida guardada (até ${RATE_MAX * 100}%), arredondada a 0,01%`, validateEarningsPrefs({ version: 1, rate: 0.012345 })?.rate === 0.0123);
check('item manual: o formulário passa pela mesma validação', validateManualItem({ id: 'a', name: '', amount: 1, cycle: 'monthly', onCard: true }) === undefined
  && validateManualItem({ id: 'a', name: 'x', amount: MANUAL_LIMITS.amount + 1, cycle: 'monthly', onCard: true }) === undefined);
let p: EarningsPrefs = DEFAULT_EARNINGS_PREFS;
p = upsertManual(p, manual('m1', 'Aluguel', 1500));
p = upsertManual(p, manual('m1', 'Aluguel novo', 1600));
p = toggleExcluded(p, manualKey('m1'));
p = { ...p, order: moveInOrder(['rec:a', manualKey('m1'), 'rec:b'], manualKey('m1'), -5) };
check('ajudantes: editar troca pelo id, excluir alterna, mover respeita os limites', p.manual.length === 1 && p.manual[0].name === 'Aluguel novo' && p.excluded.join() === manualKey('m1')
  && p.order?.join() === `${manualKey('m1')},rec:a,rec:b` && toggleExcluded(p, manualKey('m1')).excluded.length === 0);
const removed = removeManual(p, 'm1');
check('remover o item tira também a exclusão e a posição dele', removed.manual.length === 0 && removed.excluded.length === 0 && removed.order?.join() === 'rec:a,rec:b');
check('item inválido não entra; o limite de itens é respeitado', upsertManual(DEFAULT_EARNINGS_PREFS, manual('', 'x', 1)) === DEFAULT_EARNINGS_PREFS
  && upsertManual({ ...DEFAULT_EARNINGS_PREFS, manual: Array.from({ length: MANUAL_LIMITS.items }, (_, i) => manual(`i${i}`, 'x', 1)) }, manual('novo', 'y', 1)).manual.length === MANUAL_LIMITS.items);

// o storage.ts no Node: um localStorage de mentira em window, como o navegador teria
const mem = () => {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(),
  };
};
(globalThis as unknown as { window: unknown }).window = { localStorage: mem(), sessionStorage: mem() };
const saved: EarningsPrefs = { ...DEFAULT_EARNINGS_PREFS, rate: 0.02, manual: [manual('m1', 'Aluguel', 1500, { onCard: true })], excluded: ['rec:x'] };
writeStore(KEYS.earnings, saved);
const back = readStore(KEYS.earnings, DEFAULT_EARNINGS_PREFS, validateEarningsPrefs);
check('grava em lighthouse:v1:earnings-prefs e lê de volta igual', KEYS.earnings === 'earnings-prefs' && JSON.stringify(back) === JSON.stringify(saved)
  && (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.getItem('lighthouse:v1:earnings-prefs') !== null);
await forgetEverything();
check('"Esquecer tudo" apaga as preferências da tela Ganhos', readStore(KEYS.earnings, DEFAULT_EARNINGS_PREFS, validateEarningsPrefs) === DEFAULT_EARNINGS_PREFS
  && (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.getItem('lighthouse:v1:earnings-prefs') === null);

// ---------- a IA da pessoa: metas, "e se", "o que mudou", o resumo em texto e o npm run earnings ----------

/**
 * O que vale para qualquer resultado, também nos dados reais (sem número na saída): as metas de 50/75/100% cobrem
 * mesmo (aplicar o valor "≈" a mais dá a fração), cada degrau da escada cobre o item dele, o cenário não mexe no
 * cashback nem no dataset original, e o resumo em texto traz o total e todos os itens.
 */
function aiInvariants(e: Earnings, dataset: Dataset, label: string, report: SubscriptionReport, locale: Locale, prefs?: EarningsPrefs) {
  const opts = { report, ...(prefs ? { prefs } : {}) };
  const t = e.targets;
  if (t.kind === 'targets') {
    check(`${label}: metas 50/75/100% em ordem, com a conta dos marcos (falta × 12 ÷ APY) e o "≈" para cima`, t.targets.length === COVERAGE_TARGETS.length
      && t.targets.every((x, i) => x.share === COVERAGE_TARGETS[i] && near(x.earningsMonthly, R2(t.costMonthly * x.share))
        && (x.reached ? x.extra === 0 && e.totalMonthly >= x.earningsMonthly - 0.005 : near(x.extra, ((x.earningsMonthly - e.totalMonthly) * 1200) / t.apy, 0.02 + x.extra * 1e-6))
        && x.approxExtra >= x.extra - 0.005 && x.approxTotal >= x.liquidTotal - 0.005 && (i === 0 || (x.extra >= t.targets[i - 1].extra && x.coveredCount >= t.targets[i - 1].coveredCount))));
    const ok = t.targets.filter((x) => !x.reached).every((x) => {
      const se = buildEarnings(applyWhatIf(dataset, { extraLiquidUsd: x.approxExtra }), opts, locale);
      return se.allocation.coverage >= x.share - 1e-6 && se.allocation.coveredCount >= x.coveredCount && se.cashback.monthly === e.cashback.monthly;
    });
    check(`${label}: com o valor "≈" a mais no Liquid, os ganhos pagam mesmo 50%, 75% e 100% (e o cashback não muda)`, ok);
  }
  if (e.milestones.kind === 'ladder') {
    const steps = e.milestones.steps;
    const ok = steps.every((s, k) => {
      const se = buildEarnings(applyWhatIf(dataset, { extraLiquidUsd: milestoneApprox(s.extra) }), opts, locale);
      // o degrau k (a partir de 0) é cumulativo: cobre o item dele e os k anteriores da escada
      return se.allocation.rows.find((r) => r.item.key === s.item.key)?.status === 'covered' && se.allocation.coveredCount >= e.allocation.coveredCount + k + 1;
    });
    check(`${label}: cada degrau da escada, aplicado como "e se", cobre o item dele`, ok);
  }
  const before = JSON.stringify(dataset.portfolio.holdings);
  const sApy = buildEarnings(applyWhatIf(dataset, { liquidApy: 1 }), opts, locale);
  check(`${label}: "e se" com outro APY: o cashback fica, o dataset original não muda`, sApy.cashback.monthly === e.cashback.monthly && JSON.stringify(dataset.portfolio.holdings) === before
    && sApy.yield.liquid.holdings.every((h) => h.apy === 1));
  const tr2 = (en: string, pt: string) => (locale === 'pt' ? pt : en);
  const snap = snapshotOf(e, dataset.referenceDate);
  check(`${label}: a foto volta igual do JSON e não tem mudança contra si mesma`, JSON.stringify(validateSnapshot(JSON.parse(JSON.stringify(snap)))) === JSON.stringify(snap)
    && earningsChanges(snap, snap, tr2).length === 0);
  const md = earningsMarkdown(e, { locale, date: dataset.referenceDate, data: 'real', ...(prefs ? { prefs } : {}) });
  const js = earningsJson(e, { locale, date: dataset.referenceDate, data: 'real' });
  check(`${label}: o resumo para a IA traz o total, todos os itens e as regras; o JSON fecha com o motor`, md.includes(usd(e.totalMonthly)) && e.allocation.rows.every((r) => md.includes(r.item.name.replace(/\|/g, '\\|')))
    && /## (For the AI reading this|Para a IA que ler isto)/.test(md) && js.receipt.total.monthly === e.totalMonthly && js.receipt.items.length === e.allocation.count
    && js.coverage.coveredCount === e.allocation.coveredCount && JSON.parse(JSON.stringify(js)).kind === 'lighthouse.earnings');
  const lines = [...earningsChanges(snap, snapshotOf(sApy, dataset.referenceDate), tr2, 'scenario').map((c) => c.text), nextWhatIf(e, tr2) ?? ''];
  const bad = lines.flatMap((s) => FORBIDDEN.filter((re) => re.test(s)).map(String));
  check(`${label}: frases do "o que mudou" e do "e se" sem nada proibido`, bad.length === 0, bad.join(', '));
}

console.log('\n== a IA da pessoa: metas, "e se", "o que mudou", resumo e npm run earnings ==');
for (const locale of ['en', 'pt'] as const) {
  setFormatLocale(locale);
  const rep = analyzeSubscriptions(demo, { knowledge: knowledgeFor(demo), today: demo.referenceDate, locale });
  const e = buildEarnings(demo, { report: rep }, locale);
  aiInvariants(e, demo, `[${locale}] demo`, rep, locale);
  if (locale === 'pt') {
    const t = e.targets;
    check('demo: metas no Liquid de ≈ US$ 45.100 (50%), 76.400 (75%) e 107.700 (100%), hoje US$ 8.000', t.kind === 'targets' && t.liquidValue === 8000
      && t.targets.map((x) => x.approxTotal).join() === '45100,76400,107700' && t.targets.map((x) => x.approxExtra).join() === '37100,68400,99700',
    t.kind === 'targets' ? t.targets.map((x) => `${x.approxTotal}/${x.approxExtra}`).join(' ') : t.kind);
    check('demo: a frase da meta diz o total no Liquid, o que é a mais e "ao APY de hoje"', t.kind === 'targets'
      && sp(t.targets[0].text) === '50% (US$ 323,88 por mês): com ≈ US$ 45.100 no Liquid, ≈ US$ 37.100 a mais que hoje, ao APY de hoje.', t.kind === 'targets' ? t.targets[0].text : '');
    const se = buildEarnings(applyWhatIf(demo, { extraLiquidUsd: 300 }), { report: rep }, locale);
    const ch = earningsChanges(snapshotOf(e, demo.referenceDate), snapshotOf(se, demo.referenceDate), tr('pt'), 'scenario');
    check('demo: "e se" US$ 300 a mais no Liquid → cobririam também o ChatGPT (o 1º marco)', se.allocation.coveredCount === 11 && ch.length === 1
      && sp(ch[0].text) === 'Os ganhos cobririam também ChatGPT (OpenAI).', ch.map((c) => c.text).join(' | '));
    const prev = demoBaseline(demo, { report: rep }, locale);
    const news = earningsChanges(prev, snapshotOf(e, demo.referenceDate), tr('pt'));
    check('demo: a "visita anterior" (há 30 dias) mostra o Midjourney novo, o APY do liquidUSD subindo, os ganhos e o marco mais perto', prev.at === '2026-09-12'
      && news.map((c) => c.kind).join() === 'new_item,apy,total,milestone' && sp(news[0].text) === 'Nova recorrência: Midjourney, US$ 30,00 por mês, ainda sem cobertura.'
      && sp(news[1].text) === 'O APY do liquidUSD foi de 5% para 6,2%.', news.map((c) => `${c.kind}: ${c.text}`).join(' | '));
    check('demo: o "e se" do próximo marco', sp(nextWhatIf(e, tr('pt')) ?? '') === 'Com ≈ US$ 300 a mais rendendo no Liquid, ao APY de hoje, os ganhos cobririam também ChatGPT (OpenAI) por inteiro.');
  }
}

// "o que mudou" com fotos montadas aqui: cobertura que entra e sai, preço, item à mão (não vira aviso), limiares
{
  const T = tr('pt');
  setFormatLocale('pt');
  const item = (key: string, name: string, monthly: number, status: 'covered' | 'partial' | 'uncovered', extra: Partial<{ share: number; manual: true }> = {}) =>
    ({ key, name, monthly, status, share: status === 'covered' ? 1 : status === 'partial' ? 0.5 : 0, ...extra });
  const base: EarningsSnapshot = { v: 1, at: '2026-10-01', totalMonthly: 100, liquidValue: 5000, apy: { liquidUSD: 5 }, items: [item('rec:a', 'A', 10, 'covered'), item('rec:b', 'B', 20, 'covered'), item('rec:c', 'C', 80, 'partial'), item('man:m', 'Aluguel', 900, 'uncovered', { manual: true })], next: { key: 'rec:c', name: 'C', approx: 2000 } };
  const after: EarningsSnapshot = { ...base, at: '2026-11-01', totalMonthly: 104, apy: { liquidUSD: 5.1 }, items: [item('rec:a', 'A', 10, 'covered'), item('rec:b', 'B', 24, 'partial'), item('rec:c', 'C', 80, 'uncovered'), item('man:m2', 'Academia', 50, 'uncovered', { manual: true })], next: { key: 'rec:c', name: 'C', approx: 2050 } };
  const ch = earningsChanges(base, after, T);
  check('mudanças: B deixou de estar coberto, B subiu de preço; APY (0,1 ponto), total (4%) e marco (US$ 50) abaixo do limiar; item à mão não vira aviso',
    ch.map((c) => c.kind).join() === 'no_longer_covered,price' && sp(ch[0].text) === 'Seus ganhos não cobrem mais por inteiro B.' && sp(ch[1].text) === 'B foi de US$ 20,00 para US$ 24,00 por mês.' && ch[1].tone === 'attention',
    ch.map((c) => `${c.kind}: ${c.text}`).join(' | '));
  const gained = earningsChanges(after, { ...after, items: after.items.map((i) => (i.key === 'rec:b' ? { ...i, status: 'covered' as const, share: 1 } : i)) }, T);
  check('mudanças: passou a cobrir junta os nomes', gained.length === 1 && gained[0].kind === 'now_covered' && sp(gained[0].text) === 'Seus ganhos passaram a cobrir também B.' && gained[0].tone === 'good');
  const gone = earningsChanges(base, { ...base, items: base.items.filter((i) => i.key !== 'rec:a') }, T);
  check('mudanças: item detectado que sumiu da conta', gone.length === 1 && gone[0].kind === 'gone_item' && sp(gone[0].text) === 'A não está mais na conta.');
  const sc = earningsChanges(base, after, T, 'scenario');
  check('cenário: só cobertura, APY e total (nada de preço, item novo ou marco)', sc.every((c) => ['now_covered', 'no_longer_covered', 'apy', 'total'].includes(c.kind)) && sp(sc[0].text) === 'Os ganhos deixariam de cobrir por inteiro B.');
  const bads = [
    { ...base, v: 2 }, { ...base, at: '01/10/2026' }, { ...base, items: [{ ...base.items[0], name: 'A‮B' }] }, { ...base, items: [{ ...base.items[0], share: 2 }] },
    { ...base, apy: { 'x\u0000': 1 } }, { ...base, totalMonthly: -1 }, null, [], 'x',
  ];
  check('a foto lida do navegador é validada: versão, data, nome com caractere de controle, fração, APY e total', bads.every((b) => validateSnapshot(b) === undefined) && validateSnapshot(base) !== undefined);
  const noLiquid: Dataset = { ...demo, portfolio: { ...demo.portfolio, holdings: demo.portfolio.holdings.filter((h) => !/^liquid/i.test(h.asset)) } };
  check('"e se" inválido: valor negativo, APY acima de 100% e Liquid sem APY nenhum', whatIfErrors(demo, { extraLiquidUsd: -1 }).join() === 'extra_invalid'
    && whatIfErrors(demo, { liquidApy: 101 }).join() === 'apy_invalid' && whatIfErrors(noLiquid, { extraLiquidUsd: 1000 }).join() === 'no_liquid'
    && whatIfErrors(noLiquid, { extraLiquidUsd: 1000, liquidApy: 5 }).length === 0
    && buildEarnings(applyWhatIf(noLiquid, { extraLiquidUsd: 1200, liquidApy: 5 }), {}, 'pt').yield.liquid.monthly === 5);
  const noL = buildEarnings(noLiquid, {}, 'pt');
  check('sem Liquid, as metas dizem que não há APY para a conta', noL.targets.kind === 'no_liquid' && noL.targets.text.startsWith('Sem saldo rendendo no Liquid hoje'));
  const md = earningsMarkdown(buildEarnings(demo, {}, 'pt'), { locale: 'pt', date: demo.referenceDate, data: 'demo', prefs: DEFAULT_EARNINGS_PREFS });
  const mdPrefs = earningsMarkdown(buildEarnings(demo, {}, 'pt'), { locale: 'pt', date: demo.referenceDate, data: 'demo', prefs: { ...DEFAULT_EARNINGS_PREFS, tier: 'luxe' } });
  const piped = { ...DEFAULT_EARNINGS_PREFS, manual: [manual('cabo', 'Cabo | TV', 40, { onCard: true })] };
  const mdPiped = earningsMarkdown(buildEarnings(demo, { prefs: piped }, 'pt'), { locale: 'pt', date: demo.referenceDate, data: 'demo' });
  const pipes = (l: string) => (l.match(/(?<!\\)\|/g) ?? []).length;
  check('resumo: diz que é o demo; os ajustes só entram quando mudam algo; nome com "|" não quebra a tabela', md.includes('**dados de exemplo**') && !md.includes('```json')
    && mdPrefs.includes('"tier": "luxe"') && mdPiped.includes('Cabo \\| TV') && mdPiped.split('\n').filter((l) => l.startsWith('| ')).every((l) => pipes(l) === 7));
}

// o npm run earnings de verdade, num processo à parte (como a IA rodaria)
interface Spawned { status: number | null; stdout: string; stderr: string }
const cp = (process as unknown as { getBuiltinModule(id: 'node:child_process'): { spawnSync(cmd: string, args: string[], o: { encoding: 'utf8'; env?: Record<string, string | undefined> }): Spawned } }).getBuiltinModule('node:child_process');
const nodeExe = (process as unknown as { execPath: string }).execPath;
const { fileURLToPath } = (process as unknown as { getBuiltinModule(id: 'node:url'): { fileURLToPath(u: URL): string } }).getBuiltinModule('node:url');
const cli = (...args: string[]) => cp.spawnSync(nodeExe, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(new URL('./earnings.mts', import.meta.url)), ...args], { encoding: 'utf8' });
{
  setFormatLocale('en');
  const demoE = buildEarnings(demo, {}, 'en');
  const r1 = cli('--demo', '--json', '--lang', 'en');
  let j: { data?: string; receipt?: { total: { monthly: number } }; coverage?: { coveredCount: number }; targets?: { list?: { approxTotal: number }[] } } = {};
  try { j = JSON.parse(r1.stdout); } catch { /* fica vazio */ }
  check('npm run earnings -- --demo --json: os mesmos números da tela (total, cobertos, metas)', r1.status === 0 && j.data === 'demo' && j.receipt?.total.monthly === demoE.totalMonthly
    && j.coverage?.coveredCount === demoE.allocation.coveredCount && j.targets?.list?.map((x) => x.approxTotal).join() === '45100,76400,107700', `${r1.status} ${r1.stderr.slice(0, 120)}`);
  const r2 = cli('--demo', '--lang', 'pt', '--extra-liquid', '300', '--add', 'Academia=49,90', '--add', 'Seguro=1200/ano,fora');
  check('npm run earnings: "e se" e itens à mão pelo terminal', r2.status === 0 && sp(r2.stdout).includes('## E se: US$ 300 a mais no Liquid') && sp(r2.stdout).includes('Academia (adicionado à mão)')
    && sp(r2.stdout).includes('Seguro (adicionado à mão) · fora do cartão | US$ 100,00 (anual ÷ 12)'), r2.stderr.slice(0, 160));
  const r3 = cli('--demo', '--rate', '50');
  const r4 = cli('--demo', '--plan', 'gold');
  const r5 = cli('--demo', '--nada');
  check('npm run earnings: argumento errado sai com código 2 e uma mensagem', r3.status === 2 && r4.status === 2 && r5.status === 2 && /--rate/.test(r3.stderr) && /--plan/.test(r4.stderr));
}

// a documentação para a IA bate com o código: as faixas de cada plano, a data delas e o comando
{
  const fsx = (process as unknown as { getBuiltinModule(id: 'node:fs'): { existsSync(p: URL): boolean; readFileSync(p: URL, e: 'utf8'): string } }).getBuiltinModule('node:fs');
  const doc = new URL('../docs/ai/earnings.md', import.meta.url);
  const text = fsx.existsSync(doc) ? fsx.readFileSync(doc, 'utf8') : '';
  const missing = (['core', 'luxe', 'pinnacle', 'vip'] as const).flatMap((id) => CASHBACK_PLANS[id].bands.filter((b) => b.upToUsd !== undefined)
    .flatMap((b) => [`US$ ${b.upToUsd!.toLocaleString('en-US')}`, `US$ ${b.upToUsd!.toLocaleString('pt-BR')}`]).filter((s) => !text.includes(s)).map((s) => `${id} ${s}`));
  check('docs/ai/earnings.md: as faixas de todos os planos (EN e PT), a data delas, a trava e o mínimo de resgate', text.length > 0 && missing.length === 0
    && text.includes(CASHBACK_RATES_UPDATED) && text.includes(`${CASHBACK_PAYOUT.lockDays}`) && text.includes(`US$ ${CASHBACK_PAYOUT.minClaimUsd}`), missing.join(', '));
  const agents = new URL('../AGENTS.md', import.meta.url);
  const skill = new URL('../.claude/skills/lighthouse-earnings/SKILL.md', import.meta.url);
  const a = fsx.existsSync(agents) ? fsx.readFileSync(agents, 'utf8') : '';
  const s = fsx.existsSync(skill) ? fsx.readFileSync(skill, 'utf8') : '';
  check('AGENTS.md e a skill do Claude Code existem e apontam para o npm run earnings e o guia', a.includes('npm run earnings') && a.includes('docs/ai/earnings.md')
    && /^---\nname: lighthouse-earnings\ndescription: .+\n---/m.test(s.replace(/\r\n/g, '\n')) && s.includes('npm run earnings'));
}

// a foto vista fica no navegador, sob o namespace, e "Esquecer tudo" apaga
writeStore(KEYS.earningsSeen, { real: snapshotOf(buildEarnings(demo, {}, 'en'), demo.referenceDate) });
const ls = () => (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
check('a foto vista grava em lighthouse:v1:earnings-seen', KEYS.earningsSeen === 'earnings-seen' && ls().getItem('lighthouse:v1:earnings-seen') !== null);
await forgetEverything();
check('"Esquecer tudo" apaga a foto vista', ls().getItem('lighthouse:v1:earnings-seen') === null);

// ---------- dados reais, se houver: só invariantes e linhas vermelhas (sem número nenhum na saída) ----------
interface Fs { existsSync(p: URL): boolean; readdirSync(p: URL): string[]; readFileSync(p: URL, encoding: 'utf8'): string; statSync(p: URL): { mtimeMs: number } }
const nodeFs = (process as unknown as { getBuiltinModule(id: 'node:fs'): Fs }).getBuiltinModule('node:fs');
const data = resolveDataDir();
if (!nodeFs.existsSync(data.url)) console.log(`\n(sem dados reais em ${data.label}: pulando)`);
else {
  console.log(`\n== dados reais de ${data.label} pelo motor (só invariantes) ==`);
  const names = nodeFs.readdirSync(data.url).filter(isDataFile);
  const raws = names.map((name) => ({ name, json: JSON.parse(nodeFs.readFileSync(new URL(name, data.url), 'utf8')), modified: nodeFs.statSync(new URL(name, data.url)).mtimeMs }));
  const { bundle } = bundleFromFiles(raws);
  const today = new Date().toISOString().slice(0, 10);
  for (const locale of ['en', 'pt'] as const) {
    setFormatLocale(locale);
    let error = '';
    try {
      const live = enrichDataset(datasetFromBundle(bundle, today), locale, 'America/Sao_Paulo');
      const liveReport = analyzeSubscriptions(live, { knowledge: knowledgeFor(live), today: live.referenceDate, locale });
      const e = buildEarnings(live, { report: liveReport }, locale);
      invariants(e, `[${locale}] real`, live, true);
      const o = e.cashback.observed;
      check(`[${locale}] real: taxa observada crível (0–10%) ou um motivo para não calcular`, o.ok ? o.rate > 0 && o.rate <= 0.1 && o.days >= OBSERVED_MIN_DAYS : typeof o.reason === 'string');
      check(`[${locale}] real: os itens detectados batem com o total da aba Assinaturas`, near(e.allocation.rows.filter((r) => r.item.origin === 'subscription').reduce((s, r) => s + r.item.monthly, 0), liveReport.monthlyTotalUsd, 0.011));
      // as preferências mexendo em tudo: base, taxa, item manual anual na moeda da casa, exclusão e ordem invertida
      const keys = e.allocation.rows.map((r) => r.item.key);
      const prefs: EarningsPrefs = {
        ...DEFAULT_EARNINGS_PREFS, base: 'recurring', rate: 0.02, excluded: keys.slice(0, 1), order: [...keys].reverse(),
        manual: [manual('teste', 'Item de teste', 1200, { cycle: 'annual', currency: live.homeCurrency ?? 'USD', onCard: true })],
      };
      const e2 = buildEarnings(live, { report: liveReport, prefs, plans: [PLAN] }, locale);
      invariants(e2, `[${locale}] real com preferências`, live, true);
      check(`[${locale}] real com preferências: taxa do controle, exclusão e ordem fixa aplicadas`, e2.cashback.rateSource === 'custom' && (keys.length === 0 || e2.allocation.excluded.some((i) => i.key === keys[0]))
        && (keys.length < 3 || e2.allocation.order === 'custom'));
      aiInvariants(e, live, `[${locale}] real`, liveReport, locale);
      aiInvariants(e2, live, `[${locale}] real com preferências`, liveReport, locale, prefs);
    } catch (err) {
      error = String(err).slice(0, 80);
    }
    check(`[${locale}] real: o motor não lança`, !error, error);
  }
  setFormatLocale('en');
}

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
