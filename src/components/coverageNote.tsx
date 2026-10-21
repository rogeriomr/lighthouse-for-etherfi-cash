import { CircleAlert } from 'lucide-react';
import { useStore } from '../state/store';
import { useTr } from '../state/locale';

/**
 * Faixa de "faltam linhas" (D1): o conector marcou alguma página como `incomplete`, então há transações no meio do
 * histórico que ele não soube informar com exatidão. Os totais são parciais e nenhum mês se compara com outro.
 * Não aparece quando nada faltou.
 */
export function DroppedRowsNote() {
  const { dataset } = useStore();
  const tr = useTr();
  if (!dataset.coverage?.droppedRows) return null;
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-xs text-muted">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
      <p>
        <span className="font-medium text-ink">{tr('Rows missing: partial totals.', 'Faltam linhas: totais parciais.')}</span>{' '}
        {tr(
          'ether.fi left out some transactions it couldn\'t state exactly. The totals below only add up what came, and months aren\'t compared with each other until the history loads complete.',
          'A ether.fi deixou de fora transações que não soube informar com exatidão. Os totais abaixo somam só o que veio, e os meses não são comparados entre si até o histórico chegar completo.',
        )}
      </p>
    </div>
  );
}
