import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DataError, loadRegistry } from './load';
import { DATA_DIR } from './paths';

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function copyData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pkmmo-data-'));
  tmpDirs.push(dir);
  cpSync(DATA_DIR, dir, { recursive: true });
  return dir;
}

test('os dados reais são válidos', () => {
  const registry = loadRegistry(DATA_DIR);
  assert.equal(Object.keys(registry.skills).length, 15);
  assert.equal(Object.keys(registry.monsters).length, 3);
  assert.match(registry.version, /^[0-9a-f]{16}$/);
});

test('todo monstro de teste só usa habilidades que existem', () => {
  const registry = loadRegistry(DATA_DIR);
  for (const monster of Object.values(registry.monsters)) {
    for (const move of monster.moves) assert.ok(registry.skills[move], `${monster.id} -> ${move}`);
  }
});

test('o hash muda quando um dado muda e é estável quando não muda', () => {
  const a = loadRegistry(DATA_DIR).version;
  assert.equal(loadRegistry(DATA_DIR).version, a);

  const dir = copyData();
  const file = join(dir, 'skills', 'ember.json');
  const skill = JSON.parse(readFileSync(file, 'utf8'));
  skill.power = 41;
  writeFileSync(file, JSON.stringify(skill));
  assert.notEqual(loadRegistry(dir).version, a);
});

test('id diferente do nome do arquivo é recusado, com o caminho no erro', () => {
  const dir = copyData();
  const file = join(dir, 'skills', 'ember.json');
  const skill = JSON.parse(readFileSync(file, 'utf8'));
  skill.id = 'embers';
  writeFileSync(file, JSON.stringify(skill));
  assert.throws(
    () => loadRegistry(dir),
    (e: unknown) => e instanceof DataError && e.errors.some((m) => m.startsWith('skills/ember.json:')),
  );
});

test('monstro que referencia habilidade inexistente é recusado', () => {
  const dir = copyData();
  const file = join(dir, 'monsters', 'squirtle.json');
  const monster = JSON.parse(readFileSync(file, 'utf8'));
  monster.moves[3] = 'hydro-pump';
  writeFileSync(file, JSON.stringify(monster));
  assert.throws(
    () => loadRegistry(dir),
    (e: unknown) => e instanceof DataError && e.errors.some((m) => m.includes('"hydro-pump"')),
  );
});

test('JSON malformado é recusado', () => {
  const dir = copyData();
  writeFileSync(join(dir, 'skills', 'tackle.json'), '{ not json');
  assert.throws(() => loadRegistry(dir), DataError);
});

test('Poison Powder, Sleep Powder e Toxic são da categoria effect', () => {
  const { skills } = loadRegistry(DATA_DIR);
  for (const id of ['poison-powder', 'sleep-powder', 'toxic']) {
    assert.equal(skills[id]?.category, 'effect', id);
  }
});

test('o Iron Defense não tem areaEffect', () => {
  const { skills } = loadRegistry(DATA_DIR);
  assert.equal(skills['iron-defense']?.areaEffect, undefined);
});

test('o Taunt define threatSet de 500', () => {
  const { skills } = loadRegistry(DATA_DIR);
  assert.equal(skills['taunt']?.threatSet, 500);
});
