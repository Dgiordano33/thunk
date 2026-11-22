import { handle } from "@/lib/api/http";
import { pollLinear } from "@/lib/integrations/linear/service";

export const dynamic = "force-dynamic";

/** Sync now instead of waiting for the next ~2 minute poll. */
export const POST = handle(async () => {
  await pollLinear();
  return Response.json({ ok: true });
});
