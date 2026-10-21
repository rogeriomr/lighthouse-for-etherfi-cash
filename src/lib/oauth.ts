import { ISSUER, RESOURCE } from './config';
import { AppError } from './errors';
import { KEYS, readSession, readStore, removeSession, removeStore, writeSession, writeStore } from './storage';

export interface StoredClient {
  clientId: string;
  redirectUri: string;
  issuedAt: number;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
}

interface PendingAuth {
  verifier: string;
  state: string;
  scopes: string[];
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const asRecord = (raw: unknown): Record<string, unknown> | undefined =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;

function validClient(raw: unknown): StoredClient | undefined {
  const r = asRecord(raw);
  if (!r || !isStr(r.clientId) || !isStr(r.redirectUri)) return undefined;
  return { clientId: r.clientId, redirectUri: r.redirectUri, issuedAt: typeof r.issuedAt === 'number' ? r.issuedAt : 0 };
}

function validTokens(raw: unknown): StoredTokens | undefined {
  const r = asRecord(raw);
  if (!r || !isStr(r.accessToken) || typeof r.expiresAt !== 'number') return undefined;
  const t: StoredTokens = { accessToken: r.accessToken, expiresAt: r.expiresAt };
  if (isStr(r.refreshToken)) t.refreshToken = r.refreshToken;
  if (isStr(r.scope)) t.scope = r.scope;
  return t;
}

function validPending(raw: unknown): PendingAuth | undefined {
  const r = asRecord(raw);
  if (!r || !isStr(r.verifier) || !isStr(r.state)) return undefined;
  return { verifier: r.verifier, state: r.state, scopes: Array.isArray(r.scopes) ? r.scopes.filter(isStr) : [] };
}

// com o storage bloqueado, a sessão continua valendo na memória até a página fechar
let memTokens: StoredTokens | null = null;

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomB64url(n: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(digest);
}

/** /callback dentro da base do app (BASE_URL), para funcionar também publicado numa subpasta */
const callbackPath = () => `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}callback`;

function callbackUri(): string {
  return `${window.location.origin}${callbackPath()}`;
}

/** fetch que vira código: recusa de CORS e falta de rede chegam como TypeError, sem status */
async function post(url: string, init: RequestInit): Promise<Response> {
  try {
    // redirect: 'error' — um 307/308 reenviaria o corpo (code_verifier, refresh_token) para outra origem
    return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new AppError('timeout');
    throw new AppError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'network');
  }
}

async function registerClient(): Promise<StoredClient> {
  const redirectUri = callbackUri();
  const res = await post(`${ISSUER}/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: 'Lighthouse for ether.fi Cash (open source, independent)',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'transactions:read cards:read balances:read',
    }),
  });
  if (!res.ok) throw new AppError('oauth_register', res.status);
  const reg = (await res.json().catch(() => ({}))) as { client_id?: unknown };
  if (!isStr(reg.client_id)) throw new AppError('oauth_register', res.status, 'no client_id');
  const client: StoredClient = { clientId: reg.client_id, redirectUri, issuedAt: Date.now() };
  writeStore(KEYS.oauthClient, client);
  return client;
}

async function ensureClient(): Promise<StoredClient> {
  const client = readStore<StoredClient | null>(KEYS.oauthClient, null, validClient);
  if (client && client.redirectUri === callbackUri()) return client;
  return registerClient();
}

export async function startAuthorize(scopes: string[]): Promise<void> {
  const client = await ensureClient();
  const verifier = randomB64url(48);
  const challenge = await codeChallenge(verifier);
  const state = randomB64url(16);
  if (!writeSession(KEYS.oauthPending, { verifier, state, scopes } satisfies PendingAuth)) throw new AppError('storage');

  const url = new URL(`${ISSUER}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', client.redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', RESOURCE);
  window.location.assign(url.toString());
}

// códigos de erro do OAuth (RFC 6749 §4.1.2.1 / §5.2): só eles entram no detalhe técnico, nunca a descrição
const OAUTH_ERRORS = new Set([
  'invalid_request', 'unauthorized_client', 'access_denied', 'unsupported_response_type', 'invalid_scope', 'server_error',
  'temporarily_unavailable', 'invalid_client', 'invalid_grant', 'unsupported_grant_type', 'invalid_target',
]);
const oauthCode = (v: unknown) => (typeof v === 'string' && OAUTH_ERRORS.has(v) ? v : undefined);

async function tokenRequest(form: Record<string, string>, previous?: StoredTokens): Promise<StoredTokens> {
  const res = await post(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown;
  };
  if (!res.ok || !isStr(body.access_token)) {
    // refresh recusado (invalid_grant) = sessão acabou: o store pede para conectar de novo
    if (previous && oauthCode(body.error) === 'invalid_grant') throw new AppError('unauthorized', res.status);
    throw new AppError('oauth_token', res.status, oauthCode(body.error));
  }
  const tokens: StoredTokens = {
    accessToken: body.access_token,
    // muitos AS omitem refresh_token no grant de refresh: preserva o anterior
    refreshToken: isStr(body.refresh_token) ? body.refresh_token : previous?.refreshToken,
    expiresAt: Date.now() + (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000 - 60000,
    scope: isStr(body.scope) ? body.scope : undefined,
  };
  memTokens = tokens;
  // sessionStorage: sobrevive ao recarregar, não ao fechar o navegador. Token de longa duração não fica no disco.
  writeSession(KEYS.oauthTokens, tokens);
  removeStore(KEYS.oauthTokens);
  return tokens;
}

/** Há um login iniciado nesta aba esperando o retorno da ether.fi. Sem ele, um /callback é ignorado. */
export function hasPendingAuth(): boolean {
  return readSession<PendingAuth | null>(KEYS.oauthPending, null, validPending) !== null;
}

/** Chamado na rota /callback com um login pendente: troca o código por tokens. */
export async function handleCallback(): Promise<{ scopes: string[] }> {
  const params = new URLSearchParams(window.location.search);
  // uso único: o pendente sai antes de qualquer comparação, dê certo ou não
  const auth = readSession<PendingAuth | null>(KEYS.oauthPending, null, validPending);
  removeSession(KEYS.oauthPending);
  if (!auth) throw new AppError('no_session');
  // o state é conferido antes de qualquer coisa: um retorno que não é deste navegador não escolhe nem o erro
  if (auth.state !== params.get('state')) throw new AppError('oauth_state');
  const error = params.get('error');
  if (error !== null) {
    // texto fixo por código; o error_description da URL nunca vai para a tela
    if (error === 'access_denied') throw new AppError('oauth_denied');
    throw new AppError('oauth_callback', undefined, oauthCode(error));
  }
  const code = params.get('code');
  if (!code) throw new AppError('oauth_no_code');
  const client = await ensureClient();
  await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: client.redirectUri,
    client_id: client.clientId,
    code_verifier: auth.verifier,
    resource: RESOURCE,
  });
  return { scopes: auth.scopes };
}

export function getTokens(): StoredTokens | null {
  return readSession<StoredTokens | null>(KEYS.oauthTokens, null, validTokens) ?? memTokens;
}

// um refresh só por vez: as 5 chamadas da carga esperam a mesma troca
let refreshing: Promise<StoredTokens> | null = null;

export async function refreshIfNeeded(): Promise<StoredTokens> {
  const tokens = getTokens();
  if (!tokens) throw new AppError('no_session');
  if (Date.now() < tokens.expiresAt) return tokens;
  if (!tokens.refreshToken) throw new AppError('unauthorized');
  const refreshToken = tokens.refreshToken;
  refreshing ??= (async () => {
    try {
      const client = await ensureClient();
      return await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.clientId,
        resource: RESOURCE,
      }, tokens);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function clearTokens(): void {
  memTokens = null;
  removeSession(KEYS.oauthTokens);
  // versões antigas guardavam a sessão no localStorage
  removeStore(KEYS.oauthTokens);
}

/** A página carregou no retorno do login (/callback dentro da base do app). */
export function isCallbackRoute(): boolean {
  return window.location.pathname.replace(/\/$/, '') === callbackPath();
}
