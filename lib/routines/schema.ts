// Shared by the routine form and the API routes.
import { z } from "zod";
import { PERMISSION_MODES } from "@/lib/agent/types";
import { cronError, isValidTimezone } from "./cron";
import { ROUTINE_EVENTS } from "./types";

const noteRef = z.object({
  scope: z.object({ kind: z.enum(["projects", "workspaces", "repos"]), id: z.string().min(1).max(100) }).strict(),
  id: z.string().min(1).max(100),
}).strict();

export const RoutineContextSchema = z.object({
  notes: z.array(noteRef).max(20, "Attach at most 20 notes"),
  taskIds: z.array(z.uuid()).max(50, "Attach at most 50 tasks"),
}).strict();

const fields = {
  name: z.string().trim().min(1, "Name is required").max(80),
  prompt: z.string().trim().min(1, "Prompt is required").max(20_000),
  model: z.string().min(1).max(100),
  permissionMode: z.enum(PERMISSION_MODES),
  targetKind: z.enum(["workspace", "ephemeral"]),
  targetWorkspaceId: z.string().nullable(),
  scheduleCron: z.string().trim().max(120).nullable(),
  scheduleTz: z.string().max(80).nullable(),
  events: z.array(z.enum(ROUTINE_EVENTS)),
  context: RoutineContextSchema,
  webhookEnabled: z.boolean(),
  enabled: z.boolean(),
  catchUp: z.enum(["skip", "once"]),
  maxRunsPerDay: z.number().int().min(1).max(200),
  maxRunMinutes: z.number().int().min(5).max(480),
};

function refine(v: Partial<Record<keyof typeof fields, unknown>>, ctx: z.RefinementCtx) {
  const cron = typeof v.scheduleCron === "string" && v.scheduleCron ? v.scheduleCron : null;
  const tz = typeof v.scheduleTz === "string" && v.scheduleTz ? v.scheduleTz : null;
  if (tz && !isValidTimezone(tz)) ctx.addIssue({ code: "custom", path: ["scheduleTz"], message: `Unknown timezone ${tz}` });
  if (cron) {
    const err = cronError(cron, tz && isValidTimezone(tz) ? tz : null);
    if (err) ctx.addIssue({ code: "custom", path: ["scheduleCron"], message: `Schedule: ${err}` });
  }
  if (v.targetKind === "workspace" && v.targetWorkspaceId === null)
    ctx.addIssue({ code: "custom", path: ["targetWorkspaceId"], message: "Pick a workspace to run in" });
}

export const RoutineInputSchema = z
  .object({
    projectId: z.string().min(1),
    ...fields,
    permissionMode: fields.permissionMode.default("acceptEdits"),
    targetKind: fields.targetKind.default("ephemeral"),
    targetWorkspaceId: fields.targetWorkspaceId.default(null),
    scheduleCron: fields.scheduleCron.default(null),
    scheduleTz: fields.scheduleTz.default(null),
    events: fields.events.default([]),
    context: fields.context.default({ notes: [], taskIds: [] }),
    webhookEnabled: fields.webhookEnabled.default(false),
    enabled: fields.enabled.default(true),
    catchUp: fields.catchUp.default("skip"),
    maxRunsPerDay: fields.maxRunsPerDay.default(24),
    maxRunMinutes: fields.maxRunMinutes.default(60),
  })
  .superRefine(refine);

export const RoutinePatchSchema = z
  .object({ ...fields, rotateWebhookToken: z.boolean() })
  .partial()
  .superRefine(refine);

export type RoutineInput = z.input<typeof RoutineInputSchema>;
export type RoutinePatch = z.input<typeof RoutinePatchSchema>;
