import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRegistry } from './load';
import { DATA_DIR } from './paths';
import { ELEMENTS } from './schema';

const { typeChart } = loadRegistry(DATA_DIR).config;

const count = (key: 'vulnerable' | 'resistant' | 'immune') =>
  ELEMENTS.reduce((sum, attacker) => sum + (typeChart[attacker]?.[key]?.length ?? 0), 0);

// Tabela oficial da 6ª geração em diante: 51 / 61 / 8 entre as 324 combinações.
test('a tabela de tipos tem o número de relações da tabela oficial', () => {
  assert.equal(count('vulnerable'), 51);
  assert.equal(count('resistant'), 61);
  assert.equal(count('immune'), 8);
});

test('conferências pontuais que já foram erradas à mão', () => {
  assert.ok(typeChart.GROUND?.vulnerable?.includes('FIRE'));
  assert.ok(!typeChart.DRAGON?.vulnerable?.includes('FIRE'));
  assert.ok(typeChart.DARK?.vulnerable?.includes('PSYCHIC'));
  assert.ok(typeChart.BUG?.resistant?.includes('GHOST'));
  assert.ok(typeChart.FAIRY?.vulnerable?.includes('DARK'));
  assert.ok(typeChart.ROCK?.resistant?.includes('STEEL'));
});

test('as imunidades são as 8 conhecidas', () => {
  const immune = ELEMENTS.flatMap((a) => (typeChart[a]?.immune ?? []).map((d) => `${a}>${d}`)).sort();
  assert.deepEqual(immune, [
    'DRAGON>FAIRY',
    'ELECTRIC>GROUND',
    'FIGHTING>GHOST',
    'GHOST>NORMAL',
    'GROUND>FLYING',
    'NORMAL>GHOST',
    'POISON>STEEL',
    'PSYCHIC>DARK',
  ]);
});
