"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

/** Top-left of the HUD: the logo and a count on the world map; a way back to it inside a town. */
export function HudTitle({ projects, noteCount }: { projects: { id: string; name: string }[]; noteCount: number }) {
  const pathname = usePathname();
  const [, section, id] = pathname.split("/");
  const town = section === "p" ? projects.find((p) => p.id === id) : undefined;

  if (section === "p") {
    return (
      <>
        <Link href="/" className="pixel hover:bg-muted flex items-center gap-1.5 px-1 text-sm" aria-label="Back to the world map">
          <ArrowLeftIcon className="size-4" /> World
        </Link>
        <h1 className="pixel border-l pl-3 text-base">{town?.name ?? "Town"}</h1>
      </>
    );
  }
  if (section === "notes") {
    return (
      <>
        <Link href="/" className="pixel hover:bg-muted flex items-center gap-1.5 px-1 text-sm" aria-label="Back to the world map">
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
      <span className="pixel text-muted-foreground border-l pl-3 text-sm">
        Known world · {projects.length} {projects.length === 1 ? "city" : "cities"}
      </span>
    </>
  );
}
