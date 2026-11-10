import { notFound, permanentRedirect } from "next/navigation";
import { queryString } from "@/lib/legacy-redirect";
import { getWorkspaceContext } from "@/lib/projects";
import { newChatPath } from "@/lib/routes";

export const dynamic = "force-dynamic";

// Legacy id URL: now /{project}/{workspace}/new.
export default async function LegacyNewChat({ params, searchParams }: PageProps<"/w/[id]/new">) {
  const ctx = await getWorkspaceContext((await params).id).catch(() => null);
  if (!ctx) notFound();
  permanentRedirect(newChatPath(ctx.project, ctx.workspace) + queryString(await searchParams));
}
