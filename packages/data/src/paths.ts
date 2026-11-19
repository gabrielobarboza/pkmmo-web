import { fileURLToPath } from 'node:url';

/** Pasta `data/` na raiz do repositório. */
export const DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

/** Arquivo de saída do build. */
export const REGISTRY_FILE = fileURLToPath(new URL('../dist/registry.json', import.meta.url));
