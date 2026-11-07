import { notFound, redirect } from "next/navigation";
import { SessionView } from "@/components/session/session-view";
import { liveMeta } from "@/lib/agent";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import type { PersistedDocument } from "@/lib/documents/types";
import { loadDocuments } from "@/lib/supabase/repo/documents";
import { loadEvents } from "@/lib/supabase/repo/messages";
import { getSessionRow } from "@/lib/supabase/repo/sessions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/w/[id]/s/[sid]">) {
  const { sid } = await params;
  const title = liveMeta(sid)?.title ?? (await getSessionRow(sid).catch(() => null))?.title;
  return { title: title ? `${title} · Thunk` : "Thunk" };
}

export default async function SessionPage({ params }: PageProps<"/w/[id]/s/[sid]">) {
  const { id, sid } = await params;

  let meta: SessionMeta | null = liveMeta(sid);
  if (!meta) {
    const row = await getSessionRow(sid).catch(() => null);
    if (row) meta = { ...row, live: false };
  }
  if (!meta) notFound();
  if (meta.workspaceId !== id) redirect(`/w/${meta.workspaceId}/s/${sid}`);

  // Persisted history first; the SSE stream replays anything newer by seq.
  const [events, documents] = await Promise.all([
    loadEvents(sid).catch((): HarnessEvent[] => []),
    loadDocuments(sid).catch((): PersistedDocument[] => []),
  ]);

  return <SessionView meta={meta} events={events} documents={documents} />;
}
