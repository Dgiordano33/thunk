import { z } from "zod";
import { TASK_STATUSES } from "./types";

export const TaskInputSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  workspaceId: z.uuid().nullable().optional(),
  sessionId: z.uuid().nullable().optional(),
  noteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i).nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict();
export const TaskPatchSchema = TaskInputSchema.omit({ projectId: true }).partial().extend({
  position: z.number().finite().optional(),
  after: z.uuid().optional(),
}).strict().refine((p) => p.position === undefined || p.after === undefined, "Use position or after, not both");
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type TaskPatch = z.infer<typeof TaskPatchSchema>;
