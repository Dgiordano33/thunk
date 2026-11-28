import "server-only";
import { createHash } from "node:crypto";
import { getSession, pushUserMessage } from "@/lib/agent";
import { HttpError } from "@/lib/api/errors";
import { documentLineage, getDocument, listDocumentsForSessions } from "@/lib/db/repo/documents";
import { getProject } from "@/lib/db/repo/projects";
import { getTask } from "@/lib/db/repo/tasks";
import { getPlanChange, insertPlanChange, linkTaskSource, listTaskSources, reviseTaskSources, setDeliveredVersion, tasksForSources, updatePlanChange } from "@/lib/db/repo/task-sources";
import { isQueued, updateQueuedInput } from "@/lib/db/repo/worker-state";
import { withFileLock } from "@/lib/notes/file-write";
import { notify, resolveBySubject } from "@/lib/notifications/service";
import type { Project } from "@/lib/projects/types";
import { patchTask } from "@/lib/tasks/service";
import { OPEN_TASK_STATUSES, normalizeCriteria, type Criterion, type Task } from "@/lib/tasks/types";
import { appendWorkLog } from "@/lib/workers/log";
import { noteBrief } from "@/lib/workers/notes";
import { buildSourceRevisionPayload, buildTaskUpdatePayload, sourceDiff } from "./payloads";
import { planChangePath, sourceLabel, type PlanChange, type PlanChangeChoice, type PlanChangeItem, type SourceKind, type SourceStamp, type TaskSource } from "./types";

export const changeSubject = (id: string) => `plan-change:${id}`;
export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
/** A note autosaves while the person types; wait for a quiet spell before asking the chief about it. */
export const NOTE_QUIET_MS = 60_000;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const isOpen = (t: Task | null | undefined) => Boolean(t && OPEN_TASK_STATUSES.includes(t.status));
function documentTitle(markdown: string) {
  const line = markdown.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const text = line.replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim();
  return (text.length > 80 ? `${text.slice(0, 79)}…` : text) || "Plan";
}

/** The newest document a session wrote: a chief's plan is usually the response it just gave. */
export async function latestDocumentOf(sessionId: string): Promise<string | null> {
  const live = getSession(sessionId);
  const event = live?.events.findLast((e) => e.type === "turn_complete" && Boolean(e.documentId));
  if (event?.type === "turn_complete" && event.documentId) return event.documentId;
  return (await listDocumentsForSessions([sessionId]).catch(() => []))[0]?.id ?? null;
}

/** The current text of a source, or null when it no longer exists. */
async function sourceText(project: Project, kind: SourceKind, sourceId: string): Promise<{ title: string; text: string } | null> {
  if (kind === "document") {
    const doc = await getDocument(sourceId);
    return doc ? { title: documentTitle(doc.markdown), text: doc.markdown } : null;
  }
  const note = await noteBrief(project, sourceId).catch(() => null);
  return note ? { title: note.note.title, text: note.note.markdown } : null;
}

/**
 * Remember what a delegated task came from: the plan's note and the chief's document. A revision of either later
 * reaches the task through the chief. Links that already exist keep their versions.
 */
export async function linkTaskSources(project: Project, task: Pick<Task, "id">, sources: { noteId?: string | null; documentId?: string | null }) {
  const out: TaskSource[] = [];
  for (const [kind, sourceId] of [["document", sources.documentId], ["note", sources.noteId]] as const) {
    if (!sourceId) continue;
    const found = await sourceText(project, kind, sourceId);
    if (!found) continue;
    out.push(await linkTaskSource({ taskId: task.id, kind, sourceId, contentHash: contentHash(found.text), content: found.text }));
  }
  return out;
}

/** What a report implements: the version of its task's source the worker had been sent, and the newest one. */
export async function sourceStamp(taskId: string): Promise<SourceStamp | null> {
  const [source] = await listTaskSources(taskId);
  return source ? { kind: source.kind, sourceId: source.sourceId, version: source.deliveredVersion, latest: source.version } : null;
}

/**
 * A source changed. Find its open tasks, record the revision, and send the chief a `<source_revision>` with the diff
 * and those tasks; it answers with tasks_revise. `sourceIds` are every id the source has gone by (a document's earlier
 * versions). Returns the plan changes it opened, one per project.
 */
export async function sourceRevised(input: { kind: SourceKind; sourceIds: string[]; before?: string | null; beforeOf?: string; after: string; title?: string }) {
  const hash = contentHash(input.after);
  const links = (await tasksForSources(input.kind, input.sourceIds)).filter((l) => l.contentHash !== hash);
  const byProject = new Map<string, { project: Project; tasks: Task[]; links: TaskSource[] }>();
  for (const link of links) {
    const task = await getTask(link.taskId);
    if (!task || !isOpen(task)) continue;
    let group = byProject.get(task.projectId);
    if (!group) {
      const project = await getProject(task.projectId);
      if (!project) continue;
      byProject.set(task.projectId, group = { project, tasks: [], links: [] });
    }
    if (!group.tasks.some((t) => t.id === task.id)) group.tasks.push(task);
    group.links.push(link);
  }
  const changes: PlanChange[] = [];
  for (const { project, tasks, links: projectLinks } of byProject.values()) {
    const [first] = projectLinks;
    // The worker knows the text it was briefed with; diff from that. A document's first revision diffs from the
    // editor's baseline instead, so formatting the editor normalised does not show as a change. That baseline is
    // only the briefed text when the tasks were linked to the revised document itself (`beforeOf`), not to an
    // earlier document in its lineage.
    const baseline = input.before != null && (input.beforeOf === undefined || first.sourceId === input.beforeOf);
    const before = first.version === 1 && baseline ? input.before! : first.content ?? input.before ?? "";
    const title = input.title ?? (input.kind === "document" ? documentTitle(input.after) : first.sourceId);
    const revised = await reviseTaskSources(projectLinks, input.after, hash);
    const version = Math.max(...revised.map((r) => r.version), 2);
    const { openChief } = await import("@/lib/workers/service");
    const chief = await openChief(project.id);
    const items: PlanChangeItem[] = tasks.map((t) => ({ taskId: t.id, title: t.title, affected: false, summary: "", brief: null, criteria: null, previousBrief: t.body, previousCriteria: t.criteria ?? null, decision: "pending", delivery: null }));
    const change = await insertPlanChange({ projectId: project.id, kind: input.kind, sourceId: first.sourceId, sourceTitle: title, version, diff: sourceDiff(before, input.after), chiefSessionId: chief.id, items });
    pushUserMessage(chief, buildSourceRevisionPayload({
      changeId: change.id, kind: input.kind, sourceId: first.sourceId, title, version, before, after: input.after,
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, brief: t.body, criteria: t.criteria ?? null, working: Boolean(t.sessionId && getSession(t.sessionId) && ["starting", "running", "awaiting"].includes(getSession(t.sessionId)!.meta.status)) })),
    }));
    await appendWorkLog(project, `[you] revised ${sourceLabel(input.kind)} "${title}" (v${version}); asked the chief about ${plural(tasks.length, "open task")}`);
    changes.push(change);
  }
  return changes;
}

/** A plan document got a revision (POST /api/documents/[id]/revisions). */
export async function documentRevised(documentId: string, before: string, after: string) {
  return sourceRevised({ kind: "document", sourceIds: await documentLineage(documentId), before, beforeOf: documentId, after });
}

/** A linked note's current text, compared with what its tasks were last given. */
export async function noteChanged(noteId: string) {
  const [link] = await tasksForSources("note", [noteId]);
  if (!link) return [];
  const task = await getTask(link.taskId);
  const project = task && await getProject(task.projectId);
  const note = project ? await noteBrief(project, noteId).catch(() => null) : null;
  if (!note) return [];
  return sourceRevised({ kind: "note", sourceIds: [noteId], after: note.note.markdown, title: note.note.title });
}

const g = globalThis as typeof globalThis & { __thunkNoteRevisionTimers?: Map<string, ReturnType<typeof setTimeout>> };
const timers = g.__thunkNoteRevisionTimers ??= new Map();
/** The person saved a note. If tasks came from it, ask the chief once the edits settle. */
export function noteSaved(noteId: string, delayMs = NOTE_QUIET_MS) {
  clearTimeout(timers.get(noteId));
  const timer = setTimeout(() => {
    timers.delete(noteId);
    void noteChanged(noteId).catch((err) => console.error("[thunk] note revision failed", err));
  }, delayMs);
  timer.unref?.();
  timers.set(noteId, timer);
}

export type ReviseInput = { revisionId: string; tasks: { taskId: string; affected: boolean; summary?: string; brief?: string; criteria?: { id?: string; text: string; kind?: Criterion["kind"] }[] }[] };

/**
 * The chief's answer to a `<source_revision>` (tasks_revise): per task, unaffected, or a summary with the new brief and
 * criteria. Affected tasks become a plan_changed card; nothing changes until the person approves it. Unaffected tasks
 * already implement the new version, so their delivered version moves up now.
 */
export async function proposeTaskChanges(projectId: string, chiefSessionId: string, input: ReviseInput) {
  const change = await getPlanChange(input.revisionId);
  if (!change || change.projectId !== projectId) throw new Error("Revision not found in this project");
  if (change.status !== "waiting") throw new Error(`This revision was already ${change.status === "open" ? "proposed; it is waiting for the person" : change.status}`);
  const known = new Set(change.items.map((i) => i.taskId));
  const unknown = input.tasks.filter((t) => !known.has(t.taskId)).map((t) => t.taskId);
  if (unknown.length) throw new Error(`Not a task in this revision: ${unknown.join(", ")}. Its tasks are ${[...known].join(", ")}`);
  const missing = input.tasks.filter((t) => t.affected && (!t.summary?.trim() || !t.brief?.trim())).map((t) => t.taskId);
  if (missing.length) throw new Error(`Affected tasks need a one-line summary and the complete new brief: ${missing.join(", ")}`);
  const proposed = new Map(input.tasks.map((t) => [t.taskId, t]));
  const items: PlanChangeItem[] = change.items.map((item) => {
    const p = proposed.get(item.taskId);
    if (!p?.affected) return { ...item, affected: false, summary: p?.summary?.trim() || "Not affected" };
    return { ...item, affected: true, summary: p.summary!.trim().split("\n")[0].slice(0, 300), brief: p.brief!.trim(), criteria: p.criteria ? normalizeCriteria(p.criteria) : null };
  });
  const affected = items.filter((i) => i.affected);
  const unaffected = items.filter((i) => !i.affected);
  for (const item of unaffected) for (const link of (await listTaskSources(item.taskId)).filter((l) => l.kind === change.kind)) await setDeliveredVersion(link, change.version);
  const project = await getProject(projectId);
  const label = sourceLabel(change.kind);
  if (!affected.length) {
    await updatePlanChange(change.id, ["waiting"], { status: "dismissed", items });
    if (project) await appendWorkLog(project, `[chief] ${label} v${change.version}: no task needs to change`);
    return { revisionId: change.id, status: "dismissed" as const, message: "No task needs changing, so nothing goes to the person. The unaffected tasks now count as implementing this version." };
  }
  const updated = await updatePlanChange(change.id, ["waiting"], { status: "open", items });
  if (!updated) throw new Error("This revision was already answered");
  const chief = getSession(chiefSessionId);
  await notify({
    kind: "plan_changed", urgency: "action", projectId, workspaceId: chief?.meta.workspaceId ?? null, subjectKey: changeSubject(change.id),
    title: `${label === "plan" ? "Plan" : "Note"} changed · ${plural(affected.length, "task")} to update`,
    detail: [
      `“${change.sourceTitle}” is now v${change.version}.`,
      ...affected.map((i) => `- ${i.title}: ${i.summary}`),
      unaffected.length ? `Unaffected: ${unaffected.map((i) => i.title).join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    href: planChangePath(change.id),
  });
  if (project) await appendWorkLog(project, `[chief] proposed changes for ${label} v${change.version}: ${affected.map((i) => i.title).join(" · ")}`);
  return { revisionId: change.id, status: "open" as const, message: "Waiting for the person to approve in the Inbox. You get a <plan_change> message with the outcome; do not message the workers about it meanwhile." };
}

/** What the review screen shows: the change, and each task as it is now. */
export async function reviewPlanChange(id: string) {
  const change = await getPlanChange(id);
  if (!change || change.status === "waiting") throw new HttpError(404, "Plan change not found");
  const project = await getProject(change.projectId);
  if (!project) throw new HttpError(404, "Project not found");
  const tasks = await Promise.all(change.items.map(async (i) => {
    const task = await getTask(i.taskId);
    return { id: i.taskId, title: task?.title ?? i.title, status: task?.status ?? null, body: task?.body ?? null, criteria: task?.criteria ?? null, criteriaVersion: task?.criteriaVersion ?? 0, workspaceId: task?.workspaceId ?? null, sessionId: task?.sessionId ?? null };
  }));
  return { change, project: { id: project.id, name: project.name, slug: project.slug }, tasks };
}
export type PlanChangeReview = Awaited<ReturnType<typeof reviewPlanChange>>;

async function tellChief(change: PlanChange, body: string, status: string) {
  if (!change.chiefSessionId) return;
  const { currentChiefId } = await import("@/lib/workers/report-up");
  const { resumeSession } = await import("@/lib/agent");
  const chiefId = await currentChiefId(change.chiefSessionId);
  const chief = chiefId ? await resumeSession(chiefId).catch(() => null) : null;
  if (chief) pushUserMessage(chief, `<plan_change id="${change.id}" status="${status}">\n${body}\n</plan_change>`);
}

/** Send an approved change to the task's work: the running worker, the queued delegation, or just the task. */
async function deliver(change: PlanChange, task: Task, item: PlanChangeItem, brief: string, criteria: Criterion[] | null): Promise<PlanChangeItem["delivery"]> {
  if (await isQueued(task.id) && await updateQueuedInput(task.id, { brief })) return "queued";
  if (!task.sessionId) return "saved";
  const { criteriaBrief, messageWorker } = await import("@/lib/workers/service");
  const content = buildTaskUpdatePayload({ taskId: task.id, kind: change.kind, version: change.version, summary: item.summary, brief, criteria, criteriaBrief: criteriaBrief({ criteria }) });
  return messageWorker(task.projectId, task.id, content).then(() => "sent" as const, () => "saved" as const);
}

/**
 * Apply the person's decision on each affected task. Approved: the task's body and criteria update (criteria_version
 * goes up when they change), a running worker gets a `<task_update>`, a queued task starts with the new brief, and the
 * delivered version is recorded. Rejected tasks keep their brief. The chief hears the outcome.
 */
export async function decidePlanChange(id: string, choices: PlanChangeChoice[]) {
  return withFileLock(`plan-change:${id}`, async () => {
    const change = await getPlanChange(id);
    if (!change || change.status === "waiting") throw new HttpError(404, "Plan change not found");
    if (change.status !== "open") throw new HttpError(409, `This change was already ${change.status}`);
    const byTask = new Map(choices.map((c) => [c.taskId, c]));
    const undecided = change.items.filter((i) => i.affected && !byTask.has(i.taskId));
    if (undecided.length) throw new HttpError(400, `Approve or reject every task: ${undecided.map((i) => i.title).join(", ")}`);
    const items: PlanChangeItem[] = [];
    const lines: string[] = [];
    const deliveredLine = (item: PlanChangeItem) => `- ${item.title} (${item.taskId}): approved; ${item.delivery === "sent" ? "sent to its worker as a <task_update>" : item.delivery === "queued" ? "the queued task starts with the new brief" : "saved on the task"}`;
    for (const [index, item] of change.items.entries()) {
      const choice = byTask.get(item.taskId);
      if (!item.affected || !choice) { items.push(item); continue; }
      // Applied by an earlier attempt that failed on a later task: its worker already has this update.
      if (item.decision === "approved") { items.push(item); lines.push(deliveredLine(item)); continue; }
      if (choice.decision === "rejected") {
        items.push({ ...item, decision: "rejected" });
        lines.push(`- ${item.title} (${item.taskId}): rejected; it keeps its current brief`);
        continue;
      }
      const brief = choice.brief?.trim() || item.brief || "";
      const criteria = choice.criteria !== undefined ? (choice.criteria?.length ? normalizeCriteria(choice.criteria) : null) : item.criteria;
      const task = await getTask(item.taskId);
      if (!task || !isOpen(task)) {
        items.push({ ...item, decision: "rejected" });
        lines.push(`- ${item.title} (${item.taskId}): not changed; the task is ${task?.status ?? "gone"}`);
        continue;
      }
      const links = (await listTaskSources(task.id)).filter((l) => l.kind === change.kind);
      // A newer revision already reached this task; applying this older one would roll its brief back.
      const newer = Math.max(0, ...links.map((l) => l.deliveredVersion));
      if (newer > change.version) {
        items.push({ ...item, decision: "rejected" });
        lines.push(`- ${item.title} (${item.taskId}): not changed; it already has v${newer}`);
        continue;
      }
      // Null criteria in the proposal keeps the task's own; an edit to an empty list clears them.
      const keep = choice.criteria === undefined && item.criteria === null;
      const updated = await patchTask(task.id, { body: brief, ...(keep ? {} : { criteria }) });
      const delivery = await deliver(change, updated, item, brief, keep ? updated.criteria ?? null : criteria);
      for (const link of links) await setDeliveredVersion(link, change.version);
      const applied: PlanChangeItem = { ...item, decision: "approved", brief, criteria: keep ? null : criteria, delivery };
      items.push(applied);
      lines.push(deliveredLine(applied));
      // Save progress so a failure on a later task doesn't send this one its update again on retry.
      await updatePlanChange(id, ["open"], { items: [...items, ...change.items.slice(index + 1)] });
    }
    const updated = await updatePlanChange(id, ["open"], { status: "applied", items });
    if (!updated) throw new HttpError(409, "This change was already decided");
    await resolveBySubject(changeSubject(id));
    const project = await getProject(change.projectId);
    if (project) await appendWorkLog(project, `[you] decision: ${sourceLabel(change.kind)} v${change.version} changes · ${items.filter((i) => i.decision === "approved").length} approved, ${items.filter((i) => i.decision === "rejected").length} rejected`);
    await tellChief(change, lines.join("\n") || "Nothing changed.", "applied");
    return updated;
  });
}

/** Set a change aside: no task changes, and the chief hears so. */
export async function dismissPlanChange(id: string) {
  return withFileLock(`plan-change:${id}`, async () => {
    const change = await getPlanChange(id);
    if (!change) throw new HttpError(404, "Plan change not found");
    const updated = await updatePlanChange(id, ["waiting", "open"], { status: "dismissed", items: change.items.map((i) => i.affected && i.decision !== "approved" ? { ...i, decision: "rejected" } : i) });
    if (!updated) throw new HttpError(409, `This change was already ${change.status}`);
    await resolveBySubject(changeSubject(id));
    await tellChief(change, "The person set these changes aside. Every task keeps its current brief.", "dismissed");
    return updated;
  });
}
