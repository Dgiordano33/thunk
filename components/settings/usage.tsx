"use client";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePaths } from "@/components/layout/paths-context";
import type { UsageSummary } from "@/lib/ambient/types";
import { cn } from "@/lib/utils";
import { UsageChart } from "./usage-chart";

export type UsageProject = { id: string; name: string; workspaces: { id: string; name: string }[] };

const usd = (cost: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: cost && cost < 1 ? 4 : 2 }).format(cost);
const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
type SortKey = "name" | "project" | "cost";

/** The last `n` local dates, oldest first, as YYYY-MM-DD (the API's day names). */
function lastDays(n: number) {
  const today = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
}

export function UsageSettings({ projects }: { projects: UsageProject[] }) {
  const paths = usePaths();
  const [usage, setUsage] = useState<(UsageSummary & { persistent: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(30);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "cost", desc: true });
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

  const days = useMemo(() => {
    const byDay = new Map(usage?.days.map((d) => [d.name, d.cost]));
    return lastDays(range).map((date) => ({ date, cost: byDay.get(date) ?? 0 }));
  }, [usage, range]);
  const rangeTotal = days.reduce((sum, d) => sum + d.cost, 0);

  const rows = useMemo(() => {
    const list = (usage?.workspaces ?? []).map((w) => {
      const project = projects.find((p) => p.workspaces.some((item) => item.id === w.id));
      return { id: w.id, cost: w.cost, project: project?.name ?? "", name: project?.workspaces.find((item) => item.id === w.id)?.name ?? "Archived workspace", linked: Boolean(project) };
    });
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => (sort.key === "cost" ? a.cost - b.cost : a[sort.key].localeCompare(b[sort.key])) * dir);
  }, [usage, projects, sort]);

  const header = (key: SortKey, label: string, className?: string) => {
    const active = sort.key === key;
    const Arrow = sort.desc ? ArrowDownIcon : ArrowUpIcon;
    return (
      <th scope="col" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className={cn("px-3 py-2 font-medium", className)}>
        <button type="button" className={cn("hover:text-foreground inline-flex items-center gap-1", active && "text-foreground")} onClick={() => setSort({ key, desc: active ? !sort.desc : key === "cost" })}>
          {label}{active && <Arrow className="size-3" aria-hidden="true" />}
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-xs">Agent-reported cost estimates, in USD. Subscription billing and Max plan limits are unavailable.</p>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      {!usage && !error && <p role="status" className="text-sm">Loading usage…</p>}
      {usage && <>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
          <div>
            <p className="text-muted-foreground text-xs">Last {range} days</p>
            <p className="text-3xl font-semibold tabular-nums">{usd(rangeTotal)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">All time</p>
            <p className="text-lg tabular-nums">{usd(usage.total)}</p>
          </div>
          <div role="group" aria-label="Range" className="ml-auto flex rounded-md border p-0.5">
            {RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={cn("rounded px-2.5 py-1 text-xs", range === r ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>{r} days</button>
            ))}
          </div>
        </div>
        {!usage.persistent && <p className="text-muted-foreground text-xs">Memory mode: retained events from this server run only.</p>}
        <section className="rounded-lg border bg-background/60 p-4">
          <h3 className="mb-2 text-sm font-medium">By day · your time zone</h3>
          <UsageChart days={days} format={usd} />
          <details className="mt-2 text-xs">
            <summary className="text-muted-foreground cursor-pointer">Show as a table</summary>
            <table className="mt-2 w-full">
              <tbody>{days.filter((d) => d.cost > 0).reverse().map((d) => <tr key={d.date} className="border-b last:border-b-0"><th scope="row" className="py-1.5 text-left font-normal">{d.date}</th><td className="text-right tabular-nums">{usd(d.cost)}</td></tr>)}</tbody>
            </table>
            {!rangeTotal && <p className="text-muted-foreground py-1.5">No reported usage in this range.</p>}
          </details>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-medium">By workspace · all time</h3>
          {rows.length ? (
            <div className="overflow-hidden rounded-lg border bg-background/60">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b text-left">
                  <tr>{header("name", "Workspace")}{header("project", "Project")}{header("cost", "Cost", "text-right")}</tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.id} className="hover:bg-muted/50 border-b last:border-b-0">
                      <th scope="row" className="px-3 py-2 text-left font-normal">{w.linked ? <Link href={paths.workspace(w.id)} className="hover:underline">{w.name}</Link> : <span className="text-muted-foreground">{w.name}</span>}</th>
                      <td className="text-muted-foreground px-3 py-2">{w.project}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{usd(w.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-muted-foreground text-xs">No reported usage yet.</p>}
        </section>
      </>}
    </div>
  );
}
