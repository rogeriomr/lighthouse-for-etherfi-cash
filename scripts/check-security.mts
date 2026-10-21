// Regressões do red team do app (20/10/2026), só com dados inventados:
// - depósito: o QR e o "Copiar" dependem de o endereço conferir com a conta (formato, igual ao de get_main_account e
//   arquivos da mesma conta); um arquivo de nome inocente reconhecido pela forma não troca o endereço em silêncio;
// - links: só https; "verificado" é o host exato da base pública (script.google.com não passa por google.com) e o link
//   oficial da base vence o do email;
// - .ics: nenhum campo vindo de fora abre linha nova (moeda adulterada no UID, CR/LF, controles, marcas de direção);
// - regras locais (merchant-rules.json): regex com repetição aninhada, referência para trás ou repetições demais é
//   recusada, e o padrão que travava a aba não roda;
// - texto de terceiros sem controles nem marcas de direção; datas e valores absurdos fora do dataset.
// Caracteres especiais saem de String.fromCharCode: nada de controle ou de direção literal neste arquivo.
import { isKnownHost, safeUrl } from '../src/lib/url.ts';
import { cleanText, clip } from '../src/lib/cleanText.ts';
import { isSafePattern, MAX_RULE_LENGTH } from '../src/lib/safeRegex.ts';
import { assembleDataset, normalizeCard } from '../src/lib/normalize.ts';
import { bundleFromFiles, datasetFromBundle, type RawFile } from '../src/lib/rawFiles.ts';
import { enrichDataset } from '../src/lib/enrich.ts';
import { analyzeSubscriptions, buildIcs, knowledgeFor } from '../src/lib/subscriptions.ts';
import { categoryLabel, MAX_LOCAL_RULES, sanitizeMerchantRules, setLocalMerchantRules } from '../src/lib/merchants.ts';
import { sinceSnapshot } from '../src/lib/insights/summary.ts';
import type { PortfolioSnapshot } from '../src/lib/insights/types.ts';
import { validateAuditFile } from '../src/lib/validate.ts';
import { setFormatLocale } from '../src/lib/format.ts';
import type { SubscriptionRecord } from '../src/lib/subscriptionTypes.ts';

declare const process: { exit(code: number): never };

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
setFormatLocale('pt');

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const BS = ch(92);
const CR = ch(13);
const LF = ch(10);
const RLO = ch(0x202e);
const PDF = ch(0x202c);
const LRI = ch(0x2066);
const LSEP = ch(0x2028);
const ADDR_A = `0x${'a1'.repeat(20)}`;
const ADDR_B = `0x${'b2'.repeat(20)}`;
const TODAY = '2026-10-20';
type Dict = Record<string, unknown>;

// ---------- depósito ----------

console.log('== depósito ==');
const depositOf = (parts: { main?: Dict; deposit?: Dict; portfolio?: Dict; cards?: Dict; tx?: Dict }) =>
  assembleDataset({ referenceDate: TODAY, mainAccount: parts.main, deposit: parts.deposit, portfolio: parts.portfolio, cards: parts.cards, transactions: parts.tx }).dataset;
const main = (address: string, accountLabel?: string): Dict => ({ address, totalBalance: '10', ...(accountLabel ? { accountLabel } : {}) });
const dep = (address: string): Dict => ({ address, networks: ['base'], supportedAssets: [{ symbol: 'USDC', name: 'USD Coin', ltv: 0.9, contracts: [{ network: 'base' }] }] });
const portfolio = (accountLabel?: string): Dict => ({ holdings: [{ asset: 'USDC', quantity: '10', dollarValue: '10' }], ...(accountLabel ? { accountLabel } : {}) });

check('mesmo endereço, mesma conta: confere', depositOf({ main: main(ADDR_A, 'Conta Teste'), deposit: dep(ADDR_A), portfolio: portfolio('Conta Teste') }).deposit.check === 'match');
check('maiúsculas e minúsculas não importam', depositOf({ main: main(ADDR_A.toUpperCase().replace('0X', '0x')), deposit: dep(ADDR_A) }).deposit.check === 'match');
check('outro endereço no arquivo de depósito: não confere', depositOf({ main: main(ADDR_A, 'Conta Teste'), deposit: dep(ADDR_B) }).deposit.check === 'mismatch');
check('sem o arquivo da conta: não confirmado', depositOf({ deposit: dep(ADDR_A) }).deposit.check === 'no_account');
check('formato que não é endereço: inválido', depositOf({ main: main(ADDR_A), deposit: dep('0xEXEMPLO-NAO-ENVIE') }).deposit.check === 'invalid'
  && depositOf({ main: main(ADDR_A), deposit: dep(`ethereum:${ADDR_A}?value=1e18`) }).deposit.check === 'invalid');
check('arquivos de contas diferentes: não confirmado', depositOf({ main: main(ADDR_A, 'Conta Teste'), deposit: dep(ADDR_A), portfolio: portfolio('Outra Conta') }).deposit.check === 'mixed_accounts');
check('conta sem nome no meio de arquivos com nome: não confirmado', depositOf({ main: main(ADDR_A), deposit: dep(ADDR_A), cards: { accountLabel: 'Conta Teste', cards: [] } }).deposit.check === 'mixed_accounts');
check('sem endereço: nenhum veredito', depositOf({ main: main(ADDR_A) }).deposit.check === undefined);
const ltvOf = (address: string) => depositOf({ main: main(ADDR_A, 'Conta Teste'), deposit: dep(address), portfolio: portfolio('Conta Teste') }).portfolio.holdings[0]?.ltv;
check('depósito que confere dá o LTV; o de outra conta não', ltvOf(ADDR_A) === 0.9 && ltvOf(ADDR_B) === undefined);

const victim: RawFile[] = [
  { name: 'get_main_account.json', json: main(ADDR_A, 'Conta Teste'), modified: 1 },
  { name: 'get_deposit_address.json', json: dep(ADDR_A), modified: 1 },
  { name: 'get_portfolio.json', json: portfolio('Conta Teste'), modified: 1 },
];
const renamed: RawFile = { name: 'categorias-brasil.json', json: dep(ADDR_B), modified: 2 };
const { bundle, verdicts } = bundleFromFiles([...victim.filter((f) => f.name !== 'get_deposit_address.json'), renamed]);
const v = verdicts.find((x) => x.name === renamed.name);
check('arquivo de nome inocente com forma de depósito: o veredito diz o tipo e que veio pelo conteúdo', v?.kind === 'deposit' && v.byShape === true);
check('... e somado aos arquivos da conta, o endereço não confere (sem QR nem cópia)', datasetFromBundle(bundle, TODAY).deposit.check === 'mismatch');
check('arquivo com o nome do pull não é marcado como "pelo conteúdo"', bundleFromFiles(victim).verdicts.every((x) => !x.byShape));
// o atacante troca conta e depósito juntos, com o mesmo nome de conta: coerentes entre si, mas de outra importação
const batchOf = (files: RawFile[], batch: number) => files.map((f) => ({ ...f, batch }));
const victimTx: RawFile = { name: 'list_transactions.page1.json', json: { accountLabel: 'Conta Teste', transactions: [], nextPage: null }, modified: 1 };
const sameImport = batchOf([...victim, victimTx], 1);
const swapped = [
  ...sameImport.filter((f) => !/get_main_account|get_deposit_address/.test(f.name)),
  ...batchOf([{ name: 'get_main_account.json', json: main(ADDR_B, 'Conta Teste'), modified: 2 }, { name: 'get_deposit_address.json', json: dep(ADDR_B), modified: 2 }], 2),
];
check('conta e depósito na mesma importação do resto: confere', datasetFromBundle(bundleFromFiles(sameImport).bundle, TODAY).deposit.check === 'match');
check('conta e depósito trocados numa importação depois (mesmo nome de conta): não confirmado', datasetFromBundle(bundleFromFiles(swapped).bundle, TODAY).deposit.check === 'separate_import');
check('arquivos sem importação marcada (?fixtures, checks): a regra não se aplica', datasetFromBundle(bundleFromFiles(victim).bundle, TODAY).deposit.check === 'match');

// ---------- links ----------

console.log('== links ==');
check('safeUrl recusa javascript:, data:, http:, usuário embutido e //host', ['javascript:alert(1)', 'data:text/html,x', 'http://servico.exemplo/x', 'https://servico.exemplo@golpe.exemplo/', '//golpe.exemplo/x']
  .every((u) => safeUrl(u) === undefined) && safeUrl('https://servico.exemplo/conta') === 'https://servico.exemplo/conta');
check('isKnownHost: host exato (com ou sem www.)', isKnownHost('https://google.com/x', ['google.com']) && isKnownHost('https://www.google.com/x', ['google.com'])
  && isKnownHost('https://servico.exemplo/y', ['https://servico.exemplo/conta']));
check('isKnownHost: subdomínio de quem hospeda páginas de terceiros não passa', ['https://script.google.com/macros/s/x/exec', 'https://sites.google.com/view/x', 'https://docs.google.com/forms/d/x']
  .every((u) => !isKnownHost(u, ['google.com'])) && !isKnownHost('https://conta.servico.exemplo/x', ['https://servico.exemplo/conta']));

const days = ['2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'];
const rawTx = (date: string, merchant: string, amount: string, extra: Dict = {}): Dict =>
  ({ id: `${merchant}-${date}-${amount}`, date: `${date}T14:00:00Z`, type: 'CARD_PURCHASE', direction: 'out', amount, currency: 'USD', status: 'COMPLETED', merchant, category: 'Entertainment', cardLast4: '0000', ...extra });
const report = (files: RawFile[]) => {
  const ds = enrichDataset(datasetFromBundle(bundleFromFiles(files).bundle, TODAY), 'pt', 'UTC');
  return analyzeSubscriptions(ds, { knowledge: knowledgeFor(ds), today: TODAY, locale: 'pt' });
};
const yt = report([
  { name: 'list_transactions.page1.json', json: { transactions: days.map((d) => rawTx(d, 'GOOGLE *YouTubePremium', '13.99')), nextPage: null }, modified: 1 },
  { name: 'subscription-evidence.json', json: { items: [{ name: 'YouTube', matchers: ['YOUTUB'], kind: 'renewal_notice', emailDate: '2026-10-01', subject: 'renova', cycle: 'monthly', manageUrl: 'https://script.google.com/macros/s/EXEMPLO/exec' }] }, modified: 1 },
]).records.find((r) => r.name.includes('YouTube'));
check('phishing no script.google.com não troca o link oficial da base', yt?.manageUrl === 'https://www.youtube.com/paid_memberships' && yt.manageUrlVerified === true, String(yt?.manageUrl));
const noBase = report([
  { name: 'list_transactions.page1.json', json: { transactions: days.map((d) => rawTx(d, 'KESTREL NOTES', '9.99')), nextPage: null }, modified: 1 },
  { name: 'subscription-research.json', json: { items: [{ name: 'Kestrel Notes', matchers: ['KESTREL NOTES'], isSubscription: 'yes', cycles: ['monthly'], sources: [], domains: ['kestrel.exemplo'] }] }, modified: 1 },
  { name: 'subscription-evidence.json', json: { items: [{ name: 'Kestrel Notes', matchers: ['KESTREL'], kind: 'receipt', emailDate: '2026-10-05', subject: 'recibo', cycle: 'monthly', manageUrl: 'https://kestrel.exemplo/conta' }] }, modified: 1 },
]).records.find((r) => r.name.includes('Kestrel'));
check('sem base pública, o link do email (mesmo num domínio que a pesquisa da IA diz ser do serviço) sai "não verificado"', noBase?.manageUrl === 'https://kestrel.exemplo/conta' && noBase.manageUrlVerified === false);

// ---------- .ics ----------

console.log('== .ics ==');
const unfold = (ics: string) => ics.split(`${CR}${LF} `).join('').split(`${CR}${LF}`);
// propriedades que o arquivo nunca escreve (o ACTION:DISPLAY dos alarmes é do próprio arquivo)
const injected = (ics: string) => unfold(ics).filter((l) => /^(attach|url|x-inj|attendee)[:;]|^action:email/i.test(l));
const EVIL_CUR = `USD${CR}${LF}ATTACH:https://golpe.exemplo/x${CR}${LF}URL:https://golpe.exemplo/c${CR}${LF}X-INJ:1`;
const curRep = report([
  { name: 'list_transactions.page1.json', json: { transactions: [
    ...days.map((d) => rawTx(d, 'KESTREL NOTES', '14.99')),
    ...['2026-08-16', '2026-09-16', '2026-10-16'].map((d) => rawTx(d, 'KESTREL NOTES', '39.99', { localAmount: '39.99', localCurrency: EVIL_CUR })),
  ], nextPage: null }, modified: 1 },
  { name: 'subscription-research.json', json: { items: [{ name: 'Kestrel Notes', matchers: ['KESTREL NOTES'], isSubscription: 'yes', cycles: ['monthly'], sources: [] }] }, modified: 1 },
]);
const curIcs = buildIcs(curRep.records, { now: `${TODAY}T12:00:00Z`, locale: 'pt' });
check('moeda adulterada no extrato não injeta propriedade no .ics', injected(curIcs).length === 0 && !curRep.records.some((r) => r.key.includes(CR) || r.name.includes(CR)),
  injected(curIcs).join(' | '));
const base = curRep.records[0];
const forged: SubscriptionRecord = { ...base, key: `chave${CR}${LF}ATTACH:https://golpe.exemplo/x`, name: `${RLO}${'Nome muito longo '.repeat(20)}${LSEP}fim` };
const forgedIcs = buildIcs([forged], { now: `${TODAY}T12:00:00Z`, locale: 'pt' });
const lines = unfold(forgedIcs);
check('UID montado à mão com CRLF: vira um token só', lines.some((l) => l.startsWith('UID:chave--ATTACH-https---golpe.exemplo-x@')) && injected(forgedIcs).length === 0, String(lines.find((l) => l.startsWith('UID:'))));
check('sem marca de direção nem separador de linha no arquivo', !forgedIcs.includes(RLO) && !forgedIcs.includes(LSEP));
const summary = lines.find((l) => l.startsWith('SUMMARY:')) ?? '';
check('nome longo cortado no título (≤ 120 caracteres do nome)', summary.length < 'SUMMARY:Renova: '.length + 120 + 40 && summary.includes('…'), String(summary.length));

// ---------- regras locais (ReDoS) ----------

console.log('== regras locais ==');
const U1 = ch(1);
const evil = [`^(.*.*)*${U1}`, `^(.+)+${U1}`, `^((.+)+)+${U1}`, '(a|a){1,30}x', '.*.*.*.*x', `(a)${BS}1`, `(?<n>a)${BS}k<n>`, 'A'.repeat(MAX_RULE_LENGTH + 1), `^${'(a?)'.repeat(24)}$`, `^${'(a|a)'.repeat(20)}b$`];
check('padrões que explodem são recusados', evil.every((p) => !isSafePattern(p)), evil.filter((p) => isSafePattern(p)).join(' | '));
const good = [`${BS}bPADARIA${BS}b`, `^QUICKBITE${BS}*`, `IFD${BS}*.*BURGER`, `${BS}b(PIZZA|PIZZARIA)${BS}b`, '.*.*.*x', `${BS})+literal`, 'TRATTORIA FINTA', '(PIXEL)?FLOW', `^uber${BS}s?eats$`];
check('padrões comuns continuam valendo', good.every(isSafePattern), good.filter((p) => !isSafePattern(p)).join(' | '));
const loaded = setLocalMerchantRules({ rules: [{ match: `^(.*.*)*${U1}`, name: 'Golpe' }, { match: `${BS}bPADARIA${BS}b`, name: 'Padaria' }] });
check('arquivo com a regra que travava: ela sai, a outra fica', loaded.rules === 1 && loaded.skipped === 1);
const t0 = performance.now();
report([
  { name: 'list_transactions.page1.json', json: { transactions: days.map((d) => rawTx(d, 'PADARIA DO BAIRRO CENTRO SUL', '12.00')), nextPage: null }, modified: 1 },
  { name: 'merchant-rules.json', json: { rules: [{ match: `^(.*.*)*${U1}`, name: 'Golpe' }] }, modified: 1 },
]);
const ms = performance.now() - t0;
check('extrato + regra que travava: termina rápido', ms < 2000, `${ms.toFixed(0)} ms`);
setLocalMerchantRules(undefined);

// ---------- texto de terceiros e limites ----------

console.log('== texto e limites ==');
check('cleanText tira marcas de direção e controles; quebra vira espaço', cleanText(`a${RLO}b${PDF}c${LRI}d${CR}${LF}e${ch(7)}f${ch(0x85)}g`) === 'abcd efg');
check('clip corta com "…"', clip('abcdef', 4) === 'abc…' && clip('abc', 4) === 'abc');
const norm = assembleDataset({ referenceDate: TODAY, transactions: { transactions: [
  rawTx('2026-10-01', `LOJA ${RLO}ATSE${PDF}`, '10'),
  rawTx('2026-10-02', 'DATA LONGE', '10', { date: '2286-11-20T00:00:00Z' }),
  rawTx('2026-10-03', 'DATA EXTREMA', '10', { date: '+275760-09-13T00:00:00Z' }),
  rawTx('2026-10-04', 'VALOR ABSURDO', '1e308'),
  rawTx('2026-10-05', 'MOEDA', '10', { currency: `BRL${CR}${LF}X` }),
  rawTx('2026-10-06', 'X'.repeat(500), '10'),
] } }).dataset.transactions;
const names = norm.map((t) => t.merchant ?? '');
check('nome de estabelecimento sem marca de direção', names.includes('LOJA ATSE'));
check('datas fora de 2000–2100 e valor absurdo saem do dataset', !names.some((n) => /DATA|ABSURDO/.test(n)), names.join(', ').slice(0, 120));
check('moeda inválida vale o padrão', norm.find((t) => t.merchant === 'MOEDA')?.currency === 'USD');
check('nome de estabelecimento com teto', names.every((n) => n.length <= 160));

// ---------- valores, recompensas e confiança do endereço ----------
console.log('== valores e confiança ==');
const parsed = assembleDataset({ referenceDate: TODAY, transactions: { transactions: [
  rawTx('2026-10-01', 'PT', '1.234,56'),
  rawTx('2026-10-02', 'EN', '1,234.56'),
  rawTx('2026-10-03', 'MILHAR', '1.234.567'),
  rawTx('2026-10-04', 'MOEDA PT', 'R$ 1.234,56'),
  rawTx('2026-10-05', 'SEM VALOR', ''),
  rawTx('2026-10-06', 'BRL SEM CAMBIO', '10', { currency: 'BRL' }),
  rawTx('2026-10-07', 'MENOS TIPOGRAFICO', `${String.fromCharCode(0x2212)}123,45`),
  rawTx('2026-10-08', 'CAMBIO NEGATIVO', '10', { currency: 'EUR', exchangeRate: '-5' }),
  rawTx('2026-10-09', 'USD TROCADO', '10', { amountUsd: '-10' }),
] } }).dataset.transactions;
const amt = (name: string) => parsed.find((t) => t.merchant === name)?.amountUsd;
check('decimal com vírgula e milhar com ponto', amt('PT') === 1234.56 && amt('MOEDA PT') === 1234.56, String(amt('PT')));
check('decimal com ponto e milhar com vírgula', amt('EN') === 1234.56, String(amt('EN')));
check('só milhar não vira decimal', amt('MILHAR') === 1234567, String(amt('MILHAR')));
check('linha sem valor não vira zero', !parsed.some((t) => t.merchant === 'SEM VALOR'));
check('moeda sem câmbio não vira 1:1', !parsed.some((t) => t.merchant === 'BRL SEM CAMBIO'));
check('menos tipográfico (U+2212) vira débito, não crédito', amt('MENOS TIPOGRAFICO') === -123.45, String(amt('MENOS TIPOGRAFICO')));
check('câmbio negativo é recusado, não inverte o valor', !parsed.some((t) => t.merchant === 'CAMBIO NEGATIVO'));
check('valor em USD com sinal trocado segue o sinal da compra', amt('USD TROCADO') === 10, String(amt('USD TROCADO')));

const rewardTx = (date: string, merchant: string, type: string, amount = '5') => rawTx(date, merchant, amount, { type });
const rewardDs = (txs: Dict[]) => assembleDataset({
  referenceDate: '2026-10-18',
  mainAccount: { totalBalance: 1000, creditLimit: 0, amountBorrowed: 0, vaultAddress: '', currency: 'USD', accountLabel: 'A' },
  portfolio: { totalValue: 1000, holdings: [] },
  transactions: { transactions: txs },
}).dataset;
const prev: PortfolioSnapshot = {
  version: 1, at: '2026-10-01T00:00:00Z', totalBalance: 1000, borrowed: 0,
  lastTxAt: Date.parse('2026-10-01T00:00:00Z'), holdings: [],
};
const both = sinceSnapshot(prev, rewardDs([
  rewardTx('2026-10-10', 'CASHBACK', 'CASHBACK'),
  rewardTx('2026-10-11', 'CLAIM', 'CASHBACK_CLAIM'),
  rewardTx('2026-10-12', 'REFERRAL', 'REFERRAL', '3'),
]), new Date('2026-10-18T12:00:00Z'));
check('crédito + resgate de cashback não contam duas vezes', both?.rewards === 8, String(both?.rewards));
const claimOnly = sinceSnapshot(prev, rewardDs([rewardTx('2026-10-10', 'CLAIM', 'CASHBACK_CLAIM')]), new Date('2026-10-18T12:00:00Z'));
check('sem créditos, o resgate continua contando', claimOnly?.rewards === 5, String(claimOnly?.rewards));

const vault = `0x${'1'.repeat(40)}`;
const accountFile = { name: 'get_main_account.json', json: { totalBalance: 1000, creditLimit: 0, amountBorrowed: 0, vaultAddress: vault, currency: 'USD', accountLabel: 'A' }, modified: 1 };
const depositFile = { name: 'get_deposit_address.json', json: { address: vault, networks: ['ethereum'], assets: ['USDC'] }, modified: 1 };
const imported = datasetFromBundle(bundleFromFiles([accountFile, depositFile]).bundle, TODAY);
const live = assembleDataset({
  referenceDate: TODAY, live: true,
  mainAccount: accountFile.json, deposit: depositFile.json,
}).dataset;
check('endereço ao vivo é confiável', live.deposit.check === 'match' && live.deposit.trusted === true);
check('endereço importado nunca é confiável, mesmo com os campos coerentes', imported.deposit.check === 'match' && imported.deposit.trusted !== true);

check('status de cartão desconhecido não vira ativo', normalizeCard({}).status === 'unknown');
const many = sanitizeMerchantRules({ rules: Array.from({ length: MAX_LOCAL_RULES + 5 }, (_, i) => ({ match: `LOJA${i}`, name: `Loja ${i}` })) });
check('arquivo de regras acima do teto é cortado', many.value?.rules?.length === MAX_LOCAL_RULES && many.dropped === 5, String(many.value?.rules?.length));
check('categoria com nome do protótipo não quebra', categoryLabel('constructor', 'en') === 'constructor');
const audit = validateAuditFile({ items: [{ name: `${'N'.repeat(300)}`, risk: 'high', checkedAt: '2026-10-01', riskReasons: [{ en: `x${RLO}y`, pt: `renova ${RLO}00,999 $SU${PDF}` }], cancelDeadline: `até ${RLO}11/30${PDF}` }] }).value?.items[0];
check('arquivo da IA: nome com teto, motivos e prazo sem marca de direção', (audit?.name.length ?? 0) <= 200 && typeof audit?.riskReasons[0] === 'object'
  && !JSON.stringify(audit).includes(RLO) && audit?.cancelDeadline === 'até 11/30');

console.log(failed ? `\n${failed} falha(s)` : '\ntudo ok');
process.exit(failed ? 1 : 0);
