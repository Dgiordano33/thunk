import { notFound, permanentRedirect } from "next/navigation";
import { queryString } from "@/lib/legacy-redirect";
import { projectPath } from "@/lib/routes";
import { getProject } from "@/lib/supabase/repo/projects";

export const dynamic = "force-dynamic";

// Legacy id URL: projects now live at /{project}.
export default async function LegacyProject({ params, searchParams }: PageProps<"/p/[id]">) {
  const project = await getProject((await params).id).catch(() => null);
  if (!project) notFound();
  permanentRedirect(projectPath(project) + queryString(await searchParams));
}
