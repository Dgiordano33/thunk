import Link from "next/link";
import { EmptyMark } from "@/components/space/orbit-mark";
import { CivPanel } from "@/components/world/civ-panel";

/** Any unknown URL: the same empty-state frame as the rest of the app, on the sky (or the fog, in the game look). */
export default function NotFound() {
  return (
    <main className="fog relative flex h-full min-h-full w-full items-center justify-center p-6">
      <CivPanel parchment className="w-full max-w-md" bodyClassName="flex flex-col items-center px-8 py-8 text-center">
        <EmptyMark name="castle" className="mb-4" pixelClassName="mb-4 size-14" />
        <p className="pixel text-xs tracking-widest uppercase opacity-60">404</p>
        <h1 className="pixel mt-1 text-3xl">Page not found</h1>
        <p className="mt-3 text-sm leading-relaxed opacity-80">This page doesn’t exist, or the project or workspace it belonged to was removed.</p>
        <Link href="/projects" className="pixel mt-6 text-sm underline underline-offset-4 hover:opacity-80">
          ← Back to your projects
        </Link>
      </CivPanel>
    </main>
  );
}
