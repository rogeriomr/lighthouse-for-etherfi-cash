// O contrato da aba "AI Insights": o que o motor (engine.ts) entrega à tela. Um cartão é informação com os números da
// pessoa, nunca recomendação; todo número vem do dataset ou de uma conta verificável, e o que é estimativa diz isso.
// Os cartões de economia (savings.ts, com os dados de priceBook.ts e savingsRules.ts) seguem o mesmo tipo.

import type { SubscriptionRecord } from '../subscriptionTypes';

export type InsightGroup = 'credit' | 'earnings' | 'savings' | 'summary';

export interface InsightFact {
  label: string;
  /** Já formatado no idioma pedido ("US$ 1.234,56", "17%") */
  value: string;
  /** Simulação, faixa de juros, preço de tabela ou conversão: a tela põe o selo "Estimate / Estimativa" */
  estimate?: boolean;
}

/** Fonte pública de um número de fora do dataset (parâmetro da ether.fi, PTAX, preço de tabela) */
export interface InsightSource {
  label: string;
  /** Só https */
  url: string;
  /** Dia (AAAA-MM-DD) em que o dado foi conferido */
  checked: string;
  /** 'press': imprensa, não página oficial (a tela mostra o selo "press / imprensa"); ausente = oficial */
  level?: 'official' | 'press';
  /** Dia do texto de imprensa (AAAA-MM-DD) */
  published?: string;
}

/** Cartões que a tela desenha com controle próprio, chamando a função pura do motor */
export type InsightInteractive = 'eth-drop' | 'borrow-rate' | 'club-price';

export interface InsightCard {
  /** Estável entre cargas (para dispensar): o tipo e, quando há, o mês ou o símbolo */
  id: string;
  group: InsightGroup;
  title: string;
  /** Uma ou duas frases, no idioma pedido; sem verbo de recomendação */
  body: string;
  facts: InsightFact[];
  /** A conta em palavras, para o "por quê?" */
  why: string;
  /** Algum número do cartão é estimativa */
  estimate: boolean;
  sources?: InsightSource[];
  /** Transações que sustentam o cartão, para o "por quê?" (TxRow) */
  relatedIds?: string[];
  /** Fase 1: tudo 'local' ("Calculated here / Calculado aqui"); 'ai' fica para o insights.json */
  origin: 'local' | 'ai';
  interactive?: InsightInteractive;
  /** De quem o cartão fala, quando a tela precisa da chave: o id do clube em 'club-price' (chave de clubPrices) */
  subject?: string;
  /** Aviso curto que acompanha o cartão (ex.: "confira no app") */
  note?: string;
  /** Começa fechado: a pessoa abre se quiser (ex.: as mecânicas do crédito sem nada emprestado) */
  collapsed?: boolean;
}

/** Retrato do saldo guardado no navegador, para "o que mudou desde a última importação" */
export interface PortfolioSnapshot {
  version: 1;
  /** ISO do retrato (snapshotAt do dataset, ou a hora em que foi guardado) */
  at: string;
  totalBalance: number;
  borrowed: number;
  /** Instante (ms) da transação mais recente que o retrato já via */
  lastTxAt: number;
  holdings: { asset: string; value: number; quantity?: number }[];
}

/** O que a tela passa ao motor, além do dataset */
export interface InsightOptions {
  /** Taxa anual (%) que a pessoa digitou, vista no app da ether.fi; guardada só no aparelho */
  borrowRate?: number;
  /** Total mensal das assinaturas ativas (motor de assinaturas: report.monthlyTotalUsd) */
  subscriptionsMonthlyUsd?: number;
  /** Retrato da importação anterior (guardado pela tela) */
  lastSnapshot?: PortfolioSnapshot;
  /** "Agora", para os checks; padrão: o relógio */
  now?: Date;
  /** Nível do cartão informado pela pessoa (para as regras de economia que dependem dele) */
  tier?: CashTier;
  /** Registros do motor de assinaturas (report.records), se a tela já os tem; sem eles, o motor calcula */
  subscriptions?: SubscriptionRecord[];
  /** Mensalidade de um clube que a pessoa digitou (moeda da casa), pelo id do clube: { 'ifood-clube': 12.9 } */
  clubPrices?: Record<string, number>;
}

/** Níveis do cartão ether.fi Cash (a taxa de câmbio adicional e o cashback dependem dele) */
export type CashTier = 'core' | 'luxe' | 'pinnacle' | 'vip';
