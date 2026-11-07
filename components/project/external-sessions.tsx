"use client";

import { ImportIcon, Loader2Icon, TerminalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { relativeTime, workspaceLabel } from "@/components/session/labels";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { ExternalSession } from "@/lib/projects";
import type { Workspace } from "@/lib/projects/types";

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/**
 * Claude Code sessions found on disk for this project (terminal, Conductor, desktop).
 * Importing resumes the transcript inside a Thunk workspace: the one whose cwd matches, else main.
 */
export function ExternalSessions({ sessions, workspaces }: { sessions: ExternalSession[]; workspaces: Workspace[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (sessions.length === 0) return null;

  const targetFor = (s: ExternalSession) =>
    workspaces.find((w) => s.cwd && w.cwd === s.cwd) ?? workspaces.find((w) => w.slug === "main") ?? workspaces[0];

  const importSession = async (s: ExternalSession) => {
    const ws = targetFor(s);
    if (!ws) return;
    setBusy(s.sdkSessionId);
    setError(null);
    try {
      const { id } = await api.createSession({
        workspaceId: ws.id,
        resumeSdkSessionId: s.sdkSessionId,
        title: s.title.slice(0, 120),
      });
      router.push(`/w/${ws.id}/s/${id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <section>
      <h2 className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
        <TerminalIcon className="size-3.5" />
        Other Claude Code sessions
      </h2>
      <p className="text-muted-foreground mb-3 text-xs">
        Transcripts on this machine for this repo and its worktrees. Import one to keep going here; earlier messages
        stay in the transcript but won&apos;t render in the timeline.
      </p>
      <ul className="flex flex-col gap-0.5">
        {sessions.map((s) => {
          const ws = targetFor(s);
          return (
            <li key={s.sdkSessionId} className="hover:bg-muted flex items-center gap-3 rounded-md px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{s.title}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {s.gitBranch && <span className="font-mono">{s.gitBranch} · </span>}
                  {s.cwd && <span className="font-mono">{home(s.cwd)} · </span>}
                  {relativeTime(s.lastModified)}
                  {ws && <span> · into {workspaceLabel(ws)}</span>}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                disabled={busy !== null || !ws}
                onClick={() => importSession(s)}
              >
                {busy === s.sdkSessionId ? <Loader2Icon className="animate-spin" /> : <ImportIcon />}
                Import
              </Button>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-destructive mt-2 text-xs">{error}</p>}
    </section>
  );
}
