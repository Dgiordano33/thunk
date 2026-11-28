import { z } from "zod";
import { CRITERION_KINDS, TASK_STATUSES } from "./types";

export const CriterionSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_-]{1,20}$/i).optional().describe("Short stable id such as c1; assigned when omitted."),
  text: z.string().trim().min(1).max(500),
  kind: z.enum(CRITERION_KINDS).optional().describe("How it would be shown: test, interaction, visual, source or other."),
}).strict();
export const CriteriaSchema = z.array(CriterionSchema).max(12);

export const TaskInputSchema = z.object({
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  workspaceId: z.uuid().nullable().optional(),
  sessionId: z.uuid().nullable().optional(),
  noteId: z.string().regex(/^(?:r:[0-9a-f-]{36}:)?[a-z0-9][a-z0-9_-]{0,63}$/i).nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict();
export const TaskPatchSchema = TaskInputSchema.omit({ projectId: true }).partial().extend({
  position: z.number().finite().optional(),
  after: z.uuid().optional(),
  /** Replaces the criteria (an empty list clears them) and bumps criteriaVersion. */
  criteria: CriteriaSchema.nullable().optional(),
}).strict().refine((p) => p.position === undefined || p.after === undefined, "Use position or after, not both");
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type TaskPatch = z.infer<typeof TaskPatchSchema>;
