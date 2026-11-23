"use client";
import Link from "next/link";
export function MobileTopBar({ title, back = "/projects", backLabel = "Back", actions }: { title: string; back?: string | null; backLabel?: string; actions?: React.ReactNode }) {
  return <header className="pt-safe bg-background fixed inset-x-0 top-0 z-40 flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b px-3">{back ? <Link href={back} aria-label={backLabel} title={backLabel} className="hover:bg-muted focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 world:rounded-none">←</Link> : <span className="w-1 shrink-0" />}<h1 className="min-w-0 flex-1 truncate font-medium">{title}</h1>{actions}</header>;
}
