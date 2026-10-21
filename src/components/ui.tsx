import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';

export function Panel({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return <section id={id} className={cx('panel p-5', className)}>{children}</section>;
}

export function PanelTitle({ children, hint, id }: { children: ReactNode; hint?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 id={id} tabIndex={id ? -1 : undefined} className="min-w-0 text-[13px] font-medium uppercase tracking-[0.1em] text-muted outline-none sm:tracking-[0.14em]">{children}</h2>
      {hint ? <div className="text-right text-xs text-faint">{hint}</div> : null}
    </div>
  );
}

/** Link de texto no canto de um painel ("ver conta", "ver todos"): 24px de alvo no desenho, 44px no toque; não quebra. */
export const hintLinkClass = 'tap -my-1 cursor-pointer whitespace-nowrap py-1 transition-colors hover:text-muted active:text-ink';

type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger';

export function Button({
  variant = 'outline',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    // `active:`: retorno ao toque (no celular não há hover)
    primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95 font-medium',
    ghost: 'text-muted hover:text-ink hover:bg-panel2 active:bg-panel2',
    outline: 'border border-line2 text-ink hover:bg-panel2 active:bg-panel2',
    danger: 'border border-bad/40 text-bad hover:bg-bad/10 active:bg-bad/15',
  };
  return (
    <button
      className={cx(
        'tap inline-flex cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// 12px: o mínimo de texto no celular vale também para os selos
export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'bad' | 'good' | 'info'; title?: string }) {
  const tones = {
    neutral: 'border-line2 text-muted',
    accent: 'border-accent/30 text-accent bg-accent/5',
    warn: 'border-warn/30 text-warn bg-warn/5',
    bad: 'border-bad/30 text-bad bg-bad/5',
    good: 'border-good/30 text-good bg-good/5',
    info: 'border-info/30 text-info bg-info/5',
  };
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px text-xs leading-4', tones[tone])}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone, why }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn'; why?: ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="text-xs font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={cx('tnum mt-1.5 font-display text-2xl font-semibold tracking-tight', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad', tone === 'warn' && 'text-warn')}>
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
      {why ? <div className="mt-1.5"><Why>{why}</Why></div> : null}
    </div>
  );
}

/**
 * Só o botão "por quê?". Para quem precisa pôr o texto em outro lugar: num cartão com ações ao lado, o texto
 * abre abaixo da linha, na largura toda (WhyBody), e não espremido na coluna do botão.
 */
export function WhyToggle({ open, onToggle, controls, label }: { open: boolean; onToggle: () => void; controls?: string; label?: string }) {
  const tr = useTr();
  return (
    // padding com margem negativa: 24px de alvo sem mudar o desenho; 44px no toque (tap)
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      className="tap -mx-1 -my-1 cursor-pointer px-1 py-1 text-xs text-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-muted active:text-ink"
    >
      {label ?? tr('why?', 'por quê?')}
    </button>
  );
}

export function WhyBody({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return <div id={id} className={cx('rounded-lg border border-line bg-panel2/50 px-3 py-2 text-xs leading-relaxed text-muted', className)}>{children}</div>;
}

/** O racional ao lado do número: fechado por padrão, abre no lugar. */
export function Why({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <WhyToggle open={open} onToggle={() => setOpen((o) => !o)} controls={id} label={label} />
      {open ? <WhyBody id={id} className="mt-2">{children}</WhyBody> : null}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
      <div className="text-sm font-medium text-muted">{title}</div>
      {hint ? <div className="mx-auto mt-1 max-w-md text-xs text-faint">{hint}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Escolha única com setas (radiogroup). `fill`: no celular ocupa a largura toda, em grade (2 × 2 abaixo de 360px,
 * uma linha acima), com alvos de 44px; a partir de 640px volta a ser um bloco, compacto só com ponteiro fino (o celular
 * deitado continua com 44px). Sem `fill`, o desenho de sempre, com área de toque de 44px (`tap`).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  fill,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  fill?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(
        'gap-1 rounded-lg border border-line p-1',
        fill ? 'grid w-full grid-cols-2 min-[360px]:grid-cols-4 sm:inline-flex sm:w-auto' : 'inline-flex',
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        // como no radiogroup do APG: a seta escolhe a opção vizinha e leva o foco junto (do fim volta ao começo);
        // sem mover o foco, a segunda seta partia do botão antigo e não avançava
        const select = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
          e.preventDefault();
          const j = (index + options.length) % options.length;
          onChange(options[j].value);
          (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
        };
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') select(e, i + 1);
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') select(e, i - 1);
              if (e.key === 'Home') select(e, 0);
              if (e.key === 'End') select(e, options.length - 1);
            }}
            className={cx(
              'cursor-pointer rounded-md text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent active:bg-panel2',
              // toque: 44px (fill) ou área de 44px pelo `tap`; a densidade de desktop só com ponteiro fino
              fill ? 'min-h-11 min-w-0 truncate px-1.5 pointer-coarse:min-w-11 pointer-fine:sm:min-h-0 sm:px-3 pointer-fine:sm:py-1.5' : 'tap px-3 py-1.5 pointer-coarse:min-w-11',
              active ? 'bg-accent/15 text-accent' : 'text-faint hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Marca do Lighthouse: farol com um facho, numa cor só (o dourado tan da marca, token `brand`, que não segue o acento da
 * interface; o facho é a mesma cor a 50%). Mesmo desenho e cor de public/lighthouse.svg e public/favicon.svg; legível a 16px.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cx('text-brand', className)} fill="currentColor">
      <path d="M15.5 9.9 29 4.6v10.6z" opacity=".5" />
      <path d="M11.5 2.8 16 7.2H7z" />
      <path d="M8.4 8h6.2v3.8H8.4z" />
      <path d="M8.1 12.8h6.8l1 6H7.1z" />
      <path d="M6.67 21.4h9.66l.97 5.8H5.7z" />
      <rect x="3.5" y="27.6" width="16" height="2.2" rx="1.1" />
    </svg>
  );
}

/** Link para fora (ether.fi etc.): abre em outra aba e diz isso a quem usa leitor de tela. */
export function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const tr = useTr();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cx('tap underline-offset-2 transition-colors hover:underline', className)}>
      {children}
      <span aria-hidden> ↗</span>
      <span className="sr-only"> {tr('(opens in a new tab)', '(abre em outra aba)')}</span>
    </a>
  );
}

export function Spinner({ className }: { className?: string }) {
  const tr = useTr();
  return (
    <span
      role="status"
      aria-label={tr('loading', 'carregando')}
      className={cx('inline-block size-4 animate-spin rounded-full border-2 border-line2 border-t-accent', className)}
    />
  );
}
