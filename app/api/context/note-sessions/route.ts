import path from "node:path";
import { handle, HttpError } from "@/lib/api/http";
import { noteHolders } from "@/lib/context/actions";

/** Running sessions that hold the note at `?path=`, each saying whether its copy is out of date. */
export const GET = handle(async (req: Request) => {
  const file = new URL(req.url).searchParams.get("path");
  if (!file || !path.isAbsolute(file) || !file.endsWith(".md")) throw new HttpError(400, "path must be a note's absolute path");
  return Response.json({ sessions: await noteHolders(path.resolve(file)) });
});
