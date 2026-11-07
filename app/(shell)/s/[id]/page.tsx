import { notFound, redirect } from "next/navigation";
import { liveMeta } from "@/lib/agent";
import { getSessionRow } from "@/lib/supabase/repo/sessions";

export const dynamic = "force-dynamic";

// Legacy session URL: sessions now live under their workspace.
export default async function SessionRedirect({ params }: PageProps<"/s/[id]">) {
  const { id } = await params;
  const workspaceId = liveMeta(id)?.workspaceId ?? (await getSessionRow(id).catch(() => null))?.workspaceId;
  if (!workspaceId) notFound();
  redirect(`/w/${workspaceId}/s/${id}`);
}
