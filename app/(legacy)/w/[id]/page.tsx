import { notFound, permanentRedirect } from "next/navigation";
import { queryString } from "@/lib/legacy-redirect";
import { getWorkspaceContext } from "@/lib/projects";
import { workspacePath } from "@/lib/routes";

export const dynamic = "force-dynamic";

// Legacy id URL: workspaces now live at /{project}/{workspace}.
export default async function LegacyWorkspace({ params, searchParams }: PageProps<"/w/[id]">) {
  const ctx = await getWorkspaceContext((await params).id).catch(() => null);
  if (!ctx) notFound();
  permanentRedirect(workspacePath(ctx.project, ctx.workspace) + queryString(await searchParams));
}
