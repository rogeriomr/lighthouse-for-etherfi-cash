// Nome legível e categoria a partir do texto da fatura.
// A categoria da fonte é a base; o dicionário só entra onde ela falta ou é genérica demais.
import { localized, pick, type Locale, type LocalizedText } from './locale.ts';
import { cleanText } from './cleanText.ts';
import { isSafePattern, MAX_RULE_LENGTH } from './safeRegex.ts';

// Categoria é um id estável nos dados; o nome exibido sai de categoryLabel, no idioma da tela
export const CATEGORY = {
  delivery: 'delivery',
  dining: 'dining',
  groceries: 'groceries',
  transport: 'transport',
  travel: 'travel',
  software: 'software',
  shopping: 'shopping',
  health: 'health',
  education: 'education',
  phone: 'phone',
  leisure: 'leisure',
  home: 'home',
  other: 'other',
} as const;

export type CategoryId = (typeof CATEGORY)[keyof typeof CATEGORY];

const CATEGORY_NAME: Record<CategoryId, [en: string, pt: string]> = {
  delivery: ['Food delivery', 'Delivery'],
  dining: ['Restaurants & bars', 'Restaurantes e bares'],
  groceries: ['Groceries', 'Mercado'],
  transport: ['Transportation', 'Transporte'],
  travel: ['Travel', 'Viagem'],
  software: ['Subscriptions & software', 'Assinaturas e software'],
  shopping: ['Shopping', 'Varejo'],
  health: ['Health', 'Saúde'],
  education: ['Education', 'Educação'],
  phone: ['Phone & internet', 'Celular e internet'],
  leisure: ['Entertainment', 'Lazer'],
  home: ['Home & garden', 'Casa'],
  other: ['Other', 'Outros'],
};

/** Nome da categoria no idioma da tela; id desconhecido aparece como veio */
export function categoryLabel(id: string | undefined, locale: Locale): string {
  // a categoria vem dos dados: "constructor" não pode cair no protótipo do objeto
  const key = id ?? CATEGORY.other;
  const names = Object.hasOwn(CATEGORY_NAME, key) ? CATEGORY_NAME[key as CategoryId] : undefined;
  return names ? pick(locale, ...names) : key;
}

// Categorias da ether.fi (id e nome de exibição) e do dataset demo
const RAW_CATEGORY: Record<string, string> = {
  food_dining: CATEGORY.dining,
  'food & dining': CATEGORY.dining,
  rideshare_delivery: CATEGORY.transport,
  'rideshare & delivery': CATEGORY.transport,
  groceries: CATEGORY.groceries,
  gas_fuel: CATEGORY.transport,
  'gas & fuel': CATEGORY.transport,
  transport: CATEGORY.transport,
  travel: CATEGORY.travel,
  accommodation: CATEGORY.travel,
  activities: CATEGORY.travel,
  entertainment: CATEGORY.leisure,
  retail: CATEGORY.shopping,
  'retail & shopping': CATEGORY.shopping,
  electronics: CATEGORY.shopping,
  health_pharmacy: CATEGORY.health,
  'health & pharmacy': CATEGORY.health,
  'health & fitness': CATEGORY.health,
  subscriptions: CATEGORY.software,
  home: CATEGORY.home,
};

interface Rule {
  match: RegExp;
  /** Nome próprio (string) ou descrição nas duas línguas ("Uber · ride" / "Uber · corrida"); sem ele, o nome sai do descritor */
  name?: LocalizedText;
  category?: string;
  subscription?: boolean;
  /** Marca que junta nomes diferentes (Uber corrida × Uber Eats); sem isso, a marca é o próprio nome */
  brand?: string;
}

// Ordem importa: a primeira que casa vence, então o mais específico vem antes
const RULES: Rule[] = [
  { match: /^IFOOD/i, name: 'iFood', category: CATEGORY.delivery },
  { match: /\bRAPPI\b/i, name: 'Rappi', category: CATEGORY.delivery },
  { match: /PEDIDOS ?YA/i, name: 'PedidosYa', category: CATEGORY.delivery },
  { match: /^ZE ?DELIVERY/i, name: 'Zé Delivery', category: CATEGORY.delivery },
  { match: /99 ?FOOD/i, name: '99Food', category: CATEGORY.delivery },
  // a fonte chama de "Rideshare & Delivery": sem a marca, pedido de comida viraria transporte
  { match: /DOORDASH/i, name: 'DoorDash', category: CATEGORY.delivery },
  { match: /GRUBHUB/i, name: 'Grubhub', category: CATEGORY.delivery },
  { match: /INSTACART/i, name: 'Instacart', category: CATEGORY.delivery },
  { match: /POSTMATES/i, name: 'Postmates', category: CATEGORY.delivery },
  { match: /DELIVEROO/i, name: 'Deliveroo', category: CATEGORY.delivery },
  { match: /\bGLOVO/i, name: 'Glovo', category: CATEGORY.delivery },
  { match: /JUST ?EAT/i, name: 'Just Eat', category: CATEGORY.delivery },
  { match: /LIEFERANDO/i, name: 'Lieferando', category: CATEGORY.delivery },
  { match: /\bWOLT\b/i, name: 'Wolt', category: CATEGORY.delivery },
  { match: /FOODPANDA/i, name: 'foodpanda', category: CATEGORY.delivery },
  { match: /BOLT ?FOOD|BOLT\.EU\/F\//i, name: 'Bolt Food', category: CATEGORY.delivery, brand: 'Bolt' },

  { match: /UBER\W*EATS/i, name: 'Uber Eats', category: CATEGORY.delivery, brand: 'Uber' },
  { match: /^UBER\W*CASH/i, name: { en: 'Uber · balance top-up', pt: 'Uber · recarga de saldo' }, category: CATEGORY.transport, brand: 'Uber' },
  { match: /UBER\W*ONE\b/i, name: 'Uber One', category: CATEGORY.software, subscription: true, brand: 'Uber' },
  // a pré-autorização da corrida (UBER seguido de PENDING) às vezes é o texto que fica na compra liquidada
  { match: /UBER\W*RIDES|^UBER\s*\*?\s*(TRIP|PENDING)/i, name: { en: 'Uber · ride', pt: 'Uber · corrida' }, category: CATEGORY.transport, brand: 'Uber' },
  { match: /(^|\*)UBER\b/i, name: 'Uber', category: CATEGORY.transport },
  { match: /^(DL ?\* ?)?99 ?(APP|TAXI|POP|TECNOLOGIA)\b/i, name: '99', category: CATEGORY.transport },
  { match: /CABIFY/i, name: 'Cabify', category: CATEGORY.transport },
  { match: /INDRIVE/i, name: 'inDrive', category: CATEGORY.transport },
  { match: /\bLYFT\b/i, name: 'Lyft', category: CATEGORY.transport },
  { match: /^BOLT(\.EU|\s*\*)|^BOLT (RIDE|TRIP|OPERATIONS)/i, name: 'Bolt', category: CATEGORY.transport },
  { match: /FREE ?NOW/i, name: 'FREENOW', category: CATEGORY.transport },
  { match: /^SHELL\b/i, name: 'Shell', category: CATEGORY.transport },
  { match: /CHEVRON/i, name: 'Chevron', category: CATEGORY.transport },
  { match: /EXXON|\bMOBIL\b/i, name: 'ExxonMobil', category: CATEGORY.transport },
  { match: /TEXACO/i, name: 'Texaco', category: CATEGORY.transport },
  { match: /^BP\b|\bBP (CONNECT|EXPRESS)/i, name: 'BP', category: CATEGORY.transport },
  { match: /\bESSO\b/i, name: 'Esso', category: CATEGORY.transport },
  { match: /^ARAL\b/i, name: 'Aral', category: CATEGORY.transport },
  { match: /REPSOL/i, name: 'Repsol', category: CATEGORY.transport },
  { match: /TOTALENERGIES/i, name: 'TotalEnergies', category: CATEGORY.transport },
  { match: /CIRCLE ?K\b/i, name: 'Circle K', category: CATEGORY.transport },
  { match: /SUNOCO/i, name: 'Sunoco', category: CATEGORY.transport },
  { match: /VALERO/i, name: 'Valero', category: CATEGORY.transport },
  { match: /SPEEDWAY/i, name: 'Speedway', category: CATEGORY.transport },
  // posto de rede de mercado é combustível, não compra de mercado: só a categoria, o nome sai do descritor
  { match: /(COSTCO|SAMS ?CLUB|KROGER|SAFEWAY)\W*(GAS|FUEL)/i, category: CATEGORY.transport },
  { match: /^DB (VERTRIEB|FERNVERKEHR|REGIO|BAHN)|DEUTSCHE BAHN|BAHN\.DE/i, name: 'Deutsche Bahn', category: CATEGORY.transport },
  { match: /\bSNCF\b/i, name: 'SNCF', category: CATEGORY.transport },
  { match: /RENFE/i, name: 'Renfe', category: CATEGORY.transport },
  { match: /TRENITALIA/i, name: 'Trenitalia', category: CATEGORY.transport },
  { match: /^TFL\b|TFL TRAVEL/i, name: 'TfL', category: CATEGORY.transport },
  { match: /ESTAPAR/i, name: 'Estapar', category: CATEGORY.transport },
  { match: /^SEM ?PARAR/i, name: 'Sem Parar', category: CATEGORY.transport },
  { match: /CONECTCAR/i, name: 'ConectCar', category: CATEGORY.transport },
  { match: /\bVELOE\b/i, name: 'Veloe', category: CATEGORY.transport },

  { match: /ANTHROPIC|CLAUDE\.AI/i, name: 'Claude (Anthropic)', category: CATEGORY.software, subscription: true },
  { match: /OPENAI|CHATGPT/i, name: 'ChatGPT (OpenAI)', category: CATEGORY.software, subscription: true },
  { match: /PERPLEXITY/i, name: 'Perplexity', category: CATEGORY.software, subscription: true },
  { match: /MIDJOURNEY/i, name: 'Midjourney', category: CATEGORY.software, subscription: true },
  { match: /CURSOR\W*(AI|USAGE)|ANYSPHERE/i, name: 'Cursor', category: CATEGORY.software, subscription: true },
  { match: /GITHUB/i, name: 'GitHub', category: CATEGORY.software, subscription: true },
  { match: /YOUTUB/i, name: 'YouTube', category: CATEGORY.software, subscription: true, brand: 'Google' },
  { match: /G1AI|GOOGLE\W*ONE\b/i, name: 'Google One', category: CATEGORY.software, subscription: true, brand: 'Google' },
  { match: /GOOGLE\W*(WORKSPACE|G ?SUITE)/i, name: 'Google Workspace', category: CATEGORY.software, subscription: true, brand: 'Google' },
  { match: /GOOGLE\W*PLAY/i, name: 'Google Play', category: CATEGORY.software, brand: 'Google' },
  // compra em serviço do Google pelo dLocal (prefixo DL*), sem dizer qual
  { match: /^(DL ?\* ?)?GOOGLE\b(?!\W*STORE)/i, name: 'Google', category: CATEGORY.software },
  { match: /ADOBE/i, name: 'Adobe', category: CATEGORY.software, subscription: true },
  { match: /AMAZON ?PRIME|PRIME ?VIDEO/i, name: 'Amazon Prime', category: CATEGORY.software, subscription: true, brand: 'Amazon' },
  { match: /AMAZON ?MUSIC/i, name: 'Amazon Music', category: CATEGORY.software, subscription: true, brand: 'Amazon' },
  { match: /KINDLE ?(UNLTD|UNLIMITED)/i, name: 'Kindle Unlimited', category: CATEGORY.software, subscription: true, brand: 'Amazon' },
  { match: /AMAZON WEB SERVICES|^AWS\b/i, name: 'AWS', category: CATEGORY.software, subscription: true, brand: 'Amazon' },
  { match: /NETFLIX/i, name: 'Netflix', category: CATEGORY.software, subscription: true },
  { match: /SPOTIFY/i, name: 'Spotify', category: CATEGORY.software, subscription: true },
  { match: /DEEZER/i, name: 'Deezer', category: CATEGORY.software, subscription: true },
  { match: /DISNEY ?(PLUS|\+)/i, name: 'Disney+', category: CATEGORY.software, subscription: true },
  { match: /HBO ?MAX/i, name: 'Max', category: CATEGORY.software, subscription: true },
  { match: /GLOBOPLAY/i, name: 'Globoplay', category: CATEGORY.software, subscription: true },
  { match: /PARAMOUNT ?(\+|PLUS)/i, name: 'Paramount+', category: CATEGORY.software, subscription: true },
  { match: /CRUNCHYROLL/i, name: 'Crunchyroll', category: CATEGORY.software, subscription: true },
  { match: /ICLOUD/i, name: 'iCloud+', category: CATEGORY.software, subscription: true },
  { match: /VERCEL/i, name: 'Vercel', category: CATEGORY.software, subscription: true },
  { match: /CLOUDFLARE/i, name: 'Cloudflare', category: CATEGORY.software, subscription: true },
  { match: /DIGITALOCEAN/i, name: 'DigitalOcean', category: CATEGORY.software, subscription: true },
  { match: /\bNOTION\b/i, name: 'Notion', category: CATEGORY.software, subscription: true },
  { match: /FIGMA/i, name: 'Figma', category: CATEGORY.software, subscription: true },
  { match: /CANVA\b/i, name: 'Canva', category: CATEGORY.software, subscription: true },
  { match: /DROPBOX/i, name: 'Dropbox', category: CATEGORY.software, subscription: true },
  { match: /ZOOM\.US|ZOOM VIDEO/i, name: 'Zoom', category: CATEGORY.software, subscription: true },
  { match: /LINKEDIN/i, name: 'LinkedIn', category: CATEGORY.software, subscription: true },
  { match: /^DISCORD\s*\*|DISCORD\.COM|DISCORD\W*NITRO/i, name: 'Discord', category: CATEGORY.software, subscription: true },
  { match: /^X CORP\b|TWITTER/i, name: 'X (Twitter)', category: CATEGORY.software, subscription: true },
  { match: /KASPERSKY/i, name: 'Kaspersky', category: CATEGORY.software, subscription: true },
  { match: /GODADDY/i, name: 'GoDaddy', category: CATEGORY.software },
  // App Store, iTunes e assinaturas da Apple saem com o mesmo descritor
  { match: /APPLE\.COM\/BILL|ITUNES\.COM/i, name: 'Apple', category: CATEGORY.software },
  { match: /TRADINGVIEW/i, name: 'TradingView', category: CATEGORY.software, subscription: true },
  { match: /GLASSNODE/i, name: 'Glassnode', category: CATEGORY.software, subscription: true },
  { match: /MESSARI/i, name: 'Messari', category: CATEGORY.software, subscription: true },

  // operadoras têm nome de palavra comum ("BAR AO VIVO", "TIM'S BURGER"): só os formatos de fatura delas
  { match: /^VIVO( EASY| LITE| FIBRA| CONTROLE| RECARGA|\s*\*|$)|TELEFONICA BRASIL/i, name: 'Vivo', category: CATEGORY.phone },
  { match: /^CLARO( S\.? ?A\.?| NET| TV| BRASIL| MOVIL|\s*\*|$)/i, name: 'Claro', category: CATEGORY.phone },
  { match: /^TIM( S\.? ?A\.?| CELULAR| BRASIL|\s*\*|$)/i, name: 'TIM', category: CATEGORY.phone },
  { match: /VERIZON/i, name: 'Verizon', category: CATEGORY.phone },
  { match: /\bAT ?& ?T\b|^ATT\s*\*/i, name: 'AT&T', category: CATEGORY.phone },
  { match: /\bT-?MOBILE/i, name: 'T-Mobile', category: CATEGORY.phone },
  { match: /XFINITY|COMCAST/i, name: 'Xfinity', category: CATEGORY.phone },
  { match: /^SPECTRUM\b|CHARTER COMM/i, name: 'Spectrum', category: CATEGORY.phone },
  { match: /VODAFONE/i, name: 'Vodafone', category: CATEGORY.phone },
  { match: /MOVISTAR/i, name: 'Movistar', category: CATEGORY.phone },
  { match: /DEUTSCHE TELEKOM|TELEKOM DEUTSCHLAND/i, name: 'Telekom', category: CATEGORY.phone },
  { match: /AIRALO/i, name: 'Airalo', category: CATEGORY.phone },
  { match: /HOLAFLY/i, name: 'Holafly', category: CATEGORY.phone },
  { match: /WI-?FI ONBOARD/i, name: { en: 'In-flight Wi-Fi', pt: 'Wi-Fi a bordo' }, category: CATEGORY.phone, brand: 'Wi-Fi' },

  { match: /AIRBNB/i, name: 'Airbnb', category: CATEGORY.travel },
  { match: /BOOKING\.COM/i, name: 'Booking.com', category: CATEGORY.travel },
  { match: /HOTELS\.COM/i, name: 'Hotels.com', category: CATEGORY.travel },
  { match: /EXPEDIA/i, name: 'Expedia', category: CATEGORY.travel },
  { match: /DECOLAR|DESPEGAR/i, name: 'Decolar', category: CATEGORY.travel },
  { match: /HOSTELWORLD/i, name: 'Hostelworld', category: CATEGORY.travel },
  { match: /MARRIOTT/i, name: 'Marriott', category: CATEGORY.travel },
  // "HILTON" sozinho é nome de gente no Brasil: só os formatos da rede
  { match: /HILTON (HOTELS?|GARDEN|HONORS)|HILTON\.COM|HAMPTON INN|DOUBLETREE/i, name: 'Hilton', category: CATEGORY.travel },
  { match: /\bHYATT\b/i, name: 'Hyatt', category: CATEGORY.travel },
  { match: /^LATAM\b/i, name: 'LATAM', category: CATEGORY.travel },
  { match: /GOL LINHAS|VOEGOL/i, name: 'GOL', category: CATEGORY.travel },
  { match: /AZUL LINHAS|VOEAZUL/i, name: 'Azul', category: CATEGORY.travel },
  { match: /AEROLINEAS ARG/i, name: 'Aerolíneas Argentinas', category: CATEGORY.travel },
  { match: /RYANAIR/i, name: 'Ryanair', category: CATEGORY.travel },
  { match: /EASYJET/i, name: 'easyJet', category: CATEGORY.travel },
  { match: /VUELING/i, name: 'Vueling', category: CATEGORY.travel },
  { match: /LUFTHANSA/i, name: 'Lufthansa', category: CATEGORY.travel },
  { match: /\bAIR ?FRANCE/i, name: 'Air France', category: CATEGORY.travel },
  { match: /^KLM\b|KLM ROYAL/i, name: 'KLM', category: CATEGORY.travel },
  { match: /BRITISH AIRW/i, name: 'British Airways', category: CATEGORY.travel },
  { match: /^IBERIA\b/i, name: 'Iberia', category: CATEGORY.travel },
  { match: /^TAP (AIR|PORTUGAL)/i, name: 'TAP', category: CATEGORY.travel },
  { match: /DELTA AIR/i, name: 'Delta', category: CATEGORY.travel },
  { match: /UNITED AIRLINES|UNITED\.COM/i, name: 'United', category: CATEGORY.travel },
  { match: /AMERICAN AIRLINES|^AA\.COM/i, name: 'American Airlines', category: CATEGORY.travel },
  { match: /SOUTHWEST AIR/i, name: 'Southwest', category: CATEGORY.travel },
  { match: /JETBLUE/i, name: 'JetBlue', category: CATEGORY.travel },
  // locadora de carro antes de "RENT" (aluguel de casa)
  { match: /\bHERTZ\b/i, name: 'Hertz', category: CATEGORY.travel },
  { match: /^AVIS\b|AVIS RENT/i, name: 'Avis', category: CATEGORY.travel },
  { match: /\bSIXT\b/i, name: 'Sixt', category: CATEGORY.travel },
  { match: /LOCALIZA/i, name: 'Localiza', category: CATEGORY.travel },

  { match: /DROGASIL/i, name: 'Drogasil', category: CATEGORY.health },
  { match: /DROGA ?RAIA/i, name: 'Droga Raia', category: CATEGORY.health },
  { match: /PAGUE ?MENOS/i, name: 'Pague Menos', category: CATEGORY.health },
  { match: /PANVEL/i, name: 'Panvel', category: CATEGORY.health },
  { match: /SMART ?FIT/i, name: 'Smart Fit', category: CATEGORY.health, subscription: true },
  { match: /GYMPASS|WELLHUB/i, name: 'Wellhub', category: CATEGORY.health, subscription: true },
  { match: /\bEQUINOX\b/i, name: 'Equinox', category: CATEGORY.health, subscription: true },
  { match: /\bCVS\b/i, name: 'CVS', category: CATEGORY.health },
  { match: /WALGREENS/i, name: 'Walgreens', category: CATEGORY.health },
  { match: /RITE ?AID/i, name: 'Rite Aid', category: CATEGORY.health },
  { match: /^BOOTS\b/i, name: 'Boots', category: CATEGORY.health },
  { match: /^DM(-| )?DROGERIE|^DM FIL/i, name: 'dm', category: CATEGORY.health },
  { match: /ROSSMANN/i, name: 'Rossmann', category: CATEGORY.health },

  // ancorado: "POSTO ATACADAO" é o posto de combustível da rede
  { match: /^ATACADAO\b/i, name: 'Atacadão', category: CATEGORY.groceries },
  { match: /ASSAI ATACAD/i, name: 'Assaí Atacadista', category: CATEGORY.groceries },
  { match: /CARREFOUR/i, name: 'Carrefour', category: CATEGORY.groceries },
  // ancorado: "BONDINHO PAO DE ACUCAR" é o passeio
  { match: /^PAO DE ACUCAR\b/i, name: 'Pão de Açúcar', category: CATEGORY.groceries },
  { match: /WAL-?MART|^WM SUPERCENTER/i, name: 'Walmart', category: CATEGORY.groceries },
  { match: /WHOLE ?FOODS|WHOLEFDS|^WFM\b/i, name: 'Whole Foods', category: CATEGORY.groceries },
  { match: /TRADER JOE/i, name: "Trader Joe's", category: CATEGORY.groceries },
  { match: /COSTCO/i, name: 'Costco', category: CATEGORY.groceries },
  { match: /KROGER/i, name: 'Kroger', category: CATEGORY.groceries },
  { match: /SAFEWAY/i, name: 'Safeway', category: CATEGORY.groceries },
  { match: /PUBLIX/i, name: 'Publix', category: CATEGORY.groceries },
  { match: /\bH-?E-?B\b/i, name: 'H-E-B', category: CATEGORY.groceries },
  { match: /SPROUTS FARMERS/i, name: 'Sprouts', category: CATEGORY.groceries },
  { match: /\bALDI\b/i, name: 'Aldi', category: CATEGORY.groceries },
  { match: /\bLIDL\b/i, name: 'Lidl', category: CATEGORY.groceries },
  { match: /\bREWE\b/i, name: 'REWE', category: CATEGORY.groceries },
  { match: /\bEDEKA\b/i, name: 'EDEKA', category: CATEGORY.groceries },
  { match: /KAUFLAND/i, name: 'Kaufland', category: CATEGORY.groceries },
  { match: /^NETTO (MARKEN|SAGT|FIL)|NETTO MARKEN-DISCOUNT/i, name: 'Netto', category: CATEGORY.groceries },
  { match: /TESCO/i, name: 'Tesco', category: CATEGORY.groceries },
  { match: /SAINSBURY/i, name: "Sainsbury's", category: CATEGORY.groceries },
  { match: /^ASDA\b/i, name: 'Asda', category: CATEGORY.groceries },
  { match: /WAITROSE/i, name: 'Waitrose', category: CATEGORY.groceries },
  { match: /MERCADONA/i, name: 'Mercadona', category: CATEGORY.groceries },
  { match: /AUCHAN/i, name: 'Auchan', category: CATEGORY.groceries },
  { match: /LECLERC/i, name: 'E.Leclerc', category: CATEGORY.groceries },
  { match: /INTERMARCHE/i, name: 'Intermarché', category: CATEGORY.groceries },
  { match: /MONOPRIX/i, name: 'Monoprix', category: CATEGORY.groceries },
  { match: /ALBERT HEIJN/i, name: 'Albert Heijn', category: CATEGORY.groceries },
  { match: /PINGO DOCE/i, name: 'Pingo Doce', category: CATEGORY.groceries },
  { match: /ESSELUNGA/i, name: 'Esselunga', category: CATEGORY.groceries },
  { match: /^MIGROS\b/i, name: 'Migros', category: CATEGORY.groceries },
  { match: /^SPAR\b/i, name: 'Spar', category: CATEGORY.groceries },

  { match: /AMAZON ?BR|AMAZONMKTPLC|^AMAZON\b|^AMZN\b|AMAZON\.COM/i, name: 'Amazon', category: CATEGORY.shopping },
  { match: /MERCADO ?LIVRE|MERCADOLIVRE/i, name: 'Mercado Livre', category: CATEGORY.shopping },
  { match: /SHOPEE/i, name: 'Shopee', category: CATEGORY.shopping },
  { match: /ALIEXPRESS/i, name: 'AliExpress', category: CATEGORY.shopping },
  { match: /\bSHEIN\b/i, name: 'Shein', category: CATEGORY.shopping },
  { match: /\bTEMU\b/i, name: 'Temu', category: CATEGORY.shopping },
  { match: /MAGALU|MAGAZINE ?LUIZA/i, name: 'Magalu', category: CATEGORY.shopping },
  { match: /AMERICANAS/i, name: 'Americanas', category: CATEGORY.shopping },
  { match: /CASAS BAHIA/i, name: 'Casas Bahia', category: CATEGORY.shopping },
  { match: /NETSHOES/i, name: 'Netshoes', category: CATEGORY.shopping },
  { match: /^CENTAURO(\.COM|$)|SBF CENTAURO/i, name: 'Centauro', category: CATEGORY.shopping },
  { match: /DECATHLON/i, name: 'Decathlon', category: CATEGORY.shopping },
  { match: /LOJAS RENNER|^RENNER\b/i, name: 'Renner', category: CATEGORY.shopping },
  { match: /^RIACHUELO\b|LOJAS RIACHUELO/i, name: 'Riachuelo', category: CATEGORY.shopping },
  { match: /^ZARA\b/i, name: 'Zara', category: CATEGORY.shopping },
  { match: /TOMMY HILFIGER/i, name: 'Tommy Hilfiger', category: CATEGORY.shopping },
  { match: /BOTICARIO/i, name: 'O Boticário', category: CATEGORY.shopping },
  { match: /SEPHORA/i, name: 'Sephora', category: CATEGORY.shopping },
  { match: /\bGRANADO\b/i, name: 'Granado', category: CATEGORY.shopping },
  { match: /PETLOVE|PET LOVE ?\*/i, name: 'Petlove', category: CATEGORY.shopping },
  { match: /^PETZ\b/i, name: 'Petz', category: CATEGORY.shopping },
  { match: /COBASI/i, name: 'Cobasi', category: CATEGORY.shopping },
  { match: /CACAU SHOW/i, name: 'Cacau Show', category: CATEGORY.shopping },
  { match: /LINDT/i, name: 'Lindt', category: CATEGORY.shopping },
  { match: /^TARGET\b|TARGET\.COM/i, name: 'Target', category: CATEGORY.shopping },
  { match: /BEST ?BUY/i, name: 'Best Buy', category: CATEGORY.shopping },
  { match: /\bEBAY\b/i, name: 'eBay', category: CATEGORY.shopping },
  { match: /\bETSY\b/i, name: 'Etsy', category: CATEGORY.shopping },
  { match: /ZALANDO/i, name: 'Zalando', category: CATEGORY.shopping },
  { match: /PRIMARK/i, name: 'Primark', category: CATEGORY.shopping },
  { match: /\bH ?& ?M\b/i, name: 'H&M', category: CATEGORY.shopping },
  { match: /UNIQLO/i, name: 'Uniqlo', category: CATEGORY.shopping },
  { match: /MEDIA ?MARKT/i, name: 'MediaMarkt', category: CATEGORY.shopping },
  { match: /CORTE INGLES/i, name: 'El Corte Inglés', category: CATEGORY.shopping },
  { match: /^FNAC\b/i, name: 'Fnac', category: CATEGORY.shopping },
  { match: /TJ ?MAXX/i, name: 'TJ Maxx', category: CATEGORY.shopping },
  { match: /LEROY ?MERLIN/i, name: 'Leroy Merlin', category: CATEGORY.home },
  { match: /TOK ?& ?STOK|TOKSTOK/i, name: 'Tok&Stok', category: CATEGORY.home },
  { match: /\bIKEA\b/i, name: 'IKEA', category: CATEGORY.home },
  { match: /HOME ?DEPOT/i, name: 'The Home Depot', category: CATEGORY.home },
  { match: /\bLOWE'?S\b/i, name: "Lowe's", category: CATEGORY.home },

  { match: /CINEMARK/i, name: 'Cinemark', category: CATEGORY.leisure },
  { match: /CINEPOLIS/i, name: 'Cinépolis', category: CATEGORY.leisure },
  { match: /INGRESSO\.?COM/i, name: 'Ingresso.com', category: CATEGORY.leisure },
  { match: /SYMPLA/i, name: 'Sympla', category: CATEGORY.leisure },
  { match: /EVENTIM/i, name: 'Eventim', category: CATEGORY.leisure },
  { match: /TICKETMASTER/i, name: 'Ticketmaster', category: CATEGORY.leisure },
  { match: /STEAM ?(GAMES|POWERED|PURCHASE)|STEAMGAMES/i, name: 'Steam', category: CATEGORY.leisure },
  { match: /PLAYSTATION/i, name: 'PlayStation', category: CATEGORY.leisure },
  { match: /NINTENDO/i, name: 'Nintendo', category: CATEGORY.leisure },

  { match: /STARBUCKS/i, name: 'Starbucks', category: CATEGORY.dining },
  { match: /MC ?DONALD/i, name: "McDonald's", category: CATEGORY.dining },
  { match: /BURGER ?KING/i, name: 'Burger King', category: CATEGORY.dining },
  { match: /^SUBWAY\b/i, name: 'Subway', category: CATEGORY.dining },
  { match: /^OUTBACK\b/i, name: 'Outback Steakhouse', category: CATEGORY.dining },
  { match: /^MADERO (INDUSTRIA|CONTAINER|STEAK)/i, name: 'Madero', category: CATEGORY.dining },
  { match: /COCO BAMBU/i, name: 'Coco Bambu', category: CATEGORY.dining },
  { match: /HABIB'?S/i, name: "Habib's", category: CATEGORY.dining },
  { match: /TIM HORTON/i, name: 'Tim Hortons', category: CATEGORY.dining },
  { match: /CHIPOTLE/i, name: 'Chipotle', category: CATEGORY.dining },
  { match: /DUNKIN/i, name: "Dunkin'", category: CATEGORY.dining },
  { match: /TACO BELL/i, name: 'Taco Bell', category: CATEGORY.dining },
  { match: /WENDY'?S\b/i, name: "Wendy's", category: CATEGORY.dining },
  { match: /\bKFC\b/i, name: 'KFC', category: CATEGORY.dining },
  { match: /DOMINO'?S/i, name: "Domino's", category: CATEGORY.dining },
  { match: /PIZZA HUT/i, name: 'Pizza Hut', category: CATEGORY.dining },
  { match: /CHICK-?FIL-?A/i, name: 'Chick-fil-A', category: CATEGORY.dining },
  { match: /PANERA/i, name: 'Panera Bread', category: CATEGORY.dining },
  { match: /FIVE GUYS/i, name: 'Five Guys', category: CATEGORY.dining },
  { match: /SWEETGREEN/i, name: 'Sweetgreen', category: CATEGORY.dining },
  { match: /BLUE BOTTLE/i, name: 'Blue Bottle', category: CATEGORY.dining },
  { match: /PRET A MANGER/i, name: 'Pret A Manger', category: CATEGORY.dining },
  { match: /COSTA COFFEE/i, name: 'Costa Coffee', category: CATEGORY.dining },
  // Toast, sistema de caixa de restaurante nos EUA: "TST* NOME DO LUGAR"
  { match: /^TST\s*\*/i, category: CATEGORY.dining },

  { match: /DUOLINGO/i, name: 'Duolingo', category: CATEGORY.education, subscription: true },
  { match: /\bALURA\b/i, name: 'Alura', category: CATEGORY.education, subscription: true },
  { match: /UDEMY/i, name: 'Udemy', category: CATEGORY.education },
  { match: /COURSERA/i, name: 'Coursera', category: CATEGORY.education },
];

/**
 * Regras de quem usa o painel, num arquivo local fora do git (fixtures/live/merchant-rules.json): o restaurante do
 * bairro, um serviço pequeno. Vêm antes das públicas. `match` é uma expressão regular sobre o descritor da fatura, sem
 * diferenciar maiúsculas; sem `category`, vale a da fonte ou o ramo escrito no descritor.
 */
export interface LocalMerchantRule {
  match: string;
  name: LocalizedText;
  category?: string;
  brand?: string;
  subscription?: boolean;
}

export interface MerchantRulesFile {
  rules?: LocalMerchantRule[];
  /** Palavras que a fatura escreve sem acento, em minúsculas: { "ipe": "ipê" } */
  accents?: Record<string, string>;
}

const CATEGORY_IDS = new Set<string>(Object.values(CATEGORY));
// texto do arquivo local: sem controles nem marcas de direção (cleanText.ts) e com teto
const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = cleanText(v).trim();
  return s && s.length <= max ? s : undefined;
};

/**
 * Regra local válida, ou null: arquivo escrito à mão (ou por uma IA) não pode derrubar o painel. A regex só entra se
 * for do subconjunto seguro (safeRegex.ts): "^(.*.*)*" num arquivo "de exemplo" travaria a aba a cada abertura.
 */
function localRuleEntry(v: unknown): LocalMerchantRule | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const source = text(r.match, MAX_RULE_LENGTH);
  if (!source || !isSafePattern(source)) return null;
  const pair = r.name && typeof r.name === 'object' ? (r.name as Record<string, unknown>) : null;
  const en = pair ? text(pair.en, 80) : undefined;
  const pt = pair ? text(pair.pt, 80) : undefined;
  const name: LocalizedText | undefined = text(r.name, 80) ?? (en && pt ? { en, pt } : undefined);
  const category = r.category === undefined ? undefined : text(r.category, 40);
  if (!source || !name || (r.category !== undefined && !(category && CATEGORY_IDS.has(category)))) return null;
  if ((r.brand !== undefined && !text(r.brand, 80)) || (r.subscription !== undefined && typeof r.subscription !== 'boolean')) return null;
  return {
    match: source,
    name,
    ...(category ? { category } : {}),
    ...(r.brand !== undefined ? { brand: text(r.brand, 80) } : {}),
    ...(r.subscription === true ? { subscription: true } : {}),
  };
}

function compileLocalRule(entry: LocalMerchantRule): Rule | null {
  try {
    return {
      match: new RegExp(entry.match, 'i'),
      name: entry.name,
      category: entry.category,
      brand: entry.brand,
      subscription: entry.subscription === true,
    };
  } catch {
    return null;
  }
}

/** Teto do arquivo local: acima disso o custo por transação (uma regra após a outra) trava a aba. */
export const MAX_LOCAL_RULES = 200;
/** Teto das palavras de acento ("ipe" → "ipê"), que também rodam em toda transação. */
export const MAX_LOCAL_ACCENTS = 500;

/**
 * O merchant-rules.json como o painel aceita: cada regra conferida e compilada, lista e acentos com teto. `invalid`
 * quando o arquivo não tem a forma esperada; `dropped` conta o que saiu (inválido ou acima do teto).
 */
export function sanitizeMerchantRules(file: unknown): { value?: MerchantRulesFile; dropped: number; invalid: boolean } {
  if (file === undefined || file === null) return { dropped: 0, invalid: false };
  const body = file && typeof file === 'object' ? (file as Record<string, unknown>) : {};
  const list = Array.isArray(file) ? file : Array.isArray(body.rules) ? body.rules : null;
  if (!list) return { dropped: 0, invalid: true };
  const rules: LocalMerchantRule[] = [];
  const kept = list.slice(0, MAX_LOCAL_RULES);
  for (const v of kept) {
    const entry = localRuleEntry(v);
    if (entry && compileLocalRule(entry)) rules.push(entry);
  }
  const accents: Record<string, string> = {};
  if (body.accents && typeof body.accents === 'object' && !Array.isArray(body.accents)) {
    for (const [word, fixed] of Object.entries(body.accents as Record<string, unknown>).slice(0, MAX_LOCAL_ACCENTS)) {
      const value = text(fixed, 40);
      if (/^[a-z]{2,30}$/.test(word) && value) accents[word] = value.toLowerCase();
    }
  }
  return {
    value: Object.keys(rules).length || Object.keys(accents).length
      ? { ...(rules.length ? { rules } : {}), ...(Object.keys(accents).length ? { accents } : {}) }
      : {},
    dropped: list.length - rules.length,
    invalid: false,
  };
}

let localFile: unknown;
let activeRules: Rule[] = RULES;
const localAccents = new Map<string, string>();

/**
 * Liga as regras locais (o arquivo como veio, já lido do JSON) e devolve quantas valeram. Sem arquivo, volta só às
 * públicas. O enrichDataset chama a cada passada; o mesmo arquivo não é lido de novo.
 */
export function setLocalMerchantRules(file: unknown): { rules: number; accents: number; skipped: number } {
  const body = file && typeof file === 'object' ? (file as Record<string, unknown>) : {};
  const list: unknown[] = (Array.isArray(file) ? file : Array.isArray(body.rules) ? body.rules : []).slice(0, MAX_LOCAL_RULES);
  if (file !== localFile) {
    localFile = file;
    const compiled = list
      .map(localRuleEntry)
      .filter((r): r is LocalMerchantRule => r !== null)
      .map(compileLocalRule)
      .filter((r): r is Rule => r !== null);
    activeRules = compiled.length ? [...compiled, ...RULES] : RULES;
    localAccents.clear();
    const accents = body.accents && typeof body.accents === 'object' && !Array.isArray(body.accents)
      ? Object.entries(body.accents as Record<string, unknown>).slice(0, MAX_LOCAL_ACCENTS)
      : [];
    for (const [word, fixed] of accents) {
      const value = text(fixed, 40);
      if (/^[a-z]{2,30}$/.test(word) && value) localAccents.set(word, value.toLowerCase());
    }
  }
  const rules = activeRules.length - RULES.length;
  return { rules, accents: localAccents.size, skipped: list.length - rules };
}

// Lojas que o iFood entrega: só essas regras dão nome ao pedido IFD* (um "IFD*VIVO BURGER" não é a operadora)
const DELIVERABLE = new Set<string>([CATEGORY.delivery, CATEGORY.dining, CATEGORY.groceries, CATEGORY.health, CATEGORY.shopping, CATEGORY.home]);

// Quando a fonte não traz categoria e nenhuma regra conhece a loja, o ramo escrito no descritor decide.
// Português, inglês, espanhol, alemão e francês; a primeira linha que casa vence ("RENT A CAR" é viagem antes de
// "RENT" ser aluguel, "COFFEE SHOP" é café antes de "SHOP" ser loja)
const TYPE_WORDS: [RegExp, string][] = [
  [/\b(HOTEL|HOTEIS|HOSTEL|HOSTAL|MOTEL|POUSADA|HOSPEDAGEM|RESORT|ALBERGO|TRAVEL\W*INSURANCE|SEGUROS? (DE )?VIAGEM|AIRLINES?|AIRWAYS|RENT ?A ?CAR|CAR RENTAL|AUTOVERMIETUNG)\b/i, CATEGORY.travel],
  [/\b(FARMACIAS?|DROGARIA|DROGUERIA|PHARMACY|PHARMACIE|APOTHEKE|DRUGSTORE|CHEMIST|CLINICA|CLINIC|KLINIK|HOSPITAL|LABORATORIO|ODONTO\w*|ORTODONT\w*|DENTAL|DENTIST|ZAHNARZT|OTICA|OPTICA|OPTICIAN|OPTIK|FISIOTERAPIA|GYM|FITNESS)\b|FARMA\b/i, CATEGORY.health],
  [/\b(SUPERMERC\w*|SUPERMARKET|SUPERMARCHE|HIPERMERCADO|MINIMERCADO|MERCEARIA|HORTIFRUTI|SACOLAO|ATACADISTA|CONVENIENCIAS?|CONVENIENCE|ACOUGUE|GROCERY|GROCERIES|GROCER|MARKET|MINI ?MARKET|MARKT|LEBENSMITTEL|EPICERIE|ALIMENTACION|BUTCHER|METZGEREI|CARNICERIA|FRUTERIA)\b|\bMERCADO\b(?! ?(PAGO|PAG|LIVRE))/i, CATEGORY.groceries],
  [/\b(RESTAUR\w*|RISTORANT\w*|PIZZA|PIZZARIA|PIZZERIA|CHURRASCARIA|LANCHONETE|LANCHES|PADARIA|PANIFICADORA|CONFEITARIA|DOCERIA|SORVETERIA|GELATERIA|ACAI|ACAITERIA|CAFE|CAFETERIA|COFFEE|BISTRO|SUSHI|TEMAKERIA|BURGER|HAMBURGUERIA|STEAKHOUSE|PARRILLA|CERVEJARIA|BOTECO|BAR|PUB|TRATTORIA|OSTERIA|BRASSERIE|BAKERY|DELICATESSEN|TAQUERIA|GRILL|KITCHEN|DINER|EATERY|TAVERN|TAVERNA|TABERNA|CANTINA|TAPAS|CERVECERIA|PANADERIA|BIERGARTEN|GASTST(A|AE)TTE|IMBISS|B(A|AE)CKEREI|KONDITOREI|BOULANGERIE|PATISSERIE|CREPERIE|RAMEN|NOODLES?|KEBAB|DONER|BBQ)\b/i, CATEGORY.dining],
  [/\b(AUTO ?POSTO|POSTO|COMBUSTIVE\w*|ESTACIONAMENTO|PARKING|PEDAGIO|TAXI|FUEL|PETROL|GASOLINERA|TANKSTELLE|PARKHAUS|PARKPLATZ|APARCAMIENTO|TOLLS?|TRANSIT|RAILWAYS?)\b|(?<!DISK )\bGAS\b(?! ?E ?AGUA| DE COZINHA)/i, CATEGORY.transport],
  [/\b(CINEMAS?|KINO|TEATRO|THEATRE|THEATER|MUSEU|MUSEO|MUSEUM|MUSEE|INGRESSOS?|TICKETS?|CONCERTS?|ZOO|BOWLING)\b/i, CATEGORY.leisure],
  [/\b(ESCOLA|COLEGIO|FACULDADE|UNIVERSIDADE|CURSOS?|IDIOMAS|SCHOOL|UNIVERSITY|COLLEGE|TUITION|UNIVERSIDAD|ESCUELA|SCHULE)\b/i, CATEGORY.education],
  [/\b(WIRELESS|TELECOM\w*|BROADBAND|MOBILFUNK)\b/i, CATEGORY.phone],
  // aluguel pago no cartão (comum nos EUA) é da casa
  [/\b(MOVEIS|DECORACAO|CONSTRUCAO|HOME CENTER|MADEIREIRA|HARDWARE|FURNITURE|HOME IMPROVEMENT|BAUMARKT|M(O|OE)BEL|FERRETERIA|MUEBLES|GARTENCENTER|GARDEN CENTER|RENT|MIETE)\b/i, CATEGORY.home],
  [/\b(LOJAS?|LOJINHA|MAGAZINE|COSMETICOS|PERFUMARIA|PAPELARIA|CALCADOS|MODAS?|CONFECCOES|BOUTIQUE|PET ?SHOP|ELETRONICOS|INFORMATICA|BRINQUEDOS|STORES?|SHOP|OUTLET|DEPARTMENT STORE|ELECTRONICS|BOOKSTORE|BOOKS|BUCHHANDLUNG|LIBRERIA|TIENDA|ZAPATERIA|JUGUETERIA|PAPELERIA|KAUFHAUS)\b/i, CATEGORY.shopping],
];

const SMALL_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'na', 'no', 'nas', 'nos', 'ao', 'com', 'del', 'di', 'y', 'of', 'the', 'and']);
// Acentos que a fatura perde, só onde não há ambiguidade com o espanhol; "-cao" e "-coes" viram "-ção" e "-ções".
// Só vocabulário comum: nome de lugar vai nas regras locais (accents em merchant-rules.json)
const ACCENTS: Record<string, string> = {
  sao: 'são', joao: 'joão', pao: 'pão', paes: 'pães', cafe: 'café', acai: 'açaí', acaiteria: 'açaiteria',
  gestao: 'gestão', comercio: 'comércio', industria: 'indústria', servicos: 'serviços',
  logistica: 'logística', clinica: 'clínica', cosmeticos: 'cosméticos', acougue: 'açougue',
  praca: 'praça', saude: 'saúde', otica: 'ótica', eletronicos: 'eletrônicos', espaco: 'espaço', medico: 'médico',
};
// Siglas sem vogal ficam em caixa alta ("MJG", "HFM"); abreviações de tratamento não
const NOT_ACRONYM = new Set(['dr', 'sr', 'mr', 'mrs', 'st', 'jr']);

function titleWord(w: string, i: number): string {
  if (i > 0 && SMALL_WORDS.has(w)) return w;
  if (/\d/.test(w) && /[a-z]/.test(w) && /^[a-z\d]+$/.test(w)) return w.toUpperCase();
  if (/^[a-z]{2,4}$/.test(w) && !/[aeiouy]/.test(w) && !NOT_ACRONYM.has(w)) return w.toUpperCase();
  // hasOwn: "constructor" num descritor não pode achar a função do protótipo
  const fixed = localAccents.get(w) ?? (Object.hasOwn(ACCENTS, w) ? ACCENTS[w] : (w.length >= 6 ? w.replace(/cao$/, 'ção') : w).replace(/coes$/, 'ções'));
  return (fixed.charAt(0).toUpperCase() + fixed.slice(1)).replace(/([-/])(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

function titleCase(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  // só reescreve texto em CAIXA ALTA; nomes já em caixa mista e siglas soltas (SBB, IKEA) ficam como vieram
  if (!letters.length || upper / letters.length < 0.7 || (!s.includes(' ') && s.length <= 4)) return s;
  return s.toLowerCase().split(' ').map(titleWord).join(' ');
}

// Adquirentes e subadquirentes antes do nome: "PG *LOJA", "EBN*SERVICO", "MERCADOPAGO*LOJA", "PAYU*AR*CORRIDA"
const PROCESSOR = /^(?:MERCADO ?PAGO|MERPAGO|MERCPAGO|PAYPAL|PAGSEGURO|PAGSEG|PICPAY|STRIPE|IZETTLE|PAYU ?\* ?[A-Z]{2}|[A-Z0-9]{2,5}) ?\* ?/i;
// Daqui em diante a razão social só descreve o ramo: "ALDEIA COMERCIO DE BI" → "ALDEIA"
const LINE_OF_BUSINESS = /^(COMERCIO|COMERC\w*|IND|INDUSTRIA\w*|DISTRIBUI\w*|EMPREEN\w*|PRODUTOS|PARTICIPACOES)$/i;
// Sufixos societários do Brasil, Argentina, Europa e EUA, e conectivos que sobram no fim
const TAIL = /^(LTDA|LTD|ME|EPP|MEI|EIRELI|S\/?A|S\.A\.?|SAS|SRL|S\.R\.L\.?|SL|S\.L\.?|SLU|GMBH|BV|NV|LDA|LIMITED|INC\.?|LLC|LLP|CORP\.?|CORPORATION|CO\.?|PLC|PTY|COM|DE|DA|DO|DAS|DOS|E|EM|Y|DEL|DI|[-–&/,.])$/i;
// Palavra cortada no limite de tamanho da fatura: "BOA MESA GRILL RESTA" → "RESTAURANTE"
const TRUNCATED = ['RESTAURANTE', 'PIZZARIA', 'LANCHONETE', 'CHURRASCARIA', 'CONFEITARIA', 'ALIMENTOS'];
const WHOLE_WORDS = new Set(['RESTAURANT', 'PIZZA', 'LANCHE', 'ALIMENTO']);

/** "EBN*SERVICO" → "SERVICO"; "IFD*12345678 FULANO" → "FULANO"; "FARMACIA EXEMPLO 0001" → "FARMACIA EXEMPLO" */
function cleanDescriptor(raw: string): string {
  let s = raw.replace(PROCESSOR, '');
  // "LOJA*PRODUTO" ou "LOJA*PEDIDO123": a loja é o que vem antes do asterisco
  const star = s.indexOf('*');
  if (star > 0 && s.slice(0, star).replace(/[^A-Za-z]/g, '').length >= 3) s = s.slice(0, star);
  s = s
    .replace(/\b\d{2}\.\d{3}\.\d{3}(\/\d{4}-?\d{2})?\b/g, ' ') // CNPJ de MEI no lugar do nome
    .replace(/[-\s]+(LJ|LOJA|FL|FILIAL)\s?[A-Z]?\d+\b/gi, ' ') // código de loja: "-LJ0001", "FL 001"
    .replace(/\.(COM|NET|ORG|IO|AI|APP|TECH|DEV)(\.[A-Z]{2})?(\/\S*)?\b/gi, ' ')
    .replace(/#\s*\d*/g, ' ')
    .replace(/\b(LTDA|EIRELI|AGENCIA DE R)\b\.?/gi, ' ')
    .replace(/\b\d{5,}\b/g, ' ');

  let words = s.split(/\s+/).filter(Boolean);
  const cut = words.findIndex((w, i) => i > 0 && (LINE_OF_BUSINESS.test(w) || (/^COM$/i.test(w) && /^(DE|E)$/i.test(words[i + 1] ?? ''))));
  if (cut > 0 && words.slice(0, cut).join('').replace(/[^A-Za-z]/g, '').length >= 2) words = words.slice(0, cut);

  // descritor longo foi cortado pela bandeira: letra solta no fim é resto de palavra
  const truncated = raw.length >= 20;
  while (words.length > 1) {
    const last = words.at(-1)!;
    if (TAIL.test(last) || (truncated && /^[A-Z]$/i.test(last)) || /^[A-Z]{0,3}\d{2,}$/i.test(last)) words.pop();
    else break;
  }
  const last = words.at(-1)?.toUpperCase() ?? '';
  const full = truncated && words.length > 1 && last.length >= 4 && !WHOLE_WORDS.has(last) ? TRUNCATED.find((w) => w !== last && w.startsWith(last)) : undefined;
  if (full) words[words.length - 1] = /[a-z]/.test(words.at(-1)!) ? full.toLowerCase() : full;
  return words.join(' ').trim();
}

export interface MerchantInfo {
  name: string;
  /** Marca ou plataforma para agrupar o histórico: todo pedido IFD* é "iFood", Uber Eats é "Uber" */
  brand: string;
  category: string;
  subscription: boolean;
}

export function describeMerchant(raw: string | undefined, rawCategory: string | undefined, locale: Locale = 'en'): MerchantInfo {
  const rawKey = rawCategory?.trim().toLowerCase();
  const base = rawKey && Object.hasOwn(RAW_CATEGORY, rawKey) ? RAW_CATEGORY[rawKey] : undefined;
  if (!raw) return { name: '', brand: '', category: base ?? CATEGORY.other, subscription: false };

  // IFD* é pedido feito pelo iFood: o restaurante vem depois do asterisco
  if (/^IFD ?\*/i.test(raw)) {
    const rest = raw.replace(/^IFD ?\* ?/i, '');
    const known = activeRules.find((r) => r.name && r.category && DELIVERABLE.has(r.category) && r.match.test(rest));
    const place = localized(known?.name, locale) ?? (titleCase(cleanDescriptor(raw)) || pick(locale, 'Order', 'Pedido'));
    return { name: place === 'iFood' ? place : `${place} · via iFood`, brand: 'iFood', category: !base || base === CATEGORY.dining ? CATEGORY.delivery : base, subscription: false };
  }

  const typed = () => (base ? undefined : TYPE_WORDS.find(([re]) => re.test(raw))?.[1]);
  const rule = activeRules.find((r) => r.match.test(raw));
  if (rule) {
    // regra só de categoria (posto de rede de mercado, caixa de restaurante): o nome sai do descritor
    const name = localized(rule.name, locale) ?? (titleCase(cleanDescriptor(raw)) || raw);
    return { name, brand: rule.brand ?? name, category: rule.category ?? base ?? typed() ?? CATEGORY.other, subscription: Boolean(rule.subscription) };
  }

  const name = titleCase(cleanDescriptor(raw)) || raw;
  return { name, brand: name, category: base ?? typed() ?? CATEGORY.other, subscription: false };
}
