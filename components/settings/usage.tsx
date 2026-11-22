"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePaths } from "@/components/layout/paths-context";
import type { UsageSummary } from "@/lib/ambient/types";

export type UsageProject = { id: string; name: string; workspaces: { id: string; name: string }[] };

const usd = (cost: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(cost);

export function UsageSettings({ projects }: { projects: UsageProject[] }) {
  const paths = usePaths();
  const [usage, setUsage] = useState<(UsageSummary & { persistent: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/ambient/usage?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Request failed");
        if (!controller.signal.aborted) { setUsage(data); setError(null); }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Usage unavailable");
      }
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-xs">Agent-reported cost estimates, in USD. Subscription billing and Max plan limits are unavailable.</p>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      {!usage && !error && <p role="status" className="text-sm">Loading usage…</p>}
      {usage && <>
        <div>
          <p className="text-muted-foreground text-xs">Recorded total</p>
          <p className="text-3xl font-semibold tabular-nums">{usd(usage.total)}</p>
          {!usage.persistent && <p className="text-muted-foreground mt-1 text-xs">Memory mode: retained events from this server run only.</p>}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 text-sm font-medium">By day · your time zone</h3>
            <div className="rounded-lg border bg-background/60 px-4 py-2">
              {usage.days.length ? <table className="w-full text-xs"><tbody>{usage.days.map((d) => <tr key={d.name} className="border-b last:border-b-0"><th scope="row" className="py-1.5 text-left font-normal">{d.name}</th><td className="text-right tabular-nums">{usd(d.cost)}</td></tr>)}</tbody></table>
                : <p className="text-muted-foreground py-1.5 text-xs">No reported usage yet.</p>}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-sm font-medium">By workspace</h3>
            <div className="rounded-lg border bg-background/60 px-4 py-2">
              {usage.workspaces.length ? <table className="w-full text-xs"><tbody>{usage.workspaces.map((w) => {
                const project = projects.find((p) => p.workspaces.some((item) => item.id === w.id));
                const name = project?.workspaces.find((item) => item.id === w.id)?.name || "Archived workspace";
                return <tr key={w.id} className="border-b last:border-b-0"><th scope="row" className="py-1.5 text-left font-normal">{project ? <Link href={paths.workspace(w.id)} className="hover:underline">{name}</Link> : name}{project && <span className="text-muted-foreground block">{project.name}</span>}</th><td className="text-right tabular-nums">{usd(w.cost)}</td></tr>;
              })}</tbody></table>
                : <p className="text-muted-foreground py-1.5 text-xs">No reported usage yet.</p>}
            </div>
          </section>
        </div>
      </>}
    </div>
  );
}
