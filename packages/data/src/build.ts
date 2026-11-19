import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DataError, loadRegistry } from './load';
import { DATA_DIR, REGISTRY_FILE } from './paths';

try {
  const registry = loadRegistry(DATA_DIR);
  mkdirSync(dirname(REGISTRY_FILE), { recursive: true });
  writeFileSync(REGISTRY_FILE, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(
    `registry ${registry.version}: ${Object.keys(registry.skills).length} habilidades, ` +
      `${Object.keys(registry.monsters).length} monstros -> ${REGISTRY_FILE}`,
  );
} catch (e) {
  if (e instanceof DataError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
