import { ImagesSchema } from "@/lib/prompts/schema";
import { expandCommand } from "@/lib/prompts/context";
import { z } from "zod";
import { listSessions, pushUserMessage, startSession } from "@/lib/agent";
import { handle, HttpError, parseBody } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  return Response.json({
    sessions: await listSessions({
      workspaceId: params.get("workspaceId") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
    }),
  });
});

const CreateBody = z
  .object({
    workspaceId: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    model: z.string().optional(),
    permissionMode: z.string().optional(),
    prompt: z.string().max(200_000).optional(),
    images: ImagesSchema,
    /** Adopt an existing Claude Code transcript (from the project's external sessions list). */
    resumeSdkSessionId: z.string().min(1).optional(),
    title: z.string().max(120).optional(),
  })
  .refine((b) => b.workspaceId || b.cwd, { message: "workspaceId or cwd is required" });

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateBody);
  const live = await startSession(body).catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  if (body.prompt?.trim() || body.images.length) pushUserMessage(live, body.prompt?.trim() ?? "", { images: body.images, expandedContent: await expandCommand(body.prompt?.trim() ?? "", live.ctx.project.root) });
  return Response.json({ id: live.id, workspaceId: live.meta.workspaceId }, { status: 201 });
});
