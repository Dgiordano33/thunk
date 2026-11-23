"use client";

import { projectSectionPath } from "@/lib/routes";

import { CheckIcon, DownloadIcon, FileInputIcon, ListTodoIcon, NotebookPenIcon, PinIcon, PinOffIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirm } from "@/components/confirm";
import { Hint } from "@/components/hint";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { relativeTime } from "@/components/session/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useNotesFeed } from "@/lib/store/notes-store";
import { IDEA_LABELS, KIND_LABELS, canConvertToNote, isBusy, type IdeaKind, type VaultItem } from "@/lib/vault/types";
import { KIND_ICONS, VaultStatusBadge, formatBytes } from "./item-list";
import { usePaths } from "@/components/layout/paths-context";

const IDEA_STYLE: Record<IdeaKind, string> = {
  idea: "border-[var(--w-bronze)]/50 text-[var(--w-bronze-dark)] dark:text-[var(--w-bronze-light)]",
  insight: "border-sky-500/40 text-sky-700 dark:text-sky-400",
  question: "border-violet-500/40 text-violet-700 dark:text-violet-400",
  action: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
};

/** One item: preview, what agents get (the summary), and a secondary tab of ideas with → Note / → Task. */
export function ItemDetail({ item, onChange, onDeleted }: { item: VaultItem; onChange: (item: VaultItem) => void; onDeleted: () => void }) {
  const fileUrl = `/api/projects/${item.projectId}/vault/${item.id}/file`;
  const paths = usePaths();
  const router = useRouter();
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

  const togglePin = () => act(async () => onChange((await api.patchVaultItem(item.projectId, item.id, { pinned: !item.pinned })).item));

  const moveToNotes = async () => {
    const ok = await confirm({
      title: `Move “${item.title}” to Notes?`,
      description: item.kind === "office"
        ? "Its text becomes a project note you can keep editing. The Word file and its Vault summary are removed; formatting and images aren't carried over."
        : "It becomes a project note you can keep editing, and leaves the Vault.",
      action: "Move to Notes",
    });
    if (!ok) return;
    await act(async () => {
      const { noteId } = await api.convertVaultItem(item.projectId, item.id);
      useNotesFeed.getState().touch({ kind: "projects", id: item.projectId });
      // Navigating to the note is the only follow-up; onDeleted would push a competing URL.
      router.push(projectSectionPath(paths.project(item.projectId), "library", { note: noteId }), { scroll: false });
    });
  };

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
          <Hint label={item.pinned ? "Unpin: agents still find it with vault_list" : "Pin: its summary goes into every session in this project"}>
            <Button size="sm" variant={item.pinned ? "secondary" : "outline"} onClick={() => void togglePin()} aria-pressed={Boolean(item.pinned)}>
              {item.pinned ? <PinOffIcon /> : <PinIcon />} {item.pinned ? "Pinned" : "Pin"}
            </Button>
          </Hint>
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
          {canConvertToNote(item) && (
            <Hint label="Turn this into a note you keep editing">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void moveToNotes()}>
                <FileInputIcon /> Move to Notes
              </Button>
            </Hint>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-red-700 hover:text-red-700 dark:text-red-400"
            onClick={async () => {
              if (!(await confirm({ title: `Delete “${item.title}”?`, description: "This removes the original file and its summary.", action: "Delete", destructive: true }))) return;
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
        <Tabs defaultValue="summary" className="gap-0">
          <TabsList variant="line" className="h-9 shrink-0 px-4">
            <TabsTrigger className="pixel text-xs" value="summary">What agents see</TabsTrigger>
            <TabsTrigger className="pixel text-xs" value="ideas">Ideas ({item.ideas?.length ?? 0})</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="border-t px-4 py-3">
            <p className="text-muted-foreground mb-2 text-[11px]">
              {item.pinned
                ? "Pinned: this summary is in every session's prompt for this project. Agents open the original for detail."
                : "Agents see the title and first line in every session, and read this summary or the original when it's relevant."}
            </p>
            <div className="doc-prose text-sm">
              <MessageResponse>{item.summary ?? ""}</MessageResponse>
            </div>
            {item.tags?.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {item.tags.map((t) => <Badge key={t} variant="secondary" className="h-5 text-[11px]">#{t}</Badge>)}
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="ideas" className="border-t px-4 py-3">
            <p className="text-muted-foreground mb-2 text-[11px]">Points Claude pulled out while reading. Send one to Notes or Tasks to act on it.</p>
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
                            <Link href={projectSectionPath(paths.project(item.projectId), "library", { note: sent.noteId })} scroll={false}><CheckIcon /> In notes</Link>
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" disabled={busyIdea !== null} onClick={() => void promote(idea.id, "note")}>
                            {busyIdea === `${idea.id}:note` ? <Spinner /> : <NotebookPenIcon />} → Note
                          </Button>
                        )}
                        {sent?.taskId ? (
                          <Button size="xs" variant="ghost" asChild>
                            <Link href={projectSectionPath(paths.project(item.projectId), "tasks")} scroll={false}><CheckIcon /> Task created</Link>
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
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
