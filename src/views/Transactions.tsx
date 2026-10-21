import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { approxHome, fxSummary, inDays, isSpend, PERIODS, periodWindow, windowBeyondCoverage, type PeriodKey } from '../lib/analytics';
import { dateFull, dayHeading, monthYearLabel, timeOnly, tzLabel, usd } from '../lib/format';
import { groupLabel, txGroup, type TxGroup } from '../lib/labels';
import { categoryLabel } from '../lib/merchants';
import { cx } from '../lib/cx';
import { useLocale, useTr } from '../state/locale';
import type { Transaction } from '../lib/types';
import { useStore } from '../state/store';
import { Empty, Panel } from '../components/ui';
import { TxRow } from '../components/txrow';
import { DroppedRowsNote } from '../components/coverageNote';
import { SlidersHorizontal } from 'lucide-react';

const R2 = (n: number) => Math.round(n * 100) / 100;
/** Depósito seguido de aplicação no rendimento em até 10 minutos = um movimento só para quem lê */
const PAIR_WINDOW_MS = 10 * 60 * 1000;
/** Linhas por vez: 30 dias passavam de 11 mil px no celular, e a busca no histórico todo montava 10 mil nós */
const PAGE = 50;

// 16px no celular: abaixo disso o Safari do iPhone dá zoom ao focar o campo; borda com 3:1 sobre o painel
const fieldCls = 'min-h-11 w-full rounded-lg border border-field bg-panel px-3 text-base text-ink outline-none focus:border-muted pointer-fine:sm:min-h-9 sm:w-auto pointer-fine:sm:text-xs';

const PERIOD_LABEL: Record<PeriodKey, [en: string, pt: string]> = {
  '7d': ['Last 7 days', 'Últimos 7 dias'],
  '30d': ['Last 30 days', 'Últimos 30 dias'],
  '90d': ['Last 90 days', 'Últimos 90 dias'],
  all: ['All history', 'Todo o histórico'],
};
const isPeriod = (v: string): v is PeriodKey => Object.hasOwn(PERIOD_LABEL, v);

export function TransactionsView({ initialMonth, target }: { initialMonth?: string | null; target?: string | null }) {
  const { dataset } = useStore();
  const { locale } = useLocale();
  const tr = useTr();
  // um só controle de tempo: ou um período (7 dias … tudo) ou um mês ("AAAA-MM"), nunca os dois se anulando.
  // A tela remonta a cada mês ou transação pedidos pelo endereço (key no App), então o estado inicial basta:
  // vindo com uma transação (`target`, ex.: um alerta do Início), abre no mês dela e sem filtro que a esconda.
  const [when, setWhen] = useState<string>(
    () => (target ? dataset.transactions.find((t) => t.id === target)?.date.slice(0, 7) : undefined) ?? initialMonth ?? '30d',
  );
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [group, setGroup] = useState<'all' | TxGroup>('all');
  const [cardFilter, setCardFilter] = useState<string>('all');
  // celular: tipo, categoria e cartão ficam atrás de "Filtros"; o número diz quantos estão ligados
  const [filtersOpen, setFiltersOpen] = useState(false);
  const extraFilters = [group, category, cardFilter].filter((v) => v !== 'all').length;

  const fx = useMemo(() => fxSummary(dataset), [dataset]);
  // a lista segue a busca sem travar a digitação: o campo responde na hora e a lista acompanha quando der
  const deferredSearch = useDeferredValue(search);
  const q = deferredSearch.trim().toLowerCase();
  // quem busca um estabelecimento quer achar a compra onde ela estiver: a busca ignora o período
  const searching = q !== '';
  const win = periodWindow(dataset, isPeriod(when) ? when : 'all');
  const beyond = !searching && isPeriod(when) && windowBeyondCoverage(dataset, win.from);
  const zone = tzLabel();

  // os filtros só oferecem o que existe nos dados
  const groups = useMemo(() => [...new Set(dataset.transactions.map(txGroup))], [dataset]);
  // em ordem alfabética do nome exibido, no idioma da tela
  const categories = useMemo(
    () => [...new Set(dataset.transactions.filter((t) => t.type === 'purchase' && t.category).map((t) => t.category!))]
      .map((id) => ({ id, label: categoryLabel(id, locale) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [dataset, locale],
  );
  const usedCards = useMemo(() => {
    const ids = new Set(dataset.transactions.map((t) => t.cardId));
    return dataset.cards.filter((c) => ids.has(c.id));
  }, [dataset]);
  const availableMonths = useMemo(() => {
    const months = new Set(dataset.transactions.map((t) => t.date.slice(0, 7)));
    if (!isPeriod(when)) months.add(when);
    return [...months].sort((a, b) => b.localeCompare(a));
  }, [dataset, when]);

  const rows = useMemo(() => {
    const inTime = (t: Transaction) => (isPeriod(when) ? inDays(t.date, win.from, win.to) : t.date.slice(0, 7) === when);
    return dataset.transactions
      .filter((t) => searching || inTime(t))
      .filter((t) => (group === 'all' ? true : txGroup(t) === group))
      .filter((t) => (category === 'all' ? true : t.category === category))
      .filter((t) => (cardFilter === 'all' ? true : t.cardId === cardFilter))
      .filter((t) => (q ? `${t.merchant ?? ''} ${t.merchantRaw ?? ''}`.toLowerCase().includes(q) : true))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [dataset, when, win.from, win.to, searching, q, group, category, cardFilter]);

  // pareia depósito → aplicação no rendimento (só na visão geral, onde os dois aparecem juntos)
  const { visible, attachedTo } = useMemo(() => {
    const attached = new Map<string, Transaction>();
    const hidden = new Set<string>();
    if (group === 'all') {
      const ups = rows.filter((t) => t.type === 'top_up');
      for (const y of rows.filter((t) => t.type === 'yield_deposit')) {
        const match = ups.find((u) => !attached.has(u.id) && Math.abs(Date.parse(y.date) - Date.parse(u.date)) <= PAIR_WINDOW_MS);
        if (match) {
          attached.set(match.id, y);
          hidden.add(y.id);
        }
      }
    }
    return { visible: rows.filter((t) => !hidden.has(t.id)), attachedTo: attached };
  }, [rows, group]);
  // aplicação no rendimento que aparece junto do depósito: o destaque vai para a linha do depósito
  const highlightId = target ? ([...attachedTo].find(([, y]) => y.id === target)?.[0] ?? target) : null;

  // o total do dia vem do dia inteiro, mesmo que a lista ainda não mostre todas as linhas dele
  const byDay = useMemo(() => {
    const out: { day: string; rows: Transaction[]; spend: number }[] = [];
    for (const t of visible) {
      const day = t.date.slice(0, 10);
      let bucket = out.at(-1);
      if (!bucket || bucket.day !== day) {
        bucket = { day, rows: [], spend: 0 };
        out.push(bucket);
      }
      bucket.rows.push(t);
      if (isSpend(t)) bucket.spend = R2(bucket.spend + t.amountUsd);
    }
    return out;
  }, [visible]);

  // "mostrar mais": 50 linhas por vez, sempre em dias inteiros; trocar qualquer filtro volta às primeiras 50.
  // A linha aberta por um link entra mesmo que esteja além delas.
  const filterKey = `${when}|${group}|${category}|${cardFilter}|${q}`;
  const [page, setPage] = useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;
  const targetIndex = highlightId ? visible.findIndex((t) => t.id === highlightId) : -1;
  const wanted = Math.max(limit, targetIndex + 1);
  const shownDays: typeof byDay = [];
  let shownRows = 0;
  for (const d of byDay) {
    if (shownRows >= wanted) break;
    shownDays.push(d);
    shownRows += d.rows.length;
  }
  const remaining = visible.length - shownRows;
  // depois de "mostrar mais", o foco vai para o primeiro dia novo (o teclado não volta ao topo nem pula o que chegou)
  const focusDay = useRef<string | null>(null);
  useEffect(() => {
    if (!focusDay.current) return;
    document.querySelector<HTMLElement>(`[data-day="${focusDay.current}"]`)?.focus();
    focusDay.current = null;
  }, [limit]);
  const showMore = () => {
    focusDay.current = byDay[shownDays.length]?.day ?? null;
    setPage({ key: filterKey, limit: shownRows + PAGE });
  };

  const spendRows = rows.filter(isSpend);
  const totalSpend = R2(spendRows.reduce((s, t) => s + t.amountUsd, 0));
  const approx = approxHome(spendRows, fx);
  const cardById = new Map(dataset.cards.map((c) => [c.id, c]));

  const hasFilters = when !== '30d' || group !== 'all' || category !== 'all' || cardFilter !== 'all' || search !== '';
  const clearFilters = () => {
    setWhen('30d');
    setGroup('all');
    setCategory('all');
    setCardFilter('all');
    setSearch('');
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{tr('Activity', 'Extrato')}</h1>
        <p className="mt-0.5 text-sm text-muted">
          {tr(
            'Everything that went through the account, day by day. Only card spending counts toward spending totals.',
            'Tudo o que passou pela conta, dia a dia. Só o que é gasto no cartão entra nos totais de gasto.',
          )}
        </p>
      </div>

      {/*
        celular: busca em largura total, o período e um botão "Filtros" que abre tipo, categoria e cartão (selects de 16px
        não cabem dois por linha a 320px); desktop: tudo numa linha só
      */}
      <Panel className="!p-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr('Search merchant…', 'Buscar estabelecimento…')}
            aria-label={tr('Search merchant', 'Buscar estabelecimento')}
            className={cx(fieldCls, 'placeholder:text-faint sm:order-last sm:min-w-40 sm:flex-1')}
          />
          <div className="flex gap-2.5 sm:contents">
            <select
              aria-label={tr('Period or month', 'Período ou mês')}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              title={searching ? tr('While searching, all history is shown', 'Durante a busca, vale o histórico todo') : undefined}
              className={cx(fieldCls, 'min-w-0 flex-1 sm:flex-none', searching && 'opacity-60')}
            >
              <optgroup label={tr('Period', 'Período')}>
                {PERIODS.map((p) => <option key={p.key} value={p.key}>{tr(...PERIOD_LABEL[p.key])}</option>)}
              </optgroup>
              <optgroup label={tr('Month', 'Mês')}>
                {availableMonths.map((m) => <option key={m} value={m}>{monthYearLabel(m)}</option>)}
              </optgroup>
            </select>
            <button
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="activity-filters"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cx(
                'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3.5 text-sm transition-colors sm:hidden',
                extraFilters ? 'border-accent/40 text-accent' : 'border-field text-muted hover:text-ink',
              )}
            >
              <SlidersHorizontal aria-hidden className="size-4" />
              {/* abaixo de 360px só o ícone: o período precisa da largura */}
              <span className="max-[359px]:sr-only">{tr('Filters', 'Filtros')}</span>
              {extraFilters ? <span className="tnum">({extraFilters})</span> : null}
            </button>
          </div>
          <div id="activity-filters" className={cx('flex-col gap-2.5 sm:contents', filtersOpen ? 'flex' : 'hidden')}>
            <select aria-label={tr('Transaction type', 'Tipo de movimentação')} value={group} onChange={(e) => setGroup(e.target.value as 'all' | TxGroup)} className={fieldCls}>
              <option value="all">{tr('All types', 'Todos os tipos')}</option>
              {groups.map((g) => <option key={g} value={g}>{groupLabel(g, locale)}</option>)}
            </select>
            {categories.length ? (
              <select aria-label={tr('Category', 'Categoria')} value={category} onChange={(e) => setCategory(e.target.value)} className={fieldCls}>
                <option value="all">{tr('All categories', 'Todas as categorias')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            ) : null}
            {usedCards.length > 1 ? (
              <select aria-label={tr('Card', 'Cartão')} value={cardFilter} onChange={(e) => setCardFilter(e.target.value)} className={fieldCls}>
                <option value="all">{tr('All cards', 'Todos os cartões')}</option>
                {usedCards.map((c) => <option key={c.id} value={c.id}>{c.nickname} •• {c.lastFour}</option>)}
              </select>
            ) : null}
          </div>
          {hasFilters ? (
            <button
              onClick={clearFilters}
              className="min-h-11 cursor-pointer rounded-lg border border-line2 px-3 text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink active:bg-panel2 sm:order-last pointer-fine:sm:min-h-9 pointer-fine:sm:text-xs"
            >
              {tr('Clear filters', 'Limpar filtros')}
            </button>
          ) : null}
        </div>
      </Panel>

      <DroppedRowsNote />

      {/* sem pontos soltos: cada informação é um bloco que quebra inteiro para a linha de baixo */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1 text-xs text-muted">
        {/* o total anunciado a cada filtro (4.1.3); a busca já vem adiada, então não fala a cada tecla */}
        <span role="status">
          {/* a mesma unidade do "mostrar mais": as linhas da lista; a aplicação que vem junto do depósito é dita à parte */}
          {visible.length === 1 ? tr('1 transaction', '1 movimentação') : tr(`${visible.length} transactions`, `${visible.length} movimentações`)}
          {attachedTo.size ? (
            <span className="text-faint">
              {' '}
              {attachedTo.size === 1
                ? tr('(+1 move to yield, shown with its deposit)', '(+1 aplicação no rendimento, junto do depósito)')
                : tr(`(+${attachedTo.size} moves to yield, shown with their deposits)`, `(+${attachedTo.size} aplicações no rendimento, junto dos depósitos)`)}
            </span>
          ) : null}
          {'\u00A0· '}
          {tr('card spending:', 'gasto no cartão:')} <span className="tnum whitespace-nowrap text-ink">{usd(totalSpend)}</span>
          {approx ? <span className="tnum whitespace-nowrap text-faint"> ({approx})</span> : null}
        </span>
        {searching ? <span className="text-info">{tr('searching all history', 'buscando em todo o histórico')}</span> : null}
        {zone ? (
          <span className="text-faint">
            {tr('times in ', 'horários em ')}<span className="whitespace-nowrap">{zone}</span>{tr(' (your time zone)', ' (seu fuso)')}
          </span>
        ) : null}
        {beyond && dataset.coverage ? (
          <span className="text-warn">{tr(`history loaded starts on ${dateFull(dataset.coverage.from)}`, `histórico carregado começa em ${dateFull(dataset.coverage.from)}`)}</span>
        ) : null}
      </div>

      {byDay.length === 0 ? (
        searching ? (
          <Empty
            title={tr(`Nothing matches “${deferredSearch.trim()}” in all history.`, `Nada com “${deferredSearch.trim()}” em todo o histórico.`)}
            hint={tr('Check the spelling, or clear the type, category or card filter.', 'Confira a grafia ou limpe o filtro de tipo, categoria ou cartão.')}
          />
        ) : (
          <Empty
            title={tr('No transactions match these filters.', 'Nenhuma movimentação com esses filtros.')}
            hint={tr('Pick another period or month, or clear the filters above.', 'Escolha outro período ou mês, ou limpe os filtros acima.')}
          />
        )
      ) : (
        <div className="space-y-4">
          {shownDays.map((d) => (
            <Panel key={d.day} className="!p-0 overflow-hidden">
              <h2
                data-day={d.day}
                tabIndex={-1}
                className="flex flex-wrap items-center justify-between gap-x-3 border-b border-line bg-panel2/40 px-4 py-2 text-xs outline-none"
              >
                <span className="font-medium text-muted">{dayHeading(d.day)}</span>
                {d.spend ? <span className="tnum font-normal text-faint">{tr(`spent that day ${usd(d.spend)}`, `gasto no dia ${usd(d.spend)}`)}</span> : null}
              </h2>
              <div className="divide-y divide-line">
                {d.rows.map((t) => (
                  <TxRow
                    key={t.id}
                    t={t}
                    meta={timeOnly(t.date)}
                    card={usedCards.length > 1 && t.cardId ? cardById.get(t.cardId) : undefined}
                    attached={attachedTo.get(t.id)}
                    highlight={t.id === highlightId}
                  />
                ))}
              </div>
            </Panel>
          ))}
          {remaining > 0 ? (
            <button
              onClick={showMore}
              className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-xl border border-line2 px-4 text-sm text-muted transition-colors hover:bg-panel2 hover:text-ink active:bg-panel2"
            >
              {/* o mesmo padrão do Histórico: "Mostrar mais 50 · faltam N", contando as mesmas linhas da lista */}
              {tr(`Show ${Math.min(PAGE, remaining)} more`, `Mostrar mais ${Math.min(PAGE, remaining)}`)}
              <span className="tnum text-faint">{'\u00A0· '}{tr(`${remaining} left`, `faltam ${remaining}`)}</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
