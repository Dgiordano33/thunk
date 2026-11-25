import { notFound } from "next/navigation";
import { workspaceLabel } from "@/components/session/labels";
import { NewChat } from "@/components/workspace/new-chat";
import { listSessions } from "@/lib/agent";
import { env } from "@/lib/env";
import { getWorkspaceContextBySlugs } from "@/lib/projects";
import { cardPrompt } from "@/lib/board/card-prompt";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[project]/[workspace]/new">) {
  const { project, workspace } = await params;
  const ctx = await getWorkspaceContextBySlugs(project, workspace).catch(() => null);
  return { title: ctx ? `${workspaceLabel(ctx.workspace)} · ${ctx.project.name} · Thunk` : "Thunk" };
}

export default async function NewChatPage({ params, searchParams }: PageProps<"/[project]/[workspace]/new">) {
  const { project, workspace } = await params;
  // Set when switching providers from a running chat's model picker.
  const { model, canvas, card } = await searchParams;
  const ctx = await getWorkspaceContextBySlugs(project, workspace);
  if (!ctx) notFound();
  const id = ctx.workspace.id;
  // Carry over the model and mode from the workspace's latest session.
  const projectSessions = await listSessions({ projectId: ctx.project.id, limit: 1 });
  const workspaceSessions = await listSessions({ workspaceId: id, limit: 10_000, includeHidden: true });
  const [latest] = workspaceSessions;
  // A chat started from a canvas card, or in a canvas workspace, shares that workspace; other automatic efforts start a new one.
  const standalone = ctx.workspace.visibility === "project" && typeof canvas !== "string" && !workspaceSessions.some(s => s.origin?.kind === "board");
  const prompt = typeof canvas === "string" && typeof card === "string" ? await cardPrompt(ctx.project, canvas, card) : undefined;

  return (
    <NewChat
      key={`${typeof model === "string" ? model : ""}:${prompt ? card : ""}`}
      initialPrompt={prompt}
      firstSession={projectSessions.length === 0}
      workspaceId={standalone ? undefined : id}
      projectId={standalone ? ctx.project.id : undefined}
      workspaceLabel={standalone ? ctx.project.name : workspaceLabel(ctx.workspace)}
      defaultModel={(typeof model === "string" && model) || latest?.model || env.DEFAULT_MODEL}
      defaultMode={latest?.permissionMode ?? "default"}
      disabled={ctx.workspace.status === "archived"}
    />
  );
}
