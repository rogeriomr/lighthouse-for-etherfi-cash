import { useState } from 'react';
import { inDays, isSpend, periodWindow } from '../lib/analytics';
import { usd } from '../lib/format';
import { cardStatusLabel, cardTypeLabel } from '../lib/labels';
import { cx } from '../lib/cx';
import { dataLang } from '../lib/textLang';
import type { Card } from '../lib/types';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { Badge, Empty } from '../components/ui';
import { ChevronDown, CreditCard, Snowflake } from 'lucide-react';

const STATUS_TONE: Record<Card['status'], 'good' | 'info' | 'bad' | 'neutral' | 'warn'> = {
  active: 'good',
  frozen: 'info',
  locked: 'bad',
  cancelled: 'neutral',
  inactive: 'warn',
  unknown: 'neutral',
};

export function CardsSection() {
  const { dataset } = useStore();
  const [showCancelled, setShowCancelled] = useState(false);
  const tr = useTr();
  const win = periodWindow(dataset, '30d');

  const byCard = new Map<string, { total: number; count: number }>();
  for (const t of dataset.transactions) {
    if (!isSpend(t) || !t.cardId || !inDays(t.date, win.from, win.to)) continue;
    const cur = byCard.get(t.cardId) ?? { total: 0, count: 0 };
    cur.total = Math.round((cur.total + t.amountUsd) * 100) / 100;
    if (t.amountUsd > 0) cur.count += 1;
    byCard.set(t.cardId, cur);
  }

  // em uso primeiro; cancelados ficam recolhidos para não competir com os que funcionam
  const order: Card['status'][] = ['active', 'inactive', 'frozen', 'locked', 'unknown'];
  const live = dataset.cards.filter((c) => c.status !== 'cancelled').sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (byCard.get(b.id)?.total ?? 0) - (byCard.get(a.id)?.total ?? 0));
  const cancelled = dataset.cards.filter((c) => c.status === 'cancelled');

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted">
        {tr(
          'The connector never sees the full number, CVC or expiry date: only nickname, type, last 4 digits, status and currency.',
          'O conector nunca vê número completo, CVC ou validade: só apelido, tipo, últimos 4 dígitos, status e moeda.',
        )}
      </p>

      {dataset.cards.length === 0 ? (
        <Empty
          title={tr('No cards came from the connector.', 'Nenhum cartão veio do conector.')}
          hint={tr(
            'If you have cards in the ether.fi app, the connection may be missing the Cards permission (cards:read). Reconnect and keep it on.',
            'Se você tem cartões no app da ether.fi, talvez a conexão esteja sem a permissão de Cartões (cards:read). Conecte de novo com ela ligada.',
          )}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {live.map((c) => <CardTile key={c.id} c={c} spend={byCard.get(c.id)} />)}
        </div>
      )}

      {cancelled.length ? (
        <div>
          <button
            onClick={() => setShowCancelled((v) => !v)}
            aria-expanded={showCancelled}
            aria-controls={showCancelled ? 'cards-cancelled' : undefined}
            className="tap -my-1 flex cursor-pointer items-center gap-1.5 py-1 text-xs text-muted transition-colors hover:text-ink active:text-ink"
          >
            <ChevronDown aria-hidden className={cx('size-3.5 transition-transform', showCancelled && 'rotate-180')} />
            {cancelled.length === 1 ? tr('1 canceled card', '1 cartão cancelado') : tr(`${cancelled.length} canceled cards`, `${cancelled.length} cartões cancelados`)}
          </button>
          {showCancelled ? (
            // cancelado se diz pelo selo e pelo tom apagado do desenho, não por opacidade no texto (que caía a 2,97:1)
            <div id="cards-cancelled" className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cancelled.map((c) => <CardTile key={c.id} c={c} spend={byCard.get(c.id)} />)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CardTile({ c, spend }: { c: Card; spend?: { total: number; count: number } }) {
  const { locale } = useLocale();
  const tr = useTr();
  const off = c.status === 'cancelled';
  return (
    <div className={cx('panel overflow-hidden !p-0', off && 'border-dashed')}>
      <div className={cx('relative p-5', off ? 'bg-panel' : 'bg-gradient-to-br from-panel2 via-panel to-panel2')}>
        {off ? null : <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />}
        <div className="flex items-start justify-between">
          <div className="flex size-10 items-center justify-center rounded-xl border border-line2 bg-panel">
            <CreditCard aria-hidden className={cx('size-5', off ? 'text-faint' : 'text-accent')} />
          </div>
          <Badge tone={STATUS_TONE[c.status]}>
            {c.status === 'frozen' ? <Snowflake aria-hidden className="size-3" /> : null}
            {cardStatusLabel(c.status, locale)}
          </Badge>
        </div>
        <div lang={dataLang(c.nickname, locale)} className={cx('mt-6 font-medium', off && 'text-muted')}>{c.nickname}</div>
        <div className="tnum mt-1 text-lg tracking-[0.18em] text-muted">
          <span aria-hidden>•••• </span>
          <span className="sr-only">{tr('ending in', 'final')} </span>
          {c.lastFour}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-faint">
          <span>{cardTypeLabel(c.type, locale)}</span>
          <span aria-hidden>·</span>
          <span>{c.currency}</span>
        </div>
      </div>
      <div className="border-t border-line px-5 py-4">
        {c.status === 'inactive' ? (
          <div className="text-xs text-muted">{tr('Not activated yet. Activation happens in the ether.fi app.', 'Ainda não ativado. A ativação é feita no app da ether.fi.')}</div>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted">{tr('spent in 30 days', 'gasto em 30 dias')}</span>
              <span className="tnum font-semibold">{usd(spend?.total ?? 0)}</span>
            </div>
            <div className="mt-2 text-xs text-faint">
              {spend?.count === 1 ? tr('1 purchase', '1 compra') : tr(`${spend?.count ?? 0} purchases`, `${spend?.count ?? 0} compras`)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
