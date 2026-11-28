import { handle, HttpError } from "@/lib/api/http";
import { reviewState, ReviewNotFound } from "@/lib/review/card";

export const dynamic = "force-dynamic";

/** The review card for a finished worker: its changes, latest trial merge and pull request. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/sessions/[id]/review">) => {
  const { id } = await ctx.params;
  try {
    return Response.json({ review: await reviewState(id) });
  } catch (err) {
    if (err instanceof ReviewNotFound) throw new HttpError(404, err.message);
    throw err;
  }
});
