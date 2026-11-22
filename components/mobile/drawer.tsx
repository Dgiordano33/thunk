"use client";
import { createContext, useState } from "react";
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** The app sidebar, handed down by the shell so the workspace header can open it as a sheet. */
export const MobileNav = createContext<React.ReactNode>(null);

/** A sheet that closes when a link inside it is followed. `trigger` replaces the title as the button's content. */
export function MobileDrawer({ title, children, side = "bottom", trigger, className }: { title: string; children: React.ReactNode; side?: "left" | "bottom"; trigger?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger aria-label={trigger ? title : undefined} className={cn("min-h-11 min-w-0 max-w-full truncate px-4 text-sm", className)}>{trigger ?? title}</SheetTrigger><SheetContent side={side} className="h-[85dvh] max-h-dvh gap-0 pb-safe" aria-describedby={undefined}><SheetTitle className="px-4 py-4">{title}</SheetTitle><div onClick={e => { if ((e.target as HTMLElement).closest("a[href]")) setOpen(false); }} className="min-h-0 flex-1 overflow-auto">{children}</div></SheetContent></Sheet>;
}
