"use client";

import { FileIcon, FileSpreadsheetIcon, FileTextIcon, ImageIcon, LightbulbIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { relativeTime } from "@/components/session/labels";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VaultItem, VaultKind, VaultStatus } from "@/lib/vault/types";

export const KIND_ICONS: Record<VaultKind, typeof FileIcon> = { image: ImageIcon, pdf: FileTextIcon, text: FileTextIcon, office: FileSpreadsheetIcon, other: FileIcon };

// Same palette as routine run badges.
const STATUS_STYLE: Record<VaultStatus, { badge: string; dot: string; label: string }> = {
  queued: { badge: "text-muted-foreground", dot: "bg-muted-foreground/60", label: "Queued" },
  processing: { badge: "border-amber-500/40 text-amber-700 dark:text-amber-400", dot: "animate-pulse bg-amber-500", label: "Reading" },
  ready: { badge: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", label: "Ready" },
  failed: { badge: "border-red-500/40 text-red-700 dark:text-red-400", dot: "bg-red-500", label: "Failed" },
};

export function VaultStatusBadge({ item, className }: { item: Pick<VaultItem, "status" | "error">; className?: string }) {
  const s = STATUS_STYLE[item.status];
  return (
    <Badge variant="outline" className={cn("h-5 gap-1.5 text-[11px]", s.badge, className)} title={item.error}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </Badge>
  );
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Rows like the notes list: kind icon, title, time · size, and an idea count or status. */
export function ItemList({ items, selectedId, onSelect, contextOf }: {
  items: VaultItem[] | null;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** Extra context under the title, e.g. the project on the world page. */
  contextOf?: (item: VaultItem) => string;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items || !q) return items;
    return items.filter((i) => `${i.title} ${i.filename} ${i.summary ?? ""} ${(i.tags ?? []).join(" ")}`.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2 pb-1">
        <label className="bg-background focus-within:ring-ring flex h-8 items-center gap-1.5 rounded-md border px-2 focus-within:ring-2">
          <SearchIcon className="text-muted-foreground size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the Vault"
            aria-label="Search the Vault"
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
      </div>
      {shown === null ? (
        <div className="flex flex-col gap-1.5 p-2">
          {[0, 1, 2].map((i) => <div key={i} className="bg-muted/50 h-14 animate-pulse rounded-lg" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-center text-xs">{query ? "Nothing matches." : "Nothing stored yet."}</p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto p-2">
          {shown.map((item) => {
            const Icon = KIND_ICONS[item.kind];
            const selected = item.id === selectedId;
            return (
              <li key={`${item.projectId}/${item.id}`}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "bg-background hover:bg-muted/50 focus-visible:ring-ring flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-2",
                    selected && "border-foreground/25 bg-muted/60",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon className="text-muted-foreground size-3 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.title}</span>
                    {item.status === "ready" ? (
                      <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums" title="Ideas">
                        <LightbulbIcon className="size-3" aria-label="Ideas" />
                        {item.ideas?.length ?? 0}
                      </span>
                    ) : (
                      <VaultStatusBadge item={item} className="shrink-0" />
                    )}
                  </span>
                  <span className="text-muted-foreground truncate text-[11px]">
                    {contextOf ? `${contextOf(item)} · ` : ""}
                    {relativeTime(item.createdAt)} · {formatBytes(item.size)} · {item.filename}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
