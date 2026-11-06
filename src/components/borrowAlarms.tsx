import { useId, useState } from 'react';
import { Bell, BellOff, BellRing, Trash2 } from 'lucide-react';
import { ALARM_LIMIT, PRICE_PRODUCTS, UNDERLYING_LABEL, type Alarm, type AlarmKind, type AlarmState, type Underlying } from '../lib/borrow';
import { num } from '../lib/format';
import { cx } from '../lib/cx';
import { useLocale, useTr } from '../state/locale';
import { alarmNow, alarmText } from './borrowData';
import { NumberField } from './borrowParts';
import { Badge, Button, Panel, PanelTitle, Why } from './ui';

// Os alarmes da tela Empréstimo: health factor abaixo de, dívida acima de, preço abaixo ou acima de. Conferidos contra a
// posição REAL da conta carregada sempre que o Lighthouse abre ou atualiza, neste navegador; com a notificação ligada, o
// navegador avisa enquanto a aba estiver aberta. E-mail ou push com a aba fechada pediria algo rodando o tempo todo.

type Choice = 'hf_below' | 'debt_above' | `price_below:${Underlying}` | `price_above:${Underlying}`;

const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function AlarmsPanel({ states, alarms, onChange, notify, onNotify, priceUnderlyings, suggestions }: {
  states: AlarmState[];
  alarms: Alarm[];
  onChange: (next: Alarm[]) => void;
  notify: boolean;
  onNotify: (on: boolean) => void;
  /** Ativos de preço da posição (para o menu de tipos) */
  priceUnderlyings: Underlying[];
  /** Atalhos prontos: "HF abaixo de 1,5" etc. (só os que ainda não existem) */
  suggestions: Omit<Alarm, 'id' | 'on'>[];
}) {
  const tr = useTr();
  const { locale } = useLocale();
  const id = useId();
  const [choice, setChoice] = useState<Choice>('hf_below');
  const [value, setValue] = useState(1.5);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const full = alarms.length >= ALARM_LIMIT;
  const add = (a: Omit<Alarm, 'id' | 'on'>) => {
    if (full) return;
    onChange([...alarms, { ...a, id: newId(), on: true }]);
  };
  const submit = () => {
    if (!(value > 0)) return;
    const [kind, u] = choice.split(':') as [AlarmKind, Underlying | undefined];
    add({ kind, value, underlying: u });
  };
  const askNotify = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      onNotify(p === 'granted');
    } catch {
      setPermission('denied');
    }
  };
  const priceKinds = priceUnderlyings.filter((u) => PRICE_PRODUCTS[u]);
  const firing = states.filter((s) => s.triggered === true).length;

  return (
    <Panel>
      <PanelTitle hint={firing ? <Badge tone="bad">{tr(`${firing} firing`, `${firing} disparado${firing > 1 ? 's' : ''}`)}</Badge> : null}>
        {tr('Alarms', 'Alarmes')}
      </PanelTitle>

      {states.length ? (
        <ul className="divide-y divide-line">
          {states.map((s) => {
            const now = alarmNow(s, locale);
            return (
              <li key={s.alarm.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <span aria-hidden className={cx('flex size-8 shrink-0 items-center justify-center rounded-full', s.triggered ? 'bg-bad/15 text-bad' : 'bg-panel2 text-muted')}>
                  {s.triggered ? <BellRing className="size-4" /> : s.alarm.on ? <Bell className="size-4" /> : <BellOff className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cx('text-sm', s.alarm.on ? 'text-ink' : 'text-faint line-through')}>{alarmText(s.alarm, locale)}</div>
                  <div className="tnum text-xs text-faint">
                    {!s.alarm.on
                      ? tr('paused', 'pausado')
                      : s.triggered === null
                        ? tr('waiting for prices (turn on the price charts)', 'esperando os preços (ligue os gráficos de preço)')
                        : s.triggered
                          ? <span className="text-bad">{tr('Firing', 'Disparado')}{now ? ` · ${now}` : ''} · {tr('check it in the ether.fi app', 'confira no app da ether.fi')}</span>
                          : <>{tr('OK', 'OK')}{now ? ` · ${now}` : ''}</>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" className="px-2.5 text-xs" onClick={() => onChange(alarms.map((a) => (a.id === s.alarm.id ? { ...a, on: !a.on } : a)))} aria-pressed={!s.alarm.on}>
                    {s.alarm.on ? tr('Pause', 'Pausar') : tr('Resume', 'Retomar')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => onChange(alarms.filter((a) => a.id !== s.alarm.id))}
                    aria-label={tr(`Delete alarm: ${alarmText(s.alarm, locale)}`, `Apagar alarme: ${alarmText(s.alarm, locale)}`)}
                    className="tap flex size-8 cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-panel2 hover:text-ink"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">{tr('No alarms yet. They check your real position, not the simulation.', 'Nenhum alarme ainda. Eles conferem a posição real, não a simulação.')}</p>
      )}

      {suggestions.length && !full ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-faint">{tr('Quick add:', 'Atalho:')}</span>
          {suggestions.map((s) => (
            <button
              key={`${s.kind}:${s.underlying ?? ''}:${s.value}`}
              type="button"
              onClick={() => add(s)}
              className="tap cursor-pointer rounded-full border border-line2 px-3 py-1 text-xs text-muted transition-colors hover:border-accent/50 hover:text-ink"
            >
              + {alarmText({ ...s, id: 'x', on: true }, locale)}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="mt-4 grid gap-2 rounded-xl border border-line bg-panel2/40 p-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor={`${id}-k`} className="mb-1 block text-xs text-muted">{tr('Notify when', 'Avisar quando')}</label>
          <select
            id={`${id}-k`}
            value={choice}
            onChange={(e) => {
              const c = e.target.value as Choice;
              setChoice(c);
              setValue(c === 'hf_below' ? 1.5 : c === 'debt_above' ? 1000 : 0);
            }}
            className="min-h-11 w-full cursor-pointer rounded-lg border border-field bg-panel2 px-2 text-base text-ink pointer-fine:sm:min-h-9 pointer-fine:sm:text-sm"
          >
            <option value="hf_below">{tr('Loan health (HF) is below', 'A saúde do empréstimo (HF) ficar abaixo de')}</option>
            <option value="debt_above">{tr('Debt is above (US$)', 'A dívida passar de (US$)')}</option>
            {priceKinds.flatMap((u) => [
              <option key={`b${u}`} value={`price_below:${u}`}>{tr(`${UNDERLYING_LABEL[u]} price is below (US$)`, `O preço do ${UNDERLYING_LABEL[u]} ficar abaixo de (US$)`)}</option>,
              <option key={`a${u}`} value={`price_above:${u}`}>{tr(`${UNDERLYING_LABEL[u]} price is above (US$)`, `O preço do ${UNDERLYING_LABEL[u]} passar de (US$)`)}</option>,
            ])}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-v`} className="mb-1 block text-xs text-muted">{tr('Value', 'Valor')}</label>
          <NumberField id={`${id}-v`} value={value} onChange={setValue} max={1e9} decimals={choice === 'hf_below' ? 2 : 2} />
        </div>
        <Button type="submit" variant="primary" disabled={full || !(value > 0)} className="justify-center">
          {tr('Add alarm', 'Adicionar alarme')}
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {permission === 'unsupported' ? (
          <p className="text-xs text-faint">{tr('This browser has no notifications: alarms show here and on the menu.', 'Este navegador não tem notificações: os alarmes aparecem aqui e no menu.')}</p>
        ) : permission === 'denied' ? (
          <p className="text-xs text-faint">{tr('Notifications are blocked for this site in the browser settings: alarms show here and on the menu.', 'As notificações deste site estão bloqueadas nas configurações do navegador: os alarmes aparecem aqui e no menu.')}</p>
        ) : notify && permission === 'granted' ? (
          <>
            <Badge tone="good"><BellRing aria-hidden className="size-3" />{tr('Browser notifications on', 'Notificações do navegador ligadas')}</Badge>
            <Button variant="ghost" className="text-xs" onClick={() => onNotify(false)}>{tr('Turn off', 'Desligar')}</Button>
          </>
        ) : (
          <Button onClick={askNotify}>
            <Bell aria-hidden className="size-4" />
            {tr('Notify me in this browser', 'Avisar neste navegador')}
          </Button>
        )}
      </div>

      <div className="mt-3">
        <Why label={tr('how do alarms work?', 'como os alarmes funcionam?')}>
          {tr(
            `Alarms are kept in this browser only and check your real position (not the simulation) whenever Lighthouse opens or refreshes its data. Price alarms use the last price the charts fetched (Coinbase Exchange candles). A firing alarm shows here and as a dot on the menu and, with notifications on, the browser warns you once while the tab is open. Lighthouse has no server, so it can’t email you or push to your phone with the tab closed: that needs something running all the time. Up to ${num(ALARM_LIMIT, 0)} alarms. ether.fi’s own app shows a yellow or red banner when risk rises: check it there.`,
            `Os alarmes ficam só neste navegador e conferem a posição real (não a simulação) sempre que o Lighthouse abre ou atualiza os dados. Os de preço usam o último preço que os gráficos buscaram (candles da Coinbase Exchange). Um alarme disparado aparece aqui e como um ponto no menu e, com as notificações ligadas, o navegador avisa uma vez enquanto a aba estiver aberta. O Lighthouse não tem servidor, então não manda e-mail nem push para o celular com a aba fechada: isso pede algo rodando o tempo todo. Até ${num(ALARM_LIMIT, 0)} alarmes. O próprio app da ether.fi mostra uma faixa amarela ou vermelha quando o risco sobe: confira lá.`,
          )}
        </Why>
      </div>
    </Panel>
  );
}
