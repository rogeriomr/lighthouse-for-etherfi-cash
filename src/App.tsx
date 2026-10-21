import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType, RefObject } from 'react';
import { ArrowLeftRight, CalendarClock, CircleAlert, HistoryIcon, PieChart, RefreshCw, Sparkles, Wallet } from 'lucide-react';
import { StoreProvider, useStore } from './state/store';
import { LocaleProvider, useLocale, useLocaleSwitch, useTr } from './state/locale';
import { attentionSummary, useAttention, waitingLabel } from './state/attention';
import type { Attention } from './state/attention';
import { LOCALES } from './lib/locale';
import { errorAction, errorText } from './lib/errors';
import { AUTHOR, ETHERFI_CASH_URL, INDEPENDENCE_NOTE, PRODUCT, PRODUCT_FOR, PRODUCT_TAGLINE } from './lib/config';
import { Badge, BrandMark, ExternalLink, Spinner } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScreenSkeleton } from './components/skeleton';
import { useInsightsOn } from './components/insightsPref';
import { useMedia } from './components/useMedia';
import { dateRange } from './lib/format';
import { DEFAULT_VIEW, VIEW_SLUG, viewOfSlug } from './lib/nav';
import type { AccountTab, Navigate, View } from './lib/nav';
import { cx } from './lib/cx';

/**
 * Tela num pedaço próprio do bundle (a primeira visita baixa só a primeira tela). Depois de pré-carregada, monta direto: o
 * React.lazy suspendia na primeira montagem mesmo com o pedaço já baixado (esqueleto e revelação atrasada), e a
 * primeira troca para cada tela levava de 0,5 a 1 s em produção.
 */
function screen<P extends object>(load: () => Promise<ComponentType<P>>) {
  let ready: ComponentType<P> | null = null;
  const preload = () => load().then((c) => {
    ready = c;
    return c;
  });
  const Lazy = lazy(() => preload().then((c) => ({ default: c })));
  function Screen(props: P) {
    // a escolha fica fixa por montagem: quem montou pelo lazy continua nele (trocar o tipo remontaria a tela)
    const [Direct] = useState<ComponentType<P> | null>(() => ready);
    return Direct ? <Direct {...props} /> : <Lazy {...props} />;
  }
  return { Screen, preload };
}

const SCREENS = {
  portfolio: screen(() => import('./views/Portfolio').then((m) => m.PortfolioView)),
  spending: screen(() => import('./views/Spending').then((m) => m.SpendingView)),
  history: screen(() => import('./views/History').then((m) => m.HistoryView)),
  subscriptions: screen(() => import('./views/Subscriptions').then((m) => m.SubscriptionsView)),
  statement: screen(() => import('./views/Transactions').then((m) => m.TransactionsView)),
  insights: screen(() => import('./views/Insights').then((m) => m.InsightsView)),
  start: screen(() => import('./views/Start').then((m) => m.StartView)),
} satisfies Record<View, { preload: () => Promise<unknown> }>;
const PortfolioScreen = SCREENS.portfolio.Screen;
const SpendingScreen = SCREENS.spending.Screen;
const HistoryScreen = SCREENS.history.Screen;
const SubscriptionsScreen = SCREENS.subscriptions.Screen;
const TransactionsScreen = SCREENS.statement.Screen;
const InsightsScreen = SCREENS.insights.Screen;
const StartScreen = SCREENS.start.Screen;

// label: [en, pt]; short: rótulo da barra do celular quando o nome não cabe na coluna (~50px a 320px)
const NAV: { id: View; label: [string, string]; short?: [string, string]; icon: typeof Wallet }[] = [
  { id: 'portfolio', label: ['Portfolio', 'Portfólio'], icon: Wallet },
  { id: 'spending', label: ['Spending', 'Gastos'], icon: PieChart },
  { id: 'history', label: ['History', 'Histórico'], icon: HistoryIcon },
  { id: 'subscriptions', label: ['Subscriptions', 'Assinaturas'], short: ['Subs', 'Assinat.'], icon: CalendarClock },
  { id: 'statement', label: ['Activity', 'Extrato'], icon: ArrowLeftRight },
  // começa desligada: o item fica na navegação com o selo "off", e a tela mostra o convite
  { id: 'insights', label: ['AI Insights', 'AI Insights'], short: ['Insights', 'Insights'], icon: Sparkles },
];

/** "Comece aqui" (#/start): fora da barra; chega pelo rodapé, pela faixa do demo e pela Conexão */
const START_LABEL: [string, string] = ['Use it with your account', 'Como usar com a sua conta'];

const ACCOUNT_TABS: Record<AccountTab, { slug: string; label: [string, string] }> = {
  summary: { slug: '', label: ['Portfolio', 'Portfólio'] },
  cards: { slug: 'cards', label: ['Cards', 'Cartões'] },
  deposit: { slug: 'deposit', label: ['Deposit', 'Depositar'] },
  connect: { slug: 'connection', label: ['Connection', 'Conexão'] },
};

// ---------- rotas no hash: #/subscriptions?item=<chave>, #/activity?month=AAAA-MM, #/portfolio/cards ----------

interface Route {
  view: View;
  accountTab: AccountTab;
  month: string | null;
  /** item para a tela de destino rolar, destacar e focar */
  target: string | null;
}

function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  // endereço colado à mão pode ter "%" solto: decodeURIComponent lançaria e derrubaria a tela
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const [slug, sub] = path.split('/').filter(Boolean).map(decode);
  const params = new URLSearchParams(query);
  // vazio ou desconhecido: a primeira tela; #/account… (a antiga Conta) abre o Portfólio, na mesma aba
  const view = viewOfSlug(slug);
  const accountTab = view === 'portfolio'
    ? (Object.keys(ACCOUNT_TABS) as AccountTab[]).find((t) => ACCOUNT_TABS[t].slug === sub || t === sub) ?? 'summary'
    : 'summary';
  const month = params.get('month');
  // #/subscriptions/<chave> também vale, além de ?item=<chave>
  const target = params.get('item') ?? (view !== 'portfolio' && sub ? sub : null);
  return { view, accountTab, month: month && /^\d{4}-\d{2}$/.test(month) ? month : null, target: target || null };
}

function buildHash(r: Route): string {
  const tab = r.view === 'portfolio' && ACCOUNT_TABS[r.accountTab].slug ? `/${ACCOUNT_TABS[r.accountTab].slug}` : '';
  const params = new URLSearchParams();
  if (r.month) params.set('month', r.month);
  if (r.target) params.set('item', r.target);
  const query = params.toString();
  return `#/${VIEW_SLUG[r.view]}${tab}${query ? `?${query}` : ''}`;
}

/** Endereço desconhecido (#/xyz) ou antigo (#/account) mostra a tela certa: o endereço passa a dizer qual, sem criar entrada no histórico. */
function canonicalize(route: Route) {
  const hash = buildHash(route);
  if (window.location.hash && window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash);
}

/** Guarda na entrada atual do histórico onde a página está: o voltar devolve o mesmo lugar. */
function rememberScroll() {
  const state: unknown = window.history.state;
  window.history.replaceState({ ...(state && typeof state === 'object' ? state : {}), y: Math.round(window.scrollY) }, '');
}

interface RouteState {
  route: Route;
  /** muda a cada navegação (mesmo para a mesma rota), para o foco e o destaque rodarem de novo */
  seq: number;
  /** voltar/avançar: a posição a devolver, em vez de ir ao topo */
  restoreY: number | null;
}

/**
 * A tela tocada, até ela montar. Fica fora do Shell (um store do módulo, lido só pela barra e pela barra de progresso):
 * marcar a aba é um render pequeno, pintado já no quadro seguinte, e a tela nova monta logo depois. Com transição e
 * estado otimista no Shell, a tela antiga re-renderizava inteira antes da nova e a troca levava o dobro.
 */
const tapped = (() => {
  let value: View | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: View | null) {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
})();
const useTapped = () => useSyncExternalStore(tapped.subscribe, tapped.get, () => null);

/** A tela vem do hash, então voltar/avançar e recarregar funcionam e cada tela tem endereço. */
function useHashRoute() {
  const [state, setState] = useState<RouteState>(() => ({ route: parseHash(window.location.hash), seq: 0, restoreY: null }));
  const popY = useRef<number | null>(null);

  useEffect(() => {
    // a posição é nossa: o navegador restauraria antes da tela nova existir
    window.history.scrollRestoration = 'manual';
    canonicalize(parseHash(window.location.hash));
    // voltar/avançar: o popstate vem antes do hashchange e traz a posição guardada naquela entrada
    const onPop = (e: PopStateEvent) => {
      const y: unknown = e.state && typeof e.state === 'object' ? (e.state as { y?: unknown }).y : undefined;
      popY.current = typeof y === 'number' ? y : null;
    };
    // vale também para um endereço digitado com o app aberto, não só no primeiro carregamento
    const onHash = () => {
      const route = parseHash(window.location.hash);
      canonicalize(route);
      const restoreY = popY.current;
      popY.current = null;
      setState((s) => (buildHash(route) === buildHash(s.route) ? s : { route, seq: s.seq + 1, restoreY }));
    };
    // a posição também é guardada quando a rolagem para (sair pelo voltar do navegador não passa por go):
    // no máximo umas vezes por segundo, abaixo do limite do Safari para replaceState
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(rememberScroll, 250);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const go = useCallback((route: Route) => {
    const hash = buildHash(route);
    if (window.location.hash !== hash) {
      rememberScroll();
      // atribuir o hash cria a entrada no histórico; o hashchange que vem depois encontra a rota igual e não faz nada
      window.location.hash = hash;
    }
    setState((s) => ({ route, seq: s.seq + 1, restoreY: null }));
  }, []);

  /** Troca o endereço sem navegar (estado que a tela já mostra, como "ver todos" aberto), para o voltar reabrir igual. */
  const replace = useCallback((route: Route) => {
    const hash = buildHash(route);
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash);
  }, []);

  return { ...state, go, replace };
}

/** Foco no h1 da tela (ou no próprio main, se a tela não tiver h1): o leitor de tela anuncia onde a pessoa chegou. */
function focusHeading(main: HTMLElement | null, opts?: FocusOptions) {
  if (!main) return;
  const heading = main.querySelector<HTMLElement>('h1') ?? main;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus(opts);
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Roda depois que a tela nova montou (fica dentro do Suspense, depois dela): é aí que o h1 existe. */
function Arrived({ seq, onArrive }: { seq: number; onArrive: (seq: number) => void }) {
  useEffect(() => onArrive(seq), [seq, onArrive]);
  return null;
}

/**
 * Celular: o cabeçalho de cobertura sai do caminho ao rolar para baixo e volta ao rolar para cima (ou quando o foco
 * entra nele). Abaixo de 1024px; no desktop ele fica sempre. O estado vive no próprio cabeçalho (CoverageHeader):
 * rolar re-renderiza só ele, nunca o Shell nem a tela aberta.
 */
function useHideOnScroll(header: RefObject<HTMLElement | null>) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - last;
        if (Math.abs(dy) < 8) return;
        last = y;
        const focused = header.current?.contains(document.activeElement) ?? false;
        setHidden(dy > 0 && y > 120 && !focused);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [header]);
  return [hidden, setHidden] as const;
}

function Shell() {
  const { route, seq, restoreY, go, replace } = useHashRoute();
  const { view, accountTab, month, target } = route;
  const { source, refresh, loadError, isSample } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  const mainRef = useRef<HTMLElement>(null);
  const lastView = useRef(view);
  const attention = useAttention();

  // a aba tocada e a barra de progresso aparecem no quadro seguinte; a tela nova monta depois que ele foi pintado
  // (o render dela é pesado e, antes, segurava qualquer retorno ao toque por 0,3 a 0,7 s)
  const navigate: Navigate = useCallback((next, opts) => {
    const route: Route = {
      view: next,
      accountTab: next === 'portfolio' ? opts?.accountTab ?? 'summary' : 'summary',
      month: opts?.month ?? null,
      target: opts?.target ?? null,
    };
    tapped.set(next);
    requestAnimationFrame(() => setTimeout(() => go(route), 0));
  }, [go]);

  // ao trocar de tela: volta ao topo e leva o foco ao h1 (o leitor de tela anuncia a tela nova). Voltar/avançar
  // devolve a posição em que a pessoa estava. Trocar de aba dentro do Portfólio não move o foco. Com `target`, a tela de
  // destino foca o item depois.
  const arrive = useCallback((n: number) => {
    tapped.set(null);
    const changed = lastView.current !== view;
    lastView.current = view;
    if (n === 0) return;
    const main = mainRef.current;
    if (restoreY !== null) {
      if (changed) focusHeading(main, { preventScroll: true });
      // depois do que a tela fizer nos próprios quadros (abrir "ver todos", rolar até o item destacado)
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: restoreY })));
      return;
    }
    if (!changed && !target) return;
    if (changed) window.scrollTo({ top: 0 });
    const active = document.activeElement;
    if (!main || (target && active && active !== main && main.contains(active))) return;
    focusHeading(main, { preventScroll: true });
  }, [view, target, restoreY]);

  // tocar na aba atual volta ao topo (convenção do iOS e do Android) e tira o que o endereço ainda pedia
  const onNav = (id: View) => {
    if (view === id && tapped.get() === null) {
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      focusHeading(mainRef.current, { preventScroll: true });
      if (target || month || accountTab !== 'summary') navigate(id);
      return;
    }
    navigate(id);
  };

  // com a primeira tela na mão, as outras baixam em segundo plano: trocar de aba não espera a rede
  useEffect(() => {
    const preload = () => Object.values(SCREENS).forEach((sc) => void sc.preload().catch(() => undefined));
    // o Safari não tem requestIdleCallback
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(preload, 1500);
    return () => clearTimeout(id);
  }, []);

  // título da aba e descrição seguem a tela e o idioma, sempre com o nome completo
  useEffect(() => {
    const name = `${PRODUCT} ${PRODUCT_FOR[locale]}`;
    const item = NAV.find((n) => n.id === view);
    // a primeira tela leva só o nome e o lema; as abas do Portfólio, o nome delas
    const page = view === 'portfolio'
      ? (accountTab === 'summary' ? null : ACCOUNT_TABS[accountTab].label)
      : view === 'start' ? START_LABEL : item?.label;
    document.title = page ? `${tr(...page)} · ${name}` : `${name} · ${tr(PRODUCT_TAGLINE.en, PRODUCT_TAGLINE.pt)}`;
    document.querySelector('meta[name="description"]')?.setAttribute(
      'content',
      tr(
        `${name}: ${PRODUCT_TAGLINE.en.toLowerCase()}. Independent open-source dashboard, not affiliated with ether.fi. Read-only, runs in your browser.`,
        `${name}: ${PRODUCT_TAGLINE.pt.toLowerCase()}. Painel open source independente, sem vínculo com a ether.fi. Só leitura, roda no seu navegador.`,
      ),
    );
  }, [view, accountTab, locale, tr]);

  const handleRefresh = () => {
    if (source !== 'live') {
      navigate('portfolio', { accountTab: 'connect' });
      return;
    }
    refresh();
  };

  // uma navegação só no DOM: a lateral no desktop, a barra inferior (depois do <main>) no celular
  const desktop = useMedia('(min-width: 1024px)');
  // dados reais falharam e a tela caiu no demo: o número e o vermelho da barra viriam dos dados fictícios (alarme falso)
  const quietNav = Boolean(loadError) && isSample;
  const nav = (variant: 'side' | 'bar') => <MainNav variant={variant} view={view} attention={attention} quiet={quietNav} onNav={onNav} />;

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <button
        type="button"
        onClick={() => focusHeading(mainRef.current)}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-panel2 focus:px-3 focus:py-2 focus:text-sm"
      >
        {tr('Skip to content', 'Pular para o conteúdo')}
      </button>

      <NavProgress view={view} />

      {/* banner: nome, linha de independência e, no desktop, a navegação na lateral */}
      <header className="border-b border-line lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 sm:px-5 lg:block lg:px-5 lg:pt-5 lg:pb-0">
          <Brand onFirst={() => onNav(DEFAULT_VIEW)} />
          <div className="flex shrink-0 items-center gap-2 lg:hidden">
            {/* abaixo de 375px o selo sai (a linha de cobertura já diz de onde vêm os dados) e o nome nunca é cortado */}
            <span className="contents max-[374px]:hidden">
              <ModeBadge compact />
            </span>
            <LocaleToggle />
          </div>
        </div>
        {/* junto do nome, no celular e no desktop: é parte da identidade, não letra miúda de rodapé */}
        <p className="px-4 pb-3 text-xs leading-snug text-faint sm:px-5 lg:px-5 lg:pt-2 lg:pb-4">{tr(INDEPENDENCE_NOTE.en, INDEPENDENCE_NOTE.pt)}</p>

        {desktop ? (
          <nav aria-label={tr('Main', 'Principal')} className="hidden lg:flex lg:flex-col lg:gap-1 lg:px-3">
            {nav('side')}
          </nav>
        ) : null}

        <div className="hidden space-y-4 px-5 pt-6 pb-5 lg:mt-auto lg:block">
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge />
            <LocaleToggle />
          </div>
          <AboutLines view={view} />
        </div>
      </header>

      <main
        ref={mainRef}
        className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] short:pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:pb-0"
      >
        <CoverageHeader onRefresh={handleRefresh} />
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-5 sm:py-6">
          {/* na Conexão o próprio painel já mostra o erro, com os passos para resolver */}
          {view === 'portfolio' && accountTab === 'connect' ? null : <LoadErrorBanner onConnection={() => navigate('portfolio', { accountTab: 'connect' })} />}
          <ErrorBoundary resetKey={view}>
            <Suspense fallback={<ScreenSkeleton view={view} />}>
              {view === 'portfolio' ? (
                <PortfolioScreen tab={accountTab} onTab={(t) => go({ ...route, accountTab: t, target: null })} onNavigate={navigate} />
              ) : null}
              {view === 'spending' ? (
                <SpendingScreen
                  onOpenMonth={(m) => navigate('statement', { month: m })}
                  onOpenSubscriptions={() => navigate('subscriptions')}
                  onNavigate={navigate}
                  target={target}
                  onListChange={(open, m) => replace({ ...route, target: open ? (m ? `alerts:${m}` : 'alerts') : null })}
                />
              ) : null}
              {view === 'history' ? <HistoryScreen /> : null}
              {view === 'subscriptions' ? <SubscriptionsScreen target={target} /> : null}
              {/* o mês e a linha vêm da URL: trocar por link remonta a lista com o filtro novo */}
              {view === 'statement' ? <TransactionsScreen key={`${month ?? 'all'}|${target ?? ''}`} initialMonth={month} target={target} /> : null}
              {view === 'insights' ? <InsightsScreen onNavigate={navigate} /> : null}
              {view === 'start' ? <StartScreen target={target} /> : null}
              <Arrived seq={seq} onArrive={arrive} />
            </Suspense>
          </ErrorBoundary>
        </div>
        <footer className="border-t border-line px-4 py-5 sm:px-5 lg:hidden">
          <AboutLines view={view} />
        </footer>
      </main>

      {/*
        celular: barra inferior fixa com os 6 itens, depois do <main> no DOM (o Tab chega ao conteúdo antes dela) e com
        respiro para a área segura; deitado (short), ícone e rótulo numa linha só, mais baixa
      */}
      {desktop ? null : (
        <nav
          aria-label={tr('Main', 'Principal')}
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-bg/95 pt-1 pr-[max(0.125rem,env(safe-area-inset-right))] pb-[max(0.25rem,env(safe-area-inset-bottom))] pl-[max(0.125rem,env(safe-area-inset-left))] backdrop-blur short:pt-0 lg:hidden"
        >
          {nav('bar')}
        </nav>
      )}
    </div>
  );
}

/**
 * Os dados reais não carregaram: diz o motivo no topo de toda tela, com "Tentar de novo" e o caminho para a Conexão.
 * Se a tela caiu no demo por causa disso, diz também que os números na tela são fictícios.
 */
function LoadErrorBanner({ onConnection }: { onConnection: () => void }) {
  const { loadError, retry, loading, isSample } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  if (!loadError) return null;
  const action = errorAction(loadError);
  const technical = [loadError.code, loadError.status, loadError.detail].filter((x) => x !== undefined && x !== '').join(' · ');
  const link = action === 'reconnect' ? tr('Connect again', 'Conectar de novo') : action === 'import' ? tr('Import files', 'Importar arquivos') : tr('Connection', 'Conexão');
  // no celular, os dois botões na largura toda (antes empilhavam com larguras diferentes)
  const button = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 text-sm transition-colors max-sm:w-full pointer-fine:sm:min-h-9';
  return (
    <div role="alert" className="panel mb-5 border-warn/40 p-4">
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{tr('Your data didn’t load', 'Seus dados não carregaram')}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {errorText(loadError, locale)}
            {isSample ? tr(' Meanwhile, the numbers on screen are sample data.', ' Enquanto isso, os números na tela são fictícios.') : ''}
          </p>
          {technical ? <p className="mt-1 break-words font-mono text-xs text-faint">{technical}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={retry}
              disabled={loading}
              className={cx(
                button,
                'disabled:cursor-wait disabled:opacity-60',
                action === 'retry' ? 'bg-accent font-medium text-accent-ink hover:brightness-110 active:brightness-95' : 'border border-line2 text-ink hover:bg-panel2 active:bg-panel2',
              )}
            >
              {loading ? <Spinner className="size-3.5" /> : <RefreshCw aria-hidden className="size-3.5" />}
              {tr('Try again', 'Tentar de novo')}
            </button>
            <button
              onClick={onConnection}
              className={cx(
                button,
                action === 'retry' ? 'border border-line2 text-ink hover:bg-panel2 active:bg-panel2' : 'bg-accent font-medium text-accent-ink hover:brightness-110 active:brightness-95',
              )}
            >
              {link}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Nome próprio + o produto com que funciona; o vínculo com a ether.fi é só texto (sem logo nem cor dela). Leva à primeira tela. */
function Brand({ onFirst }: { onFirst: () => void }) {
  const { locale } = useLocale();
  const tr = useTr();
  return (
    <button type="button" onClick={onFirst} className="-m-1 flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg p-1 text-left active:bg-panel2">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line2 bg-panel2">
        <BrandMark className="size-7" />
      </span>
      {/* o nome visível começa o nome acessível (2.5.3): "Lighthouse for ether.fi Cash, Portfolio" */}
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-display text-[17px] font-semibold tracking-tight text-ink">{PRODUCT}</span>{' '}
        <span className="block truncate text-xs text-muted">{PRODUCT_FOR[locale]}</span>
        <span className="sr-only">, {tr('Portfolio', 'Portfólio')}</span>
      </span>
    </button>
  );
}

/** Linhas fixas de transparência: o que o produto promete, o link do ether.fi Cash, que é open source e quem fez. */
function AboutLines({ view }: { view: View }) {
  const tr = useTr();
  // no toque, os links têm 44px de verdade e nenhum vão: as áreas de toque não se cruzam (antes, 14px de sobreposição)
  const link = 'inline-flex min-h-6 items-center pointer-coarse:min-h-11';
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-faint pointer-coarse:space-y-0">
      <p className="font-medium text-muted">{tr(`${PRODUCT_TAGLINE.en}.`, `${PRODUCT_TAGLINE.pt}.`)}</p>
      {view === 'start' ? null : (
        <p>
          <a href="#/start" className={cx(link, 'gap-1 font-medium text-accent underline-offset-2 hover:underline')}>
            {tr(...START_LABEL)} <span aria-hidden>→</span>
          </a>
        </p>
      )}
      <p>
        <ExternalLink href={ETHERFI_CASH_URL} className={cx(link, 'text-muted hover:text-ink')}>
          {tr('Works with ether.fi Cash', 'Funciona com o ether.fi Cash')}
        </ExternalLink>
      </p>
      <p>{tr('Open source · your data stays in this browser', 'Open source · seus dados ficam neste navegador')}</p>
      <p>
        {tr('Made by', 'Feito por')}{' '}
        <ExternalLink href={AUTHOR.url} className={cx(link, 'hover:text-muted')}>{AUTHOR.handle}</ExternalLink>
      </p>
    </div>
  );
}

/** Os itens da navegação; a aba tocada já aparece como atual enquanto a tela dela monta. */
function MainNav({ variant, view, attention, quiet, onNav }: {
  variant: 'side' | 'bar';
  view: View;
  attention: Attention;
  quiet: boolean;
  onNav: (id: View) => void;
}) {
  const current = useTapped() ?? view;
  return (
    <>
      {NAV.map((item) => (
        <NavButton key={item.id} variant={variant} item={item} active={current === item.id} attention={attention} quiet={quiet} onClick={() => onNav(item.id)} />
      ))}
    </>
  );
}

/** Barra fina no topo enquanto a tela tocada monta: o toque foi aceito. */
function NavProgress({ view }: { view: View }) {
  const next = useTapped();
  if (!next || next === view) return null;
  return (
    <div aria-hidden className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
      <div className="nav-progress h-full w-1/3 bg-accent" />
    </div>
  );
}

// o número único de "esperando você" (barra, Portfólio, Gastos e Assinaturas mostram o mesmo); fica em Gastos,
// que reúne tudo em "Needs attention". Vermelho só quando algo é urgente de fato; senão, neutro.
// `quiet`: os dados na tela são o demo de reserva de uma carga que falhou; a barra não conta nem alarma.
function NavButton({ item, variant, active, attention, quiet, onClick }: {
  item: (typeof NAV)[number];
  variant: 'side' | 'bar';
  active: boolean;
  attention: Attention;
  quiet: boolean;
  onClick: () => void;
}) {
  const { locale } = useLocale();
  const tr = useTr();
  const count = item.id === 'spending' && !quiet ? attention.total : 0;
  // AI Insights desligada: um selo discreto "off" no item (a palavra também vai para o leitor de tela)
  const [insightsOn] = useInsightsOn();
  const off = item.id === 'insights' && !insightsOn;
  const urgent = attention.urgent;
  // a mesma composição que o Portfólio e Gastos mostram ("2 renewals to answer · 3 alerts")
  const parts = count ? attentionSummary(attention, locale) : '';
  const waiting = waitingLabel(count, locale);
  const Icon = item.icon;
  const side = variant === 'side';
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={count ? `${waiting}${urgent ? tr(' (urgent)', ' (urgente)') : ''}: ${parts}` : undefined}
      className={cx(
        'flex min-w-0 cursor-pointer items-center rounded-lg transition-colors',
        side
          ? 'w-full flex-row gap-2.5 px-3 py-2 text-sm pointer-coarse:min-h-11 active:bg-panel2'
          // barra: o toque escurece o fundo da coluna; deitado, ícone e rótulo lado a lado
          : 'min-h-12 flex-col justify-center gap-1 px-0 py-1.5 text-xs active:bg-panel2/70 short:min-h-11 short:flex-row short:gap-4 short:py-1',
        active ? cx('text-ink', side && 'bg-panel2') : cx('text-faint hover:text-muted', side && 'hover:bg-panel2/50'),
      )}
    >
      <span className="relative">
        <Icon aria-hidden className={cx(side ? 'size-4' : 'size-5', active && 'text-accent')} />
        {count && !side ? (
          // urgente: vermelho e com "!" depois do número (a cor sozinha não basta, 1.4.1)
          <span
            aria-hidden
            className={cx('tnum absolute -top-2 -right-3.5 min-w-[18px] rounded-full px-1 text-center text-xs leading-[18px] font-semibold text-bg', urgent ? 'bg-bad' : 'bg-info')}
          >
            {count}{urgent ? '!' : ''}
          </span>
        ) : null}
        {off && !side ? (
          <span aria-hidden className="absolute -top-2 -right-4 rounded-full border border-line2 bg-bg px-1 text-xs leading-4 text-faint">
            {tr('off', 'desl.')}
          </span>
        ) : null}
      </span>
      <span className={cx('max-w-full truncate', !side && 'tracking-tight sm:tracking-normal', active && 'font-medium')}>
        {side ? tr(...item.label) : (
          <>
            <span className="sm:hidden">{tr(...(item.short ?? item.label))}</span>
            <span className="hidden sm:inline">{tr(...item.label)}</span>
          </>
        )}
      </span>
      {count ? (
        <>
          {side ? (
            <span aria-hidden className={cx('tnum ml-auto rounded-full px-1.5 text-xs leading-5 font-medium', urgent ? 'bg-bad/15 text-bad' : 'bg-info/15 text-info')}>
              {count}{urgent ? '!' : ''}
            </span>
          ) : null}
          <span className="sr-only">, {waiting}{urgent ? tr(', something urgent', ', algo urgente') : ''}: {parts}</span>
        </>
      ) : null}
      {off ? (
        <>
          {side ? <span aria-hidden className="ml-auto rounded border border-line2 px-1.5 text-xs leading-5 text-faint">{tr('off', 'desligado')}</span> : null}
          <span className="sr-only">, {tr('off', 'desligado')}</span>
        </>
      ) : null}
    </button>
  );
}

/** Cabeçalho fixo de cobertura, com o recarregar; some ao rolar para baixo no celular e volta ao rolar para cima. */
function CoverageHeader({ onRefresh }: { onRefresh: () => void }) {
  const { source, loading, connection } = useStore();
  const tr = useTr();
  const ref = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useHideOnScroll(ref);
  return (
    <header
      ref={ref}
      onFocusCapture={() => setHidden(false)}
      className={cx(
        'sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur short:static short:min-h-11 short:py-1 sm:px-5',
        // só a saída desliza; a volta é imediata (deslizando, ele cobriria por um instante o que acabou de ganhar foco)
        hidden && 'transition-transform duration-200 max-lg:-translate-y-full',
      )}
    >
      <CoverageLine />
      <div className="flex shrink-0 items-center gap-2">
        {connection.kind === 'error' ? <span className="hidden sm:inline-flex"><Badge tone="warn">{tr('loading error', 'erro ao carregar')}</Badge></span> : null}
        {loading ? <Spinner /> : null}
        <button
          onClick={onRefresh}
          disabled={loading}
          aria-label={source === 'live' ? tr('Reload data', 'Recarregar dados') : tr('Connection', 'Conexão')}
          title={source === 'live' ? tr('Reload data from the connector', 'Recarregar dados do conector') : tr('Use it with your account', 'Usar com a sua conta')}
          className="tap flex size-9 cursor-pointer items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-panel2 hover:text-ink active:bg-panel2 disabled:cursor-not-allowed disabled:opacity-40 pointer-fine:lg:size-8"
        >
          <RefreshCw aria-hidden className="size-4" />
        </button>
      </div>
    </header>
  );
}

/** Sempre à vista: de onde vêm os números e até onde vai o histórico. */
function CoverageLine() {
  const { dataset, isSample } = useStore();
  const tr = useTr();
  const c = dataset.coverage;
  if (!c) return <div className="text-xs text-faint">{tr('No transactions loaded', 'Sem transações carregadas')}</div>;
  const days = Math.max(1, Math.round((Date.parse(c.to) - Date.parse(c.from)) / 86400000));
  return (
    <div className="min-w-0 text-xs leading-snug text-muted">
      {isSample ? tr('Sample data · ', 'Dados fictícios · ') : tr('History loaded: ', 'Histórico carregado: ')}
      {/* dateRange já prende cada data (NBSP) e só deixa quebrar antes do "–" (word joiner colado a ele), nunca depois */}
      <span className="text-ink">{dateRange(c.from, c.to)}</span>
      {/* o "·" fica preso ao que vem antes (NBSP): a linha nunca começa com ele */}
      <span className="whitespace-nowrap text-faint">{'\u00A0· '}{days}{'\u00A0'}{tr('days', 'dias')}</span>
      {!c.complete ? <span className="text-warn">{'\u00A0· '}{tr('older history not loaded', 'há histórico mais antigo não carregado')}</span> : null}
      {/* o conector omitiu linhas que não sabia afirmar: os totais são parciais (neutro: é um fato, não um alarme) */}
      {c.droppedRows ? <span className="text-muted">{'\u00A0· '}{tr('some rows left out by the source', 'a fonte deixou algumas linhas de fora')}</span> : null}
    </div>
  );
}

/** De onde vêm os dados. Neutro: é um estado, não um aviso (amarelo fica para o que pede atenção). */
function ModeBadge({ compact }: { compact?: boolean }) {
  const { source, connection, isSample } = useStore();
  const tr = useTr();
  // no celular o selo divide a linha com o nome: versão curta, para "for ether.fi Cash" não ser cortado
  if (connection.kind === 'connecting') {
    return <Badge tone="info">{tr('connecting…', 'conectando…')}</Badge>;
  }
  if (connection.kind === 'error') {
    if (compact) return <Badge tone="warn">{tr('error', 'erro')}</Badge>;
    return <Badge tone="warn">{source === 'live' ? tr('error · last load', 'erro · último carregamento') : tr('error · demo mode', 'erro · modo demo')}</Badge>;
  }
  // ?fixtures=sample: arquivos sintéticos do projeto, não dados reais nem o demo embutido
  if (isSample && source === 'fixtures') return <Badge tone="neutral">{compact ? tr('sample', 'exemplo') : tr('sample files', 'arquivos de exemplo')}</Badge>;
  if (isSample) return <Badge tone="neutral">{compact ? 'demo' : tr('demo', 'demonstração')}</Badge>;
  if (source === 'fixtures' || source === 'import') {
    return <Badge tone="neutral">{compact ? tr('real data', 'dados reais') : tr('real data · local file', 'dados reais · arquivo local')}</Badge>;
  }
  if (source === 'live' && connection.kind === 'connected') {
    return <Badge tone="good">{compact ? tr('real data', 'dados reais') : tr('connected · real data', 'conectado · dados reais')}</Badge>;
  }
  return <Badge tone="neutral">{compact ? 'demo' : tr('demo', 'demonstração')}</Badge>;
}

/** EN | PT: escolha salva neste navegador; inglês é o padrão. Dois botões de alternar (uma parada de Tab cada). */
function LocaleToggle() {
  const { setLocale } = useLocale();
  // a tela troca de idioma numa transição (não congela); o botão marca a escolha já no toque
  const { selected, switching } = useLocaleSwitch();
  const tr = useTr();
  return (
    <div role="group" aria-label={tr('Language', 'Idioma')} aria-busy={switching || undefined} className="inline-flex rounded-md border border-line p-0.5">
      {LOCALES.map((l) => (
        <button
          key={l.value}
          aria-pressed={selected === l.value}
          lang={l.tag}
          onClick={() => setLocale(l.value)}
          className={cx(
            // lado a lado: largura de 44px de verdade no toque (a área extra do `tap` de um invadiria a do outro)
            'tap min-h-8 min-w-11 cursor-pointer rounded px-1.5 text-xs font-medium transition-colors active:bg-panel2 pointer-fine:lg:min-h-6 pointer-fine:lg:min-w-8',
            selected === l.value ? 'bg-accent/15 text-accent' : 'text-faint hover:text-ink',
            switching && selected === l.value && 'animate-pulse',
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </LocaleProvider>
  );
}
