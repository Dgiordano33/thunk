"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

type Holder = { sessionId: string; title: string; itemId: string; changed: boolean };

/** Running sessions that got an older version of this note: "Changed, not sent", with Send update. */
export function NoteSessions({ path, version }: { path: string; version: string }) {
  const [holders, setHolders] = useState<Holder[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.noteSessions(path).then((r) => live && setHolders(r.sessions)).catch(() => live && setHolders([]));
    return () => { live = false; };
  }, [path, version]);

  const stale = holders.filter((h) => h.changed);
  if (!stale.length) return null;

  const send = async (h: Holder) => {
    setBusy(h.sessionId);
    try {
      await api.contextItemAction(h.sessionId, h.itemId, "update");
      setHolders((all) => all.map((x) => (x.sessionId === h.sessionId ? { ...x, changed: false } : x)));
      toast.success(`Sent the new version to “${h.title}”`);
    } catch (err) {
      toast.error("Couldn't send the update", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul aria-label="Running sessions holding this note" className="flex flex-col border-b">
      {stale.map((h) => (
        <li key={h.sessionId} className="flex items-center gap-2 px-4 py-1.5 text-xs">
          <span className="shrink-0 rounded-[4px] bg-[var(--status-attention-soft)] px-1.5 font-mono text-[10px] leading-4 tracking-[0.06em] text-[var(--status-attention-ink)] uppercase">Changed, not sent</span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate" title={h.title}>{h.title} has an older version</span>
          <Button size="xs" variant="outline" disabled={busy === h.sessionId} onClick={() => void send(h)} aria-label={`Send update to ${h.title}`}>Send update</Button>
        </li>
      ))}
    </ul>
  );
}
