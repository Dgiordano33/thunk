"use client";
import Link from "next/link";
export function MobileTopBar({ title, back = "/projects", actions }: { title: string; back?: string | null; actions?: React.ReactNode }) {
  return <header className="pt-safe bg-background fixed inset-x-0 top-0 z-40 flex min-h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b px-3">{back ? <Link href={back} aria-label="Back" className="flex size-11 shrink-0 items-center justify-center">←</Link> : <span className="w-1 shrink-0" />}<h1 className="min-w-0 flex-1 truncate font-medium">{title}</h1>{actions}</header>;
}
