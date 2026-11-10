import { notFound, permanentRedirect } from "next/navigation";
import { liveMeta } from "@/lib/agent";
import { hrefForSession } from "@/lib/routes.server";
import { getSessionRow } from "@/lib/supabase/repo/sessions";

export const dynamic = "force-dynamic";

// Legacy session URL: sessions now live at /{project}/{workspace}/{session}.
export default async function LegacySessionById({ params }: PageProps<"/s/[id]">) {
  const { id } = await params;
  const workspaceId = liveMeta(id)?.workspaceId ?? (await getSessionRow(id).catch(() => null))?.workspaceId;
  if (!workspaceId) notFound();
  permanentRedirect(await hrefForSession(workspaceId, id));
}
