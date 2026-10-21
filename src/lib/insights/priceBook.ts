// Preços de tabela públicos de serviços por assinatura, para comparar canal (direto × loja de apps), prazo (anual ×
// mensal) e plano (individual × família). Só entra o que foi conferido na página oficial do serviço ou da loja, com o
// link e o dia. A lista segue serviços comuns, não a fatura de ninguém; nada de link de afiliado, cupom ou indicação.
// Preço muda (reajuste, promoção, país de quem abre a página): passou de PRICE_STALE_DAYS, a tela diz "pode ter
// mudado" e o preço sai das contas. Para ligar à assinatura detectada: service = subscriptionKey(record.name).

import type { LocalizedText } from '../locale';
import type { InsightSource } from './types';

export type Country = 'BR' | 'US';
export type PriceCurrency = 'BRL' | 'USD';
/** 'direct': cobrado pelo próprio serviço (site ou app dele); 'app_store': compra dentro do app, cobrada pela Apple */
export type PriceChannel = 'direct' | 'app_store';

export interface PriceSource extends InsightSource {
  /** 'official': página do serviço ou da loja; 'press': imprensa, com o dia do texto em `published` */
  level: 'official' | 'press';
  published?: string;
}

/** Preço de um prazo maior que um mês */
export interface TermPrice {
  months: 3 | 6 | 12;
  /** Total do prazo */
  total: number;
  /**
   * 'upfront': à vista; 'installments': o total em parcelas mensais (as regras de cancelamento variam: ANNUAL_TRAPS);
   * 'prepaid': pago adiantado e sem renovação automática (no fim, a assinatura para sozinha)
   */
  billing: 'upfront' | 'installments' | 'prepaid';
}

export interface PriceEntry {
  /** serviço/plano/país/canal: único na base */
  id: string;
  /** subscriptionKey do nome do registro de assinatura: "Claude (Anthropic)" → "claude-anthropic" */
  service: string;
  serviceName: string;
  /** Id estável do plano dentro do serviço */
  plan: string;
  planName: LocalizedText;
  /** Contas próprias que o plano prevê (duo, família), só quando a fonte diz; sem o campo, não se sabe ou não vale */
  seats?: number;
  country: Country;
  currency: PriceCurrency;
  channel: PriceChannel;
  /** Mensal sem fidelidade; sem o campo, a página não oferece */
  monthly?: number;
  terms?: TermPrice[];
  /** A fonte diz que não existe plano anual */
  noAnnual?: true;
  /** Regra do plano que a tela mostra junto ("mesmo endereço", "sem impostos") */
  note?: LocalizedText;
  /** Fonte da regra (contas, endereço) quando não é a mesma página do preço */
  ruleSource?: PriceSource;
  source: PriceSource;
}

/** Reajuste anunciado: separa o aumento esperado do aumento sem explicação (JustRenewed.priceChanged) */
export interface PriceChange {
  service: string;
  plan: string;
  country: Country;
  currency: PriceCurrency;
  from: number;
  to: number;
  /** AAAA-MM-DD do anúncio; quem já assina pode ver o novo preço só na cobrança seguinte */
  announced: string;
  source: PriceSource;
}

/** Preço conferido há mais tempo que isto aparece como "pode ter mudado" e sai das contas de economia */
export const PRICE_STALE_DAYS = 90;

const CHECKED = '2026-10-19';
const official = (label: string, url: string, checked = CHECKED): PriceSource => ({ label, url, checked, level: 'official' });

const SPOTIFY_BR = official('Spotify · Premium (BR)', 'https://www.spotify.com/br-pt/premium/');
const DEEZER_BR = official('Deezer · Planos (BR)', 'https://www.deezer.com/br/offers');
const NETFLIX_BR = official('Netflix · Planos e preços (BR)', 'https://help.netflix.com/pt/node/24926');
const DISNEY_BR = official('Disney+ (BR)', 'https://www.disneyplus.com/pt-br');
const HBOMAX_BR = official('HBO Max (BR)', 'https://www.hbomax.com/br/pt');
const M365_BR = official('Microsoft 365 · Comparar planos (BR)', 'https://www.microsoft.com/pt-br/microsoft-365/buy/compare-all-microsoft-365-products');
const CLAUDE_WEB = official('Claude · Pricing', 'https://claude.com/pricing');
const CLAUDE_IOS_BR = official('App Store (BR) · Claude', 'https://apps.apple.com/br/app/claude-by-anthropic/id6473753684');
const CLAUDE_IOS_US = official('App Store (US) · Claude', 'https://apps.apple.com/us/app/claude-by-anthropic/id6473753684');
const YOUTUBE_IOS_BR = official('App Store (BR) · YouTube', 'https://apps.apple.com/br/app/youtube/id544007664');
const GOOGLE_ONE_BR = official('Google One · Planos', 'https://one.google.com/about/plans');
const APPLE_ONE_BR = official('Apple One (BR)', 'https://www.apple.com/br/apple-one/');
// a página do suporte é de 29/09/2026 e traz os preços por país
const ICLOUD = official('Apple · Preços do iCloud+', 'https://support.apple.com/pt-br/108047');
const PHOTOSHOP_BR = official('Adobe Photoshop · Planos (BR)', 'https://www.adobe.com/br/products/photoshop/plans.html');
const UBER_ONE_BR = official('Uber One (BR)', 'https://www.uber.com/br/pt-br/u/uber-one/');
// Estados Unidos: só páginas com o país no endereço (várias páginas de preço mudam pelo país de quem abre)
const SPOTIFY_US = official('Spotify · Premium (US)', 'https://www.spotify.com/us/premium/');
const NETFLIX_US = official('Netflix · Plans and pricing (US)', 'https://help.netflix.com/en/node/24926/us');
const HBOMAX_US = official('HBO Max · Plans and pricing (US)', 'https://help.hbomax.com/us/Answer/Detail/000002547');
const M365_US = official('Microsoft 365 · Compare plans (US)', 'https://www.microsoft.com/en-us/microsoft-365/buy/compare-all-microsoft-365-products');
const YOUTUBE_IOS_US = official('App Store (US) · YouTube', 'https://apps.apple.com/us/app/youtube/id544007664');
const APPLE_ONE_US = official('Apple One (US)', 'https://www.apple.com/apple-one/');
const UBER_ONE_US = official('Uber One (US)', 'https://www.uber.com/us/en/u/uber-one/');
const NO_TAX: LocalizedText = { en: 'Prices exclude applicable tax.', pt: 'Preços sem os impostos aplicáveis.' };
const SHARE_FIVE: LocalizedText = { en: 'Share with up to five other people.', pt: 'Compartilhe com até cinco pessoas.' };
const NETFLIX_EXTRA: LocalizedText = { en: 'Add-on to the Standard (1) or Premium (up to 2) plan.', pt: 'Adicional do plano Padrão (1) ou Premium (até 2).' };

const SAME_ADDRESS: LocalizedText = { en: 'All members must live at the same address.', pt: 'Todos os membros precisam morar no mesmo endereço.' };

/** Monta o id a partir dos campos, para não divergir */
const entry = (e: Omit<PriceEntry, 'id'>): PriceEntry => ({ id: `${e.service}/${e.plan}/${e.country}/${e.channel}`, ...e });

export const PRICE_BOOK: PriceEntry[] = [
  // Música
  entry({
    service: 'spotify', serviceName: 'Spotify', plan: 'individual', planName: 'Premium Individual', seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 23.9,
    terms: [{ months: 3, total: 72, billing: 'prepaid' }, { months: 6, total: 143, billing: 'prepaid' }, { months: 12, total: 239, billing: 'prepaid' }],
    source: SPOTIFY_BR,
  }),
  entry({
    service: 'spotify', serviceName: 'Spotify', plan: 'student', planName: { en: 'Premium Student', pt: 'Premium Universitário' }, seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 12.9,
    note: { en: 'For eligible students.', pt: 'Para estudantes elegíveis.' },
    source: SPOTIFY_BR,
  }),
  entry({
    service: 'spotify', serviceName: 'Spotify', plan: 'duo', planName: 'Premium Duo', seats: 2,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 31.9,
    terms: [{ months: 12, total: 379, billing: 'prepaid' }],
    note: SAME_ADDRESS, ruleSource: official('Spotify · Premium Duo (BR)', 'https://www.spotify.com/br-pt/duo/'),
    source: SPOTIFY_BR,
  }),
  entry({
    service: 'spotify', serviceName: 'Spotify', plan: 'family', planName: { en: 'Premium Family', pt: 'Premium Família' }, seats: 6,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 40.9,
    terms: [{ months: 12, total: 490, billing: 'prepaid' }],
    note: SAME_ADDRESS, ruleSource: official('Spotify · Premium Família (BR)', 'https://www.spotify.com/br-pt/family/'),
    source: SPOTIFY_BR,
  }),
  entry({
    service: 'deezer', serviceName: 'Deezer', plan: 'premium', planName: 'Premium', seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 24.9,
    terms: [{ months: 12, total: 222.9, billing: 'upfront' }],
    source: DEEZER_BR,
  }),
  entry({
    service: 'deezer', serviceName: 'Deezer', plan: 'duo', planName: 'Duo', seats: 2,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 32.9,
    terms: [{ months: 12, total: 359.9, billing: 'upfront' }],
    source: DEEZER_BR,
  }),
  entry({
    service: 'deezer', serviceName: 'Deezer', plan: 'family', planName: { en: 'Family', pt: 'Família' }, seats: 6,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 39.9,
    terms: [{ months: 12, total: 438.9, billing: 'upfront' }],
    source: DEEZER_BR,
  }),
  entry({
    service: 'deezer', serviceName: 'Deezer', plan: 'student', planName: { en: 'Student', pt: 'Estudante' }, seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 10.9,
    source: DEEZER_BR,
  }),

  // Vídeo
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'standard-ads', planName: { en: 'Standard with ads', pt: 'Padrão com anúncios' },
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 25.9, noAnnual: true,
    source: NETFLIX_BR,
  }),
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'standard', planName: { en: 'Standard', pt: 'Padrão' },
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 51.9, noAnnual: true,
    source: NETFLIX_BR,
  }),
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'premium', planName: 'Premium',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 71.9, noAnnual: true,
    source: NETFLIX_BR,
  }),
  // assinante extra: só como adicional do Padrão (1) ou do Premium (até 2)
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'extra-member-ads', planName: { en: 'Extra member with ads', pt: 'Assinante extra com anúncios' }, seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 11.9, noAnnual: true,
    note: { en: 'Add-on to the Standard (1) or Premium (up to 2) plan.', pt: 'Adicional do plano Padrão (1) ou Premium (até 2).' },
    source: NETFLIX_BR,
  }),
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'extra-member', planName: { en: 'Extra member', pt: 'Assinante extra' }, seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 14.9, noAnnual: true,
    note: { en: 'Add-on to the Standard (1) or Premium (up to 2) plan.', pt: 'Adicional do plano Padrão (1) ou Premium (até 2).' },
    source: NETFLIX_BR,
  }),
  entry({
    service: 'disney-plus', serviceName: 'Disney+', plan: 'standard-ads', planName: { en: 'Standard with ads', pt: 'Padrão com anúncios' },
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 29.9,
    source: DISNEY_BR,
  }),
  entry({
    service: 'disney-plus', serviceName: 'Disney+', plan: 'standard', planName: { en: 'Standard', pt: 'Padrão' },
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 49.9,
    terms: [{ months: 12, total: 407.88, billing: 'installments' }],
    source: DISNEY_BR,
  }),
  entry({
    service: 'disney-plus', serviceName: 'Disney+', plan: 'premium', planName: 'Premium',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 69.9,
    terms: [{ months: 12, total: 587.88, billing: 'installments' }],
    source: DISNEY_BR,
  }),
  entry({
    service: 'max', serviceName: 'HBO Max', plan: 'basic-ads', planName: { en: 'Basic with ads', pt: 'Básico com anúncios' },
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 29.9,
    terms: [{ months: 12, total: 274.8, billing: 'installments' }],
    source: HBOMAX_BR,
  }),
  entry({
    service: 'max', serviceName: 'HBO Max', plan: 'standard', planName: 'Standard',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 44.9,
    terms: [{ months: 12, total: 418.8, billing: 'installments' }],
    source: HBOMAX_BR,
  }),
  entry({
    service: 'max', serviceName: 'HBO Max', plan: 'platinum', planName: 'Platinum',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 55.9,
    terms: [{ months: 12, total: 538.8, billing: 'installments' }],
    source: HBOMAX_BR,
  }),
  // a página de preço do YouTube não abre sem login: só a loja tem o preço conferível
  entry({
    service: 'youtube', serviceName: 'YouTube', plan: 'premium', planName: 'YouTube Premium',
    country: 'BR', currency: 'BRL', channel: 'app_store', monthly: 34.9,
    source: YOUTUBE_IOS_BR,
  }),
  entry({
    service: 'youtube', serviceName: 'YouTube', plan: 'family', planName: { en: 'YouTube Premium Family', pt: 'YouTube Premium Família' }, seats: 6,
    country: 'BR', currency: 'BRL', channel: 'app_store', monthly: 69.9,
    note: SAME_ADDRESS, ruleSource: official('YouTube · Plano família', 'https://support.google.com/youtube/answer/7507349?hl=pt-BR'),
    source: YOUTUBE_IOS_BR,
  }),
  entry({
    service: 'youtube', serviceName: 'YouTube', plan: 'lite', planName: 'Premium Lite',
    country: 'BR', currency: 'BRL', channel: 'app_store', monthly: 21.9,
    source: YOUTUBE_IOS_BR,
  }),

  // IA
  entry({
    service: 'claude-anthropic', serviceName: 'Claude', plan: 'pro', planName: 'Pro', seats: 1,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 20,
    terms: [{ months: 12, total: 200, billing: 'upfront' }],
    note: { en: 'Prices exclude applicable tax.', pt: 'Preços sem os impostos aplicáveis.' },
    source: CLAUDE_WEB,
  }),
  entry({
    service: 'claude-anthropic', serviceName: 'Claude', plan: 'pro', planName: 'Pro', seats: 1,
    country: 'BR', currency: 'BRL', channel: 'app_store', monthly: 129.9,
    terms: [{ months: 12, total: 1299.9, billing: 'upfront' }],
    source: CLAUDE_IOS_BR,
  }),
  entry({
    service: 'claude-anthropic', serviceName: 'Claude', plan: 'max-5x', planName: 'Max 5x', seats: 1,
    country: 'BR', currency: 'BRL', channel: 'app_store', monthly: 799.9,
    source: CLAUDE_IOS_BR,
  }),
  entry({
    service: 'claude-anthropic', serviceName: 'Claude', plan: 'max-20x', planName: 'Max 20x', seats: 1,
    country: 'BR', currency: 'BRL', channel: 'app_store', monthly: 1499.9,
    source: CLAUDE_IOS_BR,
  }),
  // na loja americana o mensal é igual ao do site; o anual sai mais caro
  entry({
    service: 'claude-anthropic', serviceName: 'Claude', plan: 'pro', planName: 'Pro', seats: 1,
    country: 'US', currency: 'USD', channel: 'app_store', monthly: 20,
    terms: [{ months: 12, total: 214.99, billing: 'upfront' }],
    source: CLAUDE_IOS_US,
  }),
  entry({
    service: 'claude-anthropic', serviceName: 'Claude', plan: 'max-5x', planName: 'Max 5x', seats: 1,
    country: 'US', currency: 'USD', channel: 'app_store', monthly: 124.99,
    source: CLAUDE_IOS_US,
  }),
  entry({
    service: 'claude-anthropic', serviceName: 'Claude', plan: 'max-20x', planName: 'Max 20x', seats: 1,
    country: 'US', currency: 'USD', channel: 'app_store', monthly: 249.99,
    source: CLAUDE_IOS_US,
  }),
  // O ChatGPT fica de fora: a página de preço do site não abre para conferência, e sem ela não há o que comparar com a
  // loja (que, além disso, lista dois itens com o mesmo nome sem dizer o prazo)

  // Nuvem e escritório. A página do Google One diz "economize até 16%" no anual, sem o valor: fica sem terms
  entry({
    service: 'google-one', serviceName: 'Google One', plan: 'lite', planName: 'Lite · 30 GB',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 4.5,
    source: GOOGLE_ONE_BR,
  }),
  entry({
    service: 'google-one', serviceName: 'Google One', plan: 'basic', planName: { en: 'Basic · 100 GB', pt: 'Básico · 100 GB' },
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 9.99,
    note: { en: 'Storage can be shared with up to 5 others.', pt: 'O armazenamento pode ser dividido com até 5 pessoas.' },
    source: GOOGLE_ONE_BR,
  }),
  entry({
    service: 'google-one', serviceName: 'Google One', plan: 'ai-pro', planName: 'Google AI Pro · 5 TB',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 96.99,
    note: { en: 'Storage can be shared with up to 5 others.', pt: 'O armazenamento pode ser dividido com até 5 pessoas.' },
    source: GOOGLE_ONE_BR,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '50gb', planName: '50 GB',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 5.9, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '200gb', planName: '200 GB',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 19.9, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '2tb', planName: '2 TB',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 66.9, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '6tb', planName: '6 TB',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 199.9, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '12tb', planName: '12 TB',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 399.9, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '50gb', planName: '50 GB',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 0.99, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '200gb', planName: '200 GB',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 2.99, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '2tb', planName: '2 TB',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 9.99, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '6tb', planName: '6 TB',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 29.99, source: ICLOUD,
  }),
  entry({
    service: 'icloud-plus', serviceName: 'iCloud+', plan: '12tb', planName: '12 TB',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 59.99, source: ICLOUD,
  }),
  // a Apple cobra o Apple One com o mesmo descritor das outras compras dela (registro "Apple"): o plano pelo valor é palpite
  entry({
    service: 'apple', serviceName: 'Apple One', plan: 'apple-one-individual', planName: 'Apple One Individual',
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 47.9, source: APPLE_ONE_BR,
  }),
  entry({
    service: 'apple', serviceName: 'Apple One', plan: 'apple-one-family', planName: { en: 'Apple One Family', pt: 'Apple One Familiar' }, seats: 6,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 64.9,
    note: { en: 'Share with up to five other people.', pt: 'Compartilhe com até cinco pessoas.' },
    source: APPLE_ONE_BR,
  }),
  entry({
    service: 'apple', serviceName: 'Apple One', plan: 'apple-one-premium', planName: 'Apple One Premium', seats: 6,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 104.9,
    note: { en: 'Share with up to five other people.', pt: 'Compartilhe com até cinco pessoas.' },
    source: APPLE_ONE_BR,
  }),
  entry({
    service: 'microsoft-365', serviceName: 'Microsoft 365', plan: 'personal', planName: 'Personal', seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 51,
    terms: [{ months: 12, total: 509, billing: 'upfront' }],
    source: M365_BR,
  }),
  entry({
    service: 'microsoft-365', serviceName: 'Microsoft 365', plan: 'family', planName: 'Family', seats: 6,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 60,
    terms: [{ months: 12, total: 599, billing: 'upfront' }],
    note: { en: '1 to 6 people; AI features only for the subscription owner.', pt: 'De 1 a 6 pessoas; IA só para o titular da assinatura.' },
    source: M365_BR,
  }),
  entry({
    service: 'microsoft-365', serviceName: 'Microsoft 365', plan: 'premium', planName: 'Premium', seats: 6,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 109,
    terms: [{ months: 12, total: 1089, billing: 'upfront' }],
    source: M365_BR,
  }),
  // sem mensal avulso na página: "Anual, cobranças mensais" é o anual parcelado
  entry({
    service: 'adobe', serviceName: 'Adobe', plan: 'photoshop', planName: 'Photoshop', seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct',
    terms: [{ months: 12, total: 780, billing: 'installments' }, { months: 12, total: 720, billing: 'upfront' }],
    source: PHOTOSHOP_BR,
  }),

  // Clubes
  entry({
    service: 'uber-one', serviceName: 'Uber One', plan: 'standard', planName: 'Uber One', seats: 1,
    country: 'BR', currency: 'BRL', channel: 'direct', monthly: 19.9,
    terms: [{ months: 12, total: 198, billing: 'upfront' }],
    source: UBER_ONE_BR,
  }),
  // a ajuda da Uber cita um anual, mas sem dizer o país: nos EUA fica só o mensal da página americana
  entry({
    service: 'uber-one', serviceName: 'Uber One', plan: 'standard', planName: 'Uber One', seats: 1,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 9.99,
    source: UBER_ONE_US,
  }),

  // Estados Unidos (USD)
  entry({
    service: 'spotify', serviceName: 'Spotify', plan: 'individual', planName: 'Premium Individual', seats: 1,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 12.99, source: SPOTIFY_US,
  }),
  entry({
    service: 'spotify', serviceName: 'Spotify', plan: 'student', planName: 'Premium Student', seats: 1,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 6.99, source: SPOTIFY_US,
  }),
  entry({
    service: 'spotify', serviceName: 'Spotify', plan: 'duo', planName: 'Premium Duo', seats: 2,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 18.99, note: SAME_ADDRESS, source: SPOTIFY_US,
  }),
  entry({
    service: 'spotify', serviceName: 'Spotify', plan: 'family', planName: { en: 'Premium Family', pt: 'Premium Família' }, seats: 6,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 21.99, note: SAME_ADDRESS, source: SPOTIFY_US,
  }),
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'standard-ads', planName: { en: 'Standard with ads', pt: 'Padrão com anúncios' },
    country: 'US', currency: 'USD', channel: 'direct', monthly: 8.99, noAnnual: true, source: NETFLIX_US,
  }),
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'standard', planName: { en: 'Standard', pt: 'Padrão' },
    country: 'US', currency: 'USD', channel: 'direct', monthly: 19.99, noAnnual: true, source: NETFLIX_US,
  }),
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'premium', planName: 'Premium',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 26.99, noAnnual: true, source: NETFLIX_US,
  }),
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'extra-member-ads', planName: { en: 'Extra member with ads', pt: 'Assinante extra com anúncios' }, seats: 1,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 7.99, noAnnual: true, note: NETFLIX_EXTRA, source: NETFLIX_US,
  }),
  entry({
    service: 'netflix', serviceName: 'Netflix', plan: 'extra-member', planName: { en: 'Extra member', pt: 'Assinante extra' }, seats: 1,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 9.99, noAnnual: true, note: NETFLIX_EXTRA, source: NETFLIX_US,
  }),
  entry({
    service: 'max', serviceName: 'HBO Max', plan: 'basic-ads', planName: { en: 'Basic with ads', pt: 'Básico com anúncios' },
    country: 'US', currency: 'USD', channel: 'direct', monthly: 10.99,
    terms: [{ months: 12, total: 109.99, billing: 'upfront' }], note: NO_TAX, source: HBOMAX_US,
  }),
  entry({
    service: 'max', serviceName: 'HBO Max', plan: 'standard', planName: 'Standard',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 18.49,
    terms: [{ months: 12, total: 184.99, billing: 'upfront' }], note: NO_TAX, source: HBOMAX_US,
  }),
  entry({
    service: 'max', serviceName: 'HBO Max', plan: 'premium', planName: 'Premium',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 22.99,
    terms: [{ months: 12, total: 229.99, billing: 'upfront' }], note: NO_TAX, source: HBOMAX_US,
  }),
  // a página de preço do YouTube não abre sem login (como no Brasil): só a loja tem o preço conferível
  entry({
    service: 'youtube', serviceName: 'YouTube', plan: 'premium', planName: 'YouTube Premium',
    country: 'US', currency: 'USD', channel: 'app_store', monthly: 20.99, source: YOUTUBE_IOS_US,
  }),
  entry({
    service: 'youtube', serviceName: 'YouTube', plan: 'family', planName: { en: 'YouTube Premium Family', pt: 'YouTube Premium Família' },
    country: 'US', currency: 'USD', channel: 'app_store', monthly: 34.99, source: YOUTUBE_IOS_US,
  }),
  entry({
    service: 'youtube', serviceName: 'YouTube', plan: 'lite', planName: 'Premium Lite',
    country: 'US', currency: 'USD', channel: 'app_store', monthly: 11.99, source: YOUTUBE_IOS_US,
  }),
  entry({
    service: 'microsoft-365', serviceName: 'Microsoft 365', plan: 'personal', planName: 'Personal', seats: 1,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 9.99,
    terms: [{ months: 12, total: 99.99, billing: 'upfront' }], source: M365_US,
  }),
  entry({
    service: 'microsoft-365', serviceName: 'Microsoft 365', plan: 'family', planName: 'Family', seats: 6,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 12.99,
    terms: [{ months: 12, total: 129.99, billing: 'upfront' }], source: M365_US,
  }),
  entry({
    service: 'microsoft-365', serviceName: 'Microsoft 365', plan: 'premium', planName: 'Premium', seats: 6,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 19.99,
    terms: [{ months: 12, total: 199.99, billing: 'upfront' }], source: M365_US,
  }),
  // nos EUA o plano maior se chama Premier; a página não diz quantas pessoas cabem no Individual
  entry({
    service: 'apple', serviceName: 'Apple One', plan: 'apple-one-individual', planName: 'Apple One Individual',
    country: 'US', currency: 'USD', channel: 'direct', monthly: 21.95, source: APPLE_ONE_US,
  }),
  entry({
    service: 'apple', serviceName: 'Apple One', plan: 'apple-one-family', planName: { en: 'Apple One Family', pt: 'Apple One Familiar' }, seats: 6,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 27.95, note: SHARE_FIVE, source: APPLE_ONE_US,
  }),
  entry({
    service: 'apple', serviceName: 'Apple One', plan: 'apple-one-premier', planName: 'Apple One Premier', seats: 6,
    country: 'US', currency: 'USD', channel: 'direct', monthly: 39.95, note: SHARE_FIVE, source: APPLE_ONE_US,
  }),
];

export const PRICE_CHANGES: PriceChange[] = [
  // o preço novo está na página oficial; o antigo e o dia do anúncio, na imprensa
  ...([
    ['standard-ads', 20.9, 25.9],
    ['standard', 44.9, 51.9],
    ['premium', 59.9, 71.9],
  ] as const).map(([plan, from, to]): PriceChange => ({
    service: 'netflix', plan, country: 'BR', currency: 'BRL', from, to, announced: '2026-10-15',
    source: {
      label: 'Canaltech · Netflix aumenta preços no Brasil',
      url: 'https://canaltech.com.br/apps/netflix-aumenta-precos-no-brasil-e-plano-mais-caro-passa-dos-r-70-veja-novos-valores/',
      checked: CHECKED,
      level: 'press',
      published: '2026-10-15',
    },
  })),
  // EUA: o texto diz que o Padrão "went up by $2 to reach $19.99"; o anterior sai da conta
  ...([
    ['standard-ads', 7.99, 8.99],
    ['standard', 17.99, 19.99],
    ['premium', 24.99, 26.99],
  ] as const).map(([plan, from, to]): PriceChange => ({
    service: 'netflix', plan, country: 'US', currency: 'USD', from, to, announced: '2026-03-27',
    source: {
      label: 'Quartz (Yahoo Finance) · Netflix raises prices across US',
      url: 'https://finance.yahoo.com/markets/stocks/articles/netflix-raises-prices-across-us-135935107.html',
      checked: CHECKED,
      level: 'press',
      published: '2026-03-27',
    },
  })),
  // a imprensa diz que o novo preço vale a partir da fatura de fevereiro
  ...([
    ['individual', 11.99, 12.99],
    ['duo', 16.99, 18.99],
    ['family', 19.99, 21.99],
  ] as const).map(([plan, from, to]): PriceChange => ({
    service: 'spotify', plan, country: 'US', currency: 'USD', from, to, announced: '2026-01-15',
    source: {
      label: '9to5Google · Spotify raises US prices on all plans',
      url: 'https://9to5google.com/2026/01/15/spotify-us-subscribers-price-hike-all-plans-2026/',
      checked: CHECKED,
      level: 'press',
      published: '2026-01-15',
    },
  })),
];
