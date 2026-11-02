import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AllocationRow, Earnings } from '../lib/earnings';
import { useEscape } from './charts';
import { nb, pct, usd } from '../lib/format';
import { cx } from '../lib/cx';
import { useTr } from '../state/locale';
import { EARN_COLORS, sourceColor } from './earningsData';
import { partialPct, type PeriodFmt } from './earningsPanels';

// A segunda metade do recibo da tela Ganhos (a primeira são as linhas dos itens, em earningsList.tsx): o que entra
// (cashback dos itens, cashback do resto do cartão, o Liquid cofre por cofre com o saldo, os outros com APY), o total
// e "já pagam N de M", com a barra de cobertura. Os números vêm prontos do motor (e.receipt) e fecham no centavo.

type Tr = ReturnType<typeof useTr>;

/**
 * Uma linha de fonte na tabela do recibo (ícone | rótulo nas colunas do nome e do custo | sinal | ganho). `ruled`: o
 * traço curto sobre o sinal e o ganho, a soma armada da coluna acima. `band`: a faixa do Liquid (fundo panel2, cantos
 * de 10 px na primeira e na última linha), o único fundo diferente do recibo. `quiet`: a linha discreta dos outros.
 */
function SourceRow({ color, hollow, label, detail, value, quiet, ruled, band, first, last }: {
  color?: string;
  /** amostra vazada: nada entra por esta linha */
  hollow?: boolean;
  label: ReactNode;
  detail?: ReactNode;
  value: string;
  quiet?: boolean;
  ruled?: boolean;
  band?: boolean;
  first?: boolean;
  last?: boolean;
}) {
  const cell = cx('py-2 align-top', band && 'bg-panel2');
  return (
    <tr>
      <td className={cx(cell, band && first && 'rounded-tl-[10px]', band && last && 'rounded-bl-[10px]')}>
        {hollow
          ? <span aria-hidden className="mt-1.5 block size-2.5 rounded-[3px] border border-field" />
          : <span aria-hidden className="mt-1.5 block size-2.5 rounded-[3px]" style={{ backgroundColor: color }} />}
      </td>
      <th scope="row" colSpan={2} className={cx(cell, 'pr-2 text-left font-normal')}>
        <span className={cx('break-words', quiet ? 'text-[13px] text-muted' : 'text-ink')}>{label}</span>
        {detail ? <span className="mt-0.5 block text-xs leading-snug text-faint">{detail}</span> : null}
      </th>
      {/* o sinal em ink, 15 px, encostado à direita da coluna dele: todo "+" fica em pé, um sobre o outro */}
      <td className={cx(cell, 'text-right text-[15px] leading-5 font-medium text-ink', ruled && 'border-t border-line2')}>+</td>
      <td
        className={cx(
          cell,
          'tnum text-right whitespace-nowrap',
          quiet ? 'text-muted' : 'text-ink',
          ruled && 'border-t border-line2',
          band && first && 'rounded-tr-[10px]',
          band && last && 'rounded-br-[10px]',
        )}
      >
        {value}
      </td>
    </tr>
  );
}

/**
 * A legenda do fecho em duas partes: o que pagam (em destaque) e o resto, mais miúdo. "Já pagam 10 das 17" +
 * " e parte de mais 1 · US$ 132,50 de US$ 554,76"; com tudo pago, a sobra; sem ganho ou sem item, o motivo.
 */
function statementParts(e: Earnings, f: PeriodFmt, tr: Tr): { lead: string; tail: string } {
  const a = e.allocation;
  const n = a.count;
  if (!n) return { lead: '', tail: tr('Nothing recurring in the count yet: add an item by hand to see what these earnings pay.', 'Ainda não há recorrência na conta: adicione um item à mão para ver o que esses ganhos pagam.') };
  const paid = f.amt(a.coveredMonthly, a.coveredAnnual);
  const total = f.amt(a.totalMonthly, a.totalAnnual);
  const money = nb(tr(` · ${paid} of ${total}`, ` · ${paid} de ${total}`));
  if (!(e.totalMonthly > 0)) return { lead: tr('Nothing paid yet', 'Ainda não pagam nada'), tail: money };
  const c = a.coveredCount;
  const subs = a.allSubscriptions;
  if (c === n) {
    const left = a.leftoverMonthly > 0.005 ? nb(tr(` · ${f.amt(a.leftoverMonthly, a.leftoverAnnual)} left over`, ` · sobram ${f.amt(a.leftoverMonthly, a.leftoverAnnual)}`)) : '';
    return { lead: tr(n === 1 ? 'They already pay for it' : `They already pay for all ${n}`, n === 1 ? (subs ? 'Já pagam a assinatura' : 'Já pagam o item') : `Já pagam ${subs ? 'todas as' : 'todos os'} ${n}`), tail: left };
  }
  const part = a.partialCount ? tr(' and part of 1 more', ' e parte de mais 1') : '';
  if (c === 0) return { lead: tr(`They pay part of 1 of ${n}`, `Pagam parte de 1 ${subs ? 'das' : 'dos'} ${n}`), tail: money };
  return { lead: tr(`They already pay for ${c} of ${n}`, `Já pagam ${c} ${subs ? 'das' : 'dos'} ${n}`), tail: `${part}${money}` };
}

/**
 * O que entra, o total e o resultado. Cada linha leva a amostra da cor da fonte (a mesma do fluxo e da barra), e o
 * texto fica nos tons de texto. O Liquid mostra o saldo de cada cofre em destaque: quanto a pessoa tem, o APY e o
 * rendimento. Os outros com APY ficam numa linha discreta. Com a base "só recorrências", a linha do resto some.
 */
export function ReceiptSources({ e, f }: { e: Earnings; f: PeriodFmt }) {
  const tr = useTr();
  const r = e.receipt;
  const a = e.allocation;
  const hasItems = r.rows.length > 0;
  const vaults = r.liquid.holdings;
  // a frase do motor ("US$ 3.819,41 por mês: a base menos os itens acima"), sem "× 1,73%": a taxa mostrada é arredondada
  // e a multiplicação não fecharia no centavo com a linha; a conta exata fica no "por quê? (a conta)"
  const restDetail = r.rest ? nb(e.texts.receipt.restDetail) : null;
  const total = 'border-t-[3px] border-double border-line2 pt-3 align-baseline';
  return (
    <tbody>
      <tr>
        <th scope="colgroup" colSpan={5} className="pt-5 pb-1 text-left text-xs font-medium uppercase tracking-[0.12em] text-faint">
          {tr('Where your earnings come from', 'De onde vêm os ganhos')}
        </th>
      </tr>
      {hasItems ? (
        <SourceRow
          ruled
          color={EARN_COLORS.cashback}
          hollow={!(r.itemsCashback.monthly > 0)}
          label={a.allSubscriptions ? tr('Cashback on these subscriptions', 'Cashback dessas assinaturas') : tr('Cashback on these items', 'Cashback desses itens')}
          detail={tr('the sum of the column above', 'a soma da coluna acima')}
          value={f.amt(r.itemsCashback.monthly, r.itemsCashback.annual)}
        />
      ) : null}
      {r.rest ? (
        <SourceRow
          ruled={!hasItems}
          color={EARN_COLORS.cashback}
          hollow={!(r.rest.cashbackMonthly > 0)}
          label={e.texts.receipt.restLabel}
          detail={restDetail}
          value={f.amt(r.rest.cashbackMonthly, r.rest.cashbackAnnual)}
        />
      ) : null}
      {!hasItems && !r.rest ? (
        <SourceRow ruled hollow quiet label="Cashback" detail={tr('No card spending to estimate it from.', 'Sem gasto no cartão para estimar.')} value={f.amt(0, 0)} />
      ) : null}
      {/* o Liquid em destaque: quanto a pessoa tem em cada cofre (fora da coluna de número: não entra na soma) e o rendimento */}
      {vaults.length ? vaults.map((h, k) => (
        <SourceRow
          key={h.asset}
          band
          first={k === 0}
          last={k === vaults.length - 1}
          color={sourceColor('vault', h.asset)}
          label={h.asset}
          detail={(
            <>
              {tr('you have ', 'você tem ')}
              <span className="tnum font-medium text-ink">{usd(h.value)}</span>
              {nb(tr(` · earns ≈ ${pct(h.apy, 1)} a year`, ` · rende ≈ ${pct(h.apy, 1)} ao ano`))}
            </>
          )}
          value={f.amt(h.monthly, h.annual)}
        />
      )) : (
        <SourceRow hollow quiet label="Liquid" detail={tr('No balance earning in Liquid today.', 'Sem saldo rendendo no Liquid hoje.')} value={f.amt(0, 0)} />
      )}
      {r.other && r.other.monthly > 0 ? (
        <SourceRow
          quiet
          color={EARN_COLORS.other}
          label={nb(tr(`Other APY assets · ${r.other.holdings.map((h) => h.asset).join(', ')}`, `Outros com APY · ${r.other.holdings.map((h) => h.asset).join(', ')}`))}
          detail={nb(tr(`${usd(r.other.value)} · ${pct(r.other.avgApy, 1)} a year`, `${usd(r.other.value)} · ${pct(r.other.avgApy, 1)} ao ano`))}
          value={f.amt(r.other.monthly, r.other.annual)}
        />
      ) : null}
      {/* o total: traço duplo (o código de total de recibo) e o "=" na coluna dos sinais */}
      <tr>
        <td className={cx(total, 'mt-2')} />
        <th scope="row" colSpan={2} className={cx(total, 'text-left text-[15px] font-medium text-ink')}>
          {f.yearly ? tr('Your earnings a year', 'Seus ganhos por ano') : tr('Your earnings a month', 'Seus ganhos por mês')}
        </th>
        <td className={cx(total, 'text-right text-[15px] font-medium text-ink')}>=</td>
        <td className={cx(total, 'tnum text-right font-display text-lg font-semibold tracking-tight whitespace-nowrap text-ink sm:text-[22px]')}>
          {f.amt(r.total.monthly, r.total.annual)}
        </td>
      </tr>
    </tbody>
  );
}

/**
 * A conclusão, logo abaixo do total: um bloco por item, na ordem da lista (largura pelo custo; accent no pago, a fração
 * no parcial, o trilho no resto), e a legenda "Já pagam 10 das 17 e parte de mais 1 · US$ X de US$ Y". As fontes já
 * foram listadas acima com as amostras: aqui não se repete nenhum valor delas.
 */
export function CoverageBlocks({ e, f, className }: { e: Earnings; f: PeriodFmt; className?: string }) {
  const tr = useTr();
  const a = e.allocation;
  const { lead, tail } = statementParts(e, f, tr);
  const [hover, setHover] = useState<number | null>(null);
  useEscape(hover != null, setHover);
  const wrapRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // a dica fica embaixo da barra, centrada no bloco apontado e sem sair do bloco todo: nunca cobre os outros blocos,
  // e o ponteiro anda pela barra lendo um por um. Medida antes de pintar
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const wrap = wrapRef.current;
    const seg = hover != null ? barsRef.current?.children[hover] : null;
    if (!tip || !wrap || !(seg instanceof HTMLElement)) return;
    const c = wrap.getBoundingClientRect();
    const s = seg.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(c.width - w, s.left + s.width / 2 - c.left - w / 2))}px`;
  });
  if (!a.count) return <p className={cx('mt-3 text-sm leading-relaxed text-muted', className)}>{tail}</p>;
  const pctCovered = a.coverage >= 1 || a.coveredCount === a.count ? 100 : a.coverage > 0 ? partialPct(a.coverage) : 0;
  const step = (i: number) => setHover(Math.max(0, Math.min(a.rows.length - 1, i)));
  const tip = hover != null ? a.rows[hover] : null;
  const tipText = tip ? segmentText(tip, f, tr) : null;
  return (
    <div className={cx('mt-4', className)}>
      {/* o grupo entra no Tab: as setas leem cada bloco (uma região viva diz o item e quanto os ganhos pagam dele) */}
      <div
        ref={wrapRef}
        className="relative rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        tabIndex={0}
        role="group"
        aria-label={`${tr('Recurring items paid by your earnings, one block per item', 'Recorrências pagas pelos seus ganhos, um bloco por item')}. ${tr('Arrow keys read each block.', 'As setas leem cada bloco.')}`}
        onPointerLeave={(ev) => { if (ev.pointerType === 'mouse') setHover(null); }}
        onBlur={() => setHover(null)}
        onKeyDown={(ev) => {
          if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); step(hover == null ? 0 : hover + 1); }
          if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); step(hover == null ? a.rows.length - 1 : hover - 1); }
          if (ev.key === 'Home') { ev.preventDefault(); step(0); }
          if (ev.key === 'End') { ev.preventDefault(); step(a.rows.length - 1); }
          if (ev.key === 'Escape') setHover(null);
        }}
      >
        <div
          ref={barsRef}
          role="meter"
          aria-label={tr('Recurring items paid by your earnings', 'Recorrências pagas pelos seus ganhos')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pctCovered}
          aria-valuetext={`${lead}${tail}`}
          className="flex gap-0.5"
        >
          {a.rows.map((r, i) => (
            // o alvo do ponteiro é mais alto que o bloco (8 px acima e abaixo): fácil de apontar e de tocar
            <div
              key={r.item.key}
              aria-hidden="true"
              className="min-w-1 cursor-default py-2"
              style={{ flexGrow: r.item.monthly, flexBasis: 0 }}
              onPointerEnter={(ev) => { if (ev.pointerType === 'mouse') setHover(i); }}
              onPointerDown={() => setHover(hover === i ? null : i)}
            >
              <div
                className={cx(
                  'h-2.5 overflow-hidden rounded-[3px] bg-accent/15 transition-opacity duration-150 motion-reduce:transition-none',
                  hover != null && hover !== i && 'opacity-35',
                )}
              >
                {r.status !== 'uncovered' ? <div className="h-full bg-accent" style={{ width: r.status === 'covered' ? '100%' : `${Math.max(8, r.share * 100)}%` }} /> : null}
              </div>
            </div>
          ))}
        </div>
        <span className="sr-only" aria-live="polite">{tipText ? `${tipText.title}: ${tipText.lines.join('. ')}` : ''}</span>
        {tip && tipText ? (
          <div
            ref={tipRef}
            aria-hidden="true"
            onPointerDown={(ev) => { if (ev.pointerType !== 'mouse') setHover(null); }}
            className="absolute top-full left-0 z-20 -mt-1 w-max max-w-[min(17rem,100%)] min-w-44 rounded-xl border border-line2 bg-bg px-3 py-2 text-xs leading-4 shadow-xl"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 font-medium break-words text-ink">{tipText.title}</span>
              <span className="tnum whitespace-nowrap text-muted">{tipText.cost}</span>
            </div>
            <div className="mt-1.5 space-y-1 border-t border-line pt-1.5">
              {tipText.lines.map((l, k) => (
                <div key={k} className={cx('flex items-start gap-2', k === 0 ? 'text-ink' : 'text-muted')}>
                  {k === 0 ? <span aria-hidden className={cx('mt-1 size-2 shrink-0 rounded-full', tip.status === 'uncovered' ? 'border border-field' : 'bg-accent')} /> : <span aria-hidden className="mt-1 size-2 shrink-0" />}
                  <span className="tnum">{l}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {lead ? <span className="font-medium text-ink">{nb(lead)}</span> : null}
        {tail}
      </p>
      <p aria-hidden className="mt-0.5 text-xs text-faint">
        <span className="pointer-coarse:hidden">{tr('Point at a block to see what it pays.', 'Passe o mouse num bloco para ver o que ele paga.')}</span>
        <span className="hidden pointer-coarse:inline">{tr('Tap a block to see what it pays.', 'Toque num bloco para ver o que ele paga.')}</span>
      </p>
    </div>
  );
}

/** O que a dica de um bloco diz: o item, o custo e quanto os ganhos pagam dele, o cashback que ele gera e a posição. */
function segmentText(r: AllocationRow, f: PeriodFmt, tr: Tr): { title: string; cost: string; lines: string[] } {
  const cost = f.amt(r.item.monthly, r.item.annual);
  const paid = f.amt(r.paidMonthly, r.paidAnnual);
  const per = f.per;
  const lines = [
    r.status === 'covered'
      ? tr('Paid in full by your earnings', 'Pago inteiro pelos seus ganhos')
      : r.status === 'partial'
        ? tr(`${pct(partialPct(r.share))} paid: ${paid} of ${cost}`, `${pct(partialPct(r.share))} pago: ${paid} de ${cost}`)
        : tr('Not paid by your earnings yet', 'Ainda não pago pelos ganhos'),
    ...(r.item.onCard && r.item.cashbackMonthly > 0
      ? [tr(`Earns ≈ ${f.amt(r.item.cashbackMonthly, r.item.cashbackAnnual)} in cashback`, `Gera ≈ ${f.amt(r.item.cashbackMonthly, r.item.cashbackAnnual)} de cashback`)]
      : !r.item.onCard ? [tr('Not paid with the card: no cashback', 'Fora do cartão: sem cashback')] : []),
    tr(`#${r.rank} in the order${r.item.origin === 'manual' ? ' · added by you' : ''}`, `${r.rank}º na ordem${r.item.origin === 'manual' ? ' · adicionado por você' : ''}`),
  ];
  return { title: r.item.name, cost: `${r.item.approx ? '≈ ' : ''}${cost} ${per}`, lines };
}
