// As regras locais de estabelecimento (merchant-rules.json) trazem uma expressão regular escrita à mão ou por uma IA, e
// o motor de regex do navegador volta atrás sem limite: "^(.*.*)*\u0001" leva ~1 minuto num descritor de 18 caracteres
// e trava a aba (e, com "lembrar", trava a cada abertura). Aqui só passa o subconjunto que não explode: grupo sem
// repetição (o "?" pode), sem referência para trás e no máximo 3 repetições sem teto no padrão inteiro.

/** Tamanho máximo de uma regra local (as reais têm até ~25 caracteres). */
export const MAX_RULE_LENGTH = 120;
/** `*`, `+` e `{n,}`/`{n,m}` no padrão inteiro: 3 dão no máximo n³ passos, nada para um descritor de fatura */
const MAX_REPEATS = 3;
/** Alternativas em excesso também multiplicam caminhos: "(a|a)(a|a)…" é exponencial sem nenhum quantificador */
const MAX_ALTERNATIONS = 8;

/** O padrão é seguro para rodar contra cada descritor? Na dúvida, não: a regra é ignorada e entra na contagem. */
export function isSafePattern(source: string): boolean {
  if (!source || source.length > MAX_RULE_LENGTH) return false;
  // referência para trás (\1, \k<nome>) não tem algoritmo linear
  if (/\\[1-9]|\\k</.test(source)) return false;
  let repeats = 0;
  let alternations = 0;
  let inClass = false;
  // o caractere anterior fechou um grupo (um "\)" escapado não conta)
  let afterGroup = false;
  let prev = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++;
      afterGroup = false;
      prev = '';
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      prev = ch;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '|') {
      alternations++;
      if (alternations > MAX_ALTERNATIONS) return false;
    } else if (ch === '*' || ch === '+' || ch === '{') {
      repeats++;
      // repetição logo depois de um grupo: "(a+)+", "(.*.*)*", "(a|a){1,30}"
      if (afterGroup) return false;
    } else if (
      ch === '?' &&
      // "?" de grupo (?: (?= (?! (?<) e de quantificador preguiçoso (*? +? {n,m}?) não contam duas vezes
      prev !== '(' && prev !== '*' && prev !== '+' && prev !== '}' && prev !== '?'
    ) {
      // "?" opcional também é um caminho de retrocesso: "^(a?)(a?)…$" é exponencial sem repetir grupo
      repeats++;
    }
    afterGroup = ch === ')';
    prev = ch;
  }
  return repeats <= MAX_REPEATS;
}
