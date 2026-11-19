import { z } from 'zod';
import { ELEMENTS, elementSchema, posInt, roleSchema, statusTypeSchema } from './common';

const pct = z.number().min(0);

const roleBonusSchema = z
  .object({
    hpPct: pct.optional(),
    defensivePct: pct.optional(),
    offensivePct: pct.optional(),
    critBonusPct: pct.optional(),
    healPct: pct.optional(),
    buffDurationPct: pct.optional(),
    debuffDurationPct: pct.optional(),
    cleanseDurationPct: pct.optional(),
    healAreaDurationPct: pct.optional(),
    periodicDamagePct: pct.optional(),
    extraDirectStacks: z.number().int().min(0).optional(),
    extraEffectDurationMs: z.number().int().min(0).optional(),
    areaTickMs: posInt.optional(),
    areaStatuses: z.array(statusTypeSchema).optional(),
  })
  .strict();

export const combatConfigSchema = z
  .object({
    team: z
      .object({
        maxTeamSize: posInt,
        swapCooldownMs: posInt,
        globalCooldownMs: posInt,
        maxAreasPerPlayer: posInt,
        downedDurationMs: posInt,
      })
      .strict(),
    level: z
      .object({ min: posInt, max: posInt, shinyBonusPct: pct })
      .strict()
      .refine((l) => l.min <= l.max, 'min deve ser menor ou igual a max'),
    damage: z
      .object({
        stabMultiplier: z.number().positive(),
        typeDefenseStep: z.number().positive().lt(0.5),
        attributeModifierPct: pct,
        defaultModifierDurationMs: posInt,
      })
      .strict(),
    crit: z
      .object({
        baseChancePct: pct,
        typeStepPct: pct,
        damageMultiplier: z.number().positive(),
      })
      .strict(),
    threat: z
      .object({
        defaultThreat: z.number().positive(),
        overTimeDivisor: z.number().positive(),
        directHealMultiplier: z.number().positive(),
        cap: z.number().positive(),
        tankerMultiplier: z.number().positive(),
        bossLockMultiplier: z.number().positive().max(1),
      })
      .strict(),
    enemy: z.object({ skillIntervalMs: posInt }).strict(),
    boss: z.object({ periodicDamageMultiplier: z.number().positive().max(1) }).strict(),
    roles: z.record(roleSchema, roleBonusSchema),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const role of roleSchema.options) {
      if (!(role in c.roles)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['roles', role], message: 'função ausente' });
      }
    }
    if (c.threat.cap < c.threat.defaultThreat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['threat', 'cap'],
        message: 'o teto de threat deve ser maior que o defaultThreat',
      });
    }
  });
export type CombatConfig = z.infer<typeof combatConfigSchema>;

const statusDefSchema = z
  .object({
    stacksToTrigger: posInt,
    durationMs: posInt,
    periodicDamagePctMaxHp: pct.optional(),
    outputDamagePct: z.number().optional(),
    stun: z.boolean().optional(),
    stunMs: posInt.optional(),
    slow: z.boolean().optional(),
    removedByElements: z.array(elementSchema).optional(),
    cleanseOnly: z.boolean().optional(),
    brokenByDirectAttack: z.boolean().optional(),
    blocksStacksWhileActive: z.boolean().optional(),
  })
  .strict();

const escalationDefSchema = z
  .object({
    escalatesFrom: statusTypeSchema,
    stacks: posInt,
    durationMs: posInt,
    periodicDamagePctMaxHp: pct,
    cleanseOnly: z.boolean().optional(),
  })
  .strict();

export const statusConfigSchema = z
  .object({
    stackDurationMs: posInt,
    periodicTickMs: posInt,
    immunityWindowMs: posInt,
    statuses: z.record(statusTypeSchema, statusDefSchema),
    escalations: z.record(z.string(), escalationDefSchema),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const type of statusTypeSchema.options) {
      if (!(type in c.statuses)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statuses', type], message: 'status ausente' });
      }
    }
    for (const [name, esc] of Object.entries(c.escalations)) {
      if (!(esc.escalatesFrom in c.statuses)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['escalations', name, 'escalatesFrom'],
          message: `status ${esc.escalatesFrom} não existe em statuses`,
        });
      }
    }
  });
export type StatusConfig = z.infer<typeof statusConfigSchema>;

const matchupSchema = z
  .object({
    vulnerable: z.array(elementSchema).optional(),
    resistant: z.array(elementSchema).optional(),
    immune: z.array(elementSchema).optional(),
  })
  .strict();

/** Para cada tipo atacante, os tipos defensores contra os quais ele é vulnerável, resistente ou imune. O resto é neutro. */
export const typeChartSchema = z
  .record(elementSchema, matchupSchema)
  .superRefine((chart, ctx) => {
    for (const attacker of ELEMENTS) {
      const entry = chart[attacker];
      if (!entry) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [attacker], message: 'tipo atacante ausente' });
        continue;
      }
      const seen = new Set<string>();
      for (const key of ['vulnerable', 'resistant', 'immune'] as const) {
        for (const defender of entry[key] ?? []) {
          if (seen.has(defender)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [attacker, key],
              message: `${defender} aparece em mais de uma lista`,
            });
          }
          seen.add(defender);
        }
      }
    }
  });
export type TypeChart = z.infer<typeof typeChartSchema>;
