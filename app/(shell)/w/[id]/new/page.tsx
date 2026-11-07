import { notFound } from "next/navigation";
import { workspaceLabel } from "@/components/session/labels";
import { NewChat } from "@/components/workspace/new-chat";
import { listSessions } from "@/lib/agent";
import { env } from "@/lib/env";
import { getWorkspaceContext } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/w/[id]/new">) {
  const { id } = await params;
  const ctx = await getWorkspaceContext(id).catch(() => null);
  return { title: ctx ? `${workspaceLabel(ctx.workspace)} · ${ctx.project.name} · Thunk` : "Thunk" };
}

export default async function NewChatPage({ params, searchParams }: PageProps<"/w/[id]/new">) {
  const { id } = await params;
  // Set when switching providers from a running chat's model picker.
  const { model } = await searchParams;
  const ctx = await getWorkspaceContext(id);
  if (!ctx) notFound();
  // Carry over the model and mode from the workspace's latest session.
  const [latest] = await listSessions({ workspaceId: id, limit: 1 });

  return (
    <NewChat
      key={typeof model === "string" ? model : undefined}
      workspaceId={id}
      workspaceLabel={workspaceLabel(ctx.workspace)}
      defaultModel={(typeof model === "string" && model) || latest?.model || env.DEFAULT_MODEL}
      defaultMode={latest?.permissionMode ?? "default"}
      disabled={ctx.workspace.status === "archived"}
    />
  );
}
