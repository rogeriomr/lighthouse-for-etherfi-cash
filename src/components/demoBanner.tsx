import { ArrowRight, Sparkles } from 'lucide-react';
import { connectorAcceptsOrigin, PRODUCT_TAGLINE } from '../lib/config';
import { useTr } from '../state/locale';
import { Button } from './ui';

/**
 * Demo: a promessa do produto em uma linha, o convite para explorar e o caminho honesto para usar com a própria conta.
 * Fora das origens que o conector aceita, o botão não promete "conectar": leva aos passos que funcionam (puxar e importar).
 * Mora no topo do Portfólio, a primeira tela.
 */
export function DemoBanner({ onStart }: { onStart: () => void }) {
  const tr = useTr();
  const direct = connectorAcceptsOrigin();
  return (
    <div className="panel glow-accent flex flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="max-w-2xl">
        <div className="flex items-center gap-2 text-accent">
          <Sparkles aria-hidden className="size-4" />
          <span className="text-sm font-medium">{tr('Demo mode · sample data', 'Modo demonstração · dados fictícios')}</span>
        </div>
        <p className="mt-2 font-display text-lg font-semibold tracking-tight text-ink sm:text-xl">{tr(`${PRODUCT_TAGLINE.en}.`, `${PRODUCT_TAGLINE.pt}.`)}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {tr('Every number has a ', 'Todo número tem um ')}
          <span className="text-ink underline decoration-dotted underline-offset-2">{tr('why?', 'por quê?')}</span>
          {tr(
            ': open one, answer a renewal or download the reminders. Nothing here is real.',
            ': abra um, responda uma renovação ou baixe os lembretes. Nada aqui é real.',
          )}
        </p>
      </div>
      <Button variant="primary" onClick={onStart} className="shrink-0 justify-center pointer-coarse:min-h-11 max-sm:w-full lg:self-auto">
        {direct ? tr('Connect my account', 'Conectar minha conta') : tr('Use it with your account', 'Como usar com a sua conta')}
        <ArrowRight aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
