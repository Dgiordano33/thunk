// Server limits: shapes, defaults and ranges. Client-safe (the Settings screen reads the ranges); the file I/O is in ./limits.ts.
import { z } from "zod";

export const LIMIT_FIELDS = [
  { key: "workersPerProject", label: "Workers per project", description: "Workers a project's chief runs at once. Extra tasks queue and start when a slot frees.", unit: "workers", min: 1, max: 12, default: 4 },
  { key: "routineRunsAtOnce", label: "Routine runs at once", description: "Routine runs in progress across all projects. A trigger past this is skipped.", unit: "runs", min: 1, max: 10, default: 3 },
  { key: "chiefAnswerMinutes", label: "Chief answer wait", description: "How long a chief has to answer a worker's question before it comes to you.", unit: "min", min: 1, max: 60, default: 10 },
] as const;

export type LimitKey = (typeof LIMIT_FIELDS)[number]["key"];
export type Limits = Record<LimitKey, number>;

export const DEFAULT_LIMITS = Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, f.default])) as Limits;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/** Lenient: what's on disk. Out-of-range numbers are clamped and anything unreadable falls back to its default. */
const FileSchema = z.object(Object.fromEntries(LIMIT_FIELDS.map((f) => [
  f.key,
  z.number().transform((v) => clamp(v, f.min, f.max)).catch(f.default),
])) as unknown as Record<LimitKey, z.ZodType<number, unknown>>);

export function parseLimits(raw: unknown): Limits {
  const parsed = FileSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return parsed.success ? (parsed.data as Limits) : { ...DEFAULT_LIMITS };
}

/** Strict: what the API accepts. Whole numbers inside each range; any subset of keys. */
export const LimitsPatch = z.strictObject(Object.fromEntries(LIMIT_FIELDS.map((f) => [
  f.key,
  z.number({ error: `${f.label} must be a number` }).int(`${f.label} must be a whole number`)
    .min(f.min, `${f.label} must be at least ${f.min}`).max(f.max, `${f.label} must be at most ${f.max}`).optional(),
])) as unknown as Record<LimitKey, z.ZodOptional<z.ZodNumber>>);
export type LimitsPatch = Partial<Limits>;
