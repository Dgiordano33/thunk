import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { fileVersion, findRoot, readWorkspaceFile, writeWorkspaceFile } from "@/lib/projects/files";

export const dynamic = "force-dynamic";

async function target(req: Request, ctx: RouteContext<"/api/workspaces/[id]/files/content">) {
  const { id } = await ctx.params;
  const wctx = await getWorkspaceContext(id);
  if (!wctx) throw new HttpError(404, "Workspace not found");
  const params = new URL(req.url).searchParams;
  const file = params.get("path");
  if (!file) throw new HttpError(400, "path is required");
  return { root: findRoot(wctx, params.get("root")), file, params };
}

/** `?root=<id>&path=<file>`: the file's content and version. Add `&versionOnly=1` to poll for outside edits. */
export const GET = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/files/content">) => {
  const { root, file, params } = await target(req, ctx);
  if (params.get("versionOnly")) return Response.json({ version: await fileVersion(root, file) });
  return Response.json(await readWorkspaceFile(root, file));
});

const SaveSchema = z.object({ content: z.string(), baseVersion: z.string(), force: z.boolean().optional() });

/** Save the file. Responds 409 with the current content when it changed on disk since `baseVersion`. */
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/workspaces/[id]/files/content">) => {
  const { root, file } = await target(req, ctx);
  const body = await parseBody(req, SaveSchema);
  const result = await writeWorkspaceFile(root, file, body.content, body.baseVersion, body.force ?? false);
  return Response.json(result, { status: result.conflict ? 409 : 200 });
});
