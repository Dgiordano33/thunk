import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getProject } from "@/lib/db/repo/projects";
import { readReviewSettings, writeReviewSettings } from "@/lib/evidence/service";

export const dynamic = "force-dynamic";

async function project(ctx: RouteContext<"/api/projects/[id]/review-settings">) {
  const found = await getProject((await ctx.params).id);
  if (!found) throw new HttpError(404, "Project not found");
  return found;
}

/** Per-project review settings: whether Thunk runs scripts.test in a worker's workspace when it finishes. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/projects/[id]/review-settings">) =>
  Response.json({ settings: await readReviewSettings(await project(ctx)) }));

const Body = z.object({ testOnFinish: z.boolean() }).strict();
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/projects/[id]/review-settings">) => {
  const found = await project(ctx);
  return Response.json({ settings: await writeReviewSettings(found, await parseBody(req, Body)) });
});
