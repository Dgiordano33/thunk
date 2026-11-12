import { z } from "zod";
import { TaskInputSchema } from "@/lib/tasks/schema";
export const DelegateSchema = z.object({
  taskId: z.uuid().optional(), title: TaskInputSchema.shape.title.optional(),
  brief: z.string().max(20_000).optional(), noteId: TaskInputSchema.shape.noteId,
  workspaceId: z.uuid().optional().describe("Existing project workspace UUID to work in. Omit to create a fresh worktree. Cannot be combined with repoIds; never invent IDs."),
  repoIds: z.array(z.uuid()).min(1).optional().describe("Optional existing project repository UUIDs. Omit to use all Git repositories; never invent IDs."), model: z.string().min(1).max(200).optional(),
  // bypassPermissions stays a person's choice: delegate is auto-approved for the chief.
  permissionMode: z.enum(["default", "acceptEdits", "plan"]).optional(),
}).strict();
