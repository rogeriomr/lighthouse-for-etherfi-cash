// Cor de categoria: fixa por id em todo o app (Gastos, Histórico, Viagens), nunca pela posição no ranking.
// Paleta só de dados, longe dos tons de status (vermelho, gold, verde, azul-info), do violeta do acento e da tinta
// do texto (ΔE ≥ 15 de cada um). Validada no tema escuro (cartão #191816) com o validador da skill dataviz, todos os
// pares entre si E com o cinza de "tudo o resto" (que encosta em qualquer série no empilhado): visão normal
// ΔE ≥ 15 (pior par 15,1), protanopia/deuteranopia ΔE ≥ 6 (pior 6,2; faixa mínima: os gráficos têm nome na
// legenda, vão de 2 px entre segmentos e tabela), contraste ≥ 3:1. Dez cores é o máximo que passa assim; Lazer,
// Casa e "Outros" ficam no cinza, sempre com nome ao lado. Na paleta em tons ether.fi mudaram 6 cores, todas a
// ΔE ≤ 5,6 da anterior (software, restaurantes e viagem saíram de perto do violeta; transporte e compras voltaram
// a 3:1 no cartão mais claro; mercado se afastou do cinza). Script: scratchpad visual/paleta/scripts/valida_paleta.mjs.
import { CATEGORY, type CategoryId } from './merchants.ts';

/** Cinza de "tudo o resto", "Outros" e das barras neutras (o mesmo da borda de campo): 3,49:1 sobre o cartão */
export const NEUTRAL_COLOR = '#706e6a';

const COLORS: Partial<Record<CategoryId, string>> = {
  [CATEGORY.software]: '#8863e6',
  [CATEGORY.delivery]: '#b94504',
  [CATEGORY.dining]: '#e668c7',
  [CATEGORY.groceries]: '#01a0b4',
  [CATEGORY.transport]: '#0165bd',
  [CATEGORY.travel]: '#ffb8fe',
  [CATEGORY.shopping]: '#a33c8e',
  [CATEGORY.health]: '#50b650',
  [CATEGORY.education]: '#a98610',
  [CATEGORY.phone]: '#107a26',
};

export const hasCategoryColor = (id: string | undefined): boolean => Boolean(id && COLORS[id as CategoryId]);

export function categoryColor(id: string | undefined): string {
  return (id && COLORS[id as CategoryId]) || NEUTRAL_COLOR;
}
