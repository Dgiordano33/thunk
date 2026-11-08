import { handle, parseBody } from "@/lib/api/http";
import { RoutineInputSchema } from "@/lib/routines/schema";
import { ensureScheduler } from "@/lib/routines/scheduler";
import { createRoutine } from "@/lib/routines/service";
import { listRoutines } from "@/lib/supabase/repo/routines";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  ensureScheduler();
  const projectId = new URL(req.url).searchParams.get("projectId") ?? undefined;
  return Response.json({ routines: await listRoutines({ projectId }) }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = handle(async (req: Request) => {
  ensureScheduler();
  const routine = await createRoutine(await parseBody(req, RoutineInputSchema));
  return Response.json({ routine }, { status: 201 });
});
