/**
 * Ícones de token servidos pelo próprio site, em public/tokens/ (fontes e termos em public/tokens/NOTICE.md: são marcas
 * dos donos, só identificam o ativo e não entram na licença MIT). Símbolo sem ícone (sETHFI, liquidReserve…) mostra as
 * iniciais. A chave é o símbolo em minúsculas: a comparação não diferencia maiúsculas.
 */
const FILES: Record<string, string> = {
  usdc: 'usdc.svg',
  usdt: 'usdt.svg',
  usdt0: 'usdt0.svg',
  eurc: 'eurc.svg',
  eth: 'eth.svg',
  weth: 'eth.svg',
  // os xStocks: a versão "w" (embrulhada) e a original usam o mesmo arquivo (NOTICE.md: "wSPYx (SPYx)")
  wspyx: 'spyx.svg',
  spyx: 'spyx.svg',
  wqqqx: 'qqqx.svg',
  qqqx: 'qqqx.svg',
  wtbllx: 'tbllx.svg',
  tbllx: 'tbllx.svg',
  paxg: 'paxg.svg',
  paxgy: 'paxgy.png',
  zchf: 'zchf.svg',
  op: 'op.png',
  whype: 'whype.svg',
};

/** Endereço do ícone do símbolo, ou null. Parte do BASE_URL do build: funciona também num deploy em subpasta. */
export function tokenIcon(symbol: string): string | null {
  const file = FILES[symbol.trim().toLowerCase()];
  return file ? `${import.meta.env.BASE_URL}tokens/${file}` : null;
}
