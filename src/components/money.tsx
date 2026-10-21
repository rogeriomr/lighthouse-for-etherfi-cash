import type { Transaction } from '../lib/types';
import { daysAgo, fxLabel, money, usd } from '../lib/format';
import { isRefund, txSign } from '../lib/labels';
import { cx } from '../lib/cx';
import { useStore } from '../state/store';
import { useTr } from '../state/locale';
import { Badge } from './ui';

/**
 * Valor de uma linha: em compra fora do dólar, o principal é o que apareceu na maquininha
 * (R$ 629,64) e embaixo o que saiu do saldo (US$ 125,64) com o câmbio efetivo.
 */
export function TxAmount({ t, compact }: { t: Transaction; compact?: boolean }) {
  const sign = txSign(t);
  const local = t.currency !== 'USD';
  const voided = t.status === 'void';
  const neutral = sign === '' && t.type !== 'purchase';
  const primary = local ? money(Math.abs(t.amount), t.currency) : usd(Math.abs(t.amountUsd));
  // spans em bloco (não divs): o valor também vai dentro da linha tocável do extrato, e botão só aceita conteúdo de frase
  return (
    <span className="block shrink-0 text-right">
      <span className={cx('tnum block whitespace-nowrap font-medium', voided ? 'text-faint line-through' : sign === '+' ? 'text-good' : neutral ? 'text-muted' : '')}>
        {sign}{primary}
      </span>
      {local ? (
        <span className="tnum block whitespace-nowrap text-xs text-faint">
          {usd(Math.abs(t.amountUsd))}
          {!compact && t.exchangeRate ? <span className="hidden sm:inline"> · {fxLabel(t.exchangeRate, t.currency)}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Toda compra recente fica "a confirmar" por um ou dois dias: isso é normal e fica neutro. O âmbar ("vale olhar")
 * só depois de 3 dias, para não gastar a cor de atenção em quase toda linha.
 */
export const PENDING_CALM_DAYS = 3;

export function TxBadges({ t }: { t: Transaction }) {
  const tr = useTr();
  const { dataset } = useStore();
  // dias de calendário, no mesmo relógio local de t.date e do referenceDate
  const age = t.status === 'pending' ? daysAgo(t.date.slice(0, 10), dataset.referenceDate) : 0;
  const stale = age > PENDING_CALM_DAYS;
  return (
    <>
      {/* a idade fica escrita no selo ("· 5 d"): no toque não existe title */}
      {t.status === 'pending' ? (
        <Badge tone={stale ? 'warn' : 'neutral'}>
          <span aria-hidden>
            {tr('pending', 'a confirmar')}
            {age > 0 ? `\u00A0·\u00A0${age}\u00A0d` : ''}
          </span>
          <span className="sr-only">
            {age > 0 ? tr(`pending for ${age} ${age === 1 ? 'day' : 'days'}`, `a confirmar há ${age} ${age === 1 ? 'dia' : 'dias'}`) : tr('pending', 'a confirmar')}
          </span>
        </Badge>
      ) : null}
      {t.status === 'void' ? <Badge>{tr('voided', 'cancelada')}</Badge> : null}
      {isRefund(t) ? <Badge tone="good">{tr('refund', 'estorno')}</Badge> : null}
    </>
  );
}
