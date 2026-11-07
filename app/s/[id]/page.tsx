import { notFound } from "next/navigation";
import { SessionView } from "@/components/session/session-view";
import { liveMeta, listSessions } from "@/lib/agent";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import type { PersistedDocument } from "@/lib/documents/types";
import { loadDocuments } from "@/lib/supabase/repo/documents";
import { loadEvents } from "@/lib/supabase/repo/messages";
import { getSessionRow } from "@/lib/supabase/repo/sessions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/s/[id]">) {
  const { id } = await params;
  const title = liveMeta(id)?.title ?? (await getSessionRow(id).catch(() => null))?.title;
  return { title: title ? `${title} · Thunk` : "Thunk" };
}

export default async function SessionPage({ params }: PageProps<"/s/[id]">) {
  const { id } = await params;

  let meta: SessionMeta | null = liveMeta(id);
  if (!meta) {
    const row = await getSessionRow(id).catch(() => null);
    if (row) meta = { ...row, live: false };
  }
  if (!meta) notFound();

  // Persisted history first; the SSE stream replays anything newer by seq.
  const [events, documents, sessions] = await Promise.all([
    loadEvents(id).catch((): HarnessEvent[] => []),
    loadDocuments(id).catch((): PersistedDocument[] => []),
    listSessions({ cwd: meta.cwd, limit: 40 }),
  ]);

  return <SessionView meta={meta} events={events} documents={documents} sessions={sessions} />;
}
