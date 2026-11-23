"use client";

import { PaperclipIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { usePaths } from "@/components/layout/paths-context";
import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/client/api";
import type { NoteScope } from "@/lib/notes/types";
import { projectSectionPath } from "@/lib/routes";
import { useNotesFeed } from "@/lib/store/notes-store";
import { cn } from "@/lib/utils";
import { textToNote } from "@/lib/vault/to-note";
import { VAULT_MAX_BYTES, routeUpload } from "@/lib/vault/types";

/** Notes API cap on a note body; bigger text files go to the Vault instead. */
const NOTE_MAX_CHARS = 200_000;

export type AddContextTarget = {
  projectId: string;
  /** Where markdown and text files become notes. Defaults to the project's notebook; repo notebooks fall back to it too. */
  noteScope?: NoteScope;
};

/**
 * One way in for files: markdown and text become notes (things you write and keep changing),
 * everything else goes to the Vault as-is (PDFs, images, decks, Word docs).
 */
export function useAddContext({ projectId, noteScope }: AddContextTarget, { onDone }: { onDone?: () => void } = {}) {
  const paths = usePaths();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const kind = noteScope && noteScope.kind !== "repos" ? noteScope.kind : "projects";
  const scopeId = noteScope && noteScope.kind !== "repos" ? noteScope.id : projectId;
  const scope = useMemo<NoteScope>(() => ({ kind, id: scopeId }), [kind, scopeId]);

  const add = useCallback(
    async (files: File[]) => {
      if (!files.length || busy) return;
      const notes: string[] = [];
      let vault = 0;
      const failures: string[] = [];
      for (const [i, file] of files.entries()) {
        setBusy(files.length > 1 ? `Adding ${i + 1} of ${files.length}…` : `Adding ${file.name}…`);
        try {
          if (file.size > VAULT_MAX_BYTES) throw new Error(`over ${VAULT_MAX_BYTES / 1024 / 1024}MB`);
          if (file.size === 0) throw new Error("empty");
          const text = routeUpload(file.name) === "note" ? await file.text() : null;
          if (text !== null && text.length <= NOTE_MAX_CHARS) {
            const { note } = await api.createNote(scope.kind, scope.id, textToNote(file.name, text));
            notes.push(note.id);
          } else {
            await api.uploadVault(projectId, { file });
            vault++;
          }
        } catch (err) {
          failures.push(`${file.name}: ${err instanceof Error ? err.message : "failed"}`);
        }
      }
      setBusy(null);
      if (notes.length) useNotesFeed.getState().touch(scope);
      const town = paths.project(projectId);
      const nws: Record<string, string> = scope.kind === "workspaces" ? { nws: scope.id } : {};
      const parts = [notes.length && `${notes.length} note${notes.length === 1 ? "" : "s"}`, vault && `${vault} file${vault === 1 ? "" : "s"} to the Vault`].filter(Boolean);
      if (parts.length)
        toast.success(`Added ${parts.join(" and ")}`, {
          description: vault ? "Agents in this project can read Vault files. Claude is writing their summaries now." : undefined,
          action: vault
            ? { label: "Open Vault", onClick: () => router.push(projectSectionPath(town, "vault"), { scroll: false }) }
            : { label: "Open", onClick: () => router.push(projectSectionPath(town, "library", { ...nws, ...(notes.length === 1 ? { note: notes[0] } : {}) }), { scroll: false }) },
        });
      if (failures.length) toast.error(`Couldn't add ${failures.length === 1 ? "a file" : `${failures.length} files`}`, { description: failures.join(" · ") });
      if (vault) router.refresh();
      onDone?.();
    },
    [busy, paths, projectId, router, scope, onDone],
  );

  return { add, busy };
}

/** Files being dragged in (not text or links). */
const hasFiles = (e: React.DragEvent | DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");

function DropHint({ busy, label }: { busy: string | null; label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-[var(--w-bronze)] bg-[color-mix(in_oklch,var(--background)_82%,var(--w-bronze))] p-4">
      <div className="flex max-w-xs flex-col items-center gap-1.5 text-center">
        {busy ? <Spinner className="size-5" /> : <UploadIcon className="size-5" />}
        <p className="pixel text-sm">{busy ?? label}</p>
        {!busy && <p className="text-muted-foreground text-xs">Markdown and text become notes. PDFs, images, slides and Word docs go to the Vault.</p>}
      </div>
    </div>
  );
}

/** Wrap an area so files dropped on it are added as context. */
export function ContextDropArea({ target, className, children, label = "Drop to add context" }: { target: AddContextTarget; className?: string; children: React.ReactNode; label?: string }) {
  const { add, busy } = useAddContext(target);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        void add([...e.dataTransfer.files]);
      }}
    >
      {children}
      {(over || busy) && <DropHint busy={busy} label={label} />}
    </div>
  );
}

/** A paperclip button that picks files and adds them as context. */
export function AddContextButton({ target }: { target: AddContextTarget }) {
  const { add, busy } = useAddContext(target);
  const input = useRef<HTMLInputElement>(null);
  return (
    <Hint label="Add files: text becomes notes, the rest goes to the Vault">
      <Button size="icon-sm" variant="outline" aria-label="Add files" disabled={Boolean(busy)} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : <PaperclipIcon />}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void add(files);
          }}
        />
      </Button>
    </Hint>
  );
}

/** The whole window as a drop target, for the project map: shows only while files are dragged over the page. */
export function WindowContextDrop({ target, projectName }: { target: AddContextTarget; projectName: string }) {
  const { add, busy } = useAddContext(target);
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      void add([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, [add]);
  if (!over && !busy) return null;
  return (
    <div className="fixed inset-3 z-50">
      <DropHint busy={busy} label={`Add context to ${projectName}`} />
    </div>
  );
}
