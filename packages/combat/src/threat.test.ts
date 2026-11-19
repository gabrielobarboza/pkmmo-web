import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DATA_DIR, loadRegistry } from '@pkmmo/data';
import type { GameData } from '@pkmmo/data/schema';
import { Battle } from './battle';
import type { UnitSpec } from './types';

// Threat do SDD 02. O simulador não cobre threat, então estas regras só têm testes unitários.

const data = loadRegistry(DATA_DIR);
const { defaultThreat, tankerMultiplier, bossLockMultiplier } = data.config.combat.threat;

/** Inimigo que não ataca: o Growl não está na IA dos inimigos. */
const dummy: UnitSpec = { monster: 'squirtle', level: 100, moves: ['growl'] };
const attacker: UnitSpec = { monster: 'charmander', level: 30, moves: ['scratch'] };

const aggro = (b: Battle, enemy = 0) => b.enemies[enemy]!.aggro!;
const run = (b: Battle, untilMs: number) => {
  while (b.now <= untilMs) b.step();
};

test('Icy Wind: dano no contato, stacks da área e Freeze aplicado dão 140 (exemplo do SDD 02)', () => {
  const b = new Battle(data, {
    players: [{ id: 'a', team: [{ monster: 'charmander', level: 30, moves: ['icy-wind'] }] }],
    enemies: [dummy],
  });
  b.command(0, { kind: 'cast', skill: 'icy-wind' });
  run(b, 6000); // o tick de 5 s cai com o alvo congelado e não aplica stack, então não gera threat
  assert.equal(aggro(b).threat[0], 140);
});

test('debuff em área gera defaultThreat em cada inimigo atingido', () => {
  const b = new Battle(data, {
    players: [{ id: 'a', team: [{ monster: 'charmander', level: 30, moves: ['growl'] }] }],
    enemies: [dummy, dummy],
  });
  b.command(0, { kind: 'cast', skill: 'growl' });
  b.step();
  assert.equal(aggro(b, 0).threat[0], defaultThreat);
  assert.equal(aggro(b, 1).threat[0], defaultThreat);
});

test('Taunt do Tanker vale threatSet × 1,2, reduz os outros e trava o alvo', () => {
  const b = new Battle(data, {
    players: [
      { id: 'a', team: [{ monster: 'charmander', level: 30, moves: ['ember'] }] },
      { id: 'b', team: [{ monster: 'squirtle', level: 30, moves: ['taunt'] }] },
    ],
    enemies: [attacker],
  });
  b.command(0, { kind: 'cast', skill: 'ember' });
  b.step();
  assert.equal(aggro(b).threat[0], defaultThreat);
  assert.equal(aggro(b).target, 0);

  const tauntAt = b.now;
  b.command(1, { kind: 'cast', skill: 'taunt' });
  b.step();
  const taunt = data.skills.taunt!;
  assert.equal(aggro(b).threat[1], taunt.threatSet! * tankerMultiplier);
  assert.equal(aggro(b).threat[0], 0, 'a redução do Tanker não deixa o threat abaixo de 0');
  assert.equal(aggro(b).target, 1);
  assert.equal(aggro(b).lockUntil, tauntAt + taunt.areaEffect!.duration!);

  // Durante a trava o alvo não muda, mesmo com outro jogador acima.
  aggro(b).threat[0] = 900;
  while (b.now < aggro(b).lockUntil) {
    b.step();
    assert.equal(aggro(b).target, 1, `alvo em ${b.now} ms`);
  }
  b.step();
  assert.equal(aggro(b).target, 0, 'depois da trava, quem tem mais threat vira o alvo');
});

test('contra boss a trava do Taunt dura a metade', () => {
  const charmander = data.monsters.charmander!;
  const withBoss: GameData = { ...data, monsters: { ...data.monsters, boss: { ...charmander, id: 'boss', boss: true } } };
  const b = new Battle(withBoss, {
    players: [{ id: 'a', team: [{ monster: 'squirtle', level: 30, moves: ['taunt'] }] }],
    enemies: [{ monster: 'boss', level: 30, moves: ['scratch'] }],
  });
  b.command(0, { kind: 'cast', skill: 'taunt' });
  b.step();
  assert.equal(aggro(b).lockUntil, data.skills.taunt!.areaEffect!.duration! * bossLockMultiplier);
});

test('threat tem teto', () => {
  const b = new Battle(data, {
    players: [{ id: 'a', team: [{ monster: 'charmander', level: 30, moves: ['ember'] }] }],
    enemies: [dummy],
  });
  aggro(b).threat[0] = data.config.combat.threat.cap - 10;
  b.command(0, { kind: 'cast', skill: 'ember' });
  b.step();
  assert.equal(aggro(b).threat[0], data.config.combat.threat.cap);
});

test('Tanker ganha +20% e reduz os outros em defaultThreat, sem o bônus', () => {
  const b = new Battle(data, {
    players: [
      { id: 'a', team: [{ monster: 'charmander', level: 30, moves: ['ember'] }] },
      { id: 'b', team: [{ monster: 'squirtle', level: 30, moves: ['water-gun'] }] },
    ],
    enemies: [dummy],
  });
  aggro(b).threat[0] = 200;
  b.command(1, { kind: 'cast', skill: 'water-gun' });
  b.step();
  assert.equal(aggro(b).threat[1], defaultThreat * tankerMultiplier);
  assert.equal(aggro(b).threat[0], 200 - defaultThreat);
});

test('no empate, Tanker ativo primeiro, depois o alvo atual', () => {
  const withTanker = new Battle(data, {
    players: [
      { id: 'a', team: [{ monster: 'charmander', level: 30 }] },
      { id: 'b', team: [{ monster: 'squirtle', level: 30 }] },
    ],
    enemies: [attacker],
  });
  withTanker.step();
  assert.equal(aggro(withTanker).target, 1, 'empate em 0: o Tanker ativo é o alvo');

  const b = new Battle(data, {
    players: [
      { id: 'a', team: [{ monster: 'charmander', level: 30 }] },
      { id: 'b', team: [{ monster: 'bulbasaur', level: 30 }] },
    ],
    enemies: [attacker],
  });
  b.step();
  assert.equal(aggro(b).target, 0, 'sem Tanker e sem alvo, o primeiro jogador');
  aggro(b).threat[0] = 50;
  aggro(b).threat[1] = 50;
  aggro(b).target = 1;
  b.step();
  assert.equal(aggro(b).target, 1, 'empate sem Tanker: mantém o alvo atual');
  aggro(b).threat[0] = 60;
  b.step();
  assert.equal(aggro(b).target, 0);
});

test('trocar de monstro não faz o inimigo perder o alvo; o dano vai para o novo monstro ativo', () => {
  const b = new Battle(data, {
    players: [
      {
        id: 'a',
        team: [
          { monster: 'charmander', level: 30, moves: ['ember'] },
          { monster: 'bulbasaur', level: 30 },
        ],
      },
      { id: 'b', team: [{ monster: 'bulbasaur', level: 30 }] },
    ],
    enemies: [attacker],
  });
  b.command(0, { kind: 'cast', skill: 'ember' });
  b.step();
  b.command(0, { kind: 'swap', to: 1 });
  run(b, data.config.combat.enemy.skillIntervalMs);
  assert.equal(aggro(b).target, 0);
  const last = b.events.filter((e) => e.kind === 'cast' && e.side === 'enemy').at(-1);
  assert.deepEqual(last && last.kind === 'cast' ? [last.player, last.target] : null, [0, 1]);
});
