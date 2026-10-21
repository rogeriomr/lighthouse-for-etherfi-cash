import type { AccountTab } from '../lib/nav';
import { CardsSection } from './Cards';
import { DepositSection } from './Deposit';
import { ConnectView } from './Connect';

/**
 * As abas da antiga Conta que continuam como abas do Portfólio: cartões, depósito e conexão. O resumo (saldo, ativos,
 * crédito, recompensas) virou a tela Portfólio (views/Portfolio.tsx), que carrega este arquivo à parte.
 */
export function AccountSection({ tab }: { tab: AccountTab }) {
  if (tab === 'cards') return <CardsSection />;
  if (tab === 'deposit') return <DepositSection />;
  if (tab === 'connect') return <ConnectView />;
  return null;
}
