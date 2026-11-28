import { handle, parseBody } from "@/lib/api/http";
import { LimitsPatch, readLimits, updateLimits } from "@/lib/setup/limits";

export const dynamic = "force-dynamic";

/** Server-wide limits: workers per project, routine runs at once, chief answer wait. Changes apply without a restart. */
export const GET = handle(async () => Response.json(readLimits()));

export const PUT = handle(async (req: Request) => {
  const patch = await parseBody(req, LimitsPatch);
  return Response.json(updateLimits(patch));
});
