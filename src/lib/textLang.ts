import type { Locale } from './locale';

// Idioma de trechos que vêm dos dados (nome de estabelecimento, apelido de cartão), não da interface: com a tela em
// inglês, um "Drogaria São Paulo" ou um apelido "Cartão" lido com pronúncia inglesa fica irreconhecível (3.1.2).
// Só marca o que tem sinal que o inglês não usa (til, cedilha, acento): sem palpite em texto sem acento.
const PT_MARKS = /[ãõçâêôáéíóúàü]/i;

/** Hífen entre letras vira hífen sem quebra (U+2011): "top-up" e "on-chain" não se partem no fim da linha. */
export function keepHyphens(text: string): string {
  return text.replace(/(\p{L})-(?=\p{L})/gu, '$1\u2011');
}

/** `lang` para um trecho de dado: "pt-BR" quando a tela está em inglês e o texto é claramente português. */
export function dataLang(text: string | undefined, locale: Locale): 'pt-BR' | undefined {
  return locale === 'en' && text && PT_MARKS.test(text) ? 'pt-BR' : undefined;
}
