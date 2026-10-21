import { MCP_URL } from './config';
import { AppError, type ErrorCode } from './errors';

const PROTOCOL_VERSION = '2025-06-18';
/** Resposta maior que isso não é histórico de conta: é falha do servidor ou conteúdo hostil. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Um evento SSE sem fechar não pode crescer sem limite na memória. */
const MAX_SSE_BUFFER = 1024 * 1024;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolCallResult {
  structured?: Record<string, unknown>;
  text?: string;
  isError?: boolean;
}

export class McpClient {
  private id = 1;
  private sessionId: string | null = null;
  private initPromise: Promise<void> | null = null;
  initialized = false;

  constructor(private getToken: () => Promise<string>) {}

  /** Sessão vencida no servidor (404 com mcp-session-id): a próxima chamada recomeça pelo initialize. */
  private resetSession() {
    this.sessionId = null;
    this.initPromise = null;
    this.initialized = false;
  }

  private async rpc(method: string, params?: Record<string, unknown>, retried = false): Promise<unknown> {
    const token = await this.getToken();
    const isNotification = method.startsWith('notifications/');
    const requestId = isNotification ? undefined : this.id++;
    const body: JsonRpcRequest = requestId === undefined
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: requestId, method, params };
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    const sentSession = this.sessionId;
    if (sentSession) headers['mcp-session-id'] = sentSession;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      let res: Response;
      try {
        // redirect: 'error' — um 307/308 reenviaria o corpo e o mcp-session-id para outra origem
        res = await fetch(MCP_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw new McpError('http', 'timeout');
        // recusa de CORS e falta de rede chegam iguais (TypeError, sem status)
        throw new McpError('http', navigator.onLine === false ? 'offline' : 'network');
      }

      // a sessão sumiu do servidor: a especificação pede um initialize novo, sem o id antigo (uma vez só)
      if (res.status === 404 && sentSession && method !== 'initialize' && !retried) {
        // com chamadas em paralelo, só a primeira derruba a sessão; as outras esperam o mesmo initialize
        if (this.sessionId === sentSession) this.resetSession();
        await this.ensureInitialized();
        return await this.rpc(method, params, true);
      }

      const sid = res.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;

      if (res.status === 401) throw new McpError('unauthorized', 'unauthorized', 401);
      if (!isNotification && res.status === 202) {
        return null;
      }
      if (!res.ok) throw new McpError('http', 'mcp_http', res.status);
      if (requestId === undefined) return null;

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        // o timeout segue ativo enquanto o stream estiver aberto
        return await this.readSse(res, requestId);
      }
      const raw = await res.text();
      if (raw.length > MAX_RESPONSE_BYTES) throw new McpError('http', 'mcp_protocol');
      let json: JsonRpcResponse;
      try {
        json = JSON.parse(raw) as JsonRpcResponse;
      } catch {
        throw new McpError('http', 'mcp_protocol');
      }
      if (!json || typeof json !== 'object') throw new McpError('http', 'mcp_protocol');
      if (json.error) throw new McpError('rpc', 'mcp_rpc', undefined, json.error.message);
      return json.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readSse(res: Response, requestId: number): Promise<unknown> {
    const reader = res.body?.getReader();
    if (!reader) throw new McpError('http', 'mcp_protocol');
    const decoder = new TextDecoder();
    let buffer = '';
    let received = 0;
    const stop = async () => {
      try { await reader.cancel(); } catch { /* noop */ }
      throw new McpError('http', 'mcp_protocol');
    };
    const consume = (chunk: string) => {
      buffer = (buffer + chunk).replace(/\r\n/g, '\n');
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      return events;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) await stop();
      for (const evt of consume(decoder.decode(value, { stream: true }))) {
        if (buffer.length > MAX_SSE_BUFFER) await stop();
        const dataLines = evt
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim());
        if (!dataLines.length) continue;
        let parsed: JsonRpcResponse;
        try {
          parsed = JSON.parse(dataLines.join('\n')) as JsonRpcResponse;
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== 'object') continue;
        if (parsed.id === requestId) {
          try { reader.cancel(); } catch { /* noop */ }
          if (parsed.error) throw new McpError('rpc', 'mcp_rpc', undefined, parsed.error.message);
          return parsed.result;
        }
      }
    }
    throw new McpError('http', 'mcp_protocol');
  }

  async ensureInitialized(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.rpc('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'lighthouse-for-etherfi-cash', version: '1.0.0' },
      });
      await this.rpc('notifications/initialized', {}).catch(() => undefined);
      this.initialized = true;
    })();
    // permite retry: se o initialize falhar, não guardamos a promise rejeitada para sempre
    try {
      await this.initPromise;
    } catch (err) {
      this.resetSession();
      throw err;
    }
  }

  async listTools(): Promise<ToolDef[]> {
    await this.ensureInitialized();
    const result = (await this.rpc('tools/list', {})) as { tools?: ToolDef[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    await this.ensureInitialized();
    const result = (await this.rpc('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    } | undefined;
    if (!result) return { isError: true };
    const structured = result.structuredContent ?? undefined;
    const text = result.content?.find((c) => c.type === 'text')?.text;
    return { structured, text, isError: result.isError };
  }
}

/**
 * Erro do conector com código fixo (ver errors.ts). `kind` separa o 401, que derruba a sessão, do resto.
 * O texto do servidor (erro JSON-RPC) fica só em `detail`, para os detalhes técnicos.
 */
export class McpError extends AppError {
  kind: 'unauthorized' | 'http' | 'rpc';
  constructor(kind: 'unauthorized' | 'http' | 'rpc', code: ErrorCode, status?: number, detail?: string) {
    super(code, status, detail?.slice(0, 200));
    this.name = 'McpError';
    this.kind = kind;
  }
}

export function parseToolJson(result: ToolCallResult): Record<string, unknown> {
  if (result.structured) return result.structured;
  if (result.text) {
    try {
      return JSON.parse(result.text) as Record<string, unknown>;
    } catch {
      return { raw: result.text };
    }
  }
  return {};
}
