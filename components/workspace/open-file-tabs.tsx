"use client";

import { FileIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { fileName } from "@/lib/projects/file-paths";
import { filePagePath } from "@/lib/routes";
import { fileKey, useOpenFiles, type OpenFile } from "@/lib/store/open-files-store";
import { cn } from "@/lib/utils";

/** Files opened from the tree, as tabs after the workspace's sessions. A dot marks unsaved edits. */
export function OpenFileTabs({ workspaceId, base }: { workspaceId: string; base: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const hydrate = useOpenFiles((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  const all = useOpenFiles((s) => s.files);
  const drafts = useOpenFiles((s) => s.drafts);
  const files = all.filter((f) => f.workspaceId === workspaceId);
  const onFile = pathname === `${base}/file`;
  const isActive = (f: OpenFile) => onFile && params.get("path") === f.path && (!params.get("root") || params.get("root") === f.root);

  const close = (f: OpenFile) => {
    if (drafts[fileKey(f)] && !window.confirm(`Discard unsaved changes to ${fileName(f.path)}?`)) return;
    const index = files.findIndex((o) => fileKey(o) === fileKey(f));
    useOpenFiles.getState().close(f);
    if (!isActive(f)) return;
    // Closing the open tab moves to its neighbour, or back to the workspace's latest session.
    const next = files[index + 1] ?? files[index - 1];
    const tab = params.get("tab");
    router.push(next ? filePagePath(base, next.root, next.path, tab) : `${base}${tab ? `?tab=${tab}` : ""}`);
  };

  return files.map((f) => {
    const active = isActive(f);
    const dirty = !!drafts[fileKey(f)];
    return (
      <div
        key={fileKey(f)}
        className={cn(
          "group/tab text-muted-foreground hover:text-foreground relative flex max-w-56 min-w-0 shrink-0 items-center transition-colors",
          active && "text-foreground after:bg-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full",
        )}
      >
        <Link
          href={filePagePath(base, f.root, f.path, params.get("tab"))}
          aria-current={active ? "page" : undefined}
          title={f.path}
          className="flex min-w-0 items-center gap-2 self-stretch pr-1 pl-4 text-[13px]"
        >
          <FileIcon className="size-3.5 shrink-0" />
          <span className="truncate">{fileName(f.path)}</span>
        </Link>
        <button
          type="button"
          onClick={() => close(f)}
          aria-label={`Close ${fileName(f.path)}${dirty ? " (unsaved changes)" : ""}`}
          title={dirty ? "Unsaved changes" : "Close"}
          className="hover:bg-muted mr-2 grid size-5 shrink-0 place-items-center rounded"
        >
          {/* The unsaved dot turns into the close cross on hover. */}
          {dirty && <span className="bg-foreground/70 size-1.5 rounded-full group-hover/tab:hidden" />}
          <XIcon className={cn("size-3", dirty ? "hidden group-hover/tab:block" : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100", active && !dirty && "opacity-100")} />
        </button>
      </div>
    );
  });
}
