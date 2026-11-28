import "server-only";
import { HttpError } from "@/lib/api/errors";
import { dirsForScope, projectNoteDirs } from "@/lib/notes/resolve";
import { readNote } from "@/lib/notes/store";
import type { Note } from "@/lib/notes/types";
import type { Project } from "@/lib/projects/types";
import { getTask } from "@/lib/db/repo/tasks";
import { getWorkspace } from "@/lib/db/repo/workspaces";
import { TASK_STATUS_LABELS, type Task } from "@/lib/tasks/types";
import { taskSource } from "@/lib/tasks/prompt";
import { REASONS, type ContextItemDraft, type PromptPart } from "@/lib/context/types";
import { getContextSet } from "@/lib/db/repo/context-sets";
import { vaultDirOf } from "@/lib/vault/dir";
import { readItem } from "@/lib/vault/store";
import { readText } from "@/lib/vault/tools";
import type { ContextSelection, ContextSet } from "@/lib/context/types";
import type { RoutineContext, RoutineNoteRef, RunTrigger } from "./types";

/** Per-item and total caps keep a routine with large notes from filling the brief. */
const NOTE_CHARS = 20_000;
const TOTAL_CHARS = 80_000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}\n\n…(cut at ${max.toLocaleString("en-US")} characters; read the file for the rest)` : text);

/** Whether a note scope belongs to the project. Workspace scopes must be one of its workspaces. */
async function scopeInProject(project: Project, ref: RoutineNoteRef) {
  if (ref.scope.kind === "projects") return ref.scope.id === project.id;
  if (ref.scope.kind === "repos") return project.repoFolders.some((f) => f.id === ref.scope.id);
  return (await getWorkspace(ref.scope.id))?.projectId === project.id;
}

export async function loadNote(project: Project, ref: RoutineNoteRef): Promise<Note | null> {
  if (!(await scopeInProject(project, ref))) return null;
  const dirs = await dirsForScope(ref.scope).catch(() => null);
  return dirs ? readNote(dirs, ref.id) : null;
}

/** The lists a routine reads: its saved set's when it points at one (empty when that set is gone), else its own. */
export async function resolveSelection(project: Project, context: RoutineContext): Promise<{ selection: ContextSelection; set: ContextSet | null; missingSet: boolean }> {
  if (!context.setId) return { selection: context, set: null, missingSet: false };
  const set = await getContextSet(context.setId).catch(() => null);
  if (!set || set.projectId !== project.id) return { selection: { notes: [], taskIds: [] }, set: null, missingSet: true };
  return { selection: set, set, missingSet: false };
}

/** Reject attachments from another project, or ones that don't exist, when a routine or context set is saved. */
export async function validateRoutineContext(project: Project, context: RoutineContext) {
  if (context.setId) {
    const set = await getContextSet(context.setId);
    if (!set || set.projectId !== project.id) throw new HttpError(400, "That context set isn't in this project");
  }
  for (const ref of context.notes) {
    if (!(await scopeInProject(project, ref))) throw new HttpError(400, "An attached note belongs to another project");
    if (!(await loadNote(project, ref))) throw new HttpError(400, `Attached note ${ref.id} no longer exists`);
  }
  for (const id of context.taskIds) {
    const task = await getTask(id);
    if (!task || task.projectId !== project.id) throw new HttpError(400, "An attached task isn't in this project");
  }
  for (const id of context.vaultIds ?? []) {
    if (!(await readItem(vaultDirOf(project), id).catch(() => null))) throw new HttpError(400, `Vault item ${id} isn't in this project`);
  }
}

export function renderTask(task: Task, heading: string, linked: Note | null) {
  const meta = [
    `- **ID:** \`${task.id}\``,
    `- **Status:** ${TASK_STATUS_LABELS[task.status]} · **Priority:** ${task.priority}`,
    `- **Scope:** ${task.workspaceId ? `workspace \`${task.workspaceId}\`` : "project"}`,
    ...(linked ? [`- **Linked note:** ${linked.title} (\`${linked.path}\`)`] : []),
  ];
  return [`## ${heading}: ${task.title}`, "", ...meta, "", task.body?.trim() || "_No description._"].join("\n");
}

/** Tasks reference project-owned notes independently of workspace links. */
export async function linkedNote(project: Project, task: Task) {
  if (!task.noteId) return null;
  return readNote(projectNoteDirs(project), task.noteId).catch(() => null);
}

/**
 * The attached notes and tasks, read now so every run sees their current content, plus the task that
 * fired a task event. Returns "" when there is nothing to add.
 */
export async function renderRoutineContext(opts: {
  project: Project;
  context: RoutineContext;
  trigger: RunTrigger;
  payload?: Record<string, unknown> | null;
  /** Who the context was attached to, for the heading; a routine by default. */
  subject?: string;
}): Promise<PromptPart> {
  const { project, trigger, payload } = opts;
  const { selection: context, set, missingSet } = await resolveSelection(project, opts.context);
  const sections: string[] = [];
  const missing: string[] = [];
  const items: ContextItemDraft[] = [];
  let budget = TOTAL_CHARS;
  /** Adds a section and records how much of it fit; false once the budget is spent. */
  const push = (text: string, draft: Omit<ContextItemDraft, "mode" | "chars">, cutAt?: number) => {
    if (budget <= 0) {
      items.push({ ...draft, mode: "omitted", chars: 0, reason: REASONS.overLimit(TOTAL_CHARS) });
      return false;
    }
    const clipped = clip(text, budget);
    budget -= clipped.length;
    sections.push(clipped);
    const cut = clipped.length < text.length ? TOTAL_CHARS : cutAt;
    items.push({ ...draft, mode: cut ? "truncated" : "full", chars: clipped.length, reason: cut ? REASONS.overLimit(cut) : null });
    return true;
  };
  const taskDraft = (task: Task) => ({ kind: "task" as const, refId: task.id, title: task.title, source: taskSource(task) });

  const eventTaskId = (trigger === "task_created" || trigger === "task_completed")
    ? ((payload?.task as { id?: unknown } | undefined)?.id as string | undefined)
    : undefined;
  if (eventTaskId) {
    const task = await getTask(eventTaskId);
    if (task && task.projectId === project.id) push(renderTask(task, trigger === "task_created" ? "Task that was just created" : "Task that was just completed", await linkedNote(project, task)), taskDraft(task));
  }

  const refs = context.notes;
  for (const [i, ref] of refs.entries()) {
    const note = await loadNote(project, ref).catch(() => null);
    if (!note) {
      missing.push(`note \`${ref.id}\``);
      items.push({ kind: "note", refId: ref.id, title: ref.id, mode: "omitted", chars: 0, reason: REASONS.missing });
      continue;
    }
    const where = ref.scope.kind === "projects" ? "project notebook" : ref.scope.kind === "repos" ? "repo notebook" : "workspace notebook";
    const body = note.markdown.trim() || "_Empty note._";
    const draft = { kind: "note" as const, refId: note.id, title: note.title, path: note.path, source: note.markdown, keepContent: true };
    if (!push([`## Note: ${note.title}`, "", `- **Where:** ${where}, \`${note.path}\``, `- **Updated:** ${note.updatedAt}`, "", clip(body, NOTE_CHARS)].join("\n"), draft, body.length > NOTE_CHARS ? NOTE_CHARS : undefined)) {
      for (const rest of refs.slice(i + 1)) items.push({ kind: "note", refId: rest.id, title: rest.id, mode: "omitted", chars: 0, reason: REASONS.overLimit(TOTAL_CHARS) });
      break;
    }
  }

  for (const [i, id] of context.taskIds.entries()) {
    if (id === eventTaskId) continue;
    const task = await getTask(id);
    if (!task || task.projectId !== project.id) {
      missing.push(`task \`${id}\``);
      items.push({ kind: "task", refId: id, title: id.slice(0, 8), mode: "omitted", chars: 0, reason: REASONS.missing });
      continue;
    }
    if (!push(renderTask(task, "Task", await linkedNote(project, task)), taskDraft(task))) {
      for (const rest of context.taskIds.slice(i + 1)) items.push({ kind: "task", refId: rest, title: rest.slice(0, 8), mode: "omitted", chars: 0, reason: REASONS.overLimit(TOTAL_CHARS) });
      break;
    }
  }

  for (const id of context.vaultIds ?? []) {
    const item = await readItem(vaultDirOf(project), id).catch(() => null);
    if (!item) {
      missing.push(`Vault item \`${id}\``);
      items.push({ kind: "vault", refId: id, title: id, mode: "omitted", chars: 0, reason: REASONS.missing });
      continue;
    }
    if (!push(readText(item).replace(/^# /, "## Vault: "), { kind: "vault", refId: item.id, title: item.title, path: item.path ?? null, source: item.summary ?? "" })) break;
  }
  if (missingSet) missing.push("the routine's context set");

  if (!sections.length && !missing.length) return { text: "", items };
  return { items, text: [
    opts.subject ? "# Context for this session" : "# Context for this run",
    `These notes and tasks were attached to ${opts.subject ?? "the routine"}${set ? ` (context set “${set.name}”)` : ""} and read at the start of this ${opts.subject ? "session" : "run"}, so they are current. Treat them as the source of truth for the work. Edit notes at the paths shown; update tasks by ID with the tasks tools.`,
    ...sections,
    ...(missing.length ? [`_No longer available: ${missing.join(", ")}. Mention this in your report._`] : []),
  ].join("\n\n") };
}
