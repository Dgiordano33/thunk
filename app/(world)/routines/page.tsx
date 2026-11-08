import { RoutinesOverview } from "@/components/routines/routines-overview";
import { workspaceLabel } from "@/components/session/labels";
import { listProjects } from "@/lib/supabase/repo/projects";
import { listRoutines } from "@/lib/supabase/repo/routines";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";

export const metadata = { title: "Routines · Thunk" };
export const dynamic = "force-dynamic";

export default async function RoutinesPage() {
  const [routines, projects] = await Promise.all([listRoutines().catch(() => []), listProjects().catch(() => [])]);
  const ids = [...new Set(routines.flatMap((r) => (r.targetWorkspaceId ? [r.targetWorkspaceId] : [])))];
  const labels = Object.fromEntries(
    (await Promise.all(ids.map((id) => getWorkspace(id).catch(() => null)))).flatMap((w) => (w ? [[w.id, workspaceLabel(w)]] : [])),
  );
  return <RoutinesOverview initial={routines} workspaceLabels={labels} firstProjectId={projects[0]?.id ?? null} />;
}
