import Link from "next/link";
import { ResponsiveView } from "./viewport";

export function DesktopOnly({ children, href = "/projects" }: { children: React.ReactNode; href?: string }) {
  return <ResponsiveView mobile={<div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center"><h1>Open this on a larger screen</h1><Link className="min-h-11 underline" href={href}>Go back</Link></div>}>{children}</ResponsiveView>;
}
