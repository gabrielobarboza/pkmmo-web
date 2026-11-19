# pkmmo-web

Jogo cooperativo de ação com tema Pokémon, no navegador, feito como projeto pessoal para jogar com amigos. Combate em tempo real inspirado em Genshin Impact, com visual 2D isométrico.

O projeto segue SDD (specs antes do código). As specs ficam em documentos próprios:

| Spec | Assunto |
| --- | --- |
| SDD 01 | Stack e infraestrutura |
| [SDD 02](https://claude.ai/artifact/LpRLtBHUTLjt8tCiHJVcyt) | Design do combate |
| [SDD 03](https://claude.ai/artifact/SsUUZV7BRFV6L8teCa3SKs) | Dados do jogo (habilidades, monstros, configuração) |

## Estrutura

```text
data/                 definições do jogo (um JSON por habilidade e por monstro)
  skills/
  monsters/
  config/
packages/
  data/               schemas (zod), validação e build do registro de dados
  combat/             motor de combate em TypeScript puro (vários jogadores e threat; curas ainda não)
  combat/fixtures/    cenários gerados pelo simulador, usados nos testes de paridade
tools/
  simulator/          simulador de referência em Python (sim.py) e gerador dos cenários
apps/
  server/             servidor autoritativo (carrega o registro de dados)
  client/             cliente web (aguarda a spec visual)
```

## Comandos

Requer Node 22 e pnpm (`corepack enable`).

```bash
pnpm install
pnpm build:data     # valida data/ e gera packages/data/dist/registry.json
pnpm test           # schemas, dados reais e paridade do motor com o simulador
pnpm typecheck
pnpm server         # sobe o servidor (falha se algum dado for inválido)
```

## Cenários de referência

O motor é testado contra o simulador de `tools/simulator`. Depois de mudar uma regra no simulador, regenere os cenários:

```bash
python3 tools/simulator/export_fixtures.py packages/combat/fixtures
```

## Regras dos dados

- Todo tempo é em milissegundos e toda distância em metros.
- O `id` de cada arquivo é igual ao nome do arquivo, sem a extensão.
- Um dado inválido impede o build e o início do servidor.

## Licença

MIT
