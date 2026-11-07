"use client";

import { useEffect } from "react";
import { useSession, type DocState } from "@/lib/store/session-store";
import { api } from "./api";

const DOC_DEBOUNCE_MS = 800;
const COMMENT_DEBOUNCE_MS = 500;

function saveDocument(id: string) {
  const d = useSession.getState().documents[id];
  if (!d) return;
  api
    .patchDocument(id, {
      currentMarkdown: d.currentMarkdown,
      baselineMarkdown: d.baselineMarkdown ?? undefined,
      contentJson: d.contentJson ?? undefined,
    })
    .catch((err) => console.warn("[thunk] save document failed", err));
}

function saveComments(id: string) {
  const d = useSession.getState().documents[id];
  if (!d) return;
  api
    .syncComments(
      id,
      d.comments.filter((c) => c.body.trim()),
    )
    .catch((err) => console.warn("[thunk] save comments failed", err));
}

/** Mirror local document edits and comment threads to the server (debounced per document). */
export function useDocumentPersistence() {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    // Pending writes by key, so unmount (navigation) flushes instead of dropping edits.
    const pending = new Map<string, () => void>();

    const schedule = (key: string, ms: number, fn: () => void) => {
      clearTimeout(timers.get(key));
      pending.set(key, fn);
      timers.set(
        key,
        setTimeout(() => {
          pending.delete(key);
          fn();
        }, ms),
      );
    };

    const unsub = useSession.subscribe((state, prev) => {
      if (state.documents === prev.documents || state.sessionId !== prev.sessionId) return;
      for (const [id, doc] of Object.entries(state.documents)) {
        const before: DocState | undefined = prev.documents[id];
        if (!before || doc === before) continue;
        if (
          doc.currentMarkdown !== before.currentMarkdown ||
          doc.contentJson !== before.contentJson ||
          doc.baselineMarkdown !== before.baselineMarkdown
        ) {
          schedule(`doc:${id}`, DOC_DEBOUNCE_MS, () => saveDocument(id));
        }
        if (doc.comments !== before.comments) {
          schedule(`comments:${id}`, COMMENT_DEBOUNCE_MS, () => saveComments(id));
        }
      }
    });

    return () => {
      unsub();
      timers.forEach(clearTimeout);
      pending.forEach((fn) => fn());
    };
  }, []);
}
