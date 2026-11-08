"use client";

import { ChevronRightIcon, FileTextIcon, ListChecksIcon, Loader2Icon, MessageSquareIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client/api";
import type { SessionMeta } from "@/lib/agent/types";
import type { DiffComment } from "@/lib/review/diff";
import type { Artifact } from "@/lib/documents/types";
import type { ChangedFile, WorkspaceChanges } from "@/lib/projects/types";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";
import { ReviewDiff, SendReview, useDiffComments } from "./diff-review";
import { Checkpoints } from "./checkpoints";
import { SessionsList } from "./sessions-list";
import { WorkspaceTasks } from "./workspace-tasks";
import { useTaskCounts } from "@/components/tasks/use-tasks";
import { WorkspaceNotes } from "./workspace-notes";

const CHANGES_POLL_MS = 5000;

/** Workspace-wide info, shared by every session tab: what was produced and what changed on disk. */
export function WorkspacePanel({ workspaceId, projectId, sessions }: { workspaceId: string; projectId: string; sessions: SessionMeta[] }) {
  return <Suspense fallback={<Loading />}><WorkspacePanelContent workspaceId={workspaceId} projectId={projectId} sessions={sessions} /></Suspense>;
}

function WorkspacePanelContent({ workspaceId, projectId, sessions }: { workspaceId: string; projectId: string; sessions: SessionMeta[] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const tab = params.get("tab") ?? "sessions";
  const counts = useTaskCounts()[projectId];
  const openCount = (counts?.project ?? 0) + (counts?.byWorkspace[workspaceId] ?? 0);
  const [changes, setChanges] = useState<WorkspaceChanges | null | undefined>(undefined);

  // Poll git while the tab is visible, and re-check whenever the open session settles.
  const status = useSession((s) => s.status);
  const loadChanges = useCallback(
    () =>
      api
        .workspaceChanges(workspaceId)
        .then((r) => setChanges(r.changes))
        .catch(() => setChanges(null)),
    [workspaceId],
  );
  useEffect(() => {
    void loadChanges();
    const t = setInterval(() => document.visibilityState === "visible" && void loadChanges(), CHANGES_POLL_MS);
    return () => clearInterval(t);
  }, [loadChanges, status]);

  const fileCount = changes?.files.length ?? 0;

  return (
    <Tabs value={["sessions", "artifacts", "changes", "tasks", "notes", "checkpoints"].includes(tab) ? tab : "sessions"} onValueChange={(value) => {
      const query = new URLSearchParams(params.toString());
      query.set("tab", value);
      router.replace(`${pathname}?${query}`, { scroll: false });
    }} className="flex h-full flex-col gap-0">
      <div className="flex h-11 shrink-0 items-end overflow-x-auto border-b px-2">
        <TabsList variant="line" className="h-full">
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="changes">
            Changes
            {fileCount > 0 && <span className="text-muted-foreground text-xs tabular-nums">{fileCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="tasks">Tasks {openCount > 0 && <span className="text-muted-foreground text-xs tabular-nums">{openCount}</span>}</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="sessions" className="min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          <SessionsList workspaceId={workspaceId} sessions={sessions} />
        </div>
      </TabsContent>
      <TabsContent value="artifacts" className="min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          <Artifacts workspaceId={workspaceId} />
        </div>
      </TabsContent>
      <TabsContent value="changes" className="min-h-0 flex-1">
        {/* Plain overflow, not ScrollArea: its table layout would widen to the longest diff line. */}
        <div className="h-full overflow-y-auto">
          <Changes workspaceId={workspaceId} changes={changes} />
        </div>
      </TabsContent>
      <TabsContent value="checkpoints" className="min-h-0 flex-1 overflow-y-auto"><Checkpoints workspaceId={workspaceId} onRestore={loadChanges} /></TabsContent>
      <TabsContent value="tasks" className="min-h-0 flex-1 overflow-y-auto"><WorkspaceTasks workspaceId={workspaceId} projectId={projectId} /></TabsContent>
      <TabsContent value="notes" className="min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          <WorkspaceNotes workspaceId={workspaceId} projectId={projectId} />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function Artifacts({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const activeDocumentId = useSession((s) => s.activeDocumentId);
  // Refetch when the open session gains a document or finishes a turn.
  const docCount = useSession((s) => Object.keys(s.documents).length);
  const status = useSession((s) => s.status);

  useEffect(() => {
    api
      .workspaceArtifacts(workspaceId)
      .then((r) => setArtifacts(r.artifacts))
      .catch(() => setArtifacts([]));
  }, [workspaceId, docCount, status]);

  if (!artifacts) return <Loading />;
  if (artifacts.length === 0)
    return <Empty text="No artifacts yet. Responses and plans from every session in this workspace show up here." />;

  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {artifacts.map((a) => {
        const Icon = a.kind === "plan" ? ListChecksIcon : FileTextIcon;
        const href = `/w/${workspaceId}/s/${a.sessionId}#doc-${a.id}`;
        const here = pathname === `/w/${workspaceId}/s/${a.sessionId}`;
        return (
          <li key={a.id}>
            <Link
              href={href}
              onClick={() => {
                if (!here) return;
                useSession.getState().setActiveDocument(a.id);
                document.getElementById(`doc-${a.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cn(
                "hover:bg-muted flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors",
                a.id === activeDocumentId && here && "bg-muted",
              )}
            >
              <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{a.title}</p>
                <p className="text-muted-foreground flex items-center gap-1.5 truncate text-[11px]">
                  <span>
                    {a.kind === "plan" ? "Plan" : "Response"}
                    {a.version > 1 && ` v${a.version}`}
                  </span>
                  <span>·</span>
                  <span className="truncate">{a.sessionTitle || "Untitled"}</span>
                  {a.createdAt && <span className="shrink-0">· {relativeTime(a.createdAt)}</span>}
                </p>
              </div>
              {a.openComments > 0 && (
                <span
                  className="text-muted-foreground mt-0.5 flex shrink-0 items-center gap-1 text-[11px]"
                  title={`${a.openComments} open comment${a.openComments === 1 ? "" : "s"}`}
                >
                  <MessageSquareIcon className="size-3" />
                  {a.openComments}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Changes({ workspaceId, changes }: { workspaceId: string; changes: WorkspaceChanges | null | undefined }) {
  const { comments, setComments, storageError } = useDiffComments(workspaceId);
  const remove = (ids: string[]) => setComments((all) => all.filter((c) => !ids.includes(c.id)));
  if (changes === undefined) return <Loading />;
  if (changes === null) return <Empty text="Not a git repository." />;

  return (
    <div className="flex flex-col">
      {storageError && <p role="alert" className="p-3 text-xs text-destructive">{storageError}</p>}
      <SendReview workspaceId={workspaceId} comments={comments} onSent={remove} />
      <div className="flex items-baseline gap-2 px-4 pt-3 pb-2">
        <span className="text-sm font-medium">
          {changes.files.length} file{changes.files.length === 1 ? "" : "s"} changed
        </span>
        <span className="text-muted-foreground truncate text-xs">vs {changes.baseLabel}</span>
        <span className="ml-auto shrink-0 font-mono text-xs">
          <span className="text-emerald-600 dark:text-emerald-400">+{changes.additions}</span>{" "}
          <span className="text-red-600 dark:text-red-400">-{changes.deletions}</span>
        </span>
      </div>
      {changes.files.length === 0 ? (
        <Empty text="No changes yet." />
      ) : (
        <ul className="flex flex-col pb-2">
          {changes.files.map((f) => (
            <ChangedFileRow key={f.path} workspaceId={workspaceId} file={f} comments={comments} onAdd={(c) => setComments((all) => [...all, c])} onRemove={(id) => remove([id])} />
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  A: { label: "Added", className: "text-emerald-600 dark:text-emerald-400" },
  U: { label: "Untracked", className: "text-emerald-600 dark:text-emerald-400" },
  M: { label: "Modified", className: "text-amber-600 dark:text-amber-400" },
  D: { label: "Deleted", className: "text-red-600 dark:text-red-400" },
};

function ChangedFileRow({ workspaceId, file, comments, onAdd, onRemove }: { workspaceId: string; file: ChangedFile; comments: DiffComment[]; onAdd: (c: DiffComment) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = file.path.slice(slash + 1);
  const st = STATUS_STYLE[file.status] ?? { label: file.status, className: "text-muted-foreground" };

  // Refresh even when edits leave the addition/deletion counts unchanged.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .workspaceFileDiff(workspaceId, file.path)
      .then((r) => { if (!cancelled) setDiff(r.diff); })
      .catch((err: Error) => { if (!cancelled) setDiff(`Couldn't load diff: ${err.message}`); });
    return () => { cancelled = true; };
  }, [open, workspaceId, file]);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={file.path}
        className="hover:bg-muted flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors"
      >
        <ChevronRightIcon className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="flex min-w-0 flex-1 text-[13px]">
          <span className="text-muted-foreground truncate">{dir}</span>
          <span className="shrink-0">{name}</span>
        </span>
        <span className={cn("w-3 shrink-0 text-center font-mono text-[11px]", st.className)} title={st.label}>
          {file.status}
        </span>
        <span className="w-16 shrink-0 text-right font-mono text-[11px]">
          {file.additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>}
          {file.deletions > 0 && <span className="ml-1 text-red-600 dark:text-red-400">-{file.deletions}</span>}
        </span>
      </button>
      {open && (
        <div className="bg-background mx-2 mb-2 overflow-x-auto rounded-md border">
          {diff === null ? <Loading /> : <ReviewDiff diff={diff} path={file.path} comments={comments} onAdd={onAdd} onRemove={onRemove} />}
        </div>
      )}
    </li>
  );
}

function Loading() {
  return (
    <div className="text-muted-foreground flex justify-center p-6">
      <Loader2Icon className="size-4 animate-spin" />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-muted-foreground px-4 py-6 text-center text-xs">{text}</p>;
}
