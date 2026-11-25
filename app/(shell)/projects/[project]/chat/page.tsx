import { notFound } from "next/navigation";
import { getProjectBySlug } from "@/lib/db/repo/projects";
import { listSessions } from "@/lib/agent";
import { env } from "@/lib/env";
import { cardPrompt } from "@/lib/board/card-prompt";
import { NewChat } from "@/components/workspace/new-chat";
import { WorkspaceBaseProvider } from "@/components/workspace/route-context";

export const dynamic = "force-dynamic";

export default async function ProjectChat({ params, searchParams }: { params: Promise<{ project: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const project = await getProjectBySlug((await params).project);
  if (!project) notFound();
  const [latest] = await listSessions({ projectId: project.id, limit: 1 });
  const { canvas, card } = await searchParams;
  const prompt = typeof canvas === "string" && typeof card === "string" ? await cardPrompt(project, canvas, card) : undefined;
  return <WorkspaceBaseProvider value={`/${project.slug}`}><NewChat
    key={prompt ? String(card) : undefined} initialPrompt={prompt}
    projectId={project.id} workspaceLabel={project.name} firstSession={!latest}
    defaultModel={latest?.model ?? env.DEFAULT_MODEL} defaultMode={latest?.permissionMode ?? "default"}
  /></WorkspaceBaseProvider>;
}
