"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useUi } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";
import { CivPanel } from "./civ-panel";
import { PixelIcon, type PixelIconName } from "./pixel-icon";

/** The "t" from the Thunk wordmark, for the menu orb. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 100" fill="currentColor" className={className} aria-hidden="true">
      {[18, 30, 42, 54, 66, 78].map((cy) => <circle key={cy} cx={18} cy={cy} r={5} />)}
      <circle cx={6} cy={42} r={5} />
      <circle cx={30} cy={42} r={5} />
      <circle cx={22} cy={90} r={5} />
      <circle cx={34} cy={90} r={5} />
    </svg>
  );
}

/** Civ-style command menu, bottom-left: an orb that opens into Projects, Notes and Routines. */
export function CivToolbar({ cityCount }: { cityCount: number }) {
  const expanded = useUi((s) => s.hudExpanded);
  const setExpanded = useUi((s) => s.setHudExpanded);
  const pathname = usePathname();

  useEffect(() => {
    try { useUi.setState({ hudExpanded: localStorage.getItem("thunk.hud.expanded") === "on" }); } catch { /* Storage is optional. */ }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, setExpanded]);

  const slots: { href: string; label: string; icon: PixelIconName; detail: string; soon?: boolean }[] = [
    { href: "/", label: "Projects", icon: "castle", detail: `${cityCount} ${cityCount === 1 ? "city" : "cities"}` },
    { href: "/notes", label: "Notes", icon: "scroll", detail: "Soon", soon: true },
    { href: "/routines", label: "Routines", icon: "hourglass", detail: "Soon", soon: true },
  ];

  return (
    // In dev, sit above the Next.js dev indicator that owns the bottom-left corner.
    <div className={cn("fixed left-4 z-30 flex flex-col items-start gap-2", process.env.NODE_ENV === "development" ? "bottom-18" : "bottom-4")}>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.nav
            id="civ-toolbar-menu"
            aria-label="Main"
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            style={{ transformOrigin: "bottom left" }}
          >
            <CivPanel bodyClassName="flex flex-col gap-1 p-1.5">
              {slots.map((slot) => {
                const active = slot.href === "/" ? pathname === "/" : pathname.startsWith(slot.href);
                return (
                  <Link
                    key={slot.href}
                    href={slot.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group focus-visible:ring-ring flex w-56 items-center gap-3 px-2 py-1.5 outline-none focus-visible:ring-2",
                      active ? "bg-[color-mix(in_oklch,var(--w-bronze)_30%,transparent)] ring-1 ring-[var(--w-bronze)]" : "hover:bg-muted",
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center bg-[var(--w-sea)] shadow-[inset_2px_2px_0_#0006,inset_-1px_-1px_0_#fff2]">
                      <PixelIcon name={slot.icon} className="size-7 transition-transform group-hover:scale-110" />
                    </span>
                    <span className="pixel flex-1 text-base">{slot.label}</span>
                    <span
                      className={cn(
                        "pixel px-1.5 text-[11px]",
                        slot.soon ? "text-muted-foreground border border-dashed" : "bg-foreground text-background tabular-nums",
                      )}
                    >
                      {slot.detail}
                    </span>
                  </Link>
                );
              })}
            </CivPanel>
          </motion.nav>
        )}
      </AnimatePresence>
      <motion.button
        type="button"
        aria-label={expanded ? "Close menu" : "Open menu"}
        aria-expanded={expanded}
        aria-controls="civ-toolbar-menu"
        onClick={() => setExpanded(!expanded)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className="focus-visible:ring-ring relative flex size-14 items-center justify-center rounded-full text-[var(--w-bronze-light)] outline-none focus-visible:ring-2"
        style={{
          background: "radial-gradient(circle at 35% 30%, var(--w-bronze-light), var(--w-bronze) 45%, var(--w-bronze-dark))",
          boxShadow: "inset 0 0 0 3px var(--w-bronze-dark), inset 0 0 0 5px var(--w-bronze-light), inset 0 -6px 10px #0006, 0 3px 0 #0005",
        }}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-[var(--w-sea)] shadow-[inset_0_2px_4px_#000a]">
          <motion.span animate={{ scale: expanded ? 0.85 : 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
            <Mark className="h-6 w-auto" />
          </motion.span>
        </span>
      </motion.button>
    </div>
  );
}
