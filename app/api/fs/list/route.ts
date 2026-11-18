import { handle } from "@/lib/api/http";
import { listDirs } from "@/lib/fs/list-dirs";

export const dynamic = "force-dynamic";

/** Subfolders of `?path=` (default `~`), for choosing a folder from a browser that isn't on this machine. */
export const GET = handle(async (req: Request) => {
  const path = new URL(req.url).searchParams.get("path") ?? "~";
  return Response.json(await listDirs(path));
});
