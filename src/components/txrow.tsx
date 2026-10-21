import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Card, Transaction } from '../lib/types';
import { daysAgo, fxLabel, money, usd } from '../lib/format';
import { txGroup, txSign, txTitle, type TxGroup } from '../lib/labels';
import { categoryLabel } from '../lib/merchants';
import { cx } from '../lib/cx';
import { dataLang, keepHyphens } from '../lib/textLang';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { TxAmount, TxBadges } from './money';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, CircleDot, Coins, CreditCard, Landmark, PiggyBank, Users } from 'lucide-react';

const GROUP_ICON: Record<TxGroup, typeof CreditCard> = {
  spend: CreditCard,
  money: ArrowDownLeft,
  yield: PiggyBank,
  rewards: Coins,
  referral: Users,
  credit: Landmark,
  other: CircleDot,
};

/**
 * Uma linha do extrato. `attached` é a aplicação no rendimento que veio logo depois de um depósito:
 * mostrada como continuação dele, para não parecer que o dinheiro entrou e saiu.
 * Tocar na linha abre os detalhes que antes só existiam no hover: o texto inteiro da fatura, o câmbio, há quanto
 * tempo está a confirmar, o cartão e a cidade.
 */
export function TxRow({ t, card, meta, attached, highlight }: { t: Transaction; card?: Card; meta: string; attached?: Transaction; highlight?: boolean }) {
  const { locale } = useLocale();
  const tr = useTr();
  const { dataset } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  // aberta por um link (`target`): rola até a linha, destaca por ~2s (animação CSS) e leva o foco para ela,
  // depois do foco da tela no h1
  useEffect(() => {
    if (!highlight) return;
    const frame = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [highlight]);
  const group = txGroup(t);
  const Icon = group === 'money' && txSign(t) === '−' ? ArrowUpRight : GROUP_ICON[group];
  // só mostra o texto da fatura quando ele ajuda a reconhecer a compra (não quando muda só a caixa das letras)
  const squash = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const showRaw = t.type === 'purchase' && t.merchantRaw && squash(t.merchantRaw) !== squash(t.merchant);
  const counterparty = t.type !== 'purchase' && t.merchant ? t.merchant : undefined;
  // o cartão fica inteiro numa linha: "Apelido •• 0000" não se parte no meio
  const parts: { text: string; keep?: boolean; lang?: string }[] = [
    { text: meta, keep: true },
    { text: (t.type === 'purchase' ? categoryLabel(t.category, locale) : counterparty) ?? '' },
    { text: card ? `${card.nickname} •• ${card.lastFour}` : '', keep: true, lang: dataLang(card?.nickname, locale) },
    { text: t.city ?? '' },
  ].filter((d) => d.text);
  const title = keepHyphens(txTitle(t, locale));

  // o que só aparece aberto: o cartão vem sempre (a linha só o mostra quando há mais de um em uso)
  const anyCard = card ?? (t.cardId ? dataset.cards.find((c) => c.id === t.cardId) : undefined);
  const age = t.status === 'pending' ? daysAgo(t.date.slice(0, 10), dataset.referenceDate) : 0;
  const facts: [label: string, value: ReactNode][] = [];
  if (t.merchantRaw && t.type === 'purchase') facts.push([tr('On statement', 'Na fatura'), <span className="break-all font-mono">{t.merchantRaw}</span>]);
  if (t.currency !== 'USD') {
    facts.push([
      tr('Exchange', 'Câmbio'),
      <>
        {money(Math.abs(t.amount), t.currency)} → {usd(Math.abs(t.amountUsd))}
        {t.exchangeRate ? <span className="whitespace-nowrap">{'\u00A0· '}{fxLabel(t.exchangeRate, t.currency)}</span> : null}
      </>,
    ]);
  }
  if (t.status === 'pending') {
    facts.push([
      tr('Status', 'Situação'),
      age > 0
        ? tr(`pending for ${age} ${age === 1 ? 'day' : 'days'}`, `a confirmar há ${age} ${age === 1 ? 'dia' : 'dias'}`)
        : tr('pending since today', 'a confirmar desde hoje'),
    ]);
  }
  if (anyCard) facts.push([tr('Card', 'Cartão'), <span lang={dataLang(anyCard.nickname, locale)}>{anyCard.nickname} •• {anyCard.lastFour}</span>]);
  if (t.city || t.country) facts.push([tr('Place', 'Local'), [t.city, t.country].filter(Boolean).join(', ')]);
  const expandable = facts.length > 0;

  const body = (
    <>
      <span aria-hidden className="hidden size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel2 min-[360px]:flex">
        <Icon className={cx('size-4', group === 'spend' ? 'text-ink' : txSign(t) === '+' ? 'text-good' : 'text-muted')} />
      </span>
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* nome inteiro em até duas linhas: nada some atrás de reticências (1.4.12) */}
          <span lang={dataLang(t.merchant, locale)} className={cx('min-w-0 break-words font-medium text-pretty', !open && 'line-clamp-2', t.status === 'void' && 'text-faint')}>{title}</span>
          <TxBadges t={t} />
        </span>
        {/* o "·" fica preso ao que vem antes (NBSP): a linha nunca começa com ele */}
        <span className="mt-0.5 block text-xs text-faint text-pretty">
          {parts.map((d, i) => (
            <Fragment key={i}>
              <span lang={d.lang} className={d.keep ? 'whitespace-nowrap' : undefined}>{d.text}{i < parts.length - 1 ? '\u00A0·' : ''}</span>{' '}
            </Fragment>
          ))}
        </span>
        {/* o texto cru da fatura: 12px numa linha; aberto, aparece inteiro */}
        {showRaw && !open ? (
          <span className="block truncate font-mono text-xs text-faint">
            {tr('on statement:', 'na fatura:')} {t.merchantRaw}
          </span>
        ) : null}
        {attached ? (
          <span className="mt-1 block text-xs text-muted">
            {tr('↳ moved to yield right after:', '↳ aplicado no rendimento logo em seguida:')} <span className="tnum">{usd(attached.amountUsd)}</span>
          </span>
        ) : null}
      </span>
      <TxAmount t={t} />
      {expandable ? <ChevronDown aria-hidden className={cx('size-4 shrink-0 text-faint transition-transform max-[359px]:hidden', open && 'rotate-180')} /> : null}
    </>
  );

  return (
    // anel por dentro: a linha fica num painel com overflow-hidden, que cortaria um anel externo
    <div ref={ref} data-tx={t.id} tabIndex={highlight ? -1 : undefined} className={cx(highlight && 'target-flash-inset')}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-panel2/40 focus-inset active:bg-panel2/70"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">{body}</div>
      )}
      {open ? (
        <dl id={detailsId} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line/60 bg-panel2/30 px-4 py-3 text-xs min-[360px]:pl-16">
          {facts.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-faint">{label}</dt>
              <dd className="min-w-0 text-muted">{value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
