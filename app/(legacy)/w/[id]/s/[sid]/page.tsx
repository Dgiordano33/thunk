import { notFound, permanentRedirect } from "next/navigation";
import { queryString } from "@/lib/legacy-redirect";
import { liveMeta } from "@/lib/agent";
import { getWorkspaceContext } from "@/lib/projects";
import { sessionPath } from "@/lib/routes";
import { getSessionRow } from "@/lib/supabase/repo/sessions";

export const dynamic = "force-dynamic";

// Legacy id URL: sessions now live at /{project}/{workspace}/{session}. Follows the session if it moved workspace.
export default async function LegacySession({ params, searchParams }: PageProps<"/w/[id]/s/[sid]">) {
  const { id, sid } = await params;
  const workspaceId = liveMeta(sid)?.workspaceId ?? (await getSessionRow(sid).catch(() => null))?.workspaceId ?? id;
  const ctx = await getWorkspaceContext(workspaceId).catch(() => null);
  if (!ctx) notFound();
  permanentRedirect(sessionPath(ctx.project, ctx.workspace, sid) + queryString(await searchParams));
}
