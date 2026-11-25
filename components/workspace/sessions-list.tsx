"use client";
import { sessionStatus, sessionDot } from "@/components/session/labels";

import { WORLD_SELECTION } from "@/components/world/selection";

import { CopyIcon, ChevronRightIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { useState } from "react";
import { MODE_LABELS, modelLabel, relativeTime } from "@/components/session/labels";
import { providerOf, type SessionMeta } from "@/lib/agent/types";
import { PixelIcon } from "@/components/world/pixel-icon";
import { useModels } from "@/lib/client/use-models";
import { useSession } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";
import { useWorkspaceBase } from "./route-context";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CONNECTION_LABELS } from "@/components/session/labels";
import { Hint } from "@/components/hint";

/** Every session in the workspace; the expanded card shows that session's details (live for the open one). */
export function SessionsList({ sessions }: { sessions: SessionMeta[] }) {
  const models = useModels();
  const base = useWorkspaceBase();
  const meta = useSession((s) => s.meta);
  const status = useSession((s) => s.status);
  const [expanded, setExpanded] = useState<string | null>(null);
  const open = expanded;

  if (sessions.length === 0) return <Empty className="py-6 gap-2"><EmptyDescription className="text-xs">No sessions yet. Choose New chat to start a conversation.</EmptyDescription></Empty>;

  return (
    <ul className="flex flex-col gap-1.5 p-2">
      {sessions.map((s) => {
        const current = s.id === meta?.id;
        const session = current && meta ? meta : s;
        const live = current ? meta?.live : s.live;
        const state = { ...s, ...(current ? meta : {}), live: Boolean(live), status: current ? status : s.status };
        const isOpen = open === s.id;
        return (
          <li key={s.id} className={cn("bg-background rounded-lg border transition-colors", isOpen && WORLD_SELECTION)}>
            <div className="flex items-center pr-2">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setExpanded(isOpen ? null : s.id)}
              className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
            >
              <span role="img" aria-label={sessionStatus(state)} title={sessionStatus(state)}
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  sessionDot(state),
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  {s.origin?.kind === "chief" && session.title?.toLowerCase() !== "chief" && <span className="text-muted-foreground text-[10px]">Chief</span>}
                  {s.origin?.kind === "top_chief" && session.title?.toLowerCase() !== "top chief" && <span className="text-muted-foreground text-[10px]">Top chief</span>}
                  {s.origin?.kind === "worker" && session.title?.toLowerCase() !== "worker" && <span className="text-muted-foreground text-[10px]">Worker</span>}
                  {s.origin?.kind === "routine" && (
                    <Hint label={`Started by the routine ${s.origin.routineName}`}>
                      <span role="img" aria-label={`Started by the routine ${s.origin.routineName}`} className="shrink-0">
                        <PixelIcon name="hourglass" className="size-3.5" />
                      </span>
                    </Hint>
                  )}
                  <span className="block truncate text-[13px] font-medium">{session.title || "Untitled session"}</span>
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {modelLabel(session.model, models)} · {MODE_LABELS[session.permissionMode] ?? session.permissionMode}
                  {` · ${sessionStatus(state)}`}
                  <span className="block" title={session.updatedAt ?? s.updatedAt ?? s.createdAt}>{session.updatedAt || s.updatedAt ? "Active" : "Created"} {relativeTime(session.updatedAt ?? s.updatedAt ?? s.createdAt)}</span>
                </span>
              </span>
              <ChevronRightIcon className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
            </button>
            {!current && <Link href={`${base}/${s.id}`} aria-label={`Open ${session.title || "session"}`} className="text-primary shrink-0 rounded px-2 py-1 text-xs hover:underline">Open</Link>}
            </div>
            {isOpen && (
              <div className="border-t px-3 pt-2 pb-3">
                {current ? <LiveSessionInfo /> : <SessionInfoRows session={s} />}
                {!current && (
                  <Link href={`${base}/${s.id}`} className="text-primary mt-2 inline-block text-xs hover:underline">
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

function SessionInfoRows({ session, extra = [], neverRun = !session.sdkSessionId }: { session: SessionMeta; extra?: [string, string][]; neverRun?: boolean }) {
  const rows: [string, string][] = [
    ["Directory", session.cwd],
    ["SDK session", session.sdkSessionId ?? "—"],
    ["Thunk session", session.id],
  ];
  return <div className="space-y-3">
    <section aria-label="Usage">
      <h3 className="mb-1.5 text-xs font-medium">Usage</h3>
      {extra.length ? <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">{extra.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}</dl> : <p className="text-muted-foreground text-xs">{neverRun ? "Never run" : "Open this session to view usage."}</p>}
    </section>
    <section aria-label="Details">
      <h3 className="mb-1.5 text-xs font-medium">Details</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
        {rows.map(([k, v]) => <div key={k} className="contents">
          <dt className="text-muted-foreground pt-1">{k}</dt>
          <dd className="flex min-w-0 items-start gap-1"><span className="min-w-0 flex-1 break-all pt-1 font-mono">{v}</span>{v !== "—" && <Button type="button" size="icon-xs" variant="ghost" aria-label={`Copy ${k}`} onClick={async () => {
            try { await navigator.clipboard.writeText(v); toast.success(`${k} copied`); } catch { toast.error(`Could not copy ${k}`); }
          }}><CopyIcon className="size-3" /></Button>}</dd>
        </div>)}
      </dl>
    </section>
  </div>;
}

function LiveSessionInfo() {
  const meta = useSession((s) => s.meta);
  const costUsd = useSession((s) => s.costUsd);
  const numTurns = useSession((s) => s.numTurns);
  const connection = useSession((s) => s.connection);
  const hasTurns = useSession((s) => s.items.some((item) => item.kind === "turn" || item.kind === "user"));
  const docCount = useSession((s) => Object.keys(s.documents).length);
  if (!meta) return null;
  return (
    <SessionInfoRows
      session={meta}
      neverRun={!hasTurns}
      extra={hasTurns ? [
        ...(meta.live ? [["Connection", CONNECTION_LABELS[connection]] as [string, string]] : []),
        // Codex reports tokens, not dollars.
        ["Cost", providerOf(meta.model) === "codex" ? "Not reported" : `$${costUsd.toFixed(4)}`],
        ["API turns", String(numTurns)],
        ["Documents", String(docCount)],
      ] : []}
    />
  );
}
