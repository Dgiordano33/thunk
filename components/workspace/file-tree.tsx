"use client";

import { ChevronRightIcon, FileIcon, FolderIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import type { FileEntry, FileRoot, RepoChanges, WorkspaceChanges } from "@/lib/projects/types";
import { filePagePath } from "@/lib/routes";
import { useOpenFiles } from "@/lib/store/open-files-store";
import { cn } from "@/lib/utils";
import { useWorkspaceBase } from "./route-context";

/** Git status letter per changed path, per root. Folders holding changes are keyed with a trailing "/". */
type StatusMap = Map<string, Map<string, string>>;

const STATUS_CLASS: Record<string, string> = {
  A: "text-emerald-600 dark:text-emerald-400",
  U: "text-emerald-600 dark:text-emerald-400",
  M: "text-amber-600 dark:text-amber-400",
  D: "text-red-600 dark:text-red-400",
};

function statusMap(roots: FileRoot[], changes: WorkspaceChanges | null | undefined, repos: RepoChanges[]): StatusMap {
  const sources = repos.length
    ? repos.map((r) => [r.id, r.changes] as const)
    : [[roots.find((r) => r.anchor)?.id ?? "", changes] as const];
  const map: StatusMap = new Map();
  for (const [id, c] of sources) {
    const m = new Map<string, string>();
    for (const f of c?.files ?? []) {
      m.set(f.path, f.status);
      for (let i = f.path.indexOf("/"); i > 0; i = f.path.indexOf("/", i + 1)) m.set(`${f.path.slice(0, i)}/`, "•");
    }
    map.set(id, m);
  }
  return map;
}

/** The workspace's files as a lazily loaded tree, with git status marks. Clicking a file opens it in an editor tab. */
export function FileTree({ workspaceId, changes, repos, refreshKey }: {
  workspaceId: string;
  changes: WorkspaceChanges | null | undefined;
  repos: RepoChanges[];
  /** Bump to re-list expanded folders (e.g. when an agent turn ends). */
  refreshKey: unknown;
}) {
  const [roots, setRoots] = useState<FileRoot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hydrate = useOpenFiles((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);

  useEffect(() => {
    api.workspaceFileRoots(workspaceId).then((r) => setRoots(r.roots), (err: Error) => setError(err.message));
  }, [workspaceId]);

  const statuses = useMemo(() => statusMap(roots ?? [], changes, repos), [roots, changes, repos]);
  const refresh = String(refreshKey);

  if (error) return <p className="text-destructive px-4 py-6 text-center text-xs">{error}</p>;
  if (!roots) return <div className="text-muted-foreground flex justify-center p-6"><Loader2Icon className="size-4 animate-spin" /></div>;

  return (
    <div className="py-1">
      <div role="tree" aria-label="Workspace files">
        {roots.length === 1 ? (
          <Directory workspaceId={workspaceId} root={roots[0]} dir="" depth={0} statuses={statuses.get(roots[0].id)} refresh={refresh} />
        ) : (
          roots.map((root) => <RootSection key={root.id} workspaceId={workspaceId} root={root} statuses={statuses.get(root.id)} refresh={refresh} />)
        )}
      </div>
    </div>
  );
}

function RootSection({ workspaceId, root, statuses, refresh }: { workspaceId: string; root: FileRoot; statuses?: Map<string, string>; refresh: string }) {
  const key = `${workspaceId}:${root.id}:`;
  // Roots start open; the store remembers when one is collapsed.
  const collapsed = useOpenFiles((s) => !!s.expanded[`${key}collapsed`]);
  const toggle = useOpenFiles((s) => s.toggleDir);
  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(`${key}collapsed`)}
        aria-expanded={!collapsed}
        title={root.cwd}
        className="hover:bg-muted flex w-full items-center gap-1.5 px-2 py-1 text-left text-[13px] font-semibold"
      >
        <ChevronRightIcon className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")} />
        <span className="truncate">{root.name}</span>
        {statuses && statuses.size > 0 && <span className="ml-1 size-1.5 shrink-0 rounded-full bg-amber-500" />}
      </button>
      {!collapsed && <Directory workspaceId={workspaceId} root={root} dir="" depth={1} statuses={statuses} refresh={refresh} />}
    </div>
  );
}

function Directory({ workspaceId, root, dir, depth, statuses, refresh }: {
  workspaceId: string;
  root: FileRoot;
  dir: string;
  depth: number;
  statuses?: Map<string, string>;
  refresh: string;
}) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.workspaceDirectory(workspaceId, root.id, dir).then(
      (r) => { if (!cancelled) { setEntries(r.entries); setError(null); } },
      (err: Error) => { if (!cancelled) setError(err.message); },
    );
    return () => { cancelled = true; };
  }, [workspaceId, root.id, dir, refresh]);

  const pad = { paddingLeft: depth * 12 + 8 };
  if (error) return <p className="text-destructive py-1 text-xs" style={pad}>{error}</p>;
  if (!entries) return <div className="text-muted-foreground py-1" style={pad}><Loader2Icon className="size-3.5 animate-spin" /></div>;
  if (!entries.length) return <p className="text-muted-foreground py-1 text-xs italic" style={pad}>Empty</p>;

  return (
    <ul role="group">
      {entries.map((e) => e.kind === "dir"
        ? <DirectoryRow key={e.path} workspaceId={workspaceId} root={root} entry={e} depth={depth} statuses={statuses} refresh={refresh} />
        : <FileRow key={e.path} root={root} entry={e} depth={depth} status={statuses?.get(e.path)} />)}
    </ul>
  );
}

function DirectoryRow({ workspaceId, root, entry, depth, statuses, refresh }: {
  workspaceId: string;
  root: FileRoot;
  entry: FileEntry;
  depth: number;
  statuses?: Map<string, string>;
  refresh: string;
}) {
  const key = `${workspaceId}:${root.id}:${entry.path}`;
  const open = useOpenFiles((s) => !!s.expanded[key]);
  const toggle = useOpenFiles((s) => s.toggleDir);
  const changed = statuses?.has(`${entry.path}/`);
  return (
    <li role="treeitem" aria-expanded={open} aria-selected={false}>
      <button
        type="button"
        onClick={() => toggle(key)}
        title={entry.path}
        className={cn("hover:bg-muted flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[13px]", entry.ignored && "opacity-50")}
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <ChevronRightIcon className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <FolderIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className={cn("truncate", changed && "text-amber-600 dark:text-amber-400")}>{entry.name}</span>
        {changed && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" />}
      </button>
      {open && <Directory workspaceId={workspaceId} root={root} dir={entry.path} depth={depth + 1} statuses={statuses} refresh={refresh} />}
    </li>
  );
}

function FileRow({ root, entry, depth, status }: { root: FileRoot; entry: FileEntry; depth: number; status?: string }) {
  const base = useWorkspaceBase();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = pathname === `${base}/file` && params.get("path") === entry.path && (params.get("root") ?? root.id) === root.id;
  return (
    <li role="treeitem" aria-selected={active}>
      <Link
        href={filePagePath(base, root.id, entry.path, params.get("tab"))}
        title={entry.path}
        aria-current={active ? "page" : undefined}
        className={cn(
          "hover:bg-muted flex items-center gap-1.5 py-[3px] pr-2 text-[13px]",
          active && "bg-muted",
          entry.ignored && "opacity-50",
        )}
        // Files line up with folder names, past the chevron.
        style={{ paddingLeft: depth * 12 + 8 + 20 }}
      >
        <FileIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className={cn("truncate", status && STATUS_CLASS[status])}>{entry.name}</span>
        {status && <span className={cn("ml-auto w-3 shrink-0 text-center font-mono text-[11px]", STATUS_CLASS[status])}>{status}</span>}
      </Link>
    </li>
  );
}
