// Roda purchaseHistory de verdade: demo com alvos fixos, cenário sintético (casa em BRL, estorno, cancelada)
// e a pasta de dados reais (se existir) só com invariantes, sem números pessoais no código nem na saída.
// Tudo nos dois idiomas: os números são os mesmos, só os rótulos de byPlace (e nomes descritivos) mudam.
// Regras que este check fixa:
// - mapa de calor conta só cobranças: Σ count = count e Σ total = bruto das cobranças (estorno sai quando o
//   estabelecimento processa, não quando a pessoa comprou);
// - grupo só de estorno (total <= 0) fica fora das listas, mas o total geral continua líquido:
//   Σ listados + Σ excluídos = total, e as fatias são sobre os listados (somam 1);
// - categorias saem como id (CATEGORY.x); o nome exibido é da tela, via categoryLabel;
// - hora local: com fuso, enrichDataset grava em date a hora de parede (dateUtc guarda o instante) e o mapa de calor
//   lê date sem aplicar o fuso de novo; dia, mês e hora batem com a lista; São Paulo é UTC−3 fixo desde 2019;
// - datas levam o ano quando não são do ano de referenceDate, e dateTime leva o rótulo do fuso;
// - somas comparadas com tolerância de meio centavo por parcela arredondada (R2 em cada grupo e no total).
import { isDataFile, resolveDataDir } from './data-dir.mjs';
import { demoDataset } from '../src/lib/demo/dataset.ts';
import { enrichDataset, localIso, localToday } from '../src/lib/enrich.ts';
import {
  dateRange, dateShort, dateTime, dayHeading, monthYearLabel, setFormatLocale, setFormatTimeZone, setFormatToday, tzLabel,
} from '../src/lib/format.ts';
import { assembleDataset } from '../src/lib/normalize.ts';
import { isSpend } from '../src/lib/analytics.ts';
import { CATEGORY } from '../src/lib/merchants.ts';
import { pick } from '../src/lib/locale.ts';
import { purchaseHistory } from '../src/lib/history.ts';
import type { PurchaseHistory } from '../src/lib/history.ts';
import type { Locale } from '../src/lib/locale.ts';
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
const close = (a: number, b: number, parts: number) => Math.abs(a - b) <= 0.005 * (parts + 1) + 1e-9;
// só a diferença sai na tela: nos dados reais, nunca os valores
const diff = (a: number, b: number) => `Δ ${R2(a - b)}`;
const CATEGORY_IDS = new Set<string>(Object.values(CATEGORY));
// palavra ou acento de português num rótulo em inglês
const PT_WORDS = /\b(em|moeda|casa|ou|exterior)\b|[áâãçéêíóôõú]/i;

// Oráculo sem Intl: UTC direto; São Paulo é UTC−3 fixo (sem horário de verão desde 2019)
const OFFSET_H: Record<string, number> = { UTC: 0, 'America/Sao_Paulo': -3 };
const cellOf = (iso: string, timeZone: string) => {
  const d = new Date(Date.parse(iso) + OFFSET_H[timeZone] * 3600000);
  return d.getUTCDay() * 24 + d.getUTCHours();
};
const nextYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

interface Row { key: string; total: number; count: number; share: number }

function groupChecks(label: string, items: Row[], spend: Transaction[], keyOf: (t: Transaction) => string, h: PurchaseHistory) {
  const nets = new Map<string, { total: number; count: number }>();
  for (const t of spend) {
    const g = nets.get(keyOf(t)) ?? { total: 0, count: 0 };
    g.total += t.amountUsd;
    if (t.amountUsd > 0) g.count += 1;
    nets.set(keyOf(t), g);
  }
  const kept = [...nets].filter(([, g]) => R2(g.total) > 0);
  const dropped = [...nets].filter(([, g]) => R2(g.total) <= 0);
  const byKey = new Map(items.map((i) => [i.key, i]));
  check(`${label}: lista = grupos com total > 0`, items.length === kept.length && kept.every(([k, g]) => byKey.get(k)?.total === R2(g.total) && byKey.get(k)?.count === g.count));
  const listedTotal = sum(items.map((i) => i.total));
  const droppedTotal = sum(dropped.map(([, g]) => R2(g.total)));
  check(`${label}: Σ listados + Σ só-estorno = total líquido`, close(listedTotal + droppedTotal, h.total, nets.size), diff(listedTotal + droppedTotal, h.total));
  check(`${label}: Σ cobranças listadas + excluídas = count`, sum(items.map((i) => i.count)) + sum(dropped.map(([, g]) => g.count)) === h.count);
  check(`${label}: fatias em 0..1 somando 1`, items.every((i) => i.share >= 0 && i.share <= 1) && (!items.length || Math.abs(sum(items.map((i) => i.share)) - 1) < 1e-9));
  check(`${label}: ordem decrescente por total`, items.every((x, i, a) => i === 0 || a[i - 1].total >= x.total));
}

/** Vale para qualquer dataset: é o que roda nos dados reais. */
// heatZone: o timeZone passado a purchaseHistory; null = padrão (date lida como hora de parede)
function invariants(ds: Dataset, h: PurchaseHistory, heatZone: string | null, locale: Locale) {
  console.log(`  [${locale}, ${heatZone ?? `hora de parede${ds.timeZone ? ` · ${ds.timeZone}` : ''}`}]`);
  const spend = ds.transactions.filter(isSpend);
  const charges = spend.filter((t) => t.amountUsd > 0);
  const home = ds.homeCurrency ?? 'USD';

  check('purchases = compras não canceladas', h.purchases.length === spend.length && h.purchases.every((t) => t.type === 'purchase' && t.status !== 'void'));
  check('purchases da mais recente para a mais antiga', h.purchases.every((t, i, a) => i === 0 || Date.parse(a[i - 1].date) >= Date.parse(t.date)));
  check('from/to = primeira e última compra', !spend.length || (h.from === h.purchases.at(-1)?.date && h.to === h.purchases[0]?.date));
  const days = Math.round((Date.parse(h.to.slice(0, 10)) - Date.parse(h.from.slice(0, 10))) / 86400000) + 1;
  check('days = dias corridos entre a primeira e a última (>= 1)', h.days === Math.max(1, days) && h.days >= 1);
  check('total = soma líquida (estorno abate)', h.total === R2(sum(spend.map((t) => t.amountUsd))), diff(h.total, sum(spend.map((t) => t.amountUsd))));
  check('count = cobranças', h.count === charges.length);
  check('avgTicket = total / count', h.avgTicket === (h.count ? R2(h.total / h.count) : 0));
  check('totalHome só quando a casa não é USD', home === 'USD' ? h.totalHome === null : h.totalHome !== null && Number.isFinite(h.totalHome));
  check('coverageComplete segue a cobertura', h.coverageComplete === (ds.coverage?.complete ?? true));

  const ms = h.months.map((m) => m.month);
  check('meses contínuos, do primeiro ao último sem buraco', !spend.length || (ms[0] === h.from.slice(0, 7) && ms.at(-1) === h.to.slice(0, 7) && ms.every((m, i) => i === 0 || m === nextYm(ms[i - 1]))));
  check('Σ meses = total', close(sum(h.months.map((m) => m.total)), h.total, h.months.length), diff(sum(h.months.map((m) => m.total)), h.total));
  check('Σ cobranças dos meses = count', sum(h.months.map((m) => m.count)) === h.count);
  check('mês corrente nunca é inteiro', h.months.every((m) => m.month < ds.referenceDate.slice(0, 7) || !m.full));
  check('mês antes da cobertura incompleta não é inteiro', h.months.every((m) => !m.full || !ds.coverage || ds.coverage.complete || ds.coverage.from <= `${m.month}-01T00:00:00Z`));
  check('mês em que o histórico começa depois do dia 1 nunca é inteiro', h.months.every((m) => !m.full || !ds.coverage || ds.coverage.from.slice(0, 10) <= `${m.month}-01`));
  check('com linhas omitidas, nenhum mês é inteiro', !ds.coverage?.droppedRows || h.months.every((m) => !m.full));

  groupChecks('byCategory', h.byCategory.map((g) => ({ ...g, key: g.name })), spend, (t) => t.category ?? CATEGORY.other, h);
  groupChecks('byMerchant', h.byMerchant.map((g) => ({ ...g, key: g.name })), spend, (t) => t.merchant ?? '—', h);
  groupChecks('byBrand', h.byBrand.map((g) => ({ ...g, key: g.name })), spend, (t) => t.brand ?? t.merchant ?? '—', h);
  groupChecks('byPlace', h.byPlace.map((p) => ({ ...p, key: p.currency })), spend, (t) => t.currency, h);
  check('categorias como id (byCategory, meses, estabelecimento, marca)', [
    ...h.byCategory.map((g) => g.name),
    ...h.months.flatMap((m) => m.byCategory.map((c) => c.name)),
    ...[...h.byMerchant, ...h.byBrand].map((g) => g.category ?? ''),
  ].every((id) => CATEGORY_IDS.has(id)));
  check('byPlace: "home" é a moeda da casa, e só ela', h.byPlace.every((p) => (p.key === 'home') === (p.currency === home)) && h.byPlace.every((p) => p.label));
  const usdLabel = pick(locale, 'In US dollars · online or abroad', 'Em dólar · online ou exterior');
  check('byPlace: dólar fora de casa é "online ou exterior"', home === 'USD' || h.byPlace.every((p) => p.currency !== 'USD' || (p.key === 'USD' && p.label === usdLabel)));
  if (locale === 'en') check('byPlace: nenhum português nos rótulos em inglês', h.byPlace.every((p) => !PT_WORDS.test(p.label)), h.byPlace.filter((p) => PT_WORDS.test(p.label)).map((p) => p.currency).join(', '));
  check('primeira cobrança <= última em cada grupo', [...h.byCategory, ...h.byMerchant, ...h.byBrand].every((g) => g.first && g.last && g.first <= g.last));

  check('toda compra tem marca', spend.every((t) => Boolean(t.brand)));
  check('todo pedido IFD* é da marca iFood', spend.every((t) => !/^IFD ?\*/i.test(t.merchantRaw ?? '') || t.brand === 'iFood'));
  const brandOf = new Map<string, Set<string>>();
  for (const t of spend) brandOf.set(t.merchant ?? '—', (brandOf.get(t.merchant ?? '—') ?? new Set()).add(t.brand ?? ''));
  check('cada estabelecimento cai numa marca só', [...brandOf.values()].every((s) => s.size === 1));

  check('heatmap: 168 células, índice weekday * 24 + hour', h.heatmap.length === 168 && h.heatmap.every((c, i) => c.weekday === Math.floor(i / 24) && c.hour === i % 24));
  check('heatmap: Σ count = cobranças (estorno fora)', sum(h.heatmap.map((c) => c.count)) === h.count);
  const gross = sum(charges.map((t) => t.amountUsd));
  check('heatmap: Σ total = bruto das cobranças', close(sum(h.heatmap.map((c) => c.total)), gross, 168), diff(sum(h.heatmap.map((c) => c.total)), gross));
  const expectedCells = new Array<number>(168).fill(0);
  for (const t of charges) expectedCells[heatZone ? cellOf(t.dateUtc ?? t.date, heatZone) : cellOf(t.date, 'UTC')] += 1;
  check(`heatmap: dia e hora ${heatZone ? `no fuso ${heatZone}` : 'de date, sem aplicar fuso de novo'}`, h.heatmap.every((c, i) => c.count === expectedCells[i]));

  const top = h.topPurchases;
  check('topPurchases: até 10 cobranças, da maior para a menor', top.length === Math.min(10, charges.length) && top.every((t, i) => t.amountUsd > 0 && (i === 0 || top[i - 1].amountUsd >= t.amountUsd)));
  check('topPurchases: nenhuma cobrança de fora é maior', !top.length || charges.every((t) => top.includes(t) || t.amountUsd <= top.at(-1)!.amountUsd));
}

/** Trocar o idioma só troca texto: números, ids de categoria, marcas e ordem ficam iguais. */
function sameAcrossLocales(en: PurchaseHistory, pt: PurchaseHistory) {
  const numbers = (h: PurchaseHistory) => JSON.stringify({
    total: h.total, totalHome: h.totalHome, count: h.count, days: h.days, from: h.from, to: h.to,
    months: h.months, byCategory: h.byCategory, byBrand: h.byBrand, heatmap: h.heatmap,
    byPlace: h.byPlace.map(({ label: _label, ...p }) => p),
    merchants: h.byMerchant.map((g) => [g.total, g.count, g.category]),
    purchases: h.purchases.map((t) => t.id), top: h.topPurchases.map((t) => t.id),
  });
  check('EN e PT: mesmos números, categorias, marcas e ordem', numbers(en) === numbers(pt));
  check('EN e PT: rótulos de byPlace mudam com o idioma', en.byPlace.every((p, i) => p.label !== pt.byPlace[i]?.label));
}

console.log('== demo (UTC) ==');
const demo = enrichDataset(demoDataset);
const hd = purchaseHistory(demo, { timeZone: 'UTC' });
invariants(demo, hd, 'UTC', 'en');
check('total do demo', hd.total === 59868.12, String(hd.total));
check('1370 cobranças em 1372 linhas (estornos e a pendente entram, anuladas não), ticket médio 43.70', hd.count === 1370 && hd.purchases.length === 1372 && hd.avgTicket === 43.7, `${hd.count} / ${hd.purchases.length} / ${hd.avgTicket}`);
check('469 dias, de 01/07/2025 a 12/10/2026 (a anual que renovou hoje)', hd.days === 469 && hd.from.startsWith('2025-07-01') && hd.to.startsWith('2026-10-12'), String(hd.days));
check('casa em USD: sem total em moeda da casa', hd.homeCurrency === 'USD' && hd.totalHome === null);
check('16 meses, 15 inteiros (jul/2025 a set/2026)', hd.months.length === 16 && hd.months.filter((m) => m.full).length === 15 && hd.months[0].month === '2025-07' && !hd.months.at(-1)!.full, hd.months.map((m) => `${m.month}${m.full ? '' : '*'}`).join(' '));
check('setembro de 2026 (viagem a Tóquio) = 6070', hd.months.find((m) => m.month === '2026-09')?.total === 6070);
const uber = hd.byBrand.find((g) => g.name === 'Uber');
const uberParts = hd.byMerchant.filter((g) => g.name === 'Uber' || g.name === 'Uber Eats' || g.name === 'Uber One');
check('marca Uber = Uber + Uber Eats + Uber One', uber?.total === 3146.69 && uber.count === 135 && uber.total === R2(sum(uberParts.map((g) => g.total))), `${uber?.total} / ${uber?.count}`);
check('Uber: categoria mais frequente é transport', uber?.category === CATEGORY.transport, uber?.category);
check('maior estabelecimento: Whole Foods', hd.byMerchant[0]?.name === 'Whole Foods' && hd.byMerchant[0].total === 3943.8 && hd.byMerchant[0].count === 77);
check('maior categoria: restaurantes', hd.byCategory[0]?.name === CATEGORY.dining && hd.byCategory[0].total === 15849.93, `${hd.byCategory[0]?.name} ${hd.byCategory[0]?.total}`);
const homePlace = hd.byPlace.find((p) => p.key === 'home');
check('onde: casa em dólar', homePlace?.currency === 'USD' && homePlace.total === 55643.95 && homePlace.count === 1342 && homePlace.label === 'Home currency · US dollars', `${homePlace?.total} ${homePlace?.count}`);
check('onde (EN): 5 moedas com nome em inglês, no plural', hd.byPlace.map((p) => p.label).join(' | ') === 'Home currency · US dollars | In Japanese yen | In British pounds | In euros | In Mexican pesos', hd.byPlace.map((p) => p.label).join(' | '));
check('maior compra: Apple Store 1199', hd.topPurchases[0]?.merchant === 'Apple Store' && hd.topPurchases[0].amountUsd === 1199);
const cell = (h: PurchaseHistory, weekday: number, hour: number) => h.heatmap[weekday * 24 + hour];
check('heatmap UTC: quinta 9h = 17 compras, 832.56', cell(hd, 4, 9).count === 17 && cell(hd, 4, 9).total === 832.56);
const hdSp = purchaseHistory(demo, { timeZone: 'America/Sao_Paulo' });
check('mesmas compras em São Paulo: quinta 6h', cell(hdSp, 4, 6).count === 17 && cell(hdSp, 4, 6).total === 832.56 && hdSp.total === hd.total);
const twice = enrichDataset(demo);
check('enriquecer de novo não muda nome nem marca', twice.transactions.every((t, i) => t.merchant === demo.transactions[i].merchant && t.brand === demo.transactions[i].brand));

console.log('\n== demo em português ==');
const demoPt = enrichDataset(demoDataset, 'pt');
const hdPt = purchaseHistory(demoPt, { timeZone: 'UTC', locale: 'pt' });
invariants(demoPt, hdPt, 'UTC', 'pt');
sameAcrossLocales(hd, hdPt);
check('padrão sem locale = inglês', purchaseHistory(demo, { timeZone: 'UTC' }).byPlace[0]?.label === 'Home currency · US dollars');
check('onde (PT): 5 moedas como hoje', hdPt.byPlace.map((p) => p.label).join(' | ') === 'Moeda da casa · dólar americano | Em iene japonês | Em libra esterlina | Em euro | Em peso mexicano', hdPt.byPlace.map((p) => p.label).join(' | '));

console.log('\n== sintético: casa em BRL, estorno, cancelada, fuso ==');
const buy = (id: string, date: string, merchant: string, currency: string, amount: number, amountUsd: number, extra: Partial<Transaction> = {}): Transaction =>
  ({ id, type: 'purchase', status: 'settled', date, merchant, currency, amount, amountUsd, ...extra });
const syntheticRaw: Dataset = {
  referenceDate: '2026-10-18',
  account: { creditLimit: 0, amountBorrowed: 0, availableBalance: 0, vaultAddress: '', currency: 'USD' },
  cards: [],
  portfolio: { totalValue: 0, holdings: [] },
  deposit: { address: '', networks: [], assets: [] },
  transactions: [
    buy('s1', '2026-08-10T23:30:00Z', 'IFD*PIZZARIA EXEMPLO LTDA', 'BRL', 100, 20, { category: 'Food & Dining' }),
    buy('s2', '2026-10-01T12:00:00Z', 'IFD*PIZZARIA EXEMPLO LTDA', 'BRL', 50, 10, { category: 'Food & Dining', status: 'pending' }),
    buy('s3', '2026-09-05T15:00:00Z', 'IFOOD PEDIDO EXEMPLO', 'BRL', 25, 5),
    buy('s4', '2026-09-07T10:00:00Z', 'UBERCASH TOPUP', 'BRL', 50, 10),
    buy('s5', '2026-09-08T10:00:00Z', 'UBER *TRIP', 'BRL', 30, 6),
    buy('s6', '2026-09-09T20:00:00Z', 'UBER EATS', 'BRL', 40, 8),
    buy('s7', '2026-09-10T14:00:00Z', 'ANTHROPIC EXEMPLO', 'USD', 20, 20),
    buy('s8', '2026-09-12T14:00:00Z', 'ANTHROPIC EXEMPLO', 'USD', -20, -20),
    // cai no sábado 23h em São Paulo e no domingo 2h em UTC
    buy('s9', '2026-10-18T02:30:00Z', 'OPENAI *CHATGPT', 'USD', 20, 20),
    buy('s10', '2026-09-20T18:00:00Z', 'LOJA EXEMPLO', 'BRL', -15, -3, { category: 'Retail' }),
    buy('s11', '2026-09-21T18:00:00Z', 'LOJA EXEMPLO', 'BRL', 500, 100, { category: 'Retail', status: 'void' }),
    buy('s12', '2026-06-20T09:00:00Z', 'CAFE EXEMPLO', 'EUR', 10, 11.5, { category: 'Food & Dining' }),
    buy('s14', '2026-09-15T16:00:00Z', 'PARRILLA EXEMPLO', 'ARS', 1000, 1, { category: 'Food & Dining' }),
    { id: 's13', type: 'top_up', status: 'settled', date: '2026-09-01T00:00:00Z', currency: 'USD', amount: 1000, amountUsd: 1000 },
  ],
};
const synthetic = enrichDataset(syntheticRaw);
const hs = purchaseHistory(synthetic, { timeZone: 'America/Sao_Paulo' });
invariants(synthetic, hs, 'America/Sao_Paulo', 'en');
invariants(synthetic, purchaseHistory(synthetic, { timeZone: 'UTC' }), 'UTC', 'en');
check('casa em BRL', hs.homeCurrency === 'BRL', hs.homeCurrency);
check('cancelada fora, depósito fora, estornos abatem: 88.50', hs.total === 88.5 && hs.purchases.length === 12 && !hs.purchases.some((t) => t.id === 's11'), String(hs.total));
check('10 cobranças, ticket médio 8.85', hs.count === 10 && hs.avgTicket === 8.85, `${hs.count} / ${hs.avgTicket}`);
check('≈ moeda da casa pelo câmbio médio (5 BRL/USD) = 442.50', hs.totalHome === 442.5, String(hs.totalHome));
check('121 dias, junho a outubro com julho zerado', hs.days === 121 && hs.months.map((m) => m.month).join() === '2026-06,2026-07,2026-08,2026-09,2026-10' && hs.months[1].total === 0 && hs.months[1].count === 0, `${hs.days}`);
check('iFood junta pedidos IFD* e o próprio app', hs.byBrand.find((g) => g.name === 'iFood')?.total === 35 && hs.byBrand.find((g) => g.name === 'iFood')?.count === 3);
check('pedido IFD* mantém o restaurante no nome', hs.byMerchant.some((g) => g.name === 'Pizzaria Exemplo · via iFood' && g.total === 30 && g.count === 2 && g.first === '2026-08-10T23:30:00Z' && g.last === '2026-10-01T12:00:00Z'));
check('Uber junta recarga, corrida e Eats', hs.byBrand.find((g) => g.name === 'Uber')?.total === 24 && hs.byBrand.find((g) => g.name === 'Uber')?.count === 3);
check('estorno integral (Claude, total 0) sai das listas', !hs.byMerchant.some((g) => g.name === 'Claude (Anthropic)'));
check('só estorno (Loja Exemplo) sai de estabelecimento, marca e categoria', !hs.byMerchant.some((g) => g.name === 'Loja Exemplo') && !hs.byBrand.some((g) => g.name === 'Loja Exemplo') && !hs.byCategory.some((g) => g.name === CATEGORY.shopping));
check('Σ estabelecimentos listados = total + 3 do só-estorno', R2(sum(hs.byMerchant.map((g) => g.total))) === 91.5);
check('delivery = pizzaria + iFood + Uber Eats; dining = café + parrilla', hs.byCategory.find((g) => g.name === CATEGORY.delivery)?.total === 43 && hs.byCategory.find((g) => g.name === CATEGORY.dining)?.total === 12.5);
const place = (h: PurchaseHistory, key: string) => h.byPlace.find((p) => p.key === key);
check('onde (EN): Brazil · in reais', place(hs, 'home')?.label === 'Brazil · in reais' && place(hs, 'home')?.currency === 'BRL' && place(hs, 'home')?.total === 56 && place(hs, 'home')?.count === 6);
check('onde (EN): In US dollars · online or abroad', place(hs, 'USD')?.label === 'In US dollars · online or abroad' && place(hs, 'USD')?.total === 20 && place(hs, 'USD')?.count === 2);
check('onde (EN): In euros, In Argentine pesos', place(hs, 'EUR')?.label === 'In euros' && place(hs, 'EUR')?.total === 11.5 && place(hs, 'ARS')?.label === 'In Argentine pesos' && place(hs, 'ARS')?.total === 1);
check('fuso: ChatGPT no sábado 23h em São Paulo', cell(hs, 6, 23).count === 1 && cell(hs, 6, 23).total === 20 && cell(hs, 0, 2).count === 0);
check('fuso: mesma compra no domingo 2h em UTC', cell(purchaseHistory(synthetic, { timeZone: 'UTC' }), 0, 2).count === 1);
check('outubro é o mês corrente, setembro é inteiro', hs.months.at(-1)?.full === false && hs.months.find((m) => m.month === '2026-09')?.full === true);
// histórico completo que começa em 20/06: junho é o mês em que a conta abriu, parcial como qualquer começo no meio
const june = hs.months.find((m) => m.month === '2026-06');
check('junho (o histórico começa no dia 20, completo) é parcial', june?.full === false && june.startsMidMonth && hs.months.filter((m) => m.startsMidMonth).length === 1);
check('julho e agosto, depois do começo, são inteiros', hs.months.filter((m) => m.full).map((m) => m.month).join() === '2026-07,2026-08,2026-09');
const dropped = purchaseHistory({ ...synthetic, coverage: { ...synthetic.coverage!, droppedRows: true } }, { timeZone: 'UTC' });
check('linhas omitidas: nenhum mês inteiro e droppedRows exposto', dropped.droppedRows && !dropped.months.some((m) => m.full) && !hs.droppedRows);
const empty = purchaseHistory({ ...synthetic, transactions: [] }, { timeZone: 'UTC' });
check('sem compras: zeros, 168 células, nada quebra', empty.total === 0 && empty.count === 0 && empty.days === 1 && !empty.months.length && empty.heatmap.length === 168 && !empty.byPlace.length);

console.log('\n== sintético em português ==');
const syntheticPt = enrichDataset(syntheticRaw, 'pt');
const hsPt = purchaseHistory(syntheticPt, { timeZone: 'America/Sao_Paulo', locale: 'pt' });
invariants(syntheticPt, hsPt, 'America/Sao_Paulo', 'pt');
sameAcrossLocales(hs, hsPt);
check('onde (PT): como hoje', place(hsPt, 'home')?.label === 'Brasil · em reais' && place(hsPt, 'USD')?.label === 'Em dólar · online ou exterior' && place(hsPt, 'EUR')?.label === 'Em euro' && place(hsPt, 'ARS')?.label === 'Em peso argentino', hsPt.byPlace.map((p) => p.label).join(' | '));
check('nome descritivo muda, marca não: Uber · ride / Uber · corrida', hs.byMerchant.some((g) => g.name === 'Uber · ride') && hsPt.byMerchant.some((g) => g.name === 'Uber · corrida'));

console.log('\n== hora local: enrichDataset com fuso, como a tela faz com os dados reais ==');
const SP = 'America/Sao_Paulo';
const H3 = 3 * 3600000;
const sameHeat = (a: PurchaseHistory, b: PurchaseHistory) => JSON.stringify(a.heatmap) === JSON.stringify(b.heatmap);
const sLocal = enrichDataset(syntheticRaw, 'en', SP);
check('date = hora de São Paulo (UTC−3); dateUtc = instante original', sLocal.transactions.every((t, i) => t.dateUtc === syntheticRaw.transactions[i].date && Date.parse(t.dateUtc) - Date.parse(t.date) === H3));
check('mesmo formato ISO da origem (sem milissegundos aqui)', sLocal.transactions.every((t) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(t.date)));
check('dataset.timeZone registra o fuso; sem fuso, fica vazio', sLocal.timeZone === SP && synthetic.timeZone === undefined);
check('cobertura começa na transação mais antiga, no mesmo relógio', sLocal.coverage?.from === sLocal.transactions.map((t) => t.date).sort()[0]);
const again = enrichDataset(enrichDataset(sLocal, 'pt', SP), 'en', SP);
check('idempotente: enriquecer de novo (outro idioma, mesmo fuso) não desloca de novo', again.transactions.every((t, i) => t.date === sLocal.transactions[i].date && t.dateUtc === sLocal.transactions[i].dateUtc));
check('sem fuso, volta ao UTC original', enrichDataset(sLocal, 'en').transactions.every((t, i) => t.date === syntheticRaw.transactions[i].date && t.dateUtc === undefined));
const hLocal = purchaseHistory(sLocal);
invariants(sLocal, hLocal, null, 'en');
check('mapa de calor sem fuso duas vezes: padrão nos dados locais = UTC visto em São Paulo', sameHeat(hLocal, hs));
check('passar timeZone nos dados já locais dá o mesmo mapa', sameHeat(hLocal, purchaseHistory(sLocal, { timeZone: SP })));
check('ChatGPT de domingo 02:30 UTC: sábado 17/10 às 23h na lista e no mapa', hLocal.to.startsWith('2026-10-17T23:30') && cell(hLocal, 6, 23).count === 1);
const groupsOf = (h: PurchaseHistory) => JSON.stringify(h.byCategory.map((g) => [g.name, g.total, g.count]));
check('o fuso não muda totais nem grupos', hLocal.total === hs.total && hLocal.count === hs.count && groupsOf(hLocal) === groupsOf(hs));
const edge: Dataset = { ...syntheticRaw, transactions: [buy('e1', '2026-10-01T01:30:00Z', 'PADARIA EXEMPLO', 'BRL', 20, 4, { category: 'Food & Dining' })] };
const edgeLocal = purchaseHistory(enrichDataset(edge, 'en', SP));
const edgeUtc = purchaseHistory(enrichDataset(edge, 'en'));
check('compra das 22h30 de 30/09 no Brasil fica em setembro (em UTC iria para outubro)', edgeLocal.months.map((m) => m.month).join() === '2026-09' && edgeLocal.from.startsWith('2026-09-30T22:30') && edgeUtc.months.map((m) => m.month).join() === '2026-10');
check('localIso mantém milissegundos e segue o horário de verão de cada instante', localIso('2026-10-18T01:15:30.250Z', SP) === '2026-10-17T22:15:30.250Z' && localIso('2026-07-01T12:00:00Z', 'America/New_York') === '2026-07-01T08:00:00Z' && localIso('2026-01-15T12:00:00Z', 'America/New_York') === '2026-01-15T07:00:00Z');
check('localToday: 01h UTC de 18/10 ainda é 17/10 em São Paulo', localToday(SP, new Date('2026-10-18T01:00:00Z')) === '2026-10-17' && localToday('UTC', new Date('2026-10-18T01:00:00Z')) === '2026-10-18');

// a pasta de dados reais vem do mesmo resolvedor do pull e do vite.config (scripts/data-dir.mjs)
const data = resolveDataDir();
const dir = data.url;
if (!existsSync(dir)) {
  console.log(`\n(sem dados reais em ${data.label}: pulando)`);
} else {
  console.log(`\n== dados reais de ${data.label} (invariantes, hora local de São Paulo, como a tela) ==`);
  const files = readdirSync(dir).filter(isDataFile).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const pages = files.filter((f) => f.startsWith('list_transactions')).map(read);
  const paged: Record<string, unknown>[] = pages.flatMap((p) => p.transactions);
  // a paginação do conector repete linhas na virada de página; cada id conta uma vez
  const rawTx = [...new Map(paged.map((t) => [String(t.id), t])).values()];
  const one = (name: string) => (files.includes(`${name}.json`) ? read(`${name}.json`) : undefined);
  // como a tela: "hoje" e as datas no mesmo relógio local
  const latest = new Date(rawTx.map((t) => String(t.date)).sort().at(-1)!).toISOString();
  const { dataset: parts } = assembleDataset({
    referenceDate: localIso(latest, SP).slice(0, 10),
    transactionPages: pages,
    cards: one('list_cards'),
    mainAccount: one('get_main_account'),
    portfolio: one('get_portfolio'),
    deposit: one('get_deposit_address'),
  });
  // como a tela no modo ?fixtures: as regras locais do dicionário entram junto
  const assembled: Dataset = { ...parts, merchantRules: one('merchant-rules') };
  const live = enrichDataset(assembled, 'en', SP);
  const hl = purchaseHistory(live);
  console.log(`(${pages.length} página(s), ${hl.purchases.length} compras, ${hl.months.length} meses, ${hl.byPlace.length} moedas)`);
  invariants(live, hl, null, 'en');
  const NOT_SPENT = new Set(['VOID', 'DECLINED']);
  const cardRows = rawTx.filter((t) => t.type === 'rain_transaction' && !NOT_SPENT.has(String(t.status)));
  const expected = R2(sum(cardRows.map((t) => Number(t.amount))));
  check('total = soma crua das compras do cartão não canceladas nem recusadas', hl.total === expected, diff(hl.total, expected));
  check('purchases = linhas do cartão sem VOID/DECLINED, cada id uma vez', hl.purchases.length === cardRows.length && new Set(hl.purchases.map((t) => t.id)).size === hl.purchases.length);
  check('toda linha: date = UTC−3 do instante original (dateUtc)', live.transactions.every((t) => t.dateUtc !== undefined && Date.parse(t.dateUtc) - Date.parse(t.date) === H3));
  check('cobertura começa na transação mais antiga, em hora local', live.coverage?.from === live.transactions.map((t) => t.date).sort()[0]);
  const hlUtc = purchaseHistory(enrichDataset(assembled), { timeZone: SP });
  check('mapa de calor local = UTC visto em São Paulo (sem fuso duas vezes)', sameHeat(hl, hlUtc) && sameHeat(hl, purchaseHistory(live, { timeZone: SP })));
  check('hora local não muda total, contagem nem grupos', hl.total === hlUtc.total && hl.count === hlUtc.count && groupsOf(hl) === groupsOf(hlUtc));
  const livePt = enrichDataset(assembled, 'pt', SP);
  const hlPt = purchaseHistory(livePt, { locale: 'pt' });
  invariants(livePt, hlPt, null, 'pt');
  sameAcrossLocales(hl, hlPt);
}

console.log('\n== datas: ano e fuso, nos dois idiomas ==');
setFormatToday('2026-10-18');
setFormatTimeZone(SP);
const DATE_CASES = [
  'data do ano corrente, sem ano', 'data de outro ano, com ano', 'intervalo que cruza anos', 'intervalo no ano corrente',
  'intervalo noutro ano', 'mês com ano', 'data e hora com fuso', 'data e hora de outro ano', 'dia de outro ano', 'dia do ano corrente', 'rótulo do fuso',
];
// Formato combinado com a ui-gastos (format.ts): dia e hora sem zero à esquerda ("Mar 1", "9:57 PM") e hífen sem
// quebra no fuso, para "GMT-3" não se partir. Datas inteiras (espaços viram NBSP), também em dateShort, e intervalo
// pelo formatRange do Intl: entre meses diferentes a linha só quebra antes do "–"; dentro do mesmo mês, não quebra
const nb = (s: string) => s.replace(/ /g, '\u00a0');
// o WORD JOINER (U+2060) colado ao "–": a linha só quebra antes dele, nunca depois (combinado com a ui-gastos)
const range = (a: string, b: string) => `${nb(a)} –\u2060\u00a0${nb(b)}`;
const GMT = 'GMT‑3';
const DATE_EXPECTED: Record<Locale, string[]> = {
  en: [nb('Oct 17'), nb('Aug 11, 2025'), range('Aug 11, 2025', 'Oct 18, 2026'), range('Aug 11', 'Oct 18'), range('Mar 1', 'Apr 2, 2025'), 'Aug 2025', `Oct 17, 9:57 PM ${GMT}`, `Aug 14, 2025, 9:57 PM ${GMT}`, 'Mon, Aug 11, 2025', 'Sat, Oct 17', GMT],
  pt: [nb('17 de out.'), nb('11 de ago. de 2025'), range('11 de ago. de 2025', '18 de out. de 2026'), range('11 de ago.', '18 de out.'), range('1 de mar.', '2 de abr. de 2025'), 'ago de 2025', '17 de out., 21:57 BRT', '14 de ago. de 2025, 21:57 BRT', 'Seg., 11 de ago. de 2025', 'Sáb., 17 de out.', 'BRT'],
};
for (const l of ['en', 'pt'] as const) {
  setFormatLocale(l);
  const got = [
    dateShort('2026-10-17T22:14:30Z'), dateShort('2025-08-11T10:00:00Z'),
    dateRange('2025-08-11T10:00:00Z', '2026-10-18T23:59:59Z'), dateRange('2026-08-11T10:00:00Z', '2026-10-18T23:59:59Z'), dateRange('2025-03-01T10:00:00Z', '2025-04-02T10:00:00Z'),
    monthYearLabel('2025-08'), dateTime('2026-10-17T21:57:00Z'), dateTime('2025-08-14T21:57:00Z'), dayHeading('2025-08-11'), dayHeading('2026-10-17'), tzLabel(),
  ];
  got.forEach((g, i) => check(`${l}: ${DATE_CASES[i]}`, g === DATE_EXPECTED[l][i], g));
}
setFormatTimeZone(null);
setFormatLocale('en');
check('sem fuso definido (scripts no Node), sem rótulo', tzLabel() === '' && dateTime('2026-10-17T21:57:00Z') === 'Oct 17, 9:57 PM');
// o formato não pode desfazer a hora local: a data sai do texto de date, lido em UTC, sem aplicar fuso de novo
check('data e hora lidas de date sem deslocar (23:30 do dia 17 continua dia 17)', dateTime('2026-10-17T23:30:00Z') === 'Oct 17, 11:30 PM' && dateShort('2026-10-31T23:59:59Z') === nb('Oct 31'));
check('intervalo de um mês só, de 1 a 31, sem zero à esquerda e sem quebra', dateRange('2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z') === `${nb('Oct 1')}\u00a0–\u2060\u00a031`, dateRange('2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z'));
check('intervalo nunca quebra entre o "–" e o número', ['2025-03-01T10:00:00Z', '2026-08-11T10:00:00Z', '2026-10-01T00:00:00Z'].every((from) => /–⁠ /.test(dateRange(from, '2026-10-18T23:59:59Z')) && !/–[  ]/.test(dateRange(from, '2026-10-18T23:59:59Z'))));

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
