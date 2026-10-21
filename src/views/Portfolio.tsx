import { lazy, Suspense, useEffect, useMemo } from 'react';
import { ArrowRight, ShieldCheck, Wallet } from 'lucide-react';
import { portfolioSummary, recentFx } from '../lib/analytics';
import { usd } from '../lib/format';
import { connectorAcceptsOrigin } from '../lib/config';
import type { AccountTab, Navigate } from '../lib/nav';
import { useStore } from '../state/store';
import { useLocale, useTr } from '../state/locale';
import { Button, Empty, Panel, PanelTitle, Segmented, Why } from '../components/ui';
import {
  AssetsByClass, AttentionLine, ClassSplit, DimCents, EarningCredit, FxLine, PartialNote, RewardsPanel, SpendBridge, snapshotLabel, useAccountName,
} from '../components/portfolio';
import { DemoBanner } from '../components/demoBanner';

// cartões, depósito e conexão (a antiga Conta) num pedaço próprio: a Conexão é grande e o Portfólio é a primeira tela
const loadSections = () => import('./Account');
const AccountSection = lazy(() => loadSections().then((m) => ({ default: m.AccountSection })));

// label: [en, pt]
const TABS: { value: AccountTab; label: [string, string] }[] = [
  { value: 'summary', label: ['Overview', 'Resumo'] },
  { value: 'cards', label: ['Cards', 'Cartões'] },
  { value: 'deposit', label: ['Deposit', 'Depositar'] },
  { value: 'connect', label: ['Connection', 'Conexão'] },
];

/**
 * A primeira tela: quanto a pessoa tem, em dólar, com o "≈" na moeda da casa, a divisão por tipo de ativo, o que
 * rende e o crédito à parte. Cartões, Depositar e Conexão são abas dela. No demo, a faixa do demo abre a tela.
 */
export function PortfolioView({ tab, onTab, onNavigate }: { tab: AccountTab; onTab: (t: AccountTab) => void; onNavigate: Navigate }) {
  const tr = useTr();
  const { isSample } = useStore();
  // as seções baixam em segundo plano: a primeira troca de aba não espera a rede
  useEffect(() => {
    const id = setTimeout(() => void loadSections().catch(() => undefined), 2000);
    return () => clearTimeout(id);
  }, []);
  const summary = tab === 'summary';
  return (
    <div className="space-y-5">
      {/* origem que o conector aceita: direto para a Conexão; senão, o guia "Comece aqui" (em todas as abas: as abas não pulam) */}
      {isSample ? <DemoBanner onStart={() => (connectorAcceptsOrigin() ? onTab('connect') : onNavigate('start'))} /> : null}
      {/* as abas ficam no mesmo lugar da árvore em todas as abas: trocar pelas setas não remonta o grupo nem perde o foco */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {summary ? <AccountLine /> : (
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{tr('Portfolio', 'Portfólio')}</h1>
            <p className="mt-0.5 text-sm text-muted">{tr('Cards, deposits and connection.', 'Cartões, depósito e conexão.')}</p>
          </div>
        )}
        {/* no celular as abas ocupam a largura toda e cabem a 320px (2 × 2 abaixo de 360px) */}
        <Segmented fill ariaLabel={tr('Portfolio section', 'Seção do portfólio')} value={tab} onChange={onTab} options={TABS.map((t) => ({ value: t.value, label: tr(...t.label) }))} />
      </div>
      {summary ? <Overview onTab={onTab} onNavigate={onNavigate} /> : (
        <Suspense fallback={<SectionLoading />}>
          <AccountSection tab={tab} />
        </Suspense>
      )}
    </div>
  );
}

function SectionLoading() {
  const tr = useTr();
  return (
    <div role="status" className="h-64 animate-pulse rounded-2xl bg-panel2/50">
      <span className="sr-only">{tr('Loading…', 'Carregando…')}</span>
    </div>
  );
}

/** A conta e quando o saldo foi lido; o ponto no acento é o de status do guia. */
function AccountLine() {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  const name = useAccountName();
  const when = snapshotLabel(dataset.snapshotAt, dataset.timeZone, locale);
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 break-words text-ink">{name}</span>
      {/* sem "·" entre os dois: no celular a data desce de linha e não começa com ele */}
      {when ? <span className="whitespace-nowrap text-faint">{tr(`read ${when}`, `lido em ${when}`)}</span> : null}
    </p>
  );
}

/** O resumo: o título com o valor, o "≈", a barra, o rendendo e o crédito, a lista, a ponte para os gastos e as recompensas. */
function Overview({ onTab, onNavigate }: { onTab: (t: AccountTab) => void; onNavigate: Navigate }) {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  const s = useMemo(() => portfolioSummary(dataset, locale), [dataset, locale]);
  const fx = useMemo(() => recentFx(dataset), [dataset]);
  const name = useAccountName();
  const when = snapshotLabel(dataset.snapshotAt, dataset.timeZone, locale);

  // conta que nunca recebeu depósito: tudo seria US$ 0,00 sem explicação; um estado normal, dito com todas as letras
  if (dataset.neverFunded && s.total === 0 && !s.classes.length) {
    return (
      <>
        <h1 className="sr-only">{tr('Portfolio', 'Portfólio')}</h1>
        <Panel>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line2 bg-panel2">
              <Wallet aria-hidden className="size-5 text-accent" />
            </span>
            <div className="min-w-0">
              <h2 className="font-medium">{tr('This account hasn’t been funded yet', 'Esta conta ainda não foi financiada')}</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
                {tr(
                  'There’s no balance, asset or credit limit until the first deposit. That’s a normal state, not an error: deposit through the ether.fi app and this page fills in.',
                  'Não há saldo, ativo nem limite de crédito até o primeiro depósito. É um estado normal, não um erro: deposite pelo app da ether.fi e esta página se preenche.',
                )}
              </p>
              <Button className="mt-4 pointer-coarse:min-h-11" onClick={() => onTab('deposit')}>
                {tr('How to deposit', 'Como depositar')} <ArrowRight aria-hidden className="size-4" />
              </Button>
            </div>
          </div>
        </Panel>
      </>
    );
  }

  const split = s.classes.length > 0;
  // a barra mede os ativos listados; quando o saldo da conta passa deles, o subtítulo diz de quanto ela fala
  const listedNote = s.unlisted > 0.01;
  const missing = s.partialReasons.includes('portfolio_missing');

  return (
    <>
      <div>
        {/* o título é a frase do guia: o valor grande, as palavras em volta esmaecidas; o leitor de tela ouve a tela e o valor inteiro */}
        <h1 className="font-display text-[clamp(1.875rem,9vw,4rem)] leading-[1.02] font-semibold tracking-tight text-balance [overflow-wrap:anywhere]">
          <span className="sr-only">{tr('Portfolio: ', 'Portfólio: ')}</span>
          <span className="font-normal text-faint">{tr('You have', 'Você tem')}</span>{' '}
          <span className="text-ink"><DimCents value={s.total} /></span>{' '}
          <span className="font-normal text-faint">{tr('at ether.fi', 'na ether.fi')}</span>
        </h1>
        <p className="mt-2 text-sm text-muted">
          {s.totalSource === 'account' ? tr('Asset value', 'Valor dos ativos') : tr('Sum of the assets listed', 'Soma dos ativos listados')}
        </p>
        <PartialNote s={s} />
        {fx ? <FxLine total={s.total} fx={fx} /> : null}
      </div>

      {/* o que espera você (renovações e alertas) mora em Gastos: esta linha leva até o painel, só quando há algo */}
      <AttentionLine onOpen={() => onNavigate('spending', { target: 'attention' })} />

      {/*
        desktop (a partir de 1100px): a barra e a lista em 8 colunas, o rendendo e o crédito em 4 ao lado das duas; no
        celular, a ordem do DOM: barra, rendendo e crédito, lista
      */}
      <div className="grid grid-cols-1 gap-5 min-[1100px]:grid-cols-12">
        {split ? (
          <Panel className="min-[1100px]:col-span-8">
            <PanelTitle>{tr('How it’s split', 'Como está dividido')}</PanelTitle>
            <p className="-mt-2 mb-4 text-xs leading-relaxed text-muted">
              {listedNote
                ? tr(
                    `Of the ${usd(s.listedTotal)} in assets listed, by asset type.`,
                    `Dos ${usd(s.listedTotal)} em ativos listados, por tipo de ativo.`,
                  )
                : tr('By asset type.', 'Por tipo de ativo.')}
            </p>
            <ClassSplit s={s} />
          </Panel>
        ) : null}

        <div className={split ? 'min-[1100px]:col-span-4 min-[1100px]:row-span-2 min-[1100px]:self-start' : 'min-[1100px]:col-span-4 min-[1100px]:self-start'}>
          <EarningCredit s={s} />
        </div>

        <Panel className="min-[1100px]:col-span-8">
          <PanelTitle hint={split ? <span className="tnum">{usd(s.listedTotal)}</span> : undefined}>{tr('Your assets', 'Seus ativos')}</PanelTitle>
          {split ? (
            <AssetsByClass s={s} />
          ) : (
            <Empty
              title={missing ? tr('The asset list didn’t load.', 'A lista de ativos não carregou.') : tr('No assets in the account.', 'Sem ativos na conta.')}
              hint={missing ? tr('The total above still comes from the account. Try loading again from Connection.', 'O total acima ainda vem da conta. Tente carregar de novo pela Conexão.') : undefined}
            />
          )}
          <div className="mt-4">
            <Why>
              {tr(
                '"Backs the card" = the asset counts as collateral for the credit limit. Each asset’s value is the one the ether.fi app shows on its portfolio screen. The type (fiat, crypto, stocks, bonds, commodities, other) is this dashboard’s reading of each asset: a dollar or euro stablecoin is fiat even inside a Liquid vault, which the list marks. An asset it can’t place with confidence goes to Other.',
                '"Garante o cartão" = o ativo conta como garantia para o limite de crédito. O valor de cada ativo é o que o app da ether.fi mostra na tela de portfólio. O tipo (fiat, cripto, ações, renda fixa, commodities, outros) é a leitura deste painel para cada ativo: stablecoin de dólar ou de euro é fiat, mesmo dentro de um cofre Liquid, que a lista sinaliza. Ativo que ele não sabe classificar com segurança vai para Outros.',
              )}
            </Why>
          </div>
        </Panel>
      </div>

      <SpendBridge onOpen={() => onNavigate('spending')} />

      <RewardsPanel />

      <div className="space-y-1.5 text-xs text-faint">
        <p className="flex items-center gap-2">
          <ShieldCheck aria-hidden className="size-3.5 shrink-0" />
          {tr('Read-only. Double-check any number in the ether.fi app before acting on it.', 'Só leitura. Confira qualquer número no app da ether.fi antes de agir.')}
        </p>
        <p>
          {[
            name,
            when ? tr(`read ${when}`, `lido em ${when}`) : null,
            tr('amounts in US dollars, as the ether.fi connector reports them', 'valores em dólar, como o conector da ether.fi informa'),
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
    </>
  );
}
