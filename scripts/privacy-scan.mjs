// npm run privacy: antes de publicar, compara tudo o que iria para o git (e o dist/, se existir) com os valores
// sensíveis das respostas reais, em todas as pastas de dados que existirem (LIGHTHOUSE_DATA_DIR, ~/lighthouse-data e
// fixtures/live/, ver scripts/data-dir.mjs): descritores da fatura, pares estabelecimento + valor, ids (inteiros e
// curtos) e hashes, endereços (inteiros e curtos), saldo, limite, emprestado e posições, emails, últimos 4 dígitos,
// nome da conta e dos cartões, assuntos de email, timestamps exatos, o que é só da pessoa na pesquisa local e nas
// regras locais de estabelecimento, e a lista de identidade (identity.local.json na pasta de dados, fora do git:
// { "emails": [], "names": [], "other": [] }). Lê UTF-16, escapes \uXXXX e o texto embutido em PNG, JPEG e WebP.
// Mesmo sem dados reais procura segredos (tokens, chaves), caminhos com nome de usuário, arquivos de dados fora do
// lugar e pasta de dados dentro do projeto fora do .gitignore.
// Imprime só arquivo:linha, o nível (grave ou aviso) e o tipo, nunca o dado. Sai com 1 se houver algo grave ou um
// aviso fora de scripts/privacy-allow.json (marcas públicas conferidas), e com 0 caso contrário.
// Use como pré-commit: npm run privacy && git commit ...
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { displayPath, existingDataDirs, isInside } from './data-dir.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const rel = (p) => relative(ROOT, p).split(sep).join('/');

// ---------- de onde vêm os valores sensíveis ----------
// todas as pastas que existem, não só a que vale agora: sobra numa pasta antiga também conta
const LIVE = join(ROOT, 'fixtures', 'live');
const IDENTITY_FILE = 'identity.local.json';
const dataDirs = existingDataDirs({ root: ROOT });
const dirLabel = (d) => (isInside(d, ROOT) ? `${rel(d)}/` : displayPath(d));
if (!dataDirs.length) {
  console.log('privacy-scan: nenhuma pasta de dados (LIGHTHOUSE_DATA_DIR, ~/lighthouse-data, fixtures/live/): sem valores reais para comparar; procuro só segredos, caminhos com nome de usuário e arquivos fora do lugar.');
}

/** tipo → conjunto de valores (o texto em si nunca é impresso) */
const values = new Map();
const add = (kind, v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return;
  const s = String(v).trim();
  if (!s) return;
  if (!values.has(kind)) values.set(kind, new Set());
  values.get(kind).add(s);
};
/** estabelecimento (palavra que o identifica) → valores das compras dele */
const pairs = new Map();

const isDict = (v) => v && typeof v === 'object' && !Array.isArray(v);
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (isDict(v)) Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// palavras de descritor que não identificam ninguém (não servem de chave para o par estabelecimento + valor)
const GENERIC = new Set(`
  ltda limitada eireli comercio comercial servicos servico pagamento pagamentos brasil online store stores market
  shop shopping loja lojas mercado supermercado restaurante restaurant delivery pedido order orders payment payments
  digital service services company group holding express center centro filial matriz station posto farmacia
  drogaria pharmacy coffee cafe bakery padaria lanchonete bar grill pizza burger food foods trip trips ride rides
  google apple amazon paypal mercadopago pagseguro stripe visa master mastercard international internacional
  pending purchase charge credit debit transfer refund recurring monthly annual subscription assinatura
  domain domains account accounts premium member members plus
  `.split(/\s+/).filter(Boolean));
const keyWords = (descriptor) =>
  descriptor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5 && !GENERIC.has(w));
const amountForms = (v) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || Math.abs(n) < 1) return [];
  const fixed = Math.abs(n).toFixed(2);
  // só valores com 3+ dígitos significativos: "9.9", "30" ou "15.00" casariam com qualquer coisa
  if (fixed.replace(/\D/g, '').replace(/^0+/, '').replace(/0+$/, '').length < 3) return [];
  return [...new Set([fixed, fixed.replace('.', ','), String(Math.abs(n))])];
};
/** Saldo, limite, emprestado e valor de posição: o número exato nos formatos 1234.56, 1234,56, 1,234.56 e 1.234,56. */
const exactForms = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || Math.abs(n) < 1) return [];
  const fixed = Math.abs(n).toFixed(2);
  // 4+ dígitos significativos: "1500.00" ou "250.50" casariam com qualquer exemplo
  if (fixed.replace(/\D/g, '').replace(/^0+/, '').replace(/0+$/, '').length < 4) return [];
  const [int, dec] = fixed.split('.');
  const group = (s) => int.replace(/\B(?=(\d{3})+(?!\d))/g, s);
  return [...new Set([fixed, `${int},${dec}`, `${group(',')}.${dec}`, `${group('.')},${dec}`])];
};
/** identity.local.json: o que identifica o dono e não está nas respostas do conector */
function readIdentity(j) {
  if (!isDict(j)) return;
  for (const e of strings(j.emails)) {
    add('identidade (email)', e.toLowerCase());
    // o usuário do email sozinho também identifica (um "fulano.silva" sem o domínio)
    const user = e.split('@')[0];
    if (e.includes('@') && user.length >= 6) add('identidade (email)', user.toLowerCase());
  }
  strings(j.names).forEach((n) => add('identidade (nome)', n));
  strings(j.other).forEach((o) => add('identidade (outro)', o));
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // arquivo sendo escrito ou que não é JSON: não é motivo para a varredura falhar
  }
}

for (const dir of dataDirs) {
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const j = readJson(join(dir, name));
    if (j === undefined) continue;
    if (name === IDENTITY_FILE) {
      readIdentity(j);
      continue;
    }
    for (const s of strings(j)) for (const m of s.match(EMAIL) ?? []) add('email', m.toLowerCase());
    if (!isDict(j)) continue;
    add('nome da conta', j.accountLabel);
    if (typeof j.address === 'string') add('endereço', j.address);
    for (const k of ['totalBalance', 'availableBalance', 'creditLimit', 'borrowed']) exactForms(j[k]).forEach((f) => add('saldo ou posição', f));

    if (Array.isArray(j.transactions)) {
      for (const t of j.transactions.filter(isDict)) {
        add('id', t.id);
        add('hash de transação', t.txHash);
        if (typeof t.date === 'string') {
          add('timestamp exato', t.date);
          // até o segundo, sem fuso; hora redonda (HH:00:00) casaria com exemplo inventado
          const sec = t.date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)?.[0];
          if (sec && !/T\d{2}:00:00$/.test(sec)) add('timestamp exato', sec);
        }
        if (typeof t.merchant === 'string') {
          add('descritor da fatura', t.merchant);
          const amounts = [t.amount, t.localAmount].flatMap(amountForms);
          for (const w of keyWords(t.merchant)) {
            if (!pairs.has(w)) pairs.set(w, new Set());
            amounts.forEach((a) => pairs.get(w).add(a));
          }
        }
        if (typeof t.cardLast4 === 'string') add('last4', t.cardLast4);
      }
    }
    if (Array.isArray(j.cards)) {
      for (const c of j.cards.filter(isDict)) {
        add('id', c.id);
        add('last4', c.last4 ?? c.lastFour);
        if (typeof c.nickname === 'string' && c.nickname.trim().length >= 4) add('apelido de cartão', c.nickname);
      }
    }
    if (Array.isArray(j.holdings)) {
      for (const h of j.holdings.filter(isDict)) {
        if (HEX_ADDRESS.test(String(h.vault))) add('endereço', h.vault);
        exactForms(h.valueUsd).forEach((f) => add('saldo ou posição', f));
        // quantidade com muitas casas ("4.1234…") é tão única quanto um id
        const q = isDict(h.quantity) ? h.quantity.amount : undefined;
        if (typeof q === 'string' && q.replace(/\D/g, '').replace(/^0+/, '').length >= 6) add('saldo ou posição', q);
      }
    }

    // arquivos da IA e regras locais: reconhecidos pela forma, como o painel faz
    const items = Array.isArray(j.items) ? j.items.filter(isDict) : [];
    for (const it of items) {
      if (typeof it.emailDate === 'string' || typeof it.subject === 'string') {
        add('assunto de email', it.subject);
      } else if ('autoRenew' in it || 'riskReasons' in it) {
        for (const s of strings(it.sources)) if (/^email:/i.test(s)) add('assunto de email', s.replace(/^email:\s*/i, '').replace(/,\s*\d{4}-\d{2}-\d{2}\s*$/, ''));
      } else if ('isSubscription' in it) {
        // pesquisa local: é sobre os estabelecimentos da pessoa
        add('pesquisa local (nome)', it.name);
        strings(it.matchers).forEach((m) => add('pesquisa local (trecho)', m));
        strings(it.sources).forEach((u) => add('pesquisa local (link)', u));
        add('pesquisa local (link)', it.manageUrl);
        for (const note of strings(it.note)) if (note.length >= 24) add('pesquisa local (nota)', note);
      }
    }
    // regras locais de estabelecimento (merchant-rules.json): todo texto que identifica um estabelecimento
    if (/merchant-rules/i.test(name) || Array.isArray(j.rules)) {
      const rules = Array.isArray(j.rules) ? j.rules : items;
      for (const r of rules.filter(isDict)) {
        for (const [k, v] of Object.entries(r)) {
          if (/^(category|categoria|kind|type|cycle|subscription)$/i.test(k)) continue;
          strings(v).forEach((s) => add('regra local de estabelecimento', s));
        }
      }
    }
  }
}

// ---------- padrões ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.normalize('NFC').toLowerCase().replace(/\\/g, '').replace(/\s+/g, ' ').trim();
const bare = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, '');

// Dois níveis. GRAVE nunca entra em allowlist: o descritor completo que identifica um lugar (com número, código de
// loja, filial, CNPJ, ou nome de 3+ palavras, que pode ser de pessoa), par estabelecimento + valor, ids, endereços,
// emails, last4, assuntos, timestamps, nome da conta e dos cartões e nota da pesquisa. AVISO: um token de marca
// (1 ou 2 palavras, sem número) que coincide com a fatura, a pesquisa local ou as regras locais; passa só se estiver
// em scripts/privacy-allow.json, conferido como marca pública útil a qualquer pessoa.
const personal = (s) => /\d/.test(s) || norm(s).split(/[^\p{L}]+/u).filter((w) => w.length >= 2).length >= 3;
const brandOrGrave = (m) => (personal(m) ? 'grave' : 'aviso');
const LEVEL = {
  'descritor da fatura': brandOrGrave,
  'pesquisa local (nome)': brandOrGrave,
  'pesquisa local (trecho)': brandOrGrave,
  'regra local de estabelecimento': brandOrGrave,
  'pesquisa local (link)': () => 'aviso',
};
const levelOf = (kind, matched) => LEVEL[kind]?.(matched) ?? 'grave';

/** scripts/privacy-allow.json: { "public": [{ "token": "...", "reason": "..." }] } — só vale para AVISO. */
const ALLOW_FILE = join(ROOT, 'scripts', 'privacy-allow.json');
const allowed = new Set();
let allowProblems = 0;
if (existsSync(ALLOW_FILE)) {
  let list = [];
  try {
    const parsed = JSON.parse(readFileSync(ALLOW_FILE, 'utf8'));
    list = Array.isArray(parsed?.public) ? parsed.public : [];
  } catch {
    allowProblems++;
    console.log('scripts/privacy-allow.json não é um JSON válido: allowlist ignorada.');
  }
  for (const [i, e] of list.entries()) {
    const ok = e && typeof e.token === 'string' && e.token.trim() && typeof e.reason === 'string' && e.reason.trim();
    // a allowlist é só para marca (ou página pública de ajuda, em https): nada com número nem nome comprido
    const link = ok && /^https:\/\/[^\s/]+\//.test(e.token.trim());
    if (!ok || (!link && personal(e.token))) {
      allowProblems++;
      console.log(`scripts/privacy-allow.json: entrada ${i + 1} ignorada (precisa de token e reason; token de marca sem número e com até 2 palavras, ou link https).`);
      continue;
    }
    allowed.add(bare(e.token));
  }
}

// uma palavra só e curta ("netflix", "unique") é marca ou palavra comum: casaria com texto legítimo
const SINGLE_WORD_MIN = 8;
const distinctive = (s) => /[^a-z]/.test(s) || s.length >= SINGLE_WORD_MIN;
/** Alternância de valores (mais longos primeiro), sem colar em letra/dígito vizinho. */
function matcher(list, { min = 1, boundary = true, words = false } = {}) {
  const parts = [...new Set(list.map(norm).filter((s) => s.length >= min && /[a-z0-9]/.test(s) && (!words || distinctive(s))))]
    .sort((a, b) => b.length - a.length).map(esc);
  if (!parts.length) return null;
  const body = `(?:${parts.join('|')})`;
  // 'digits': só número vizinho conta (um timestamp segue com "Z" ou ".535Z" colados)
  if (boundary === 'digits') return new RegExp(`(?<![0-9])${body}(?![0-9])`, 'gu');
  return new RegExp(boundary ? `(?<![a-z0-9])${body}(?![a-z0-9])` : body, 'gu');
}

const RULES = [];
const rule = (kind, opts) => {
  const re = matcher([...(values.get(kind) ?? [])], opts);
  if (re) RULES.push({ kind, re });
};
rule('descritor da fatura', { min: 6, words: true });
rule('id', { min: 8 });
rule('hash de transação', { min: 16 });
rule('endereço', { min: 20 });
rule('email', { min: 6 });
rule('nome da conta', { min: 4 });
rule('apelido de cartão', { min: 4, words: true });
rule('assunto de email', { min: 10 });
rule('timestamp exato', { min: 19, boundary: 'digits' });
rule('pesquisa local (nome)', { min: 4, words: true });
rule('pesquisa local (trecho)', { min: 5, words: true });
rule('pesquisa local (link)', { min: 12, boundary: false });
rule('pesquisa local (nota)', { min: 24, boundary: false });
rule('regra local de estabelecimento', { min: 5, words: true });
rule('saldo ou posição', { min: 4 });
rule('identidade (email)', { min: 6 });
rule('identidade (nome)', { min: 4 });
rule('identidade (outro)', { min: 4 });

// last4: só em contexto de cartão (4 dígitos soltos casariam com anos e preços)
const last4 = [...(values.get('last4') ?? [])].filter((s) => /^\d{4}$/.test(s));
const LAST4 = last4.length
  ? new RegExp(`(?:last ?4|last_?four|lastfour|card_?last|ending(?: in)?|final|termina(?:do)? em|[•*·x]{2,}\\s?)\\W{0,4}(?:${last4.join('|')})(?!\\d)`, 'i')
  : null;
// apelido curto de cartão costuma ser palavra comum: só vale colado em cartão/card
const nicks = [...(values.get('apelido de cartão') ?? [])].map(norm).filter((s) => /[a-z0-9]/.test(s)).map(esc);
const NICK = nicks.length
  ? new RegExp(`(?:card|cart[ãa]o)\\W{0,3}(?:${nicks.join('|')})(?![a-z0-9])|(?<![a-z0-9])(?:${nicks.join('|')})\\W{0,3}(?:card|cart[ãa]o)`, 'u')
  : null;
// endereço curto, como as telas e os prints mostram (0x1234…abcd)
const addrs = [...(values.get('endereço') ?? [])].map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a));
const SHORT_ADDRESS = addrs.length
  ? new RegExp(addrs.map((a) => `${a.slice(0, 6)}[^0-9a-f]{0,6}(?:[0-9a-f]{0,34}[^0-9a-f]{1,6})?${a.slice(-4)}(?![0-9a-f])`).join('|'))
  : null;
// id curto: os 8 primeiros caracteres de um id no formato uuid
const shortIds = [...new Set([...(values.get('id') ?? [])].map((s) => s.toLowerCase()).filter((s) => /^[0-9a-f]{8}-/.test(s)).map((s) => s.slice(0, 8)))];
const SHORT_ID = shortIds.length ? new RegExp(`(?<![0-9a-f])(?:${shortIds.join('|')})(?![0-9a-f])`) : null;

const PAIR_WORDS = matcher([...pairs.keys()], { min: 5 });
const MINIFIED_LINE = 1000;
const PAIR_CHARS = 120;
const amountRe = new Map();
const amountsOf = (word) => {
  if (!amountRe.has(word)) {
    const list = [...(pairs.get(word) ?? [])].map(esc);
    amountRe.set(word, list.length ? new RegExp(`(?<![\\d.,])(?:${list.join('|')})(?![\\d])`) : null);
  }
  return amountRe.get(word);
};
// caminho com o nome de usuário do Windows/macOS/Linux (vale para qualquer pessoa, não depende das fixtures);
// só no começo de um caminho: "/home/" no meio de uma URL não conta
const USER_PATH = /(?:\b[A-Za-z]:[\\/]{1,2}[Uu]sers|(?<![\w.~-])\/Users|(?<![\w.~-])\/home)[\\/]{1,2}(?!(?:[Pp]ublic|[Dd]efault|you|your|username|user|name|me|runner)\b|[<$%{])[^\\/\s"'`<>]+/;

// segredos: valem para qualquer pessoa, com ou sem dados reais; exemplo óbvio ("your-key", "<token>") não conta
const SECRETS = [
  ['segredo (chave sk-)', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
  ['segredo (chave sk_)', /\bsk_(?:live_|test_)?[A-Za-z0-9]{24,}/],
  ['segredo (token do GitHub)', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ['segredo (chave da AWS)', /\bAKIA[0-9A-Z]{16}\b/],
  ['segredo (token do Slack)', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['segredo (chave do Google)', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['segredo (JWT)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  ['segredo (chave privada)', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['segredo (Bearer)', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ['segredo (URL com token)', /[?&#](?:access_token|refresh_token|id_token|token|api_?key|key|secret|sig|signature|code)=[A-Za-z0-9._~%-]{16,}/i],
  ['segredo (valor atribuído)', /\b(?:client_secret|api_?key|secret_?key|password|passwd|auth_?token|access_token|refresh_token)\b["']?\s*[:=]\s*["'][^"'\s${}]{8,}["']/i],
];
const PLACEHOLDER = /fake|dummy|example|exemplo|sample|placeholder|xxxx|your[-_]|seu[-_]|<[^>]*>|\.\.\./i;

// ---------- o que seria publicado ----------
const SKIP_DIRS = new Set(['node_modules', '.git']);
// pasta de dados dentro do projeto e fora de fixtures/live/: o pull recusa gravar nela, e o git a publicaria, a não
// ser que ela esteja no .gitignore. Sem git para conferir, conta como publicável
const gitIgnores = (d) => spawnSync('git', ['check-ignore', '-q', `${rel(d)}/`], { cwd: ROOT }).status === 0;
const exposedDataDirs = dataDirs.filter((d) => isInside(d, ROOT) && !isInside(d, LIVE) && !gitIgnores(d));
const SKIP_PATHS = new Set(['fixtures/live', 'fixtures/.pull-client.json', ...dataDirs.filter((d) => isInside(d, ROOT) && !exposedDataDirs.includes(d)).map(rel)]);
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const BINARY_EXT = /\.(gif|avif|ico|woff2?|ttf|otf|eot|pdf|zip|gz|7z|mp4|webm|mov|mp3|wav)$/i;
// nomes dos arquivos do pull e da IA: fora da pasta de dados e das fixtures sintéticas, são dado real fora do lugar
const DATA_NAME = /^(?:get_main_account|get_portfolio|get_deposit_address|list_cards|list_transactions\.page\d+|ptax|subscription-evidence|subscription-research|renewal-audit|merchant-rules|identity\.local|\.pull-client)\.json$/i;
// imagem a partir deste tamanho é print de tela: fora de docs/screenshots/, aviso para conferir que é do demo
const SCREENSHOT_PX = 600;

/** Texto de arquivo: UTF-8 ou UTF-16 (o que o ">" do Windows PowerShell 5.1 grava), com \uXXXX e \xXX decodificados. null: binário. */
function bufferText(buf) {
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le', 2);
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1))).swap16().toString('utf16le');
  else {
    // UTF-16 sem BOM: o byte alto de cada letra é zero
    const head = buf.subarray(0, 4096);
    let zeros = 0;
    for (let i = 1; i < head.length; i += 2) if (head[i] === 0) zeros++;
    text = head.length >= 16 && zeros > head.length / 4 ? buf.toString('utf16le') : buf.toString('utf8');
  }
  if (text.includes('\u0000')) return null;
  return text.replace(/\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g, (m, u, x) => {
    const c = parseInt(u ?? x, 16);
    return c >= 0x20 && c !== 0x7f ? String.fromCharCode(c) : m;
  });
}

/** Só o texto embutido de uma imagem (PNG tEXt/zTXt/iTXt/eXIf e o que vem depois do IEND, JPEG APPn/COM, WebP EXIF/XMP) e o tamanho dela. */
function imageText(buf) {
  const out = [];
  const latin = (b) => b.toString('latin1').replace(/[\u0000-\u001f]+/g, ' ');
  let size = [0, 0];
  if (buf.length >= 24 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    size = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    for (let off = 8; off + 12 <= buf.length; ) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (type === 'tEXt' || type === 'eXIf') out.push(latin(data));
      else if (type === 'zTXt' || type === 'iTXt') {
        // zTXt: palavra-chave \0 método texto; iTXt: palavra-chave \0 flag método idioma \0 palavra traduzida \0 texto
        const z = data.indexOf(0);
        const compressed = type === 'zTXt' || data[z + 1] === 1;
        let body = type === 'zTXt' ? data.subarray(z + 2) : data.subarray(data.indexOf(0, data.indexOf(0, z + 3) + 1) + 1);
        try {
          if (compressed) body = inflateSync(body);
        } catch {
          /* chunk corrompido: fica o que der para ler */
        }
        out.push(`${latin(data.subarray(0, z))} ${type === 'iTXt' ? body.toString('utf8') : latin(body)}`);
      }
      off += 12 + len;
      if (type === 'IEND') {
        if (off < buf.length) out.push(latin(buf.subarray(off)));
        break;
      }
    }
  } else if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let off = 2; off + 4 <= buf.length && buf[off] === 0xff; ) {
      const marker = buf[off + 1];
      if (marker === 0xda || marker === 0xd9) break; // daqui em diante é a imagem em si
      const len = buf.readUInt16BE(off + 2);
      if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) out.push(latin(buf.subarray(off + 4, off + 2 + len)));
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && off + 9 <= buf.length) size = [buf.readUInt16BE(off + 7), buf.readUInt16BE(off + 5)];
      off += 2 + len;
    }
  } else if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    for (let off = 12; off + 8 <= buf.length; ) {
      const type = buf.toString('latin1', off, off + 4);
      const len = buf.readUInt32LE(off + 4);
      if (type === 'EXIF' || type === 'XMP ') out.push(latin(buf.subarray(off + 8, off + 8 + len)));
      off += 8 + len + (len & 1);
    }
  }
  return { text: out.join('\n'), size };
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const r = rel(full);
    if (SKIP_PATHS.has(r)) continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
    } else if (entry.isFile() && !BINARY_EXT.test(entry.name)) {
      files.push(full);
    }
  }
})(ROOT);

/** arquivo:linha → { tipo → nível mais alto que não passou na allowlist } */
const findings = [];
let allowedHits = 0;
let screenshots = 0;
for (const d of exposedDataDirs) findings.push({ file: `${rel(d)}/`, line: 0, kind: 'pasta de dados dentro do projeto e fora do .gitignore', level: 'grave' });
for (const file of files) {
  const r = rel(file);
  if (DATA_NAME.test(file.split(sep).pop()) && !r.startsWith('fixtures/sample/')) findings.push({ file: r, line: 1, kind: 'arquivo de dados fora do lugar', level: 'grave' });
  let text;
  try {
    if (statSync(file).size > 32 * 1024 * 1024) continue;
    const buf = readFileSync(file);
    if (IMAGE_EXT.test(file)) {
      const img = imageText(buf);
      if (Math.max(...img.size) >= SCREENSHOT_PX) {
        if (r.startsWith('docs/screenshots/')) screenshots++;
        else findings.push({ file: r, line: 1, kind: 'imagem do tamanho de um print fora de docs/screenshots (confira que é do demo)', level: 'aviso' });
      }
      text = img.text;
    } else {
      text = bufferText(buf);
    }
  } catch {
    continue;
  }
  if (!text) continue;
  const lines = text.split(/\r?\n/);
  const normalized = lines.map(norm);
  const hit = new Map();
  const found = (i, kind, level) => {
    const key = `${i + 1}\t${kind}`;
    if (hit.get(key) !== 'grave') hit.set(key, level);
  };
  normalized.forEach((line, i) => {
    if (!line) return;
    for (const { kind, re } of RULES) {
      for (const m of line.matchAll(re)) {
        const level = levelOf(kind, m[0]);
        if (level === 'aviso' && allowed.has(bare(m[0]))) {
          allowedHits++;
          continue;
        }
        found(i, kind, level);
      }
    }
    if (LAST4?.test(line)) found(i, 'last4', 'grave');
    if (NICK?.test(line)) found(i, 'apelido de cartão', 'grave');
    if (SHORT_ADDRESS?.test(line)) found(i, 'endereço curto', 'grave');
    if (SHORT_ID?.test(line)) found(i, 'id curto', 'grave');
    if (USER_PATH.test(lines[i])) found(i, 'caminho com nome de usuário', 'grave');
    for (const [kind, re] of SECRETS) {
      const m = lines[i].match(re);
      if (m && !PLACEHOLDER.test(m[0])) found(i, kind, 'grave');
    }
    if (PAIR_WORDS) {
      // até 2 linhas antes e depois; numa linha minificada (o bundle inteiro numa "linha"), só 120 caracteres de cada
      // lado do nome, senão qualquer número em qualquer lugar do arquivo casaria
      const minified = line.length > MINIFIED_LINE;
      const lineWindow = minified ? '' : normalized.slice(Math.max(0, i - 2), i + 3).join('\n');
      for (const m of line.matchAll(PAIR_WORDS)) {
        const window = minified ? line.slice(Math.max(0, m.index - PAIR_CHARS), m.index + m[0].length + PAIR_CHARS) : lineWindow;
        if (amountsOf(m[0])?.test(window)) found(i, 'estabelecimento + valor', 'grave');
      }
    }
  });
  for (const [key, level] of hit) {
    const [line, kind] = key.split('\t');
    findings.push({ file: rel(file), line: Number(line), kind, level });
  }
}

const order = { grave: 0, aviso: 1 };
findings.sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
const totalValues = [...values.values()].reduce((s, set) => s + set.size, 0) + pairs.size;
console.log(`privacy-scan: ${files.length} arquivos publicáveis${existsSync(join(ROOT, 'dist')) ? ' (com dist/)' : ''} contra ${totalValues} valores de ${dataDirs.map(dirLabel).join(', ') || 'nenhuma pasta de dados'}`);
// pixels não são lidos: os prints versionados precisam de uma olhada antes de publicar
if (screenshots) console.log(`${screenshots} print(s) em docs/screenshots/: confira a olho que todos mostram o selo "demo" (a varredura não lê a imagem, só o texto embutido).`);
const graves = findings.filter((f) => f.level === 'grave');
const warnings = findings.filter((f) => f.level === 'aviso');
for (const f of findings) console.log(`${f.level === 'grave' ? 'GRAVE' : 'aviso'}  ${f.file}:${f.line}  ${f.kind}`);
const summary = (list) => {
  const byKind = new Map();
  for (const f of list) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  return [...byKind].map(([k, n]) => `${k} ${n}`).join(' · ') || '—';
};
console.log(`\ngrave: ${graves.length} linha(s) (${summary(graves)})`);
console.log(`aviso fora da allowlist: ${warnings.length} linha(s) (${summary(warnings)})`);
console.log(`marcas públicas na allowlist: ${allowedHits} ocorrência(s) liberada(s) por ${allowed.size} entrada(s)${allowProblems ? `, ${allowProblems} entrada(s) com problema` : ''}`);
if (!graves.length && !warnings.length) {
  console.log('nada a corrigir.');
  process.exit(0);
}
console.log('Grave: troque por um exemplo fictício. Aviso: troque, ou, se for marca pública útil a qualquer pessoa, ponha o token em');
console.log('scripts/privacy-allow.json com o motivo. Nunca cole o valor real em issue, PR ou commit.');
process.exit(1);
