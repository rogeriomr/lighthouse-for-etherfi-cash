// Links que vêm de fora do código (email, pesquisa e auditoria feitas pela IA) passam por aqui antes de virar href
// ou de entrar no .ics: um texto de terceiros não pode virar javascript:, data: nem um "cancelar" num domínio qualquer.

// controles C0, DEL e espaços dentro do endereço: o navegador ignora alguns e o .ics quebraria a linha
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\s]/;

/** Só https: com host e sem usuário/senha embutidos ("https://banco.com@outro.site"); o resto vira undefined. */
export function safeUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!text || UNSAFE_CHARS.test(text)) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return undefined;
  return url.href;
}

/** Host para mostrar ao lado do link ("vercel.com"), sem "www."; texto vazio quando não é um link seguro. */
export function urlHost(raw: unknown): string {
  const url = safeUrl(raw);
  return url ? new URL(url).hostname.replace(/^www\./, '') : '';
}

// segundo nível que faz parte do sufixo público ("com.br", "co.uk"): o site é o rótulo antes dele
const SECOND_LEVEL = new Set(['com', 'co', 'org', 'net', 'gov', 'edu', 'ac', 'gob', 'or', 'ne']);

/** Domínio registrável aproximado: "support.claude.com" → "claude.com", "ajuda.semparar.com.br" → "semparar.com.br". */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const n = labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-n).join('.');
}

// sites onde qualquer um abre uma página (central de ajuda, blog, app hospedado): aí vale o host inteiro, não o site
const SHARED = new Set([
  'zendesk.com', 'freshdesk.com', 'helpscoutdocs.com', 'intercom.help', 'gitbook.io', 'notion.site', 'medium.com',
  'substack.com', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev', 'herokuapp.com', 'blogspot.com', 'wordpress.com',
]);

/** O site que um link prova ser do serviço: o domínio registrável, ou o host inteiro numa plataforma compartilhada. */
export function serviceSite(raw: unknown): string {
  const host = urlHost(raw);
  if (!host) return '';
  const site = siteOf(host);
  return SHARED.has(site) ? host : site;
}

/**
 * O link é do serviço? `known` são os hosts ("claude.ai") ou links conhecidos do serviço na base pública; o host do link
 * precisa ser exatamente um deles ("www." não conta). Subdomínio não vale: em script.google.com, sites.google.com ou
 * docs.google.com qualquer um publica uma página com cara de "cancelar assinatura". Sem lista conhecida, nada se
 * confirma: a tela marca "não verificado".
 */
export function isKnownHost(raw: unknown, known: readonly string[]): boolean {
  const host = urlHost(raw);
  if (!host) return false;
  const hosts = known.map((k) => (k.includes('/') ? urlHost(k) : k.trim().toLowerCase().replace(/^www\./, ''))).filter(Boolean);
  return hosts.includes(host);
}
