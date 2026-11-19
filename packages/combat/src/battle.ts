import type { GameData, Role, Skill } from '@pkmmo/data/schema';
import { calcDamage, matchup } from './damage';
import { computeStats } from './stats';
import type {
  BattleEvent,
  BattleOptions,
  Combatant,
  Command,
  Modifier,
  Rejection,
  Side,
  UnitSpec,
} from './types';

interface Area {
  side: Side;
  status: string;
  tick: number;
  stacks: number;
  end: number;
  next: number;
  role: Role | undefined;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} não encontrado`);
  return value;
}

/**
 * Uma luta entre o time de um jogador e um grupo de inimigos.
 * TypeScript puro: sem I/O, sem relógio e sem sorteio. Quem chama manda comandos e avança o tempo com `step()`.
 *
 * Nesta versão o motor cobre o que o simulador do SDD 02 validou: dano, status, buffs e debuffs,
 * trocas e a IA dos inimigos, com um jogador. Threat, curas e vários jogadores vêm depois.
 * Todos os alvos estão sempre dentro do raio das áreas, porque posições ainda não existem.
 */
export class Battle {
  now = 0;
  readonly dtMs: number;
  readonly player: Combatant[];
  readonly enemies: Combatant[];
  active = 0;
  swapReadyAt = 0;
  readonly events: BattleEvent[] = [];
  readonly rejected: Rejection[] = [];

  private readonly areas: Area[] = [];
  private queue: Command[] = [];

  constructor(
    private readonly data: GameData,
    options: BattleOptions,
  ) {
    this.dtMs = options.dtMs ?? 100;
    const sharedMods: Modifier[] = [];
    this.player = options.player.map((u, i) => this.create(u, 'player', i, sharedMods));
    this.enemies = options.enemies.map((u, i) => this.create(u, 'enemy', i, []));
  }

  private create(spec: UnitSpec, side: Side, index: number, mods: Modifier[]): Combatant {
    const monster = must(this.data.monsters[spec.monster], `monstro "${spec.monster}"`);
    const moves = spec.moves ?? monster.moves;
    for (const id of moves) must(this.data.skills[id], `habilidade "${id}"`);
    const role = side === 'player' ? monster.role : undefined;
    const { maxHp, stats } = computeStats(monster, spec.level, role, this.data.config.combat);
    return {
      side,
      index,
      monsterId: monster.id,
      name: monster.name,
      level: spec.level,
      types: monster.types,
      role,
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
    };
  }

  // ---------- consulta ----------

  get activeMonster(): Combatant {
    return must(this.player[this.active], 'monstro ativo');
  }

  winner(): Side | null {
    if (!this.enemies.some((e) => e.alive)) return 'player';
    if (!this.player.some((m) => m.alive)) return 'enemy';
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

  /** Enfileira um comando; ele é aplicado no próximo `step()`. */
  command(cmd: Command): void {
    this.queue.push(cmd);
  }

  /** Avança um passo: áreas, dano periódico, expiração, comandos do jogador e ação dos inimigos. */
  step(): void {
    this.tickAreas();
    this.tickPeriodic();
    this.expire();
    this.forcedSwap();
    this.playerPhase();
    this.enemyPhase();
    this.forcedSwap();
    this.now += this.dtMs;
  }

  // ---------- fases ----------

  private tickAreas(): void {
    for (const area of [...this.areas]) {
      while (area.next <= this.now && area.next <= area.end) {
        for (const target of this.targetsOf(area.side)) this.addStacks(target, area.status, area.stacks, area.role);
        area.next += area.tick;
      }
      if (area.end < this.now) this.areas.splice(this.areas.indexOf(area), 1);
    }
  }

  private tickPeriodic(): void {
    const tick = this.data.config.status.periodicTickMs;
    for (const c of [...this.player, ...this.enemies]) {
      if (!c.alive) continue;
      const onField = c.side === 'enemy' || c === this.activeMonster;
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
    for (const c of [...this.player, ...this.enemies]) {
      for (const [key, effect] of Object.entries(c.effects)) {
        if (this.now >= effect.end) this.removeEffect(c, key);
      }
      for (const [key, stack] of Object.entries(c.stacks)) {
        if (this.now >= stack.expires) delete c.stacks[key];
      }
    }
  }

  private forcedSwap(): void {
    if (this.activeMonster.alive) return;
    const next = this.player.findIndex((m) => m.alive);
    if (next >= 0) {
      this.active = next;
      this.events.push({ t: this.now, kind: 'forced-swap', to: next });
    }
  }

  private playerPhase(): void {
    const commands = this.queue;
    this.queue = [];
    if (!this.activeMonster.alive || !this.enemies.some((e) => e.alive)) {
      for (const command of commands) this.reject(command, 'sem-acao');
      return;
    }
    for (const command of commands) {
      const reason = command.kind === 'swap' ? this.trySwap(command.to) : this.tryCast(command);
      if (reason) this.reject(command, reason);
    }
  }

  private trySwap(to: number): string | null {
    const target = this.player[to];
    if (!target || !target.alive || to === this.active) return 'troca-invalida';
    if (this.swapReadyAt > this.now) return 'troca-em-recarga';
    if (this.isStunned(this.activeMonster)) return 'atordoado';
    this.active = to;
    this.swapReadyAt = this.now + this.data.config.combat.team.swapCooldownMs;
    this.events.push({ t: this.now, kind: 'swap', to });
    return null;
  }

  private tryCast(command: Extract<Command, { kind: 'cast' }>): string | null {
    const caster = this.activeMonster;
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
    const foe = this.activeMonster;
    for (const enemy of this.enemies) {
      if (!enemy.alive || this.isStunned(enemy) || !foe.alive) continue;
      const choice = this.enemyChoice(enemy, foe);
      if (choice) this.cast(enemy, choice, foe);
    }
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
    this.events.push({ t: this.now, kind: 'cast', side: caster.side, mon: caster.index, skill: skillId, target: target.index });

    if (skill.buffEffect) {
      const durationPct = caster.role ? (combat.roles[caster.role]?.buffDurationPct ?? 0) : 0;
      this.addModifier(caster.mods, skill, skill.buffEffect, 1, durationPct);
      return;
    }
    if (skill.debuffEffect) {
      const durationPct = caster.role ? (combat.roles[caster.role]?.debuffDurationPct ?? 0) : 0;
      for (const foe of this.targetsOf(caster.side)) this.addModifier(foe.mods, skill, skill.debuffEffect, -1, durationPct);
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

    if ((skill.power ?? 0) > 0) {
      const dmg = Math.floor(calcDamage(this.data, att, tgt, skill, this.now) + 0.5);
      for (const [type, def] of Object.entries(statuses)) {
        if (def.brokenByDirectAttack && tgt.effects[type]) this.removeEffect(tgt, type);
      }
      this.hurt(tgt, dmg);
    }

    const status = skill.statusEffect;
    if (status?.stacksPerHit !== undefined) {
      this.addStacks(tgt, status.type, status.stacksPerHit + this.roleExtraStacks(att.role, status.type), att.role);
    }
  }

  private roleExtraStacks(role: Role | undefined, status: string): number {
    const cfg = role ? this.data.config.combat.roles[role] : undefined;
    return cfg?.areaStatuses?.some((s) => s === status) ? (cfg.extraDirectStacks ?? 0) : 0;
  }

  // ---------- status ----------

  private addStacks(t: Combatant, status: string, n: number, role: Role | undefined): void {
    if (!t.alive) return;
    const cfg = this.data.config.status;
    const def = must(cfg.statuses[status as keyof typeof cfg.statuses], `status "${status}"`);
    if (def.stun || def.stunMs) {
      if (this.now < t.immuneUntil || this.isStunned(t) || t.effects[status]) return;
    }
    if (def.blocksStacksWhileActive && t.effects[status]) return;

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
      this.trigger(t, status, role);
    } else {
      t.stacks[status] = { count, expires: this.now + cfg.stackDurationMs };
    }
  }

  private trigger(t: Combatant, status: string, role: Role | undefined): void {
    const cfg = this.data.config.status;
    const def = must(cfg.statuses[status as keyof typeof cfg.statuses], `status "${status}"`);
    const roleCfg = role ? this.data.config.combat.roles[role] : undefined;
    const boosted = roleCfg?.areaStatuses?.some((s) => s === status) ?? false;
    const extraMs = boosted ? (roleCfg?.extraEffectDurationMs ?? 0) : 0;
    const factor = boosted && roleCfg?.periodicDamagePct ? 1 + roleCfg.periodicDamagePct / 100 : 1;

    this.events.push({ t: this.now, kind: 'status', side: t.side, mon: t.index, status });

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
        this.events.push({ t: this.now, kind: 'status', side: t.side, mon: t.index, status: name });
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
      this.events.push({ t: this.now, kind: 'down', side: t.side, mon: t.index });
    }
  }

  /** Quem uma habilidade do lado `side` atinge: todos os inimigos vivos, ou o monstro ativo do jogador. */
  private targetsOf(side: Side): Combatant[] {
    if (side === 'player') return this.enemies.filter((e) => e.alive);
    return this.activeMonster.alive ? [this.activeMonster] : [];
  }

  private reject(command: Command, reason: string): void {
    this.rejected.push({ t: this.now, command, reason });
  }
}
