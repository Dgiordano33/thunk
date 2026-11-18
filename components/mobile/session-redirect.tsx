"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
export function MobileSessionRedirect({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(href); }, [href, router]);
  return <Link className="block p-20" href={href}>Open session</Link>;
}
