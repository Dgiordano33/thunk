"use client";

import { Loader2Icon, SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { SessionMeta } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { scopeKey, type NoteScope, type NoteTask } from "@/lib/notes/types";
import { useNotesEvents, useNotesFeed } from "@/lib/store/notes-store";

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/** The message a task batch becomes. The path lets the agent tick items off itself. */
export function taskMessage(noteTitle: string, notePath: string, tasks: string[]) {
  return [
    `From note "${noteTitle}" (\`${notePath}\`):`,
    ...tasks.map((t) => `- ${t}`),
    "",
    "When an item is done, tick it (`- [x]`) in that note file.",
  ].join("\n");
}

type ScopedTask = NoteTask & { scope: NoteScope };

/**
 * Open `- [ ]` items from actionable notes, grouped by note. Ticking edits the file;
 * "Send" posts the items as a message to a live session in the workspace, or a new chat.
 */
export function NoteTasks({ scopes, workspaceId }: { scopes: NoteScope[]; workspaceId: string }) {
  useNotesEvents();
  const router = useRouter();
  const keys = scopes.map(scopeKey).join("|");
  const rev = useNotesFeed((s) => keys.split("|").reduce((n, k) => n + (s.scopeRev[k] ?? 0), 0));
  const [tasks, setTasks] = useState<ScopedTask[] | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(scopes.map((s) => api.noteTasks(s.kind, s.id).then((r) => r.tasks.map((t) => ({ ...t, scope: s })))))
      .then((all) => !cancelled && setTasks(all.flat()))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `keys` identifies the scopes.
  }, [keys, rev]);

  useEffect(() => {
    api.listSessions({ workspaceId }).then((r) => setSessions(r.sessions.filter((s) => s.live))).catch(() => setSessions([]));
  }, [workspaceId]);

  const groups = useMemo(() => {
    const by = new Map<string, ScopedTask[]>();
    for (const t of tasks ?? []) {
      const k = `${scopeKey(t.scope)}/${t.noteId}`;
      by.set(k, [...(by.get(k) ?? []), t]);
    }
    return [...by.entries()];
  }, [tasks]);

  const tick = async (t: ScopedTask) => {
    setBusy(`${t.noteId}:${t.line}`);
    try {
      await api.patchNote(t.scope.kind, t.scope.id, t.noteId, { task: { line: t.line, text: t.text, done: true } });
      setTasks((all) => all?.filter((x) => x !== t) ?? null);
      useNotesFeed.getState().touch(t.scope);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async (key: string, items: ScopedTask[], sessionId: string | null) => {
    const content = taskMessage(items[0].noteTitle, items[0].notePath, items.map((t) => t.text));
    setBusy(key);
    setError(null);
    try {
      if (sessionId) {
        await api.send(sessionId, content);
        router.push(`/w/${workspaceId}/s/${sessionId}`);
      } else {
        const { id } = await api.createSession({ workspaceId, prompt: content });
        router.push(`/w/${workspaceId}/s/${id}`);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (tasks === null && !error)
    return (
      <div className="text-muted-foreground flex justify-center p-4">
        <Loader2Icon className="size-4 animate-spin" />
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No open tasks. Turn on <span className="font-medium">Actionable</span> for a note and its unchecked <code className="font-mono">- [ ]</code> items show up here.
        </p>
      ) : (
        groups.map(([key, items]) => (
          <section key={key} className="bg-background rounded-lg border">
            <header className="flex items-center gap-2 border-b px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium" title={tildify(items[0].notePath)}>{items[0].noteTitle}</span>
              <SendMenu disabled={busy === key} sessions={sessions} onPick={(sid) => void send(key, items, sid)} label={`Send ${items.length}`} />
            </header>
            <ul className="flex flex-col py-1">
              {items.map((t) => (
                <li key={t.line} className="group flex items-start gap-2 px-3 py-1 text-[13px]">
                  <input
                    type="checkbox"
                    aria-label={`Mark "${t.text}" done`}
                    className="accent-primary mt-1 size-3.5 shrink-0 cursor-pointer"
                    disabled={busy === `${t.noteId}:${t.line}`}
                    onChange={() => void tick(t)}
                  />
                  <span className="min-w-0 flex-1">{t.text}</span>
                  <SendMenu compact disabled={busy === key} sessions={sessions} onPick={(sid) => void send(key, [t], sid)} label="Send" />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function SendMenu({
  sessions,
  onPick,
  label,
  compact,
  disabled,
}: {
  sessions: SessionMeta[];
  onPick: (sessionId: string | null) => void;
  label: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button size="icon-xs" variant="ghost" disabled={disabled} aria-label="Send to session" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
            <SendIcon />
          </Button>
        ) : (
          <Button size="xs" variant="outline" disabled={disabled}>
            {disabled ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {label}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs">Send to session</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onPick(null)}>New chat</DropdownMenuItem>
        {sessions.length > 0 && <DropdownMenuSeparator />}
        {sessions.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => onPick(s.id)}>
            <span className="truncate">{s.title || "Untitled session"}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
