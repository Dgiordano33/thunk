import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { NoNativeDialog, pickFolder } from "@/lib/host/native";

export const dynamic = "force-dynamic";

const Body = z.object({ prompt: z.string().optional(), defaultPath: z.string().optional() });

/**
 * Open the host's native folder dialog (macOS, Windows, or zenity/kdialog on Linux) and return
 * the chosen absolute path, or `null` if the user cancelled. Only works because the API is
 * local-only (see proxy.ts). 501 means there is no dialog here; the UI browses in the page instead.
 */
export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, Body);
  try {
    return Response.json({ path: await pickFolder(body) });
  } catch (err) {
    if (err instanceof NoNativeDialog) throw new HttpError(501, err.message);
    throw err;
  }
});
