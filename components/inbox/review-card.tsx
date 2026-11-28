"use client";

import Link from "next/link";
import { ArrowUpRightIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReviewDiff, SendReview, useDiffComments } from "@/components/workspace/diff-review";
import { api } from "@/lib/client/api";
import { deliveryCue, deliveryStage } from "@/lib/projects/delivery-types";
import type { ChangedFile, RepoChanges, WorkspaceChanges } from "@/lib/projects/types";
import type { ReviewState } from "@/lib/review/types";
import type { DiffComment } from "@/lib/review/diff";
import { cn } from "@/lib/utils";
import { plural } from "./model";

/** Inbox buttons use the full-strength ring: the shared ring/50 measures ~2.1:1 on the glass panel. */
const RING = "focus-visible:ring-2 focus-visible:ring-ring";
type Cue = "pass" | "fail" | "pending" | "none";
const GLYPH: Record<Cue, string> = { pass: "✓", fail: "×", pending: "…", none: "–" };

/** A status word with its glyph, in the status colour: it reads without colour too. */
function Status({ cue, children }: { cue: Cue; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-baseline gap-1", cue === "none" ? "text-muted-foreground" : `status-cue is-${cue}`)}><span aria-hidden="true">{GLYPH[cue]}</span>{children}</span>;
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return <section aria-label={title} className="grid gap-1 border-t py-2.5 first:border-t-0 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
    <h4 className="text-muted-foreground text-xs font-medium">{title}</h4>
    <div className="min-w-0 space-y-1.5 text-sm">{children}</div>
  </section>;
}

export function useReview(sessionId: string | null) {
  const [review, setReview] = useState<ReviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!sessionId) return;
    try { setReview((await api.sessionReview(sessionId)).review); setError(null); }
    catch (err) { setError((err as Error).message); }
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    api.sessionReview(sessionId).then((r) => { if (!cancelled) { setReview(r.review); setError(null); } }).catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [sessionId]);
  return { review, error, reload: load };
}

/**
 * The three parts of a review: what changed (with the diff and Request changes), the latest trial merge,
 * and the pull request. Shared by the review card and a ready thought that changed code, so both read alike.
 */
export function ReviewParts({ sessionId, workspaceId, summary, tab, onChanged }: { sessionId: string; workspaceId: string; summary?: string | null; tab: number; onChanged?: () => void }) {
  const { review, error, reload } = useReview(sessionId);
  const [diffOpen, setDiffOpen] = useState(false);
  const [busy, setBusy] = useState<"integrate" | "pr" | null>(null);
  const refresh = async () => { await reload(); onChanged?.(); };
  async function integrate() {
    if (!review) return;
    setBusy("integrate");
    try { await api.integrateWorkspace(workspaceId, review.taskId); await refresh(); toast("Trial merge finished"); }
    catch (err) { toast.error("Couldn’t run the trial merge", { description: (err as Error).message }); }
    finally { setBusy(null); }
  }
  async function openPr() {
    setBusy("pr");
    try { const { url, created } = await api.openPullRequest(workspaceId); await refresh(); toast(created ? "Pull request opened" : "A pull request is already open", { action: { label: "Open", onClick: () => window.open(url, "_blank", "noreferrer") } }); }
    catch (err) { toast.error("Couldn’t open a pull request", { description: (err as Error).message }); }
    finally { setBusy(null); }
  }
  if (error && !review) return <p role="alert" className="text-muted-foreground mt-3 text-xs">Couldn’t load the review: {error}</p>;
  if (!review) return <div role="status" aria-label="Loading review" className="mt-3 space-y-2"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>;
  const { changes, integration, pr } = review;
  const stage = pr ? deliveryStage(pr.pr) : null;
  const cue = pr?.pr ? deliveryCue(pr.pr) : null;
  const checks = pr?.pr?.checks ?? [];
  const count = (state: string) => checks.filter((c) => c.state === state).length;
  return <div className="bg-muted/20 mt-3 rounded-sm border px-3 py-1">
    <Part title="Changes">
      {summary && <p className="line-clamp-4 whitespace-pre-wrap break-words">{summary}</p>}
      <p className="text-muted-foreground font-mono text-xs tabular-nums">{changes ? <>{plural(changes.files, "file")} · <span className="text-emerald-700 dark:text-emerald-400">+{changes.additions}</span> <span className="text-red-600 dark:text-red-400">−{changes.deletions}</span></> : "No Git changes to show"}{review.branch ? ` · ${review.branch}` : ""}</p>
      {changes && changes.files > 0 && <Button size="sm" variant="outline" tabIndex={tab} aria-expanded={diffOpen} className={RING} onClick={() => setDiffOpen((o) => !o)}>
        <ChevronRightIcon aria-hidden="true" className={cn("transition-transform duration-150 motion-reduce:transition-none", diffOpen && "rotate-90")} />{diffOpen ? "Hide diff" : "Review diff"}
      </Button>}
      {diffOpen && <InboxDiff workspaceId={workspaceId} sessionId={sessionId} />}
    </Part>
    <Part title="Trial merge">
      {!integration ? <p className="text-muted-foreground text-xs">Not trial-merged yet.</p> : <>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {integration.merged ? <Status cue="pass">Merges cleanly</Status> : integration.conflicts.length ? <Status cue="fail">Conflicts</Status> : <Status cue="none">Not merged</Status>}
          <Status cue={integration.tests.state === "passed" ? "pass" : integration.tests.state === "failed" ? "fail" : "none"}>{integration.tests.state === "passed" ? "Tests passed" : integration.tests.state === "failed" ? "Tests failed" : "Tests not run"}</Status>
          <Link href={`/w/${integration.workspaceId}`} tabIndex={tab} className={cn("text-muted-foreground hover:text-foreground rounded-sm underline-offset-2 hover:underline", RING)}>Integration workspace</Link>
        </p>
        {integration.conflicts.map((c) => <p key={c.repo} className="font-mono text-[11px] break-words">{c.repo}: {c.files.join(", ") || "files not reported"}</p>)}
        {integration.tests.state === "not_run" && <p className="text-muted-foreground text-xs">{integration.tests.detail}</p>}
        {integration.tests.state === "failed" && <details className="text-xs"><summary className={cn("text-muted-foreground cursor-pointer rounded-sm", RING)} tabIndex={tab}>Test output</summary><pre className="bg-background mt-1 max-h-48 overflow-auto rounded-sm border p-2 font-mono text-[11px] whitespace-pre-wrap">{integration.tests.detail}</pre></details>}
        {integration.outOfDate && <p className="text-xs"><Status cue="pending">Out of date</Status> <span className="text-muted-foreground">The branch has moved since this trial merge.</span></p>}
      </>}
      {(!integration || integration.outOfDate) && <Button size="sm" variant="outline" tabIndex={tab} className={RING} disabled={busy !== null} onClick={() => void integrate()}>{busy === "integrate" ? "Merging and testing…" : integration ? "Run again" : "Run trial merge"}</Button>}
    </Part>
    <Part title="Pull request">
      {!pr ? <p className="text-muted-foreground text-xs">No GitHub remote for this branch.</p> : <>
        <p className="text-xs"><span className="font-medium">{stage!.label}</span>{pr.pr && <span className="text-muted-foreground font-mono"> · #{pr.pr.number}</span>}</p>
        {pr.pr?.state === "OPEN" && <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {checks.length ? <>
            {count("pass") > 0 && <Status cue="pass">{count("pass")} passed</Status>}
            {count("fail") > 0 && <Status cue="fail">{count("fail")} failed</Status>}
            {count("pending") > 0 && <Status cue="pending">{count("pending")} running</Status>}
          </> : <Status cue="none">{cue?.label ?? "No checks reported"}</Status>}
        </p>}
        {pr.pr?.state === "MERGED" && <p className="text-muted-foreground text-xs">GitHub confirms the merge; this card is resolved.</p>}
        {!pr.pr && !pr.canCreate && pr.reason && <p className="text-muted-foreground text-xs">{pr.reason}</p>}
      </>}
      <div className="flex flex-wrap gap-2">
        {pr?.canCreate && pr.pr?.state !== "MERGED" && <Button size="sm" tabIndex={tab} className={RING} disabled={busy !== null} onClick={() => void openPr()}>{busy === "pr" ? "Opening…" : "Open PR"}</Button>}
        {pr?.pr && <Button asChild size="sm" variant="ghost" tabIndex={tab} className={RING}><a href={pr.pr.url} target="_blank" rel="noreferrer">Open PR on GitHub<ArrowUpRightIcon aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></Button>}
      </div>
    </Part>
  </div>;
}

/** The worker's diff, file by file, with hunk comments sent back to the worker as one review. */
function InboxDiff({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
  const { comments, setComments, storageError } = useDiffComments(workspaceId);
  const [data, setData] = useState<{ changes: WorkspaceChanges | null; repos: RepoChanges[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.workspaceChanges(workspaceId).then((d) => { if (!cancelled) setData(d); }).catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [workspaceId]);
  const remove = (ids: string[]) => setComments((all) => all.filter((c) => !ids.includes(c.id)));
  const add = (c: DiffComment) => setComments((all) => [...all, c]);
  const send = async (review: string) => { await api.resume(sessionId); await api.send(sessionId, review); toast("Requested changes from the worker"); };
  if (error) return <p role="alert" className="text-destructive text-xs">Couldn’t load the diff: {error}</p>;
  if (!data) return <div role="status" aria-label="Loading diff" className="space-y-2"><Skeleton className="h-3" /><Skeleton className="h-3 w-2/3" /></div>;
  const multi = data.repos.length > 0;
  const sections = multi ? data.repos.filter((r) => r.changes) : data.changes ? [{ id: "", name: "", cwd: "", changes: data.changes }] : [];
  return <div className="bg-background -mx-1 overflow-hidden rounded-sm border">
    {storageError && <p role="alert" className="text-destructive p-2 text-xs">{storageError}</p>}
    <SendReview workspaceId={workspaceId} comments={comments} onSent={remove} send={send} label="Request changes" />
    {!comments.length && <p className="text-muted-foreground border-b px-3 py-2 text-xs">Comment on a hunk, then send the comments to the worker with Request changes.</p>}
    {sections.map((repo) => <ul key={repo.id} aria-label={multi ? `Changes in ${repo.name}` : "Changed files"} className="py-1">
      {repo.changes!.files.map((f) => <DiffFile key={f.path} workspaceId={workspaceId} repoId={multi ? repo.id : undefined} label={multi ? `${repo.name}: ${f.path}` : f.path} file={f} comments={comments} onAdd={add} onRemove={(id) => remove([id])} />)}
    </ul>)}
  </div>;
}

function DiffFile({ workspaceId, repoId, label, file, comments, onAdd, onRemove }: { workspaceId: string; repoId?: string; label: string; file: ChangedFile; comments: DiffComment[]; onAdd: (c: DiffComment) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.workspaceFileDiff(workspaceId, file.path, repoId).then((r) => { if (!cancelled) setDiff(r.diff); }).catch((err: Error) => { if (!cancelled) setDiff(`Couldn't load diff: ${err.message}`); });
    return () => { cancelled = true; };
  }, [open, workspaceId, file.path, repoId]);
  return <li>
    <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={file.path} className={cn("hover:bg-muted flex w-full items-center gap-1.5 px-3 py-1.5 text-left", RING)}>
      <ChevronRightIcon aria-hidden="true" className={cn("text-muted-foreground size-3.5 shrink-0", open && "rotate-90")} />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{label}</span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums">
        {file.additions > 0 && <span className="text-emerald-700 dark:text-emerald-400">+{file.additions}</span>}
        {file.deletions > 0 && <span className="ml-1 text-red-600 dark:text-red-400">−{file.deletions}</span>}
      </span>
    </button>
    {open && <div className="mx-2 mb-2 overflow-x-auto rounded-sm border">{diff === null ? <Skeleton className="m-2 h-3" /> : <ReviewDiff diff={diff} path={label} comments={comments} onAdd={onAdd} onRemove={onRemove} />}</div>}
  </li>;
}
