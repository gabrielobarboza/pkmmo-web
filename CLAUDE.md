# Instruções do projeto

Jogo cooperativo de ação com tema Pokémon, no navegador. Projeto pessoal e sem fins comerciais. Veja o `README.md` para a estrutura e os comandos.

## Como trabalhar aqui

- O projeto segue SDD: a especificação vem antes do código. Se uma mudança contradiz uma spec (SDD 02 de combate, SDD 03 de dados), pare e pergunte, em vez de decidir sozinho.
- Converse com o autor em português. Código, identificadores, nomes de habilidades e tipos Pokémon ficam em inglês.
- Todo tempo é em milissegundos e toda distância em metros, nos dados e no código.
- Os valores de balanceamento (poder, cooldown, threat, durações) ficam em `data/`, nunca no código. O código tem as regras e as fórmulas.
- O motor de combate (`packages/combat`) é TypeScript puro, sem I/O e sem dependência de rede, para ser compartilhado por servidor, testes e simulador.
- O servidor decide tudo (autoritativo). O cliente só envia comandos e desenha o estado.

## Dados

- Um arquivo JSON por habilidade e por monstro, com `id` igual ao nome do arquivo.
- Mudar o schema em `packages/data/src/schema` exige atualizar os arquivos de `data/` e os testes.
- Rode `pnpm build:data` e `pnpm test` antes de commitar.
