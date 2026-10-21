import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';

const NBSP = String.fromCharCode(0xa0);

/**
 * Comando ou nome de arquivo no meio do texto: os espaços viram não separáveis ("npm run pull" não parte), e só
 * quebra por dentro se não couber numa linha inteira.
 */
export function Code({ children }: { children: string }) {
  return <code className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-xs break-words text-ink">{children.replaceAll(' ', NBSP)}</code>;
}

/** Copia para a área de transferência; sem a API (contexto inseguro, permissão negada), tenta o caminho antigo. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cai no caminho antigo */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Botão "Copiar" com retorno: o rótulo visível vira "Copiado" por 2 s e uma região viva anuncia o resultado. Se o navegador
 * recusar, seleciona o texto (`selectTarget`) para a pessoa copiar com o teclado, e diz isso.
 */
export function CopyButton({ text, visibleLabel, context, selectTarget, className }: {
  text: string;
  /** rótulo visível no lugar de "Copiar" (ex.: "Copiar pedido") */
  visibleLabel?: string;
  /**
   * o que é copiado, depois do rótulo visível no nome acessível ("Copiar" + "o comando"): o nome sempre começa pelo
   * texto que aparece (2.5.3), para quem usa controle por voz
   */
  context?: string;
  selectTarget?: () => HTMLElement | null;
  className?: string;
}) {
  const tr = useTr();
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const shown = state === 'copied' ? tr('Copied', 'Copiado') : visibleLabel ?? tr('Copy', 'Copiar');

  const copy = async () => {
    const ok = await copyText(text);
    if (!ok) {
      const el = selectTarget?.();
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    setState(ok ? 'copied' : 'manual');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), ok ? 2000 : 6000);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={state === 'copied' ? shown : [shown, context].filter(Boolean).join(' ')}
        className={cx(
          'inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line2 px-3 text-xs font-medium text-ink transition-colors hover:bg-panel2 active:bg-panel2 pointer-fine:min-h-8',
          className,
        )}
      >
        {state === 'copied' ? <Check aria-hidden className="size-3.5 text-good" /> : <Copy aria-hidden className="size-3.5" />}
        <span aria-hidden>{shown}</span>
      </button>
      <span role="status" className="sr-only">
        {state === 'copied'
          ? tr('Copied to the clipboard', 'Copiado para a área de transferência')
          : state === 'manual'
            ? tr('Couldn’t copy: the text is selected, press Ctrl+C (⌘C on a Mac)', 'Não deu para copiar: o texto está selecionado, aperte Ctrl+C (⌘C no Mac)')
            : ''}
      </span>
    </>
  );
}

/**
 * Bloco de comando (ou de texto para colar) com botão de copiar. `wrap`: texto corrido que quebra linhas (o pedido
 * para o Claude); sem ele, o comando não quebra e rola por dentro, com o bloco focável pelo teclado.
 */
export function CommandBlock({ code, context, caption, wrap }: {
  code: string;
  /** o que o botão copia, para o nome acessível ("Copiar o comando") */
  context: string;
  /** legenda acima do bloco (ex.: "macOS / Linux") */
  caption?: string;
  wrap?: boolean;
}) {
  const tr = useTr();
  const id = useId();
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div className="min-w-0 rounded-lg border border-line bg-panel2/40">
      <div className="flex items-center justify-between gap-2 border-b border-line py-1 pr-1 pl-3">
        <span id={id} className="min-w-0 py-1 text-xs break-words text-muted">{caption ?? tr('Command', 'Comando')}</span>
        <CopyButton text={code} context={context} selectTarget={() => pre.current} />
      </div>
      <pre
        ref={pre}
        // rola por dentro (o comando não quebra): focável para quem usa teclado, com o nome da legenda
        tabIndex={wrap ? undefined : 0}
        aria-labelledby={wrap ? undefined : id}
        className={cx(
          'px-3 py-2.5 font-mono text-xs leading-relaxed text-ink',
          wrap ? 'break-words whitespace-pre-wrap' : 'overflow-x-auto whitespace-pre',
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
