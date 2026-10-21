// Verifica a regra "unusually_large" corrigida sobre o dataset demo (replica a lógica de analytics.ts)
// e, depois, as regras de alerta pelo detectAnomalies de verdade (dados montados e, se houver, a pasta de dados reais).
import { isDataFile, resolveDataDir } from './data-dir.mjs';
import { demoDataset } from '../src/lib/demo/dataset.ts';
import type { Transaction } from '../src/lib/types.ts';
import { enrichDataset } from '../src/lib/enrich.ts';
import { assembleDataset } from '../src/lib/normalize.ts';
import { ALERT_WINDOW_DAYS, detectAnomalies, detectSubscriptions, isBalanceTopUp, isRecentAnomaly } from '../src/lib/analytics.ts';

// Tipos mínimos do Node: o projeto não depende de @types/node só por causa deste script
interface Fs {
  existsSync(p: URL): boolean;
  readdirSync(p: URL): string[];
  readFileSync(p: URL, encoding: 'utf8'): string;
}
declare const process: { exit(code: number): never; getBuiltinModule(id: 'node:fs'): Fs };

const R2 = (n: number) => Math.round(n * 100) / 100;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a: number, b: number) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return R2(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};

const SUBS = new Set(['Netflix', 'Spotify Premium', 'iCloud+', 'Claude.ai', 'ChatGPT Plus', 'YouTube Premium', 'Uber One', 'FitLab Gym', 'Kestrel Notes']);
const byMerchant = new Map<string, Transaction[]>();
for (const t of demoDataset.transactions) {
  if (t.type !== 'purchase' || !t.merchant) continue;
  const list = byMerchant.get(t.merchant) ?? [];
  list.push(t);
  byMerchant.set(t.merchant, list);
}

const fires = [];
for (const [merchant, list] of byMerchant) {
  list.sort((a: Transaction, b: Transaction) => a.date.localeCompare(b.date));
  const latest = list[list.length - 1];
  const history = list.slice(0, -1);
  if (history.length >= 2 && !SUBS.has(merchant)) {
    const m = median(history.map((t: Transaction) => t.amountUsd));
    if (latest.amountUsd >= Math.max(100, m * 3)) {
      fires.push({ merchant, amount: latest.amountUsd, median: m, date: latest.date });
    }
  }
}
console.log('unusually_large dispara para:');
for (const f of fires) console.log(`  ${f.merchant}: ${f.amount} (mediana ${f.median}) em ${f.date}`);

// validações extras pós-fix
const span = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
console.log('span 30d fixo:', span('2026-09-13T00:00:00Z', '2026-10-12T23:59:59Z'), '(esperado 30)');
const trips = demoDataset.transactions.filter((t) => t.type === 'purchase' && t.currency !== 'USD');
console.log('transações em moeda estrangeira:', trips.length);

// ---------- regras de alerta ----------
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const REF = '2026-10-17';
let seq = 0;
const tx = (o: Partial<Transaction> & { date: string }): Transaction => ({
  id: `t${++seq}`, type: 'purchase', status: 'settled', amount: 50, currency: 'BRL', amountUsd: 10,
  merchant: 'Loja', merchantRaw: 'LOJA', brand: 'Loja', category: 'shopping', ...o,
});
const base = enrichDataset(demoDataset);
// histórico desde janeiro: "primeira vez" só vale com 60 dias antes
const run = (transactions: Transaction[]) => detectAnomalies({
  ...base, referenceDate: REF, transactions,
  coverage: { from: '2026-01-01T00:00:00Z', to: `${REF}T23:59:59Z`, complete: false },
}, []);
type Alerts = ReturnType<typeof run>;
const kinds = (list: Alerts, kind: string) => list.filter((a) => a.kind === kind);
// uma compra antiga no lugar, para "primeira vez" só disparar onde o teste quer
const known = (merchant: string) => tx({ merchant, merchantRaw: merchant.toUpperCase(), brand: merchant, date: '2026-02-01T12:00:00Z' });
const bar = (date: string, extra: Partial<Transaction> = {}) => tx({ merchant: 'Bar', merchantRaw: 'BAR', brand: 'Bar', date, ...extra });

console.log('\n== regras de alerta ==');
const dup = run([known('Bar'), bar('2026-10-10T20:00:00Z'), bar('2026-10-10T20:04:00Z')]);
check('mesmo valor 4 min depois = duplicata', kinds(dup, 'duplicate').length === 1);
check('duplicata já confirmada não é urgente', kinds(dup, 'duplicate').every((a) => !a.urgent));
check('mesmo valor 10 h depois não é duplicata', kinds(run([known('Bar'), bar('2026-10-10T08:00:00Z'), bar('2026-10-10T18:00:00Z')]), 'duplicate').length === 0);
check('mesmo valor no dia seguinte não é duplicata', kinds(run([known('Bar'), bar('2026-10-09T20:00:00Z'), bar('2026-10-10T20:00:00Z')]), 'duplicate').length === 0);
const topUp = (date: string) => tx({ merchant: 'Uber · balance top-up', merchantRaw: 'UBERCASH TOPUP', brand: 'Uber', date });
check('recarga de saldo de mesmo valor é rotina', kinds(run([topUp('2026-10-10T20:00:00Z'), topUp('2026-10-10T20:01:00Z')]), 'duplicate').length === 0);
const seller = (raw: string, date: string) => tx({ merchant: 'Amazon', merchantRaw: raw, brand: 'Amazon', date });
check(
  'vendedores diferentes no marketplace não são duplicata',
  kinds(run([known('Amazon'), seller('AMAZONMKTPLC*VENDEDORA', '2026-10-10T20:00:00Z'), seller('AMAZONMKTPLC*OUTRA', '2026-10-10T20:00:30Z')]), 'duplicate').length === 0,
);
const burst = kinds(run([known('Bar'), ...[0, 5, 9].map((m) => bar(`2026-10-10T20:0${m}:00Z`))]), 'duplicate');
check('três cobranças iguais seguidas = um alerta só', burst.length === 1 && burst[0].relatedIds.length === 3);
const fare = (date: string) => tx({ merchant: 'Metro', merchantRaw: 'METRO', brand: 'Metro', amount: 5, amountUsd: 1, date });
const routine = run(['2026-10-01', '2026-10-05', '2026-10-09'].flatMap((d) => [fare(`${d}T08:00:00Z`), fare(`${d}T09:30:00Z`)]));
check('a mesma repetição em 3 dias diferentes é costume', kinds(routine, 'duplicate').length === 0);
const urgent = kinds(run([known('Bar'), bar('2026-10-16T20:00:00Z'), bar('2026-10-16T20:02:00Z', { status: 'pending' })]), 'duplicate');
check('repetição recente ainda a confirmar é urgente', urgent[0]?.urgent === true);
const old = kinds(run([known('Bar'), bar('2026-08-10T20:00:00Z'), bar('2026-08-10T20:02:00Z')]), 'duplicate');
check(`duplicata com mais de ${ALERT_WINDOW_DAYS} dias fica fora da Home`, old.length === 1 && !isRecentAnomaly(old[0], REF));

const viaApp = run([tx({ merchant: 'Pizzaria · via App', brand: 'App', date: '2026-03-01T20:00:00Z' }), tx({ merchant: 'Lanchonete · via App', brand: 'App', date: '2026-10-12T20:00:00Z' })]);
check('lugar novo numa plataforma que você já usa não é "primeira vez"', kinds(viaApp, 'first_time').length === 0);
const hint = run([known('Loja'), tx({ merchant: 'Serviço', brand: 'Serviço', subscriptionHint: true, date: '2026-10-12T20:00:00Z' })]);
check('assinatura nova não vira "primeira vez" (fica em Assinaturas)', kinds(hint, 'first_time').length === 0);
const sameDay = kinds(run([known('Loja'), ...['A', 'B', 'C'].map((n, i) => tx({ merchant: `Loja ${n}`, brand: `Loja ${n}`, date: `2026-10-11T1${i}:00:00Z` }))]), 'first_time');
check('lugares novos no mesmo dia = um alerta só', sameDay.length === 1 && sameDay[0].relatedIds.length === 3);
const single = kinds(run([known('Loja'), tx({ merchant: 'Novo', brand: 'Novo', date: '2026-10-11T10:00:00Z' })]), 'first_time');
check('lugar novo sozinho continua "primeira vez"', single.length === 1 && single[0].merchant === 'Novo');

const pendingRows = run([
  tx({ type: 'referral', status: 'pending', merchant: undefined, date: '2026-09-27T10:00:00Z' }),
  tx({ type: 'cashback_claim', status: 'pending', merchant: undefined, date: '2026-09-27T10:00:00Z' }),
  tx({ type: 'swap', status: 'pending', merchant: undefined, token: 'ETHFI', date: '2026-09-20T10:00:00Z' }),
]);
check('recompensa a confirmar não é alerta; troca a confirmar é', kinds(pendingRows, 'stuck_pending').length === 1);
check('fora a duplicata a confirmar, nada sai urgente', [...pendingRows, ...sameDay, ...dup].every((a) => !a.urgent));
const claimLeg = run([
  tx({ type: 'cashback_claim', status: 'settled', merchant: undefined, date: '2026-09-27T10:00:00Z' }),
  tx({ type: 'swap', status: 'pending', merchant: undefined, token: 'ETHFI', date: '2026-09-27T10:00:36Z' }),
]);
check('troca colada (≤ 5 min) a um resgate de cashback é a perna do resgate: sem alerta', kinds(claimLeg, 'stuck_pending').length === 0);
const farLeg = run([
  tx({ type: 'cashback_claim', status: 'settled', merchant: undefined, date: '2026-09-27T10:00:00Z' }),
  tx({ type: 'swap', status: 'pending', merchant: undefined, token: 'ETHFI', date: '2026-09-27T10:06:00Z' }),
]);
check('troca 6 min depois do resgate continua alerta', kinds(farLeg, 'stuck_pending').length === 1);

console.log('\n== pendências: idade em dias de calendário e janela do Início (D5, D17) ==');
const stale = kinds(run([tx({ type: 'top_up', status: 'pending', merchant: undefined, token: 'USDC', date: '2025-11-14T10:00:00Z' })]), 'stuck_pending');
check('depósito a confirmar há 337 dias: alerta "confira" que conta no Início', stale.length === 1 && stale[0].group === 'check_now' && isRecentAnomaly(stale[0], REF));
check('pendência continua apontando para a data da transação', stale[0]?.date.startsWith('2025-11-14'));
// REF = 17/10: 10/10 às 23h é 7 dias de calendário; com floor a partir de hoje, seriam 6
const sevenDays = kinds(run([tx({ status: 'pending', date: '2026-10-10T23:00:00Z' })]), 'stuck_pending');
check('compra a confirmar desde 10/10 às 23h: 7 dias de calendário, alerta "vale saber"', sevenDays.length === 1 && sevenDays[0].group === 'worth_knowing' && /\b7 days\b/.test(sevenDays[0].rationale));
check('compra a confirmar desde 11/10: 6 dias, sem alerta', kinds(run([tx({ status: 'pending', date: '2026-10-11T08:00:00Z' })]), 'stuck_pending').length === 0);

console.log('\n== duplicata já estornada (D4) ==');
const refund = (date: string, amount = -50, extra: Partial<Transaction> = {}) => bar(date, { amount, amountUsd: amount / 5, ...extra });
const undone = run([known('Bar'), bar('2026-10-10T20:00:00Z'), bar('2026-10-10T20:04:00Z'), refund('2026-10-11T09:00:00Z')]);
check('estorno do mesmo valor e descritor no dia seguinte: sem alerta', kinds(undone, 'duplicate').length === 0);
check('estorno de 49,60 (dentro de ±1%) também resolve', kinds(run([known('Bar'), bar('2026-10-10T20:00:00Z'), bar('2026-10-10T20:04:00Z'), refund('2026-10-12T09:00:00Z', -49.6)]), 'duplicate').length === 0);
check('estorno de outro valor não resolve', kinds(run([known('Bar'), bar('2026-10-10T20:00:00Z'), bar('2026-10-10T20:04:00Z'), refund('2026-10-11T09:00:00Z', -30)]), 'duplicate').length === 1);
check('estorno 40 dias depois não resolve', kinds(run([known('Bar'), bar('2026-08-01T20:00:00Z'), bar('2026-08-01T20:04:00Z'), refund('2026-09-10T09:00:00Z')]), 'duplicate').length === 1);
check('estorno antes da cobrança não resolve', kinds(run([known('Bar'), refund('2026-10-09T09:00:00Z'), bar('2026-10-10T20:00:00Z'), bar('2026-10-10T20:04:00Z')]), 'duplicate').length === 1);
check('estorno de outro descritor não resolve', kinds(run([known('Bar'), bar('2026-10-10T20:00:00Z'), bar('2026-10-10T20:04:00Z'), refund('2026-10-11T09:00:00Z', -50, { merchantRaw: 'OUTRO BAR' })]), 'duplicate').length === 1);
const triple = (n: number) => run([known('Bar'), ...[0, 5, 9].map((m) => bar(`2026-10-10T20:0${m}:00Z`)), ...Array.from({ length: n }, (_, i) => refund(`2026-10-1${1 + i}T09:00:00Z`))]);
check('três cobranças iguais e um estorno: ainda sobra uma repetição', kinds(triple(1), 'duplicate').length === 1);
check('três cobranças iguais e dois estornos: resolvido', kinds(triple(2), 'duplicate').length === 0);
const twoBursts = run([known('Bar'), bar('2026-10-01T20:00:00Z'), bar('2026-10-01T20:03:00Z'), bar('2026-10-10T20:00:00Z'), bar('2026-10-10T20:03:00Z'), refund('2026-10-02T09:00:00Z')]);
check('um estorno resolve uma rajada só', kinds(twoBursts, 'duplicate').length === 1 && kinds(twoBursts, 'duplicate')[0].date.startsWith('2026-10-10'));

console.log('\n== valor incomum: cada compra dos últimos 30 dias (D11) ==');
const shop = (date: string, amountUsd: number, extra: Partial<Transaction> = {}) => tx({ merchant: 'Mercado Bom', merchantRaw: 'MERCADO BOM', brand: 'Mercado Bom', amountUsd, amount: amountUsd * 5, date, ...extra });
const routineShop = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((d) => shop(`${d}T12:00:00Z`, 40));
const bigThenNormal = kinds(run([...routineShop, shop('2026-10-05T12:00:00Z', 300), shop('2026-10-12T12:00:00Z', 42)]), 'unusually_large');
check('compra grande seguida de uma normal: o alerta é da grande', bigThenNormal.length === 1 && bigThenNormal[0].amountUsd === 300 && bigThenNormal[0].date.startsWith('2026-10-05'));
check('compra grande há 40 dias fica fora (só os últimos 30)', kinds(run([...routineShop, shop('2026-09-07T12:00:00Z', 300)]), 'unusually_large').length === 0);
check('com só 1 compra antes, não afirma "acima do usual"', kinds(run([shop('2026-09-01T12:00:00Z', 40), shop('2026-10-05T12:00:00Z', 300)]), 'unusually_large').length === 0);
check('abaixo de US$ 100 não é alerta, mesmo 3x a mediana', kinds(run([...routineShop.map((t) => ({ ...t, amountUsd: 20 })), shop('2026-10-05T12:00:00Z', 90)]), 'unusually_large').length === 0);
const big = shop('2026-10-05T12:00:00Z', 300);
const withBig = [...routineShop, big];
const anomaliesWith = (o: Parameters<typeof detectAnomalies>[3]) => kinds(detectAnomalies({
  ...enrichDataset(demoDataset), referenceDate: REF, transactions: withBig,
  coverage: { from: '2026-01-01T00:00:00Z', to: `${REF}T23:59:59Z`, complete: false },
}, [], 'en', o), 'unusually_large');
check('cobrança que o motor atribui a uma assinatura fica de fora', anomaliesWith({ subscriptionCharges: new Set([big.id]) }).length === 0);
check('as outras cobranças do lugar continuam avaliadas', anomaliesWith({ subscriptionCharges: new Set([routineShop[0].id]) }).length === 1);

// a pasta de dados reais vem do mesmo resolvedor do pull e do vite.config (scripts/data-dir.mjs)
const data = resolveDataDir();
const liveDir = data.url;
const fs = process.getBuiltinModule('node:fs');
if (!fs.existsSync(liveDir)) {
  console.log(`\n(sem dados reais em ${data.label}: pulando)`);
} else {
  console.log(`\n== alertas nos dados reais de ${data.label} (invariantes, sem números pessoais) ==`);
  const files = fs.readdirSync(liveDir).filter(isDataFile);
  const read = (f: string) => JSON.parse(fs.readFileSync(new URL(f, liveDir), 'utf8'));
  const pages = files.filter((f) => f.startsWith('list_transactions')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(read);
  const paged: Record<string, unknown>[] = pages.flatMap((p) => p.transactions);
  const rawTx = [...new Map(paged.map((t) => [String(t.id), t])).values()];
  const one = (name: string) => (files.includes(`${name}.json`) ? read(`${name}.json`) : undefined);
  const { dataset } = assembleDataset({
    referenceDate: rawTx.map((t) => String(t.date)).sort().at(-1)!.slice(0, 10),
    transactionPages: pages,
    cards: one('list_cards'), mainAccount: one('get_main_account'), portfolio: one('get_portfolio'), deposit: one('get_deposit_address'),
  });
  const live = enrichDataset({ ...dataset, merchantRules: one('merchant-rules') });
  const alerts = detectAnomalies(live, detectSubscriptions(live));
  const byId = new Map(live.transactions.map((t) => [t.id, t]));
  const rows = (a: Alerts[number]) => a.relatedIds.map((id) => byId.get(id)!);
  const dups = alerts.filter((a) => a.kind === 'duplicate');
  check('nenhum alerta de recompensa a confirmar', alerts.every((a) => rows(a).every((t) => !['cashback', 'cashback_claim', 'referral'].includes(t.type))));
  check('toda duplicata: mesmo valor, cada repetição em até 3 h', dups.every((a) => rows(a).every((t, i, r) => i === 0 || (t.amount === r[0].amount && Date.parse(t.date) - Date.parse(r[i - 1].date) <= 180 * 60000))));
  check('nenhuma recarga de saldo como duplicata', dups.every((a) => rows(a).every((t) => !isBalanceTopUp(t))));
  check('urgente só é duplicata com repetição a confirmar', alerts.filter((a) => a.urgent).every((a) => a.kind === 'duplicate' && rows(a).slice(1).some((t) => t.status === 'pending')));
  const refundsOf = (t: Transaction) => live.transactions.filter((r) => r.type === 'purchase' && r.status !== 'void' && r.amount < 0 && r.currency === t.currency
    && (r.merchantRaw ?? '').replace(/\s+/g, '').toUpperCase() === (t.merchantRaw ?? '').replace(/\s+/g, '').toUpperCase()
    && Math.abs(Math.abs(r.amount) - t.amount) <= t.amount * 0.01 && Date.parse(r.date) >= Date.parse(t.date) && Date.parse(r.date) - Date.parse(t.date) <= 30 * 86400000);
  check('nenhuma duplicata já estornada', dups.every((a) => refundsOf(rows(a)[0]).length < rows(a).length - 1));
  const claimTimes = live.transactions.filter((t) => t.type === 'cashback_claim').map((t) => Date.parse(t.date));
  check('nenhuma troca colada a resgate de cashback como pendência', alerts.filter((a) => a.kind === 'stuck_pending').every((a) => rows(a).every((t) => t.type !== 'swap' || claimTimes.every((c) => Math.abs(c - Date.parse(t.date)) > 300000))));
  check('toda pendência travada conta no Início', alerts.filter((a) => a.kind === 'stuck_pending').every((a) => isRecentAnomaly(a, live.referenceDate)));
  check('valor incomum só nos últimos 30 dias', alerts.filter((a) => a.kind === 'unusually_large').every((a) => Date.parse(live.referenceDate) - Date.parse(a.date) <= (ALERT_WINDOW_DAYS + 1) * 86400000));
  // só contagens: os valores são pessoais
  console.log(`  ${alerts.length} alertas no histórico, ${alerts.filter((a) => isRecentAnomaly(a, live.referenceDate)).length} nos últimos ${ALERT_WINDOW_DAYS} dias`);
}

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
