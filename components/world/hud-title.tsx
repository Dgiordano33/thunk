"use client";

import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { IntentLink as Link } from "@/components/navigation/intent-link";
import { usePathname } from "next/navigation";
import { useLook } from "@/components/look-context";
import { Logo } from "@/components/logo";
import { worldBreadcrumbs } from "./navigation";

/** A consistent route back through the map, project and section hierarchy. */
export function HudTitle({ projects, noteCount }: { projects: { slug: string; name: string }[]; noteCount: number }) {
  const pathname = usePathname();
  const crumbs = worldBreadcrumbs(pathname, projects, useLook().look === "world");
  if (crumbs.length === 1) {
    return <h1><span className="sr-only">Thunk</span><Logo className="h-6 w-auto" /></h1>;
  }

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />}
              {current ? (
                <h1 aria-current="page" className="pixel truncate px-1 font-medium" title={crumb.label}>
                  {crumb.label}
                  {pathname === "/notes" && <span className="text-muted-foreground ml-2 text-xs font-normal tabular-nums">{noteCount} {noteCount === 1 ? "note" : "notes"}</span>}
                </h1>
              ) : (
                <Link href={crumb.href} title={crumb.label} className="pixel text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-1.5 outline-none focus-visible:ring-2 active:scale-[0.97] world:rounded-none">
                  {index === 0 && <ArrowLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />}
                  <span className="truncate">{crumb.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
