"use client";
import { useState } from "react";
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from "@/components/ui/sheet";
export function MobileDrawer({ title, children, side = "bottom" }: { title: string; children: React.ReactNode; side?: "left" | "bottom" }) {
  const [open, setOpen] = useState(false);
  return <Sheet open={open} onOpenChange={setOpen}><SheetTrigger className="min-h-11 min-w-0 max-w-full truncate px-4 text-sm">{title}</SheetTrigger><SheetContent side={side} className="h-[85dvh] max-h-dvh pb-safe" aria-describedby={undefined}><SheetTitle className="px-4 pt-4">{title}</SheetTitle><div onClick={e => { if ((e.target as HTMLElement).closest("a[href]")) setOpen(false); }} className="min-h-0 flex-1 overflow-auto">{children}</div></SheetContent></Sheet>;
}
