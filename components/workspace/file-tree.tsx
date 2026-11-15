"use client";

import { WORLD_SELECTION } from "@/components/world/selection";

import { Tree, TreeGroup, TreeItem, TreeItemIndicator, TreeItemLabel } from "@ui-sdk/react/tree";
import { ChevronRightIcon, FileIcon, FolderIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { FileEntry, FileRoot, RepoChanges, WorkspaceChanges } from "@/lib/projects/types";
import { filePagePath, filePathFromUrl } from "@/lib/routes";
import { useOpenFiles } from "@/lib/store/open-files-store";
import { cn } from "@/lib/utils";
import { useWorkspaceBase } from "./route-context";
import { Skeleton } from "@/components/ui/skeleton";

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

/**
 * Tree values are `root:path`, with an empty path for a root itself. Expanded folders are kept in the open-files
 * store by `workspaceId:root:path`; roots start open, so the store marks a collapsed root instead.
 */
const valueOf = (root: string, path: string) => `${root}:${path}`;
const parse = (value: string) => { const at = value.indexOf(":"); return { root: value.slice(0, at), path: value.slice(at + 1) }; };
const isRoot = (value: string) => parse(value).path === "";

/** Rows indent by depth; a file lines up with folder names, past the chevron. */
const ROW = "flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset";
const indent = (level: number, file = false) => ({ paddingLeft: (level - 1) * 12 + 8 + (file ? 20 : 0) });

/** The workspace's files as a lazily loaded tree, with git status marks. Opening a file opens it in an editor tab. */
export function FileTree({ workspaceId, changes, repos, refreshKey }: {
  workspaceId: string;
  changes: WorkspaceChanges | null | undefined;
  repos: RepoChanges[];
  /** Bump to re-list expanded folders (e.g. when an agent turn ends). */
  refreshKey: unknown;
}) {
  const base = useWorkspaceBase();
  const pathname = usePathname();
  const params = useSearchParams();
  const [roots, setRoots] = useState<FileRoot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Listed folders, by tree value; a folder that failed to list holds its error. */
  const [listed, setListed] = useState<Record<string, FileEntry[] | { error: string }>>({});
  const [menuFor, setMenuFor] = useState<{ value: string; file: boolean } | null>(null);
  const router = useRouter();
  const hydrate = useOpenFiles((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);

  useEffect(() => {
    api.workspaceFileRoots(workspaceId).then((r) => setRoots(r.roots), (err: Error) => setError(err.message));
  }, [workspaceId]);

  const list = useCallback(async (value: string, signal?: AbortSignal) => {
    const { root, path } = parse(value);
    try {
      const { entries } = await api.workspaceDirectory(workspaceId, root, path);
      if (!signal?.aborted) setListed((l) => ({ ...l, [value]: entries }));
    } catch (err) {
      if (signal?.aborted) return;
      setListed((l) => ({ ...l, [value]: { error: (err as Error).message } }));
      throw err;
    }
  }, [workspaceId]);

  // Which folders are open, from the store, as tree values.
  const stored = useOpenFiles((s) => s.expanded);
  const toggleDir = useOpenFiles((s) => s.toggleDir);
  const prefix = `${workspaceId}:`;
  const expanded = useMemo(() => {
    const open = Object.keys(stored).filter((k) => k.startsWith(prefix) && !k.endsWith("collapsed")).map((k) => k.slice(prefix.length));
    const shownRoots = roots && roots.length > 1 ? roots.filter((r) => !stored[`${prefix}${valueOf(r.id, "")}collapsed`]).map((r) => valueOf(r.id, "")) : [];
    return [...shownRoots, ...open];
  }, [stored, prefix, roots]);
  const onExpandedChange = (next: string[]) => {
    const now = new Set(expanded), want = new Set(next);
    for (const v of new Set([...now, ...want])) {
      if (now.has(v) === want.has(v)) continue;
      if (isRoot(v)) toggleDir(`${prefix}${v}collapsed`, !want.has(v));
      else toggleDir(`${prefix}${v}`, want.has(v));
    }
  };

  // The top level lists right away, and folders opened earlier list again on load and whenever refreshKey changes.
  const refresh = String(refreshKey);
  const shown = useRef(expanded);
  useEffect(() => { shown.current = expanded; });
  useEffect(() => {
    if (!roots) return;
    const tops = roots.map((r) => valueOf(r.id, ""));
    for (const v of new Set([...tops, ...shown.current])) void list(v).catch(() => {});
  }, [roots, refresh, list]);

  const statuses = useMemo(() => statusMap(roots ?? [], changes, repos), [roots, changes, repos]);
  const route = { path: filePathFromUrl(base, pathname), root: params.get("root"), tab: params.get("tab") };
  const currentRoot = route.root ?? roots?.[0]?.id;
  const current = route.path && currentRoot ? valueOf(currentRoot, route.path) : null;

  // The open file's folders open, so it shows in the tree, like after following a link to it.
  useEffect(() => {
    if (!current || !roots) return;
    const { root, path } = parse(current), parts = path.split("/").slice(0, -1);
    if (roots.length > 1) toggleDir(`${prefix}${valueOf(root, "")}collapsed`, false);
    parts.forEach((_, i) => toggleDir(`${prefix}${valueOf(root, parts.slice(0, i + 1).join("/"))}`, true));
  }, [current, roots, prefix, toggleDir]);

  // A folder opened from outside the tree (the open file, or the store) lists once it is open and not yet listed.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const v of expanded) {
      if (listed[v] || asked.current.has(v)) continue;
      asked.current.add(v);
      void list(v).catch(() => {}).finally(() => asked.current.delete(v));
    }
  }, [expanded, listed, list]);

  if (error) return <p className="text-destructive px-4 py-6 text-center text-xs">{error}</p>;
  if (!roots) return <div className="flex justify-center p-6"><Skeleton role="status" aria-label="Loading files" className="h-12 w-full" /></div>;

  const rows = (root: FileRoot, path: string, level: number): React.ReactNode => {
    const entries = listed[valueOf(root.id, path)];
    if (!entries) return path === "" && level === 1 ? <Skeleton role="status" aria-label="Loading folder" className="mx-2 my-1 h-4 w-2/3" /> : null;
    if ("error" in entries) return <p className="text-destructive py-1 text-xs" style={indent(level)}>{entries.error}</p>;
    if (!entries.length) return <p className="text-muted-foreground py-1 text-xs italic" style={indent(level)}>Empty</p>;
    return entries.map((e) => e.kind === "dir"
      ? folder(root, e, level, statuses.get(root.id))
      : file(root, e, level, statuses.get(root.id)?.get(e.path)));
  };

  // Plain render functions, not components: a component defined here would remount its rows on every render.
  const folder = (root: FileRoot, entry: FileEntry, level: number, status?: Map<string, string>) => {
    const value = valueOf(root.id, entry.path), changed = status?.has(`${entry.path}/`);
    return (
      <TreeItem key={entry.path} value={value} branch label={entry.name} data-tree-value={value} className={cn(entry.ignored && "opacity-50")}>
        <TreeItemLabel title={entry.path} className={ROW} style={indent(level)}>
          <Chevron />
          <FolderIcon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
          <span className={cn("truncate", changed && "text-amber-600 dark:text-amber-400")}>{entry.name}</span>
          {changed && <span aria-label="Has changes" className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" />}
        </TreeItemLabel>
        {listed[value] && <TreeGroup>{rows(root, entry.path, level + 1)}</TreeGroup>}
      </TreeItem>
    );
  };

  const file = (root: FileRoot, entry: FileEntry, level: number, status?: string) => {
    const value = valueOf(root.id, entry.path);
    return (
      <TreeItem key={entry.path} value={value} label={entry.name} data-tree-value={value} data-file="" className={cn(entry.ignored && "opacity-50")}>
        <TreeItemLabel
          render={<Link href={filePagePath(base, root.id, entry.path, route.tab)} />}
          title={entry.path}
          className={cn(ROW, value === current && WORLD_SELECTION)}
          style={indent(level, true)}
        >
          <FileIcon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
          <span className={cn("truncate", status && STATUS_CLASS[status])}>{entry.name}</span>
          {status && <span className={cn("ml-auto w-3 shrink-0 text-center font-mono text-[11px]", STATUS_CLASS[status])}>{status}</span>}
        </TreeItemLabel>
      </TreeItem>
    );
  };

  // One menu for the whole tree; a right-click (or the menu key) notes which row it was on.
  const menuRoot = menuFor ? roots.find((r) => r.id === parse(menuFor.value).root) : undefined;
  const menuPath = menuFor ? parse(menuFor.value).path : "";
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`Copied ${what}`, { description: text }); }
    catch { toast.error(`Couldn’t copy the ${what}`); }
  };
  const collapseAll = () => { for (const v of expanded) if (!isRoot(v)) toggleDir(`${prefix}${v}`, false); };

  return (
    <ContextMenu onOpenChange={(open) => { if (!open) setMenuFor(null); }}>
    <ContextMenuTrigger asChild>
    <div className="py-1" onContextMenuCapture={(e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-tree-value]");
      setMenuFor(row ? { value: row.dataset.treeValue!, file: row.hasAttribute("data-file") } : null);
    }}>
      <Tree
        aria-label="Workspace files"
        mode="none"
        current={current}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        loadChildren={(value, { signal }) => list(value, signal)}
        announcement={({ type, label }) => ({ expanded: "Expanded", collapsed: "Collapsed", loading: `Loading ${label}`, "load-failed": `${label} didn't load. Expand it again to retry.` })[type]}
      >
        {roots.length === 1 ? rows(roots[0], "", 1) : roots.map((root) => {
          const value = valueOf(root.id, ""), changed = (statuses.get(root.id)?.size ?? 0) > 0;
          return (
            <TreeItem key={root.id} value={value} branch label={root.name}>
              <TreeItemLabel title={root.cwd} className={cn(ROW, "px-2 font-semibold")}>
                <Chevron />
                <span className="truncate">{root.name}</span>
                {changed && <span aria-label="Has changes" className="ml-1 size-1.5 shrink-0 rounded-full bg-amber-500" />}
              </TreeItemLabel>
              {listed[value] && <TreeGroup>{rows(root, "", 2)}</TreeGroup>}
            </TreeItem>
          );
        })}
      </Tree>
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-56">
      {menuFor && menuRoot && <>
        {menuFor.file && <ContextMenuItem onSelect={() => router.push(filePagePath(base, menuRoot.id, menuPath, route.tab))}>Open</ContextMenuItem>}
        {menuPath && <ContextMenuItem onSelect={() => void copy(menuPath, "path")}>Copy path</ContextMenuItem>}
        <ContextMenuItem onSelect={() => void copy(menuPath ? `${menuRoot.cwd}/${menuPath}` : menuRoot.cwd, "full path")}>Copy full path</ContextMenuItem>
        <ContextMenuSeparator />
      </>}
      <ContextMenuItem disabled={!expanded.some((v) => !isRoot(v))} onSelect={collapseAll}>Collapse all folders</ContextMenuItem>
    </ContextMenuContent>
    </ContextMenu>
  );
}

/** A folder's arrow: a spinner while it lists, a retry mark if that failed. */
function Chevron() {
  return (
    <TreeItemIndicator className="text-muted-foreground grid size-3.5 shrink-0 place-items-center">
      {(state) => state.loading
        ? <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
        : state.failed
          ? <RotateCwIcon aria-hidden="true" className="size-3" />
          : <ChevronRightIcon aria-hidden="true" className={cn("size-3.5 transition-transform", state.expanded && "rotate-90")} />}
    </TreeItemIndicator>
  );
}
