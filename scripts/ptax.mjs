// A série da PTAX de venda do Banco Central (API pública Olinda), para o `npm run pull` gravar o ptax.json que o app
// importa. Só datas vão para o BCB: nenhum dado da conta sai daqui. O app não chama a API (a CSP proíbe): o Node baixa.
// Uso isolado (teste, sem conta): node scripts/ptax.mjs 2026-09-01 2026-10-16

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)';
/** Janela por pedido: a API responde bem a um ano por vez */
const CHUNK_DAYS = 366;
const DAY = 86400000;

/** AAAA-MM-DD → MM-DD-AAAA, o formato que a API pede */
const bcbDate = (day) => `${day.slice(5, 7)}-${day.slice(8, 10)}-${day.slice(0, 4)}`;

/** Uma janela da série: [{ date, sell }], o fechamento de cada dia útil. */
async function fetchWindow(from, to, fetchImpl) {
  const url = `${ENDPOINT}?@dataInicial='${bcbDate(from)}'&@dataFinalCotacao='${bcbDate(to)}'&$select=cotacaoVenda,dataHoraCotacao&$format=json`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`BCB PTAX ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.value)) throw new Error('BCB PTAX: resposta sem "value"');
  return body.value
    .filter((v) => typeof v?.cotacaoVenda === 'number' && typeof v?.dataHoraCotacao === 'string')
    .map((v) => ({ date: v.dataHoraCotacao.slice(0, 10), sell: v.cotacaoVenda }));
}

/**
 * A série de `from` a `to` (AAAA-MM-DD), em janelas de até um ano; o mesmo dia repetido fica com o último valor.
 * Começa 7 dias antes de `from`: a compra do sábado usa a cotação da sexta.
 */
export async function fetchPtax(from, to, fetchImpl = fetch) {
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);
  const byDay = new Map();
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += CHUNK_DAYS * DAY) {
    const a = new Date(t).toISOString().slice(0, 10);
    const b = new Date(Math.min(t + (CHUNK_DAYS - 1) * DAY, Date.parse(`${to}T00:00:00Z`))).toISOString().slice(0, 10);
    for (const r of await fetchWindow(a, b, fetchImpl)) byDay.set(r.date, r.sell);
  }
  return [...byDay.entries()].map(([date, sell]) => ({ date, sell })).sort((x, y) => x.date.localeCompare(y.date));
}

/** O conteúdo do ptax.json, no formato que o app valida (validatePtaxFile). */
export function ptaxFile(rates, now = new Date()) {
  return {
    kind: 'ptax',
    version: 1,
    source: 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo',
    currency: 'USD',
    quote: 'BRL',
    note: 'PTAX de venda, fechamento do dia (Banco Central do Brasil)',
    fetchedAt: now.toISOString(),
    from: rates[0]?.date ?? null,
    to: rates.at(-1)?.date ?? null,
    rates,
  };
}

// node scripts/ptax.mjs AAAA-MM-DD AAAA-MM-DD: baixa e imprime um resumo (para testar a API sem conta)
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [from, to] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) {
    console.error('uso: node scripts/ptax.mjs AAAA-MM-DD AAAA-MM-DD');
    process.exit(1);
  }
  const rates = await fetchPtax(from, to);
  const file = ptaxFile(rates);
  console.log(`${rates.length} dias, de ${file.from} a ${file.to}; primeiro ${JSON.stringify(rates[0])}, último ${JSON.stringify(rates.at(-1))}`);
}
