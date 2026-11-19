import { handle } from "@/lib/api/http";
import { listLiveSessions } from "@/lib/agent/session-registry";
import { runtimeActivity } from "@/lib/projects/runtime";
import { routinesState } from "@/lib/routines/state";
import { summarizeActivity } from "@/lib/server/activity";

export const dynamic = "force-dynamic";

/** Whether a restart would cut off work. `thunk autoupdate` waits for `busy: false` (docs/server.md). */
export const GET = handle(async () => {
  const { processes, locks } = runtimeActivity();
  return Response.json(summarizeActivity({
    sessions: listLiveSessions().map((live) => ({ status: live.meta.status })),
    routineRuns: routinesState.active.size,
    processes,
    workspaceLocks: locks,
  }));
});
