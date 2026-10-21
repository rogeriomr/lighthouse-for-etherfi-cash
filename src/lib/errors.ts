// Erros de carregamento com código: o OAuth, o MCP e o store lançam um código fixo, e só a interface escolhe o texto,
// no idioma de quem vê (errorText). Nenhum texto vindo da URL ou do servidor chega à tela como mensagem.

import { pick, type Locale } from './locale.ts';

export type ErrorCode =
  /** fetch recusado: sem rede, ou (o caso comum) o CORS do conector não aceita esta origem */
  | 'network'
  | 'offline'
  /** 401 do conector ou token vencido sem refresh: conectar de novo */
  | 'unauthorized'
  | 'mcp_http'
  /** resposta fora do protocolo (SSE sem corpo ou sem a resposta pedida) */
  | 'mcp_protocol'
  /** erro JSON-RPC do servidor */
  | 'mcp_rpc'
  | 'tool_error'
  | 'timeout'
  | 'oauth_register'
  | 'oauth_token'
  /** a pessoa recusou na tela da ether.fi */
  | 'oauth_denied'
  /** a ether.fi devolveu outro erro no /callback */
  | 'oauth_callback'
  | 'oauth_state'
  | 'oauth_no_code'
  | 'no_session'
  | 'fixtures_missing'
  | 'fixtures_bad'
  /** nenhum dos arquivos escolhidos é do npm run pull */
  | 'import_empty'
  /** só vieram arquivos da IA: falta o extrato e a conta */
  | 'import_ai_only'
  /** arquivos demais ou grandes demais juntos: travaria a aba antes de ler */
  | 'import_too_large'
  /** o IndexedDB não devolveu os arquivos lembrados */
  | 'import_restore'
  | 'storage'
  | 'unknown';

/** O motivo de uma falha, como o store guarda: código, status HTTP e um detalhe técnico curto (só nos detalhes técnicos). */
export interface LoadError {
  code: ErrorCode;
  status?: number;
  detail?: string;
}

// sem "parameter properties": os checks rodam com --experimental-strip-types, que não as aceita
export class AppError extends Error {
  code: ErrorCode;
  status?: number;
  detail?: string;
  constructor(code: ErrorCode, status?: number, detail?: string) {
    super(detail ? `${code}: ${detail}` : status ? `${code} (${status})` : code);
    this.name = 'AppError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (detail !== undefined) this.detail = detail;
  }
}

/** Qualquer coisa lançada vira um LoadError; o que não é AppError fica como 'unknown', com o nome do erro de detalhe. */
export function toLoadError(err: unknown): LoadError {
  if (err instanceof AppError) {
    const out: LoadError = { code: err.code };
    if (err.status !== undefined) out.status = err.status;
    if (err.detail !== undefined) out.detail = err.detail;
    return out;
  }
  if (err instanceof DOMException && err.name === 'AbortError') return { code: 'timeout' };
  return { code: 'unknown', detail: err instanceof Error ? err.name : typeof err };
}

const TEXT: Record<ErrorCode, [en: string, pt: string]> = {
  network: [
    'Couldn’t reach the ether.fi connector. From a site of your own, the browser blocks the call (CORS): use npm run pull and import the files.',
    'Não deu para falar com o conector da ether.fi. A partir de um site próprio, o navegador bloqueia a chamada (CORS): use o npm run pull e importe os arquivos.',
  ],
  offline: ['You seem to be offline. Check the connection and try again.', 'Parece que você está sem internet. Confira a conexão e tente de novo.'],
  unauthorized: ['Authorization expired. Connect again to reload your data.', 'A autorização expirou. Conecte de novo para recarregar os dados.'],
  mcp_http: ['The ether.fi connector answered with an error. Try again in a moment.', 'O conector da ether.fi respondeu com erro. Tente de novo daqui a pouco.'],
  mcp_protocol: ['The connector’s answer came incomplete. Try again.', 'A resposta do conector veio incompleta. Tente de novo.'],
  mcp_rpc: ['The connector refused the request. Try again in a moment.', 'O conector recusou o pedido. Tente de novo daqui a pouco.'],
  tool_error: ['The connector returned an error for this item.', 'O conector devolveu erro para este item.'],
  timeout: ['The connector took too long to answer. Try again.', 'O conector demorou demais para responder. Tente de novo.'],
  oauth_register: [
    'ether.fi didn’t accept registering this site for sign-in. Use npm run pull and import the files.',
    'A ether.fi não aceitou registrar este site para o login. Use o npm run pull e importe os arquivos.',
  ],
  oauth_token: ['ether.fi didn’t complete the sign-in. Connect again.', 'A ether.fi não concluiu o login. Conecte de novo.'],
  oauth_denied: ['Access wasn’t approved on the ether.fi screen. Nothing was read.', 'O acesso não foi aprovado na tela da ether.fi. Nada foi lido.'],
  oauth_callback: ['ether.fi returned an error during sign-in. Connect again.', 'A ether.fi devolveu um erro no login. Conecte de novo.'],
  oauth_state: [
    'This sign-in return doesn’t match the one started here, so it was ignored. Connect again.',
    'Este retorno de login não confere com o que foi iniciado aqui, então foi ignorado. Conecte de novo.',
  ],
  oauth_no_code: ['The sign-in return came without an authorization code. Connect again.', 'O retorno do login veio sem código de autorização. Conecte de novo.'],
  no_session: ['There’s no saved session in this browser. Connect again.', 'Não há sessão salva neste navegador. Conecte de novo.'],
  fixtures_missing: [
    'No local files found. Run npm run pull in the project folder first.',
    'Nenhum arquivo local encontrado. Rode o npm run pull na pasta do projeto antes.',
  ],
  fixtures_bad: ['A local file couldn’t be read (invalid JSON).', 'Um arquivo local não pôde ser lido (JSON inválido).'],
  import_empty: [
    'None of these files came from npm run pull. Pick the .json files it saved.',
    'Nenhum destes arquivos veio do npm run pull. Escolha os .json que ele salvou.',
  ],
  import_ai_only: [
    'These are only the AI files. Import the npm run pull files too (list_transactions…, get_main_account…).',
    'Estes são só os arquivos da IA. Importe também os do npm run pull (list_transactions…, get_main_account…).',
  ],
  import_too_large: [
    'Too many files or too much data at once. Import up to 20 files, 50 MB total.',
    'Arquivos demais ou dados demais de uma vez. Importe até 20 arquivos, 50 MB no total.',
  ],
  import_restore: [
    'The files remembered in this browser couldn’t be read. Import them again.',
    'Os arquivos lembrados neste navegador não puderam ser lidos. Importe de novo.',
  ],
  storage: ['This browser blocked local storage, so nothing can be remembered.', 'Este navegador bloqueou o armazenamento local, então nada pode ser lembrado.'],
  unknown: ['Something went wrong while loading. Try again.', 'Algo deu errado ao carregar. Tente de novo.'],
};

/** O texto fixo de cada código, no idioma de quem vê. */
export function errorText(error: LoadError | ErrorCode, locale: Locale): string {
  const code = typeof error === 'string' ? error : error.code;
  const [en, pt] = TEXT[code] ?? TEXT.unknown;
  return pick(locale, en, pt);
}

/** O que a faixa de erro deve oferecer: tentar de novo, conectar de novo ou ir para a importação. */
export function errorAction(error: LoadError | ErrorCode): 'retry' | 'reconnect' | 'import' {
  const code = typeof error === 'string' ? error : error.code;
  if (code === 'network' || code === 'oauth_register' || code === 'fixtures_missing' || code.startsWith('import_')) return 'import';
  if (code === 'unauthorized' || code === 'no_session' || code.startsWith('oauth_')) return 'reconnect';
  return 'retry';
}
