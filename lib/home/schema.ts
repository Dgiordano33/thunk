import { z } from "zod";
import { TaskInputSchema } from "@/lib/tasks/schema";

export const ROUTE_STATUSES = ["done", "blocked", "failed"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const RouteItemObject = z.object({
  projectId: z.uuid().describe("From projects_list. Never invent IDs."),
  workspaceId: z.uuid().optional().describe("An active workspace of that project, when the work continues there."),
  title: TaskInputSchema.shape.title,
  brief: z.string().trim().min(1).max(20_000).describe("Self-contained: the project chief has no other context."),
  why: z.string().trim().min(1).max(500).describe("One line: the tag, heading, routing rule or reasoning behind this project."),
  line: z.number().int().min(0).optional().describe("The note's checklist line this item came from; Thunk marks it routed."),
}).strict();
export const RoutePlanObject = z.object({
  summary: z.string().trim().min(1).max(4000),
  noteId: TaskInputSchema.shape.noteId,
  items: z.array(RouteItemObject).min(1).max(20),
}).strict();
export const RoutePlanSchema = RoutePlanObject.superRefine((plan, ctx) => {
  const lines = plan.items.flatMap((i) => i.line === undefined ? [] : [i.line]);
  if (new Set(lines).size !== lines.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Each note line can be routed once" });
});
export type RoutePlanInput = z.infer<typeof RoutePlanObject>;
