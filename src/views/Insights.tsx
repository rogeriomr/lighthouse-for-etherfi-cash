import { lazy, Suspense } from 'react';
import type { Navigate } from '../lib/nav';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';
import { Button, Panel } from '../components/ui';
import { useInsightsOn } from '../components/insightsPref';

// a parte ligada (o motor, os cartões, o simulador e as perguntas para o Claude) num pedaço próprio: só baixa quando
// a pessoa liga. Desligada, a aba não carrega nem roda nada do motor
const InsightsOn = lazy(() => import('../components/insights').then((m) => ({ default: m.InsightsOn })));

function OnLoading() {
  const tr = useTr();
  return (
    <div role="status" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {[0, 1].map((i) => <div key={i} aria-hidden className="h-56 animate-pulse rounded-2xl bg-panel2/50" />)}
      <span className="sr-only">{tr('Loading…', 'Carregando…')}</span>
    </div>
  );
}

/**
 * AI Insights, fase 1: o que os números da pessoa dizem, calculado aqui no navegador. Começa desligada: até a pessoa
 * ligar, a tela mostra só o convite e nenhum cálculo da aba roda. Informação e cenário, nunca recomendação.
 */
export function InsightsView({ onNavigate }: { onNavigate: Navigate }) {
  const tr = useTr();
  const [on, setOn] = useInsightsOn();
  // ligar e desligar trocam a tela inteira: o foco vai para o título, em vez de cair no <body>
  const toggle = (next: boolean) => {
    setOn(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus());
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 tabIndex={-1} className="text-xl font-semibold tracking-tight">AI Insights</h1>
          <p className="mt-0.5 text-sm text-muted">
            {on
              ? tr('Your numbers, explained. Calculated in this browser: information, not financial advice.', 'Os seus números, explicados. Calculado neste navegador: informação, não conselho financeiro.')
              : tr('Off. Nothing in this tab runs until you turn it on.', 'Desligado. Nada nesta aba roda até você ligar.')}
          </p>
        </div>
        {on ? (
          <Button variant="outline" onClick={() => toggle(false)} className="pointer-coarse:min-h-11">
            {tr('Turn off', 'Desligar')}
          </Button>
        ) : null}
      </div>
      {on ? <Suspense fallback={<OnLoading />}><InsightsOn /></Suspense> : <InsightsOff onTurnOn={() => toggle(true)} onNotNow={() => onNavigate('portfolio')} />}
    </div>
  );
}

// ---------- desligado: o convite e o consentimento ----------

/**
 * A tela com a aba desligada: o que ela faz, que nada sai do navegador e como desligar, com "Ligar" e "Agora não".
 * Nenhum cálculo da aba roda enquanto isso.
 */
export function InsightsOff({ onTurnOn, onNotNow }: { onTurnOn: () => void; onNotNow: () => void }) {
  const tr = useTr();
  const items: [string, string, string, string][] = [
    [
      'What it does', 'O que faz',
      'reads the data already loaded here and explains it: how your credit and yield work with your own numbers, where you could save, and what changed in the period. It is information, not financial advice.',
      'lê os dados já carregados aqui e explica: como o seu crédito e o seu rendimento funcionam com os seus números, onde dá para economizar e o que mudou no período. É informação, não conselho financeiro.',
    ],
    [
      'What leaves this browser', 'O que sai deste navegador',
      'nothing. Insights are calculated here. Lighthouse calls no AI and sends your data nowhere.',
      'nada. Os insights são calculados aqui. O Lighthouse não chama nenhuma IA e não manda os seus dados para lugar nenhum.',
    ],
    [
      'Your own Claude (optional)', 'O seu Claude (opcional)',
      'the tab has ready-made questions that open claude.ai in a new tab. The link carries only the question, never your numbers; Claude reads your account through its own ether.fi connector, under its provider’s terms.',
      'a aba tem perguntas prontas que abrem o claude.ai em outra aba. O link leva só a pergunta, nunca os seus números; o Claude lê a sua conta pelo próprio conector da ether.fi, nos termos do fornecedor dele.',
    ],
    [
      'Turning it off', 'Para desligar',
      'use “Turn off” at the top of the tab anytime. The choice and the borrowing rate you type are saved in this browser only, and “Forget everything in this browser” turns it off again.',
      'use “Desligar” no topo da aba quando quiser. A escolha e a taxa do emprestado que você digitar ficam salvas só neste navegador, e “Esquecer tudo neste navegador” desliga de novo.',
    ],
  ];
  return (
    <Panel className="max-w-3xl">
      <h2 className="font-display text-xl font-semibold tracking-tight">{tr('Turn on AI Insights?', 'Ligar o AI Insights?')}</h2>
      <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
        {items.map(([enT, ptT, enB, ptB]) => (
          <li key={enT}>
            <span className="font-medium text-ink">{tr(enT, ptT)}:</span> {tr(enB, ptB)}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onTurnOn} className={cx('justify-center pointer-coarse:min-h-11 max-sm:w-full')}>
          {tr('Turn on', 'Ligar')}
        </Button>
        <Button variant="ghost" onClick={onNotNow} className="justify-center pointer-coarse:min-h-11 max-sm:w-full">
          {tr('Not now', 'Agora não')}
        </Button>
      </div>
    </Panel>
  );
}
