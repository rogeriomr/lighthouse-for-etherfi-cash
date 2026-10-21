// O que se sabe publicamente sobre serviços de assinatura: ciclos, renovação e onde cancelar.
// Só conhecimento genérico, com as páginas de onde veio; nada de dados de quem usa o painel.
// Ordem importa: a primeira que casa vence, então o mais específico vem antes (o item de domínios antes do plano da
// mesma empresa, os produtos com nome próprio antes do prefixo genérico de cobrança da loja).
import type { KnowledgeItem } from './subscriptionTypes';

export const SUBSCRIPTION_KNOWLEDGE: KnowledgeItem[] = [
  // Vídeo
  {
    matchers: ['NETFLIX.COM', 'NETFLIX'],
    name: 'Netflix',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: "Charges at the start of each month, on the day the subscription began (or the last day of the month if that date doesn't exist); if you cancel, access continues until the end of the paid period, and if you pay through a carrier or partner, cancel with them.",
      pt: 'Cobra no início de cada mês, no dia em que a assinatura começou (ou no último dia do mês, se essa data não existir); cancelando, o acesso segue até o fim do período pago, e quem paga por operadora ou parceiro cancela com ele.',
    },
    manageUrl: 'https://www.netflix.com/cancelplan',
    sources: ['https://help.netflix.com/pt/node/54896', 'https://help.netflix.com/pt/node/407'],
  },
  {
    matchers: ['DISNEYPLUS', 'DISNEY PLUS', 'DISNEY+'],
    name: 'Disney+',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'The monthly plan renews every month and the annual plan is paid upfront, possibly in 12 installments; if you cancel under Account > Subscription, access continues until the next billing date, and if you subscribed through the App Store or Google Play, cancel in the store.',
      pt: 'O mensal renova todo mês e o anual é pago adiantado, podendo vir em 12 parcelas; cancelando em Conta > Assinatura, o acesso segue até a próxima data de cobrança, e quem assinou pela App Store ou pelo Google Play cancela na loja.',
    },
    manageUrl: 'https://www.disney.com.br/novidades/como-cancelar-sua-assinatura-do-disney-plus',
    sources: [
      'https://www.disneyplus.com/pt-br',
      'https://www.disney.com.br/novidades/como-cancelar-sua-assinatura-do-disney-plus',
      'https://canaltech.com.br/apps/como-cancelar-a-sua-assinatura-do-disney/',
    ],
    domains: ['disneyplus.com'],
  },
  {
    matchers: ['HBO MAX', 'HBOMAX'],
    name: 'Max',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews automatically until canceled (the brand is called HBO Max again); if you cancel before the next charge, access continues until the end of the period, but on the 12-month plan the monthly payments continue until the end of the contract, and charges through app stores, Prime Video Channels or a carrier are canceled there.',
      pt: 'Renova sozinho até ser cancelado (a marca voltou a se chamar HBO Max); cancelando antes da próxima cobrança, o acesso segue até o fim do período, mas no plano de 12 meses as mensalidades continuam até o fim do contrato, e cobranças por loja de apps, Prime Video Channels ou operadora se cancelam lá.',
    },
    manageUrl: 'https://www.hbomax.com/subscription',
    sources: [
      'https://help.hbomax.com/br/Answer/Detail/000002526',
      'https://help.hbomax.com/BR/Answer/Detail/000002547',
      'https://help.hbomax.com/BR/Answer/Detail/000002524',
    ],
    domains: ['max.com'],
  },
  {
    matchers: ['GLOBOPLAY', 'GLOBO PLAY'],
    name: 'Globoplay',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'The monthly plan renews every month and the annual plan renews on the same day you signed up, with an email notice 30 days before; if you cancel under Minha Conta > Ver pagamentos, access continues until the end of the cycle, and if you subscribed through the App Store or Google Play, cancel in the store.',
      pt: 'O mensal renova todo mês e o anual renova no mesmo dia da contratação, com aviso por e-mail 30 dias antes; cancelando em Minha Conta > Ver pagamentos, o acesso segue até o fim do ciclo, e quem assinou pela App Store ou pelo Google Play cancela na loja.',
    },
    manageUrl: 'https://minhaconta.globo.com/',
    sources: [
      'https://ajuda.globo/globoplay/web/assinatura/cupom-eps/faq/perguntas-frequentes-cupom-globoplay.ghtml',
      'https://ajuda.globo/google/amp/globoplay/app/assinatura-e-acesso/faq/como-funciona-a-renovacao-do-plano-anual.ghtml',
      'https://ajuda.globo/globoplay/app/assinatura-e-acesso/faq/assinei-via-app-store-como-faco-para-cancelar.ghtml',
    ],
  },
  {
    matchers: ['TELECINE'],
    name: 'Telecine',
    isSubscription: 'yes',
    cycles: ['unknown'],
    note: {
      en: 'Sold alone or bundled with Globoplay and managed through the Globo account; the billing cycle was not confirmed by an official source, so check the next billing date in Minha Conta.',
      pt: 'Vendido sozinho ou em combo com o Globoplay e gerenciado pela conta Globo; o ciclo não foi confirmado em fonte oficial, então confira em Minha Conta a data da próxima cobrança.',
    },
    manageUrl: 'https://minhaconta.globo.com/',
    sources: ['https://ajuda.globo/telecine/'],
  },
  {
    matchers: ['PARAMOUNT+', 'PARAMOUNTPLUS', 'PARAMOUNT PLUS'],
    name: 'Paramount+',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Charges at the start of each period (monthly or annual) and renews automatically; if you cancel, access continues until the end of the period, with no refund outside the 7-day withdrawal window, and a subscription made through an app store or another streaming service is canceled there.',
      pt: 'Cobra no início de cada período (mensal ou anual) e renova sozinho; cancelando, o acesso segue até o fim do período, sem reembolso fora dos 7 dias de arrependimento, e assinatura feita por loja de apps ou outro streaming se cancela lá.',
    },
    manageUrl: 'https://www.paramountplus.com/account',
    sources: ['https://legal.paramount.com/br/pt/pplus/termsofuse', 'https://www.paramountplus.com/br/'],
  },
  {
    matchers: ['CRUNCHYROLL'],
    name: 'Crunchyroll',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews every billing cycle you chose (monthly or annual); if you cancel on the website under Settings > Subscription info, or in the store if you subscribed through the app, Premium continues until the end of the current cycle.',
      pt: 'Renova a cada ciclo contratado (mensal ou anual); cancelando no site em Configurações > Informações da assinatura, ou na loja se assinou pelo app, o Premium segue até o fim do ciclo atual.',
    },
    sources: [
      'https://www.techtudo.com.br/guia/2026/05/crunchyroll-veja-planos-precos-melhores-animes-e-como-assinar-steaming.ghtml',
      'https://www.hardware.com.br/entretenimento/crunchyroll-aumenta-precos-no-brasil-veja-os-novos-valores/',
    ],
    domains: ['crunchyroll.com'],
  },
  {
    matchers: ['AMAZON PRIME', 'AMAZONPRIME', 'PRIME VIDEO', 'PRIMEVIDEO'],
    name: 'Amazon Prime',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Prime (with Prime Video) has monthly and annual plans that renew automatically; under Your Account > Prime > Manage membership you can cancel and keep access until the end of the paid period, and on the annual plan there is a refund only if no benefits were used after the renewal.',
      pt: 'O Prime (com Prime Video) tem plano mensal e anual com renovação automática; em Sua conta > Prime > Gerenciar assinatura dá para cancelar mantendo o acesso até o fim do período pago, e no anual só há reembolso se nenhum benefício foi usado após a renovação.',
    },
    sources: [
      'https://descontostop.com/dicas/como-cancelar-amazon-prime-o-que-voce-precisa-saber/',
      'https://olhardigital.com.br/2022/05/03/dicas-e-tutoriais/como-cancelar-assinatura-amazon-prime/',
    ],
    domains: ['amazon.com.br', 'amazon.com', 'primevideo.com'],
  },
  {
    // "YOUTUB" pega o nome cortado no fim do descritor do Google
    matchers: ['YOUTUBE', 'YOUTUB'],
    name: 'YouTube',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    note: {
      en: 'Premium and channel memberships charge on the first day of each monthly period and, if you cancel at youtube.com/paid_memberships (or in the store, if you subscribed there), benefits continue until the end of the period; the same brand also charges one-off purchases: movie rentals and purchases, Super Chat and Super Thanks.',
      pt: 'O Premium e os clubes dos canais cobram no primeiro dia de cada período mensal e, cancelando em youtube.com/paid_memberships (ou na loja, se assinou por lá), os benefícios seguem até o fim do período; a mesma marca também cobra avulso: aluguel e compra de filmes, Super Chat e Super Thanks.',
    },
    manageUrl: 'https://www.youtube.com/paid_memberships',
    sources: [
      'https://support.google.com/youtube/answer/6308278?hl=pt-BR',
      'https://support.google.com/youtube/answer/6304294?hl=pt-BR',
      'https://www.youtube.com/t/terms_paidservice?hl=pt-BR',
    ],
    domains: ['google.com'],
  },

  // Música e leitura
  {
    matchers: ['SPOTIFY'],
    name: 'Spotify',
    isSubscription: 'yes',
    cycles: ['monthly', 'quarterly', 'semiannual', 'annual'],
    note: {
      en: 'Monthly Premium renews automatically on a fixed date and, if you cancel before it, stays active until then; prepaid packages (1, 3, 6 or 12 months) do not renew automatically, and a plan bought through a carrier or partner is canceled with them.',
      pt: 'O Premium mensal renova sozinho numa data fixa e, cancelando antes dela, segue ativo até lá; os pacotes pagos adiantado (1, 3, 6 ou 12 meses) não renovam sozinhos, e plano contratado por operadora ou parceiro se cancela com ele.',
    },
    manageUrl: 'https://www.spotify.com/account/subscription/manage/',
    sources: [
      'https://support.spotify.com/br-pt/article/cancel-premium/',
      'https://www.spotify.com/br-pt/premium/',
      'https://support.spotify.com/br-pt/article/billing-date/',
    ],
  },
  {
    matchers: ['DEEZER'],
    name: 'Deezer',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews automatically at the end of each period; cancel at least 48 hours before renewal to keep Premium until the end of the current period, and if you subscribed through Apple, Google Play or a partner (such as TIM), cancel there.',
      pt: 'Renova sozinho ao fim de cada período; cancele pelo menos 48 horas antes da renovação para manter o Premium até o fim do período atual, e se assinou pela Apple, pelo Google Play ou por parceiro (como a TIM), cancele lá.',
    },
    manageUrl: 'https://support.deezer.com/hc/pt-br/articles/214349245-Cancelar-sua-assinatura-Deezer',
    sources: [
      'https://support.deezer.com/hc/pt-br/articles/214349245-Cancelar-sua-assinatura-Deezer',
      'https://support.deezer.com/hc/pt-br/articles/30607764539933-Como-mudar-o-plano-de-sua-assinatura-Deezer',
      'https://www.deezer.com/br/offers',
    ],
  },
  {
    matchers: ['AMAZON MUSIC', 'AMZN MUSIC'],
    name: 'Amazon Music',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Amazon Music Unlimited renews automatically; if you cancel in the Amazon Music settings, access continues until the last day of the paid period, and if you signed up through Apple or Google, cancel with them.',
      pt: 'O Amazon Music Unlimited renova sozinho; cancelando nas configurações do Amazon Music, o acesso segue até o último dia do período pago, e se foi contratado pela Apple ou pelo Google, cancele com eles.',
    },
    sources: ['https://olhardigital.com.br/2024/10/26/dicas-e-tutoriais/como-cancelar-o-amazon-music-unlimited/'],
    domains: ['amazon.com.br', 'amazon.com'],
  },
  {
    matchers: ['KINDLE UNLTD', 'KINDLE UNLIMITED'],
    name: 'Kindle Unlimited',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'Renews automatically every month; to stop it, go to Memberships & Subscriptions > Kindle Unlimited > Cancel plan on the Amazon website, and catalog books go away when the subscription ends.',
      pt: 'Renova sozinho todo mês; para parar, vá em Inscrições e assinaturas > Kindle Unlimited > Cancelar o plano no site da Amazon, e os livros do catálogo somem quando a assinatura acaba.',
    },
    sources: [
      'https://canaltech.com.br/internet/como-cancelar-o-kindle-unlimited-da-amazon/',
      'https://canaltech.com.br/e-reader/como-funciona-o-kindle-unlimited-no-brasil/',
      'https://merchants.letsweel.com/merchants/kindle-unlimited',
    ],
    domains: ['amazon.com.br', 'amazon.com'],
  },
  {
    matchers: ['AUDIBLE'],
    name: 'Audible',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'Renews automatically every month; if you cancel under Membership details, benefits continue until the end of the paid cycle, with no refund, purchased audiobooks stay in your library, and a subscription made through a phone app store is canceled there.',
      pt: 'Renova sozinho todo mês; cancelando em Detalhes da assinatura, os benefícios seguem até o fim do ciclo pago, sem reembolso, os audiolivros comprados ficam na biblioteca e assinatura feita pela loja do celular se cancela lá.',
    },
    manageUrl: 'https://www.audible.com.br/account/overview',
    sources: [
      'https://ajuda.audible.com.br/s/article/cancel-membership?language=pt_BR',
      'https://ajuda.audible.com.br/s/article/learn-about-standard-plan?language=pt_BR',
      'https://www.audible.com.br/legal/conditions-of-use',
    ],
    domains: ['audible.com'],
  },

  // IA
  {
    matchers: ['CLAUDE.AI', 'CLAUDE SUB', 'CLAUDE TEAM', 'ANTHROPIC'],
    name: 'Claude (Anthropic)',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews automatically on the billing date (monthly; Pro also has an annual plan); if you cancel under Settings > Billing at least 24 hours before, access continues until the end of the period, and a subscription made through the phone app is canceled in the store; a charge showing only ANTHROPIC may be prepaid API credit, which is not a subscription.',
      pt: 'Renova sozinho na data de cobrança (mensal; o Pro também tem anual); cancelando em Configurações > Cobrança pelo menos 24 horas antes, o acesso segue até o fim do período, e assinatura feita pelo app do celular se cancela na loja; cobrança só com ANTHROPIC pode ser crédito pré-pago da API, que não é assinatura.',
    },
    manageUrl: 'https://claude.ai/settings/billing',
    sources: [
      'https://support.claude.com/en/articles/8325617-how-do-i-cancel-my-claude-pro-subscription',
      'https://claude.com/pricing',
      'https://merchants.letsweel.com/merchants/anthropic',
    ],
    domains: ['claude.com', 'anthropic.com'],
  },
  {
    // créditos da API vêm antes do ChatGPT, que também casa com "OPENAI"
    matchers: ['OPENAI *API', 'OPENAI*API'],
    name: 'OpenAI API',
    isSubscription: 'no',
    cycles: ['unknown'],
    note: {
      en: 'Not a subscription: the API is paid with credits bought before use, so there is no renewal to cancel; track purchases and spending limits in the billing dashboard of the OpenAI platform.',
      pt: 'Não é assinatura: a API é paga com créditos comprados antes do uso, então não há renovação para cancelar; acompanhe compras e limites de gasto no painel de cobrança da plataforma da OpenAI.',
    },
    sources: ['https://merchants.letsweel.com/merchants/openai', 'https://developers.openai.com/api/docs/guides/rate-limits'],
  },
  {
    matchers: ['CHATGPT', 'OPENAI'],
    name: 'ChatGPT (OpenAI)',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Plus and Pro renew every month (only Business has an annual plan); if you cancel under Settings > Account on chatgpt.com, access continues until the end of the period, but a subscription made through the phone app can only be canceled in the App Store or Google Play.',
      pt: 'Plus e Pro renovam todo mês (só o Business tem anual); cancelando em Configurações > Conta no chatgpt.com, o acesso segue até o fim do período, mas assinatura feita pelo app do celular só se cancela na App Store ou no Google Play.',
    },
    sources: [
      'https://merchants.letsweel.com/merchants/openai',
      'https://suprmind.ai/hub/chatgpt/how-to-cancel.md',
      'https://community.openai.com/t/feature-request-annual-billing-option-for-personal-chatgpt-plus-pro-accounts/1380930',
    ],
    domains: ['chatgpt.com', 'openai.com'],
  },
  {
    // o telefone aparece sozinho em descritores sem a marca ("PRO 5102700840 CA")
    matchers: ['PERPLEXITY', '5102700840'],
    name: 'Perplexity',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews automatically on the cycle you chose; if you cancel under Settings > Subscription, the account only goes back to free at the end of the paid cycle, and if you subscribed through the phone app, cancel in the store.',
      pt: 'Renova sozinho no ciclo escolhido; cancelando em Configurações > Assinatura, a conta só volta ao grátis no fim do ciclo pago, e quem assinou pelo app do celular cancela na loja.',
    },
    manageUrl: 'https://www.perplexity.ai/help-center/en/articles/10354283-canceling-a-subscription',
    sources: [
      'https://www.perplexity.ai/help-center/en/articles/10354283-canceling-a-subscription',
      'https://www.perplexity.ai/help-center/en/articles/10353002-billing-faq-for-pro-plan-subscribers',
      'https://merchants.letsweel.com/merchants/perplexity-ai',
    ],
  },
  {
    matchers: ['MIDJOURNEY'],
    name: 'Midjourney',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Every subscription renews automatically (the annual plan, paid upfront, is selected by default); if you cancel at midjourney.com/account before renewal, access continues until the end of the period, with no refund for the remaining months of an annual plan.',
      pt: 'Toda assinatura renova sozinha (o anual, pago adiantado, vem marcado por padrão); cancelando em midjourney.com/account antes da renovação, o acesso segue até o fim do período, sem reembolso dos meses restantes do anual.',
    },
    manageUrl: 'https://www.midjourney.com/account',
    sources: ['https://recurdash.com/guides/how-to-cancel-midjourney', 'https://merchants.letsweel.com/merchants/midjourney'],
  },
  {
    matchers: ['CURSOR, AI POWERED', 'AI POWERED IDE', 'CURSOR USAGE', 'CURSOR.SH', 'CURSOR.COM', 'CURSOR AI', 'ANYSPHERE'],
    name: 'Cursor',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews every month or every year on the subscription date and may add extra usage charges between renewals; if you cancel at cursor.com/dashboard/billing, paid access continues until the end of the period.',
      pt: 'Renova todo mês ou todo ano na data da assinatura e pode ter cobranças extras de uso entre uma renovação e outra; cancelando em cursor.com/dashboard/billing, o acesso pago segue até o fim do período.',
    },
    manageUrl: 'https://cursor.com/dashboard/billing',
    sources: [
      'https://cursor.com/help/account-and-billing/billing',
      'https://cursor.com/help/account-and-billing/cancel',
      'https://merchants.letsweel.com/merchants/cursor',
    ],
  },
  {
    matchers: ['GITHUB'],
    name: 'GitHub',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Pro, Team and Copilot renew monthly or yearly on the day you started paying; canceling or downgrading only takes effect at the end of the cycle, with access until then, and Copilot provided by an organization or school cannot be canceled by you.',
      pt: 'Pro, Team e Copilot renovam mensal ou anualmente no dia em que você começou a pagar; cancelar ou rebaixar só vale no fim do ciclo, com acesso até lá, e o Copilot recebido por organização ou escola não é cancelado por você.',
    },
    manageUrl: 'https://docs.github.com/en/copilot/how-tos/manage-your-account/view-and-change-your-copilot-plan',
    sources: [
      'https://docs.github.com/en/billing/concepts/impact-of-plan-changes',
      'https://docs.github.com/en/copilot/how-tos/manage-your-account/view-and-change-your-copilot-plan',
      'https://docs.github.com/en/billing/get-started/how-billing-works',
    ],
  },
  {
    matchers: ['ELEVENLABS', 'ELEVEN LABS'],
    name: 'ElevenLabs',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Monthly and annual plans renew automatically; canceling or downgrading only takes effect at the end of the cycle (unused credits are lost), and you cannot switch from annual back to monthly before the period ends.',
      pt: 'Planos mensais e anuais renovam sozinhos; cancelar ou rebaixar só vale no fim do ciclo (créditos não usados se perdem), e do anual não dá para voltar ao mensal antes de o período acabar.',
    },
    manageUrl: 'https://elevenlabs.io/app/subscription',
    sources: ['https://elevenlabs.io/docs/product-guides/administration/billing', 'https://merchants.letsweel.com/merchants/elevenlabs'],
  },
  {
    matchers: ['XAI LLC', 'X.AI', 'SUPERGROK', 'GROK'],
    name: 'Grok (xAI)',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'SuperGrok and the X Subscription renew automatically; if you subscribed on grok.com, cancel under Settings > Billing on the website, if through the phone app, in the store, and if through X, on X itself.',
      pt: 'SuperGrok e a X Subscription renovam sozinhos; se assinou no grok.com, cancele em Configurações > Cobrança do site, se foi pelo app do celular, na loja, e se foi pelo X, no próprio X.',
    },
    manageUrl: 'https://grok.com/?_s=billing',
    sources: ['https://docs.x.ai/grok/faq', 'https://x.ai/news/x-subscription', 'https://merchants.letsweel.com/merchants/xai'],
    domains: ['x.ai'],
  },

  // Nuvem, hospedagem e domínios
  {
    matchers: ['VERCEL DOMAINS'],
    name: 'Vercel Domains',
    isSubscription: 'yes',
    cycles: ['annual'],
    // cada domínio renova na sua data, e a cobrança sai 30 dias antes do vencimento
    itemized: true,
    chargeLeadDays: 30,
    note: {
      en: 'Domains bought on Vercel renew automatically and the charge is attempted 30 days before expiration; to avoid paying, turn off renewal in the Domains tab more than 30 days ahead, because after that a renewal in progress is not canceled.',
      pt: 'Domínios comprados na Vercel renovam sozinhos e a cobrança é tentada 30 dias antes do vencimento; para não pagar, desligue a renovação na aba Domains com mais de 30 dias de antecedência, porque depois disso a renovação em andamento não é cancelada.',
    },
    manageUrl: 'https://vercel.com/docs/domains/renew-a-domain',
    sources: ['https://vercel.com/docs/domains/renew-a-domain', 'https://emma-app.com/who-charged-me/vercel'],
  },
  {
    matchers: ['VERCEL'],
    name: 'Vercel',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: "Charges at the start of each monthly cycle for next month's seats plus the extra usage from the previous cycle; to stop renewal, downgrade the team to Hobby under Settings > Billing before the date.",
      pt: 'Cobra no início de cada ciclo mensal os assentos do mês seguinte junto com o uso extra do ciclo anterior; para não renovar, rebaixe a equipe para o Hobby em Settings > Billing antes da data.',
    },
    manageUrl: 'https://vercel.com/docs/plans/pro-plan',
    sources: ['https://vercel.com/docs/plans/pro-plan/billing', 'https://vercel.com/docs/plans/pro-plan', 'https://emma-app.com/who-charged-me/vercel'],
  },
  {
    matchers: ['CLOUDFLARE'],
    name: 'Cloudflare',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: "Plans are charged in advance every 30 or 365 days, metered usage afterward, and Registrar domains renew automatically about 30 days before expiration; cancel under Billing > Subscriptions at least 24 hours before and turn off the domain's Auto-renew more than 30 days ahead.",
      pt: 'Planos são cobrados adiantados a cada 30 ou 365 dias, o uso medido depois, e domínios do Registrar renovam sozinhos uns 30 dias antes do vencimento; cancele em Billing > Subscriptions pelo menos 24 horas antes e desligue o Auto-renew do domínio com mais de 30 dias de antecedência.',
    },
    manageUrl: 'https://developers.cloudflare.com/billing/manage/cancel-subscription/',
    sources: [
      'https://developers.cloudflare.com/billing/understand/how-billing-works/',
      'https://developers.cloudflare.com/billing/manage/cancel-subscription/',
      'https://developers.cloudflare.com/registrar/account-options/renew-domains/',
    ],
  },
  {
    matchers: ['DIGITALOCEAN'],
    name: 'DigitalOcean',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    note: {
      en: "There is no plan to renew: on the 1st of each month it charges the previous month's usage, and powered-off Droplets keep being billed, so to bring the next bill to zero you must destroy the resources or deactivate the account.",
      pt: 'Não há plano a renovar: no dia 1º de cada mês cobra o uso do mês anterior, e Droplets desligados continuam cobrando, então para zerar a próxima fatura é preciso destruir os recursos ou desativar a conta.',
    },
    manageUrl: 'https://cloud.digitalocean.com/account/billing',
    sources: [
      'https://docs.digitalocean.com/platform/billing/invoices/',
      'https://docs.digitalocean.com/products/droplets/details/pricing/',
      'https://docs.digitalocean.com/platform/accounts/deactivate/',
    ],
  },
  {
    // "AWS" sozinho casaria dentro de outras palavras
    matchers: ['AMAZON WEB SERVICES', 'AWS.AMAZON'],
    name: 'AWS',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    note: {
      en: "No fixed plan: at the start of each month it charges the previous month's usage while resources are active; to stop, you must shut down the resources or close the account, and one last bill still arrives the following month (Reserved Instances and Savings Plans continue until they expire).",
      pt: 'Sem plano fixo: no início de cada mês cobra o uso do mês anterior enquanto houver recursos ativos; para parar é preciso encerrar os recursos ou fechar a conta, e ainda chega uma última fatura no mês seguinte (Reserved Instances e Savings Plans seguem até expirar).',
    },
    manageUrl: 'https://console.aws.amazon.com/costmanagement/',
    sources: [
      'https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/invoice.html',
      'https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-closing.html',
      'https://merchants.letsweel.com/merchants/amazon-web-services',
    ],
  },
  {
    matchers: ['NETLIFY'],
    name: 'Netlify',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'The team plan is charged in advance every month on the date the team was created, and domains registered there renew separately, once a year; a downgrade only takes effect next cycle, so do it before the date under Usage & billing > Plan details.',
      pt: 'O plano da equipe é cobrado adiantado todo mês na data em que a equipe foi criada, e domínios registrados lá renovam à parte, uma vez por ano; rebaixar só vale no próximo ciclo, então faça antes da data em Usage & billing > Plan details.',
    },
    manageUrl: 'https://docs.netlify.com/manage/accounts-and-billing/billing/change-your-pricing-plan/',
    sources: [
      'https://docs.netlify.com/manage/accounts-and-billing/billing-faq/',
      'https://docs.netlify.com/manage/accounts-and-billing/billing/change-your-pricing-plan/',
    ],
  },
  {
    matchers: ['HEROKU'],
    name: 'Heroku',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    note: {
      en: "Each month brings the bill for the previous month's usage (dynos and add-ons by the second; the Eco plan renews in full on the 1st of each month), so to stop, scale dynos to zero, remove add-ons and cancel Eco before the month turns over.",
      pt: 'Todo mês chega a fatura do uso do mês anterior (dynos e add-ons por segundo; o plano Eco renova cheio todo dia 1º), então para parar reduza os dynos a zero, remova os add-ons e cancele o Eco antes da virada do mês.',
    },
    manageUrl: 'https://dashboard.heroku.com/account/billing',
    sources: ['https://devcenter.heroku.com/articles/usage-and-billing', 'https://help.heroku.com/DZFUP53P/how-to-read-your-monthly-heroku-invoice'],
  },
  {
    matchers: ['GODADDY'],
    name: 'GoDaddy',
    isSubscription: 'maybe',
    cycles: ['monthly', 'annual'],
    // cada domínio ou produto renova sozinho, no prazo dele (1 a 10 anos)
    itemized: true,
    note: {
      en: 'Domains and other products renew automatically at the end of the term, for the same length as the last renewal and on the saved card; to avoid the charge, cancel or turn off renewal in Renewals and Billing before the date.',
      pt: 'Domínios e outros produtos renovam sozinhos no fim do período, pelo mesmo prazo da última renovação e no cartão salvo; para não ser cobrado, cancele ou desligue a renovação em Renewals and Billing antes da data.',
    },
    manageUrl: 'https://account.godaddy.com/myrenewals',
    sources: [
      'https://dk.godaddy.com/help/turn-off-auto-renew-20008?lc=en-US',
      'https://dk.godaddy.com/help/manually-renew-my-products-or-services-725?lc=en-US',
      'https://dk.godaddy.com/help/why-choose-a-12-month-commitment-with-an-early-cancellation-fee-42436?lc=en-US',
    ],
  },
  {
    matchers: ['HOSTINGER'],
    name: 'Hostinger',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    // cada plano e domínio é pago adiantado pelo prazo dele e renova à parte
    itemized: true,
    note: {
      en: 'Plans are paid upfront for the whole period chosen (1 to 48 months) and renew automatically on the default card; turn off renewal in hPanel under Billing > Services > Renewal settings, and for domains do it at least 27 days before expiration.',
      pt: 'Os planos são pagos adiantados pelo período inteiro escolhido (de 1 a 48 meses) e renovam sozinhos no cartão padrão; desligue a renovação no hPanel em Faturas > Serviços > Configurações de Renovação, e para domínios faça isso pelo menos 27 dias antes do vencimento.',
    },
    manageUrl: 'https://www.hostinger.com/br/support/1583234-como-parar-a-renovacao-automatica-na-hostinger/',
    sources: [
      'https://www.hostinger.com/support/1583589-how-to-pay-for-hostinger-services-in-advance',
      'https://www.hostinger.com/support/how-to-manage-domain-auto-renewal-at-hostinger/',
      'https://www.hostinger.com/br/support/1583234-como-parar-a-renovacao-automatica-na-hostinger/',
    ],
  },

  // Produtividade, armazenamento e design
  {
    matchers: ['GOOGLE WORKSPACE', 'GOOGLE*WORKSPACE', 'GOOGLE *WORKSPACE'],
    name: 'Google Workspace',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'On the Flexible (monthly) plan you can cancel and pay only for the days used, but the Annual plan renews automatically for another year (with notices 30 and 3 days before) and canceling mid-term charges the rest of the contract; either way, paid access ends as soon as you cancel.',
      pt: 'No Flexível (mensal) dá para cancelar pagando só os dias usados, mas o Anual renova sozinho por mais um ano (com aviso 30 e 3 dias antes) e cancelar no meio cobra o saldo do contrato; em qualquer caso o acesso pago termina assim que você cancela.',
    },
    manageUrl: 'https://admin.google.com/ac/billing/subscriptions',
    sources: [
      'https://knowledge.workspace.google.com/admin/billing/cancel-google-workspace-for-gmail-accounts?hl=pt-BR',
      'https://knowledge.workspace.google.com/admin/billing/renew-your-annual-fixed-term-plan-contract?hl=pt-BR',
      'https://knowledge.workspace.google.com/admin/billing/understand-google-workspace-bills-and-charges?hl=pt-BR',
    ],
  },
  {
    // o código do plano com IA e o nome que o próprio Google diz que aparece na fatura
    matchers: ['GOOGLE ONE', 'G1AI', 'GOOGLE STORAGE'],
    name: 'Google One',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Charges at the start of each cycle (monthly or annual) until canceled, and this is how Google AI Pro and Ultra (Gemini) plans are billed; if you cancel, storage and benefits continue until the end of the period, usually with no refund, and if you subscribed through the App Store, cancel with Apple.',
      pt: 'Cobra no início de cada ciclo (mensal ou anual) até ser cancelado, e é por aqui que vêm os planos Google AI Pro e Ultra (Gemini); cancelando, o armazenamento e os benefícios seguem até o fim do período, em geral sem reembolso, e quem assinou pela App Store cancela na Apple.',
    },
    manageUrl: 'https://support.google.com/googleone/answer/9056360?hl=pt-BR',
    sources: [
      'https://one.google.com/terms-of-service?hl=pt-BR',
      'https://gemini.google/subscriptions/',
      'https://support.google.com/googlepay/answer/7644142?hl=pt-br',
    ],
  },
  {
    matchers: ['MICROSOFT 365', 'MICROSOFT*MICROSOFT 36'],
    name: 'Microsoft 365',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews monthly or yearly on the date shown at account.microsoft.com/services; if you turn off recurring billing, you can use it until expiration with no new charge, and if you subscribed through a phone app store or a reseller, cancel with them.',
      pt: 'Renova mensal ou anualmente na data mostrada em account.microsoft.com/services; desligando a cobrança recorrente, você usa até o vencimento sem nova cobrança, e se assinou pela loja do celular ou por revendedor, cancele com eles.',
    },
    manageUrl: 'https://account.microsoft.com/services/microsoft365',
    sources: [
      'https://support.microsoft.com/pt-br/accounts-billing/subscriptions/cancel-a-microsoft-365-subscription',
      'https://support.microsoft.com/pt-br/accounts-billing/subscriptions/turn-recurring-billing-on-or-off-for-a-microsoft-subscription',
      'https://merchants.letsweel.com/merchants/microsoft-365',
    ],
  },
  {
    matchers: ['DROPBOX'],
    name: 'Dropbox',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: "If you cancel, the account only goes back to Basic at the end of the current monthly or annual cycle, with no new charge; if the Cancel plan option doesn't appear, the subscription was made through the app and is canceled in the phone's app store.",
      pt: 'Cancelando, a conta só volta ao Basic no fim do ciclo mensal ou anual atual, sem nova cobrança; se a opção Cancelar plano não aparecer, a assinatura foi feita pelo app e se cancela na loja do celular.',
    },
    manageUrl: 'https://help.dropbox.com/pt-br/plans/downgrade-dropbox-individual-plans',
    sources: ['https://help.dropbox.com/pt-br/plans/downgrade-dropbox-individual-plans', 'https://help.dropbox.com/pt-br/billing/find-credit-card-charge'],
  },
  {
    matchers: ['NOTION'],
    name: 'Notion',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews automatically on the same day of the month or year of purchase; if you cancel under Settings > Billing, the plan continues until the end of the cycle, and a full refund only applies within 72 hours of subscribing monthly or 30 days of subscribing annually.',
      pt: 'Renova sozinho no mesmo dia do mês ou do ano da compra; cancelando em Configurações > Faturamento, o plano segue até o fim do ciclo, e o reembolso integral só vale até 72 horas após assinar o mensal ou 30 dias após assinar o anual.',
    },
    manageUrl: 'https://www.notion.com/pt/help/upgrade-or-downgrade-your-plan',
    sources: ['https://www.notion.com/pt/help/upgrade-or-downgrade-your-plan', 'https://www.notion.com/pt/help/billing'],
  },
  {
    matchers: ['FIGMA'],
    name: 'Figma',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Canceling Professional (Admin > Settings > Plan) takes effect at the end of the period, with no refund; on the annual plan a notice appears in the dashboard 30 days before renewal, and Organization and Enterprise can only be canceled through support.',
      pt: 'Cancelar o Professional (Admin > Configurações > Plano) vale no fim do período, sem reembolso; no anual um aviso aparece no painel 30 dias antes da renovação, e Organization e Enterprise só se cancelam pelo suporte.',
    },
    manageUrl: 'https://help.figma.com/hc/pt-br/articles/360046216313-Upgrade-or-downgrade-your-plan',
    sources: [
      'https://help.figma.com/hc/pt-br/articles/360046216313-Upgrade-or-downgrade-your-plan',
      'https://help.figma.com/hc/pt-br/articles/360041061034-Manage-billing-on-the-Professional-plan',
      'https://merchants.letsweel.com/merchants/figma',
    ],
  },
  {
    matchers: ['CANVA'],
    name: 'Canva',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'If you cancel under Settings > Billing & plans, Pro continues until the end of the paid period and then the account goes back to free; if you subscribed through the iPhone app, Apple bills you and you cancel in the App Store.',
      pt: 'Cancelando em Configurações > Faturamento e planos, o Pro segue até o fim do período pago e depois a conta volta ao gratuito; quem assinou pelo app do iPhone é cobrado pela Apple e cancela pela App Store.',
    },
    sources: ['https://apps.apple.com/br/app/canva-ia-editor-de-fotos-v%C3%ADdeo/id897446215', 'https://shotkit.com/cancel-canva-subscription/'],
    domains: ['canva.com'],
  },
  {
    matchers: ['ADOBE'],
    name: 'Adobe',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'In Brazil, the annual plan paid monthly renews automatically every year and, after 14 days from purchase, canceling midway costs 20% of the rest of the contract, so the best time to leave is near the end of the contract, before renewal; the monthly plan, canceled after 14 days, has no fee and continues until the end of the paid month.',
      pt: 'No Brasil, o anual pago mensalmente renova sozinho todo ano e, passados 14 dias da compra, cancelar no meio cobra 20% do restante do contrato, então o melhor momento para sair é perto do fim do contrato, antes da renovação; o mensal, cancelado depois de 14 dias, não tem multa e segue até o fim do mês pago.',
    },
    manageUrl: 'https://account.adobe.com/plans',
    sources: ['https://www.adobe.com/br/legal/subscription-terms.html'],
  },
  {
    // "ZOOM" sozinho casaria com outras lojas
    matchers: ['ZOOM.US', 'ZOOM.COM', 'ZOOM VIDEO'],
    name: 'Zoom',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews automatically at the end of each cycle unless canceled before; the plan continues until the end of the period, with no refund, add-ons must be canceled before the main plan, and a subscription made through a phone app store is canceled there.',
      pt: 'Renova sozinho ao fim de cada ciclo se não for cancelado antes; o plano segue até o fim do período, sem reembolso, os complementos precisam ser cancelados antes do plano principal, e assinatura feita pela loja do celular se cancela lá.',
    },
    manageUrl: 'https://zoom.us/billing',
    sources: [
      'https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0066687',
      'https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0083524',
      'https://merchants.letsweel.com/merchants/zoom',
    ],
  },
  {
    matchers: ['LINKEDIN', 'LNKD.IN'],
    name: 'LinkedIn',
    isSubscription: 'maybe',
    cycles: ['monthly', 'quarterly', 'annual'],
    note: {
      en: 'Premium renews automatically at the end of each cycle; cancel at least one day before the charge (the plan continues until the end of the period), and if you subscribed through the App Store, cancel on the device; ads and job posts also show as LinkedIn and are billed separately.',
      pt: 'O Premium renova sozinho ao fim de cada ciclo; cancele pelo menos um dia antes da cobrança (o plano segue até o fim do período), e quem assinou pela App Store cancela no aparelho; anúncios e vagas também saem como LinkedIn e são cobrados à parte.',
    },
    manageUrl: 'https://www.linkedin.com/help/linkedin/answer/a546649/cancelar-assinatura-premium-do-linkedin?lang=pt',
    sources: [
      'https://www.linkedin.com/help/linkedin/answer/a546649/cancelar-assinatura-premium-do-linkedin?lang=pt',
      'https://www.linkedin.com/help/linkedin/answer/a564061/perguntas-frequentes-sobre-contas-premium?lang=pt',
      'https://merchants.letsweel.com/merchants/linkedin',
    ],
  },
  {
    matchers: ['SLACK'],
    name: 'Slack',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Paid plans are monthly or annual, and when you downgrade to free (Admin > Manage billing) you choose whether the change applies right away or only at the next renewal.',
      pt: 'Os planos pagos são mensais ou anuais, e no downgrade para o gratuito (Administrador > Gerenciar faturamento) você escolhe se a mudança vale na hora ou só na próxima renovação.',
    },
    manageUrl: 'https://slack.com/intl/pt-br/help/articles/48764458651795',
    sources: [
      'https://slack.com/intl/pt-br/help/articles/48764458651795',
      'https://slack.com/intl/pt-br/help/articles/218915087',
      'https://merchants.letsweel.com/merchants/slack',
    ],
  },

  // Delivery, clubes e tags de pedágio
  {
    // pedido comum do iFood também sai como "IFOOD"/"IFD*": só os textos do clube
    matchers: ['IFOOD CLUBE', 'IFOODCLUBE', 'CLUBE IFOOD', 'IFOOD*CLUBE', 'IFD*CLUBE'],
    name: 'iFood Clube',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'The monthly plan renews automatically on the card (one-off 30-day packages do not renew); if you cancel under Perfil > Clube iFood > Gerenciar assinatura, there is no new charge and benefits continue until the end of the paid period.',
      pt: 'O plano mensal renova sozinho no cartão (os pacotes avulsos de 30 dias não renovam); cancelando em Perfil > Clube iFood > Gerenciar assinatura, não há nova cobrança e os benefícios seguem até o fim do período pago.',
    },
    manageUrl: 'https://institucional.ifood.com.br/ajuda/o-clube-ifood/',
    sources: ['https://institucional.ifood.com.br/ajuda/o-clube-ifood/'],
  },
  {
    matchers: ['UBER ONE', 'UBERONE', 'UBER *ONE'],
    name: 'Uber One',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews automatically at the start of each cycle; turn off renewal in the Uber One section of the app at least 24 hours before the charge and benefits continue until the end of the cycle (the monthly fee is not refunded; the annual plan may get a prorated refund).',
      pt: 'Renova sozinho no início de cada ciclo; desligue a renovação na seção Uber One do app pelo menos 24 horas antes da cobrança e os benefícios seguem até o fim do ciclo (a mensalidade não é reembolsada; o anual pode ter reembolso proporcional).',
    },
    sources: [
      'https://www.uber.com/br/pt-br/uber-one/',
      'https://www.uber.com/legal/en/document/?name=renewable-passes-terms&country=brazil&lang=pt-br',
      'https://www.uber.com/br/pt-br/uber-one/student/',
    ],
    domains: ['uber.com'],
  },
  {
    matchers: ['RAPPI PRO', 'RAPPIPRO', 'RAPPI PRIME', 'RAPPIPRIME'],
    name: 'Rappi Pro',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'Monthly fee on the credit card; to cancel, open Rappi Pro in the app, check the Próxima Carga (next charge) date and tap Precisa de ajuda? > Cancelar sua assinatura before it.',
      pt: 'Mensalidade no cartão de crédito; para cancelar, abra o Rappi Pro no app, confira a data da Próxima Carga e toque em Precisa de ajuda? > Cancelar sua assinatura antes dela.',
    },
    sources: [
      'https://passageirodeprimeira.com/nubank-ultravioleta-encerra-parceria-com-o-rappi',
      'https://mercadoeconsumo.com.br/04/03/2024/destaque-do-dia/rappi-foca-em-economia-de-recorrencia-e-lanca-duas-versoes-de-seu-programa-de-assinaturas/',
    ],
    domains: ['rappi.com.br'],
  },
  {
    // "MERCADO LIVRE" sozinho é compra avulsa
    matchers: ['MELI+', 'MELI PLUS', 'MELIPLUS', 'MELI MAIS', 'MELIMAIS'],
    name: 'Meli+',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'Monthly charge with automatic renewal, including when the free trial ends; you can cancel at any time, at no cost, in the Mercado Livre app or website, as long as it is before the next charge.',
      pt: 'Cobrança mensal com renovação automática, inclusive ao fim do teste grátis; dá para cancelar a qualquer momento, sem custo, pelo app ou site do Mercado Livre, desde que antes da próxima cobrança.',
    },
    sources: [
      'https://plusdin.com.br/meli-mercado-livre/',
      'https://macmagazine.com.br/post/2024/09/03/mercado-livre-abandona-programa-de-pontos-e-anuncia-dois-planos-meli/',
    ],
    domains: ['mercadolivre.com.br'],
  },
  {
    matchers: ['SEM PARAR', 'SEMPARAR'],
    name: 'Sem Parar',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    note: {
      en: "Plans with a monthly fee charge every month and Flex only in months of use, but the same descriptor also carries tolls and parking; there is no minimum term, but canceling requires 30 days' notice, which is charged.",
      pt: 'Os planos com mensalidade cobram todo mês e o Flex só nos meses de uso, mas o mesmo descritor traz pedágios e estacionamentos; não há fidelidade, porém o cancelamento exige aviso prévio de 30 dias, que são cobrados.',
    },
    manageUrl: 'https://ajuda.semparar.com.br/hc/pt-br',
    sources: [
      'https://www.semparar.com.br/',
      'https://www.semparar.com.br/on/demandware.static/-/Sites-SemParar-Library/default/dw94a18299/documents/202505%2014_Termos%20e%20Condi%C3%A7%C3%B5es_Revis%C3%A3o%20SaaS.pdf',
    ],
  },
  {
    matchers: ['CONECTCAR', 'CONECT CAR'],
    name: 'ConectCar',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    note: {
      en: "On Plano Completo the monthly fee is due every month on the sign-up day, and toll and parking top-ups go on the same card; canceling requires 30 days' notice and paying off any balance.",
      pt: 'No Plano Completo a mensalidade vence todo mês no dia da adesão e as recargas de pedágio e estacionamento caem no mesmo cartão; o cancelamento exige aviso prévio de 30 dias e quitação dos débitos.',
    },
    manageUrl: 'https://atendimentoconectcar.zendesk.com/hc/pt-br',
    sources: ['https://www.conectcar.com/', 'https://conectcar.com/wp-content/uploads/2026/07/Termo-de-Adesao-Unico_versao30_2026.06.29_vf.pdf'],
    domains: ['conectcar.com'],
  },

  // Academia e bem-estar
  {
    matchers: ['SMART FIT', 'SMARTFIT'],
    name: 'Smart Fit',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: "Monthly billing; on plans with a 12-month commitment, canceling early costs 20% of the remaining amount, and on all plans canceling takes a signed request at a gym location, with 30 days' notice that may be charged.",
      pt: 'Cobrança mensal; nos planos com fidelidade de 12 meses, cancelar antes custa 20% do valor restante, e em todos o cancelamento é por requerimento assinado numa unidade, com aviso prévio de 30 dias que pode ser cobrado.',
    },
    manageUrl: 'https://www.smartfit.com.br/planos',
    sources: ['https://www.smartfit.com.br/planos'],
  },
  {
    matchers: ['WELLHUB', 'GYMPASS'],
    name: 'Wellhub',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'Renews automatically for the same period, on the card or through payroll if it comes through your employer; cancel on the platform at least 3 business days before the charge: the plan continues until then, with no refund.',
      pt: 'Renova sozinho pelo mesmo período, no cartão ou em folha se for via empresa; cancele pela plataforma pelo menos 3 dias úteis antes da cobrança: o plano segue até ela, sem reembolso.',
    },
    sources: ['https://wellhub.com/pt-br/terms/'],
    domains: ['wellhub.com'],
  },
  {
    matchers: ['TOTALPASS', 'TOTAL PASS'],
    name: 'TotalPass',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'Cycles of 28 to 31 days renew automatically even without use; you can cancel at any time in the app and use it until the end of the cycle, with no refund of what was already paid.',
      pt: 'Ciclos de 28 a 31 dias renovam sozinhos mesmo sem uso; dá para cancelar a qualquer momento pelo app e usar até o fim do ciclo, sem reembolso do que já foi pago.',
    },
    sources: ['https://totalpass.com/br/terms'],
    domains: ['totalpass.com'],
  },

  // Educação
  {
    matchers: ['DUOLINGO'],
    name: 'Duolingo',
    isSubscription: 'yes',
    cycles: ['annual', 'unknown'],
    note: {
      en: 'Renews automatically; if you subscribed through the iPhone app, Apple bills you and you must turn off renewal in the App Store settings at least 24 hours before the end of the period.',
      pt: 'Renova sozinho; quem assinou pelo app do iPhone é cobrado pela Apple e precisa desligar a renovação nos ajustes da App Store pelo menos 24 horas antes do fim do período.',
    },
    sources: [
      'https://apps.apple.com/br/app/duolingo-idiomas-e-xadrez/id570060128',
      'https://olhardigital.com.br/2025/05/14/dicas-e-tutoriais/super-duolingo-veja-o-que-e-quais-os-beneficios-e-como-funciona-a-assinatura/',
    ],
    domains: ['duolingo.com'],
  },
  {
    matchers: ['ALURA'],
    name: 'Alura',
    isSubscription: 'yes',
    cycles: ['annual'],
    note: {
      en: 'Plans paid by card renew automatically every 12 months; turn off auto-renewal in your account area before the date, because after the 7-day withdrawal period there is no refund, not even prorated.',
      pt: 'Planos pagos com cartão renovam sozinhos a cada 12 meses; desative a renovação automática na área logada antes da data, porque depois dos 7 dias de arrependimento não há reembolso, nem proporcional.',
    },
    sources: ['https://www.alura.com.br/termos-de-uso'],
    domains: ['alura.com.br'],
  },
  {
    matchers: ['UDEMY'],
    name: 'Udemy',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    note: {
      en: 'Individual courses are one-time purchases, but Personal Plan is a subscription: cancel under Account settings > Subscriptions on the website, or with Apple if you subscribed through the iPhone app.',
      pt: 'Cursos avulsos são compra única, mas o Personal Plan é assinatura: cancele em Configurações da conta > Assinaturas no site, ou na Apple se assinou pelo app do iPhone.',
    },
    sources: ['https://apps.apple.com/br/app/udemy-cursos-online/id562413829', 'https://subger.com/en/cancel/udemy'],
    domains: ['udemy.com'],
  },
  {
    matchers: ['COURSERA'],
    name: 'Coursera',
    isSubscription: 'maybe',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Coursera Plus renews automatically for the same period; if you cancel in My Purchases, access continues until the end of the period, only the annual plan has a refund within 14 days (renewals do not), and individual courses and certificates are one-time payments.',
      pt: 'O Coursera Plus renova sozinho pelo mesmo período; cancelando em My Purchases, o acesso segue até o fim do período, só o anual tem reembolso em até 14 dias (renovações não), e cursos e certificados avulsos são pagamento único.',
    },
    manageUrl: 'https://www.coursera.org/my-purchases',
    sources: ['https://www.coursera.org/about/terms'],
  },

  // Social, criadores e finanças
  {
    // Nitro primeiro; o resto do Discord mistura assinatura e loja
    matchers: ['DISCORD*NITRO', 'DISCORD* NITRO', 'DISCORD NITRO'],
    name: 'Discord',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Nitro and Nitro Basic renew automatically every month or year until canceled under Settings > Subscriptions; access continues until the end of the period, with no prorated refund, and if you subscribed through the phone app, cancel in the store.',
      pt: 'Nitro e Nitro Basic renovam sozinhos a cada mês ou ano até serem cancelados em Configurações > Assinaturas; o acesso segue até o fim do período, sem reembolso proporcional, e quem assinou pelo app do celular cancela na loja.',
    },
    manageUrl: 'https://discord.com/terms/paid-services-terms',
    sources: ['https://discord.com/terms/paid-services-terms', 'https://emma-app.com/who-charged-me/discord-nitro'],
  },
  {
    matchers: ['DISCORD'],
    name: 'Discord',
    isSubscription: 'maybe',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Besides Nitro, Discord charges for Server Boosts, which also renew automatically, and one-off items; subscriptions are canceled under Settings > Subscriptions and last until the end of the period.',
      pt: 'Além do Nitro, o Discord cobra Server Boosts, que também renovam sozinhos, e itens avulsos; as assinaturas se cancelam em Configurações > Assinaturas e valem até o fim do período.',
    },
    manageUrl: 'https://discord.com/terms/paid-services-terms',
    sources: ['https://discord.com/terms/paid-services-terms'],
  },
  {
    // "X" sozinho casaria com qualquer coisa
    matchers: ['X CORP. PAID', 'X CORP PAID', 'TWITTER'],
    name: 'X (Twitter)',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'X Premium renews automatically until canceled where you subscribed (x.com/settings/subscription on the web, or in the phone app store), at least 24 hours in advance; the annual plan is charged all at once when you sign up.',
      pt: 'O X Premium renova sozinho até ser cancelado onde foi assinado (x.com/settings/subscription na web, ou na loja do celular), com pelo menos 24 horas de antecedência; o anual é cobrado de uma vez na adesão.',
    },
    manageUrl: 'https://x.com/settings/subscription',
    sources: ['https://halocard.co/merchants/x-premium'],
    domains: ['twitter.com'],
  },
  {
    matchers: ['PATREON'],
    name: 'Patreon',
    isSubscription: 'maybe',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Each creator is billed separately and renews automatically: on the new model the charge falls on the same day you joined, members on older models pay on the 1st, and canceling at patreon.com/settings/memberships only prevents the next charge, with no refund.',
      pt: 'Cada criador é cobrado à parte e renova sozinho: no modelo novo o débito cai no mesmo dia da adesão, membros de modelos antigos pagam no dia 1º, e cancelar em patreon.com/settings/memberships só evita a próxima cobrança, sem reembolso.',
    },
    manageUrl: 'https://www.patreon.com/settings/memberships',
    sources: ['https://www.patreon.com/policy/legal', 'https://news.patreon.com/articles/introducing-a-new-patron-billing-option'],
  },
  {
    matchers: ['TWITCH'],
    name: 'Twitch',
    isSubscription: 'maybe',
    cycles: ['monthly', 'quarterly', 'semiannual'],
    note: {
      en: "Channel subscriptions renew automatically on the same day every 1, 3 or 6 months and each channel is canceled separately with Don't renew, with benefits until the end; Bits and gift subscriptions are one-off, and subscriptions made in the iPhone app are billed by Apple.",
      pt: 'Inscrições em canais renovam sozinhas no mesmo dia a cada 1, 3 ou 6 meses e cada canal se cancela à parte em Não renovar, com benefícios até o fim; Bits e inscrições de presente são avulsos, e inscrições feitas no app do iPhone são cobradas pela Apple.',
    },
    manageUrl: 'https://www.twitch.tv/subscriptions',
    sources: [
      'https://www.streamscheme.com/?p=8701',
      'https://subger.com/en/cancel/twitch',
      'https://blog.twitch.tv/en/2021/11/11/available-now-monthly-recurring-subs-on-ios',
    ],
  },
  {
    matchers: ['TRADINGVIEW'],
    name: 'TradingView',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Monthly and annual plans renew automatically; cancel under Settings and billing > Subscriptions at least 24 hours before the charge and access continues until the end of the period, and on the annual plan a refund can only be requested up to 14 days after renewal.',
      pt: 'Planos mensais e anuais renovam sozinhos; cancele em Configurações e cobrança > Assinaturas pelo menos 24 horas antes da cobrança e o acesso segue até o fim do período, e no anual o reembolso só pode ser pedido até 14 dias após a renovação.',
    },
    manageUrl: 'https://www.tradingview.com/support/solutions/43000471719/',
    sources: [
      'https://www.tradingview.com/support/solutions/43000471719/',
      'https://www.tradingview.com/support/solutions/43000471716/',
      'https://www.tradingview.com/pricing/',
    ],
  },

  // Notícias
  {
    matchers: ['FOLHADESPAULO', 'FOLHA DE S PAULO', 'FOLHA DE S.PAULO', 'FOLHA DE SAO PAULO', 'FOLHA DA MANHA'],
    name: 'Folha de S.Paulo',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'The annual plan renews automatically on its anniversary and may be charged month by month or in 12 card installments, the promotional price may go up mid-term, and canceling is by phone or through the Atendimento ao Assinante (subscriber service) chat.',
      pt: 'O anual renova sozinho no aniversário e pode vir mês a mês ou em 12 parcelas no cartão, o preço promocional pode subir no meio da vigência, e o cancelamento é por telefone ou pelo chat do Atendimento ao Assinante.',
    },
    manageUrl: 'https://www.folha.com.br/atendimento',
    // os sites dos jornais bloquearam a leitura (403); a informação veio de recibos públicos sem link estável aqui
    sources: [],
  },
  {
    // "ESTADO DE SAO PAULO" casaria com cobranças do governo (IPVA)
    matchers: ['ESTADAO', 'ESTADÃO'],
    name: 'Estadão',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'The digital subscription is charged to the card on the sign-up date and then every month, with price changes after notice; you can ask to cancel at any time through the Portal do Assinante (subscriber portal) or customer service, keeping the protocol number.',
      pt: 'A assinatura digital é debitada no cartão na data da contratação e depois todo mês, com reajuste mediante aviso; o cancelamento pode ser pedido a qualquer momento pelo Portal do Assinante ou pela central de atendimento, guardando o protocolo.',
    },
    sources: [],
    domains: ['estadao.com.br'],
  },
  {
    matchers: ['OGLOBO', 'O GLOBO DIGITAL', 'JORNAL O GLOBO', 'INFOGLOBO'],
    name: 'O Globo',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'The digital subscription renews automatically every month, and if you subscribed through the iPhone app, Apple bills you and you must turn off renewal in the App Store up to 24 hours before the end of the period.',
      pt: 'A assinatura digital renova sozinha todo mês, e quem assinou pelo app do iPhone é cobrado pela Apple e precisa desligar a renovação na App Store até 24 horas antes do fim do período.',
    },
    sources: ['https://apps.apple.com/BR/app/id390832733'],
    domains: ['globo.com'],
  },
  {
    matchers: ['VALOR ECONOMICO', 'VALORECONOMICO', 'VALOR ECONÔMICO'],
    name: 'Valor Econômico',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'The digital subscription is monthly and renews automatically, the promotional offer lasts the first 3 months and then the full price applies, and if you subscribed through the iPhone app, turn off renewal in the App Store up to 24 hours before the end of the period.',
      pt: 'A assinatura digital é mensal e renova sozinha, a oferta promocional dura os 3 primeiros meses e depois vem o preço cheio, e quem assinou pelo app do iPhone desliga a renovação na App Store até 24 horas antes do fim do período.',
    },
    sources: ['https://apps.apple.com/BR/app/id566450663'],
    domains: ['globo.com'],
  },
  {
    matchers: ['NEW YORK TIMES', 'NEWYORKTIM', 'NYTIMES', 'NYTDIGITAL'],
    name: 'The New York Times',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'The digital subscription is charged every 4 weeks (13 times a year, so the day shifts) and the introductory price goes up to the regular price when the promotion ends; if you cancel online in your account, access continues until the end of the cycle, with no refund.',
      pt: 'A assinatura digital é cobrada a cada 4 semanas (13 vezes por ano, então o dia muda) e o preço introdutório passa ao normal quando a promoção acaba; cancelando online pela conta, o acesso segue até o fim do ciclo, sem reembolso.',
    },
    manageUrl: 'https://myaccount.nytimes.com/seg/subscription',
    sources: ['https://recurdash.com/guides/how-to-cancel-new-york-times', 'https://emma-app.com/who-charged-me/new-york-times'],
  },
  {
    matchers: ['THE ECONOMIST', 'THEECONOMIST', 'ECONOMIST SUBSCRIP', 'ECONOMIST NEWSPAP'],
    name: 'The Economist',
    isSubscription: 'yes',
    cycles: ['monthly', 'quarterly', 'annual'],
    note: {
      en: 'Monthly, quarterly and annual plans keep charging until canceled, which is done in My Account on the website (or through chat, with retention offers along the way), and access continues until the end of the paid period.',
      pt: 'Planos mensais, trimestrais e anuais seguem cobrando até o cancelamento, feito em My Account no site (ou pelo chat, com ofertas de retenção no caminho), e o acesso continua até o fim do período pago.',
    },
    sources: [
      'https://apps.apple.com/br/app/id1239397626',
      'https://subger.com/en/cancel/economist',
      'https://emma-app.com/who-charged-me/the-economist',
    ],
    domains: ['economist.com'],
  },

  // Segurança e VPN
  {
    matchers: ['KASPERSKY'],
    name: 'Kaspersky',
    isSubscription: 'yes',
    cycles: ['annual'],
    note: {
      en: 'Auto-renewal is on by default and charges the card a few days before expiration, with an email notice 1 to 2 weeks before; turn it off in My Kaspersky > Subscriptions or in the store that processed the purchase, and refunds usually apply for 30 days after payment.',
      pt: 'A renovação automática vem ligada por padrão e cobra o cartão alguns dias antes do vencimento, com aviso por e-mail 1 a 2 semanas antes; desligue em My Kaspersky > Assinaturas ou na loja que processou a compra, e o reembolso costuma valer por 30 dias após o pagamento.',
    },
    manageUrl: 'https://support.kaspersky.com.br/kaspersky-for-windows/21.18/230187',
    sources: ['https://support.kaspersky.com/12473', 'https://support.kaspersky.com.br/15346', 'https://www.kaspersky.com.br/renewal-center/home'],
    domains: ['kaspersky.com'],
  },
  {
    matchers: ['NORTON *AP', 'NORTON'],
    name: 'Norton',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'Renews automatically every year (or month, on the monthly plan) with an email notice beforehand; turn it off under My Subscriptions at my.norton.com, and the annual renewal has a full refund if requested within 60 days.',
      pt: 'Renova sozinho a cada ano (ou mês, no plano mensal) com aviso por e-mail antes; desligue em Minhas assinaturas no my.norton.com, e a renovação anual tem reembolso integral se pedido em até 60 dias.',
    },
    manageUrl: 'https://my.norton.com/extspa/account/subscriptions',
    sources: [
      'https://support.norton.com/sp/pt/br/home/current/solutions/kb20100113164023EN',
      'https://support.norton.com/sp/pt/br/home/current/solutions/v58152595',
      'https://support.norton.com/sp/pt/br/home/current/solutions/v121052649',
    ],
  },
  {
    matchers: ['MCAFEE'],
    name: 'McAfee',
    isSubscription: 'yes',
    cycles: ['unknown'],
    note: {
      en: 'The subscription lasts for a set period and may have auto-renewal turned on in the McAfee account; check there, before expiration, whether renewal is on.',
      pt: 'A assinatura vale por um período determinado e pode estar com renovação automática ligada na conta McAfee; confira lá, antes do vencimento, se a renovação está ativa.',
    },
    sources: [
      'https://download.mcafee.com/products/webhelp/5/1046/GUID-2A1A04B3-0457-4BC5-AB4B-804D9DF7A259.html',
      'https://download.mcafee.com/products/webhelp/5/1046/GUID-0F7B3FD7-5FB7-41E6-82C4-57D49C270E21.html',
    ],
    domains: ['mcafee.com'],
  },
  {
    matchers: ['NORDVPN', 'NORD VPN'],
    name: 'NordVPN',
    isSubscription: 'yes',
    cycles: ['monthly', 'annual'],
    note: {
      en: 'The 1-month, 1-year and 2-year plans are paid upfront and renew automatically at the current renewal price; the 30-day guarantee only applies to the first purchase, so turn off renewal in the Billing tab of Nord Account before the date.',
      pt: 'Os planos de 1 mês, 1 ano e 2 anos são pagos adiantado e renovam sozinhos pelo preço de renovação vigente; a garantia de 30 dias vale só para a primeira compra, então desligue a renovação na aba Billing da Nord Account antes da data.',
    },
    manageUrl: 'https://support.nordvpn.com/hc/en-us/articles/19556844985489-How-to-cancel-auto-renewal-for-your-NordVPN-subscription',
    sources: [
      'https://support.nordvpn.com/hc/en-us/articles/19744251757841-How-to-check-the-plans-and-prices-of-NordVPN',
      'https://support.nordvpn.com/hc/en-us/articles/19477173269265-How-much-will-I-need-to-pay-upon-renewal',
      'https://support.nordvpn.com/hc/en-us/articles/19476991311121-What-is-your-refund-policy',
    ],
  },

  // Games
  {
    matchers: ['PLAYSTATION'],
    name: 'PlayStation',
    isSubscription: 'maybe',
    cycles: ['monthly', 'quarterly', 'annual'],
    note: {
      en: 'PS Plus renews automatically until canceled and only the first payment can be refunded within 14 days, so cancel under Account Management > Subscription before the next date; the PS Store also sells one-off games.',
      pt: 'O PS Plus renova sozinho até ser cancelado e só o primeiro pagamento tem reembolso em até 14 dias, então cancele em Gerenciamento da conta > Assinatura antes da próxima data; a PS Store também vende jogos avulsos.',
    },
    manageUrl: 'https://www.playstation.com/pt-br/support/subscriptions/cancel-playstation-plus/',
    sources: [
      'https://www.playstation.com/pt-br/ps-plus/',
      'https://www.playstation.com/pt-br/support/store/ps-store-refund-request/',
      'https://www.playstation.com/pt-br/support/store/cancel-ps-store-subscription/',
    ],
  },
  {
    matchers: ['XBOX'],
    name: 'Xbox',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    note: {
      en: 'Game Pass has recurring billing on by default and renews until canceled at account.microsoft.com/services; if the renewal already went through, canceling within 30 days refunds the last charge (once per account and product).',
      pt: 'O Game Pass vem com cobrança recorrente ligada por padrão e renova até ser cancelado em account.microsoft.com/services; se a renovação já caiu, cancelar em até 30 dias dá reembolso da última cobrança (uma vez por conta e produto).',
    },
    manageUrl: 'https://account.microsoft.com/services',
    sources: ['https://www.xbox.com/pt-BR/xbox-game-pass', 'https://support.microsoft.com/help/4522164/microsoft-account-how-to-cancel-your-subscription'],
    domains: ['xbox.com'],
  },
  {
    matchers: ['NINTENDO'],
    name: 'Nintendo',
    isSubscription: 'maybe',
    cycles: ['monthly', 'quarterly', 'annual'],
    note: {
      en: 'Nintendo Switch Online renews automatically at the end of the period, and you must turn off renewal at least 48 hours before, in the eShop or at accounts.nintendo.com, with no refund for the remaining time; the eShop also sells one-off games.',
      pt: 'O Nintendo Switch Online renova sozinho ao fim do período, e é preciso desligar a renovação pelo menos 48 horas antes, no eShop ou em accounts.nintendo.com, sem reembolso do tempo restante; o eShop também vende jogos avulsos.',
    },
    manageUrl: 'https://en-americas-support.nintendo.com/app/answers/detail/a_id/41196',
    sources: [
      'https://en-americas-support.nintendo.com/app/answers/detail/a_id/41194',
      'https://www.nintendo.com/us/switch/online/',
      'https://en-americas-support.nintendo.com/app/answers/detail/a_id/41196',
    ],
  },
  {
    matchers: ['STEAMGAMES', 'STEAM GAMES', 'STEAMPOWERED', 'STEAM PURCHASE'],
    name: 'Steam',
    isSubscription: 'maybe',
    cycles: ['unknown'],
    note: {
      en: "Almost everything is a one-off purchase, but some games' subscriptions charge automatically every cycle and can only be refunded within 48 hours after renewal if unused; check and cancel under Subscriptions in your account details.",
      pt: 'Quase tudo é compra avulsa, mas assinaturas de alguns jogos cobram sozinhas a cada ciclo e só têm reembolso até 48 horas após a renovação se não foram usadas; confira e cancele em Assinaturas, nos detalhes da conta.',
    },
    manageUrl: 'https://checkout.steampowered.com/recurringsubscription/subscriptions/',
    sources: ['https://store.steampowered.com/steam_refunds/?l=brazilian', 'https://store.steampowered.com/subscriber_agreement/?l=brazilian'],
  },

  // Celular
  {
    // planos de operadora (pré-pago, controle, pós): só os textos de plano; a recarga avulsa ("RECARGA", "TOP UP")
    // fica fora pela regra de recarga, e cada operadora fica com o próprio nome ("Vivo · Easy")
    matchers: [
      'VIVO EASY', 'VIVO CONTROLE', 'VIVO POS', 'CLARO CONTROLE', 'CLARO FLEX', 'CLARO PRE', 'TIM CONTROLE', 'TIM PRE', 'TIM BLACK',
      'T-MOBILE', 'TMOBILE', 'METRO BY T', 'MINT MOBILE', 'CRICKET WIRELESS', 'VERIZON WIRELESS', 'AT&T MOBILITY', 'GOOGLE FI',
      'VODAFONE', 'GIFFGAFF', 'LEBARA', 'LYCAMOBILE',
    ],
    name: 'Mobile carrier plan',
    isSubscription: 'maybe',
    cycles: ['monthly'],
    generic: true,
    note: {
      en: 'Carrier plans (prepaid, capped or postpaid) charge every month on the plan date, often next to one-off top-ups and other purchases from the same carrier; to stop, cancel the plan or turn off automatic renewal in the carrier app or website.',
      pt: 'Planos de operadora (pré-pago, controle ou pós) cobram todo mês na data do plano, muitas vezes ao lado de recargas avulsas e outras compras da mesma operadora; para parar, cancele o plano ou desligue a renovação automática no app ou no site da operadora.',
    },
    sources: ['https://www.vivo.com.br/', 'https://www.claro.com.br/', 'https://www.tim.com.br/', 'https://www.t-mobile.com/'],
  },

  // Lojas de app e descritores genéricos: vendem avulso e assinatura com o mesmo texto, então ficam por último
  {
    matchers: ['ICLOUD'],
    name: 'iCloud+',
    isSubscription: 'yes',
    cycles: ['monthly'],
    note: {
      en: 'Charged every month through your Apple Account (it almost always shows as APPLE.COM/BILL); to cancel or switch to a smaller plan, go to Settings > [your name] > Subscriptions > iCloud+, and the change takes effect when the current period ends.',
      pt: 'Cobrado todo mês pela Conta Apple (quase sempre aparece como APPLE.COM/BILL); para cancelar ou trocar por um plano menor, vá em Ajustes > [seu nome] > Assinaturas > iCloud+, e a mudança vale quando termina o período atual.',
    },
    manageUrl: 'https://support.apple.com/pt-br/108318',
    sources: ['https://support.apple.com/pt-br/108047', 'https://support.apple.com/pt-br/108318'],
  },
  {
    matchers: ['APPLE.COM/BILL', 'ITUNES.COM'],
    name: 'Apple',
    isSubscription: 'maybe',
    cycles: ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual'],
    note: {
      en: 'App Store, in-app purchases and subscription renewals (Apple Music, iCloud+, Apple One and third-party apps) all show together as APPLE.COM/BILL; see what was charged at reportaproblem.apple.com and cancel under Settings > [your name] > Subscriptions before renewal.',
      pt: 'App Store, compras dentro de apps e renovações de assinaturas (Apple Music, iCloud+, Apple One e apps de terceiros) aparecem juntas como APPLE.COM/BILL; veja o que foi cobrado em reportaproblem.apple.com e cancele em Ajustes > [seu nome] > Assinaturas antes da renovação.',
    },
    manageUrl: 'https://support.apple.com/pt-br/118428',
    sources: [
      'https://support.apple.com/pt-br/HT201382',
      'https://support.apple.com/pt-br/118428',
      'https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/auto-renewable-subscription-information',
    ],
  },
  {
    matchers: ['GOOGLE PLAY', 'GOOGLE *PLAY', 'GOOGLE*PLAY'],
    name: 'Google Play',
    isSubscription: 'maybe',
    cycles: ['weekly', 'monthly', 'quarterly', 'semiannual', 'annual'],
    note: {
      en: "App purchases and subscriptions through Google Play (which also show as GOOGLE *developer name) are canceled at play.google.com/store/account/subscriptions, with access until the end of the period; uninstalling the app doesn't cancel, and in Brazil a pre-authorization may appear up to 5 days before renewal.",
      pt: 'Compras e assinaturas de apps pelo Google Play (que também aparecem como GOOGLE *nome do desenvolvedor) se cancelam em play.google.com/store/account/subscriptions, com acesso até o fim do período; desinstalar o app não cancela, e no Brasil pode aparecer uma pré-autorização até 5 dias antes da renovação.',
    },
    manageUrl: 'https://play.google.com/store/account/subscriptions',
    sources: [
      'https://support.google.com/googleplay/answer/7018481?hl=pt-BR',
      'https://support.google.com/googlepay/answer/7644142?hl=pt-br',
      'https://support.google.com/googleplay/android-developer/answer/140504?hl=pt-br',
    ],
  },
  {
    // prefixo de cobrança do Google; os itens acima já pegam os produtos com nome próprio
    matchers: ['DL*GOOGLE', 'DL *GOOGLE'],
    name: 'Google',
    isSubscription: 'maybe',
    cycles: ['unknown'],
    note: {
      en: "Google uses this prefix for charges from several products, followed by the product name, which may be cut off; when it doesn't say which one, compare the amount and day of the month with YouTube, Google One and Google Play on the same account.",
      pt: 'O Google usa este prefixo para cobranças de vários produtos, seguido do nome do produto, que pode vir cortado; quando não diz qual é, compare valor e dia do mês com o YouTube, o Google One e o Google Play da mesma conta.',
    },
    sources: ['https://support.google.com/googlepay/answer/7644142?hl=pt-br'],
    domains: ['google.com'],
  },
];
