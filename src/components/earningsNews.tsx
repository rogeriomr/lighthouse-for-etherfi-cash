import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Bot, Info, Sparkles, X } from 'lucide-react';
import type { Earnings } from '../lib/earnings';
import { nextWhatIf, type EarningsChange } from '../lib/earningsChanges';
import { earningsMarkdown } from '../lib/earningsReport';
import { REPO_URL } from '../lib/config';
import { dateShort, nb } from '../lib/format';
import { cx } from '../lib/cx';
import { useLocale, useTr } from '../state/locale';
import { useStore } from '../state/store';
import { useEarningsPrefs } from '../state/earningsPrefs';
import { CopyButton } from './code';
import { ExternalLink, Panel, PanelTitle } from './ui';

// Dois cartões da tela Ganhos que falam com o que vem de fora dela: "O que mudou desde a sua última visita" (o aviso,
// com o "e se" do próximo marco) e "Leve para a sua IA" (a conta em texto, para colar na IA da pessoa).

const TONE = {
  good: { Icon: ArrowUpRight, className: 'text-good' },
  attention: { Icon: ArrowDownRight, className: 'text-warn' },
  neutral: { Icon: Info, className: 'text-muted' },
} as const;

/**
 * O que mudou desde a última visita: cobertura, recorrências novas, preços, APY, o total e o próximo marco. A lista é a
 * da abertura da tela (o que a pessoa mexe aqui não vira aviso). "Entendi" esconde o cartão; a foto já foi gravada.
 */
export function ChangesPanel({ e, since, changes, onDismiss }: { e: Earnings; since: string; changes: EarningsChange[]; onDismiss: () => void }) {
  const tr = useTr();
  // o "e se" do próximo marco, a não ser que uma frase da lista já fale dele ("o próximo marco ficou mais perto…")
  const whatIf = changes.some((c) => c.kind === 'milestone') ? null : nextWhatIf(e, tr);
  return (
    <section aria-labelledby="earnings-news" className="panel border-accent/30 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id="earnings-news" className="text-[13px] font-medium uppercase tracking-[0.1em] text-muted sm:tracking-[0.14em]">
          {nb(tr(`Since your last visit · ${dateShort(since)}`, `Desde a sua última visita · ${dateShort(since)}`))}
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          className="tap -my-1 -mr-1 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-faint transition-colors hover:text-muted"
        >
          <X aria-hidden className="size-3.5" />
          {tr('Got it', 'Entendi')}
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {changes.map((c) => {
          const t = TONE[c.tone];
          return (
            <li key={c.id} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink">
              <t.Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', t.className)} />
              <span>{nb(c.text)}</span>
            </li>
          );
        })}
        {whatIf ? (
          <li className="flex items-start gap-2.5 text-sm leading-relaxed text-muted">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            <span><span className="font-medium text-ink">{tr('What if: ', 'E se: ')}</span>{nb(whatIf)}</span>
          </li>
        ) : null}
      </ul>
      <p className="mt-3 text-xs text-faint">{e.texts.note}</p>
    </section>
  );
}

/**
 * "Leve para a sua IA": copia a conta do mês em Markdown (os mesmos números da tela, as premissas e as regras para a
 * IA), para colar no assistente que a pessoa já usa. Nada sai do navegador sem ela colar; o aviso diz o que colar faz.
 */
export function AiHandoffPanel({ e }: { e: Earnings }) {
  const tr = useTr();
  const { locale } = useLocale();
  const { isSample, dataset } = useStore();
  const [prefs] = useEarningsPrefs();
  const text = useMemo(
    () => earningsMarkdown(e, { locale, date: dataset.referenceDate, data: isSample ? 'demo' : 'real', prefs }),
    [e, locale, dataset.referenceDate, isSample, prefs],
  );
  return (
    <Panel>
      <PanelTitle>
        <span className="inline-flex items-center gap-2"><Bot aria-hidden className="size-3.5" /> {tr('Take it to your AI', 'Leve para a sua IA')}</span>
      </PanelTitle>
      <p className="-mt-2 text-sm leading-relaxed text-muted">
        {tr(
          'Copies this month’s sum as text (each item, its cashback, Liquid, the 50/75/100% amounts and the milestones), with the assumptions and the rules, to paste into ChatGPT, Claude or the AI you use. It can then explain your numbers or try other scenarios.',
          'Copia a conta do mês em texto (cada item, o cashback dele, o Liquid, os valores para 50/75/100% e os marcos), com as premissas e as regras, para colar no ChatGPT, no Claude ou na IA que você usa. Ela pode explicar os seus números ou testar outros cenários.',
        )}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-faint">
        {tr(
          'Pasting it into an AI shares these numbers and item names with that service. Nothing leaves this browser until you paste it.',
          'Colar numa IA compartilha estes números e os nomes dos itens com o serviço dela. Nada sai deste navegador até você colar.',
        )}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <CopyButton text={text} visibleLabel={tr('Copy for your AI', 'Copiar para a sua IA')} context={tr('this month’s earnings, as text', 'os ganhos do mês, em texto')} />
        {REPO_URL ? (
          <ExternalLink href={`${REPO_URL}/blob/main/docs/ai/README.md`} className="text-xs text-muted">
            {tr('Guide for AIs and npm run earnings', 'Guia para IAs e o npm run earnings')}
          </ExternalLink>
        ) : null}
      </div>
    </Panel>
  );
}
