"use client";

import Link from "next/link";
import { ArrowLeftIcon, BrainIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CivPanel } from "@/components/world/civ-panel";
import { FloatingWindow, WindowControls, useWindowHandle } from "@/components/world/floating-window";
import { ProposalReview } from "./proposal-review";

/** The memory proposal review screen, opened from its Inbox card. A floating panel in Solar, a full pane in Vanilla. */
export function ProposalPage({ proposalId }: { proposalId: string }) {
  const handle = useWindowHandle();
  return <FloatingWindow className="absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex flex-col md:inset-x-auto md:left-[calc(50%-24rem)] md:top-20 md:bottom-4 md:w-3xl">
    <CivPanel className="min-h-0 flex-1" bodyClassName="flex h-full min-h-0 flex-col">
      <header {...handle} className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Button asChild size="icon" variant="ghost" aria-label="Back to Inbox"><Link href="/inbox"><ArrowLeftIcon /></Link></Button>
        <BrainIcon aria-hidden="true" className="text-muted-foreground size-4" />
        <h1 className="text-base font-medium">Memory update</h1>
        <span className="ml-auto"><WindowControls /></span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"><ProposalReview proposalId={proposalId} /></div>
    </CivPanel>
  </FloatingWindow>;
}
