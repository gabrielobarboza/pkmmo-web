import type { Element, Role } from '@pkmmo/data/schema';

export type Side = 'player' | 'enemy';

/** Um monstro que entra na luta. `moves` substitui as habilidades do monstro (até 4). */
export interface UnitSpec {
  monster: string;
  level: number;
  moves?: string[];
}

export interface ActiveEffect {
  /** Instante (ms) em que o efeito acaba. */
  end: number;
  /** Próximo tick de dano periódico (ms), quando o efeito causa dano. */
  next?: number;
  /** Dano por tick, como fração da vida máxima. */
  pct?: number;
  /** Atordoamento curto (paralisia): o alvo fica parado até este instante. */
  stunUntil?: number;
}

export interface StackState {
  count: number;
  /** Instante (ms) em que os stacks somem se ninguém somar mais. */
  expires: number;
}

export interface Modifier {
  stat: 'offense' | 'defense';
  mult: number;
  end: number;
  /** Id da habilidade que aplicou; a mesma habilidade renova, não acumula. */
  tag: string;
}

export interface Stats {
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
}

export interface Combatant {
  side: Side;
  index: number;
  monsterId: string;
  name: string;
  level: number;
  types: readonly Element[];
  /** Função do monstro; só vale para o lado do jogador. */
  role: Role | undefined;
  stats: Stats;
  maxHp: number;
  hp: number;
  alive: boolean;
  moves: readonly string[];
  /** Instante (ms) em que cada habilidade volta a ficar disponível. */
  cooldowns: Record<string, number>;
  /** Instante (ms) em que o monstro pode usar outra habilidade. */
  gcdUntil: number;
  stacks: Record<string, StackState>;
  effects: Record<string, ActiveEffect>;
  immuneUntil: number;
  /** No lado do jogador a lista é compartilhada entre os monstros do time. */
  mods: Modifier[];
}

export type Command =
  | { kind: 'cast'; skill: string; /** Índice do inimigo; sem ele, o de menor HP. */ target?: number }
  | { kind: 'swap'; to: number };

export interface Rejection {
  t: number;
  command: Command;
  reason: string;
}

export type BattleEvent =
  | { t: number; kind: 'cast'; side: Side; mon: number; skill: string; target: number }
  | { t: number; kind: 'swap'; to: number }
  | { t: number; kind: 'forced-swap'; to: number }
  | { t: number; kind: 'status'; side: Side; mon: number; status: string }
  | { t: number; kind: 'down'; side: Side; mon: number };

export interface BattleOptions {
  player: UnitSpec[];
  enemies: UnitSpec[];
  /** Passo da simulação em ms (padrão 100). */
  dtMs?: number;
}
