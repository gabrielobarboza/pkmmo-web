import type { CombatConfig, StatusConfig, TypeChart } from './config';
import type { Monster } from './monster';
import type { Skill } from './skill';

/** Dados de jogo já validados, em memória. Sem dependências do Node, para valer no motor e no cliente. */
export interface GameData {
  skills: Record<string, Skill>;
  monsters: Record<string, Monster>;
  config: {
    combat: CombatConfig;
    status: StatusConfig;
    typeChart: TypeChart;
  };
}

export interface Registry extends GameData {
  /** Hash do conteúdo; cliente e servidor o comparam ao conectar. */
  version: string;
}
