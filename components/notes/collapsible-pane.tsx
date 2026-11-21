"use client";

import { useIsDesktop } from "@/components/mobile/viewport";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useState } from "react";
import { useStoredFlag } from "@/lib/client/use-stored-flag";
import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const PANE_HEAD = "pixel text-muted-foreground flex h-9 shrink-0 items-center border-b px-3 text-[11px] tracking-widest uppercase";

/** A Library column that folds down to a thin rail showing its title sideways. */
export function CollapsiblePane({
  title,
  defaultOpen = true,
  storageKey,
  className,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  /** Remember open/closed across visits under this localStorage key. */
  storageKey?: string;
  /** Width and visibility classes for the open pane, e.g. `w-72`. */
  className?: string;
  children: React.ReactNode;
}) {
  const desktop = useIsDesktop();
  const [local, setLocal] = useState(defaultOpen);
  const [stored, setStored] = useStoredFlag(storageKey, defaultOpen);
  const open = storageKey ? stored : local;
  const setOpen = storageKey ? setStored : setLocal;

  if (desktop && !open)
    return (
      <div className={cn("flex shrink-0 flex-col items-center border-r", className, "w-9")}>
        <div className="flex h-9 shrink-0 items-center justify-center self-stretch border-b">
          <Hint label={`Show ${title}`} side="right">
            <Button size="icon-xs" variant="ghost" onClick={() => setOpen(true)} aria-label={`Show ${title}`}>
              <PanelLeftOpenIcon />
            </Button>
          </Hint>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pixel text-muted-foreground hover:text-foreground min-h-0 flex-1 truncate py-3 text-[11px] tracking-widest uppercase [writing-mode:vertical-rl]"
        >
          {title}
        </button>
      </div>
    );

  return (
    <div className={cn("flex shrink-0 flex-col border-r", className)}>
      <h2 className={cn(PANE_HEAD, "gap-2 pr-1.5")}>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <Hint label={`Hide ${title}`}>
          <Button className="hidden md:flex" size="icon-xs" variant="ghost" onClick={() => setOpen(false)} aria-label={`Hide ${title}`}>
            <PanelLeftCloseIcon />
          </Button>
        </Hint>
      </h2>
      {children}
    </div>
  );
}
