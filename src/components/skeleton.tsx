import type { ReactNode } from 'react';
import { viewOfSlug, type View } from '../lib/nav';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';
import { BrandMark } from './ui';

// Esqueletos com a forma de cada tela e o mesmo cromo do app: da carga ao conteúdo nada salta de lugar.
// Não dependem do store nem do roteador (o BootScreen roda antes dos dois); só do idioma.

/** A tela pelo endereço (#/activity…), sem passar pelo roteador: as mesmas regras dele (vazio e #/account viram o Portfólio). */
export function viewFromHash(hash: string = window.location.hash): View {
  return viewOfSlug(hash.replace(/^#\/?/, '').split(/[/?]/)[0]);
}

function Bone({ className }: { className: string }) {
  return <div className={cx('animate-pulse rounded-2xl bg-panel2/50', className)} />;
}

function Title() {
  return (
    <div className="space-y-2">
      <Bone className="h-6 w-40 rounded-md" />
      <Bone className="h-4 w-64 max-w-full rounded-md" />
    </div>
  );
}

const SHAPES: Record<View, () => ReactNode> = {
  // Portfólio: a linha da conta e as abas, o título com o valor, e a grade (barra e lista à esquerda, crédito à direita)
  portfolio: () => (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Bone className="h-4 w-44 rounded-md" />
        <Bone className="h-24 w-full rounded-lg min-[360px]:h-11 sm:w-96" />
      </div>
      <div className="space-y-3">
        <Bone className="h-10 w-72 max-w-full rounded-lg sm:h-14 sm:w-[28rem]" />
        <Bone className="h-4 w-56 max-w-full rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-5 min-[1100px]:grid-cols-12">
        <Bone className="h-48 min-[1100px]:col-span-8" />
        <Bone className="h-64 min-[1100px]:col-span-4 min-[1100px]:row-span-2" />
        <Bone className="h-72 min-[1100px]:col-span-8" />
      </div>
    </>
  ),
  // Gastos: título e período, os 4 números, e o gráfico com o "Precisa de atenção" na terceira coluna (no celular, antes)
  spending: () => (
    <>
      <Title />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-24" />)}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Bone className="h-72 lg:col-start-3 lg:row-start-1" />
        <Bone className="h-72 lg:col-span-2 lg:col-start-1 lg:row-start-1" />
      </div>
    </>
  ),
  history: () => <Kpis chart />,
  subscriptions: () => <Kpis list />,
  statement: () => (
    <>
      <Title />
      <Bone className="h-32 sm:h-20" />
      {[0, 1, 2].map((i) => <Bone key={i} className="h-44" />)}
    </>
  ),
  // AI Insights: título, e os cartões em duas colunas (o convite, quando desligada, ocupa o mesmo lugar)
  insights: () => (
    <>
      <Title />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-56" />)}
      </div>
    </>
  ),
  // "Comece aqui": título, o diagrama e os cartões dos caminhos
  start: () => (
    <>
      <Title />
      <Bone className="h-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => <Bone key={i} className="h-44" />)}
      </div>
    </>
  ),
};

function Kpis({ chart, list }: { chart?: boolean; list?: boolean }) {
  return (
    <>
      <Title />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Bone key={i} className="h-24" />)}
      </div>
      {chart ? <Bone className="h-72" /> : null}
      {list ? [0, 1, 2].map((i) => <Bone key={i} className="h-32" />) : null}
    </>
  );
}

/** O conteúdo de uma tela enquanto ela carrega: a forma dela, sem números. */
export function ScreenSkeleton({ view, label }: { view: View; label?: string }) {
  const tr = useTr();
  return (
    <div role="status" className="space-y-5">
      <div aria-hidden className="space-y-5">{SHAPES[view]()}</div>
      <span className="sr-only">{label ?? tr('Loading…', 'Carregando…')}</span>
    </div>
  );
}

/**
 * O app inteiro enquanto os dados carregam (BootScreen): a lateral ou a barra inferior, o cabeçalho de cobertura e a
 * forma da tela pedida no endereço, nas mesmas medidas do shell. Quando os dados chegam, só o miolo troca.
 */
export function ShellSkeleton({ label }: { label?: string }) {
  const view = viewFromHash();
  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:flex-row">
      <div aria-hidden className="border-b border-line lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 sm:px-5 lg:px-5 lg:pt-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line2 bg-panel2">
            <BrandMark className="size-7" />
          </span>
          <div className="space-y-1.5">
            <div className="h-4 w-24 rounded bg-panel2" />
            <div className="h-3 w-28 rounded bg-panel2/70" />
          </div>
        </div>
        <div className="mx-4 mb-3 h-3 w-60 max-w-[70%] rounded bg-panel2/60 sm:mx-5 lg:mt-2" />
        <div className="hidden space-y-2 px-3 lg:block">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-9 rounded-lg bg-panel2/40" />)}
        </div>
      </div>
      <div className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] short:pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:pb-0">
        <div aria-hidden className="flex min-h-14 items-center border-b border-line px-4 sm:px-5">
          <div className="h-3 w-56 max-w-[70%] rounded bg-panel2/60" />
        </div>
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-5 sm:py-6">
          <ScreenSkeleton view={view} label={label} />
        </div>
      </div>
      {/* a barra inferior do celular, no mesmo lugar e altura */}
      <div
        aria-hidden
        className="fixed inset-x-0 bottom-0 grid grid-cols-6 border-t border-line bg-bg/95 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          // as mesmas medidas do NavButton (ícone de 20px, rótulo com linha de 16px, py-1.5): a barra não salta na troca
          <div key={i} className="flex min-h-12 flex-col items-center justify-center gap-1 py-1.5 short:min-h-11 short:flex-row short:gap-4 short:py-1">
            <div className="size-5 rounded bg-panel2/70" />
            <div className="flex h-4 items-center">
              <div className="h-2.5 w-9 rounded bg-panel2/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
