"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { SessionMeta } from "@/lib/agent/types";

export function ChiefPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<{ chief: SessionMeta | null; summary: string | null; costUsd: number; running: number; waiting: number; done: number; queued: number; workerCostUsdToday: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/chief`);
        if (!response.ok) throw new Error("Could not load team status");
        const next = await response.json();
        if (alive) { setTeam(next); setError(null); }
      } catch (err) { if (alive) setError((err as Error).message); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [projectId]);
  const open = async (fresh = false) => {
    setBusy(true); setError(null);
    try {
      const result = await api.openChief(projectId, { fresh });
      router.push(result.href); router.refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2 text-xs">
    <p className="text-muted-foreground">{team?.summary || (team?.chief ? `Chief · ${team.chief.status}` : "Delegate project work to agents in their own worktrees.")}</p>
    {team && <p>{team.running} running · {team.waiting} waiting{team.queued ? ` · ${team.queued} queued` : ""} · {team.done} done today · Chief ${team.costUsd.toFixed(2)} · Workers ${team.workerCostUsdToday.toFixed(2)} today</p>}
    <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void open()}>Open the chief</Button>{team?.chief && <Button size="sm" variant="outline" disabled={busy} onClick={() => void open(true)}>New chief</Button>}</div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
