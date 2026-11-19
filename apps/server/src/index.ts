import { DATA_DIR, DataError, loadRegistry } from '@pkmmo/data';

// O servidor só sobe com dados válidos (SDD 03): um dado inválido falha aqui, e não no meio de uma luta.
function main() {
  let registry;
  try {
    registry = loadRegistry(DATA_DIR);
  } catch (e) {
    if (e instanceof DataError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  console.log(
    `[server] dados ${registry.version}: ${Object.keys(registry.skills).length} habilidades, ` +
      `${Object.keys(registry.monsters).length} monstros`,
  );

  // Próximo passo (SDD 02 e 03): adicionar o Colyseus, uma sala de combate por grupo
  // e o motor de combate de packages/combat rodando em tick fixo.
}

main();
