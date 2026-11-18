"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { SettingsMenu } from "@/components/ambient/settings-menu";
import type { SidebarProject } from "@/components/layout/app-sidebar";
export function MobileTabBar({ count, projects }: { count: number; projects: SidebarProject[] }) {
  const pathname = usePathname();
  return <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t bg-background">
    {[["/projects", "Projects"], ["/inbox", `Inbox${count ? ` (${count})` : ""}`], ["/notes", "Notes"]].map(([href, title]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className="flex min-h-14 flex-1 items-center justify-center text-sm aria-[current=page]:font-bold">{title}</Link>)}
    <Sheet><SheetTrigger className="min-h-14 flex-1 text-sm">More</SheetTrigger><SheetContent side="bottom" className="pb-safe" aria-describedby={undefined}><SheetTitle className="p-4">More</SheetTitle><SheetClose asChild><Link className="p-4" href="/routines">Routines</Link></SheetClose><SheetClose asChild><Link className="p-4" href="/vault">Vault</Link></SheetClose><SettingsMenu projects={projects} /></SheetContent></Sheet>
  </nav>;
}
