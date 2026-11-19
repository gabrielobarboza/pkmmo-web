import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DATA_DIR, loadRegistry } from '@pkmmo/data';
import { Battle } from './battle';
import { computeStats } from './stats';

const data = loadRegistry(DATA_DIR);

function run(battle: Battle, untilMs: number): void {
  while (battle.now <= untilMs && !battle.winner()) battle.step();
}

const statusEvents = (b: Battle, name: string) => b.events.filter((e) => e.kind === 'status' && e.status === name);

test('atributos usam piso e o bônus de função entra depois', () => {
  const squirtle = data.monsters.squirtle!;
  const tanker = computeStats(squirtle, 30, 'tanker', data.config.combat);
  const plain = computeStats(squirtle, 30, undefined, data.config.combat);
  assert.equal(plain.maxHp, 26 + 30 + 10);
  assert.equal(plain.stats.defense, Math.floor((2 * 65 * 30) / 100) + 5);
  assert.equal(tanker.maxHp, plain.maxHp * 1.1);
  assert.equal(tanker.stats.defense, plain.stats.defense * 1.1);
  assert.equal(tanker.stats.attack, plain.stats.attack);
});

test('Toxic sem DPS: o Poison acaba antes dos 10 stacks e vira um novo Poison, não Deadly', () => {
  const b = new Battle(data, {
    player: [{ monster: 'bulbasaur', level: 30, moves: ['toxic'] }],
    enemies: [{ monster: 'squirtle', level: 100, moves: ['growl'] }], // não ataca
  });
  b.command({ kind: 'cast', skill: 'toxic' });
  run(b, 7000);
  assert.equal(statusEvents(b, 'poison').length, 2);
  assert.equal(statusEvents(b, 'deadly-poison').length, 0);
});

test('Toxic com DPS: os 4 stacks que sobram do Poison levam ao Deadly em 2,5 s', () => {
  const b = new Battle(data, {
    player: [{ monster: 'charmander', level: 30, moves: ['toxic'] }],
    enemies: [{ monster: 'squirtle', level: 100, moves: ['growl'] }], // não ataca
  });
  b.command({ kind: 'cast', skill: 'toxic' });
  run(b, 4000);
  const deadly = statusEvents(b, 'deadly-poison');
  assert.equal(deadly.length, 1);
  assert.equal(deadly[0]!.t, 2500);
});

test('buff do jogador continua valendo depois da troca de monstro', () => {
  const b = new Battle(data, {
    player: [
      { monster: 'squirtle', level: 30, moves: ['iron-defense'] },
      { monster: 'bulbasaur', level: 30, moves: ['vine-whip'] },
    ],
    enemies: [{ monster: 'charmander', level: 30, moves: ['scratch'] }],
  });
  b.command({ kind: 'cast', skill: 'iron-defense' });
  b.step();
  b.command({ kind: 'swap', to: 1 });
  b.step();
  assert.equal(b.active, 1);
  assert.equal(b.activeMonster.mods.length, 1);
  assert.equal(b.activeMonster.mods[0]!.tag, 'iron-defense');
});

test('comandos inválidos são recusados com o motivo', () => {
  const b = new Battle(data, {
    player: [
      { monster: 'charmander', level: 30, moves: ['ember', 'scratch'] },
      { monster: 'bulbasaur', level: 30, moves: ['vine-whip'] },
    ],
    enemies: [{ monster: 'squirtle', level: 30, moves: ['water-gun'] }],
  });
  b.command({ kind: 'cast', skill: 'ember' });
  b.command({ kind: 'cast', skill: 'scratch' }); // intervalo de 1 s entre habilidades
  b.command({ kind: 'cast', skill: 'vine-whip' }); // não é do monstro ativo
  b.step();
  assert.deepEqual(
    b.rejected.map((r) => r.reason),
    ['intervalo-entre-habilidades', 'habilidade-desconhecida'],
  );
  b.command({ kind: 'cast', skill: 'ember' });
  while (b.now < 1000) b.step();
  b.step();
  assert.equal(b.rejected.at(-1)?.reason, 'em-recarga');
});

test('troca respeita a recarga de 2 s', () => {
  const b = new Battle(data, {
    player: [
      { monster: 'charmander', level: 30 },
      { monster: 'bulbasaur', level: 30 },
    ],
    enemies: [{ monster: 'squirtle', level: 30 }],
  });
  b.command({ kind: 'swap', to: 1 });
  b.step();
  b.command({ kind: 'swap', to: 0 });
  b.step();
  assert.equal(b.active, 1);
  assert.equal(b.rejected.at(-1)?.reason, 'troca-em-recarga');
});

test('o motor é puro: nenhum arquivo do motor importa módulos do Node', () => {
  const dir = new URL('./', import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    assert.ok(!/from ['"]node:/.test(source), `${file} importa um módulo do Node`);
    assert.ok(!/Math\.random|Date\.now|performance\.now/.test(source), `${file} usa sorteio ou relógio`);
  }
});
