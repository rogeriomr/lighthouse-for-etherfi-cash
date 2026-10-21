// Idioma de um trecho que vem de fora do código e fica na língua de origem (citação de email, nota da pesquisa,
// termos lidos pela IA). O leitor de tela precisa do `lang` certo para pronunciar (WCAG 3.1.2). Frases inteiras, nos
// dois sentidos (português na tela em inglês e vice-versa); para nomes curtos de dado, ver dataLang em textLang.ts.
// Heurística curta e conservadora: na dúvida, não marca nada e o trecho herda o idioma da tela.
import type { Locale } from './locale';

// acentos e cedilha que o inglês não usa
const PT_CHARS = /[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔÀ]/;
// palavras inteiras, com fronteira por letra Unicode (o \b do JS não entende "até" nem "mês")
const words = (list: string) => new RegExp(`(?<!\\p{L})(?:${list})(?!\\p{L})`, 'giu');
const PT_WORDS = words('de|da|do|das|dos|para|por|com|sem|não|uma|um|em|na|ao|à|pelo|pela|mês|ano|anual|mensal|cobrança|assinatura|renovação|reembolso|até|dias|plano|uso|conta|cancelar|antes|depois|ou|e|que');
const EN_WORDS = words('the|and|of|to|your|you|for|with|without|before|after|days|month|monthly|year|yearly|annual|renewal|renews|refund|plan|cancel|until|within|not|is|are|or|if|on|per|by');

/** 'pt' ou 'en' quando o trecho claramente é dessa língua; undefined se não der para dizer. */
export function quoteLang(text: string | undefined): Locale | undefined {
  if (!text) return undefined;
  const pt = (text.match(PT_WORDS)?.length ?? 0) + (PT_CHARS.test(text) ? 2 : 0);
  const en = text.match(EN_WORDS)?.length ?? 0;
  if (pt >= 2 && pt > en) return 'pt';
  if (en >= 2 && en > pt) return 'en';
  return undefined;
}

/** O atributo `lang` para um trecho dentro da tela em `locale`: só quando a língua do trecho é outra. */
export function langAttr(text: string | undefined, locale: Locale): string | undefined {
  const lang = quoteLang(text);
  if (!lang || lang === locale) return undefined;
  return lang === 'pt' ? 'pt-BR' : 'en';
}
