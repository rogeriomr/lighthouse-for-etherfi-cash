/** `start` ("Comece aqui", o guia de como usar com a própria conta) não entra na navegação principal */
export type View = 'portfolio' | 'spending' | 'history' | 'subscriptions' | 'statement' | 'insights' | 'start';
/** As abas do Portfólio (o nome vem de quando elas eram da Conta): o resumo e as seções de cartões, depósito e conexão */
export type AccountTab = 'summary' | 'cards' | 'deposit' | 'connect';

/** A primeira tela: endereço vazio ou desconhecido abre aqui */
export const DEFAULT_VIEW: View = 'portfolio';

/** Endereço de cada tela (hash): #/activity, #/subscriptions?item=<chave>, #/portfolio/cards… */
export const VIEW_SLUG: Record<View, string> = {
  portfolio: 'portfolio',
  spending: 'spending',
  history: 'history',
  subscriptions: 'subscriptions',
  statement: 'activity',
  insights: 'insights',
  start: 'start',
};

/**
 * Endereços antigos que continuam valendo: a Conta virou o Portfólio (#/account/cards abre #/portfolio/cards) e o Início
 * saiu, com o "Precisa de atenção" indo para Gastos (#/home?item=alerts abre a lista lá)
 */
const SLUG_ALIASES: Record<string, View> = { account: 'portfolio', home: 'spending' };

/** A tela de um trecho do endereço ("activity", "account"…); desconhecido cai na primeira tela. */
export function viewOfSlug(slug: string | undefined): View {
  if (!slug) return DEFAULT_VIEW;
  return (Object.keys(VIEW_SLUG) as View[]).find((v) => VIEW_SLUG[v] === slug) ?? SLUG_ALIASES[slug] ?? DEFAULT_VIEW;
}

/**
 * `target` leva direto a um item da tela de destino (ex.: a chave de uma assinatura);
 * a tela rola até ele, destaca por um instante e move o foco.
 */
export type Navigate = (view: View, opts?: { accountTab?: AccountTab; month?: string | null; target?: string | null }) => void;
