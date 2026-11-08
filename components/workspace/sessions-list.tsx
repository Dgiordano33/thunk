"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MODE_LABELS, modelLabel, relativeTime } from "@/components/session/labels";
import { providerOf, type SessionMeta } from "@/lib/agent/types";
import { PixelIcon } from "@/components/world/pixel-icon";
import { useModels } from "@/lib/client/use-models";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

/** Every session in the workspace; the expanded card shows that session's details (live for the open one). */
export function SessionsList({ workspaceId, sessions }: { workspaceId: string; sessions: SessionMeta[] }) {
  const models = useModels();
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const [expanded, setExpanded] = useState<string | null>(null);
  const open = expanded ?? meta?.id ?? null;

  if (sessions.length === 0) return <p className="text-muted-foreground px-4 py-6 text-center text-xs">No sessions yet.</p>;

  return (
    <ul className="flex flex-col gap-1.5 p-2">
      {sessions.map((s) => {
        const current = s.id === meta?.id;
        const session = current && meta ? meta : s;
        const live = current ? meta?.live : s.live;
        const busy = current && (status === "running" || status === "awaiting");
        const isOpen = open === s.id;
        return (
          <li key={s.id} className={cn("bg-background rounded-lg border transition-colors", isOpen && "border-foreground/20")}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setExpanded(isOpen ? "" : s.id)}
              className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  busy ? "animate-pulse bg-amber-500" : live ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  {s.origin?.kind === "routine" && (
                    <span title={`Started by the routine ${s.origin.routineName}`} className="shrink-0">
                      <PixelIcon name="hourglass" className="size-3.5" />
                    </span>
                  )}
                  <span className="block truncate text-[13px] font-medium">{session.title || "Untitled session"}</span>
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {modelLabel(session.model, models)} · {MODE_LABELS[session.permissionMode] ?? session.permissionMode}
                  {s.createdAt && ` · ${relativeTime(s.createdAt)}`}
                </span>
              </span>
              <ChevronRightIcon className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
            </button>
            {isOpen && (
              <div className="border-t px-3 pt-2 pb-3">
                {current ? <LiveSessionInfo /> : <SessionInfoRows session={s} />}
                {!current && (
                  <Link href={`/w/${workspaceId}/s/${s.id}`} className="text-primary mt-2 inline-block text-xs hover:underline">
                    Open session
                  </Link>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SessionInfoRows({ session, extra = [] }: { session: SessionMeta; extra?: [string, string][] }) {
  const models = useModels();
  const rows: [string, string][] = [
    ["Model", modelLabel(session.model, models)],
    ["Mode", MODE_LABELS[session.permissionMode] ?? session.permissionMode],
    ["Status", session.live ? session.status : "not live"],
    ...extra,
    ["Directory", session.cwd],
    ["SDK session", session.sdkSessionId ?? "—"],
    ["Thunk session", session.id],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function LiveSessionInfo() {
  const meta = useSession((s) => s.meta);
  const costUsd = useSession((s) => s.costUsd);
  const numTurns = useSession((s) => s.numTurns);
  const connection = useSession((s) => s.connection);
  const docCount = useSession((s) => Object.keys(s.documents).length);
  if (!meta) return null;
  return (
    <SessionInfoRows
      session={meta}
      extra={[
        ["Connection", connection],
        // Codex reports tokens, not dollars.
        ["Cost", providerOf(meta.model) === "codex" ? "Not reported" : `$${costUsd.toFixed(4)}`],
        ["API turns", String(numTurns)],
        ["Documents", String(docCount)],
      ]}
    />
  );
}
