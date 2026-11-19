import { z } from 'zod';

export const ELEMENTS = [
  'NORMAL',
  'FIRE',
  'WATER',
  'ELECTRIC',
  'GRASS',
  'ICE',
  'FIGHTING',
  'POISON',
  'GROUND',
  'FLYING',
  'PSYCHIC',
  'BUG',
  'ROCK',
  'GHOST',
  'DRAGON',
  'DARK',
  'STEEL',
  'FAIRY',
] as const;
export type Element = (typeof ELEMENTS)[number];
export const elementSchema = z.enum(ELEMENTS);

export const STATUS_TYPES = ['burn', 'poison', 'sleep', 'freeze', 'paralyze'] as const;
export type StatusType = (typeof STATUS_TYPES)[number];
export const statusTypeSchema = z.enum(STATUS_TYPES);

export const ROLES = ['support', 'tanker', 'controller', 'dps', 'attacker'] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

export const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id deve usar minúsculas, números e hífen');

/** Inteiro positivo (ms, stacks etc.). */
export const posInt = z.number().int().positive();
