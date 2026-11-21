"use client";
import { useOnboarding } from "./provider";
import { Button } from "@/components/ui/button";
import type { HintKey } from "@/lib/onboarding";
export function OnboardingHint({ name, children }: { name: HintKey; children: React.ReactNode }) {
  const { seen, markSeen } = useOnboarding();
  if (seen(name)) return null;
  return <div className="my-2 rounded border bg-muted/40 p-3 text-xs"><div>{children}</div><Button variant="ghost" size="xs" type="button" onClick={() => markSeen(name)}>Got it</Button></div>;
}
