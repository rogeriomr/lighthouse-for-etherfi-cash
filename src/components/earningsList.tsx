import { Fragment, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Cycle } from '../lib/subscriptionTypes';
import {
  MANUAL_LIMITS, manualKey, moveInOrder, removeManual, suggestionToManual, toggleExcluded, upsertManual,
  type AllocationRow, type Earnings, type EarningsItem, type EarningsPrefs, type ManualItem, type SuggestedItem,
} from '../lib/earnings';
import { nb, pct, usd, usd0 } from '../lib/format';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';
import { Badge, Button, Empty, Panel, PanelTitle, Why } from './ui';
import { ManualForm, type ManualValue } from './earningsParts';
import { partialPct, type PeriodFmt } from './earningsPanels';
import { ReceiptSources } from './earningsReceipt';
import { PartialPie } from './earningsFlow';

// A lista da tela Ganhos: cada recorrência na ordem em que os ganhos pagam, com ✓ (pago inteiro), a barra do parcial e
// a sobra no fim. "Editar a lista" mostra os controles de cada linha: subir e descer (fixa a ordem), tirar da conta e,
// nos itens à mão, editar e remover. "Adicionar à mão" abre o formulário no topo. Tudo fica só neste navegador.

type Tr = ReturnType<typeof useTr>;

function cycleLabel(c: Cycle, tr: Tr): string {
  switch (c) {
    case 'weekly': return tr('weekly', 'semanal');
    case 'monthly': return tr('monthly', 'mensal');
    case 'quarterly': return tr('quarterly', 'trimestral');
    case 'semiannual': return tr('every 6 months', 'semestral');
    case 'annual': return tr('yearly', 'anual');
    default: return tr('cycle unknown', 'ciclo desconhecido');
  }
}

function originLabel(i: EarningsItem, tr: Tr): string {
  if (i.origin === 'manual') return tr('added by you', 'adicionado por você');
  if (i.origin === 'bill') return tr('recurring bill', 'conta recorrente');
  return tr('subscription', 'assinatura');
}

const newId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* contexto sem crypto.randomUUID (http fora do localhost) */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

/** Ícone da situação: ✓ no pago inteiro, um anel com a fração no parcial, o anel vazio no que não tem cobertura. */
function StatusMark({ status, share }: { status: AllocationRow['status'] | 'excluded'; share: number }) {
  // o parcial é uma pizza (contorno + setor da fração), não um anel colorido: a forma o distingue do "ainda não" (1.4.1)
  if (status === 'partial') return <PartialPie share={share} className="mt-0.5 size-5 shrink-0" />;
  const r = 7;
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0">
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--color-line2)" strokeWidth="2" />
      {status === 'covered' ? (
        <>
          <circle cx="10" cy="10" r={r + 1} fill="var(--color-good)" />
          <path d="M6.2 10.2 8.8 12.7 13.8 7.6" fill="none" stroke="var(--color-bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
    </svg>
  );
}

export function ItemsPanel({ e, f, prefs, onPrefs, currencies, suggestions = [], empty }: {
  e: Earnings;
  f: PeriodFmt;
  prefs: EarningsPrefs;
  onPrefs: (p: EarningsPrefs) => void;
  /** moedas do formulário: 'USD' e, quando há câmbio das compras, a moeda da casa */
  currencies: string[];
  /** anuidade de plano achada no extrato (e.suggestions): a pessoa decide se entra */
  suggestions?: SuggestedItem[];
  /** o texto da lista vazia quando a tela inteira está vazia (o único cartão dela) */
  empty?: { title: string; hint: string };
}) {
  const tr = useTr();
  const a = e.allocation;
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [removed, setRemoved] = useState<ManualItem | null>(null);

  const keys = a.rows.map((r) => r.item.key);
  const full = prefs.manual.length >= MANUAL_LIMITS.items;

  const focusLater = (selector: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());

  const move = (key: string, name: string, delta: number) => {
    const order = moveInOrder(keys, key, delta);
    onPrefs({ ...prefs, order });
    const pos = order.indexOf(key) + 1;
    setSaid(tr(`${name} is now number ${pos}.`, `${name} agora é o número ${pos}.`));
    const dir = delta < 0 ? 'up' : 'down';
    const other = delta < 0 ? 'down' : 'up';
    requestAnimationFrame(() => {
      const btn = document.querySelector<HTMLButtonElement>(`[data-move="${CSS.escape(key)}:${dir}"]`);
      (btn && !btn.disabled ? btn : document.querySelector<HTMLElement>(`[data-move="${CSS.escape(key)}:${other}"]`))?.focus();
    });
  };

  const resetOrder = () => {
    const next = { ...prefs };
    delete next.order;
    onPrefs(next);
    setSaid(tr('Back to cheapest first.', 'De volta ao mais barato primeiro.'));
  };

  const exclude = (item: EarningsItem) => {
    const i = keys.indexOf(item.key);
    onPrefs(toggleExcluded(prefs, item.key));
    if (item.excluded) {
      setSaid(tr(`${item.name} is back in the count.`, `${item.name} voltou para a conta.`));
      focusLater(`[data-exclude="${CSS.escape(item.key)}"]`);
    } else {
      setSaid(tr(`${item.name} left the count.`, `${item.name} saiu da conta.`));
      // o foco vai para a linha seguinte (ou a anterior); sem outra, para o "pôr de volta" do próprio item, no fim da lista
      const next = keys[i + 1] ?? keys[i - 1] ?? item.key;
      focusLater(`[data-exclude="${CSS.escape(next)}"]`);
    }
  };

  const save = (v: ManualValue, id?: string) => {
    const item: ManualItem = { id: id ?? newId(), ...v };
    onPrefs(upsertManual(prefs, item));
    setSaid(id ? tr(`${v.name} updated.`, `${v.name} atualizado.`) : tr(`${v.name} added.`, `${v.name} adicionado.`));
    setRemoved(null);
    if (id) {
      setEditId(null);
      focusLater(`[data-edit="${CSS.escape(manualKey(id))}"]`);
    } else {
      setAdding(false);
      focusLater('#earnings-add');
    }
  };

  const remove = (m: ManualItem) => {
    onPrefs(removeManual(prefs, m.id));
    setRemoved(m);
    setSaid(tr(`${m.name} removed.`, `${m.name} removido.`));
    focusLater('#earnings-undo');
  };

  const undo = () => {
    if (!removed) return;
    onPrefs(upsertManual(prefs, removed));
    setSaid(tr(`${removed.name} is back.`, `${removed.name} voltou.`));
    setRemoved(null);
    focusLater('#earnings-add');
  };

  const iconBtn = 'tap inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line2 px-3 text-xs text-muted transition-colors hover:bg-panel2 hover:text-ink active:bg-panel2 disabled:cursor-not-allowed disabled:opacity-40 pointer-fine:min-h-8';

  const controls = (item: EarningsItem, index: number | null) => (
    <div className="flex flex-wrap gap-2">
      {index !== null ? (
        <>
          <button type="button" data-move={`${item.key}:up`} disabled={index === 0} onClick={() => move(item.key, item.name, -1)} className={iconBtn} aria-label={tr(`Move ${item.name} up`, `Subir ${item.name}`)}>
            <ArrowUp aria-hidden className="size-4" />
          </button>
          <button type="button" data-move={`${item.key}:down`} disabled={index === keys.length - 1} onClick={() => move(item.key, item.name, 1)} className={iconBtn} aria-label={tr(`Move ${item.name} down`, `Descer ${item.name}`)}>
            <ArrowDown aria-hidden className="size-4" />
          </button>
        </>
      ) : null}
      <button type="button" data-exclude={item.key} onClick={() => exclude(item)} className={iconBtn}>
        {item.excluded ? <Eye aria-hidden className="size-4" /> : <EyeOff aria-hidden className="size-4" />}
        {item.excluded ? tr('Count it again', 'Pôr de volta') : tr('Leave out', 'Tirar da conta')}
        <span className="sr-only">: {item.name}</span>
      </button>
      {item.manual ? (
        <>
          <button type="button" data-edit={item.key} onClick={() => setEditId(item.manual!.id)} className={iconBtn}>
            <Pencil aria-hidden className="size-4" />{tr('Edit', 'Editar')}<span className="sr-only">: {item.name}</span>
          </button>
          <button type="button" onClick={() => remove(item.manual!)} className={cx(iconBtn, 'hover:text-bad')}>
            <Trash2 aria-hidden className="size-4" />{tr('Remove', 'Remover')}<span className="sr-only">: {item.name}</span>
          </button>
        </>
      ) : null}
    </div>
  );

  const editForm = (m: ManualItem) => (
    <tr key={`edit-${m.id}`}>
      <td colSpan={5} className="border-b border-line py-3">
      <ManualForm
        title={tr(`Edit ${m.name}`, `Editar ${m.name}`)}
        submitLabel={tr('Save', 'Salvar')}
        currencies={currencies.includes(m.currency) ? currencies : [...currencies, m.currency]}
        initial={{ name: m.name, amount: m.amount, currency: m.currency, cycle: m.cycle, onCard: m.onCard }}
        onSave={(v) => save(v, m.id)}
        onCancel={() => {
          setEditId(null);
          focusLater(`[data-edit="${CSS.escape(manualKey(m.id))}"]`);
        }}
      />
      </td>
    </tr>
  );

  const row = (r: AllocationRow, index: number) => {
    const i = r.item;
    if (i.manual && editId === i.manual.id) return editForm(i.manual);
    const share = partialPct(r.share);
    const fem = a.allSubscriptions;
    const statusSr = r.status === 'covered'
      ? tr('paid in full', fem ? 'paga inteira' : 'pago inteiro')
      : r.status === 'partial' ? tr(`${pct(share)} paid`, `${pct(share)} ${fem ? 'paga' : 'pago'}`) : tr('not paid yet', fem ? 'ainda não paga' : 'ainda não pago');
    // o detalhe só quando diz algo: o quanto do parcial, à mão, conta recorrente, o ciclo que não é mensal (o anual com
    // o preço de verdade, de onde sai o valor por mês), fora do cartão
    const detail = [
      r.status === 'partial' ? tr(`${pct(share)} paid`, `${pct(share)} ${fem ? 'paga' : 'pago'}`) : null,
      i.origin === 'manual' ? tr('by hand', 'à mão') : i.origin === 'bill' ? originLabel(i, tr) : null,
      i.cycle === 'annual' ? tr(`yearly · ${usd(i.annual)}/yr`, `anual · ${usd(i.annual)}/ano`) : i.cycle !== 'monthly' ? cycleLabel(i.cycle, tr) : null,
      i.onCard ? null : tr('not on the card', 'não é no cartão'),
    ].filter(Boolean).join(' · ');
    const line = editing ? '' : 'border-b border-line';
    const cell = cx('py-2.5 align-top', line);
    return (
      <Fragment key={i.key}>
        <tr>
          <td className={cell}>
            <StatusMark status={r.status} share={r.share} />
            <span className="sr-only">{statusSr}</span>
          </td>
          <th scope="row" className={cx(cell, 'pr-2 text-left font-normal')}>
            {editing ? <span className="tnum mr-1.5 text-faint">{r.rank}.</span> : null}
            <span className="break-words text-ink">{i.name}</span>
            {detail ? <span className="mt-0.5 block text-xs leading-snug text-faint">{nb(detail)}</span> : null}
          </th>
          {/* o custo; a coluna do sinal fica vazia (os itens são parcelas, não fontes); o cashback que o item gera */}
          <td className={cx(cell, 'tnum text-right whitespace-nowrap text-ink')}>
              {i.approx ? <span aria-hidden>≈{' '}</span> : null}
              {i.approx ? <span className="sr-only">{tr('about ', 'cerca de ')}</span> : null}
              {f.amt(i.monthly, i.annual)}
          </td>
          <td className={cell} />
          <td className={cx(cell, 'tnum text-right whitespace-nowrap text-muted')}>
            {i.onCard ? f.amt(i.cashbackMonthly, i.cashbackAnnual) : (
              // fora do cartão não há cashback: um traço, nunca US$ 0,00 (zero parece cashback calculado)
              <>
                <span aria-hidden>—</span>
                <span className="sr-only">{tr('no cashback, not on the card', 'sem cashback, não é no cartão')}</span>
              </>
            )}
          </td>
        </tr>
        {editing ? (
          <tr>
            <td className="border-b border-line" />
            <td colSpan={4} className="border-b border-line pb-3">{controls(i, index)}</td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  /** Item fora da conta: no fim da seção, esmaecido, fora da soma da coluna do custo, com "fora da conta" no ganho. */
  const excludedRow = (i: EarningsItem) => {
    if (i.manual && editId === i.manual.id) return editForm(i.manual);
    const cell = cx('py-2.5 align-top', editing ? '' : 'border-b border-line');
    return (
      <Fragment key={i.key}>
        <tr>
          <td className={cell}>
            <StatusMark status="excluded" share={0} />
            <span className="sr-only">{tr('left out of the count', 'fora da conta')}</span>
          </td>
          <th scope="row" className={cx(cell, 'pr-2 text-left font-normal')}>
            <span className="break-words text-faint">{i.name}</span>
          </th>
          <td className={cx(cell, 'tnum text-right whitespace-nowrap text-faint')}>{f.amt(i.monthly, i.annual)}</td>
          <td className={cell} />
          <td className={cx(cell, 'text-right text-xs text-faint')}>{tr('left out', 'fora da conta')}</td>
        </tr>
        {editing ? (
          <tr>
            <td className="border-b border-line" />
            <td colSpan={4} className="border-b border-line pb-3">{controls(i, null)}</td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  const nothing = !a.rows.length && !a.excluded.length;
  return (
    <Panel>
      {/* um selo só, no título: vale para a tabela inteira */}
      <PanelTitle hint={e.empty ? undefined : <Badge>{tr('Estimate', 'Estimativa')}</Badge>}>
        {f.yearly ? tr('Your year, added up', 'A conta do ano') : tr('Your month, added up', 'A conta do mês')}
      </PanelTitle>
      <p role="status" className="sr-only">{said}</p>

      {/*
        o recibo é uma tabela de verdade (as colunas alinham sozinhas e o leitor de tela lê "Netflix, custo, ganho"):
        ícone | nome | custo | sinal | ganho. O sinal tem coluna própria para todo "+" e o "=" ficarem em pé, um sobre
        o outro. Bordas nas células (border-separate), para a faixa do Liquid poder ter cantos
      */}
      {/* o mesmo recuo na primeira e na última célula de toda linha (cabeçalho e faixa do Liquid incluídos): os valores
          ficam numa coluna só, e a faixa não empurra o número dela para fora */}
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm [&_tr>*:first-child]:pl-2 [&_tr>*:last-child]:pr-2 sm:[&_tr>*:last-child]:pr-3">
        <caption className="sr-only">
          {tr(
            'Your month added up: what each recurring item costs, the cashback it earns, where your earnings come from and their total.',
            'A conta do mês: quanto custa cada recorrência, o cashback que ela gera, de onde vêm os ganhos e o total deles.',
          )}
        </caption>
        {/* as larguras do revisor (ícone 24/26, ganho 90/124) com o recuo das bordas somado; no celular, a coluna do
            ganho cabe o total de 18 px sem invadir a do sinal */}
        <colgroup>
          <col className="w-8 sm:w-[34px]" />
          <col />
          <col className="w-[76px] sm:w-[104px]" />
          <col className="w-4 sm:w-[22px]" />
          <col className="w-[108px] sm:w-[136px]" />
        </colgroup>
        <thead>
          <tr className="text-xs text-faint">
            <td />
            <th scope="col" className="pb-2 text-left font-normal"><span className="sr-only">{tr('Item', 'Item')}</span></th>
            <th scope="col" className="pb-2 text-right font-normal">{f.yearly ? tr('cost/year', 'custo/ano') : tr('cost/month', 'custo/mês')}</th>
            <td />
            <th scope="col" className="pb-2 text-right font-normal">{f.yearly ? tr('earned/year', 'ganho/ano') : tr('earned/month', 'ganho/mês')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="colgroup" colSpan={2} className="border-b border-line py-2 text-left text-xs font-medium uppercase tracking-[0.12em] text-faint">
              {a.allSubscriptions || nothing ? tr('Your subscriptions', 'Suas assinaturas') : tr('Your recurring items', 'Suas recorrências')}
            </th>
            <td className="tnum border-b border-line py-2 text-right font-medium whitespace-nowrap text-ink">
              {a.rows.length ? f.amt(e.receipt.itemsCost.monthly, e.receipt.itemsCost.annual) : null}
            </td>
            <td colSpan={2} className="border-b border-line" />
          </tr>
          {a.rows.length > 1 && (editing || a.order === 'custom') ? (
            <tr>
              <td colSpan={5} className="pt-2 text-xs text-muted">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{a.order === 'custom' ? tr('In the order you set', 'Na ordem que você fixou') : tr('Cheapest first: use the arrows to set your own order', 'Do mais barato ao mais caro: use as setas para fixar a sua ordem')}</span>
                  {a.order === 'custom' ? (
                    <button type="button" onClick={resetOrder} className="tap -my-1 cursor-pointer py-1 text-faint underline decoration-dotted underline-offset-2 hover:text-ink">
                      {tr('back to cheapest first', 'voltar ao mais barato primeiro')}
                    </button>
                  ) : null}
                </span>
              </td>
            </tr>
          ) : null}
          {removed ? (
            <tr>
              <td colSpan={5} className="pt-2">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-panel2/50 px-3 py-2 text-xs text-muted">
                  <span>{tr(`${removed.name} removed.`, `${removed.name} removido.`)}</span>
                  <button id="earnings-undo" type="button" onClick={undo} className="tap -my-1 cursor-pointer py-1 font-medium text-ink underline underline-offset-2">
                    {tr('Undo', 'Desfazer')}
                  </button>
                </p>
              </td>
            </tr>
          ) : null}
          {nothing && !adding ? (
            <tr>
              <td colSpan={5} className="pt-3">
                <Empty
                  title={empty?.title ?? tr('No recurring items found in the loaded history.', 'Nenhuma recorrência no histórico carregado.')}
                  hint={empty?.hint ?? tr(
                    'Subscriptions and recurring bills the dashboard finds show up here. Rent, a gym or anything paid elsewhere can be added by hand.',
                    'Assinaturas e contas recorrentes que o painel encontra aparecem aqui. Aluguel, academia ou o que for pago em outro lugar dá para adicionar à mão.',
                  )}
                />
              </td>
            </tr>
          ) : null}
          {a.rows.map((r, i) => row(r, i))}
          {a.excluded.map((i) => excludedRow(i))}
          {suggestions.map((s) => (
            <tr key={s.id}>
              <td colSpan={5} className="pt-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-line2 bg-panel2/40 px-4 py-3">
                  <p className="min-w-0 text-sm text-muted">
                    {nb(tr(
                      `Found in your statement: ${s.name}, ${usd0(s.amount)} a year. Add it to the count?`,
                      `Achado no seu extrato: ${s.name}, ${usd0(s.amount)} por ano. Pôr na conta?`,
                    ))}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      onPrefs(upsertManual(prefs, suggestionToManual(s)));
                      setSaid(tr(`${s.name} added.`, `${s.name} adicionado.`));
                      focusLater('#earnings-add');
                    }}
                    className="min-h-11 shrink-0 pointer-fine:min-h-8"
                  >
                    <Plus aria-hidden className="size-4" />{tr('Add', 'Adicionar')}<span className="sr-only">: {s.name}</span>
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {/* as ferramentas logo depois do último item (no título, a 390 elas quebravam junto com ele) */}
          <tr>
            <td colSpan={5} className="pt-3">
              <span className="flex flex-wrap gap-2">
                <Button
                  id="earnings-add"
                  variant="outline"
                  disabled={full || adding}
                  onClick={() => {
                    setAdding(true);
                    setEditId(null);
                  }}
                  className="min-h-11 pointer-fine:min-h-8"
                >
                  <Plus aria-hidden className="size-4" />{tr('Add by hand', 'Adicionar à mão')}
                </Button>
                {!nothing ? (
                  <Button variant={editing ? 'primary' : 'ghost'} aria-pressed={editing} onClick={() => setEditing((v) => !v)} className="min-h-11 pointer-fine:min-h-8">
                    {editing ? tr('Done', 'Pronto') : tr('Edit list', 'Editar a lista')}
                  </Button>
                ) : null}
              </span>
            </td>
          </tr>
          {adding ? (
            <tr>
              <td colSpan={5} className="pt-3">
                <ManualForm
                  title={tr('New recurring item', 'Nova recorrência')}
                  submitLabel={tr('Add', 'Adicionar')}
                  currencies={currencies}
                  onSave={(v) => save(v)}
                  onCancel={() => {
                    setAdding(false);
                    focusLater('#earnings-add');
                  }}
                />
              </td>
            </tr>
          ) : null}
        </tbody>
        {/* de onde vêm os ganhos e o total (fecham no centavo com as linhas do motor) */}
        {e.empty ? null : <ReceiptSources e={e} f={f} />}
      </table>

      {a.unpriced.length ? (
        <p className="mt-3 text-xs leading-relaxed text-faint">
          {tr('Out of the count for lack of a known price: ', 'Fora da conta por não ter preço conhecido: ')}
          {a.unpriced.map((u) => `${u.name} (${u.reason === 'no_fx' ? tr('no exchange rate', 'sem câmbio') : tr('cycle unknown', 'ciclo desconhecido')})`).join(', ')}.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {e.empty ? null : <Why label={tr('why? (the math)', 'por quê? (a conta)')}>{e.texts.why.receipt}</Why>}
        <Why label={e.empty ? undefined : tr('why? (the order)', 'por quê? (a ordem)')}>{e.texts.why.allocation}</Why>
        {full ? <span className="text-xs text-faint">{tr(`Up to ${MANUAL_LIMITS.items} items by hand.`, `Até ${MANUAL_LIMITS.items} itens à mão.`)}</span> : null}
      </div>
    </Panel>
  );
}
