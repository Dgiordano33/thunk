"use client";

import { Loader2Icon, SendIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { diffStat } from "@/lib/revisions/build-payload";
import { baselineOf, collectRevision } from "@/lib/revisions/collect";
import type { DocState } from "@/lib/store/session-store";
import { useSession } from "@/lib/store/session-store";
import { RevisionDialog } from "./revision-dialog";

export function useRevisionStat(doc: DocState) {
  const baseline = baselineOf(doc);
  return useMemo(() => {
    const d = diffStat(baseline, doc.currentMarkdown);
    const comments = doc.comments.filter((c) => c.status === "open" && c.body.trim()).length;
    return { ...d, comments, dirty: d.hunks > 0 || comments > 0 };
  }, [baseline, doc.currentMarkdown, doc.comments]);
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "N edits, M comments · Review diff · Send" footer for a draft response document. */
export function RevisionBar({ doc, onSend }: { doc: DocState; onSend: () => Promise<void> }) {
  const stat = useRevisionStat(doc);
  const live = useSession((s) => Boolean(s.meta?.live));
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!stat.dirty && !error) {
    return (
      <p className="text-muted-foreground px-1 text-xs">
        Edit the text or select a span to comment, then send your revisions back.
      </p>
    );
  }

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await onSend();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-muted/60 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        {plural(stat.hunks, "edit")}
        {stat.hunks > 0 && (
          <span className="ml-1 font-mono text-xs">
            <span className="text-emerald-600">+{stat.added}</span>{" "}
            <span className="text-red-600">-{stat.removed}</span>
          </span>
        )}
        {", "}
        {plural(stat.comments, "comment")}
      </span>
      {error && <span className="text-destructive truncate text-xs">{error}</span>}
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setReviewing(true)}>
          Review diff
        </Button>
        <Button size="sm" onClick={send} disabled={sending || !live || !stat.dirty}>
          {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          Send revisions
          <kbd className="text-primary-foreground/70 text-[11px]">⌘↵</kbd>
        </Button>
      </div>
      <RevisionDialog doc={doc} open={reviewing} onOpenChange={setReviewing} />
    </div>
  );
}

export async function sendResponseRevision(doc: DocState) {
  const sessionId = useSession.getState().sessionId!;
  const snapshot = collectRevision(doc);
  await api.sendRevision(doc.id, { sessionId, version: doc.version, ...snapshot });
}
