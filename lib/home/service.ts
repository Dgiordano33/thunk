import "server-only";
import path from "node:path";
import { getSession, listSessions, pushUserMessage, resumeSession } from "@/lib/agent";
import { ensureMainWorkspace } from "@/lib/projects";
import { ensureMemory, readMemory } from "@/lib/projects/memory";
import { projectConfigDir, projectMemoryFile } from "@/lib/projects/paths";
import type { Project } from "@/lib/projects/types";
import { readOptional, replaceFile, withFileLock } from "@/lib/notes/file-write";
import { projectNoteDirs } from "@/lib/notes/resolve";
import { readNote, writeNote } from "@/lib/notes/store";
import { notify, resolveBySubject } from "@/lib/notifications/service";
import { sessionPath } from "@/lib/routes";
import { getProject, getProjectByKey, listProjects, upsertProjectByKey } from "@/lib/db/repo/projects";
import { listWorkspaces } from "@/lib/db/repo/workspaces";
import { listTasks } from "@/lib/db/repo/tasks";
import { startWorkerSession } from "@/lib/workers/start";
import { appendWorkLog } from "@/lib/workers/log";
import { HOME_DATA_KEY, HOME_NAME, HOME_SLUG } from "./constants";
import { markLine, newRouteRef, openItems, parseRoutingItems, updateMark, type RouteTarget } from "./routing";
import { RoutePlanSchema, type RoutePlanInput, type RouteStatus } from "./schema";

/** The internal Home project, created on first use. */
export async function ensureHomeProject(): Promise<Project> {
  return withFileLock("home-project", async () => {
    const home = await getProjectByKey(HOME_DATA_KEY) ?? await upsertProjectByKey({ name: HOME_NAME, dataKey: HOME_DATA_KEY, slug: HOME_SLUG });
    await ensureMemory(projectMemoryFile(home.dataKey), "# Top level — routing memory\n\n## Routing rules");
    await ensureMainWorkspace(home);
    return home;
  });
}

export async function openTopChief(fresh = false) {
  const home = await ensureHomeProject();
  return withFileLock("top-chief", async () => {
    const workspace = await ensureMainWorkspace(home);
    if (!fresh) {
      const current = (await listSessions({ workspaceId: workspace.id, limit: 10_000 })).find((s) => s.origin?.kind === "top_chief");
      if (current) {
        const live = await resumeSession(current.id);
        if (live) return live;
      }
    }
    return startWorkerSession({ workspaceId: workspace.id, title: "Top chief", permissionMode: "default", origin: { kind: "top_chief" } });
  });
}

/** The newest top chief, resumed; null if there has never been one. */
async function currentTopChief() {
  const home = await getProjectByKey(HOME_DATA_KEY);
  if (!home) return null;
  const workspace = await ensureMainWorkspace(home);
  const current = (await listSessions({ workspaceId: workspace.id, limit: 10_000 })).find((s) => s.origin?.kind === "top_chief");
  return current ? getSession(current.id) ?? await resumeSession(current.id).catch(() => null) : null;
}

// ---------- state: one locked file in the Home project ----------

export type Route = {
  ref: string; planId: string; projectId: string; projectName: string; workspaceId: string | null;
  title: string; brief: string; noteId: string | null; status: RouteStatus | "routed"; summary: string | null;
  createdAt: string; updatedAt: string;
};
export type RoutePlan = RoutePlanInput & { id: string; status: "pending" | "approved" | "rejected"; createdAt: string; decidedAt: string | null; note: string | null; refs: string[] };
type RoutingState = { plans: Record<string, RoutePlan>; routes: Record<string, Route> };
const empty = (): RoutingState => ({ plans: {}, routes: {} });
const stateFile = (home: Pick<Project, "dataKey">) => path.join(projectConfigDir(home.dataKey), "routing", "state.json");

export async function readRoutingState(home: Pick<Project, "dataKey">): Promise<RoutingState> {
  const text = await readOptional(stateFile(home));
  return text ? { ...empty(), ...JSON.parse(text) } : empty();
}
async function updateRoutingState<T>(home: Pick<Project, "dataKey">, mutate: (s: RoutingState) => T): Promise<T> {
  const file = stateFile(home);
  return withFileLock(file, async () => {
    const previous = await readOptional(file);
    const state: RoutingState = previous ? { ...empty(), ...JSON.parse(previous) } : empty();
    const result = mutate(state);
    const next = JSON.stringify(state);
    if (next !== previous) await replaceFile(file, next, previous);
    return result;
  });
}

// ---------- what the top chief can see ----------

export async function routeTargets(): Promise<RouteTarget[]> {
  return Promise.all((await listProjects()).map(async (p) => ({
    projectId: p.id, name: p.name, slug: p.slug,
    workspaces: (await listWorkspaces(p.id)).filter((w) => w.status === "active").map((w) => ({ id: w.id, slug: w.slug, name: w.name })),
  })));
}

/** Every project with enough to route by: repos, active workspaces, open task count and the start of its memory. */
export async function projectsOverview() {
  const projects = await listProjects();
  const home = await getProjectByKey(HOME_DATA_KEY);
  const routes = home ? Object.values((await readRoutingState(home)).routes) : [];
  return Promise.all(projects.map(async (p) => {
    const [workspaces, tasks, memory] = await Promise.all([listWorkspaces(p.id), listTasks({ projectId: p.id }), readMemory(projectMemoryFile(p.dataKey))]);
    return {
      projectId: p.id, name: p.name, tag: `#${p.slug}`,
      repos: p.repos.map((r) => `${r.name} (${r.kind}${r.remote ? `, ${r.remote}` : ""})`),
      workspaces: workspaces.filter((w) => w.status === "active").map((w) => ({ workspaceId: w.id, name: w.name, tag: `#${p.slug}/${w.slug}`, branch: w.branch })),
      openTasks: tasks.filter((t) => ["open", "in_progress", "blocked"].includes(t.status)).length,
      openRoutes: routes.filter((r) => r.projectId === p.id && r.status === "routed").length,
      memory: memory.trim().slice(0, 800),
    };
  }));
}

/** A top-level note's checklist items, with any project the note's tags or headings pin them to. */
export async function noteItems(noteId: string) {
  const home = await ensureHomeProject();
  const note = await readNote(projectNoteDirs(home), noteId);
  if (!note) throw new Error("Top-level note not found");
  const targets = await routeTargets();
  const names = new Map(targets.map((t) => [t.projectId, t.name]));
  const items = parseRoutingItems(note.markdown, targets);
  return {
    note: { id: note.id, title: note.title, path: note.path },
    items: items.map((i) => ({
      line: i.line, text: i.text, done: i.done, routed: i.routed,
      pinned: i.target ? { projectId: i.target.projectId, project: names.get(i.target.projectId), workspaceId: i.target.workspaceId, via: i.target.via } : null,
      unknownTag: i.unknownTag,
    })),
    open: openItems(items).length,
  };
}

/** The message that asks the top chief to route a note. */
export async function routeRequest(noteId: string, reason: string) {
  const { note, items } = await noteItems(noteId);
  const open = items.filter((i) => !i.done && !i.routed);
  const lines = open.map((i) => `- line ${i.line}: ${i.text}${i.pinned ? ` → pinned to ${i.pinned.project} (${i.pinned.projectId}${i.pinned.workspaceId ? `, workspace ${i.pinned.workspaceId}` : ""}) by ${i.pinned.via}` : i.unknownTag ? ` → unknown tag ${i.unknownTag}` : " → not pinned"}`);
  return { open: open.length, message: `<route_note id="${note.id}" reason="${reason}">\nNote: ${note.title}\nPath: ${note.path}\n\nOpen items:\n${lines.join("\n") || "(none)"}\n</route_note>` };
}

// ---------- plans, approval and dispatch ----------

const subject = (planId: string) => `top-chief:plan:${planId}`;

export async function proposeRoutePlan(topChiefId: string, input: RoutePlanInput) {
  const args = RoutePlanSchema.parse(input);
  const chief = getSession(topChiefId);
  if (chief?.meta.origin?.kind !== "top_chief") throw new Error("Only the top chief can propose a routing plan");
  const home = await ensureHomeProject();
  const targets = await routeTargets();
  const parsed = args.noteId ? (await noteItems(args.noteId)).items : [];
  for (const item of args.items) {
    const target = targets.find((t) => t.projectId === item.projectId);
    if (!target) throw new Error(`Unknown project ${item.projectId}; call projects_list`);
    if (item.workspaceId && !target.workspaces.some((w) => w.id === item.workspaceId)) throw new Error(`Workspace ${item.workspaceId} is not an active workspace of ${target.name}`);
    if (item.line === undefined) continue;
    if (!args.noteId) throw new Error("line needs noteId");
    const line = parsed.find((p) => p.line === item.line);
    if (!line) throw new Error(`Line ${item.line} is not a checklist item in the note`);
    if (line.routed) throw new Error(`Line ${item.line} was already routed (r:${line.routed})`);
    if (line.pinned && line.pinned.projectId !== item.projectId) throw new Error(`Line ${item.line} is pinned to ${line.pinned.project} by its ${line.pinned.via}; route it there or ask the person`);
  }
  const plan: RoutePlan = { ...args, id: crypto.randomUUID(), status: "pending", createdAt: new Date().toISOString(), decidedAt: null, note: null, refs: [] };
  await updateRoutingState(home, (s) => { s.plans[plan.id] = plan; });
  const names = new Map(targets.map((t) => [t.projectId, t.name]));
  const path = `/api/chief/routes/${plan.id}`;
  await notify({
    projectId: home.id, workspaceId: chief.meta.workspaceId, sessionId: topChiefId, kind: "delegation_plan", urgency: "action",
    subjectKey: subject(plan.id), title: `Routing plan · ${plan.items.length} item${plan.items.length === 1 ? "" : "s"} across ${new Set(plan.items.map((i) => i.projectId)).size} project${new Set(plan.items.map((i) => i.projectId)).size === 1 ? "" : "s"}`,
    detail: [plan.summary, "", ...plan.items.map((i, n) => `${n + 1}. ${names.get(i.projectId)}${i.workspaceId ? ` / ${targets.find((t) => t.projectId === i.projectId)?.workspaces.find((w) => w.id === i.workspaceId)?.name}` : ""}: ${i.title}\n   ${i.why}`)].join("\n"),
    href: sessionPath(chief.ctx.project, chief.ctx.workspace, topChiefId),
    actions: [
      { label: "Approve", method: "POST", path, body: { decision: "approve" } },
      { label: "Reject", method: "POST", path, body: { decision: "reject" } },
    ],
  });
  await appendWorkLog(home, `[top chief] proposed routing: ${plan.items.map((i) => `${i.title} → ${names.get(i.projectId)}`).join(" · ")}`);
  return { planId: plan.id, status: "pending" as const, message: "Waiting for the person to approve in the inbox. You will get a <route_plan> message with the decision; do not route these items meanwhile." };
}

async function markNote(home: Project, noteId: string | null, edit: (markdown: string) => string | null) {
  if (!noteId) return;
  const dirs = projectNoteDirs(home);
  await withFileLock(`${dirs.notesDir}/${noteId}.route`, async () => {
    const note = await readNote(dirs, noteId);
    const next = note && edit(note.markdown);
    if (note && next && next !== note.markdown) await writeNote(dirs, noteId, { markdown: next, expectedUpdatedAt: note.updatedAt });
  }).catch((err) => console.error("[thunk] route write-back failed", err));
}

/** Approve (hand each item to its project's chief and mark its note line) or reject. Deciding twice is refused. */
export async function decideRoutePlan(planId: string, decision: "approve" | "reject", note?: string | null) {
  const home = await ensureHomeProject();
  return withFileLock(`route-plan:${planId}`, async () => {
    const plan = (await readRoutingState(home)).plans[planId];
    if (!plan) throw new Error("Routing plan not found");
    if (plan.status !== "pending") throw new Error(`This plan was already ${plan.status}`);
    const results: { title: string; project: string; ref?: string; error?: string }[] = [];
    if (decision === "approve") {
      const { openChief } = await import("@/lib/workers/service");
      for (const item of plan.items) {
        const project = await getProject(item.projectId);
        if (!project) { results.push({ title: item.title, project: item.projectId, error: "Project no longer exists" }); continue; }
        try {
          const ref = newRouteRef();
          const now = new Date().toISOString();
          const route: Route = { ref, planId, projectId: project.id, projectName: project.name, workspaceId: item.workspaceId ?? null, title: item.title, brief: item.brief, noteId: plan.noteId ?? null, status: "routed", summary: null, createdAt: now, updatedAt: now };
          await updateRoutingState(home, (s) => { s.routes[ref] = route; });
          const chief = await openChief(project.id);
          pushUserMessage(chief, `<routed_request id="${ref}" from="top chief">\n${item.title}\n\n${item.brief}${item.workspaceId ? `\n\nContinue in the existing workspace ${item.workspaceId} (delegate with workspaceId).` : ""}\n</routed_request>\nDelegate this as you would any request. When it is settled (accepted, blocked or failed), call route_report once with routeId "${ref}".`);
          if (item.line !== undefined) await markNote(home, plan.noteId ?? null, (md) => markLine(md, item.line!, ref, `${project.name}: routed`));
          await appendWorkLog(project, `[top chief] routed: ${item.title} (r:${ref})`);
          plan.refs.push(ref);
          results.push({ title: item.title, project: project.name, ref });
        } catch (err) { results.push({ title: item.title, project: project.name, error: (err as Error).message }); }
      }
    }
    const decided: RoutePlan = { ...plan, status: decision === "approve" ? "approved" : "rejected", decidedAt: new Date().toISOString(), note: note?.trim() || null };
    await updateRoutingState(home, (s) => { s.plans[planId] = decided; });
    await resolveBySubject(subject(planId));
    await appendWorkLog(home, `[you] decision: routing plan ${decided.status}${decided.note ? ` · ${decided.note}` : ""}`);
    const top = await currentTopChief();
    if (top) {
      const body = decision === "approve"
        ? results.map((r) => `- ${r.title} → ${r.project}: ${r.error ?? `routed as r:${r.ref}`}`).join("\n")
        : `The person rejected this plan${decided.note ? `: ${decided.note}` : "."} Ask them how to route it, then save what you learn with routing_rule.`;
      pushUserMessage(top, `<route_plan id="${planId}" status="${decided.status}">\n${body}\n</route_plan>`);
    }
    return { planId, status: decided.status, results };
  });
}

/** A project chief settles a routed request: the note line and the top chief hear about it. */
export async function reportRoute(projectId: string, routeId: string, status: RouteStatus, summary: string) {
  const home = await ensureHomeProject();
  const route = await updateRoutingState(home, (s) => {
    const r = s.routes[routeId];
    if (!r || r.projectId !== projectId) return null;
    s.routes[routeId] = { ...r, status, summary, updatedAt: new Date().toISOString() };
    return s.routes[routeId];
  });
  if (!route) throw new Error("No request with that routeId was routed to this project");
  await markNote(home, route.noteId, (md) => updateMark(md, routeId, `${route.projectName}: ${status}`, status === "done" ? true : undefined));
  await appendWorkLog(home, `[${route.projectName}] ${status}: ${route.title} · ${summary.split("\n")[0].slice(0, 300)}`);
  const top = await currentTopChief();
  if (top) pushUserMessage(top, `<route_report id="${routeId}" project="${route.projectName}" status="${status}">\n${route.title}\n\n${summary}\n</route_report>`);
  return { reported: true };
}

export async function routesStatus() {
  const home = await ensureHomeProject();
  const state = await readRoutingState(home);
  const day = Date.now() - 7 * 86_400_000;
  return {
    open: Object.values(state.routes).filter((r) => r.status === "routed"),
    settledThisWeek: Object.values(state.routes).filter((r) => r.status !== "routed" && Date.parse(r.updatedAt) > day),
    pendingPlans: Object.values(state.plans).filter((p) => p.status === "pending").map((p) => ({ planId: p.id, summary: p.summary, items: p.items.length })),
  };
}

/** Learned routing rules live in the Home project's memory, which the top chief reads every session. */
export async function saveRoutingRule(rule: string) {
  const home = await ensureHomeProject();
  const file = projectMemoryFile(home.dataKey);
  return withFileLock(file, async () => {
    const raw = await readOptional(file);
    const current = raw ?? "";
    const line = `- ${rule.replace(/\s+/g, " ").trim()}`;
    if (current.split("\n").includes(line)) return { saved: false, reason: "Already saved" };
    const next = /^## Routing rules[ \t]*$/m.test(current) ? current.replace(/^## Routing rules[ \t]*$/m, (h) => `${h}\n${line}`) : `${current.trimEnd()}\n\n## Routing rules\n${line}\n`;
    await replaceFile(file, next, raw);
    return { saved: true };
  });
}
