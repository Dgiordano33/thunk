"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PromptBox } from "@/components/chat/prompt-box";
import { Timeline } from "@/components/chat/timeline";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { connectSession } from "@/lib/client/sse";
import { useDocumentPersistence } from "@/lib/client/use-document-persistence";
import type { PersistedDocument } from "@/lib/documents/types";
import { useSession } from "@/lib/store/session-store";
import { useUi } from "@/lib/store/ui-store";
import { SessionHeader } from "./session-header";

export function SessionView({
  meta,
  events,
  documents,
}: {
  meta: SessionMeta;
  events: HarnessEvent[];
  documents: PersistedDocument[];
}) {
  const ready = useSession((s) => s.sessionId === meta.id);
  const live = useSession((s) => s.sessionId === meta.id && Boolean(s.meta?.live));
  const connRef = useRef<ReturnType<typeof connectSession> | null>(null);
  // Bumped on resume: a terminated session is replaced server-side, so the stream must reconnect.
  const [connKey, setConnKey] = useState(0);

  useLayoutEffect(() => {
    useSession.getState().hydrate({ meta, events, documents });
    // Hydrate once per session; later server props are stale relative to the live stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  useDocumentPersistence();

  useEffect(() => {
    if (!ready || !live) return;
    const store = useSession.getState();
    let pending: HarnessEvent[] = [];
    let frame: number | undefined;
    const flush = () => {
      frame = undefined;
      useSession.getState().applyEvents(pending);
      pending = [];
    };
    const conn = connectSession(meta.id, {
      getLastSeq: () => useSession.getState().lastSeq,
      onEvent: (e) => {
        pending.push(e);
        if (frame === undefined) frame = requestAnimationFrame(flush);
      },
      onState: (c) => {
        store.setConnection(c);
        if (c === "not_live") store.setMeta({ live: false });
      },
    });
    connRef.current = conn;
    return () => {
      conn.close();
      if (frame !== undefined) cancelAnimationFrame(frame);
      flush();
      connRef.current = null;
    };
  }, [ready, live, meta.id, connKey]);

  // Deep link from the workspace Artifacts list: /w/…/s/…#doc-<id>.
  useEffect(() => {
    if (!ready) return;
    const id = window.location.hash.match(/^#doc-(.+)$/)?.[1];
    if (!id) return;
    useSession.getState().setActiveDocument(id);
    requestAnimationFrame(() => document.getElementById(`doc-${id}`)?.scrollIntoView({ block: "start" }));
  }, [ready]);

  // Starting or selecting a comment brings the comments panel up.
  const composing = useSession((s) => s.composingCommentId);
  const activeComment = useSession((s) => s.activeCommentId);
  useEffect(() => {
    if (composing || activeComment) useUi.getState().setCommentsOpen(true);
  }, [composing, activeComment]);

  const resume = useCallback(async () => {
    await api.resume(meta.id);
    useSession.getState().setMeta({ live: true });
    setConnKey((k) => k + 1);
  }, [meta.id]);

  // Esc interrupts a running turn (unless a dialog/menu or the editor wants it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[role=dialog],[role=menu],[role=listbox],.ProseMirror,textarea,input")) return;
      const s = useSession.getState();
      if (s.meta?.live && (s.status === "running" || s.status === "awaiting"))
        void api.control(meta.id, { action: "interrupt" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meta.id]);

  return (
    <div className="flex h-full flex-col">
      {ready && (
        <>
          <SessionHeader onResume={resume} />
          <Timeline />
          <PromptBox />
        </>
      )}
    </div>
  );
}
