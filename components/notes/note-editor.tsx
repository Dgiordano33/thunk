"use client";

import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryEditor } from "@/components/memory/memory-editor";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { editorExtensions } from "@/lib/editor/extensions";
import { docToMarkdown } from "@/lib/editor/markdown";
import { MEMORY_NOTE_ID, scopeKey, type Note, type NoteFlags, type NoteScope } from "@/lib/notes/types";
import { useNotesFeed } from "@/lib/store/notes-store";
import { NoteMetaBar } from "./note-meta-bar";

const SAVE_MS = 800;

/** Load a note and edit it. Frontmatter stays out of the editor; flags live in the meta bar. */
export function NoteEditor({
  scope,
  noteId,
  onDeleted,
}: {
  scope: NoteScope;
  noteId: string;
  onDeleted?: () => void;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${scopeKey(scope)}/${noteId}`;

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    setError(null);
    api
      .getNote(scope.kind, scope.id, noteId)
      .then((r) => !cancelled && setNote(r.note))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies scope + note.
  }, [key]);

  if (error) return <p className="text-destructive p-6 text-sm">{error}</p>;
  if (!note)
    return (
      <div className="text-muted-foreground flex flex-1 justify-center p-8">
        <Loader2Icon className="size-4 animate-spin" />
      </div>
    );
  return <NoteEditorBody key={key} scope={scope} initial={note} onDeleted={onDeleted} />;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

function NoteEditorBody({ scope, initial, onDeleted }: { scope: NoteScope; initial: Note; onDeleted?: () => void }) {
  const router = useRouter();
  const [delegating, setDelegating] = useState(false);
  const memory = initial.id === MEMORY_NOTE_ID;
  const [note, setNote] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Note | null>(null);
  const [broken, setBroken] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  /** Body as last written by us or loaded from disk: lets us ignore our own watcher echoes. */
  const known = useRef(new Set([initial.markdown]));
  const dirty = useRef(false);
  const titleRef = useRef(initial.title);
  const version = useRef(initial.updatedAt);
  const savedTitle = useRef(initial.title);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const editor = editorRef.current;
    if (!editor || !dirty.current) return;
    const markdown = docToMarkdown(editor);
    const body = { markdown, expectedUpdatedAt: version.current, ...(!memory && titleRef.current !== savedTitle.current ? { title: titleRef.current } : {}) };
    known.current.add(markdown);
    dirty.current = false;
    setSave("saving");
    try {
      const r = await api.patchNote(scope.kind, scope.id, initial.id, body);
      version.current = r.note.updatedAt;
      savedTitle.current = r.note.title;
      setNote(r.note);
      known.current = new Set([r.note.markdown, markdown]);
      setSave(dirty.current ? "dirty" : "saved");
      setSaveError(null);
      useNotesFeed.getState().touch(scope);
    } catch (err) {
      dirty.current = true;
      setSave("error");
      setSaveError((err as Error).message);
      if (/changed on disk/i.test((err as Error).message)) {
        const fresh = await api.getNote(scope.kind, scope.id, initial.id).catch(() => null);
        if (fresh) setConflict(fresh.note);
      }
    }
  }, [scope, initial.id, memory]);

  const schedule = useCallback(() => {
    dirty.current = true;
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_MS);
  }, [flush]);

  const extensions = useMemo(() => editorExtensions({ placeholder: memory ? "Nothing remembered yet" : "Start writing…" }), [memory]);
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      content: initial.markdown,
      contentType: "markdown",
      editorProps: {
        attributes: { class: "focus:outline-none", spellcheck: "true" },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            void flush();
            return true;
          }
          return false;
        },
      },
      onUpdate: () => schedule(),
      onContentError: () => setBroken(true),
    },
    [initial.id],
  );
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Flush pending edits when switching notes or closing the panel.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(
    () => () => {
      if (timer.current) void flushRef.current();
    },
    [],
  );

  // Someone else (an agent, another tab) changed the file.
  const rev = useNotesFeed((s) => (s.noteRev[`${scopeKey(scope)}/${initial.id}`] ?? 0) + (s.noteRev[`${scopeKey(scope)}/*`] ?? 0));
  useEffect(() => {
    if (!rev) return;
    let cancelled = false;
    api
      .getNote(scope.kind, scope.id, initial.id)
      .then(({ note: fresh }) => {
        if (cancelled) return;
        if (known.current.has(fresh.markdown) && fresh.title === savedTitle.current) {
          version.current = fresh.updatedAt;
          setNote(fresh);
          return;
        }
        if (dirty.current) {
          if (timer.current) clearTimeout(timer.current);
          setConflict(fresh);
          return;
        }
        version.current = fresh.updatedAt;
        savedTitle.current = fresh.title;
        known.current = new Set([fresh.markdown]);
        setNote(fresh);
        if (!memory) {
          setTitle(fresh.title);
          titleRef.current = fresh.title;
        }
        editorRef.current?.commands.setContent(fresh.markdown, { contentType: "markdown", emitUpdate: false });
      })
      .catch((err: Error) => {
        // Deleted on disk.
        if (!cancelled && /not found/i.test(err.message)) onDeleted?.();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch per revision only.
  }, [rev]);

  const takeTheirs = () => {
    if (!conflict) return;
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    version.current = conflict.updatedAt;
    savedTitle.current = conflict.title;
    known.current = new Set([conflict.markdown]);
    setNote(conflict);
    setTitle(conflict.title);
    titleRef.current = conflict.title;
    editorRef.current?.commands.setContent(conflict.markdown, { contentType: "markdown", emitUpdate: false });
    setSave("saved");
    setConflict(null);
  };

  const keepMine = () => {
    if (conflict) version.current = conflict.updatedAt;
    setConflict(null);
    dirty.current = true;
    void flush();
  };

  const patchFlags = async (flags: Partial<NoteFlags>) => {
    setNote((n) => ({ ...n, ...flags }));
    try {
      const r = await api.patchNote(scope.kind, scope.id, initial.id, flags);
      known.current.add(r.note.markdown);
      version.current = r.note.updatedAt;
      savedTitle.current = r.note.title;
      setNote(r.note);
      useNotesFeed.getState().touch(scope);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!window.confirm(note.source === "repo" ? `Delete ${note.path}? This removes the file from the working tree.` : `Delete "${note.title}"? This removes the file from disk.`)) return;
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    await api.deleteNote(scope.kind, scope.id, initial.id);
    useNotesFeed.getState().touch(scope);
    onDeleted?.();
  };

  if (broken && memory && scope.kind !== "repos") {
    // TipTap couldn't parse the file; fall back to the plain-text memory editor.
    return (
      <div className="p-4">
        <MemoryEditor scope={scope.kind} id={scope.id} title={note.title} hint="Shown as plain text: the rich editor couldn't read this file." />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NoteMetaBar note={note} onChange={patchFlags} onDelete={memory ? undefined : remove}
        delegateDisabled={delegating || save !== "saved" || Boolean(conflict) || broken}
        onDelegate={memory ? undefined : () => {
          setDelegating(true);
          api.delegateNote(scope, note.id).then((r) => { router.push(`/w/${r.workspaceId}/s/${r.sessionId}`); router.refresh(); })
            .catch((err: Error) => setSaveError(err.message)).finally(() => setDelegating(false));
        }} />
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs">
          <span className="flex-1">This note changed on disk while you were editing (an agent may have updated it).</span>
          <Button size="xs" variant="outline" onClick={takeTheirs}>Load their version</Button>
          <Button size="xs" variant="ghost" onClick={keepMine}>Keep mine</Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        {!memory && (
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              schedule();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
            placeholder="Untitled"
            aria-label="Note title"
            className="placeholder:text-muted-foreground mb-3 w-full bg-transparent text-2xl font-bold tracking-tight outline-none"
          />
        )}
        <div className="doc-prose">
          <EditorContent editor={editor} />
        </div>
      </div>
      <footer className="text-muted-foreground flex shrink-0 items-center gap-2 border-t px-4 py-1.5 text-[11px]">
        <span aria-live="polite">
          {save === "saving" ? "Saving…" : save === "dirty" ? "Edited" : save === "error" ? `Couldn't save: ${saveError}` : `Saved · ${relativeTime(note.updatedAt)}`}
        </span>
        {save !== "error" && saveError && <span className="text-destructive">{saveError}</span>}
        <span className="ml-auto">⌘S to save now</span>
      </footer>
    </div>
  );
}
