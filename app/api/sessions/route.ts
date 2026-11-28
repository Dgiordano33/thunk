import { ensureBoardWorkspace } from "@/lib/board/workspace";
import { ImagesSchema } from "@/lib/prompts/schema";
import { sessionConfigRoot } from "@/lib/projects/repos";
import { expandCommand } from "@/lib/prompts/context";
import { z } from "zod";
import { listSessions, pushUserMessage, startSession } from "@/lib/agent";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { checkSessionSet, sessionSetContext } from "@/lib/context/sets";

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
    projectId: z.string().min(1).optional(),
    boardId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    model: z.string().optional(),
    permissionMode: z.string().optional(),
    prompt: z.string().max(200_000).optional(),
    images: ImagesSchema,
    /** Adopt an existing Claude Code transcript (from the project's external sessions list). */
    resumeSdkSessionId: z.string().min(1).optional(),
    title: z.string().max(120).optional(),
    /** A saved context set whose notes, tasks and Vault items ride along with the first message. */
    contextSetId: z.uuid().optional(),
  })
  .refine((b) => b.projectId || b.workspaceId || b.cwd, { message: "projectId, workspaceId or cwd is required" })
  .refine((b) => !b.boardId || (b.projectId && !b.workspaceId && !b.cwd), { message: "A canvas requires projectId and no other destination" });

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateBody);
  if (body.contextSetId) await checkSessionSet(body.contextSetId, body.projectId);
  const target = body.boardId ? { ...body, workspaceId: (await ensureBoardWorkspace(body.projectId!, body.boardId)).id, origin: { kind: "board" as const, boardId: body.boardId } } : body;
  const live = await startSession(target).catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  const context = body.contextSetId ? await sessionSetContext(live, body.contextSetId) : "";
  if (body.prompt?.trim() || body.images.length) {
    const expanded = await expandCommand(body.prompt?.trim() ?? "", sessionConfigRoot(live.ctx));
    pushUserMessage(live, body.prompt?.trim() ?? "", { images: body.images, expandedContent: [expanded, context].filter(Boolean).join("\n\n---\n\n") });
  }
  return Response.json({ id: live.id, workspaceId: live.meta.workspaceId }, { status: 201 });
});
