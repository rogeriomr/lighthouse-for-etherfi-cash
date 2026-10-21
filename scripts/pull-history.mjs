// Puxa a conta inteira do conector MCP oficial da ether.fi e salva as respostas cruas na pasta de dados.
// Roda no Node, fora do navegador: o CORS do conector não se aplica aqui.
// Uso: npm run pull — abre a tela de consentimento da ether.fi; o token fica só na memória, nunca no disco.
// A pasta vem de scripts/data-dir.mjs, o mesmo resolvedor do vite.config e dos checks: LIGHTHOUSE_DATA_DIR,
// ~/lighthouse-data (se existir) ou fixtures/live/.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CLIENT_FILE_NAME, LEGACY_CLIENT_FILE, PROJECT_ROOT, resolveDataDir } from './data-dir.mjs';
import { fetchPtax, ptaxFile } from './ptax.mjs';

const ISSUER = 'https://mcp.ether.fi';
const MCP_URL = 'https://mcp.ether.fi/mcp';
const SCOPES = 'transactions:read cards:read balances:read';
const PROTOCOL_VERSION = '2025-06-18';
const PORT = Number(process.env.PULL_PORT ?? 53682);
const REDIRECT = `http://localhost:${PORT}/callback`;
const DATA = resolveDataDir();
const OUT = DATA.url;
const OUT_LABEL = DATA.label;
// client_id de cliente público (sem segredo), na pasta de dados: guardado só para não registrar um cliente novo a cada
// execução. O lugar antigo (fixtures/.pull-client.json) ainda é lido.
const CLIENT_FILE = DATA.clientFile;
const HOME_HINT = process.platform === 'win32' ? '%USERPROFILE%\\lighthouse-data' : '~/lighthouse-data';
const MAX_PAGES = 200;
const WAIT_MS = 5 * 60 * 1000;

// mensagens no idioma do sistema (português ou inglês), as mesmas que a página "Comece aqui" (#/start) descreve
const PT = /^pt/i.test(process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale);
const t = (en, pt) => (PT ? pt : en);

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Texto de fora (URL do retorno, ether.fi, BCB) sem caracteres de controle nem de direção: nada de escape ANSI no terminal. */
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 300);

/** O client_id salvo para esta porta: primeiro na pasta de dados, depois em fixtures/live/ e no lugar antigo. */
function savedClient() {
  for (const file of [CLIENT_FILE, join(PROJECT_ROOT, 'fixtures', 'live', CLIENT_FILE_NAME), LEGACY_CLIENT_FILE]) {
    if (!existsSync(file)) continue;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof saved.clientId === 'string' && saved.clientId && saved.redirectUri === REDIRECT) return { clientId: saved.clientId, file };
    } catch {
      /* ilegível: vale como ausente */
    }
  }
  return null;
}

function saveClient(clientId) {
  // num clone novo, a pasta de dados ainda não existe
  mkdirSync(dirname(CLIENT_FILE), { recursive: true });
  writeFileSync(CLIENT_FILE, `${JSON.stringify({ clientId, redirectUri: REDIRECT }, null, 2)}\n`);
}

async function ensureClient() {
  const saved = savedClient();
  if (saved) {
    // veio do lugar antigo: passa a valer o da pasta de dados (o antigo fica até a pessoa apagar)
    if (saved.file !== CLIENT_FILE) saveClient(saved.clientId);
    return saved.clientId;
  }
  const res = await fetch(`${ISSUER}/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [REDIRECT],
      client_name: 'Lighthouse for ether.fi Cash (local script)',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error(t(`OAuth client registration failed (${res.status})`, `registro do cliente OAuth falhou (${res.status})`) + `: ${(await res.text()).slice(0, 200)}`);
  const reg = await res.json();
  if (typeof reg.client_id !== 'string' || !reg.client_id) throw new Error(t('OAuth client registration returned no client_id', 'registro do cliente OAuth sem client_id'));
  saveClient(reg.client_id);
  return reg.client_id;
}

/** Espera o redirect da ether.fi em localhost (IPv4 e IPv6, só loopback). */
function waitForCode(state) {
  return new Promise((resolve, reject) => {
    const servers = [];
    let listening = 0;
    let failed = 0;
    let settled = false;
    let strayNoted = false;
    const finish = (err, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const s of servers) s.close();
      if (err) reject(err);
      else resolve(code);
    };
    const handler = (req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const html = (en, pt) => `<p>${t(en, pt)}</p>`;
      // só o retorno deste pedido conta: com outro state (uma aba antiga, ou qualquer página chamando esta porta), responde
      // e continua esperando, sem encerrar o login
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html('This return is not from the current sign-in. Go back to the terminal.', 'Este retorno não é do login em andamento. Volte ao terminal.'));
        if (!strayNoted) console.log(t('Ignored a sign-in return from another request (different state). Still waiting.', 'Ignorei um retorno de login de outro pedido (state diferente). Continuo esperando.'));
        strayNoted = true;
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const ok = !error && code;
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ok
        ? html('Done. You can close this tab and go back to the terminal.', 'Pronto. Pode fechar esta aba e voltar ao terminal.')
        : html('That didn’t work. See the message in the terminal.', 'Não deu certo. Veja a mensagem no terminal.'));
      if (error) finish(new Error(`${t('ether.fi refused', 'a ether.fi recusou')}: ${clean(url.searchParams.get('error_description') ?? error)}`));
      else if (code) finish(null, code);
      else finish(new Error(t('the return from ether.fi came without a code', 'o retorno da ether.fi veio sem código')));
    };
    for (const host of ['127.0.0.1', '::1']) {
      const s = createServer(handler);
      s.on('error', (err) => {
        failed += 1;
        // IPv6 pode não existir; porta ocupada em qualquer um dos dois encerra (o navegador poderia entregar o código a
        // quem já está nela)
        if (failed === 2 || err.code === 'EADDRINUSE') finish(new Error(t(`port ${PORT} unavailable (${err.code}); set PULL_PORT to another port`, `porta ${PORT} indisponível (${err.code}); use PULL_PORT=outra`)));
      });
      s.listen(PORT, host, () => { listening += 1; });
      servers.push(s);
    }
    const timer = setTimeout(() => finish(new Error(t(`nobody approved within ${WAIT_MS / 60000} minutes`, `ninguém aprovou em ${WAIT_MS / 60000} minutos`) + ` (listening=${listening})`)), WAIT_MS);
  });
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    // aspas manuais: o & da URL quebraria o comando do cmd
    spawn('cmd', ['/c', `start "" "${url}"`], { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  }
}

async function exchangeCode(clientId, code, verifier) {
  const res = await fetch(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP_URL,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`${t('exchanging the code for a token failed', 'troca do código por token falhou')}: ${body.error_description ?? body.error ?? res.status}`);
  return body.access_token;
}

/** Cliente MCP mínimo (streamable HTTP: JSON ou SSE). */
function mcpClient(accessToken) {
  let nextId = 1;
  let session = null;
  async function rpc(method, params) {
    const notification = method.startsWith('notifications/');
    const body = notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: nextId++, method, params };
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (session) headers['mcp-session-id'] = session;
    const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    session = res.headers.get('mcp-session-id') ?? session;
    if (notification) return null;
    if (!res.ok) throw new Error(`MCP ${method}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    let msg;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      for (const evt of (await res.text()).replace(/\r\n/g, '\n').split('\n\n')) {
        const data = evt.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (parsed.id === body.id) {
          msg = parsed;
          break;
        }
      }
    } else {
      msg = await res.json();
    }
    if (!msg) throw new Error(`MCP ${method}: ${t('empty response', 'resposta vazia')}`);
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
    return msg.result;
  }
  return {
    async init() {
      await rpc('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'lighthouse-pull', version: '1.0.0' } });
      await rpc('notifications/initialized', {});
    },
    async tool(name, args = {}) {
      const r = await rpc('tools/call', { name, arguments: args });
      const text = r?.content?.find((c) => c.type === 'text')?.text;
      if (r?.isError) throw new Error(`${name}: ${text ?? t('tool error', 'erro da ferramenta')}`);
      if (r?.structuredContent) return r.structuredContent;
      if (!text) throw new Error(`${name}: ${t('response without content', 'resposta sem conteúdo')}`);
      return JSON.parse(text);
    },
  };
}

async function main() {
  // pasta do projeto fora de fixtures/live/ não está no .gitignore: o histórico iria junto no próximo commit
  if (DATA.insideProject && !DATA.ignored) {
    throw new Error(t(
      `LIGHTHOUSE_DATA_DIR points inside the project but outside fixtures/live/ (${OUT_LABEL}), where git would commit the files. Use a folder outside the project, such as ${HOME_HINT}.`,
      `LIGHTHOUSE_DATA_DIR aponta para dentro do projeto, fora de fixtures/live/ (${OUT_LABEL}), onde o git levaria os arquivos num commit. Use uma pasta fora do projeto, como ${HOME_HINT}.`,
    ));
  }
  const clientId = await ensureClient();
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const auth = new URL(`${ISSUER}/oauth2/authorize`);
  for (const [k, v] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
  })) auth.searchParams.set(k, v);

  const codePromise = waitForCode(state);
  console.log(t('Opening ether.fi’s consent screen. If the browser doesn’t open, paste this address into it:', 'Abrindo a tela de consentimento da ether.fi. Se o navegador não abrir, cole este endereço nele:'));
  console.log(auth.toString());
  openBrowser(auth.toString());
  const code = await codePromise;
  console.log(t('Approved. Reading the account…', 'Aprovado. Lendo a conta…'));

  const mcp = mcpClient(await exchangeCode(clientId, code, verifier));
  await mcp.init();

  // tudo em memória primeiro: se algo falhar no meio, os arquivos antigos continuam intactos
  const singles = {};
  for (const name of ['get_main_account', 'list_cards', 'get_portfolio', 'get_deposit_address']) {
    singles[name] = await mcp.tool(name);
  }
  const pages = [];
  let page = 1;
  while (page && pages.length < MAX_PAGES) {
    const r = await mcp.tool('list_transactions', { limit: 100, page });
    pages.push({ page, body: r });
    const count = pages.reduce((s, p) => s + (p.body.transactions?.length ?? 0), 0);
    process.stdout.write(`\r  ${t(`page ${page}: ${count} transactions`, `página ${page}: ${count} movimentações`)}`);
    // só inteiro e sempre adiante: o número vira nome de arquivo e uma resposta repetida não prende o laço
    page = Number.isSafeInteger(r.nextPage) && r.nextPage > page ? r.nextPage : null;
  }
  process.stdout.write('\n');

  // PTAX do Banco Central para o período do histórico (API pública: só as datas vão para lá). Se falhar, a puxada
  // segue sem ela e o ptax.json anterior, se houver, fica como estava
  const txDates = pages.flatMap((p) => p.body.transactions ?? []).map((r) => String(r.date ?? '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  let ptax = null;
  if (txDates.length) {
    try {
      const rates = await fetchPtax(txDates[0], new Date().toISOString().slice(0, 10));
      if (rates.length) ptax = ptaxFile(rates);
    } catch (err) {
      console.log(t(`Note: couldn't download the PTAX from the Central Bank (${clean(err.message)}); the exchange-rate insight will be off.`, `Atenção: não deu para baixar a PTAX do Banco Central (${clean(err.message)}); o insight de câmbio fica desligado.`));
    }
  }

  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) {
    if (/^list_transactions\.page\d+\.json$/.test(f)) rmSync(new URL(f, OUT));
  }
  for (const [name, body] of Object.entries(singles)) writeFileSync(new URL(`${name}.json`, OUT), `${JSON.stringify(body)}\n`);
  for (const p of pages) writeFileSync(new URL(`list_transactions.page${p.page}.json`, OUT), `${JSON.stringify(p.body)}\n`);
  if (ptax) writeFileSync(new URL('ptax.json', OUT), `${JSON.stringify(ptax)}\n`);

  const rows = pages.flatMap((p) => p.body.transactions ?? []);
  const dates = rows.map((t) => t.date).sort();
  const purchases = rows.filter((t) => t.type === 'rain_transaction').length;
  const incomplete = pages.some((p) => p.body.incomplete);
  const [from, to] = [dates[0], dates.at(-1)].map((d) => clean(String(d ?? '').slice(0, 10)));
  console.log(t(
    `Saved in ${OUT_LABEL}: ${pages.length} pages, ${rows.length} transactions (${purchases} on the card), from ${from} to ${to}.`,
    `Salvo em ${OUT_LABEL}: ${pages.length} páginas, ${rows.length} movimentações (${purchases} no cartão), de ${from} a ${to}.`,
  ));
  if (page) console.log(t(`Note: stopped at the ${MAX_PAGES}-page limit; there is older history.`, `Atenção: parou no limite de ${MAX_PAGES} páginas; há histórico mais antigo.`));
  if (ptax) console.log(t(`PTAX: ${ptax.rates.length} business days, ${clean(ptax.from)} to ${clean(ptax.to)} (ptax.json).`, `PTAX: ${ptax.rates.length} dias úteis, de ${clean(ptax.from)} a ${clean(ptax.to)} (ptax.json).`));
  if (incomplete) console.log(t('Note: the connector marked a page as incomplete (rows it could not state exactly).', 'Atenção: o conector marcou alguma página como incompleta (linhas que ele não conseguiu informar com exatidão).'));
  if (DATA.source === 'project') {
    console.log(t(
      `Tip: create ${HOME_HINT} and move these files into it. The pull, the dashboard and the checks then use it, outside the project and out of cloud-synced folders.`,
      `Dica: crie ${HOME_HINT} e mova estes arquivos para lá. O pull, o painel e os checks passam a usá-la, fora do projeto e de pastas sincronizadas.`,
    ));
  }
}

main().catch((err) => {
  console.error(`\n${t('Failed', 'Falhou')}: ${clean(err.message)}`);
  process.exit(1);
});
