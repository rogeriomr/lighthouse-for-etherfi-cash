import { useEffect, useMemo } from 'react';
import { accountPosition, aprOf, SAMPLE_BORROW_COLLATERAL, evaluateAlarms, summarize, UNDERLYING_LABEL, type Alarm, type AlarmState, type BorrowPosition, type BorrowSummary, type Uncounted } from '../lib/borrow';
import { num, usd } from '../lib/format';
import { pick, type Locale } from '../lib/locale';
import { KEYS, readSession, writeSession } from '../lib/storage';
import { useStore } from '../state/store';
import { useLocale } from '../state/locale';
import { useBorrowPrefs } from '../state/borrowPrefs';
import { useLatestPrices } from '../state/prices';

// A ligação da tela Empréstimo com o motor: a posição REAL da conta carregada (a que os alarmes conferem) e o estado de
// cada alarme. O menu (o ponto) e o vigia das notificações usam a mesma conta.

export interface RealBorrow {
  position: BorrowPosition;
  summary: BorrowSummary;
  uncounted: Uncounted[];
}

export function useRealBorrow(): RealBorrow {
  const { dataset, isSample } = useStore();
  const [prefs] = useBorrowPrefs();
  const apr = aprOf(prefs);
  return useMemo(() => {
    // no exemplo, a garantia é só LiquidUSD, weETH e ETHFI; a conta real entra inteira
    const { position, uncounted } = accountPosition(dataset, prefs.debtAsset, apr, isSample ? SAMPLE_BORROW_COLLATERAL : undefined);
    return { position, summary: summarize(position, apr), uncounted };
  }, [dataset, prefs.debtAsset, apr, isSample]);
}

export function useAlarmStates(): AlarmState[] {
  const real = useRealBorrow();
  const [prefs] = useBorrowPrefs();
  const prices = useLatestPrices();
  return useMemo(() => evaluateAlarms(prefs.alarms, real.summary, prices), [prefs.alarms, real, prices]);
}

/** O alarme em palavras: "Health factor abaixo de 1,5", "ETH abaixo de US$ 2.000". */
export function alarmText(a: Alarm, locale: Locale): string {
  const u = a.underlying ? UNDERLYING_LABEL[a.underlying] : '';
  switch (a.kind) {
    case 'hf_below': return pick(locale, `Loan health (HF) below ${num(a.value, 2)}`, `Saúde do empréstimo (HF) abaixo de ${num(a.value, 2)}`);
    case 'debt_above': return pick(locale, `Debt above ${usd(a.value)}`, `Dívida acima de ${usd(a.value)}`);
    case 'price_below': return pick(locale, `${u} below ${usd(a.value)}`, `${u} abaixo de ${usd(a.value)}`);
    case 'price_above': return pick(locale, `${u} above ${usd(a.value)}`, `${u} acima de ${usd(a.value)}`);
  }
}

/** O número de agora ao lado do alarme: "agora 1,42", "agora US$ 3.120". */
export function alarmNow(s: AlarmState, locale: Locale): string | null {
  if (s.current === null) return null;
  const v = s.alarm.kind === 'hf_below' ? num(s.current, 2) : usd(s.current);
  return pick(locale, `now ${v}`, `agora ${v}`);
}

const validateIds = (raw: unknown): string[] | undefined => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 50) : undefined);

/**
 * Vigia montado no App: quando um alarme passa a disparar e a pessoa ligou a notificação (e o navegador deixou), avisa
 * uma vez por disparo nesta sessão. O alarme que volta ao normal pode avisar de novo. Só funciona com a aba aberta.
 */
export function BorrowAlarmWatcher() {
  const states = useAlarmStates();
  const [prefs] = useBorrowPrefs();
  const { locale } = useLocale();
  useEffect(() => {
    const notified = new Set(readSession<string[]>(KEYS.alarmsNotified, [], validateIds));
    const firing = states.filter((s) => s.triggered === true);
    let changed = false;
    for (const id of [...notified]) {
      if (!firing.some((s) => s.alarm.id === id)) {
        notified.delete(id);
        changed = true;
      }
    }
    const fresh = firing.filter((s) => !notified.has(s.alarm.id));
    if (fresh.length && prefs.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const s of fresh) {
        try {
          const now = alarmNow(s, locale);
          new Notification('Lighthouse · ' + pick(locale, 'Borrow alarm', 'Alarme do empréstimo'), {
            body: `${alarmText(s.alarm, locale)}${now ? ` (${now})` : ''}. ${pick(locale, 'Check it in the ether.fi app.', 'Confira no app da ether.fi.')}`,
            tag: `lighthouse-alarm-${s.alarm.id}`,
          });
        } catch {
          /* o navegador recusou (ex.: Android pede service worker): o aviso na tela continua */
        }
        notified.add(s.alarm.id);
        changed = true;
      }
    } else if (fresh.length) {
      // sem notificação: marca como visto do mesmo jeito, para não estourar tudo de uma vez quando a pessoa ligar
      for (const s of fresh) notified.add(s.alarm.id);
      changed = true;
    }
    if (changed) writeSession(KEYS.alarmsNotified, [...notified]);
  }, [states, prefs.notify, locale]);
  return null;
}
