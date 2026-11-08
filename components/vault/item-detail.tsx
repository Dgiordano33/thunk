"use client";

import { CheckIcon, DownloadIcon, ListTodoIcon, NotebookPenIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { relativeTime } from "@/components/session/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { IDEA_LABELS, KIND_LABELS, isBusy, type IdeaKind, type VaultItem } from "@/lib/vault/types";
import { KIND_ICONS, VaultStatusBadge, formatBytes } from "./item-list";

const IDEA_STYLE: Record<IdeaKind, string> = {
  idea: "border-[var(--w-bronze)]/50 text-[var(--w-bronze-dark)] dark:text-[var(--w-bronze-light)]",
  insight: "border-sky-500/40 text-sky-700 dark:text-sky-400",
  question: "border-violet-500/40 text-violet-700 dark:text-violet-400",
  action: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
};

/** One item: preview, summary, and ideas with → Note / → Task. */
export function ItemDetail({ item, onChange, onDeleted }: { item: VaultItem; onChange: (item: VaultItem) => void; onDeleted: () => void }) {
  const fileUrl = `/api/projects/${item.projectId}/vault/${item.id}/file`;
  const Icon = KIND_ICONS[item.kind];
  const [title, setTitle] = useState(item.title);
  const [busyIdea, setBusyIdea] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = isBusy(item);

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const saveTitle = () => {
    const t = title.trim();
    if (!t || t === item.title) return setTitle(item.title);
    void act(async () => onChange((await api.patchVaultItem(item.projectId, item.id, { title: t })).item));
  };

  const promote = (ideaId: string, to: "note" | "task") =>
    act(async () => {
      setBusyIdea(`${ideaId}:${to}`);
      try {
        onChange((await api.promoteVaultIdea(item.projectId, item.id, ideaId, to)).item);
      } finally {
        setBusyIdea(null);
      }
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <textarea
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setTitle(item.title);
              e.currentTarget.blur();
            }
          }}
          aria-label="Title"
          className="field-sizing-content w-full resize-none bg-transparent text-xl leading-tight font-bold outline-none"
        />
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <VaultStatusBadge item={item} />
          <span className="flex items-center gap-1"><Icon className="size-3" />{KIND_LABELS[item.kind]}</span>
          <span>·</span>
          <span className="max-w-60 truncate font-mono">{item.filename}</span>
          <span>·</span>
          <span className="tabular-nums">{formatBytes(item.size)}</span>
          <span>·</span>
          <span>Added {relativeTime(item.createdAt)}</span>
        </div>
        {item.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element -- served from the local API, not optimisable.
          <img src={fileUrl} alt={item.title} className="bg-muted max-h-56 w-fit max-w-full rounded-md border object-contain" />
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={item.kind === "image" || item.kind === "pdf" || item.kind === "text" ? fileUrl : `${fileUrl}?download`} target="_blank" rel="noreferrer">
              Open original
            </a>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={`${fileUrl}?download`} aria-label="Download original"><DownloadIcon /> Download</a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void act(async () => onChange((await api.patchVaultItem(item.projectId, item.id, { reextract: true })).item))}
          >
            <RefreshCwIcon className={cn(busy && "animate-spin")} /> {item.status === "failed" ? "Try again" : "Re-read"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-red-700 hover:text-red-700 dark:text-red-400"
            onClick={() => {
              if (!confirm(`Delete “${item.title}” and its original file?`)) return;
              void act(async () => {
                await api.deleteVaultItem(item.projectId, item.id);
                onDeleted();
              });
            }}
          >
            <Trash2Icon /> Delete
          </Button>
        </div>
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
      </div>

      {busy ? (
        <div className="text-muted-foreground flex items-center gap-2 px-4 py-6 text-sm">
          <Spinner className="size-4" /> {item.status === "queued" ? "Waiting to be read…" : "Claude is reading this…"}
        </div>
      ) : item.status === "failed" ? (
        <div className="px-4 py-6 text-sm">
          <p className="font-medium text-red-700 dark:text-red-400">Couldn&apos;t read this.</p>
          <p className="text-muted-foreground mt-1 text-xs">{item.error}</p>
        </div>
      ) : (
        <>
          <section className="border-b px-4 py-3">
            <h3 className="pixel text-muted-foreground mb-2 text-xs tracking-wide uppercase">Summary</h3>
            <div className="doc-prose text-sm">
              <MessageResponse>{item.summary ?? ""}</MessageResponse>
            </div>
            {item.tags?.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {item.tags.map((t) => <Badge key={t} variant="secondary" className="h-5 text-[11px]">#{t}</Badge>)}
              </div>
            ) : null}
          </section>
          <section className="px-4 py-3">
            <h3 className="pixel text-muted-foreground mb-2 text-xs tracking-wide uppercase">Ideas ({item.ideas?.length ?? 0})</h3>
            {!item.ideas?.length ? (
              <p className="text-muted-foreground text-xs">No distinct ideas found.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {item.ideas.map((idea) => {
                  const sent = item.promoted?.find((p) => p.ideaId === idea.id);
                  return (
                    <li key={idea.id} className="bg-background rounded-lg border px-3 py-2">
                      <div className="flex items-start gap-2">
                        <Badge variant="outline" className={cn("mt-0.5 h-5 shrink-0 text-[10px]", IDEA_STYLE[idea.kind])}>{IDEA_LABELS[idea.kind]}</Badge>
                        <p className="min-w-0 flex-1 text-[13px] font-medium">{idea.title}</p>
                      </div>
                      {idea.detail && <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{idea.detail}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {sent?.noteId ? (
                          <Button size="xs" variant="ghost" asChild>
                            <Link href={`/p/${item.projectId}?building=library&note=${sent.noteId}`} scroll={false}><CheckIcon /> In notes</Link>
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" disabled={busyIdea !== null} onClick={() => void promote(idea.id, "note")}>
                            {busyIdea === `${idea.id}:note` ? <Spinner /> : <NotebookPenIcon />} → Note
                          </Button>
                        )}
                        {sent?.taskId ? (
                          <Button size="xs" variant="ghost" asChild>
                            <Link href={`/p/${item.projectId}?building=tasks`} scroll={false}><CheckIcon /> Task created</Link>
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" disabled={busyIdea !== null} onClick={() => void promote(idea.id, "task")}>
                            {busyIdea === `${idea.id}:task` ? <Spinner /> : <ListTodoIcon />} → Task
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
