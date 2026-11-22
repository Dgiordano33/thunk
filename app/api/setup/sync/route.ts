import { handle, parseBody } from "@/lib/api/http";
import { finishSync, planSync, SyncInput, writeSyncFiles } from "@/lib/setup/sync";

export const dynamic = "force-dynamic";

/**
 * Receive a Mac's Claude Code and Codex setup in three steps (desktop/setup-sync.cjs sends them):
 * `plan` (which files differ), `files` (a batch of them, base64, under the proxy's body limit), `finish`.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, SyncInput);
  if (body.step === "plan") return Response.json(await planSync(body.manifest));
  if (body.step === "files") return Response.json(await writeSyncFiles(body.files));
  return Response.json(await finishSync(body));
});
