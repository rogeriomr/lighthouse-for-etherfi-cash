// Texto que vem de fora do código (conector, arquivos da IA, regras locais) passa por aqui antes de virar tela, .ics ou
// texto copiado. Um RLO (U+202E) inverte o que aparece sem mudar o texto ("<RLO>11/30" vira "03/11" na tela), e um CR ou
// LF solto quebra a linha do .ics e do pedido copiado. Os dados reais não trazem nenhum desses caracteres.

// marcas e sobreposições de direção (LRM, RLM, LRE…RLO, LRI…PDI)
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// quebras de linha e tab viram espaço; os outros controles (C0, DEL, C1) saem
const BREAKS = /[\r\n\t\u2028\u2029]+/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Sem controles nem marcas de direção; quebra de linha vira espaço. Não apara: quem chama decide. */
export function cleanText(text: string): string {
  return text.replace(BIDI, '').replace(BREAKS, ' ').replace(CONTROL, '');
}

/** Teto de tamanho para texto livre: o que passa de `max` caracteres termina em "…". */
export function clip(text: string, max: number): string {
  // não espalha o texto inteiro em code points antes de cortar: um campo de 8 MB viraria ~72 MB de heap
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max - 1));
  // não corta um par surrogado ao meio
  const safe = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  return `${safe.trimEnd()}…`;
}
