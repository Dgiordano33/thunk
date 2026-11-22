"use client";

import { ArrowUpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/store/session-store";

/**
 * Phones only: a strip above the composer while a request waits on the person and its card is scrolled out of view.
 * Approvals sit in the timeline, so on a small screen they are easy to scroll past.
 */
export function PendingBar() {
  const req = useSession((s) => {
    for (const r of Object.values(s.requests)) {
      // A worker's question the chief is still handling isn't the person's to answer yet.
      if (r.status === "pending" && !(r.kind === "question" && r.routedTo === "chief" && !r.escalation)) return r;
    }
  });
  const target = req ? (req.kind === "plan" ? `doc-${req.documentId}` : `req-${req.id}`) : null;
  const [onScreen, setOnScreen] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let observer: IntersectionObserver | undefined;
    // The card mounts with the timeline, a frame after the request arrives.
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el) return;
      observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting ? target : null), { threshold: 0.2 });
      observer.observe(el);
    });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [target]);

  if (!req || !target || onScreen === target) return null;
  const label = req.kind === "permission" ? `${req.toolName} needs your permission` : req.kind === "question" ? "A question is waiting for you" : "A plan is ready for review";
  return (
    <div role="status" className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 px-4 md:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--status-attention)]/50 bg-[var(--status-attention-soft)] py-1 pr-1 pl-3 text-sm">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--status-attention)]" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Button size="sm" variant="outline" className="bg-background shrink-0" onClick={() => document.getElementById(target)?.scrollIntoView({ block: "center", behavior: "smooth" })}>
          <ArrowUpIcon /> Review
        </Button>
      </div>
    </div>
  );
}
