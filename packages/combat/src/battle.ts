import type { GameData, Role, Skill } from '@pkmmo/data/schema';
import { calcDamage, matchup } from './damage';
import { computeStats } from './stats';
import type {
  BattleEvent,
  BattleOptions,
  Combatant,
  Command,
  Modifier,
  PlayerState,
  Rejection,
  Side,
  UnitSpec,
} from './types';

/** Quem causou um efeito: o jogador dono (só no lado do jogador) e a função do monstro que usou a habilidade. */
interface Source {
  owner: number | undefined;
  role: Role | undefined;
}

interface Area extends Source {
  side: Side;
  status: string;
  tick: number;
  stacks: number;
  end: number;
  next: number;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} não encontrado`);
  return value;
}

/**
 * Uma luta entre os times de um ou mais jogadores e um grupo de inimigos.
 * TypeScript puro: sem I/O, sem relógio e sem sorteio. Quem chama manda comandos e avança o tempo com `step()`.
 *
 * Cobre o que o simulador do SDD 02 validou (dano, status, buffs e debuffs, trocas e a IA dos inimigos)
 * e o threat do SDD 02, que só tem testes unitários. Curas ainda não existem.
 * Todos os alvos estão sempre dentro do raio das áreas, porque posições ainda não existem.
 */
export class Battle {
  now = 0;
  readonly dtMs: number;
  readonly players: PlayerState[];
  readonly enemies: Combatant[];
  readonly events: BattleEvent[] = [];
  readonly rejected: Rejection[] = [];

  private readonly areas: Area[] = [];
  private queue: { player: number; command: Command }[] = [];

  constructor(
    private readonly data: GameData,
    options: BattleOptions,
  ) {
    this.dtMs = options.dtMs ?? 100;
    this.players = options.players.map((p, owner) => {
      const sharedMods: Modifier[] = [];
      return {
        id: p.id,
        index: owner,
        team: p.team.map((u, i) => this.create(u, 'player', i, sharedMods, owner)),
        active: 0,
        swapReadyAt: 0,
      };
    });
    this.enemies = options.enemies.map((u, i) => this.create(u, 'enemy', i, [], undefined));
  }

  private create(spec: UnitSpec, side: Side, index: number, mods: Modifier[], owner: number | undefined): Combatant {
    const monster = must(this.data.monsters[spec.monster], `monstro "${spec.monster}"`);
    const moves = spec.moves ?? monster.moves;
    for (const id of moves) must(this.data.skills[id], `habilidade "${id}"`);
    const role = side === 'player' ? monster.role : undefined;
    const { maxHp, stats } = computeStats(monster, spec.level, role, this.data.config.combat);
    return {
      side,
      index,
      owner,
      monsterId: monster.id,
      name: monster.name,
      level: spec.level,
      types: monster.types,
      role,
      boss: side === 'enemy' && monster.boss === true,
      stats,
      maxHp,
      hp: maxHp,
      alive: true,
      moves,
      cooldowns: {},
      gcdUntil: 0,
      stacks: {},
      effects: {},
      immuneUntil: 0,
      mods,
      aggro:
        side === 'enemy'
          ? { threat: this.players.map(() => 0), target: undefined, lockedOn: undefined, lockUntil: 0 }
          : undefined,
    };
  }

  // ---------- consulta ----------

  /** Monstro ativo do jogador `player`. */
  activeOf(player: number): Combatant {
    const p = must(this.players[player], `jogador ${player}`);
    return must(p.team[p.active], 'monstro ativo');
  }

  winner(): Side | null {
    if (!this.enemies.some((e) => e.alive)) return 'player';
    if (!this.players.some((p) => p.team.some((m) => m.alive))) return 'enemy';
    return null;
  }

  isStunned(c: Combatant): boolean {
    for (const [key, effect] of Object.entries(c.effects)) {
      const def = this.data.config.status.statuses[key as keyof typeof this.data.config.status.statuses];
      if (def?.stun) return true;
      if (def?.stunMs && effect.stunUntil !== undefined && this.now < effect.stunUntil) return true;
    }
    return false;
  }

  // ---------- entrada ----------

  /** Enfileira um comando do jogador `player`; ele é aplicado no próximo `step()`. */
  command(player: number, cmd: Command): void {
    this.queue.push({ player, command: cmd });
  }

  /** Avança um passo: áreas, dano periódico, expiração, comandos dos jogadores e ação dos inimigos. */
  step(): void {
    this.tickAreas();
    this.tickPeriodic();
    this.expire();
    this.forcedSwaps();
    this.playerPhase();
    this.enemyPhase();
    this.forcedSwaps();
    this.now += this.dtMs;
  }

  // ---------- fases ----------

  private tickAreas(): void {
    const { defaultThreat, overTimeDivisor } = this.data.config.combat.threat;
    for (const area of [...this.areas]) {
      while (area.next <= this.now && area.next <= area.end) {
        for (const target of this.targetsOf(area.side)) {
          // Threat por stack efetivamente aplicado; a redução do Tanker segue a mesma escala.
          const applied = this.addStacks(target, area.status, area.stacks, area);
          if (applied > 0) this.onHit(area, target, (applied * defaultThreat) / overTimeDivisor, applied);
        }
        area.next += area.tick;
      }
      if (area.end < this.now) this.areas.splice(this.areas.indexOf(area), 1);
    }
  }

  private tickPeriodic(): void {
    const tick = this.data.config.status.periodicTickMs;
    for (const c of this.everyone()) {
      if (!c.alive) continue;
      const onField = c.side === 'enemy' || c === this.activeOf(must(c.owner, 'dono'));
      for (const effect of Object.values(c.effects)) {
        if (effect.pct === undefined || effect.next === undefined) continue;
        while (effect.next <= this.now && effect.next <= effect.end) {
          if (onField) this.hurt(c, effect.pct * c.maxHp);
          effect.next += tick;
        }
      }
    }
  }

  private expire(): void {
    for (const c of this.everyone()) {
      for (const [key, effect] of Object.entries(c.effects)) {
        if (this.now >= effect.end) this.removeEffect(c, key);
      }
      for (const [key, stack] of Object.entries(c.stacks)) {
        if (this.now >= stack.expires) delete c.stacks[key];
      }
    }
  }

  private forcedSwaps(): void {
    for (const p of this.players) {
      if (this.activeOf(p.index).alive) continue;
      const next = p.team.findIndex((m) => m.alive);
      if (next >= 0) {
        p.active = next;
        this.events.push({ t: this.now, kind: 'forced-swap', player: p.index, to: next });
      }
    }
  }

  private playerPhase(): void {
    const queued = this.queue;
    this.queue = [];
    const enemiesLeft = this.enemies.some((e) => e.alive);
    for (const { player, command } of queued) {
      if (!this.players[player]) {
        this.reject(player, command, 'jogador-invalido');
        continue;
      }
      if (!enemiesLeft || !this.activeOf(player).alive) {
        this.reject(player, command, 'sem-acao');
        continue;
      }
      const reason = command.kind === 'swap' ? this.trySwap(player, command.to) : this.tryCast(player, command);
      if (reason) this.reject(player, command, reason);
    }
  }

  private trySwap(player: number, to: number): string | null {
    const p = must(this.players[player], `jogador ${player}`);
    const target = p.team[to];
    if (!target || !target.alive || to === p.active) return 'troca-invalida';
    if (p.swapReadyAt > this.now) return 'troca-em-recarga';
    if (this.isStunned(this.activeOf(player))) return 'atordoado';
    p.active = to;
    p.swapReadyAt = this.now + this.data.config.combat.team.swapCooldownMs;
    this.events.push({ t: this.now, kind: 'swap', player, to });
    return null;
  }

  private tryCast(player: number, command: Extract<Command, { kind: 'cast' }>): string | null {
    const caster = this.activeOf(player);
    const reason = this.castBlock(caster, command.skill);
    if (reason) return reason;
    const foes = this.targetsOf('player');
    if (foes.length === 0) return 'sem-alvo';
    const selfOnly = this.data.skills[command.skill]?.buffEffect !== undefined;
    const chosen =
      command.target !== undefined && !selfOnly
        ? this.enemies[command.target]
        : [...foes].sort((a, b) => a.hp - b.hp)[0];
    if (!chosen || !chosen.alive) return 'alvo-invalido';
    this.cast(caster, command.skill, chosen);
    return null;
  }

  private enemyPhase(): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const player = this.chooseTarget(enemy);
      if (player === undefined || this.isStunned(enemy)) continue;
      const foe = this.activeOf(player);
      const choice = this.enemyChoice(enemy, foe);
      if (choice) this.cast(enemy, choice, foe);
    }
  }

  /**
   * Escolha de alvo pelo threat (SDD 02). Durante a trava do Taunt, o alvo é quem usou o Taunt.
   * Fora dela, o jogador de maior threat; no empate, o que tem um Tanker ativo, depois o alvo atual,
   * depois o de menor índice. O alvo é o jogador, e o dano vai para o monstro ativo dele.
   */
  private chooseTarget(enemy: Combatant): number | undefined {
    const aggro = must(enemy.aggro, 'threat do inimigo');
    const standing = this.players.filter((p) => this.activeOf(p.index).alive).map((p) => p.index);
    if (aggro.lockedOn !== undefined && this.now < aggro.lockUntil && standing.includes(aggro.lockedOn)) {
      aggro.target = aggro.lockedOn;
      return aggro.target;
    }
    const threatOf = (i: number) => aggro.threat[i] ?? 0;
    const best = Math.max(...standing.map(threatOf));
    let tied = standing.filter((i) => threatOf(i) === best);
    const tankers = tied.filter((i) => this.activeOf(i).role === 'tanker');
    if (tankers.length > 0) tied = tankers;
    aggro.target = aggro.target !== undefined && tied.includes(aggro.target) ? aggro.target : tied[0];
    return aggro.target;
  }

  /**
   * IA dos inimigos (SDD 02): só habilidades de dano em alvo único, preferindo as de tipo com
   * vantagem contra o alvo e, no empate, as de maior poder. Não usa fogo em alvo congelado.
   */
  private enemyChoice(enemy: Combatant, target: Combatant): string | null {
    const candidates: { adv: number; power: number; id: string }[] = [];
    for (const id of enemy.moves) {
      const skill = must(this.data.skills[id], `habilidade "${id}"`);
      if ((skill.power ?? 0) <= 0 || skill.areaEffect) continue;
      if (this.castBlock(enemy, id)) continue;
      if (this.wouldThaw(target, skill)) continue;
      const m = matchup(this.data, skill.element, target.types);
      candidates.push({ adv: m.vulnerable - m.resistant - m.immune, power: skill.power ?? 0, id });
    }
    candidates.sort((a, b) => b.adv - a.adv || b.power - a.power);
    return candidates[0]?.id ?? null;
  }

  private wouldThaw(target: Combatant, skill: Skill): boolean {
    for (const [type, def] of Object.entries(this.data.config.status.statuses)) {
      if ((def.stun || def.stunMs) && target.effects[type] && def.removedByElements?.includes(skill.element)) {
        return true;
      }
    }
    return false;
  }

  // ---------- habilidades ----------

  /** Motivo pelo qual o monstro não pode usar a habilidade agora, ou null. */
  private castBlock(c: Combatant, skillId: string): string | null {
    if (!c.alive) return 'morto';
    if (!c.moves.includes(skillId)) return 'habilidade-desconhecida';
    if ((c.cooldowns[skillId] ?? 0) > this.now) return 'em-recarga';
    if (c.gcdUntil > this.now) return 'intervalo-entre-habilidades';
    if (this.isStunned(c)) return 'atordoado';
    return null;
  }

  private cast(caster: Combatant, skillId: string, target: Combatant): void {
    const skill = must(this.data.skills[skillId], `habilidade "${skillId}"`);
    const { combat } = this.data.config;
    caster.cooldowns[skillId] = this.now + skill.cooldown;
    caster.gcdUntil =
      this.now + (caster.side === 'enemy' ? combat.enemy.skillIntervalMs : combat.team.globalCooldownMs);
    this.events.push({
      t: this.now,
      kind: 'cast',
      side: caster.side,
      player: must(caster.side === 'player' ? caster.owner : target.owner, 'jogador'),
      mon: caster.index,
      skill: skillId,
      target: target.index,
    });

    if (skill.threatSet !== undefined) {
      for (const foe of this.targetsOf(caster.side)) this.taunt(caster, foe, skill);
    }
    if (skill.buffEffect) {
      const durationPct = caster.role ? (combat.roles[caster.role]?.buffDurationPct ?? 0) : 0;
      this.addModifier(caster.mods, skill, skill.buffEffect, 1, durationPct);
      return;
    }
    if (skill.debuffEffect) {
      const durationPct = caster.role ? (combat.roles[caster.role]?.debuffDurationPct ?? 0) : 0;
      for (const foe of this.targetsOf(caster.side)) {
        this.addModifier(foe.mods, skill, skill.debuffEffect, -1, durationPct);
        this.onHit(caster, foe, this.hitThreat(skill));
      }
      return;
    }

    const hits = (skill.power ?? 0) > 0 || skill.statusEffect?.stacksPerHit !== undefined;
    if (hits) {
      if (skill.areaEffect) for (const foe of this.targetsOf(caster.side)) this.direct(caster, foe, skill);
      else this.direct(caster, target, skill);
    }

    const status = skill.statusEffect;
    const duration = skill.areaEffect?.duration;
    if (status && duration !== undefined && status.tickMs !== undefined && status.stacksPerTick !== undefined) {
      const roleCfg = caster.role ? combat.roles[caster.role] : undefined;
      const tick = roleCfg?.areaStatuses?.includes(status.type) && roleCfg.areaTickMs ? roleCfg.areaTickMs : status.tickMs;
      this.areas.push({
        side: caster.side,
        owner: caster.owner,
        status: status.type,
        tick,
        stacks: status.stacksPerTick,
        end: this.now + duration,
        next: this.now + tick,
        role: caster.role,
      });
    }
  }

  private addModifier(
    list: Modifier[],
    skill: Skill,
    effect: { type: 'offense' | 'defense'; duration?: number | undefined; magnitudePct?: number | undefined },
    sign: 1 | -1,
    durationBonusPct: number,
  ): void {
    const { damage } = this.data.config.combat;
    const pct = effect.magnitudePct ?? damage.attributeModifierPct;
    const base = effect.duration ?? damage.defaultModifierDurationMs;
    const mod: Modifier = {
      stat: effect.type,
      mult: 1 + (sign * pct) / 100,
      end: this.now + base * (1 + durationBonusPct / 100),
      tag: skill.id,
    };
    const existing = list.findIndex((m) => m.tag === skill.id && m.end > this.now);
    if (existing >= 0) list[existing] = mod;
    else list.push(mod);
  }

  private direct(att: Combatant, tgt: Combatant, skill: Skill): void {
    if (!tgt.alive) return;
    const { statuses } = this.data.config.status;

    for (const [type, def] of Object.entries(statuses)) {
      if (def.removedByElements?.includes(skill.element) && tgt.effects[type]) {
        this.removeEffect(tgt, type);
        delete tgt.stacks[type];
      }
    }

    const damaging = (skill.power ?? 0) > 0;
    if (damaging) {
      const dmg = Math.floor(calcDamage(this.data, att, tgt, skill, this.now) + 0.5);
      for (const [type, def] of Object.entries(statuses)) {
        if (def.brokenByDirectAttack && tgt.effects[type]) this.removeEffect(tgt, type);
      }
      this.hurt(tgt, dmg);
    }

    // Só o dano gera threat no acerto; os stacks de contato não geram.
    this.onHit(att, tgt, damaging ? this.hitThreat(skill) : 0);

    const status = skill.statusEffect;
    if (status?.stacksPerHit !== undefined) {
      this.addStacks(tgt, status.type, status.stacksPerHit + this.roleExtraStacks(att.role, status.type), att);
    }
  }

  private roleExtraStacks(role: Role | undefined, status: string): number {
    const cfg = role ? this.data.config.combat.roles[role] : undefined;
    return cfg?.areaStatuses?.some((s) => s === status) ? (cfg.extraDirectStacks ?? 0) : 0;
  }

  // ---------- threat ----------

  /** Threat do acerto: o campo `threat` da habilidade ou o `defaultThreat`. */
  private hitThreat(skill: Skill): number {
    return skill.threat ?? this.data.config.combat.threat.defaultThreat;
  }

  /**
   * Um acerto do jogador em um inimigo: soma `amount` ao threat de quem usou e, se foi um Tanker,
   * aplica a redução nos outros jogadores (`defaultThreat` por habilidade, ou `/overTimeDivisor` por stack de área).
   */
  private onHit(src: Source, enemy: Combatant, amount: number, areaStacks?: number): void {
    const { defaultThreat, overTimeDivisor } = this.data.config.combat.threat;
    this.gainThreat(src, enemy, amount);
    const cut = areaStacks === undefined ? defaultThreat : (areaStacks * defaultThreat) / overTimeDivisor;
    this.shedThreat(src, enemy, cut);
  }

  /** Soma threat ao jogador dono de `src` no inimigo: ×tankerMultiplier para o Tanker, com teto. */
  private gainThreat(src: Source, enemy: Combatant, amount: number): void {
    const aggro = enemy.aggro;
    if (!aggro || src.owner === undefined || amount <= 0) return;
    const { cap, tankerMultiplier } = this.data.config.combat.threat;
    const value = amount * (src.role === 'tanker' ? tankerMultiplier : 1);
    aggro.threat[src.owner] = Math.min(cap, (aggro.threat[src.owner] ?? 0) + value);
  }

  /** Redução do Tanker: tira `amount` do threat dos outros jogadores, sem passar de 0 e sem o bônus de +20%. */
  private shedThreat(src: Source, enemy: Combatant, amount: number): void {
    const aggro = enemy.aggro;
    if (!aggro || src.owner === undefined || src.role !== 'tanker') return;
    aggro.threat.forEach((value, i) => {
      if (i !== src.owner) aggro.threat[i] = Math.max(0, value - amount);
    });
  }

  /** Taunt: define o threat de quem usou em `threatSet` (com o bônus do Tanker e o teto) e trava o alvo. */
  private taunt(caster: Combatant, enemy: Combatant, skill: Skill): void {
    const aggro = enemy.aggro;
    if (!aggro || caster.owner === undefined || skill.threatSet === undefined) return;
    const { cap, tankerMultiplier, bossLockMultiplier } = this.data.config.combat.threat;
    const set = skill.threatSet * (caster.role === 'tanker' ? tankerMultiplier : 1);
    aggro.threat[caster.owner] = Math.min(cap, set);
    const lock = must(skill.areaEffect?.duration, 'duração da trava') * (enemy.boss ? bossLockMultiplier : 1);
    aggro.lockedOn = caster.owner;
    aggro.lockUntil = this.now + lock;
    aggro.target = caster.owner;
    this.onHit(caster, enemy, 0);
  }

  // ---------- status ----------

  /** Soma stacks e devolve quantos foram efetivamente aplicados (0 quando o alvo bloqueia). */
  private addStacks(t: Combatant, status: string, n: number, src: Source): number {
    if (!t.alive) return 0;
    const cfg = this.data.config.status;
    const def = must(cfg.statuses[status as keyof typeof cfg.statuses], `status "${status}"`);
    if (def.stun || def.stunMs) {
      if (this.now < t.immuneUntil || this.isStunned(t) || t.effects[status]) return 0;
    }
    if (def.blocksStacksWhileActive && t.effects[status]) return 0;

    const escalation = Object.entries(cfg.escalations).find(([, e]) => e.escalatesFrom === status);
    const escalating = escalation !== undefined && (t.effects[status] !== undefined || t.effects[escalation[0]] !== undefined);
    const threshold = escalating ? must(escalation, 'escalonamento')[1].stacks : def.stacksToTrigger;

    const count = (t.stacks[status]?.count ?? 0) + n;
    if (count >= threshold) {
      delete t.stacks[status];
      // Com escalonamento (Poison -> Deadly Poison), os stacks acima do limite sobram e contam para o próximo.
      if (escalation && count > threshold) {
        t.stacks[status] = { count: count - threshold, expires: this.now + cfg.stackDurationMs };
      }
      this.trigger(t, status, src);
    } else {
      t.stacks[status] = { count, expires: this.now + cfg.stackDurationMs };
    }
    return n;
  }

  private trigger(t: Combatant, status: string, src: Source): void {
    const cfg = this.data.config.status;
    const def = must(cfg.statuses[status as keyof typeof cfg.statuses], `status "${status}"`);
    const roleCfg = src.role ? this.data.config.combat.roles[src.role] : undefined;
    const boosted = roleCfg?.areaStatuses?.some((s) => s === status) ?? false;
    const extraMs = boosted ? (roleCfg?.extraEffectDurationMs ?? 0) : 0;
    const factor = boosted && roleCfg?.periodicDamagePct ? 1 + roleCfg.periodicDamagePct / 100 : 1;

    this.events.push({ t: this.now, kind: 'status', side: t.side, player: t.owner, mon: t.index, status });
    // A aplicação do status (inclusive a escalada para Deadly Poison) gera threat; os ticks de dano, não.
    this.gainThreat(src, t, this.data.config.combat.threat.defaultThreat);

    // Atordoamentos se excluem: o que dispara limpa os stacks dos outros.
    if (def.stun || def.stunMs) {
      for (const [other, otherDef] of Object.entries(cfg.statuses)) {
        if (other !== status && (otherDef.stun || otherDef.stunMs)) delete t.stacks[other];
      }
    }

    const effect = {
      end: this.now + def.durationMs + extraMs,
      ...(def.periodicDamagePctMaxHp !== undefined
        ? { next: this.now + cfg.periodicTickMs, pct: (def.periodicDamagePctMaxHp / 100) * factor }
        : {}),
      ...(def.stunMs !== undefined ? { stunUntil: this.now + def.stunMs } : {}),
    };

    const escalation = Object.entries(cfg.escalations).find(([, e]) => e.escalatesFrom === status);
    if (escalation) {
      const [name, esc] = escalation;
      const escalated = {
        end: this.now + esc.durationMs + extraMs,
        next: this.now + cfg.periodicTickMs,
        pct: (esc.periodicDamagePctMaxHp / 100) * factor,
      };
      if (t.effects[name]) {
        t.effects[name] = escalated;
      } else if (t.effects[status]) {
        delete t.effects[status];
        t.effects[name] = escalated;
        this.events.push({ t: this.now, kind: 'status', side: t.side, player: t.owner, mon: t.index, status: name });
      } else {
        t.effects[status] = effect;
      }
      return;
    }
    t.effects[status] = effect;
  }

  private removeEffect(t: Combatant, key: string): void {
    if (!t.effects[key]) return;
    delete t.effects[key];
    const def = this.data.config.status.statuses[key as keyof typeof this.data.config.status.statuses];
    if (def?.stun || def?.stunMs) t.immuneUntil = this.now + this.data.config.status.immunityWindowMs;
  }

  // ---------- utilidades ----------

  private hurt(t: Combatant, amount: number): void {
    if (!t.alive) return;
    t.hp -= amount;
    if (t.hp <= 0) {
      t.alive = false;
      t.hp = 0;
      this.events.push({ t: this.now, kind: 'down', side: t.side, player: t.owner, mon: t.index });
    }
  }

  private everyone(): Combatant[] {
    return [...this.players.flatMap((p) => p.team), ...this.enemies];
  }

  /** Quem uma habilidade do lado `side` atinge: todos os inimigos vivos, ou os monstros ativos dos jogadores. */
  private targetsOf(side: Side): Combatant[] {
    if (side === 'player') return this.enemies.filter((e) => e.alive);
    return this.players.map((p) => this.activeOf(p.index)).filter((m) => m.alive);
  }

  private reject(player: number, command: Command, reason: string): void {
    this.rejected.push({ t: this.now, player, command, reason });
  }
}
