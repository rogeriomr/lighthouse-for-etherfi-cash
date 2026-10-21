import type { LoadError } from './errors';
import type { PortfolioSnapshot } from './insights/types';
import type { EvidenceFile, KnowledgeFile, RenewalAuditFile } from './subscriptionTypes';
import type { MerchantRulesFile } from './merchants';

export type TxType =
  | 'purchase'
  | 'top_up'
  | 'withdrawal'
  | 'yield_deposit'
  | 'yield_withdrawal'
  | 'bridge'
  | 'swap'
  | 'cashback'
  | 'cashback_claim'
  | 'referral'
  | 'borrow'
  | 'repayment'
  | 'liquidation'
  | 'other';

/** void = cancelada/recusada: aparece no extrato, nunca entra em totais */
export type TxStatus = 'settled' | 'pending' | 'void';

export interface Transaction {
  id: string;
  type: TxType;
  status: TxStatus;
  /**
   * ISO 8601 com Z, ex.: 2026-09-13T19:42:11Z. Depois de enrichDataset com fuso (dados reais), é a hora local
   * de quem vê escrita como se fosse UTC: slice(0,10) dá o dia local e os formatadores em UTC mostram a hora local
   */
  date: string;
  /** Instante original em UTC, quando date foi reescrita em hora local */
  dateUtc?: string;
  /** Nome legível do estabelecimento (purchases) ou contraparte (top-up, withdrawal, etc.) */
  merchant?: string;
  /** Nome como veio da fatura, ex.: "IFD*CANTINA AURORA LTDA" */
  merchantRaw?: string;
  /** Marca ou plataforma (purchases), ex.: "iFood" para todo pedido IFD*, "Uber" para corrida e Uber Eats */
  brand?: string;
  /** Categoria em português (ver lib/merchants.ts) */
  category?: string;
  /** Categoria como veio da fonte */
  categoryRaw?: string;
  /** Valor na moeda local; em purchases, negativo = estorno */
  amount: number;
  /** ISO 4217 da moeda local, ex.: "BRL", "EUR" */
  currency: string;
  /** Equivalente em USD; em purchases, negativo = estorno */
  amountUsd: number;
  /** Entrada ou saída de dinheiro da conta, quando a fonte informa */
  direction?: 'in' | 'out';
  /** Ativo movimentado em transações on-chain, ex.: "USDC", "ETHFI" */
  token?: string;
  /** Referência a Card.id */
  cardId?: string;
  /** Local, quando conhecido */
  city?: string;
  country?: string;
  /** Câmbio efetivo: USD por unidade da moeda local */
  exchangeRate?: number;
  /** Estabelecimento conhecido por cobrar assinatura (dicionário), mesmo sem recorrência no histórico */
  subscriptionHint?: boolean;
}

export type CardStatus = 'active' | 'frozen' | 'locked' | 'cancelled' | 'inactive' | 'unknown';

export interface Card {
  id: string;
  nickname: string;
  /** "physical" | "virtual" | "metal" | ... */
  type: string;
  lastFour: string;
  status: CardStatus;
  currency: string;
}

export interface MainAccount {
  /** Valor total dos ativos da conta */
  totalBalance?: number;
  /**
   * true quando a fonte diz tradingPositionsIncluded: false: só o totalBalance fica parcial. Poder de compra, limite e
   * emprestado são números à parte do Cash e não mudam com isso (descrição de get_main_account)
   */
  balancePartial?: boolean;
  creditLimit: number;
  amountBorrowed: number;
  /**
   * Poder de compra: o "spending power" que a descrição de get_main_account promete é este campo (as outras chaves
   * da resposta são totalBalance, creditLimit, borrowed e address). Não é limite − emprestado: os dois diferem nas
   * contas reais. Ausente quando a fonte não mandou
   */
  availableBalance?: number;
  /** Endereço público do vault (warn de privacidade) */
  vaultAddress: string;
  currency: string;
  /** Nome da conta que a conexão lê (accountLabel), como veio */
  accountLabel?: string;
}

export interface Holding {
  asset: string;
  /** Nome legível, ex.: "USD Yield" */
  name?: string;
  /** Ausente quando a fonte não informa a quantidade */
  quantity?: number;
  dollarValue: number;
  backsSpending?: boolean;
  /** APY percentual, quando informado */
  apy?: number;
  /** Grupo do app da ether.fi (Portfolio.groups), ex.: "liquidVaults" */
  groupId?: string;
  /** Rede do ativo (id numérico da cadeia) */
  chainId?: number;
  /** Cofre Liquid (grupo liquidVaults ou símbolo liquid*): a classe vem do que ele guarda; o cofre é um sinal à parte */
  vault?: boolean;
  /**
   * LTV publicado do ativo (fração 0–1), de get_deposit_address.supportedAssets pelo símbolo exato. Ausente quando o
   * símbolo não está lá, aparece com LTVs diferentes ou o valor sai de 0–1. Não reconstrói o limite: a ether.fi não diz
   * como o calcula
   */
  ltv?: number;
}

export interface Portfolio {
  /** Soma dos ativos listados (o conector não manda total): não é o saldo da conta quando a lista é parcial */
  totalValue: number;
  holdings: Holding[];
  /** true quando a fonte avisa que faltam ativos na lista (tradingIncluded false ou unrenderableCount > 0) */
  partial?: boolean;
  /** Grupos do app (id + rótulo da fonte, em inglês), na ordem da fonte */
  groups?: { id: string; label: string }[];
  /** Ativos que a fonte não soube listar (unrenderableAssetCount) */
  unrenderableCount?: number;
  /** tradingPositionsIncluded de get_portfolio, quando veio */
  tradingIncluded?: boolean;
}

export interface DepositInfo {
  address: string;
  networks: string[];
  assets: string[];
  /** Redes aceitas por ativo; sem isso não dá para afirmar qual combinação é segura */
  assetNetworks?: { symbol: string; name: string; networks: string[] }[];
  /**
   * O endereço confere com a conta (normalize.ts, depositCheck)? 'match' compara formato e os campos da mesma
   * importação; só com `trusted` (veio da conexão ao vivo) o QR é liberado. Os outros dizem por quê: formato
   * inválido, sem o endereço da conta para comparar, arquivos de contas diferentes, outro endereço ou conta e
   * depósito importados separados do resto. Ausente quando não há endereço.
   */
  check?: 'match' | 'mismatch' | 'no_account' | 'invalid' | 'mixed_accounts' | 'separate_import';
  /**
   * true só quando o endereço veio da conexão ao vivo com a ether.fi. Arquivo importado não tem assinatura: os campos
   * podem ser coerentes entre si e ainda assim apontar para outra carteira (ver Deposit.tsx).
   */
  trusted?: boolean;
}

export interface Coverage {
  /** Transação mais antiga carregada */
  from: string;
  to: string;
  /** false quando a fonte tem histórico mais antigo que não foi carregado */
  complete: boolean;
  /**
   * true quando alguma página veio marcada `incomplete`: o conector omitiu linhas que não sabia afirmar com exatidão.
   * Não é "falta histórico antigo" (isso é complete): faltam linhas no meio, então os totais são parciais e os meses
   * não se comparam
   */
  droppedRows?: boolean;
}

export interface Dataset {
  /** "Hoje" do dataset (AAAA-MM-DD), no mesmo relógio de Transaction.date: data local nos dados reais */
  referenceDate: string;
  /** Fuso em que date está escrita (dados reais); ausente no demo, cuja hora já é a de parede */
  timeZone?: string;
  account: MainAccount;
  cards: Card[];
  portfolio: Portfolio;
  deposit: DepositInfo;
  transactions: Transaction[];
  /** Preenchidos por enrichDataset */
  coverage?: Coverage;
  homeCurrency?: string;
  /** Arquivos locais da análise de assinaturas (?fixtures no dev ou importação local; ver subscriptionTypes.ts) */
  subscriptionSources?: { evidence?: EvidenceFile; research?: KnowledgeFile; audit?: RenewalAuditFile };
  /** Regras locais do dicionário de estabelecimentos (fixtures/live/merchant-rules.json), como vieram; enrichDataset valida */
  merchantRules?: MerchantRulesFile;
  /** true quando a fonte diz hasVault: false: a conta nunca recebeu depósito, um estado normal e não uma falha */
  neverFunded?: boolean;
  /**
   * Quais ferramentas vieram de fato (true) e quais faltaram (false: erro da ferramenta ou arquivo não importado).
   * Ausente, ou a chave ausente, = não se sabe (demo, dado antigo): trate como presente. Separa "carteira ausente" de
   * "carteira vazia"
   */
  sources?: Partial<Record<ToolName, boolean>>;
  /**
   * Quando o saldo foi lido (ISO, UTC): a hora da leitura no modo conectado; na importação, a modificação mais recente
   * de get_main_account.json / get_portfolio.json. Ausente quando não se sabe (demo, arquivo sem data)
   */
  snapshotAt?: string;
  /** Série da PTAX de venda do Banco Central (ptax.json do `npm run pull`), para comparar o câmbio das compras em BRL */
  ptax?: PtaxSeries;
  /**
   * Retrato da "importação anterior" que vem dentro do próprio dataset (só o demo): o cartão "o que mudou desde a
   * última importação" aparece sem gravar nada no navegador. Nos dados reais, quem guarda o retrato é a tela
   */
  previousSnapshot?: PortfolioSnapshot;
}

/** Um dia da PTAX: reais por 1 US$ (cotação de venda do fechamento) */
export interface PtaxRate {
  /** AAAA-MM-DD, dia da cotação (horário de Brasília) */
  date: string;
  sell: number;
}

export interface PtaxSeries {
  /** Ordenada por data, um valor por dia útil */
  rates: PtaxRate[];
  /** Quando o pull baixou (ISO), se o arquivo diz */
  fetchedAt?: string;
}

/** As ferramentas do conector que o painel lê */
export type ToolName = 'list_transactions' | 'list_cards' | 'get_main_account' | 'get_portfolio' | 'get_deposit_address';

/** Erros de carregamento por ferramenta, no modo real: o código do motivo (texto em errorText) */
export type ToolErrors = Partial<Record<ToolName, LoadError>>;

/** Estado de conexão com o MCP da ether.fi */
export type ConnectionState =
  | { kind: 'demo' }
  | { kind: 'connecting' }
  | { kind: 'connected'; scopes: string[]; accountHint?: string; expiresAt?: number }
  | { kind: 'error'; error: LoadError };
