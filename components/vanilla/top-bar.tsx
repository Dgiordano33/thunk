"use client";

import { usePathname } from "next/navigation";
import { AmbientHub } from "@/components/ambient/ambient-hub";
import { CaptureTrigger } from "@/components/capture/capture-bar";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { Logo } from "@/components/logo";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { HudTitle } from "@/components/world/hud-title";
import { worldBreadcrumbs } from "@/components/world/navigation";
import { PROJECTS_PATH } from "@/lib/routes";

/** Vanilla's bar across the top of the desktop window: the logo, Search in the middle, and Relay on the right. */
export function VanillaTopBar({ projects }: { projects: SidebarProject[] }) {
  return (
    <header id="top-bar" className="bg-sidebar text-sidebar-foreground grid h-12 shrink-0 grid-cols-[1fr_minmax(0,28rem)_1fr] items-center gap-4 border-b px-4">
      <Link href={PROJECTS_PATH} className="focus-visible:ring-sidebar-ring flex items-center justify-self-start rounded-sm outline-none focus-visible:ring-2"><span className="sr-only">Thunk</span><Logo className="h-6 w-auto" /></Link>
      <AmbientHub projects={projects} variant="bar" />
      <CaptureTrigger variant="sidebar" className="h-8 w-auto justify-self-end" />
    </header>
  );
}

/** The route back up from a section or project page. The Projects list is the top level, and its heading already names it. */
export function VanillaBreadcrumbs({ projects, noteCount }: { projects: { slug: string; name: string }[]; noteCount: number }) {
  const pathname = usePathname();
  if (worldBreadcrumbs(pathname, projects, false).length === 1) return null;
  return <div className="flex h-12 shrink-0 items-center border-b px-6"><HudTitle projects={projects} noteCount={noteCount} heading={false} /></div>;
}
