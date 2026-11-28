import "server-only";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sharedConfigDir } from "@/lib/projects/paths";
import { DEFAULT_LIMITS, parseLimits, type Limits, type LimitsPatch } from "./limits-schema";

export { DEFAULT_LIMITS, LIMIT_FIELDS, LimitsPatch, parseLimits, type Limits, type LimitKey } from "./limits-schema";

/** Server-wide limits in `~/.thunk/config/limits.json`. Read at the point of use, so an edit applies without a restart. */
export const limitsFile = () => path.join(sharedConfigDir(), "limits.json");

type Cached = { file: string; mtimeMs: number; size: number; value: Limits };
let cached: Cached | null = null;

/** The current limits. A stat per call; the file is re-read only when its mtime or size changes. */
export function readLimits(): Limits {
  let file: string;
  try { file = limitsFile(); } catch { return { ...DEFAULT_LIMITS }; }
  let stat;
  try { stat = statSync(file); } catch { cached = null; return { ...DEFAULT_LIMITS }; }
  if (cached && cached.file === file && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return { ...cached.value };
  let value: Limits;
  try { value = parseLimits(JSON.parse(readFileSync(file, "utf8"))); } catch (err) {
    console.error(`[thunk] ${file} is not valid JSON; using default limits`, err);
    value = { ...DEFAULT_LIMITS };
  }
  cached = { file, mtimeMs: stat.mtimeMs, size: stat.size, value };
  return { ...value };
}

export function updateLimits(patch: LimitsPatch): Limits {
  const next = parseLimits({ ...readLimits(), ...patch });
  const file = limitsFile();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  const stat = statSync(file);
  cached = { file, mtimeMs: stat.mtimeMs, size: stat.size, value: next };
  return { ...next };
}

export const workersPerProject = () => readLimits().workersPerProject;
export const routineRunsAtOnce = () => readLimits().routineRunsAtOnce;
export const chiefAnswerMs = () => readLimits().chiefAnswerMinutes * 60_000;
