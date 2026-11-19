import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ZodType } from 'zod';
import {
  combatConfigSchema,
  monsterSchema,
  skillSchema,
  statusConfigSchema,
  typeChartSchema,
  type Registry,
} from './schema';

export class DataError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Dados inválidos (${errors.length} erro${errors.length === 1 ? '' : 's'}):\n- ${errors.join('\n- ')}`);
    this.name = 'DataError';
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function readJson<T>(
  file: string,
  label: string,
  schema: ZodType<T>,
  errors: string[],
): T | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${label}: JSON inválido (${(e as Error).message})`);
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length ? issue.path.join('.') : '(raiz)';
      errors.push(`${label}: ${path} ${issue.message}`);
    }
    return undefined;
  }
  return parsed.data;
}

function readDir<T extends { id: string }>(
  dir: string,
  folder: string,
  schema: ZodType<T>,
  errors: string[],
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!existsSync(dir)) {
    errors.push(`${folder}/: pasta não encontrada`);
    return out;
  }
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const label = `${folder}/${file}`;
    const data = readJson(join(dir, file), label, schema, errors);
    if (!data) continue;
    if (data.id !== basename(file, '.json')) {
      errors.push(`${label}: id "${data.id}" deve ser igual ao nome do arquivo`);
      continue;
    }
    out[data.id] = data;
  }
  return out;
}

/** Lê e valida a pasta de dados. Lança DataError com todos os problemas encontrados. */
export function loadRegistry(dataDir: string): Registry {
  const errors: string[] = [];

  const skills = readDir(join(dataDir, 'skills'), 'skills', skillSchema, errors);
  const monsters = readDir(join(dataDir, 'monsters'), 'monsters', monsterSchema, errors);
  const combat = readJson(join(dataDir, 'config', 'combat.json'), 'config/combat.json', combatConfigSchema, errors);
  const status = readJson(join(dataDir, 'config', 'status.json'), 'config/status.json', statusConfigSchema, errors);
  const typeChart = readJson(join(dataDir, 'config', 'type-chart.json'), 'config/type-chart.json', typeChartSchema, errors);

  // Verificações entre arquivos
  for (const monster of Object.values(monsters)) {
    for (const move of monster.moves) {
      if (!skills[move]) {
        errors.push(`monsters/${monster.id}.json: moves referencia "${move}", que não existe em skills/`);
      }
    }
  }
  if (combat) {
    for (const skill of Object.values(skills)) {
      if (skill.threatSet !== undefined && skill.threatSet > combat.threat.cap) {
        errors.push(`skills/${skill.id}.json: threatSet maior que o teto de threat (${combat.threat.cap})`);
      }
    }
  }

  if (errors.length > 0 || !combat || !status || !typeChart) {
    throw new DataError(errors);
  }

  const body = { skills, monsters, config: { combat, status, typeChart } };
  const version = createHash('sha256').update(stableStringify(body)).digest('hex').slice(0, 16);
  return { version, ...body };
}
