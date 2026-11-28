import "server-only";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { dbSession, describeDatabase, hasDatabase } from "@/lib/db/server";
import { HttpError } from "@/lib/api/errors";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { DATA_DIR, sharedConfigDir } from "@/lib/projects/paths";
import { computeNextRun, isValidTimezone } from "@/lib/routines/cron";
import { serverInfo } from "@/lib/server/info";
import { BACKUP_DEFAULTS, backupDirOf, createBackup, listBackups, pruneBackups } from "../../scripts/backup-core.mjs";
import type { BackupSettings, BackupStatus } from "./types";

export type { BackupSettings, BackupStatus } from "./types";

export const BackupInput = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 03:00"),
  tz: z.string().trim().max(100).nullable().optional().refine((tz) => !tz || isValidTimezone(tz), "Unknown time zone"),
  keep: z.number().int().min(1, "Keep at least one backup").max(365),
  dir: z.string().trim().max(1000).nullable().optional().refine((dir) => !dir || path.isAbsolute(dir.replace(/^~(?=$|\/)/, os.homedir())), "Use an absolute folder path"),
}).strict();

const DEFAULTS = BACKUP_DEFAULTS as BackupSettings;
const file = () => path.join(sharedConfigDir(), "backup.json");
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");

export async function readBackupSettings(): Promise<BackupSettings> {
  const text = await readOptional(file()).catch(() => null);
  try {
    return { ...DEFAULTS, ...(text ? JSON.parse(text) : {}) };
  } catch {
    return DEFAULTS;
  }
}

export async function saveBackupSettings(input: z.infer<typeof BackupInput>) {
  const next = BackupInput.parse(input);
  return withFileLock(file(), async () => {
    const previous = await readOptional(file());
    const settings: BackupSettings = { ...DEFAULTS, ...(previous ? JSON.parse(previous) : {}), ...next, tz: next.tz || null, dir: next.dir || null };
    await replaceFile(file(), JSON.stringify(settings, null, 2), previous);
    return settings;
  });
}

const backupDir = (settings: BackupSettings) => backupDirOf(DATA_DIR, settings, os.homedir()) as string;
const cronOf = (time: string) => { const [h, m] = time.split(":").map(Number); return `${m} ${h} * * *`; };

/** The latest scheduled time at or before `now`: a backup older than this is due. */
export function lastSlot(settings: Pick<BackupSettings, "time" | "tz">, now = new Date()): Date | null {
  const slot = computeNextRun(cronOf(settings.time), settings.tz, new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return slot && slot <= now ? slot : null;
}

type Ticker = { timer: ReturnType<typeof setInterval> | null; tick: () => Promise<void>; running: boolean; lastError: { at: string; message: string } | null };
const g = globalThis as typeof globalThis & { __thunkBackup?: Ticker };
const state = g.__thunkBackup ??= { timer: null, tick: async () => {}, running: false, lastError: null };

export async function backupStatus(): Promise<BackupStatus> {
  const settings = await readBackupSettings();
  const dir = backupDir(settings);
  const backups = (await listBackups(dir)).map(({ name, size, createdAt }: { name: string; size: number; createdAt: string }) => ({ name, size, createdAt }));
  const nextRunAt = settings.enabled ? computeNextRun(cronOf(settings.time), settings.tz)?.toISOString() ?? null : null;
  return { settings, dir, backups, nextRunAt, running: state.running, lastError: state.lastError };
}

/** Writes one archive now and prunes to `keep`. Only one runs at a time. */
export async function runBackup({ withTranscripts = false }: { withTranscripts?: boolean } = {}) {
  if (!hasDatabase()) throw new HttpError(409, `This Thunk keeps its data in memory (${describeDatabase()}), so there is nothing to back up here. Back up from the Thunk that holds the database.`);
  if (state.running) throw new HttpError(409, "A backup is already running.");
  state.running = true;
  try {
    const settings = await readBackupSettings();
    const dir = backupDir(settings);
    const common = { dataDir: DATA_DIR, outDir: dir, claudeDir: withTranscripts ? claudeDir() : null, version: serverInfo().revision };
    const session = dbSession();
    const backup = session
      ? await session((db, { begin }) => createBackup({ ...common, db, begin }))
      : await createBackup({ ...common, db: null });
    const removed: string[] = await pruneBackups(dir, settings.keep);
    state.lastError = null;
    return { file: backup.file as string, name: backup.name as string, size: backup.size as number, createdAt: backup.manifest.createdAt as string, removed };
  } catch (error) {
    state.lastError = { at: new Date().toISOString(), message: (error as Error).message };
    throw error;
  } finally {
    state.running = false;
  }
}

/** A failed scheduled backup waits this long before trying again, so a full disk isn't hit every minute. */
const RETRY_MS = 60 * 60 * 1000;

async function tick() {
  if (state.running || !hasDatabase()) return;
  try {
    const settings = await readBackupSettings();
    if (!settings.enabled) return;
    const slot = lastSlot(settings);
    if (!slot) return;
    // Due when the newest archive predates today's slot; a slot missed while the server was down runs on the next tick.
    const [newest] = await listBackups(backupDir(settings));
    if (newest && Date.parse(newest.createdAt) >= slot.getTime()) return;
    if (state.lastError && Date.now() - Date.parse(state.lastError.at) < RETRY_MS) return;
    const result = await runBackup();
    console.log(`[thunk] backup written: ${result.file}`);
  } catch (err) {
    console.error("[thunk] backup failed", err);
  }
}

export function ensureBackupScheduler() {
  state.tick = tick;
  if (state.timer) return;
  state.timer = setInterval(() => void state.tick(), 60_000);
  state.timer.unref?.();
}
