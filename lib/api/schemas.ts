import { z } from "zod";

export const RevisionCommentSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "resolved"]),
  kind: z.enum(["change", "question", "side_chat"]),
  quote: z.string(),
  context: z.string(),
  body: z.string(),
  replies: z.array(z.object({ body: z.string() })),
  detached: z.boolean().optional(),
});

export const RevisionBodySchema = z.object({
  sessionId: z.string(),
  version: z.number().int().min(1),
  baselineMarkdown: z.string(),
  editedMarkdown: z.string(),
  comments: z.array(RevisionCommentSchema),
});

export const DocCommentSchema = z.object({
  id: z.uuid(),
  documentId: z.string(),
  kind: z.enum(["change", "question", "side_chat"]),
  status: z.enum(["open", "resolved"]),
  body: z.string(),
  quote: z.string(),
  from: z.number().optional(),
  to: z.number().optional(),
  createdAt: z.string(),
  replies: z.array(z.object({ id: z.uuid(), body: z.string(), createdAt: z.string() })),
});
