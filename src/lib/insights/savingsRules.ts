// Regras declarativas de economia da aba AI Insights: DCC provável, armadilhas do anual, assinaturas sobrepostas e
// clubes. Só dados com fonte; a detecção e o texto do cartão ficam no motor (savingsCards). Nenhuma regra é
// recomendação: cada uma descreve um fato conferível ou uma conta com parâmetros públicos, e o motor diz "confira".
// Os serviços são subscriptionKey(record.name), como no PRICE_BOOK.

import type { LocalizedText } from '../locale';
import { CATEGORY } from '../merchants.ts';
import type { Country, PriceSource } from './priceBook';

const CHECKED = '2026-10-19';
const official = (label: string, url: string): PriceSource => ({ label, url, checked: CHECKED, level: 'official' });

// ---------- DCC (conversão na maquininha) ----------

export interface DccRules {
  /** Compra com moeda local USD a até tantos dias de uma compra em outra moeda estrangeira (nem a da casa, nem USD) */
  tripWindowDays: number;
  /** Categorias em que cobrar em USD é comum (serviço online, hotel, passagem): ficam fora */
  excludeCategories: string[];
  /** Assinaturas detectadas cobram na moeda delas: ficam fora */
  excludeSubscriptions: boolean;
  /**
   * Trechos do descritor da fatura (merchantRaw) que só aparecem em estabelecimento brasileiro. Compra deles em USD
   * costuma ser a maquininha oferecendo a moeda do cartão; "SERVICOS" sem acento é português ("SERVICIOS" em espanhol)
   */
  localDescriptors: RegExp[];
  /** O mesmo estabelecimento (nome legível) já cobrou na moeda da casa: sinal mais forte que o descritor */
  seenInHomeCurrency: boolean;
  /**
   * Faixas medidas por estudos, só como contexto ("estudos mediram de X% a Y%"): o painel não sabe o markup de uma
   * compra e não calcula quanto ela custou a mais
   */
  measuredMarkup: { shops: [number, number]; atms: [number, number]; source: PriceSource };
  sources: PriceSource[];
}

export const DCC: DccRules = {
  tripWindowDays: 2,
  excludeCategories: [CATEGORY.software, CATEGORY.travel],
  excludeSubscriptions: true,
  localDescriptors: [/\bLTDA\b/i, /\bEIRELI\b/i, /\bSERVICOS\b/i, /^IFD ?\*/i],
  seenInHomeCurrency: true,
  // Stiftung Warentest (2016, 13 países fora do euro), citado pela BEUC
  measuredMarkup: {
    shops: [0.02, 0.05],
    atms: [0.026, 0.12],
    source: {
      label: 'BEUC · Dynamic currency conversion (2017)',
      url: 'https://www.dlapiperintelligence.com/investmentrules/blog/articles/2018/downloads/beuc-x-2017-118_dynamic_currency_conversion_position_paper.pdf',
      checked: CHECKED,
      level: 'press',
      published: '2017-10-30',
    },
  },
  sources: [
    // a ether.fi recomenda pagar na moeda local: o DCC "usually includes a higher exchange rate markup"
    official('ether.fi · FX rate on Cash transactions', 'https://help.ether.fi/en/articles/304414-what-s-the-foreign-exchange-fx-rate-used-on-cash-transactions'),
    // compra em EUR sem taxa de câmbio (beta), que não vale com DCC
    official('ether.fi · EUR purchases, 0 FX rate', 'https://help.ether.fi/en/articles/604957-eur-purchases-0-fx-rate'),
    // a maquininha brasileira também oferece a moeda do cartão estrangeiro
    official('Cielo · Conversor de Moedas', 'https://blog.cielo.com.br/produtos-e-servicos/conversor-de-moedas-saiba-como-receber-pagamentos-com-cartoes-estrangeiros-na-maquininha/'),
  ],
};

// ---------- Anual contra mensal ----------

/**
 * Prazo longo que economiza menos que isto sobre o mensal (1 − total ÷ (meses × mensal), pelo PRICE_BOOK) vira
 * armadilha "quase não economiza"; abaixo de zero, "sai mais caro por mês que o mensal" (o pacote de 3 meses do Spotify)
 */
export const TINY_TERM_SAVING = 0.05;

/** Regras de cancelamento e renovação que a conta de preço não mostra */
export type AnnualTrapKind = 'keeps_charging' | 'cancellation_fee' | 'prepaid_no_renewal';

export interface AnnualTrap {
  service: string;
  /** Sem plano: vale para todos os do serviço com prazo longo */
  plan?: string;
  country: Country;
  kind: AnnualTrapKind;
  text: LocalizedText;
  source: PriceSource;
}

export const ANNUAL_TRAPS: AnnualTrap[] = [
  {
    service: 'max',
    country: 'BR',
    kind: 'keeps_charging',
    text: {
      en: 'On the 12-month plan, canceling does not stop the installments: they continue until the end of the contract, with no refund for early cancellation.',
      pt: 'No plano de 12 meses, cancelar não para as parcelas: elas seguem até o fim do contrato, sem reembolso por cancelamento antecipado.',
    },
    source: official('HBO Max · Cancelar a assinatura', 'https://help.hbomax.com/br/Answer/Detail/000002526'),
  },
  {
    service: 'adobe',
    country: 'BR',
    kind: 'cancellation_fee',
    text: {
      en: "Canceling the annual plan paid monthly after the refund window adds a one-time charge of 20% of the remaining installments (Adobe's terms for Brazil).",
      pt: 'Cancelar o anual pago mês a mês fora do prazo de reembolso gera uma cobrança única de 20% das parcelas restantes (termos da Adobe no Brasil).',
    },
    source: official('Adobe · Termos de assinatura e cancelamento (BR)', 'https://www.adobe.com/br/legal/subscription-terms.html'),
  },
  {
    service: 'spotify',
    country: 'BR',
    kind: 'prepaid_no_renewal',
    text: {
      en: 'Prepaid packages do not renew automatically: Premium stops at the end of the term.',
      pt: 'Os pacotes pagos adiantado não renovam sozinhos: o Premium para no fim do prazo.',
    },
    source: official('Spotify · Premium (BR)', 'https://www.spotify.com/br-pt/premium/'),
  },
];

// ---------- Assinaturas sobrepostas ----------

/** Tipo de serviço: duas ou mais assinaturas ativas no mesmo grupo é um fato a mostrar ("3 de IA"), sem juízo */
export type ServiceGroup = 'ai_assistant' | 'video' | 'music' | 'cloud_storage';

export const SERVICE_GROUPS: Record<string, ServiceGroup> = {
  'claude-anthropic': 'ai_assistant',
  'chatgpt-openai': 'ai_assistant',
  perplexity: 'ai_assistant',
  'grok-xai': 'ai_assistant',
  netflix: 'video',
  'disney-plus': 'video',
  max: 'video',
  globoplay: 'video',
  telecine: 'video',
  'paramount-plus': 'video',
  crunchyroll: 'video',
  spotify: 'music',
  deezer: 'music',
  'amazon-music': 'music',
  'google-one': 'cloud_storage',
  'icloud-plus': 'cloud_storage',
  dropbox: 'cloud_storage',
};

/** Um plano que já inclui outro serviço, ou algo do mesmo grupo, que a pessoa também paga à parte */
export interface BundleOverlap {
  bundle: string;
  /** Planos do PRICE_BOOK que incluem (o motor acha o plano pelo valor da cobrança); sem o campo, todos */
  bundlePlans?: string[];
  country?: Country;
  includesService?: string;
  includesGroup?: ServiceGroup;
  text: LocalizedText;
  source: PriceSource;
}

const GOOGLE_ONE = official('Google One · Planos', 'https://one.google.com/about/plans');
// o que cada pacote inclui foi conferido nas páginas do Brasil e dos EUA; a fonte citada é a brasileira
const APPLE_ONE = official('Apple One (BR)', 'https://www.apple.com/br/apple-one/');
const M365 = official('Microsoft 365 · Comparar planos (BR)', 'https://www.microsoft.com/pt-br/microsoft-365/buy/compare-all-microsoft-365-products');

export const BUNDLE_OVERLAPS: BundleOverlap[] = [
  {
    bundle: 'google-one',
    bundlePlans: ['ai-pro'],
    country: 'BR',
    includesService: 'youtube',
    text: {
      en: 'Google AI Pro includes YouTube Premium Lite (individual). Full YouTube Premium is a different plan.',
      pt: 'O Google AI Pro inclui o YouTube Premium Lite (individual). O YouTube Premium completo é outro plano.',
    },
    source: GOOGLE_ONE,
  },
  {
    bundle: 'google-one',
    bundlePlans: ['ai-pro'],
    country: 'BR',
    includesGroup: 'ai_assistant',
    text: { en: 'Google AI Pro includes the Gemini app with higher limits.', pt: 'O Google AI Pro inclui o app Gemini com limites maiores.' },
    source: GOOGLE_ONE,
  },
  // a Apple cobra tudo com o mesmo descritor: o plano Apple One sai do valor e é palpite ("parece ser")
  {
    bundle: 'apple',
    bundlePlans: ['apple-one-individual', 'apple-one-family', 'apple-one-premium', 'apple-one-premier'],
    includesService: 'icloud-plus',
    text: {
      en: 'Apple One includes iCloud+ (50 GB Individual, 200 GB Family, 2 TB Premium or Premier).',
      pt: 'O Apple One inclui o iCloud+ (50 GB no Individual, 200 GB no Familiar, 2 TB no Premium ou Premier).',
    },
    source: APPLE_ONE,
  },
  {
    bundle: 'apple',
    bundlePlans: ['apple-one-individual', 'apple-one-family', 'apple-one-premium', 'apple-one-premier'],
    includesGroup: 'music',
    text: { en: 'Apple One includes Apple Music.', pt: 'O Apple One inclui o Apple Music.' },
    source: APPLE_ONE,
  },
  {
    bundle: 'apple',
    bundlePlans: ['apple-one-individual', 'apple-one-family', 'apple-one-premium', 'apple-one-premier'],
    includesGroup: 'video',
    text: { en: 'Apple One includes Apple TV.', pt: 'O Apple One inclui o Apple TV.' },
    source: APPLE_ONE,
  },
  {
    bundle: 'microsoft-365',
    includesGroup: 'cloud_storage',
    text: {
      en: 'Microsoft 365 includes OneDrive cloud storage (1 TB Personal, 2 TB shared on Family and Premium).',
      pt: 'O Microsoft 365 inclui armazenamento na nuvem do OneDrive (1 TB no Personal, 2 TB compartilhados no Family e no Premium).',
    },
    source: M365,
  },
];

// ---------- Clubes ----------

export type ClubBenefit =
  /** Volta em crédito do próprio serviço: ponto de equilíbrio = mensalidade ÷ rate, em gasto por mês */
  | { kind: 'credit_rate'; rate: number; expiresDays?: number }
  /**
   * Cupons por mês: desconto do mês = soma dos perMonth maiores min(rate × pedido, capPerUse); compara com a
   * mensalidade que a pessoa informou
   */
  | { kind: 'coupons'; perMonth: number; rate: number; capPerUse: number };

export interface ClubRule {
  service: string;
  country: Country;
  /** O gasto que o clube olha: marca (MerchantInfo.brand) e categoria (CATEGORY) das compras */
  spend: { brand: string; category: string; excludeTopUps?: boolean };
  /** Entrada do PRICE_BOOK com a mensalidade; sem ela, o preço varia por pessoa e vira campo opcional na tela */
  priceId?: string;
  benefit: ClubBenefit;
  caveats: LocalizedText[];
  sources: PriceSource[];
}

export const CLUBS: ClubRule[] = [
  {
    service: 'uber-one',
    country: 'BR',
    // recarga de saldo da Uber não é corrida (isBalanceTopUp); Uber Eats e a própria Uber One têm outra categoria
    spend: { brand: 'Uber', category: CATEGORY.transport, excludeTopUps: true },
    priceId: 'uber-one/standard/BR/direct',
    benefit: { kind: 'credit_rate', rate: 0.1, expiresDays: 60 },
    caveats: [
      {
        en: 'The 10% excludes fees and taxes, so the card total overstates it: treat the result as a ceiling.',
        pt: 'Os 10% excluem taxas e impostos, então o total do cartão superestima: o resultado é um teto.',
      },
      { en: 'Credits expire 60 days after they are granted.', pt: 'Os créditos vencem 60 dias depois de concedidos.' },
      { en: 'The page lists no delivery benefit for use in Brazil.', pt: 'A página não lista benefício de entrega para uso no Brasil.' },
    ],
    sources: [official('Uber One (BR)', 'https://www.uber.com/br/pt-br/u/uber-one/')],
  },
  {
    service: 'uber-one',
    country: 'US',
    spend: { brand: 'Uber', category: CATEGORY.transport, excludeTopUps: true },
    priceId: 'uber-one/standard/US/direct',
    benefit: { kind: 'credit_rate', rate: 0.05, expiresDays: 60 },
    caveats: [
      {
        en: 'Fees and taxes do not earn credits, so the card total overstates it: treat the result as a ceiling.',
        pt: 'Taxas e impostos não rendem crédito, então o total do cartão superestima: o resultado é um teto.',
      },
      { en: 'Credits expire 60 days after they are added to your wallet.', pt: 'Os créditos vencem 60 dias depois de entrarem na carteira.' },
      {
        en: 'The delivery benefits ($0 delivery fee above the order minimum, discounts) are not in this calculation.',
        pt: 'Os benefícios de entrega (taxa de entrega zero acima do pedido mínimo, descontos) não entram nesta conta.',
      },
    ],
    sources: [official('Uber One (US)', 'https://www.uber.com/us/en/u/uber-one/')],
  },
  {
    service: 'ifood-clube',
    country: 'BR',
    spend: { brand: 'iFood', category: CATEGORY.delivery },
    // sem página oficial pública com preço e regras, e há relatos de mensalidade diferente por pessoa
    benefit: { kind: 'coupons', perMonth: 5, rate: 0.25, capPerUse: 10 },
    caveats: [
      {
        en: 'The club price and rules vary by person and change over time: check them in the app.',
        pt: 'O preço e as regras do clube variam por pessoa e mudam com o tempo: confira no app.',
      },
    ],
    sources: [
      {
        label: 'Canaltech · O Clube iFood vale a pena?',
        url: 'https://canaltech.com.br/apps/o-clube-ifood-vale-a-pena-conheca-os-beneficios-e-precos/',
        checked: CHECKED,
        level: 'press',
        published: '2026-02-16',
      },
    ],
  },
];
