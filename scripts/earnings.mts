// npm run earnings: a tela Ganhos no terminal, para você e para a sua IA (Claude Code, Codex, Cursor…). Lê os dados
// da mesma pasta do npm run pull (scripts/data-dir.mjs) e roda o mesmo motor da tela (src/lib/earnings.ts): os números
// batem com a tela no centavo, então a IA consulta em vez de refazer a conta. Sem dados reais, usa o demo e avisa.
//
//   npm run earnings                          a conta do mês em Markdown
//   npm run earnings -- --json                a mesma conta em JSON
//   npm run earnings -- --extra-liquid 2000   e se houvesse US$ 2.000 a mais no Liquid?
//   npm run earnings -- --apy 4.5             e se o Liquid rendesse 4,5% ao ano?
//   npm run earnings -- --changes --save      o que mudou desde a última foto, e grava a de hoje
//   npm run earnings -- --help                todas as opções
//
// Os números saem só no seu terminal (ou para a IA que rodar o comando, que passa a vê-los). Nada é enviado.
import { demoDataset } from '../src/lib/demo/dataset.ts';
import { shiftDemo } from '../src/lib/demo/shift.ts';
import { enrichDataset, localToday } from '../src/lib/enrich.ts';
import { setFormatLocale } from '../src/lib/format.ts';
import { analyzeSubscriptions, knowledgeFor } from '../src/lib/subscriptions.ts';
import { bundleFromFiles, datasetFromBundle } from '../src/lib/rawFiles.ts';
import { buildEarnings, DEFAULT_EARNINGS_PREFS, RATE_MAX, upsertManual, validateEarningsPrefs, type EarningsPrefs } from '../src/lib/earnings.ts';
import { earningsChanges, snapshotOf, validateSnapshot } from '../src/lib/earningsChanges.ts';
import { applyWhatIf, whatIfErrors, whatIfErrorText, type WhatIf } from '../src/lib/earningsWhatIf.ts';
import { earningsJson, earningsMarkdown, type ReportContext } from '../src/lib/earningsReport.ts';
import type { Locale } from '../src/lib/locale.ts';
import type { Dataset } from '../src/lib/types.ts';
import { displayPath, isDataFile, resolveDataDir } from './data-dir.mjs';

// o projeto não traz @types/node: os módulos do Node chegam pelo getBuiltinModule, com os tipos mínimos daqui
interface Fs {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  readFileSync(p: string, encoding: 'utf8'): string;
  statSync(p: string): { mtimeMs: number };
  writeFileSync(p: string, data: string, opts: { encoding: 'utf8'; mode: number }): void;
}
interface ParseArgsOption { type: 'string' | 'boolean'; multiple?: boolean; short?: string }
interface Util { parseArgs(cfg: { args: string[]; allowPositionals: boolean; options: Record<string, ParseArgsOption> }): { values: Record<string, string | boolean | string[] | undefined> } }
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code: number): never;
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
  getBuiltinModule(id: 'node:fs'): Fs;
  getBuiltinModule(id: 'node:path'): { join(...parts: string[]): string };
  getBuiltinModule(id: 'node:util'): Util;
};
const { existsSync, readdirSync, readFileSync, statSync, writeFileSync } = process.getBuiltinModule('node:fs');
const { join } = process.getBuiltinModule('node:path');
const { parseArgs } = process.getBuiltinModule('node:util');

/** A foto que o --save grava e o --changes lê, na pasta de dados (*.local.json: o app não importa, o git ignora) */
const SNAPSHOT_FILE = 'earnings-snapshot.local.json';

const sysLocale = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
})();

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
}

interface Args {
  demo?: boolean; json?: boolean; lang?: string; plan?: string; rate?: string; base?: string; add?: string[]; exclude?: string[]; prefs?: string;
  'extra-liquid'?: string; apy?: string; changes?: boolean; save?: boolean; help?: boolean;
}
let args: Args = {};
function parse(): Args {
  return parseArgs({
    args: process.argv.slice(2),
    allowPositionals: false,
    options: {
      demo: { type: 'boolean' },
      json: { type: 'boolean' },
      lang: { type: 'string' },
      plan: { type: 'string' },
      rate: { type: 'string' },
      base: { type: 'string' },
      add: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      prefs: { type: 'string' },
      'extra-liquid': { type: 'string' },
      apy: { type: 'string' },
      changes: { type: 'boolean' },
      save: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  }).values as Args;
}
try {
  args = parse();
} catch (err) {
  fail(`${String((err as Error).message ?? err)}\n(npm run earnings -- --help)`);
}

const locale: Locale = args.lang === 'pt' || args.lang === 'en' ? args.lang : /^pt/i.test(args.lang ?? process.env.LANG ?? sysLocale) ? 'pt' : 'en';
const tr = (en: string, pt: string) => (locale === 'pt' ? pt : en);
setFormatLocale(locale);

if (args.help) {
  process.stdout.write(`${tr(
    `npm run earnings -- [options]

The Earnings screen in your terminal, with the same engine and the same cents. Reads the folder npm run pull writes to
(${resolveDataDir().label}); without real data there, it uses the demo and says so.

Output
  --json                 JSON instead of Markdown
  --lang en|pt           language (default: the system's)
  --demo                 use the demo data even if real data exists

Settings (the screen keeps yours in the browser; here you pass them)
  --plan core|luxe|pinnacle|vip   your ether.fi Cash plan, for the public cashback bands (default: core)
  --rate 1.5             your own cashback rate, in % (instead of the plan's bands)
  --base card|recurring  cashback base: card spending average (default) or recurring items only
  --add "Gym=49.90"      add a recurring item (US$ a month); "Insurance=1200/yr" yearly; append ",off-card" if not paid with the card
  --exclude "Netflix"    leave items whose name contains this out of the count (repeatable)
  --prefs file.json      the screen's settings, as "Copy for your AI" prints them

What if (cashback never changes in a scenario)
  --extra-liquid 2000    US$ more earning in Liquid, split like your vaults (same average APY)
  --apy 4.5              every Liquid vault at this APY (%)

Changes
  --changes              what changed since the snapshot saved with --save
  --save                 save today's snapshot (${SNAPSHOT_FILE}, in the data folder)
`,
    `npm run earnings -- [opções]

A tela Ganhos no terminal, com o mesmo motor e os mesmos centavos. Lê a pasta em que o npm run pull grava
(${resolveDataDir().label}); sem dados reais lá, usa o demo e avisa.

Saída
  --json                 JSON em vez de Markdown
  --lang en|pt           idioma (padrão: o do sistema)
  --demo                 usa o demo mesmo com dados reais

Ajustes (a tela guarda os seus no navegador; aqui você passa)
  --plan core|luxe|pinnacle|vip   o seu plano do ether.fi Cash, para as faixas públicas do cashback (padrão: core)
  --rate 1.5             taxa de cashback própria, em % (no lugar das faixas do plano)
  --base card|recurring  base do cashback: média do gasto no cartão (padrão) ou só as recorrências
  --add "Academia=49.90" acrescenta uma recorrência (US$ por mês); "Seguro=1200/ano" anual; termine com ",fora" se não for no cartão
  --exclude "Netflix"    tira da conta os itens cujo nome contém isto (pode repetir)
  --prefs arquivo.json   os ajustes da tela, como o "Copiar para a sua IA" mostra

E se (o cashback nunca muda num cenário)
  --extra-liquid 2000    US$ a mais rendendo no Liquid, repartidos como os seus cofres (mesmo APY médio)
  --apy 4.5              todos os cofres Liquid a este APY (%)

Mudanças
  --changes              o que mudou desde a foto gravada com --save
  --save                 grava a foto de hoje (${SNAPSHOT_FILE}, na pasta de dados)
`,
  )}`);
  process.exit(0);
}

// ---------- números digitados: "49.90", "49,90", "1.200,50", "1,200.50" ----------

function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/^(US)?\$\s*/i, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let norm: string;
  if (lastDot >= 0 && lastComma >= 0) norm = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma >= 0) norm = /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  else norm = s.split('.').length > 2 ? s.replace(/\./g, '') : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

const number = (flag: string, raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const n = parseAmount(raw);
  if (n === null) fail(tr(`--${flag}: "${raw}" is not a number.`, `--${flag}: "${raw}" não é um número.`));
  return n;
};

// ---------- os dados: a pasta do npm run pull, ou o demo ----------

const tz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
})();
const today = localToday(tz);
const data = resolveDataDir();

function loadReal(): Dataset | null {
  if (!existsSync(data.dir)) return null;
  const names = readdirSync(data.dir).filter(isDataFile);
  if (!names.length) return null;
  const raws = names.map((name) => {
    const path = join(data.dir, name);
    try {
      return { name, json: JSON.parse(readFileSync(path, 'utf8')) as unknown, modified: statSync(path).mtimeMs };
    } catch {
      fail(tr(`Couldn't read ${name} in ${data.label}: not valid JSON.`, `Não deu para ler ${name} em ${data.label}: não é um JSON válido.`));
    }
  });
  const { bundle, verdicts } = bundleFromFiles(raws);
  if (!verdicts.some((v) => v.status === 'used' && v.kind === 'transactions')) return null;
  return enrichDataset(datasetFromBundle(bundle, today), locale, tz);
}

let real: Dataset | null = null;
if (!args.demo) {
  real = loadReal();
  if (!real) process.stderr.write(`${tr(`(no real data in ${data.label}: using the demo)`, `(sem dados reais em ${data.label}: usando o demo)`)}\n`);
}
const dataset = real ?? enrichDataset(shiftDemo(demoDataset, today), locale);
const kind: ReportContext['data'] = real ? 'real' : 'demo';
const report = analyzeSubscriptions(dataset, { knowledge: knowledgeFor(dataset), today: dataset.referenceDate, locale });

// ---------- os ajustes ----------

let prefs: EarningsPrefs = DEFAULT_EARNINGS_PREFS;
if (args.prefs) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(args.prefs, 'utf8'));
  } catch {
    fail(tr(`--prefs: couldn't read ${args.prefs} as JSON.`, `--prefs: não deu para ler ${args.prefs} como JSON.`));
  }
  const merged = validateEarningsPrefs({ ...DEFAULT_EARNINGS_PREFS, ...(raw && typeof raw === 'object' ? raw : {}), version: 1 });
  if (!merged) fail(tr('--prefs: the file doesn’t have the screen’s settings format.', '--prefs: o arquivo não tem o formato dos ajustes da tela.'));
  prefs = merged;
}
if (args.plan !== undefined) {
  const plan = args.plan.toLowerCase();
  if (!['core', 'luxe', 'pinnacle', 'vip'].includes(plan)) fail(tr('--plan: use core, luxe, pinnacle or vip.', '--plan: use core, luxe, pinnacle ou vip.'));
  prefs = { ...prefs, tier: plan as EarningsPrefs['tier'] };
}
const ratePct = number('rate', args.rate);
if (ratePct !== undefined) {
  if (ratePct < 0 || ratePct > RATE_MAX * 100) fail(tr(`--rate: from 0 to ${RATE_MAX * 100} (%).`, `--rate: de 0 a ${RATE_MAX * 100} (%).`));
  prefs = { ...prefs, rate: Math.round(ratePct * 100) / 10000 };
}
if (args.base !== undefined) {
  if (args.base !== 'card' && args.base !== 'recurring') fail(tr('--base: use card or recurring.', '--base: use card ou recurring.'));
  prefs = { ...prefs, base: args.base };
}
(args.add ?? []).forEach((spec, i) => {
  const m = /^(.+?)=\s*((?:US)?\$?\s*\d[\d.,]*?)\s*(?:\/\s*(ano|anual|yr|year|yearly|annual|m[eê]s|mo|month|monthly))?\s*(?:,\s*(fora|off-card|offcard))?\s*$/i.exec(spec);
  const amount = m ? parseAmount(m[2]) : null;
  if (!m || amount === null || !(amount > 0)) fail(tr(`--add "${spec}": use "Name=49.90", "Name=1200/yr" or "Name=49.90,off-card".`, `--add "${spec}": use "Nome=49.90", "Nome=1200/ano" ou "Nome=49.90,fora".`));
  const cycle = m[3] && /^(ano|anual|yr|year|yearly|annual)$/i.test(m[3]) ? 'annual' : 'monthly';
  const next = upsertManual(prefs, { id: `cli-${i + 1}`, name: m[1], amount, currency: 'USD', cycle, onCard: !m[4] });
  if (next === prefs) fail(tr(`--add "${spec}": the item isn’t valid (name up to 60 characters, amount up to 1,000,000).`, `--add "${spec}": item inválido (nome até 60 caracteres, valor até 1.000.000).`));
  prefs = next;
});
if (args.exclude?.length) {
  const first = buildEarnings(dataset, { prefs, report }, locale);
  const keys: string[] = [];
  for (const needle of args.exclude) {
    const hits = first.items.filter((i) => i.name.toLowerCase().includes(needle.toLowerCase()));
    if (!hits.length) process.stderr.write(`${tr(`(--exclude "${needle}": no item with that name)`, `(--exclude "${needle}": nenhum item com esse nome)`)}\n`);
    keys.push(...hits.map((i) => i.key));
  }
  prefs = { ...prefs, excluded: [...new Set([...prefs.excluded, ...keys])] };
}

// ---------- a conta, o "e se" e as mudanças ----------

const e = buildEarnings(dataset, { prefs, report }, locale);
const now = snapshotOf(e, dataset.referenceDate);
const ctx: ReportContext = { locale, date: dataset.referenceDate, data: kind, prefs };

const whatIf: WhatIf = {};
const extra = number('extra-liquid', args['extra-liquid']);
const apy = number('apy', args.apy);
if (extra !== undefined) whatIf.extraLiquidUsd = extra;
if (apy !== undefined) whatIf.liquidApy = apy;
if (extra !== undefined || apy !== undefined) {
  const errors = whatIfErrors(dataset, whatIf);
  if (errors.length) fail(errors.map((c) => whatIfErrorText(c, tr)).join('\n'));
  const se = buildEarnings(applyWhatIf(dataset, whatIf), { prefs, report }, locale);
  ctx.scenario = { whatIf, earnings: se, changes: earningsChanges(now, snapshotOf(se, dataset.referenceDate), tr, 'scenario') };
}

const snapPath = join(data.dir, SNAPSHOT_FILE);
if (args.changes) {
  if (kind === 'demo') process.stderr.write(`${tr('(--changes works with real data only)', '(--changes só funciona com dados reais)')}\n`);
  else if (!existsSync(snapPath)) process.stderr.write(`${tr('(no saved snapshot yet: run with --save first)', '(ainda não há foto gravada: rode antes com --save)')}\n`);
  else {
    let prev;
    try {
      prev = validateSnapshot(JSON.parse(readFileSync(snapPath, 'utf8')));
    } catch {
      prev = undefined;
    }
    if (!prev) process.stderr.write(`${tr(`(${SNAPSHOT_FILE} is unreadable: run with --save to replace it)`, `(${SNAPSHOT_FILE} está ilegível: rode com --save para trocar)`)}\n`);
    else ctx.changes = { since: prev.at, list: earningsChanges(prev, now, tr, 'since') };
  }
}

process.stdout.write(`${args.json ? JSON.stringify(earningsJson(e, ctx), null, 2) : earningsMarkdown(e, ctx)}\n`);

if (args.save) {
  if (kind === 'demo') process.stderr.write(`${tr('(--save works with real data only: nothing saved)', '(--save só funciona com dados reais: nada gravado)')}\n`);
  else {
    writeFileSync(snapPath, `${JSON.stringify(now, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stderr.write(`${tr(`(snapshot saved: ${displayPath(snapPath)})`, `(foto gravada: ${displayPath(snapPath)})`)}\n`);
  }
}
