import { z } from 'zod';
import { elementSchema, idSchema, posInt, roleSchema } from './common';

export const monsterSchema = z
  .object({
    $schema: z.string().optional(),
    id: idSchema,
    name: z.string().min(1),
    /** Número da Pokédex, para ligar o monstro aos sprites. */
    dex: posInt.optional(),
    notes: z.string().optional(),
    types: z.array(elementSchema).min(1).max(2),
    role: roleSchema,
    /** Boss: o Taunt e as travas de alvo duram `threat.bossLockMultiplier` da duração normal. */
    boss: z.boolean().optional(),
    baseStats: z
      .object({
        hp: posInt,
        attack: posInt,
        defense: posInt,
        spAttack: posInt,
        spDefense: posInt,
        speed: posInt,
      })
      .strict(),
    /** Ids de habilidades (até 4); não precisam ser do tipo do monstro. */
    moves: z.array(idSchema).min(1).max(4),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (new Set(m.types).size !== m.types.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['types'], message: 'tipos repetidos' });
    }
    if (new Set(m.moves).size !== m.moves.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['moves'], message: 'habilidades repetidas' });
    }
  });

export type Monster = z.infer<typeof monsterSchema>;
