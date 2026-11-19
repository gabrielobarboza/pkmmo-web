import { ELEMENTS, type Element as ElementType } from '@pkmmo/data/schema';

/**
 * Apresentação dos tipos (cor, nome e ícone). Só o cliente usa isto.
 * As relações entre tipos (vantagem, resistência, imunidade) ficam em
 * data/config/type-chart.json e são aplicadas pelo motor de combate.
 */
export const ELEMENT_COLORS: Record<ElementType, string> = {
  BUG: '#adbd21',
  DARK: '#735a4a',
  DRAGON: '#7b63e7',
  ELECTRIC: '#ffc631',
  FAIRY: '#f7b5f7',
  FIGHTING: '#a55239',
  FIRE: '#f75231',
  FLYING: '#9cadf7',
  GHOST: '#6363b5',
  GRASS: '#7bce52',
  GROUND: '#d6b55a',
  ICE: '#5acee7',
  NORMAL: '#ada594',
  POISON: '#b55aa5',
  PSYCHIC: '#ff73a5',
  ROCK: '#bda55a',
  STEEL: '#adadc6',
  WATER: '#399cff',
};

/** "FIRE" -> "Fire" */
export function elementName(element: ElementType): string {
  return element.charAt(0) + element.slice(1).toLowerCase();
}

/** Ícone do tipo, em apps/client/public/assets/types/<tipo>.gif */
export function elementIcon(element: ElementType): string {
  return `/assets/types/${element.toLowerCase()}.gif`;
}

export const ALL_ELEMENTS: readonly ElementType[] = ELEMENTS;
