"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CardStats } from "@/components/space/card";
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
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return <div className="flex flex-col gap-3 text-xs">
    <p className="text-muted-foreground">{team?.summary || (team && !team.chief ? "The chief coordinates this project. Tell it what you want, or choose Relay on a note, and it splits the work into tasks, starts a worker for each in its own worktree, and reports back. It does not edit code, and nothing merges without you." : "Delegate project work to agents in their own worktrees.")}</p>
    {team && <CardStats
      className="mt-0"
      rows={[
        ["Status", team.chief ? <span className="capitalize">{team.chief.status}</span> : "Not started"],
        ["Running", team.running],
        ["Waiting", team.waiting],
        ...(team.queued ? [["Queued", team.queued] as [string, React.ReactNode]] : []),
        ["Done today", team.done],
        ["Chief spend", usd(team.costUsd)],
        ["Worker spend today", usd(team.workerCostUsdToday)],
      ]}
    />}
    <div className="flex gap-2">
      <Button size="sm" disabled={busy} onClick={() => void open()}>Open the chief</Button>
      {team?.chief && <Button size="sm" variant="outline" disabled={busy} onClick={() => void open(true)}>New chief</Button>}
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
