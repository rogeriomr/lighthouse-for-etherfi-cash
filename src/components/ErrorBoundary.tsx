import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTr } from '../state/locale';
import { forgetEverything, readStore, KEYS } from '../lib/storage';

/** Uma tela que quebra não derruba o app: o menu continua funcionando e o erro aparece no lugar dela. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[lighthouse] tela falhou', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ScreenError error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

// componente de classe não usa hook: o texto traduzido fica neste filho
function ScreenError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const tr = useTr();
  return (
    <div role="alert" className="panel border-bad/40 p-5">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
        <div className="min-w-0 text-sm">
          <div className="font-medium text-bad">{tr('This screen failed to load', 'Esta tela falhou ao montar')}</div>
          <div className="mt-1 break-words text-muted">{error.message}</div>
          <button
            onClick={onRetry}
            className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line2 px-3.5 text-xs text-muted transition-colors hover:bg-panel2 hover:text-ink active:bg-panel2 pointer-fine:sm:min-h-9"
          >
            {tr('Try again', 'Tentar de novo')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Última rede, em volta de tudo (idioma, dados e telas): se o próprio carregamento quebrar (storage corrompido,
 * resposta inesperada), aparece uma explicação com saída em vez de uma tela branca. Não usa nenhum contexto:
 * o idioma sai do que ficou salvo, e qualquer falha nisso cai no inglês.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; clearing: boolean }> {
  state: { error: Error | null; clearing: boolean } = { error: null, clearing: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[lighthouse] o app falhou', error, info.componentStack);
  }

  render() {
    const { error, clearing } = this.state;
    if (!error) return this.props.children;
    let pt = false;
    try {
      pt = readStore<string>(KEYS.locale, 'en') === 'pt';
    } catch {
      /* fica o inglês */
    }
    const tr = (en: string, ptText: string) => (pt ? ptText : en);
    const forget = async () => {
      this.setState({ clearing: true });
      try {
        await forgetEverything();
      } finally {
        window.location.reload();
      }
    };
    return (
      <div lang={pt ? 'pt-BR' : 'en'} className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
        <div role="alert" className="panel w-full max-w-md p-6">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-bad" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">{tr('Lighthouse couldn’t start', 'O Lighthouse não conseguiu abrir')}</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {tr(
                  'Something in this browser stopped the dashboard from loading. Reloading usually fixes it. If it keeps happening, clear what this dashboard saved here: your answers and the connection are erased, and nothing on ether.fi changes.',
                  'Algo neste navegador impediu o painel de abrir. Recarregar costuma resolver. Se continuar, apague o que o painel guardou aqui: suas respostas e a conexão são apagadas, e nada muda na ether.fi.',
                )}
              </p>
              <p className="mt-2 break-words font-mono text-xs text-faint">{error.message}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink hover:brightness-110"
                >
                  {tr('Reload', 'Recarregar')}
                </button>
                <button
                  onClick={forget}
                  disabled={clearing}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line2 px-4 text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink disabled:cursor-wait disabled:opacity-60"
                >
                  {tr('Clear saved data and reload', 'Apagar dados salvos e recarregar')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
