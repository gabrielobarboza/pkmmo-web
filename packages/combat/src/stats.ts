import type { CombatConfig, Monster, Role } from '@pkmmo/data/schema';
import type { Stats } from './types';

/**
 * Atributos pela fórmula clássica sem IV, EV e natureza (SDD 02):
 * atributo = piso(2 × base × nível ÷ 100) + 5; HP = piso(2 × base × nível ÷ 100) + nível + 10.
 * O bônus de função entra depois, sobre o valor já calculado.
 */
export function computeStats(
  monster: Monster,
  level: number,
  role: Role | undefined,
  combat: CombatConfig,
): { maxHp: number; stats: Stats } {
  const b = monster.baseStats;
  const calc = (base: number) => Math.floor((2 * base * level) / 100) + 5;
  const stats: Stats = {
    attack: calc(b.attack),
    defense: calc(b.defense),
    spAttack: calc(b.spAttack),
    spDefense: calc(b.spDefense),
  };
  let maxHp = Math.floor((2 * b.hp * level) / 100) + level + 10;

  const bonus = role ? combat.roles[role] : undefined;
  if (bonus?.hpPct) maxHp *= 1 + bonus.hpPct / 100;
  if (bonus?.defensivePct) {
    stats.defense *= 1 + bonus.defensivePct / 100;
    stats.spDefense *= 1 + bonus.defensivePct / 100;
  }
  if (bonus?.offensivePct) {
    stats.attack *= 1 + bonus.offensivePct / 100;
    stats.spAttack *= 1 + bonus.offensivePct / 100;
  }
  return { maxHp, stats };
}
