import { notFound } from "next/navigation";
import { workspaceLabel } from "@/components/session/labels";
import { NewChat } from "@/components/workspace/new-chat";
import { listSessions } from "@/lib/agent";
import { env } from "@/lib/env";
import { getWorkspaceContextBySlugs } from "@/lib/projects";
import { boardFor } from "@/lib/board/service";
import { readCard } from "@/lib/board/store";
import { canvasPath } from "@/lib/routes";
import type { Project } from "@/lib/projects/types";

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
  const [latest] = await listSessions({ workspaceId: id, limit: 1 });
  const prompt = typeof canvas === "string" && typeof card === "string" ? await cardPrompt(ctx.project, canvas, card) : undefined;

  return (
    <NewChat
      key={`${typeof model === "string" ? model : ""}:${prompt ? card : ""}`}
      initialPrompt={prompt}
      firstSession={projectSessions.length === 0}
      workspaceId={id}
      workspaceLabel={workspaceLabel(ctx.workspace)}
      defaultModel={(typeof model === "string" && model) || latest?.model || env.DEFAULT_MODEL}
      defaultMode={latest?.permissionMode ?? "default"}
      disabled={ctx.workspace.status === "archived"}
    />
  );
}

/** "Start session from card" on a canvas: the card's text as the first prompt. Null when the card is gone. */
async function cardPrompt(project: Project, boardId: string, cardId: string) {
  try {
    const { dir } = await boardFor(project.id, boardId);
    const c = await readCard(dir, cardId);
    const text = c.kind === "doc" ? c.markdown.trim() : "";
    return `${text || c.title}\n\n(From a card on this project's canvas: ${canvasPath(project, boardId, c.id)})`;
  } catch {
    return undefined;
  }
}
