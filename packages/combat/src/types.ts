import type { Element, Role } from '@pkmmo/data/schema';

export type Side = 'player' | 'enemy';

/** Um monstro que entra na luta. `moves` substitui as habilidades do monstro (até 4). */
export interface UnitSpec {
  monster: string;
  level: number;
  moves?: string[];
}

/** Um jogador e o time que ele leva para a luta. */
export interface PlayerSpec {
  id: string;
  team: UnitSpec[];
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

/** Threat de um inimigo (SDD 02): um valor por jogador e o jogador que ele ataca. */
export interface Aggro {
  /** Threat de cada jogador, pelo índice do jogador. */
  threat: number[];
  /** Jogador que o inimigo ataca agora. */
  target: number | undefined;
  /** Jogador do último Taunt; a trava de alvo vale até `lockUntil` (ms). */
  lockedOn: number | undefined;
  lockUntil: number;
}

export interface Combatant {
  side: Side;
  /** Posição no time do jogador ou na lista de inimigos. */
  index: number;
  /** Índice do jogador dono do monstro; só no lado do jogador. */
  owner: number | undefined;
  monsterId: string;
  name: string;
  level: number;
  types: readonly Element[];
  /** Função do monstro; só vale para o lado do jogador. */
  role: Role | undefined;
  /** Só vale para inimigos. */
  boss: boolean;
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
  /** Só nos inimigos. */
  aggro: Aggro | undefined;
}

export interface PlayerState {
  id: string;
  index: number;
  team: Combatant[];
  active: number;
  swapReadyAt: number;
}

export type Command =
  | { kind: 'cast'; skill: string; /** Índice do inimigo; sem ele, o de menor HP. */ target?: number }
  | { kind: 'swap'; to: number };

export interface Rejection {
  t: number;
  player: number;
  command: Command;
  reason: string;
}

/**
 * `player` é o jogador envolvido: o dono do monstro no lado do jogador e, no `cast` de um inimigo,
 * o dono do alvo. Em `status` e `down` de inimigo ele fica indefinido.
 */
export type BattleEvent =
  | { t: number; kind: 'cast'; side: Side; player: number; mon: number; skill: string; target: number }
  | { t: number; kind: 'swap'; player: number; to: number }
  | { t: number; kind: 'forced-swap'; player: number; to: number }
  | { t: number; kind: 'status'; side: Side; player: number | undefined; mon: number; status: string }
  | { t: number; kind: 'down'; side: Side; player: number | undefined; mon: number };

export interface BattleOptions {
  players: PlayerSpec[];
  enemies: UnitSpec[];
  /** Passo da simulação em ms (padrão 100). */
  dtMs?: number;
}
