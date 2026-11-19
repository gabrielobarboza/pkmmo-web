import { z } from 'zod';
import { elementSchema, idSchema, posInt, statusTypeSchema } from './common';

/** Tempo sempre em ms e distância sempre em metros (SDD 03). */

export const areaEffectSchema = z
  .object({
    /** Raio em metros. */
    radius: z.number().positive(),
    /** Duração em ms. Sem ela, o efeito é aplicado uma vez; com ela, a área fica no chão. */
    duration: posInt.optional(),
  })
  .strict();

export const statusEffectSchema = z
  .object({
    type: statusTypeSchema,
    /** Stacks aplicados no contato (acerto direto ou burst). */
    stacksPerHit: posInt.optional(),
    /** Intervalo do tick da área, em ms. */
    tickMs: posInt.optional(),
    /** Stacks aplicados por tick da área. */
    stacksPerTick: posInt.optional(),
  })
  .strict();

const attributeEffectSchema = z
  .object({
    type: z.enum(['offense', 'defense']),
    /** Duração em ms; o padrão vem de config/combat.json. */
    duration: posInt.optional(),
    /** Magnitude em %; o padrão vem de config/combat.json. */
    magnitudePct: z.number().positive().optional(),
  })
  .strict();
export const buffEffectSchema = attributeEffectSchema;
export const debuffEffectSchema = attributeEffectSchema;

export const healEffectSchema = z
  .object({
    /** % da vida máxima de cada monstro curado, por aplicação (por tick na cura over time). */
    amountPct: z.number().positive(),
    /** Intervalo do tick da cura over time, em ms (exige areaEffect.duration). */
    tickMs: posInt.optional(),
  })
  .strict();

export const skillSchema = z
  .object({
    $schema: z.string().optional(),
    id: idSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    notes: z.string().optional(),
    element: elementSchema,
    category: z.enum(['physical', 'special', 'effect']),
    /** Poder base do dano direto. Acima de 0 causa dano. */
    power: z.number().min(0).optional(),
    /** Recarga em ms. */
    cooldown: posInt,
    /** Substitui o defaultThreat no acerto. */
    threat: z.number().min(0).optional(),
    /** Taunt: define o threat de quem usou. */
    threatSet: z.number().min(0).optional(),
    areaEffect: areaEffectSchema.optional(),
    statusEffect: statusEffectSchema.optional(),
    buffEffect: buffEffectSchema.optional(),
    debuffEffect: debuffEffectSchema.optional(),
    healEffect: healEffectSchema.optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    const power = s.power ?? 0;
    if (s.category === 'effect' && power > 0) {
      issue(['power'], 'a categoria effect não pode ter power');
    }
    if (s.category !== 'effect' && power <= 0) {
      issue(['power'], 'habilidades physical e special precisam de power acima de 0');
    }

    if (s.statusEffect) {
      const { tickMs, stacksPerTick } = s.statusEffect;
      if ((tickMs === undefined) !== (stacksPerTick === undefined)) {
        issue(['statusEffect'], 'tickMs e stacksPerTick devem aparecer juntos');
      }
      if (tickMs !== undefined && s.areaEffect?.duration === undefined) {
        issue(['statusEffect', 'tickMs'], 'tickMs exige areaEffect.duration');
      }
      if (
        s.statusEffect.stacksPerHit === undefined &&
        tickMs === undefined &&
        stacksPerTick === undefined
      ) {
        issue(['statusEffect'], 'statusEffect precisa de stacksPerHit ou de tickMs com stacksPerTick');
      }
    }

    if (s.healEffect) {
      if (s.healEffect.tickMs !== undefined && s.areaEffect?.duration === undefined) {
        issue(['healEffect', 'tickMs'], 'tickMs exige areaEffect.duration');
      }
      if (s.areaEffect?.duration !== undefined && s.healEffect.tickMs === undefined) {
        issue(['healEffect', 'tickMs'], 'cura com area de duração exige tickMs');
      }
    }

    if (s.category !== 'effect') {
      for (const key of ['buffEffect', 'debuffEffect', 'healEffect'] as const) {
        if (s[key]) issue([key], `${key} só vale na categoria effect`);
      }
      if (s.threatSet !== undefined) issue(['threatSet'], 'threatSet só vale na categoria effect');
    }

    if (s.buffEffect && s.debuffEffect) {
      issue(['debuffEffect'], 'uma habilidade não combina buffEffect e debuffEffect');
    }
  });

export type Skill = z.infer<typeof skillSchema>;
