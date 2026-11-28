"use client";

import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryEditor } from "@/components/memory/memory-editor";
import { relativeTime } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import { editorExtensions } from "@/lib/editor/extensions";
import { MemoryHeading } from "@/lib/editor/memory-heading";
import { docToMarkdown } from "@/lib/editor/markdown";
import { extractTasks } from "@/lib/notes/frontmatter";
import { MEMORY_NOTE_ID, scopeKey, type Note, type NoteFlags, type NoteScope } from "@/lib/notes/types";
import { useNotesFeed } from "@/lib/store/notes-store";
import { NoteMetaBar } from "./note-meta-bar";
import { useAddToCanvas } from "@/components/board/add-to-canvas";
import { usePaths } from "@/components/layout/paths-context";
import { NoteSessions } from "./note-sessions";
import { confirm } from "@/components/confirm";
import { OnboardingHint } from "@/components/onboarding/hint";

const SAVE_MS = 800;
/** The store's default title. The editor shows it as the placeholder, so a new note's title starts empty. */
const UNTITLED = "Untitled";
const shownTitle = (t: string) => (t === UNTITLED ? "" : t);
const storedTitle = (t: string) => t.trim() || UNTITLED;

/** The editor pane's loading state, shared with the dynamic import's fallback. */
export function EditorLoading() {
  return (
    <div role="status" aria-label="Loading note" className="text-muted-foreground flex flex-1 justify-center p-8">
      <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
    </div>
  );
}

/** Load a note and edit it. Frontmatter stays out of the editor; flags live in the meta bar. */
export function NoteEditor({
  scope,
  noteId,
  onDeleted,
  topLevel = false,
}: {
  scope: NoteScope;
  noteId: string;
  onDeleted?: () => void;
  /** A top-level note: its checklist items are relayed across projects, with a plan to approve. */
  topLevel?: boolean;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
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
  }, [key, attempt]);

  if (error)
    return (
      <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
        <p className="font-medium">Couldn&apos;t open this note</p>
        <p className="text-muted-foreground max-w-sm text-xs">{error}</p>
        <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
      </div>
    );
  if (!note) return <EditorLoading />;
  return <NoteEditorBody key={key} scope={note.scope} initial={note} onDeleted={onDeleted} topLevel={topLevel} />;
}

type SaveState = "saved" | "dirty" | "saving" | "error";

function NoteEditorBody({ scope, initial, onDeleted, topLevel }: { scope: NoteScope; initial: Note; onDeleted?: () => void; topLevel: boolean }) {
  const router = useRouter();
  const [delegating, setDelegating] = useState(false);
  const memory = initial.id === MEMORY_NOTE_ID;
  const [note, setNote] = useState(initial);
  const [title, setTitle] = useState(shownTitle(initial.title));
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Note | null>(null);
  const [broken, setBroken] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  /** Body as last written by us or loaded from disk: lets us ignore our own watcher echoes. */
  const known = useRef(new Set([initial.markdown]));
  const dirty = useRef(false);
  const titleRef = useRef(shownTitle(initial.title));
  const titleInput = useRef<HTMLInputElement>(null);
  const version = useRef(initial.updatedAt);
  const savedTitle = useRef(initial.title);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const editor = editorRef.current;
    if (!editor || !dirty.current) return;
    const markdown = docToMarkdown(editor);
    const body = { markdown, expectedUpdatedAt: version.current, ...(!memory && storedTitle(titleRef.current) !== savedTitle.current ? { title: storedTitle(titleRef.current) } : {}) };
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

  const extensions = useMemo(() => [...editorExtensions({ placeholder: memory ? "Nothing remembered yet" : "Start writing…" }), ...(memory ? [MemoryHeading] : [])], [memory]);
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

  // A brand-new note: start in the title.
  useEffect(() => {
    if (!memory && initial.title === UNTITLED && !initial.markdown.trim()) titleInput.current?.focus();
  }, [memory, initial.title, initial.markdown]);

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
  const rev = useNotesFeed((s) => s.resetRev + (s.noteRev[`${scopeKey(scope)}/${initial.id}`] ?? 0) + (s.noteRev[`${scopeKey(scope)}/*`] ?? 0));
  // The editor mounts with a fresh note; refetch only when the revision moves after that.
  const mountRev = useRef(rev);
  useEffect(() => {
    if (rev === mountRev.current) return;
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
          setTitle(shownTitle(fresh.title));
          titleRef.current = shownTitle(fresh.title);
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
    setTitle(shownTitle(conflict.title));
    titleRef.current = shownTitle(conflict.title);
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
    const before = note;
    setNote((n) => ({ ...n, ...flags }));
    try {
      const r = await api.patchNote(scope.kind, scope.id, initial.id, flags);
      known.current.add(r.note.markdown);
      version.current = r.note.updatedAt;
      savedTitle.current = r.note.title;
      setNote(r.note);
      useNotesFeed.getState().touch(scope);
    } catch (err) {
      setNote(before);
      toast.error("Couldn't update the note", { description: (err as Error).message });
    }
  };

  const paths = usePaths(), addToCanvas = useAddToCanvas();
  // Project and workspace notes go to their project's canvas; repo notebooks have no single project here.
  const canvasProject = scope.kind === "projects" ? scope.id : scope.kind === "workspaces" ? paths.projectOf(scope.id) : null;
  const toCanvas = canvasProject ? () => {
    const editor = editorRef.current;
    void addToCanvas(canvasProject, { title: storedTitle(titleRef.current) || note.title, markdown: editor ? docToMarkdown(editor) : note.markdown, from: "the note", href: `/notes?scope=${scopeKey(scope)}&note=${encodeURIComponent(initial.id)}` });
  } : undefined;
  const remove = async () => {
    if (!(await confirm(note.source === "repo"
      ? { title: `Delete ${note.path}?`, description: "This removes the file from the working tree.", action: "Delete", destructive: true }
      : { title: `Delete “${note.title}”?`, description: "This removes the file from disk.", action: "Delete", destructive: true }))) return;
    if (timer.current) clearTimeout(timer.current);
    const wasDirty = dirty.current;
    dirty.current = false;
    try {
      await api.deleteNote(scope.kind, scope.id, initial.id);
    } catch (err) {
      dirty.current = wasDirty;
      toast.error("Couldn't delete the note", { description: (err as Error).message });
      return;
    }
    useNotesFeed.getState().touch(scope);
    onDeleted?.();
  };

  const delegate = async () => {
    // Save first so the agent reads what's on screen.
    await flush();
    if (dirty.current) return;
    const open = extractTasks(editorRef.current ? docToMarkdown(editorRef.current) : note.markdown).filter((t) => !t.done);
    const ok = await confirm({
      title: `Relay ${open.length} item${open.length === 1 ? "" : "s"}?`,
      description: (
        <>
          <span className="block">
            {topLevel ? "Thunk proposes which project gets each item; nothing starts until you approve the plan in the Inbox." : "The project's chief splits each item into its own task. You'll go to its session."}
          </span>
          <span className="mt-2 block max-h-40 overflow-y-auto">
            {open.slice(0, 12).map((t) => <span key={t.line} className="block truncate">• {t.text}</span>)}
            {open.length > 12 && <span className="block">…and {open.length - 12} more</span>}
          </span>
        </>
      ),
      action: "Relay",
    });
    if (!ok) return;
    setDelegating(true);
    try {
      const r = await api.delegateNote(scope, note.id);
      // Top-level notes stay put: the relay plan arrives in the inbox.
      if (r.top) toast.success(`Relayed ${r.open} item${r.open === 1 ? "" : "s"}`, { description: "Approve the relay plan in your Inbox. Lines are marked as they are routed and settled." });
      else { router.push(r.href); router.refresh(); }
    } catch (err) {
      toast.error("Couldn't relay this note", { description: (err as Error).message });
    } finally {
      setDelegating(false);
    }
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
      <NoteMetaBar
        note={note}
        onChange={patchFlags}
        onDelete={memory ? undefined : remove}
        onAddToCanvas={toCanvas}
        onDelegate={memory ? undefined : () => void delegate()}
        delegating={delegating}
        blocked={Boolean(conflict) || broken}
        topLevel={topLevel}
      />
      {!memory && (
        <div className="px-4 empty:hidden">
          <OnboardingHint name="relay-note">
            {topLevel
              ? <>Notes here belong to no project. Write the work as unchecked <code>- [ ]</code> items, then choose <strong>Relay</strong>: Thunk proposes which project gets each item, and nothing starts until you approve the plan in your Inbox. Add <code>#project</code> to a line to pin it.</>
              : <>A note can be a brief. Write the work as unchecked <code>- [ ]</code> items, then choose <strong>Relay</strong>: the project&apos;s chief turns each item into a task and starts a worker for it in its own worktree. Reports come back to your Inbox.</>}
          </OnboardingHint>
        </div>
      )}
      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs">
          <span className="flex-1">This note changed on disk while you were editing (an agent may have updated it).</span>
          <Button size="xs" variant="outline" onClick={takeTheirs}>Load their version</Button>
          <Button size="xs" variant="ghost" onClick={keepMine}>Keep mine</Button>
        </div>
      )}
      {!memory && <NoteSessions path={note.path} version={note.updatedAt} />}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        {!memory && (
          <input
            ref={titleInput}
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
            placeholder={UNTITLED}
            aria-label="Note title"
            className="placeholder:text-muted-foreground mb-3 w-full bg-transparent text-2xl font-bold tracking-tight outline-none"
          />
        )}
        <div className="doc-prose">
          <EditorContent editor={editor} />
        </div>
      </div>
      <footer className="text-muted-foreground flex shrink-0 items-center gap-2 border-t px-4 py-1.5 text-[11px]">
        <span aria-live="polite" className={save === "error" ? "text-destructive" : undefined}>
          {save === "saving" ? "Saving…" : save === "dirty" ? "Editing…" : save === "error" ? `Couldn't save: ${saveError}` : `Edited ${relativeTime(note.updatedAt)}${note.editedOutside ? " by an agent" : ""}`}
        </span>
      </footer>
    </div>
  );
}
