export const MCP_URL = 'https://mcp.ether.fi/mcp';
export const RESOURCE = 'https://mcp.ether.fi/mcp';
export const ISSUER = 'https://mcp.ether.fi';

/**
 * Origens cujo navegador o CORS do conector aceita. Testado em 2026-10: claude.ai sim; localhost, *.pages.dev e
 * *.github.io recebem 403, e o /oauth2/register nem responde ao preflight. Ou seja: nenhum site próprio conecta hoje.
 * Um deploy que a ether.fi liberar entra aqui, ou liga VITE_CONNECTOR_CORS=1 no build.
 */
export const CONNECTOR_ORIGINS: readonly string[] = [];

/** Esta página consegue falar com o conector direto do navegador? Se não, o caminho é o npm run pull + importar. */
export function connectorAcceptsOrigin(origin: string = window.location.origin): boolean {
  return import.meta.env.VITE_CONNECTOR_CORS === '1' || CONNECTOR_ORIGINS.includes(origin);
}

/**
 * Identidade: nome próprio + o produto com que funciona. O vínculo com a ether.fi é só por texto e links
 * (nada de logo ou cor da ether.fi), e a interface sempre diz que o projeto é independente e só leitura.
 */
export const PRODUCT = 'Lighthouse';
export const PRODUCT_FOR = { en: 'for ether.fi Cash', pt: 'para ether.fi Cash' } as const;
export const PRODUCT_TAGLINE = { en: 'Your card, explained', pt: 'Seu cartão, explicado' } as const;
// sem quebra feia no celular: o "·" fica preso ao item anterior por um espaço não separável, e "read-only" e
// "só leitura" não partem (hífen não separável U+2011 e espaço U+00A0)
const NBSP = String.fromCharCode(0xa0);
const NBHY = String.fromCharCode(0x2011);
export const INDEPENDENCE_NOTE = {
  en: `Independent${NBSP}· not affiliated with ether.fi${NBSP}· read${NBHY}only`,
  pt: `Independente${NBSP}· sem vínculo com a ether.fi${NBSP}· só${NBSP}leitura`,
} as const;
/** Link do ether.fi Cash com o código de indicação do autor (@moneyback); quem fizer fork pode trocar pelo seu */
export const ETHERFI_CASH_URL = 'https://www.ether.fi/@moneyback';
/** Crédito discreto no rodapé */
export const AUTHOR = { handle: '@rogeriomenezesx', url: 'https://x.com/rogeriomenezesx' } as const;
/** Página oficial do conector de IA, onde a conexão é explicada e revogada */
export const ETHERFI_CONNECTOR_URL = 'https://www.ether.fi/ai-connector';
/**
 * Repositório público do projeto (URL do GitHub, sem barra no fim). Quem fizer fork pode trocar pelo seu ou pôr null:
 * aí a página "Comece aqui" (#/start) fala do "repositório do projeto no GitHub" sem link e o pedido para o Claude
 * leva um marcador para a pessoa trocar.
 */
export const REPO_URL: string | null = 'https://github.com/rogeriomr/lighthouse-for-etherfi-cash';
/**
 * Como levar os .json ao celular: o mesmo conselho na Conexão e no "Comece aqui" (#/start). São o histórico financeiro
 * inteiro: direto (AirDrop ou cabo) e, se precisar passar por uma nuvem, apagar de lá depois.
 */
export const PHONE_TRANSFER = {
  en: 'Send the .json files to the phone directly, by AirDrop or cable. If you have to use a cloud folder, delete them from it afterwards.',
  pt: 'Mande os .json para o celular direto, por AirDrop ou cabo. Se precisar usar uma pasta na nuvem, apague-os de lá depois.',
} as const;
/** Página do Claude Code (o caminho recomendado para quem não programa) */
export const CLAUDE_CODE_URL = 'https://claude.com/claude-code';

// label/description nas duas línguas: a tela escolhe com localized(text, locale)
export const SCOPES = [
  {
    id: 'transactions:read',
    label: { en: 'Transactions', pt: 'Transações' },
    description: {
      en: 'Card purchases and on-chain activity: merchant, amount, date, category.',
      pt: 'Compras no cartão e atividade on-chain: estabelecimento, valor, data, categoria.',
    },
  },
  {
    id: 'cards:read',
    label: { en: 'Cards', pt: 'Cartões' },
    description: {
      en: 'Nickname, type and last 4 digits. Never the full number, CVC or expiry date.',
      pt: 'Apelido, tipo e últimos 4 dígitos. Nunca número completo, CVC ou validade.',
    },
  },
  {
    id: 'balances:read',
    label: { en: 'Balances and holdings', pt: 'Saldos e ativos' },
    description: {
      en: 'Spending power, limit, borrowed amount, holdings and vault address.',
      pt: 'Poder de compra, limite, valor emprestado, ativos e endereço do vault.',
    },
  },
] as const;

export const PRIVACY_NOTE = {
  en: 'The vault address is a permanent public identifier: anyone who has it can see all of the account’s on-chain activity, even after you revoke the connection.',
  pt: 'O endereço do vault é um identificador público permanente: quem o tiver consegue ver toda a atividade on-chain da conta, mesmo depois de revogar a conexão.',
} as const;
