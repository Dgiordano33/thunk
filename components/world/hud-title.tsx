"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { isProjectPath, PROJECTS_PATH } from "@/lib/routes";

/** Top-left of the HUD: the logo on the world map; a way back to it inside a town. */
export function HudTitle({ projects, noteCount }: { projects: { slug: string; name: string }[]; noteCount: number }) {
  const pathname = usePathname();
  const [, section] = pathname.split("/");

  if (isProjectPath(pathname)) {
    const town = projects.find((p) => p.slug === section);
    return (
      <>
        <Link href={PROJECTS_PATH} className="pixel hover:bg-muted flex items-center gap-1.5 px-1 text-sm" aria-label="Back to the world map">
          <ArrowLeftIcon className="size-4" /> World
        </Link>
        <h1 className="pixel border-l pl-3 text-base">{town?.name ?? "Town"}</h1>
      </>
    );
  }
  if (section === "routines" || section === "inbox") {
    return (
      <>
        <Link href={PROJECTS_PATH} className="pixel hover:bg-muted flex items-center gap-1.5 px-1 text-sm" aria-label="Back to the world map">
          <ArrowLeftIcon className="size-4" /> World
        </Link>
        <h1 className="pixel border-l pl-3 text-base">{section === "inbox" ? "Inbox" : "Routines"}</h1>
      </>
    );
  }
  if (section === "notes") {
    return (
      <>
        <Link href={PROJECTS_PATH} className="pixel hover:bg-muted flex items-center gap-1.5 px-1 text-sm" aria-label="Back to the world map">
          <ArrowLeftIcon className="size-4" /> World
        </Link>
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
