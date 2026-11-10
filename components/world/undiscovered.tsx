import Link from "next/link";
import { CivPanel } from "./civ-panel";
import { PixelIcon, type PixelIconName } from "./pixel-icon";

/** Placeholder for sections that don't exist yet: fog of war over an empty map. */
export function Undiscovered({ title, icon, children }: { title: string; icon: PixelIconName; children: React.ReactNode }) {
  return (
    <main className="fog absolute inset-0 flex items-center justify-center p-6">
      <CivPanel parchment className="w-full max-w-md" bodyClassName="flex flex-col items-center px-8 py-8 text-center">
        <PixelIcon name={icon} className="mb-4 size-14" />
        <p className="pixel text-xs tracking-widest uppercase opacity-60">{title}</p>
        <h1 className="pixel mt-1 text-3xl">Not yet discovered</h1>
        <p className="mt-3 text-sm leading-relaxed opacity-80">{children}</p>
        <Link href="/projects" className="pixel mt-6 text-sm underline underline-offset-4 hover:opacity-80">
          ← Return to the map
        </Link>
      </CivPanel>
    </main>
  );
}
