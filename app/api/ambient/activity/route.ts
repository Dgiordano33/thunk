import { listLiveSessions } from "@/lib/agent";
import { noticeFor } from "@/lib/ambient/summary";
import type { ActivitySession } from "@/lib/ambient/types";
import { handle } from "@/lib/api/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const sessions: ActivitySession[] = listLiveSessions().map((live) => {
    const event = live.events.findLast((e) => noticeFor(e) !== null);
    return {
      ...live.meta,
      live: !live.driver.isClosed,
      projectName: live.ctx.project.name,
      workspaceName: live.ctx.workspace.name,
      pending: live.pending.size,
      notice: event ? { seq: event.seq, message: noticeFor(event)! } : null,
    };
  });
  return Response.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
});
