import type { Element, GameData, Skill } from '@pkmmo/data/schema';
import type { Combatant } from './types';

export interface Matchup {
  /** Tipos do alvo imunes ao tipo da habilidade. */
  immune: number;
  /** Tipos do alvo aos quais o tipo da habilidade é vulnerável. */
  vulnerable: number;
  /** Tipos do alvo que resistem ao tipo da habilidade. */
  resistant: number;
}

export function matchup(data: GameData, skillElement: Element, defenderTypes: readonly Element[]): Matchup {
  const entry = data.config.typeChart[skillElement];
  let vulnerable = 0;
  let resistant = 0;
  let immune = 0;
  for (const t of defenderTypes) {
    if (entry?.immune?.includes(t)) immune++;
    else if (entry?.vulnerable?.includes(t)) vulnerable++;
    else if (entry?.resistant?.includes(t)) resistant++;
  }
  return { immune, vulnerable, resistant };
}

export function modifierMult(c: Combatant, stat: 'offense' | 'defense', now: number): number {
  let m = 1;
  for (const mod of c.mods) {
    if (mod.stat === stat && mod.end > now) m *= mod.mult;
  }
  return m;
}

/**
 * Dano direto de uma habilidade (SDD 02). O crítico entra como valor esperado:
 * não há sorteio no protótipo.
 */
export function calcDamage(data: GameData, att: Combatant, dfn: Combatant, skill: Skill, now: number): number {
  const power = skill.power ?? 0;
  if (power <= 0) return 0;
  const { combat, status } = data.config;

  const physical = skill.category === 'physical';
  let a = physical ? att.stats.attack : att.stats.spAttack;
  let d = physical ? dfn.stats.defense : dfn.stats.spDefense;
  a *= modifierMult(att, 'offense', now);
  d *= modifierMult(dfn, 'defense', now);

  const m = matchup(data, skill.element, dfn.types);
  if (m.immune > 0) return 0;
  const step = combat.damage.typeDefenseStep;
  d *= 1 - step * m.vulnerable + step * m.resistant;

  const pw = power * (att.types.includes(skill.element) ? combat.damage.stabMultiplier : 1);
  let dmg = (((2 * att.level) / 5 + 2) * pw * (a / d)) / 50;

  const burn = status.statuses.burn;
  if (att.effects.burn && burn?.outputDamagePct) dmg *= 1 + burn.outputDamagePct / 100;

  const roleCrit = att.role ? (combat.roles[att.role]?.critBonusPct ?? 0) : 0;
  const chance = Math.min(
    1,
    Math.max(
      0,
      combat.crit.baseChancePct / 100 +
        (combat.crit.typeStepPct / 100) * (m.vulnerable - m.resistant) +
        roleCrit / 100,
    ),
  );
  dmg *= 1 + (combat.crit.damageMultiplier - 1) * chance;
  return dmg;
}
