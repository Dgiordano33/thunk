"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CivPanel } from "@/components/world/civ-panel";
import { PixelIcon } from "@/components/world/pixel-icon";
import { api } from "@/lib/client/api";
import { isBusy, type VaultItem } from "@/lib/vault/types";
import { VaultBody } from "./vault-panel";

type Row = VaultItem & { projectName?: string };

/** /vault: every project's holdings in one panel, with a project picker that also sets the upload target. */
export function VaultOverview({ projects, initial }: { projects: { id: string; name: string }[]; initial: Row[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [items, setItems] = useState<Row[]>(initial);
  const project = params.get("project");
  const projectId = projects.some((p) => p.id === project) ? project : null;
  const itemParam = params.get("item");

  const go = (next: { project?: string | null; item?: string | null }) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  const refresh = useCallback(async () => {
    try {
      setItems((await api.listAllVault()).items);
    } catch {
      /* keep what we have */
    }
  }, []);
  const busy = items.some(isBusy);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const names = new Map(projects.map((p) => [p.id, p.name]));
  const shown = projectId ? items.filter((i) => i.projectId === projectId) : items;
  // Item ids are unique per project; the URL carries `projectId/itemId` when browsing everything.
  const selected = shown.find((i) => `${i.projectId}/${i.id}` === itemParam || (projectId && i.id === itemParam)) ?? null;

  if (!projects.length)
    return (
      <main className="fog absolute inset-0 flex items-center justify-center p-6">
        <CivPanel parchment className="w-full max-w-md" bodyClassName="flex flex-col items-center px-8 py-8 text-center">
          <PixelIcon name="chest" className="mb-4 size-14" />
          <p className="pixel text-xs tracking-widest uppercase opacity-60">Vault</p>
          <h1 className="pixel mt-1 text-3xl">Nothing to guard yet</h1>
          <p className="mt-3 text-sm leading-relaxed opacity-80">Every city has a Vault for source material: docs, screenshots, slides, transcripts. Found a city first.</p>
          <Link href="/" className="pixel mt-6 text-sm underline underline-offset-4 hover:opacity-80">← Back to the map</Link>
        </CivPanel>
      </main>
    );

  return (
    <main className="absolute inset-x-4 top-20 z-10 flex justify-center" style={{ bottom: process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" }}>
      <CivPanel className="w-full max-w-6xl" bodyClassName="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="pixel text-muted-foreground text-[11px] tracking-widest uppercase">Vault</p>
            <h2 className="pixel text-lg leading-tight">
              {shown.length} {shown.length === 1 ? "item" : "items"} · {shown.reduce((n, i) => n + (i.ideas?.length ?? 0), 0)} ideas
            </h2>
          </div>
          <Select value={projectId ?? "all"} onValueChange={(v) => go({ project: v === "all" ? null : v, item: null })}>
            <SelectTrigger size="sm" className="w-56 text-xs" aria-label="Project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {projectId && (
            <Link href={`/p/${projectId}?building=vault`} className="pixel hover:bg-muted px-2 py-1 text-xs whitespace-nowrap">Visit town →</Link>
          )}
        </header>
        {!projectId && (
          <p className="text-muted-foreground border-b px-4 py-1.5 text-[11px]">Pick a project to upload into its Vault.</p>
        )}
        <div className="min-h-0 flex-1">
          <VaultBody
            projectId={projectId ?? undefined}
            items={shown}
            selected={selected}
            onSelect={(id) => {
              const row = shown.find((i) => i.id === id);
              go({ item: id && row ? (projectId ? id : `${row.projectId}/${id}`) : null });
            }}
            onAdded={(added) => {
              setItems((cur) => [...added.map((i) => ({ ...i, projectName: names.get(i.projectId) })), ...cur]);
              if (added[0]) go({ item: added[0].id });
              router.refresh();
            }}
            onChange={(item) => setItems((cur) => cur.map((i) => (i.id === item.id && i.projectId === item.projectId ? { ...i, ...item } : i)))}
            onDeleted={(id) => {
              setItems((cur) => cur.filter((i) => !(i.id === id && i.projectId === selected?.projectId)));
              go({ item: null });
              router.refresh();
            }}
            contextOf={projectId ? undefined : (i) => names.get(i.projectId) ?? "Unknown project"}
          />
        </div>
      </CivPanel>
    </main>
  );
}
