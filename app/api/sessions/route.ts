import { z } from "zod";
import { listSessions, pushUserMessage, startSession } from "@/lib/agent";
import { handle, HttpError, parseBody } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const cwd = new URL(req.url).searchParams.get("cwd") ?? undefined;
  return Response.json({ sessions: await listSessions({ cwd }) });
});

const CreateBody = z.object({
  cwd: z.string().min(1, "cwd is required"),
  model: z.string().optional(),
  permissionMode: z.string().optional(),
  prompt: z.string().optional(),
});

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, CreateBody);
  const live = await startSession(body).catch((err: Error) => {
    throw new HttpError(400, err.message);
  });
  if (body.prompt?.trim()) pushUserMessage(live, body.prompt.trim());
  return Response.json({ id: live.id }, { status: 201 });
});
