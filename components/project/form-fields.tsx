// Plain presentational pieces shared by the project and repo dialogs. No hooks, so usable from either side.
import { FolderIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

export const DEFAULT_PARENT = "~/code";

export const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/** A folder chosen via the native picker: shows the path, click to choose another. */
export function FolderPicker({ value, picking, onPick }: { value: string; picking: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={picking}
      className="hover:bg-muted focus-visible:ring-ring flex h-8 w-full items-center gap-2 rounded-lg border px-2.5 text-left transition-colors outline-none focus-visible:ring-2 disabled:opacity-60"
    >
      {picking ? (
        <Loader2Icon className="text-muted-foreground size-4 shrink-0 animate-spin" />
      ) : (
        <FolderIcon className="text-muted-foreground size-4 shrink-0" />
      )}
      <span className={cn("min-w-0 flex-1 truncate font-mono text-sm", !value && "text-muted-foreground")}>
        {picking ? "Waiting for Finder…" : value ? tildify(value) : "No folder chosen"}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs">Choose…</span>
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </label>
  );
}
