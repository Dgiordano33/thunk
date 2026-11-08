"use client";

import { XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CivPanel } from "@/components/world/civ-panel";
import { cn } from "@/lib/utils";

/** The right-hand panel a building or field opens into. Closing drops the query param and keeps the camera where it is. */
export function TownPanel({
  title,
  eyebrow,
  closeHref,
  wide,
  compact,
  escapable = true,
  actions,
  children,
}: {
  title: React.ReactNode;
  eyebrow?: string;
  closeHref: string;
  wide?: boolean;
  /** Size to the content instead of filling the screen height. */
  compact?: boolean;
  /** Chat uses Esc to interrupt a turn, so it opts out of Esc-to-close. */
  escapable?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!escapable) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest("[role=dialog],[role=menu],[role=listbox],textarea,input")) return;
      router.replace(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escapable, closeHref, router]);

  return (
    <aside
      className={cn(
        "absolute top-20 right-4 z-30 flex",
        !compact && (process.env.NODE_ENV === "development" ? "bottom-18" : "bottom-4"),
        wide ? "w-[min(720px,calc(100vw-2rem))]" : "w-[min(460px,calc(100vw-2rem))]",
      )}
    >
      <CivPanel className={cn("w-full", !compact && "h-full")} bodyClassName="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="pixel text-muted-foreground text-[11px] tracking-widest uppercase">{eyebrow}</p>}
            <h2 className="pixel truncate text-lg leading-tight">{title}</h2>
          </div>
          {actions}
          <Link
            href={closeHref}
            scroll={false}
            aria-label="Close panel"
            className="hover:bg-muted focus-visible:ring-ring flex size-8 items-center justify-center outline-none focus-visible:ring-2"
          >
            <XIcon className="size-4" />
          </Link>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </CivPanel>
    </aside>
  );
}
