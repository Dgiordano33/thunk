"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { api } from "@/lib/client/api";
import { scopeKey, type NoteEvent, type NoteMeta, type NoteScope } from "@/lib/notes/types";

/**
 * Revision counters bumped by the notes SSE feed (UI saves and agent edits alike).
 * Components key their fetches on these instead of polling.
 */
export const useNotesFeed = create<{
  scopeRev: Record<string, number>;
  noteRev: Record<string, number>;
  /** Any change anywhere, for global counts. */
  rev: number;
  apply: (e: NoteEvent) => void;
  /** Local writes bump immediately so other views refresh without waiting on the watcher. */
  touch: (scope: NoteScope) => void;
}>((set) => ({
  scopeRev: {},
  noteRev: {},
  rev: 0,
  apply: (e) => {
    const k = scopeKey(e.scope);
    set((s) => ({
      rev: s.rev + 1,
      scopeRev: { ...s.scopeRev, [k]: (s.scopeRev[k] ?? 0) + 1 },
      noteRev: { ...s.noteRev, [`${k}/${e.noteId}`]: (s.noteRev[`${k}/${e.noteId}`] ?? 0) + 1 },
    }));
  },
  touch: (scope) => {
    const k = scopeKey(scope);
    set((s) => ({ rev: s.rev + 1, scopeRev: { ...s.scopeRev, [k]: (s.scopeRev[k] ?? 0) + 1 } }));
  },
}));

let source: EventSource | null = null;
let refs = 0;

/** Keep one EventSource open while any notes view is mounted. */
export function useNotesEvents() {
  useEffect(() => {
    refs++;
    if (!source) {
      source = new EventSource("/api/notes/events");
      source.onmessage = (m) => {
        try {
          useNotesFeed.getState().apply(JSON.parse(m.data) as NoteEvent);
        } catch (err) {
          console.error("[thunk] bad note event", err);
        }
      };
    }
    return () => {
      refs--;
      if (refs === 0) {
        source?.close();
        source = null;
      }
    };
  }, []);
}

type ScopeSnapshot = { key: string; notes: NoteMeta[]; dir: string; error: string | null };
// Metadata only; editable note bodies still load fresh for conflict-safe editing.
const scopeSnapshots = new Map<string, ScopeSnapshot>();

/** A scope's notes (memory first), refetched whenever the feed reports a change in it. */
export function useScopeNotes(scope: NoteScope | null) {
  useNotesEvents();
  const key = scope ? scopeKey(scope) : "";
  const rev = useNotesFeed((s) => scope?.kind === "workspaces" ? s.rev : s.scopeRev[key] ?? 0);
  const [state, setState] = useState<ScopeSnapshot | null>(() => scopeSnapshots.get(key) ?? null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    api
      .listNotes(scope.kind, scope.id)
      .then((r) => {
        if (cancelled) return;
        const snapshot = { key, notes: r.notes, dir: r.dir, error: null };
        scopeSnapshots.delete(key);
        scopeSnapshots.set(key, snapshot);
        if (scopeSnapshots.size > 30) scopeSnapshots.delete(scopeSnapshots.keys().next().value!);
        setState(snapshot);
      })
      .catch((err: Error) => !cancelled && setState((s) => ({ key, notes: s?.key === key ? s.notes : [], dir: "", error: err.message })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the scope.
  }, [key, rev, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const current = state?.key === key ? state : scopeSnapshots.get(key) ?? null;
  return { notes: current?.notes ?? null, dir: current?.dir ?? "", error: current?.error ?? null, reload };
}
