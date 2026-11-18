"use client";

import { ArrowUpIcon, ChevronRightIcon, FolderGit2Icon, FolderIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import type { DirListing } from "@/lib/fs/list-dirs";

const tilde = (p: string, home: string) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);

/** Choose a folder on the Thunk host from any browser: type a path or walk the folders under home. */
export function FolderBrowser({ onOpenChange, title, start, onChoose }: {
  onOpenChange: (open: boolean) => void;
  title: string;
  start?: string;
  onChoose: (path: string) => void;
}) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only the latest request may update the view, so a slow first load can't overwrite a typed path.
  const seq = useRef(0);
  const request = useCallback((target: string, fallback?: string) => {
    const id = ++seq.current;
    // A start folder that no longer exists falls back (e.g. to home) instead of showing an error.
    const fetched = api.listDirs(target).catch((err) => (fallback === undefined ? Promise.reject(err) : api.listDirs(fallback)));
    fetched.then(
      (next) => {
        if (id !== seq.current) return;
        setListing(next);
        setTyped(tilde(next.path, next.home));
        setError(null);
        setLoading(false);
      },
      (err: Error) => {
        if (id !== seq.current) return;
        setError(err.message);
        setLoading(false);
      },
    );
  }, []);
  const go = (target: string) => {
    setLoading(true);
    request(target);
  };

  // Mounted fresh for each pick (see RepoSourceFields), so this runs once per opening.
  useEffect(() => request(start || "~", "~"), [request, start]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Folders on the machine running Thunk.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // React bubbles through portals: keep this from submitting the dialog form we're opened from.
            e.stopPropagation();
            go(typed);
          }}
        >
          <Button type="button" variant="outline" size="icon" aria-label="Up one folder" disabled={!listing?.parent || loading} onClick={() => listing?.parent && go(listing.parent)}>
            <ArrowUpIcon />
          </Button>
          <Input aria-label="Folder path" value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono text-base md:text-sm" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <Button type="submit" variant="outline">Go</Button>
        </form>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <ul aria-label="Subfolders" className="-mx-1 min-h-40 flex-1 overflow-y-auto rounded-lg border p-1">
          {loading && !listing && <li className="text-muted-foreground flex items-center gap-2 p-2"><Loader2Icon className="size-4 animate-spin" /> Loading…</li>}
          {listing && !listing.entries.length && <li className="text-muted-foreground p-2">No subfolders.</li>}
          {listing?.entries.map((entry) => {
            const Icon = entry.git ? FolderGit2Icon : FolderIcon;
            return (
              <li key={entry.path}>
                <button type="button" onClick={() => go(entry.path)} className="hover:bg-muted flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left md:min-h-8">
                  <Icon className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">{entry.name}</span>
                  {entry.git && <span className="text-muted-foreground shrink-0 text-xs">git</span>}
                  <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!listing || loading} onClick={() => { if (listing) { onChoose(listing.path); onOpenChange(false); } }}>
            Choose {listing ? tilde(listing.path, listing.home).split("/").pop() || "~" : "folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
