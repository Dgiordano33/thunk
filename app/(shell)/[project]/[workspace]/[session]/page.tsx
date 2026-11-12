import { notFound, redirect } from "next/navigation";
import { SessionView } from "@/components/session/session-view";
import { liveMeta } from "@/lib/agent";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import type { PersistedDocument } from "@/lib/documents/types";
import { loadDocuments } from "@/lib/supabase/repo/documents";
import { loadEvents } from "@/lib/supabase/repo/messages";
import { getSessionRow } from "@/lib/supabase/repo/sessions";
import { getWorkspaceContextBySlugs } from "@/lib/projects";
import { hrefForSession } from "@/lib/routes.server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[project]/[workspace]/[session]">) {
  const { session: sid } = await params;
  const title = liveMeta(sid)?.title ?? (await getSessionRow(sid).catch(() => null))?.title;
  return { title: title ? `${title} · Thunk` : "Thunk" };
}

export default async function SessionPage({ params }: PageProps<"/[project]/[workspace]/[session]">) {
  const { project, workspace, session: sid } = await params;
  const [ctx, row, events, documents] = await Promise.all([
    getWorkspaceContextBySlugs(project, workspace),
    getSessionRow(sid).catch(() => null),
    loadEvents(sid).catch((): HarnessEvent[] => []),
    loadDocuments(sid).catch((): PersistedDocument[] => []),
  ]);
  if (!ctx) notFound();

  let meta: SessionMeta | null = liveMeta(sid);
  if (!meta) {
    if (row) meta = { ...row, live: false };
  }
  if (!meta) notFound();
  if (meta.workspaceId !== ctx.workspace.id) redirect(await hrefForSession(meta.workspaceId, sid));

  return <SessionView meta={meta} events={events} documents={documents} />;
}
