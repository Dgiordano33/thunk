import "server-only";
import { randomBytes } from "node:crypto";
import { permissionModesFor, providerOf } from "@/lib/agent/types";
import { HttpError } from "@/lib/api/http";
import { gitRepos } from "@/lib/projects/repos";
import { getProject } from "@/lib/supabase/repo/projects";
import { getRoutine, insertRoutine, updateRoutine } from "@/lib/supabase/repo/routines";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";
import { validateRoutineContext } from "./context";
import type { z } from "zod";
import type { RoutineInputSchema, RoutinePatchSchema } from "./schema";
import { scheduleFields } from "./scheduler";
import type { Routine } from "./types";

export const mintWebhookToken = () => randomBytes(24).toString("base64url");

type Settings = Pick<Routine, "projectId" | "model" | "permissionMode" | "targetKind" | "targetWorkspaceId" | "context">;

/** Checks the schema can't do alone: the project, the target workspace, and the model's permission modes. */
async function validate(r: Settings) {
  const project = await getProject(r.projectId);
  if (!project) throw new HttpError(404, "Project not found");
  if (r.targetKind === "ephemeral" && !gitRepos(project).length)
    throw new HttpError(400, "Fresh worktrees need a git repository; pick a workspace instead");
  if (r.targetKind === "workspace") {
    const ws = r.targetWorkspaceId ? await getWorkspace(r.targetWorkspaceId) : null;
    if (!ws || ws.projectId !== project.id) throw new HttpError(400, "Pick a workspace in this project");
    if (ws.status === "archived") throw new HttpError(400, "That workspace is archived");
  }
  if (!permissionModesFor(providerOf(r.model)).includes(r.permissionMode as never))
    throw new HttpError(400, `${r.permissionMode} isn't available for ${r.model}`);
  await validateRoutineContext(project, r.context);
}

export async function createRoutine(input: z.output<typeof RoutineInputSchema>): Promise<Routine> {
  const { webhookEnabled, ...rest } = input;
  const fields = {
    ...rest,
    scheduleCron: rest.scheduleCron || null,
    scheduleTz: rest.scheduleCron ? rest.scheduleTz || null : null,
    targetWorkspaceId: rest.targetKind === "workspace" ? rest.targetWorkspaceId : null,
  };
  await validate(fields);
  return insertRoutine({ ...fields, webhookToken: webhookEnabled ? mintWebhookToken() : null, ...scheduleFields(fields) });
}

export async function patchRoutine(id: string, patch: z.output<typeof RoutinePatchSchema>): Promise<Routine> {
  const current = await getRoutine(id);
  if (!current) throw new HttpError(404, "Routine not found");
  const { webhookEnabled, rotateWebhookToken, ...rest } = patch;
  const next: Routine = { ...current, ...rest };
  if (rest.scheduleCron !== undefined) next.scheduleCron = rest.scheduleCron || null;
  if (!next.scheduleCron) next.scheduleTz = null;
  if (next.targetKind === "ephemeral") next.targetWorkspaceId = null;
  await validate(next);

  let webhookToken = current.webhookToken;
  if (webhookEnabled === false) webhookToken = null;
  else if (rotateWebhookToken || (webhookEnabled && !webhookToken)) webhookToken = mintWebhookToken();

  const rescheduled =
    next.scheduleCron !== current.scheduleCron || next.scheduleTz !== current.scheduleTz || next.enabled !== current.enabled;
  const updated = await updateRoutine(id, {
    ...rest,
    scheduleCron: next.scheduleCron,
    scheduleTz: next.scheduleTz,
    targetWorkspaceId: next.targetWorkspaceId,
    webhookToken,
    ...(next.enabled !== current.enabled ? { triggerState: { ...current.triggerState, delivery: null } } : {}),
    // A changed schedule starts its PR cursor over too, harmlessly: only the next poll records.
    ...(rescheduled ? scheduleFields(next) : {}),
  });
  if (!updated) throw new HttpError(404, "Routine not found");
  return updated;
}
