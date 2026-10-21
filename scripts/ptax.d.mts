// Tipos do ptax.mjs, para os checks em TypeScript importarem o módulo do pull.
export interface PtaxRow {
  date: string;
  sell: number;
}

export function fetchPtax(from: string, to: string, fetchImpl?: typeof fetch): Promise<PtaxRow[]>;

export function ptaxFile(rates: PtaxRow[], now?: Date): {
  kind: 'ptax';
  version: 1;
  source: string;
  currency: 'USD';
  quote: 'BRL';
  note: string;
  fetchedAt: string;
  from: string | null;
  to: string | null;
  rates: PtaxRow[];
};
