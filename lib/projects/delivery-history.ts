import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { projectDir } from "./paths";
import { DELIVERY_EVENT_TYPES, httpUrl, type DeliveryEvent, type DeliveryEventType } from "./delivery-types";

const url = z.string().refine((v) => httpUrl(v) !== null, "Expected an HTTP(S) URL");
const check = z.object({ name: z.string(), state: z.enum(["pass", "fail", "pending", "skipped"]), url: url.nullable() });
const pr = z.object({ number: z.number().int().positive(), url, title: z.string(), head: z.string() });
const snapshot = z.object({
  id: z.string(), branch: z.string(), pr,
  state: z.enum(["OPEN", "CLOSED", "MERGED"]), checks: z.array(check),
  reviews: z.array(z.string()), requests: z.array(z.string()),
  deployments: z.array(z.object({ id: z.string(), state: z.string(), url: url.nullable() })),
});
const event = z.object({
  id: z.string(), seq: z.number().int().positive(), type: z.enum(DELIVERY_EVENT_TYPES), at: z.iso.datetime(),
  branch: z.string(), pr, checks: z.array(check), previewUrl: url.nullable(),
});
const journal = z.object({
  version: z.literal(1), epoch: z.string(), seq: z.number().int().nonnegative(),
  snapshots: z.array(snapshot), events: z.array(event).max(200),
});
export type DeliverySnapshot = z.infer<typeof snapshot>;
export type DeliveryHistory = z.infer<typeof journal>;
export const emptyDeliveryHistory = (): DeliveryHistory => ({ version: 1, epoch: randomUUID(), seq: 0, snapshots: [], events: [] });
const fileFor = (root: string) => path.join(projectDir(root), "delivery.json");

export async function readDeliveryHistory(root: string): Promise<DeliveryHistory> {
  try { return journal.parse(JSON.parse(await readFile(fileFor(root), "utf8"))); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyDeliveryHistory();
    throw err;
  }
}

export async function writeDeliveryHistory(root: string, history: DeliveryHistory) {
  const content = JSON.stringify(journal.parse(history));
  const file = fileFor(root);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, content, { mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}

const checksState = (s: DeliverySnapshot) => s.checks.some((c) => c.state === "fail") ? "fail"
  : s.checks.some((c) => c.state === "pending") ? "pending"
    : s.checks.some((c) => c.state === "pass") ? "pass" : "none";

/** First observation of each PR is a quiet baseline, including after history is reset. */
export function advanceDeliveryHistory(previous: DeliveryHistory, snapshots: DeliverySnapshot[], at = new Date().toISOString()): DeliveryHistory {
  let seq = previous.seq;
  const events: DeliveryEvent[] = [];
  for (const current of snapshots) {
    const before = previous.snapshots.find((s) => s.id === current.id);
    if (!before) continue;
    const add = (type: DeliveryEventType, previewUrl: string | null = null) => {
      seq++;
      events.push({ id: `${previous.epoch}:${seq}`, seq, type, at, branch: current.branch, pr: current.pr, checks: current.checks, previewUrl });
    };
    if (current.state === "MERGED" && before.state === "OPEN") add("pr_merged");
    if (current.state !== "OPEN") continue;
    const ci = checksState(current);
    if ((ci === "fail" || ci === "pass") && (ci !== checksState(before) || current.pr.head !== before.pr.head)) add(ci === "fail" ? "ci_failed" : "ci_passed");
    if (current.reviews.some((id) => !before.reviews.includes(id))) add("review_posted");
    if (current.requests.some((id) => !before.requests.includes(id))) add("review_requested");
    for (const deploy of current.deployments) {
      if (deploy.state === "SUCCESS" && deploy.url && !before.deployments.some((d) => d.id === deploy.id && d.state === "SUCCESS" && d.url === deploy.url)) add("deploy_ready", deploy.url);
    }
  }
  // shortcut: retain 200 project events; add archival storage if a full audit trail is needed.
  return journal.parse({ ...previous, seq, snapshots: snapshots.filter((s) => s.state === "OPEN"), events: [...previous.events, ...events].slice(-200) });
}
