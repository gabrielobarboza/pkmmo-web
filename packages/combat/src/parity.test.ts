import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DATA_DIR, loadRegistry } from '@pkmmo/data';
import { Battle } from './battle';
import type { UnitSpec } from './types';

// Os cenários vêm do simulador de referência (tools/simulator/export_fixtures.py).
// O motor recebe só os comandos do jogador; os inimigos usam a IA do próprio motor.

interface Fixture {
  name: string;
  player: UnitSpec[];
  enemies: UnitSpec[];
  commands: ({ t: number; kind: 'swap'; to: number } | { t: number; kind: 'cast'; skill: string; target: number })[];
  enemyCasts: { t: number; enemy: number; skill: string; target: number }[];
  checkpoints: { t: number; active: number; team: number[]; enemies: number[] }[];
  result: { winner: 'player' | 'enemy' | 'timeout'; timeMs: number };
}

const data = loadRegistry(DATA_DIR);
const dir = new URL('../fixtures/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
assert.ok(files.length > 0, 'nenhum cenário em fixtures/');

const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;

for (const file of files) {
  const fx: Fixture = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));

  test(`paridade com o simulador: ${fx.name}`, () => {
    const battle = new Battle(data, { player: fx.player, enemies: fx.enemies });
    const commandsAt = new Map<number, Fixture['commands']>();
    for (const c of fx.commands) commandsAt.set(c.t, [...(commandsAt.get(c.t) ?? []), c]);
    const checkpointAt = new Map(fx.checkpoints.map((c) => [c.t, c]));

    let winner: string = 'timeout';
    let endedAt = 0;
    while (battle.now < 300000) {
      const t = battle.now;
      for (const c of commandsAt.get(t) ?? []) {
        battle.command(c.kind === 'swap' ? { kind: 'swap', to: c.to } : { kind: 'cast', skill: c.skill, target: c.target });
      }
      battle.step();

      const cp = checkpointAt.get(t);
      if (cp) {
        assert.equal(battle.active, cp.active, `monstro ativo em ${t} ms`);
        battle.player.forEach((m, i) => assert.ok(close(m.hp, cp.team[i]!), `HP do time[${i}] em ${t} ms: ${m.hp} != ${cp.team[i]}`));
        battle.enemies.forEach((m, i) => assert.ok(close(m.hp, cp.enemies[i]!), `HP do inimigo[${i}] em ${t} ms: ${m.hp} != ${cp.enemies[i]}`));
      }
      const w = battle.winner();
      if (w) {
        winner = w;
        endedAt = t;
        break;
      }
    }

    assert.deepEqual(battle.rejected, [], 'o motor recusou comandos que o simulador executou');
    assert.equal(winner, fx.result.winner);
    assert.equal(endedAt, fx.result.timeMs);

    const enemyCasts = battle.events
      .filter((e) => e.kind === 'cast' && e.side === 'enemy')
      .map((e) => (e.kind === 'cast' ? { t: e.t, enemy: e.mon, skill: e.skill, target: e.target } : null));
    assert.deepEqual(enemyCasts, fx.enemyCasts, 'habilidades dos inimigos');
  });
}
