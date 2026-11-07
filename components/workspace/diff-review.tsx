"use client";

import { useEffect, useState } from "react";
import { Composer } from "@/components/comments/composer";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { buildReview, diffHunks, type DiffComment } from "@/lib/review/diff";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

export function useDiffComments(workspaceId: string) {
  const key = `thunk:diff-review:${workspaceId}`;
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [loaded, setLoaded] = useState("");
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (!Array.isArray(saved) || !saved.every((c) => c && [c.id, c.path, c.hunk, c.body].every((v) => typeof v === "string"))) throw new Error("Invalid saved review");
      setComments(saved);
      setStorageError(null);
    } catch { setComments([]); setStorageError("Could not load saved review comments."); }
    setLoaded(key);
  }, [key]);
  useEffect(() => {
    if (loaded !== key) return;
    try { localStorage.setItem(key, JSON.stringify(comments)); }
    catch { setStorageError("Comments could not be saved. Keep this tab open until you send the review."); }
  }, [key, loaded, comments]);
  return { comments, setComments, storageError };
}

export function SendReview({ workspaceId, comments, onSent }: { workspaceId: string; comments: DiffComment[]; onSent: (ids: string[]) => void }) {
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!comments.length) return null;
  return <div className="flex flex-col gap-2 border-y p-3 text-xs">
    <p>{comments.length} review comment{comments.length === 1 ? "" : "s"} · saved in this browser</p>
    <Button size="sm" disabled={busy || !meta?.live || meta.workspaceId !== workspaceId || status === "closed" || status === "error"} onClick={async () => {
      if (!meta) return;
      setBusy(true); setError(null);
      try { await api.send(meta.id, buildReview(comments)); onSent(comments.map((c) => c.id)); }
      catch (err) { setError((err as Error).message); }
      finally { setBusy(false); }
    }}>{busy ? "Sending…" : "Send review to active chat"}</Button>
    {!meta?.live && <p>Open a live chat in this workspace to send the review.</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {comments.map((c) => <div key={c.id} className="min-w-0 rounded border p-2">
      <p className="truncate font-medium">{c.path} · {c.hunk.split("\n")[0]}</p>
      <p className="whitespace-pre-wrap break-words">{c.body}</p>
      <button type="button" className="text-muted-foreground underline" onClick={() => onSent([c.id])}>Remove</button>
    </div>)}
  </div>;
}

export function ReviewDiff({ diff, path, comments, onAdd, onRemove }: { diff: string; path: string; comments: DiffComment[]; onAdd: (comment: DiffComment) => void; onRemove: (id: string) => void }) {
  const [composing, setComposing] = useState<string | null>(null);
  const hunks = diffHunks(diff);
  if (!hunks.length) return <p className="p-3 text-xs whitespace-pre-wrap">{diff || "No text changes (binary or mode only)."}</p>;
  return <div className="py-1">
    {hunks.map((hunk, i) => <div key={i}>
      <pre className="w-max min-w-full font-mono text-[11px] leading-[1.6]">{hunk.split("\n").map((line, j) => <div key={j} className={cn("px-3", line.startsWith("+") && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300", line.startsWith("-") && "bg-red-500/10 text-red-800 dark:text-red-300", line.startsWith("@@") && "bg-muted/60 text-muted-foreground")}>
        {j === 0 && <button type="button" aria-label={`Comment on ${path} ${line}`} className="mr-2 underline" onClick={() => setComposing(hunk)}>Comment</button>}{line || " "}
      </div>)}</pre>
      {comments.filter((c) => c.path === path && c.hunk === hunk).map((c) => <div key={c.id} className="m-2 rounded border p-2 text-xs whitespace-pre-wrap break-words">{c.body} <button type="button" className="underline" onClick={() => onRemove(c.id)}>Remove</button></div>)}
      {composing === hunk && <div className="p-2"><Composer autoFocus placeholder="Request a change to this hunk…" onCancel={() => setComposing(null)} onSubmit={(body) => { onAdd({ id: crypto.randomUUID(), path, hunk, body }); setComposing(null); }} /></div>}
    </div>)}
    {comments.some((c) => c.path === path && !hunks.includes(c.hunk)) && <p className="p-2 text-xs text-muted-foreground">Some comments refer to an earlier diff. Their original hunks will be sent with the review.</p>}
  </div>;
}
