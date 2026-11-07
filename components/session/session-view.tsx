"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PromptBox } from "@/components/chat/prompt-box";
import { Timeline } from "@/components/chat/timeline";
import { RightPanel } from "@/components/layout/right-panel";
import { Sidebar } from "@/components/layout/sidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { HarnessEvent, SessionMeta } from "@/lib/agent/types";
import { api } from "@/lib/client/api";
import { connectSession } from "@/lib/client/sse";
import { useDocumentPersistence } from "@/lib/client/use-document-persistence";
import type { PersistedDocument } from "@/lib/documents/types";
import type { Project, Workspace } from "@/lib/projects/types";
import { useSession } from "@/lib/store/session-store";
import { SessionHeader } from "./session-header";

export function SessionView({
  meta,
  events,
  documents,
  sessions,
  project,
  workspace,
}: {
  meta: SessionMeta;
  events: HarnessEvent[];
  documents: PersistedDocument[];
  sessions: SessionMeta[];
  project: Project | null;
  workspace: Workspace | null;
}) {
  const ready = useSession((s) => s.sessionId === meta.id);
  const live = useSession((s) => s.sessionId === meta.id && Boolean(s.meta?.live));
  const connRef = useRef<ReturnType<typeof connectSession> | null>(null);
  // Bumped on resume: a terminated session is replaced server-side, so the stream must reconnect.
  const [connKey, setConnKey] = useState(0);

  useEffect(() => {
    useSession.getState().hydrate({ meta, events, documents });
    // Hydrate once per session; later server props are stale relative to the live stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  useDocumentPersistence();

  useEffect(() => {
    if (!ready || !live) return;
    const store = useSession.getState();
    const conn = connectSession(meta.id, {
      getLastSeq: () => useSession.getState().lastSeq,
      onEvent: (e) => useSession.getState().applyEvent(e),
      onState: (c) => {
        store.setConnection(c);
        if (c === "not_live") store.setMeta({ live: false });
      },
    });
    connRef.current = conn;
    return () => {
      conn.close();
      connRef.current = null;
    };
  }, [ready, live, meta.id, connKey]);

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
    <ResizablePanelGroup orientation="horizontal" className="h-dvh">
      <ResizablePanel defaultSize="17" minSize="12" maxSize="30">
        {ready && <Sidebar sessions={sessions} project={project} workspace={workspace} />}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="57" minSize="35">
        <div className="flex h-full flex-col">
          {ready && (
            <>
              <SessionHeader onResume={resume} />
              <Timeline />
              <PromptBox />
            </>
          )}
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="26" minSize="18" maxSize="40">
        <div className="bg-sidebar/40 h-full">{ready && <RightPanel />}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
