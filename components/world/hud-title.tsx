"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLook } from "@/components/look-context";
import { Logo } from "@/components/logo";
import { projectSlugFromPath, isProjectPath, PROJECTS_PATH } from "@/lib/routes";

/** Top-left of the HUD: the logo on the projects map; a way back to it from a project or section. */
export function HudTitle({ projects, noteCount }: { projects: { slug: string; name: string }[]; noteCount: number }) {
  const pathname = usePathname();
  const [, section] = pathname.split("/");
  const world = useLook().look === "world";
  const back = (
    <Link href={PROJECTS_PATH} className="pixel hover:bg-muted flex items-center gap-1.5 rounded-md px-1 text-sm world:rounded-none" aria-label={world ? "Back to the world map" : "Back to all projects"}>
      <ArrowLeftIcon className="size-4" /> {world ? "World" : "Projects"}
    </Link>
  );

  if (isProjectPath(pathname)) {
    const town = projects.find((p) => p.slug === projectSlugFromPath(pathname));
    return (
      <>
        {back}
        <h1 className="pixel border-l pl-3 text-base font-medium world:font-normal">{town?.name ?? "Project"}</h1>
      </>
    );
  }
  if (section === "routines" || section === "inbox") {
    return (
      <>
        {back}
        <h1 className="pixel border-l pl-3 text-base">{section === "inbox" ? "Inbox" : "Routines"}</h1>
      </>
    );
  }
  if (section === "notes") {
    return (
      <>
        {back}
        <h1 className="pixel border-l pl-3 text-base">
          Library · <span className="tabular-nums">{noteCount}</span> {noteCount === 1 ? "note" : "notes"}
        </h1>
      </>
    );
  }
  return (
    <>
      <h1>
        <span className="sr-only">Thunk</span>
        <Logo className="h-6 w-auto" />
      </h1>
    </>
  );
}
