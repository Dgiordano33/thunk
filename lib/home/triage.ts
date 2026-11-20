import "server-only";
import path from "node:path";
import { z } from "zod";
import { pushUserMessage } from "@/lib/agent";
import { projectConfigDir } from "@/lib/projects/paths";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { projectNoteDirs } from "@/lib/notes/resolve";
import { listNotes } from "@/lib/notes/store";
import { getProjectByKey } from "@/lib/db/repo/projects";
import { HOME_DATA_KEY } from "./constants";
import { computeNextRun, cronError, isValidTimezone } from "@/lib/routines/cron";
import { ensureHomeProject, openTopChief, readRoutingState, routeRequest } from "./service";

export const TriageInput = z.object({
  enabled: z.boolean(),
  cron: z.string().trim().min(1).max(100),
  tz: z.string().trim().max(100).nullable().optional(),
}).strict().superRefine((t, ctx) => {
  if (t.tz && !isValidTimezone(t.tz)) ctx.addIssue({ code: "custom", path: ["tz"], message: "Unknown time zone" });
  const err = cronError(t.cron, t.tz);
  if (err) ctx.addIssue({ code: "custom", path: ["cron"], message: err });
});
export type { TriageSettings } from "./triage-types";
import type { TriageSettings } from "./triage-types";

/** Weekday mornings, off until the person turns it on. */
const DEFAULTS: TriageSettings = { enabled: false, cron: "30 8 * * 1-5", tz: null, nextRunAt: null, lastRunAt: null, lastResult: null };
const file = (dataKey: string) => path.join(projectConfigDir(dataKey), "routing", "triage.json");

/** Reads without creating the Home project, so the scheduler costs nothing until triage is used. */
export async function readTriage(): Promise<TriageSettings> {
  const home = await getProjectByKey(HOME_DATA_KEY);
  const text = home ? await readOptional(file(home.dataKey)) : null;
  return text ? { ...DEFAULTS, ...JSON.parse(text) } : DEFAULTS;
}
async function updateTriage(mutate: (t: TriageSettings) => TriageSettings) {
  const home = await ensureHomeProject();
  const f = file(home.dataKey);
  return withFileLock(f, async () => {
    const previous = await readOptional(f);
    const next = mutate(previous ? { ...DEFAULTS, ...JSON.parse(previous) } : DEFAULTS);
    await replaceFile(f, JSON.stringify(next), previous);
    return next;
  });
}

export async function saveTriage(input: z.infer<typeof TriageInput>) {
  const t = TriageInput.parse(input);
  return updateTriage((prev) => ({ ...prev, ...t, tz: t.tz || null, nextRunAt: t.enabled ? computeNextRun(t.cron, t.tz || null)?.toISOString() ?? null : null }));
}

/**
 * Hand every top-level note with unrouted items to the top chief in one message, and ask for today's
 * summary in the work log. Skips the model turn when nothing is new.
 */
export async function runTriage(reason: "scheduled" | "manual") {
  const home = await ensureHomeProject();
  const since = (await readTriage()).lastRunAt;
  const notes = (await listNotes(projectNoteDirs(home), { withMemory: false })).filter((n) => !n.id.startsWith("work-log-"));
  const requests = (await Promise.all(notes.map((n) => routeRequest(n.id, "triage").catch(() => null)))).filter((r) => r && r.open > 0);
  const routes = Object.values((await readRoutingState(home)).routes);
  const settled = routes.filter((r) => r.status !== "routed" && (!since || r.updatedAt > since)).length;
  const open = requests.reduce((n, r) => n + r!.open, 0);
  let result: string;
  if (!open && !settled) result = "Nothing new to route";
  else {
    const top = await openTopChief();
    pushUserMessage(top, `<triage reason="${reason}" date="${new Date().toISOString().slice(0, 10)}">\n${open} unrouted item${open === 1 ? "" : "s"} in ${requests.length} note${requests.length === 1 ? "" : "s"}; ${settled} routed request${settled === 1 ? "" : "s"} settled since the last triage.\n\n${requests.map((r) => r!.message).join("\n\n")}\n</triage>\nPropose one route_plan per note for the items you can place; ask the person about the rest. Then call routes_status and write today's summary with top_log: what was routed, what settled, what is waiting on the person.`);
    result = `Sent ${open} item${open === 1 ? "" : "s"} to the top chief`;
  }
  await updateTriage((t) => ({ ...t, lastRunAt: new Date().toISOString(), lastResult: result }));
  return { result, open, settled };
}

const g = globalThis as typeof globalThis & { __thunkTriage?: { timer: ReturnType<typeof setInterval> | null; tick: () => Promise<void>; ticking: boolean } };
const state = g.__thunkTriage ??= { timer: null, tick: async () => {}, ticking: false };

async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    const t = await readTriage();
    if (!t.enabled || !t.nextRunAt || Date.parse(t.nextRunAt) > Date.now()) return;
    // Advance first so a slow turn cannot fire it twice. A missed slot (server down) fires once on the next tick.
    await updateTriage((s) => ({ ...s, nextRunAt: computeNextRun(s.cron, s.tz ?? null)?.toISOString() ?? null }));
    await runTriage("scheduled");
  } catch (err) {
    console.error("[thunk] triage failed", err);
  } finally {
    state.ticking = false;
  }
}

export function ensureTriageScheduler() {
  state.tick = tick;
  if (state.timer) return;
  state.timer = setInterval(() => void state.tick(), 60_000);
  state.timer.unref?.();
}
