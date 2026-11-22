import "server-only";
import { getTask, insertTask, listExternalTasks, updateTask } from "@/lib/db/repo/tasks";
import { getProject } from "@/lib/db/repo/projects";
import { linearSettings } from "@/lib/integrations/config";
import { linearClient } from "./client";
import { syncLinearProject, type SyncResult } from "./sync";
import { createLinearWriteBack } from "./writeback";
import { subscribeTasks } from "@/lib/tasks/events";

export type LinearSyncStatus = { at: string; result: SyncResult | null; error: string | null };

type LinearState = { running: Promise<void> | null; status: Map<string, LinearSyncStatus>; unsubscribe?: () => void };
const g = globalThis as typeof globalThis & { __thunkLinear?: LinearState };
const state: LinearState = (g.__thunkLinear ??= { running: null, status: new Map() });

/** The last sync of each mapped project, for Settings → Integrations. */
export const linearSyncStatus = (projectId: string) => state.status.get(projectId) ?? null;

/** Sync every mapped project once. Called from the routines tick (~2 min) and by Sync now; overlapping calls share one run. */
export function pollLinear(): Promise<void> {
  state.running ??= (async () => {
    const settings = await linearSettings();
    if (!settings.apiKey) return;
    const client = linearClient(settings.apiKey);
    for (const [projectId, link] of Object.entries(settings.projects)) {
      if (!(await getProject(projectId).catch(() => null))) continue;
      try {
        const result = await syncLinearProject({
          client,
          listTasks: (id) => listExternalTasks(id, "linear"),
          insertTask,
          updateTask: (id, patch) => updateTask(id, patch),
        }, projectId, link.teamId);
        state.status.set(projectId, { at: new Date().toISOString(), result, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.status.set(projectId, { at: new Date().toISOString(), result: null, error: message });
        console.error(`[thunk] linear sync failed for project ${projectId}: ${message}`);
      }
    }
  })().finally(() => { state.running = null; });
  return state.running;
}

/**
 * Linear's hosted MCP server, for agents, when a key is saved. It accepts a personal API key as a bearer token.
 * A connector you named `linear` yourself wins.
 */
export async function linearConnector() {
  const { apiKey } = await linearSettings();
  return apiKey ? { linear: { type: "http" as const, url: "https://mcp.linear.app/mcp", headers: { Authorization: `Bearer ${apiKey}` } } } : {};
}

/** Move Linear issues when their tasks start or finish in Thunk. Once per server process. */
export function ensureLinearWriteBack() {
  if (state.unsubscribe) return;
  const writeBack = createLinearWriteBack({
    client: async () => {
      const s = await linearSettings();
      return s.apiKey && s.writeBack ? linearClient(s.apiKey) : null;
    },
  });
  state.unsubscribe = subscribeTasks((event) => {
    if (event.kind !== "changed") return;
    void getTask(event.taskId).then((task) => task?.external && writeBack.handle(task)).catch(() => {});
  });
}
