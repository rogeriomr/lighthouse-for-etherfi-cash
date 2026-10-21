import { useId, useState, useSyncExternalStore } from 'react';
import type { Anomaly } from '../lib/analytics';
import { dateTime, usd } from '../lib/format';
import { cx } from '../lib/cx';
import { dataLang } from '../lib/textLang';
import { KEYS, syncedStore } from '../lib/storage';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { Badge, WhyBody, WhyToggle } from './ui';
import { AlertTriangle, ArrowRight, Check, Clock, Copy, EyeOff } from 'lucide-react';

const KIND_ICON: Record<Anomaly['kind'], typeof AlertTriangle> = {
  duplicate: Copy,
  unusually_large: AlertTriangle,
  first_time: EyeOff,
  stuck_pending: Clock,
};

export const alertId = (a: Anomaly) => a.relatedIds.join('-');

// um só estado para a página: a barra lateral e a Home veem o "Já conferi" na hora, e outra aba chega pelo 'storage'
const dismissedStore = syncedStore<string[]>(KEYS.dismissed, [], (raw) =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : undefined,
);

/** Alertas marcados como "já conferi" ficam salvos só neste navegador. */
export function useDismissed() {
  const dismissed = useSyncExternalStore(dismissedStore.subscribe, dismissedStore.snapshot);
  return {
    dismissed,
    dismiss: (id: string) => dismissedStore.save([...dismissedStore.snapshot().filter((x) => x !== id), id]),
    restoreAll: () => dismissedStore.save([]),
  };
}

/** Vermelho só para o urgente; "confira" em azul; "vale saber" neutro. */
export const alertTone = (a: Anomaly): 'bad' | 'info' | 'neutral' => (a.urgent ? 'bad' : a.group === 'check_now' ? 'info' : 'neutral');

const ICON_TONE = { bad: 'text-bad', info: 'text-info', neutral: 'text-faint' };

/** Ações compactas de um cartão de alerta ou renovação: 32px no desenho (igual às das renovações), 44px no toque. */
export const rowActionClass = 'tap flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-line2 px-2.5 py-1 text-xs text-muted transition-colors hover:bg-panel hover:text-ink active:bg-panel2';

/**
 * Data e hora com o fuso: a data inteira numa linha e a hora com o fuso noutra, se faltar espaço ("GMT-3" nunca se
 * parte). Inteiro numa linha só, "Oct 17, 2025, 10:57 PM GMT-3" vazava da caixa do porquê a 320px.
 */
function When({ iso }: { iso: string }) {
  const s = dateTime(iso);
  const m = s.match(/^(.*?)(,?)\s+(\d{1,2}:\d{2}.*)$/);
  if (!m) return <span className="whitespace-nowrap">{s}</span>;
  return (
    <span>
      <span className="whitespace-nowrap">{m[1]}{m[2]}</span>{' '}
      <span className="whitespace-nowrap">{m[3]}</span>
    </span>
  );
}

/** `quiet`: alerta antigo, fora da contagem; fica sem cor. */
export function AlertRow({ a, onDismiss, onOpen, quiet }: { a: Anomaly; onDismiss?: () => void; onOpen?: () => void; quiet?: boolean }) {
  const Icon = KIND_ICON[a.kind];
  const { dataset } = useStore();
  const card = a.cardId ? dataset.cards.find((c) => c.id === a.cardId) : undefined;
  const related = dataset.transactions.filter((t) => a.relatedIds.includes(t.id));
  const several = new Set(related.map((t) => t.merchant)).size > 1;
  const tone = quiet ? 'neutral' : alertTone(a);
  const tr = useTr();
  const { locale } = useLocale();
  const [why, setWhy] = useState(false);
  const whyId = useId();
  return (
    <div className="rounded-xl border border-line bg-panel2/40 p-3.5">
      {/* abaixo de 360px o valor desce para a linha de baixo: o título usa a largura toda (antes, 4 linhas espremidas) */}
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', ICON_TONE[tone])} />
        <span className="min-w-0 flex-1 text-sm font-medium">{a.title}</span>
        <span className="tnum shrink-0 text-sm font-semibold max-[359px]:hidden">{usd(a.amountUsd)}</span>
      </div>
      <div className="mt-1 pl-6.5 text-xs text-faint">
        <span className="tnum font-semibold whitespace-nowrap text-ink min-[360px]:hidden">{usd(a.amountUsd)}{'\u00A0·'} </span>
        <span lang={dataLang(a.merchant, locale)}>{a.merchant}</span>{'\u00A0·'} <When iso={a.date} />
        {card ? <>{'\u00A0·'} <span lang={dataLang(card.nickname, locale)} className="whitespace-nowrap">{card.nickname} •• {card.lastFour}</span></> : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pl-6.5 pointer-coarse:gap-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={tone}>
            {a.urgent && !quiet ? tr('check now', 'conferir agora') : a.group === 'check_now' ? tr('check', 'conferir') : tr('good to know', 'vale saber')}
          </Badge>
          <WhyToggle open={why} onToggle={() => setWhy((v) => !v)} controls={whyId} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onOpen ? (
            <button onClick={onOpen} title={tr('Opens these charges in Activity', 'Abre estas cobranças no Extrato')} className={rowActionClass}>
              {tr('View', 'Ver')} <ArrowRight className="size-3" />
            </button>
          ) : null}
          {onDismiss ? (
            <button onClick={onDismiss} title={tr('Hides this alert in this browser', 'Esconde este alerta neste navegador')} className={rowActionClass}>
              <Check className="size-3" /> {tr('Got it', 'Já conferi')}
            </button>
          ) : null}
        </div>
      </div>
      {/* o porquê abre abaixo das ações, na largura do cartão (antes ficava numa coluna de ~110px) */}
      {why ? (
        <WhyBody id={whyId} className="mt-2.5 ml-6.5">
          {a.rationale}
          {/* as cobranças envolvidas, uma por linha (os "chips" de antes vazavam da caixa a 320px) */}
          {related.length ? (
            <ul className="mt-2 space-y-1 border-t border-line pt-2">
              {related.map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 text-faint">
                  {several && t.merchant ? <span lang={dataLang(t.merchant, locale)} className="text-muted">{t.merchant}</span> : null}
                  <When iso={t.date} />
                  <span className="tnum whitespace-nowrap text-muted">{usd(t.amountUsd)}</span>
                  <span>{t.status === 'pending' ? tr('pending', 'a confirmar') : tr('settled', 'confirmada')}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </WhyBody>
      ) : null}
    </div>
  );
}
