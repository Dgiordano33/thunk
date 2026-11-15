"use client";

import { Button } from "@/components/ui/button";

import { FileIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { useEffect } from "react";
import { fileName } from "@/lib/projects/file-paths";
import { filePagePath, filePathFromUrl } from "@/lib/routes";
import { fileKey, useOpenFiles, type OpenFile } from "@/lib/store/open-files-store";
import { lineTabIndicator } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { confirm } from "@/components/confirm";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { toast } from "sonner";
import { Hint } from "@/components/hint";

/** Files opened from the tree, as tabs after the workspace's sessions. A dot marks unsaved edits. */
export function OpenFileTabs({ workspaceId, base }: { workspaceId: string; base: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const hydrate = useOpenFiles((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  const all = useOpenFiles((s) => s.files);
  const drafts = useOpenFiles(useShallow((s) => Object.fromEntries(Object.keys(s.drafts).map((key) => [key, true]))));
  const files = all.filter((f) => f.workspaceId === workspaceId);
  const activePath = filePathFromUrl(base, pathname);
  const isActive = (f: OpenFile) => activePath === f.path && (!params.get("root") || params.get("root") === f.root);

  /** Closes `closing`, asking once if any have unsaved edits. If the open tab goes, `keep` (or a neighbour) opens instead. */
  const closeMany = async (closing: OpenFile[], keep?: OpenFile) => {
    const unsaved = closing.filter((f) => drafts[fileKey(f)]);
    if (unsaved.length && !(await confirm(unsaved.length === 1
      ? { title: `Discard unsaved changes to ${fileName(unsaved[0].path)}?`, description: "Your edits to this file haven’t been saved.", action: "Discard", destructive: true }
      : { title: `Discard unsaved changes to ${unsaved.length} files?`, description: unsaved.map((f) => fileName(f.path)).join(", "), action: "Discard all", destructive: true }))) return;
    const gone = new Set(closing.map(fileKey)), left = files.filter((f) => !gone.has(fileKey(f)));
    const active = files.find(isActive);
    for (const f of closing) useOpenFiles.getState().close(f);
    if (!active || !gone.has(fileKey(active))) return;
    // Closing the open tab moves to the tab kept, or its neighbour, or back to the workspace's latest session.
    const index = files.findIndex((o) => fileKey(o) === fileKey(active));
    const next = keep ?? files.slice(index + 1).find((f) => !gone.has(fileKey(f))) ?? files.slice(0, index).reverse().find((f) => !gone.has(fileKey(f))) ?? left[0];
    const tab = params.get("tab");
    router.push(next ? filePagePath(base, next.root, next.path, tab) : `${base}${tab ? `?tab=${tab}` : ""}`);
  };
  const close = (f: OpenFile) => closeMany([f]);
  const copyPath = async (f: OpenFile) => {
    try { await navigator.clipboard.writeText(f.path); toast.success("Copied path", { description: f.path }); }
    catch { toast.error("Couldn’t copy the path"); }
  };

  return files.map((f) => {
    const active = isActive(f);
    const dirty = !!drafts[fileKey(f)];
    const index = files.indexOf(f);
    return (
      <ContextMenu key={fileKey(f)}>
      <ContextMenuTrigger asChild>
      <div
        data-active={active}
        // Middle-click closes, as in editors and browsers.
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); void close(f); } }}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
        className={cn(
          "group/tab text-muted-foreground hover:text-foreground relative flex max-w-56 min-w-0 shrink-0 items-center transition-colors",
          lineTabIndicator, "after:h-0.5 after:inset-x-0 after:bottom-0",
        )}
      >
        <Link
          href={filePagePath(base, f.root, f.path, params.get("tab"))}
          data-active={active}
              aria-current={active ? "page" : undefined}
          title={f.path}
          className="flex min-w-0 items-center gap-2 self-stretch pr-1 pl-4 text-[13px]"
        >
          <FileIcon className="size-3.5 shrink-0" />
          <span className="truncate">{fileName(f.path)}</span>
        </Link>
        <Hint label={dirty ? "Unsaved changes · Close" : "Close"} side="bottom">
        <Button variant="ghost" size="xs"
          type="button"
          onClick={() => void close(f)}
          aria-label={`Close ${fileName(f.path)}${dirty ? " (unsaved changes)" : ""}`}
          className="hover:bg-muted mr-2 grid size-5 shrink-0 place-items-center rounded"
        >
          {/* The unsaved dot turns into the close cross on hover. */}
          {dirty && <span className="bg-foreground/70 size-1.5 rounded-full group-hover/tab:hidden" />}
          <XIcon className={cn("size-3", dirty ? "hidden group-hover/tab:block" : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100", active && !dirty && "opacity-100")} />
        </Button>
        </Hint>
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => void close(f)}>Close</ContextMenuItem>
        <ContextMenuItem disabled={files.length < 2} onSelect={() => void closeMany(files.filter((o) => o !== f), f)}>Close others</ContextMenuItem>
        <ContextMenuItem disabled={index === files.length - 1} onSelect={() => void closeMany(files.slice(index + 1), f)}>Close to the right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyPath(f)}>Copy path</ContextMenuItem>
        <ContextMenuItem onSelect={() => router.push(filePagePath(base, f.root, f.path, "files"))}>Reveal in files</ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>
    );
  });
}
