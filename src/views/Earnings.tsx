import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { Navigate } from '../lib/nav';
import { fxSummary, recentFx } from '../lib/analytics';
import { useStore } from '../state/store';
import { useTr } from '../state/locale';
import { useEarningsPrefs } from '../state/earningsPrefs';
import { saveSeen } from '../state/earningsSeen';
import { useEarnings, useEarningsNews } from '../components/earningsData';
import { EarningsHeader, FlowPanel, MilestonesPanel, periodFmt, SourcesPanel } from '../components/earningsPanels';
import { EarningsSummary } from '../components/earningsHero';
import { ItemsPanel } from '../components/earningsList';
import { AiHandoffPanel, ChangesPanel } from '../components/earningsNews';

/**
 * Ganhos: o que rende (os cofres Liquid e os outros ativos com APY) e o cashback previsto, ao lado das recorrências
 * (as assinaturas e contas que o app detecta e o que a pessoa digita), e o que esses ganhos pagam. No topo, o ouro (o
 * dono pediu): o total, a barra do que os ganhos pagam e quanto no Liquid cobriria 50%, 75% e 100%; embaixo, o recibo
 * item a item e o fluxo, ao lado da escada dos próximos marcos e das fontes com os controles.
 * Estimativa calculada neste navegador: informação e cenário, nunca recomendação.
 */
export function EarningsView({ onNavigate }: { onNavigate: Navigate }) {
  const tr = useTr();
  const { dataset } = useStore();
  const e = useEarnings();
  const [prefs, save] = useEarningsPrefs();
  const f = periodFmt(prefs, tr);
  // moeda do item à mão: o dólar e, quando o motor tem câmbio das compras, a moeda da casa
  const currencies = useMemo(() => {
    const home = dataset.homeCurrency;
    const fx = recentFx(dataset) ?? fxSummary(dataset);
    return home && home !== 'USD' && fx?.currency === home ? ['USD', home] : ['USD'];
  }, [dataset]);
  // anuidade de plano (Luxe, Pinnacle) com prova no extrato, do motor: a lista oferece, a pessoa decide
  const suggestions = e.suggestions;
  // o que mudou desde a última visita: a lista fica a da abertura da tela (o que a pessoa mexe aqui não vira aviso), e
  // a foto vista acompanha a tela enquanto ela está aberta (a próxima visita compara com o último estado visto)
  const news = useEarningsNews();
  const [opened] = useState(() => (news.changes.length && news.since ? { since: news.since, changes: news.changes } : null));
  const [dismissed, setDismissed] = useState(false);
  const { scope, current } = news;
  useEffect(() => {
    saveSeen(scope, current);
  }, [scope, current]);

  // no estado vazio não há valor para trocar entre mês e ano: a alternância some
  const header = <EarningsHeader e={e} f={f} period={prefs.period} onPeriod={e.empty ? undefined : (period) => save({ ...prefs, period })} />;

  // nada rende, não há taxa de cashback e não há recorrência: um cartão só, que explica a tela e oferece o item à mão
  if (e.empty) {
    return (
      <div className="space-y-5">
        {header}
        <ItemsPanel
          e={e}
          f={f}
          prefs={prefs}
          onPrefs={save}
          currencies={currencies}
          suggestions={suggestions}
          empty={{
            title: tr('Nothing to match up yet', 'Ainda não há o que comparar'),
            hint: tr(
              'This screen puts what you earn (Liquid yield, other assets with an APY and expected cashback) next to what repeats every month, and shows what the first pays of the second. The loaded data has no asset with a reported APY, no card spending and no recurring charge. Rent, a gym or anything paid elsewhere can be added by hand.',
              'Esta tela põe o que você ganha (rendimento do Liquid, outros ativos com APY e o cashback previsto) ao lado do que se repete todo mês, e mostra o que um paga do outro. Os dados carregados não têm ativo com APY informado, gasto no cartão nem cobrança recorrente. Aluguel, academia ou o que for pago em outro lugar dá para adicionar à mão.',
            ),
          }}
        />
        <p className="text-xs text-faint">
          <button type="button" onClick={() => onNavigate('portfolio')} className="tap -my-1 cursor-pointer py-1 underline decoration-dotted underline-offset-2 hover:text-muted">
            {tr('See the portfolio', 'Ver o portfólio')}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <EarningsSummary e={e} f={f} />
      {opened && !dismissed ? <ChangesPanel e={e} since={opened.since} changes={opened.changes} onDismiss={() => setDismissed(true)} /> : null}
      {/*
        duas colunas empilhadas independentes (nenhum vão de linha): à esquerda, a conta do mês (o recibo) e o fluxo que a
        desenha; à direita, a escada (que fala do Liquid, como a faixa da conta ao lado) e os ajustes. A ordem no DOM é
        conta → fluxo → marcos → ajustes: no celular empilha nessa ordem, e o Tab segue o desenho. As metas de 50/75/100%
        moram no resumo do topo
      */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <ItemsPanel e={e} f={f} prefs={prefs} onPrefs={save} currencies={currencies} suggestions={suggestions} />
          <FlowPanel e={e} f={f} />
        </div>
        <div className="flex flex-col gap-5 lg:col-span-5">
          <MilestonesPanel e={e} />
          <SourcesPanel e={e} prefs={prefs} onPrefs={save} />
          <AiHandoffPanel e={e} />
        </div>
      </div>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-faint">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {tr(
          'Estimate calculated in this browser from the data loaded; nothing leaves it. Yield stays in the asset’s value and APY changes; cashback is paid in a token whose price varies. Information and scenarios, not financial advice: check any number in the ether.fi app.',
          'Estimativa calculada neste navegador com os dados carregados; nada sai dele. O rendimento fica no valor do ativo e o APY muda; o cashback é pago num token de preço variável. Informação e cenário, não conselho financeiro: confira qualquer número no app da ether.fi.',
        )}
      </p>
    </div>
  );
}
