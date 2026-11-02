import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { cleanItemName, MANUAL_LIMITS, manualErrorText, manualItemErrors } from '../lib/earnings';
import { cx } from '../lib/cx';
import { useLocale, useTr } from '../state/locale';
import { Button, Segmented } from './ui';

// Peças genéricas da tela Ganhos (views/Earnings.tsx): o formulário de item à mão e a escada de marcos. Recebem números
// e textos prontos; do motor (src/lib/earnings.ts), só os limites e as regras do item à mão. O medidor do fecho (blocos
// por item) mora em earningsReceipt.tsx, junto da conta.

// ---------- item à mão ----------

interface ManualDraft {
  name: string;
  /** texto do campo, como a pessoa digitou (vírgula ou ponto) */
  amount: string;
  currency: string;
  cycle: 'monthly' | 'annual';
  onCard: boolean;
}

/** O que o formulário entrega (o id é de quem chama): o mesmo formato do ManualItem do motor */
export interface ManualValue {
  name: string;
  amount: number;
  currency: string;
  cycle: 'monthly' | 'annual';
  onCard: boolean;
}

const NAME_MAX = MANUAL_LIMITS.name;
const AMOUNT_MAX = MANUAL_LIMITS.amount;

/** "12,90", "12.90", "1.234,56" ou "1,234.56" → o número em centavos inteiros; texto que não é número → NaN. */
function parseLoose(text: string): number {
  const t = text.trim().replace(/\s/g, '');
  // o último separador é o decimal; os de antes são de milhar
  const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  const normalized = last < 0 ? t : `${t.slice(0, last).replace(/[.,]/g, '')}.${t.slice(last + 1)}`;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100) / 100;
}

/** O valor digitado, se servir para um item (acima de zero, até o limite); senão null. */
function parseAmount(text: string): number | null {
  const n = parseLoose(text);
  return Number.isFinite(n) && n > 0 && n <= AMOUNT_MAX ? n : null;
}

/**
 * Nome, valor, ciclo e "pago com o cartão?". A moeda é o dólar; quando a moeda da casa é outra e há câmbio das compras,
 * dá para digitar nela (o motor converte, com "≈"). Valida ao enviar: o erro aparece sob o campo (ligado a ele por
 * aria-describedby) e o foco vai para o primeiro campo com erro. Abre com o foco no nome. Nada sai deste navegador.
 */
export function ManualForm({ initial, currencies, submitLabel, onSave, onCancel, title }: {
  initial?: ManualValue;
  /** 'USD' primeiro; a moeda da casa depois, quando houver câmbio */
  currencies: string[];
  submitLabel: string;
  onSave: (v: ManualValue) => void;
  onCancel: () => void;
  title: string;
}) {
  const tr = useTr();
  const { locale } = useLocale();
  const id = useId();
  const dec = (n: number) => (locale === 'pt' ? String(n).replace('.', ',') : String(n));
  const [draft, setDraft] = useState<ManualDraft>(() => ({
    name: initial?.name ?? '',
    amount: initial ? dec(initial.amount) : '',
    currency: initial && currencies.includes(initial.currency) ? initial.currency : currencies[0] ?? 'USD',
    cycle: initial?.cycle ?? 'monthly',
    onCard: initial?.onCard ?? false,
  }));
  const [errors, setErrors] = useState<{ name?: string; amount?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = cleanItemName(draft.name);
    const amount = parseAmount(draft.amount);
    // as mesmas regras do motor (manualItemErrors), com o texto dele; o valor digitado é lido aqui, com vírgula ou ponto
    const next: typeof errors = {};
    for (const err of manualItemErrors({ name, amount: amount ?? parseLoose(draft.amount), currency: draft.currency, cycle: draft.cycle })) {
      if (err.field === 'name' && !next.name) next.name = manualErrorText(err.code, locale);
      if (err.field === 'amount' && !next.amount) next.amount = manualErrorText(err.code, locale);
    }
    setErrors(next);
    if (next.name) {
      nameRef.current?.focus();
      return;
    }
    if (next.amount || amount === null) {
      amountRef.current?.focus();
      return;
    }
    onSave({ name, amount, currency: draft.currency, cycle: draft.cycle, onCard: draft.onCard });
  };

  const field = 'min-h-11 w-full rounded-lg border border-field bg-panel2 px-3 text-base text-ink placeholder:text-faint aria-[invalid=true]:border-bad pointer-fine:sm:min-h-9 pointer-fine:sm:text-sm';
  return (
    <form noValidate onSubmit={submit} aria-labelledby={`${id}-t`} className="rounded-xl border border-line2 bg-panel2/40 p-4">
      <h3 id={`${id}-t`} className="text-sm font-medium text-ink">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="min-w-0">
          <label htmlFor={`${id}-n`} className="text-xs text-muted">{tr('Name', 'Nome')}</label>
          <input
            ref={nameRef}
            id={`${id}-n`}
            value={draft.name}
            maxLength={NAME_MAX}
            autoComplete="off"
            onChange={(e) => {
              setDraft((d) => ({ ...d, name: e.target.value }));
              // o erro some quando a pessoa corrige; volta só se o próximo envio ainda falhar
              if (errors.name) setErrors((x) => ({ ...x, name: undefined }));
            }}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${id}-ne` : undefined}
            placeholder={tr('e.g. Gym', 'ex.: Academia')}
            className={cx(field, 'mt-1')}
          />
          {errors.name ? <p id={`${id}-ne`} className="mt-1 text-xs text-bad">{errors.name}</p> : null}
        </div>
        <div>
          <label htmlFor={`${id}-a`} className="text-xs text-muted">
            {currencies.length > 1 ? tr('Amount', 'Valor') : tr('Amount (US$)', 'Valor (US$)')}
          </label>
          <div className="mt-1 flex gap-2">
            {currencies.length > 1 ? (
              <select
                aria-label={tr('Currency', 'Moeda')}
                value={draft.currency}
                onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
                className="min-h-11 shrink-0 cursor-pointer rounded-lg border border-field bg-panel2 px-2 text-base text-ink pointer-fine:sm:min-h-9 pointer-fine:sm:text-sm"
              >
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : null}
            <input
              ref={amountRef}
              id={`${id}-a`}
              value={draft.amount}
              inputMode="decimal"
              autoComplete="off"
              onChange={(e) => {
                setDraft((d) => ({ ...d, amount: e.target.value }));
                if (errors.amount) setErrors((x) => ({ ...x, amount: undefined }));
              }}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={errors.amount ? `${id}-ae` : undefined}
              placeholder={locale === 'pt' ? '12,90' : '12.90'}
              className={cx(field, 'tnum min-w-0')}
            />
          </div>
          {errors.amount ? <p id={`${id}-ae`} className="mt-1 text-xs text-bad">{errors.amount}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xs text-muted">{tr('Charged', 'Cobrado')}</span>
          <Segmented
            ariaLabel={tr('Charged', 'Cobrado')}
            value={draft.cycle}
            onChange={(cycle) => setDraft((d) => ({ ...d, cycle }))}
            options={[
              { value: 'monthly', label: tr('monthly', 'por mês') },
              { value: 'annual', label: tr('yearly', 'por ano') },
            ]}
          />
        </div>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink pointer-fine:min-h-8">
          <input
            type="checkbox"
            checked={draft.onCard}
            onChange={(e) => setDraft((d) => ({ ...d, onCard: e.target.checked }))}
            className="size-5 cursor-pointer accent-[var(--color-accent)] pointer-fine:size-4"
          />
          {tr('Paid with the ether.fi card', 'Pago com o cartão ether.fi')}
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" variant="primary" className="justify-center pointer-coarse:min-h-11 max-sm:flex-1">{submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} className="justify-center pointer-coarse:min-h-11 max-sm:flex-1">{tr('Cancel', 'Cancelar')}</Button>
      </div>
    </form>
  );
}

// ---------- escada de marcos ----------

export interface LadderStep {
  key: string;
  /** "Com ≈ US$ 1.600 a mais rendendo no Liquid," */
  lead: string;
  /** "os ganhos cobririam também Claude por inteiro" */
  covers: string;
  /** "11 de 13 cobertas" */
  after: string;
}

/**
 * Os próximos marcos como cenário, não como meta: sem barra que cresce, sem número de passo, sem cor de rendimento.
 * Cada degrau tem um marcador vazado, ligado ao seguinte por um traço tracejado (o código de "projeção"), e uma frase só,
 * em peso normal. Quem chama põe o selo, a nota do rodapé e um "por quê?" no fim.
 */
export function Ladder({ steps }: { steps: LadderStep[] }) {
  return (
    <ol>
      {steps.map((s, i) => (
        <li key={s.key} className="relative grid grid-cols-[0.875rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
          {/* o conector vai do marcador até o próximo degrau */}
          {i < steps.length - 1 ? <span aria-hidden className="absolute top-4 bottom-0 left-[6.5px] border-l border-dashed border-line2" /> : null}
          <span aria-hidden className="relative mt-[5px] size-2.5 rounded-full border-2 border-muted bg-panel" />
          <div className="min-w-0">
            <p className="text-[15px] leading-snug text-ink">{s.lead}</p>
            <p className="text-sm leading-snug text-muted">{s.covers}</p>
            <p className="mt-1 text-xs text-faint">{s.after}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
