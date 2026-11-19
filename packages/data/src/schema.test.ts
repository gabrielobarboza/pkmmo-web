import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monsterSchema, skillSchema } from './schema';

const base = {
  id: 'ember',
  name: 'Ember',
  description: 'A weak fire attack.',
  element: 'FIRE',
  category: 'special',
  power: 40,
  cooldown: 4000,
};

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

test('habilidade válida passa', () => {
  assert.equal(skillSchema.safeParse(base).success, true);
});

test('campo desconhecido é recusado (erro de digitação)', () => {
  const r = skillSchema.safeParse({ ...base, cooldwon: 1000 });
  assert.equal(r.success, false);
});

test('categoria effect não pode ter power', () => {
  const r = skillSchema.safeParse({ ...base, category: 'effect' });
  assert.equal(r.success, false);
  assert.ok(messages(r).some((m) => m.includes('effect não pode ter power')));
});

test('physical e special precisam de power', () => {
  const { power, ...semPower } = base;
  void power;
  assert.equal(skillSchema.safeParse(semPower).success, false);
});

test('tickMs exige areaEffect.duration', () => {
  const r = skillSchema.safeParse({
    ...base,
    id: 'toxic',
    category: 'effect',
    power: undefined,
    areaEffect: { radius: 8 },
    statusEffect: { type: 'poison', tickMs: 1000, stacksPerTick: 1 },
  });
  assert.equal(r.success, false);
  assert.ok(messages(r).some((m) => m.includes('tickMs exige areaEffect.duration')));
});

test('tickMs e stacksPerTick devem aparecer juntos', () => {
  const r = skillSchema.safeParse({
    ...base,
    category: 'effect',
    power: undefined,
    areaEffect: { radius: 6, duration: 5000 },
    statusEffect: { type: 'sleep', tickMs: 1000 },
  });
  assert.equal(r.success, false);
});

test('stacksPerHit acima do limite do status é permitido (Toxic)', () => {
  const r = skillSchema.safeParse({
    ...base,
    id: 'toxic',
    element: 'POISON',
    category: 'effect',
    power: undefined,
    areaEffect: { radius: 8, duration: 6000 },
    statusEffect: { type: 'poison', stacksPerHit: 14, tickMs: 1000, stacksPerTick: 1 },
  });
  assert.equal(r.success, true);
});

test('buff e debuff só aceitam offense e defense', () => {
  const r = skillSchema.safeParse({
    ...base,
    category: 'effect',
    power: undefined,
    buffEffect: { type: 'attack' },
  });
  assert.equal(r.success, false);
});

test('threatSet só vale na categoria effect', () => {
  assert.equal(skillSchema.safeParse({ ...base, threatSet: 500 }).success, false);
});

test('id inválido é recusado', () => {
  assert.equal(skillSchema.safeParse({ ...base, id: 'Icy Wind' }).success, false);
});

const monster = {
  id: 'squirtle',
  name: 'Squirtle',
  types: ['WATER'],
  role: 'tanker',
  baseStats: { hp: 44, attack: 48, defense: 65, spAttack: 50, spDefense: 64, speed: 43 },
  moves: ['water-gun', 'taunt'],
};

test('monstro válido passa', () => {
  assert.equal(monsterSchema.safeParse(monster).success, true);
});

test('boss é opcional e booleano', () => {
  assert.equal(monsterSchema.safeParse({ ...monster, boss: true }).success, true);
  assert.equal(monsterSchema.safeParse({ ...monster, boss: 'sim' }).success, false);
});

test('threatSet exige a duração da área, que é a trava de alvo', () => {
  const taunt = {
    id: 'taunt',
    name: 'Taunt',
    description: 'x',
    element: 'DARK',
    category: 'effect',
    cooldown: 12000,
    threatSet: 500,
  };
  assert.equal(skillSchema.safeParse({ ...taunt, areaEffect: { radius: 8, duration: 6000 } }).success, true);
  assert.equal(skillSchema.safeParse({ ...taunt, areaEffect: { radius: 8 } }).success, false);
  assert.equal(skillSchema.safeParse(taunt).success, false);
});

test('monstro com mais de 4 habilidades ou 2 tipos é recusado', () => {
  assert.equal(
    monsterSchema.safeParse({ ...monster, moves: ['a', 'b', 'c', 'd', 'e'] }).success,
    false,
  );
  assert.equal(
    monsterSchema.safeParse({ ...monster, types: ['WATER', 'FIRE', 'GRASS'] }).success,
    false,
  );
});
