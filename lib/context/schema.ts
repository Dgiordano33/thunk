// Shared by the context set and routine forms and the API routes.
import { z } from "zod";

export const ContextNoteRefSchema = z.object({
  scope: z.object({ kind: z.enum(["projects", "workspaces", "repos"]), id: z.string().min(1).max(100) }).strict(),
  id: z.string().min(1).max(100),
}).strict();

const selection = {
  notes: z.array(ContextNoteRefSchema).max(20, "Pick at most 20 notes"),
  taskIds: z.array(z.uuid()).max(50, "Pick at most 50 tasks"),
  vaultIds: z.array(z.string().regex(/^[a-z0-9]{10}$/, "Invalid Vault id")).max(20, "Pick at most 20 Vault items").optional(),
};

export const ContextSelectionSchema = z.object(selection).strict();

export const ContextSetInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  ...selection,
  vaultIds: selection.vaultIds.default([]),
}).strict();

export const ContextSetPatchSchema = ContextSetInputSchema.partial().strict();

export type ContextSetInput = z.infer<typeof ContextSetInputSchema>;
export type ContextSetPatch = z.infer<typeof ContextSetPatchSchema>;
