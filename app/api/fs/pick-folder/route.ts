import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";

export const dynamic = "force-dynamic";

const exec = promisify(execFile);

const Body = z.object({ prompt: z.string().optional(), defaultPath: z.string().optional() });

/**
 * Open the native macOS folder picker on this machine and return the chosen absolute path,
 * or `null` if the user cancelled. Only works because the API is local-only (see proxy.ts).
 */
export const POST = handle(async (req: Request) => {
  if (process.platform !== "darwin") throw new HttpError(501, "The folder picker is only available on macOS");
  const body = await parseBody(req, Body);
  const start = path.resolve((body.defaultPath ?? "~").trim().replace(/^~(?=$|\/)/, os.homedir()));
  const script = [
    "on run argv",
    "activate",
    "try",
    "set loc to POSIX file (item 2 of argv) as alias",
    "on error",
    "set loc to path to home folder",
    "end try",
    "return POSIX path of (choose folder with prompt (item 1 of argv) default location loc)",
    "end run",
  ];
  try {
    const { stdout } = await exec("osascript", [...script.flatMap((l) => ["-e", l]), body.prompt ?? "Choose a folder", start]);
    const picked = stdout.trim().replace(/\/+$/, "");
    return Response.json({ path: picked || "/" });
  } catch (err) {
    // -128 is AppleScript's "User canceled".
    if (String((err as { stderr?: string }).stderr).includes("-128")) return Response.json({ path: null });
    throw err;
  }
});
