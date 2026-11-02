// Taxas públicas de cashback do cartão ether.fi Cash por nível de membership, copiadas da central de ajuda da
// ether.fi com o dia em que foram conferidas. Nada disto vem do conector: ele não informa o nível da pessoa nem o
// cashback de cada compra (numa conta real só chega o resgate, cashback_claim, em US$ e com token ETHFI). O cashback
// é calculado em US$, mas é pago em ETHFI, um token de preço variável, então toda conta em US$ daqui é Estimativa.
// A ether.fi pode mudar tudo isto, e o app dela é a fonte da verdade. Passou de CASHBACK_STALE_DAYS, a tela diz
// "pode ter mudado".

import type { CashTier, InsightSource } from './types';

/** Dia em que as páginas foram conferidas */
export const CASHBACK_CHECKED = '2026-11-01';
/** dateModified da página de taxas ("How does cashback work?") */
export const CASHBACK_RATES_UPDATED = '2026-10-30';
/** O mesmo prazo do priceBook (PRICE_STALE_DAYS) */
export const CASHBACK_STALE_DAYS = 90;

const help = (label: string, url: string): InsightSource => ({ label, url, checked: CASHBACK_CHECKED, level: 'official' });

export const CASHBACK_RATES_SOURCE = help('ether.fi · How does cashback work?', 'https://help.ether.fi/en/articles/262374-how-does-cashback-work');
export const CASHBACK_BENEFITS_SOURCE = help(
  'ether.fi · Benefits of a personal Cash credit card',
  'https://help.ether.fi/en/articles/304368-what-are-the-benefits-of-a-personal-cash-credit-card',
);
export const CASHBACK_EXCLUSIONS_SOURCE = help(
  'ether.fi · Which transactions don’t earn cashback?',
  'https://help.ether.fi/en/articles/882488-which-transactions-don-t-earn-cashback',
);
export const CASHBACK_LOCK_SOURCE = help(
  'ether.fi · Why is my cashback locked and when can I claim it?',
  'https://help.ether.fi/en/articles/825725-why-is-my-cashback-locked-and-when-can-i-claim-it',
);
export const CASHBACK_TERMS_SOURCE = help(
  'ether.fi · Cash Cashback Rewards Program terms',
  'https://etherfi.gitbook.io/etherfi/legal/ether.fi-legal/ether.fi-cash-cashback-rewards-program-u.s.-and-international',
);
export const MEMBERSHIP_SOURCE = help('ether.fi · How do Membership levels work?', 'https://help.ether.fi/en/articles/303625-how-do-membership-levels-work');
export const CATEGORY_CASHBACK_SOURCE = help('ether.fi · How does Category Cashback work?', 'https://help.ether.fi/en/articles/823083-how-does-category-cashback-work');
export const CORPORATE_CASHBACK_SOURCE = help(
  'ether.fi · How does cashback work for corporate accounts?',
  'https://help.ether.fi/en/articles/685724-how-does-cashback-work-for-corporate-accounts',
);

/** Como o cashback chega à conta, pelas páginas acima */
export const CASHBACK_PAYOUT = {
  /** Token em que o cashback é pago: preço variável, então o valor em US$ muda entre ganhar e resgatar */
  token: 'ETHFI',
  variablePrice: true,
  /** Pendente na autorização (em US$) → na liquidação vira ETHFI ao preço do momento e fica travado → resgatável */
  lockDays: 7,
  /** Mínimo resgatável, em US$ */
  minClaimUsd: 5,
  /** O resgate é manual, na página Cashback do app (é o cashback_claim do conector) */
  manualClaim: true,
  /** O saldo não resgatado pode ser perdido depois de 6 meses seguidos de conta inativa (termos, item 3) */
  forfeitAfterInactiveMonths: 6,
  /** O contador de gasto do mês zera no 1º dia do mês civil */
  counterResets: 'calendar-month',
  /** Estorno ou reembolso pode reverter o cashback da compra */
  refundReverses: true,
  sources: [CASHBACK_RATES_SOURCE, CASHBACK_LOCK_SOURCE, CASHBACK_TERMS_SOURCE],
} as const;

/**
 * MCCs que não rendem cashback, pela página de exclusões. O conector não traz o MCC (só uma categoria ampla), então a
 * lista serve para o "por quê?" e para um dado que um dia traga o código. Saque, P2P, câmbio e cartão-presente também
 * ficam fora pelos termos. Desde 30/10/2026, imposto (9311) e aluguel (6513) rendem na taxa normal.
 */
export const EXCLUDED_MCC: readonly number[] = [
  4829, 6010, 6011, 6012, 6050, 6051, 6211, 6529, 6530, 6535, 6536, 6537, 6538, 6539, 6540, 6611, 6760, 7800, 7801, 7802,
  7994, 7995,
];

export interface CashbackBand {
  /** Fim da faixa, em US$ de gasto acumulado no mês civil (inclusive). Sem o campo, a faixa não tem fim */
  upToUsd?: number;
  /** Taxa da faixa, em fração (0.03 = 3%) */
  rate: number;
}

/** Os níveis pessoais e o cartão corporativo */
export type CashbackPlanId = CashTier | 'business';

export interface CashbackPlan {
  id: CashbackPlanId;
  /** Nome do nível como o app escreve (marca, não traduz) */
  name: string;
  /**
   * Faixas do gasto padrão (USD e moedas que não são EUR), em ordem. Cada faixa paga a sua taxa só sobre o gasto que
   * cai nela. Se a última faixa tem fim, a página não publica a taxa acima dele (VIP: "lower rates apply"): esse
   * gasto fica fora da estimativa (unpricedUsd).
   */
  bands: readonly CashbackBand[];
  /** Faixas das compras liquidadas em EUR. Os limites são em US$ equivalentes, não em €, e o contador é o mesmo */
  eurBands: readonly CashbackBand[];
  /** Bônus extra sobre assinaturas de serviços da categoria que a pessoa escolhe (não vale compra pela loja de apps) */
  categoryCashback?: { rate: number; capUsdPerMonth: number };
  /** Caminhos para chegar ao nível, para o "por quê?". É informação, não recomendação */
  access: {
    free?: true;
    /** Pontos de membership no mês */
    points?: number;
    /** Saldo bruto no Liquid, em US$ */
    liquidUsd?: number;
    /** ETHFI em stake */
    stakedEthfi?: number;
    /** Compra anual, em US$ */
    annualUsd?: number;
  };
  source: InsightSource;
}

export const CASHBACK_PLANS: Record<CashbackPlanId, CashbackPlan> = {
  core: {
    id: 'core',
    name: 'Core',
    bands: [{ upToUsd: 2000, rate: 0.03 }, { upToUsd: 3000, rate: 0.01 }, { rate: 0.005 }],
    eurBands: [{ upToUsd: 800, rate: 0.03 }, { upToUsd: 1500, rate: 0.01 }, { rate: 0.001 }],
    access: { free: true },
    source: CASHBACK_RATES_SOURCE,
  },
  luxe: {
    id: 'luxe',
    name: 'Luxe',
    bands: [{ upToUsd: 10000, rate: 0.03 }, { upToUsd: 20000, rate: 0.01 }, { rate: 0.005 }],
    eurBands: [{ upToUsd: 3000, rate: 0.03 }, { upToUsd: 6000, rate: 0.01 }, { rate: 0.001 }],
    categoryCashback: { rate: 0.1, capUsdPerMonth: 10 },
    access: { points: 5000, liquidUsd: 15000, stakedEthfi: 30000, annualUsd: 199 },
    source: CASHBACK_RATES_SOURCE,
  },
  pinnacle: {
    id: 'pinnacle',
    name: 'Pinnacle',
    bands: [{ upToUsd: 50000, rate: 0.03 }, { upToUsd: 80000, rate: 0.01 }, { rate: 0.005 }],
    eurBands: [{ upToUsd: 16000, rate: 0.03 }, { upToUsd: 26000, rate: 0.01 }, { rate: 0.001 }],
    categoryCashback: { rate: 0.2, capUsdPerMonth: 20 },
    access: { points: 25000, liquidUsd: 100000, stakedEthfi: 150000, annualUsd: 999 },
    source: CASHBACK_RATES_SOURCE,
  },
  vip: {
    id: 'vip',
    name: 'VIP',
    // a página: "These are the initial 4% bands, not a cashback cutoff. Lower rates apply above these thresholds."
    bands: [{ upToUsd: 50000, rate: 0.04 }],
    eurBands: [{ upToUsd: 16000, rate: 0.04 }],
    categoryCashback: { rate: 0.3, capUsdPerMonth: 30 },
    access: { liquidUsd: 500000, stakedEthfi: 500000 },
    source: CASHBACK_RATES_SOURCE,
  },
  business: {
    id: 'business',
    name: 'Business',
    // corporativo: 1% sem limite; 0% em EUR. Por padrão o cashback vai para a conta pessoal do mesmo email
    bands: [{ rate: 0.01 }],
    eurBands: [{ rate: 0 }],
    access: {},
    source: CORPORATE_CASHBACK_SOURCE,
  },
};

/** O nível de quem não diz o seu: todo mundo começa no Core */
export const DEFAULT_CASHBACK_PLAN: CashbackPlanId = 'core';

/**
 * Os níveis pessoais no formato que o motor da tela Ganhos recebe por injeção (PlanRate, earnings.ts). `rate` e
 * `capMonthlyUsd` descrevem só a 1ª faixa: acima dela a taxa CAI, não zera. Para a conta certa, use `bands` (ou
 * cashbackForMonthlySpend). O Business fica de fora porque não é um nível pessoal.
 */
export interface CashbackPlanRate {
  id: CashTier;
  label: string;
  /** Taxa da 1ª faixa (fração) */
  rate: number;
  default?: boolean;
  /** Fim da 1ª faixa, em US$ de gasto no mês: acima dele valem as faixas seguintes de `bands` */
  capMonthlyUsd?: number;
  paidIn?: string;
  note?: { en: string; pt: string };
  source: InsightSource;
  bands: readonly CashbackBand[];
  eurBands: readonly CashbackBand[];
}

const NB = ' ';
const bandText = (bands: readonly CashbackBand[], lang: 'en' | 'pt'): string => {
  const loc = lang === 'pt' ? 'pt-BR' : 'en-US';
  const pct = (r: number) => `${(Math.round(r * 1000) / 10).toLocaleString(loc)}%`;
  const money = (n: number) => `US$${NB}${n.toLocaleString(loc)}`;
  const parts = bands.map((b) =>
    b.upToUsd === undefined
      ? `${pct(b.rate)} ${lang === 'pt' ? 'acima' : 'above'}`
      : `${pct(b.rate)} ${lang === 'pt' ? 'até' : 'up to'} ${money(b.upToUsd)}`,
  );
  const last = bands[bands.length - 1];
  if (last?.upToUsd !== undefined) parts.push(lang === 'pt' ? 'acima, taxa menor sem número publicado' : 'above that, a lower rate that isn’t published');
  return parts.join('; ');
};

export const CASHBACK_PLAN_RATES: readonly CashbackPlanRate[] = (['core', 'luxe', 'pinnacle', 'vip'] as const).map((id) => {
  const p = CASHBACK_PLANS[id];
  const first = p.bands[0];
  return {
    id,
    label: p.name,
    rate: first.rate,
    ...(id === DEFAULT_CASHBACK_PLAN ? { default: true } : {}),
    ...(first.upToUsd !== undefined ? { capMonthlyUsd: first.upToUsd } : {}),
    paidIn: CASHBACK_PAYOUT.token,
    note: {
      en: `Monthly card spend: ${bandText(p.bands, 'en')}. Paid in ETHFI, so the US$ value moves with the token price.`,
      pt: `Gasto do mês no cartão: ${bandText(p.bands, 'pt')}. Pago em ETHFI: o valor em US$ muda com o preço do token.`,
    },
    source: p.source,
    bands: p.bands,
    eurBands: p.eurBands,
  };
});

export interface CashbackEstimate {
  /** Cashback estimado em US$, antes de virar ETHFI (Estimativa) */
  usd: number;
  /** Gasto considerado, em US$ */
  spendUsd: number;
  /** usd ÷ spendUsd (fração), 0 sem gasto */
  effectiveRate: number;
  /** Gasto numa faixa sem taxa publicada (VIP acima do limite): fica fora de usd */
  unpricedUsd: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Cashback das compras de um mês, na ordem em que foram feitas. Um contador único soma todas as moedas, e a faixa de
 * cada compra sai da tabela da moeda dela (EUR tem limites menores). Uma compra que cruza um limite é dividida entre
 * as faixas. É a regra do exemplo da ajuda: depois de US$ 800 em EUR no Core, as compras em USD seguem a 3% até
 * US$ 2.000; depois de US$ 800 em USD, a próxima compra em EUR já cai em 1%. Valor ≤ 0 (estorno) é ignorado: desconte
 * antes de chamar. Não inclui o Category Cashback nem promoções.
 */
export function cashbackForPurchases(plan: CashbackPlan, purchases: readonly { usd: number; eur?: boolean }[]): CashbackEstimate {
  let counter = 0;
  let usd = 0;
  let unpriced = 0;
  for (const p of purchases) {
    if (!(p.usd > 0)) continue;
    const bands = p.eur ? plan.eurBands : plan.bands;
    let pos = counter;
    let left = p.usd;
    for (const band of bands) {
      if (left <= 0) break;
      const end = band.upToUsd ?? Infinity;
      if (pos >= end) continue;
      const part = Math.min(left, end - pos);
      usd += part * band.rate;
      pos += part;
      left -= part;
    }
    if (left > 0) unpriced += left;
    counter += p.usd;
  }
  const spendUsd = cents(counter);
  return { usd: cents(usd), spendUsd, effectiveRate: spendUsd > 0 ? usd / counter : 0, unpricedUsd: cents(unpriced) };
}

/**
 * Cashback de um gasto mensal em US$ (uma média, sem a ordem das compras), todo pela tabela padrão. Com as compras do
 * mês, use cashbackForPurchases com eur = (Transaction.currency === 'EUR'), porque o EUR tem limites menores.
 */
export function cashbackForMonthlySpend(plan: CashbackPlan, spendUsd: number): CashbackEstimate {
  return cashbackForPurchases(plan, [{ usd: spendUsd }]);
}
