"use client";
import { Sphere } from "@/components/space/sphere";
import { PLANET_PALETTES } from "@/lib/world/system";
import { TownCenterSprite, FarmhouseSprite, FarmField } from "@/components/town/sprites";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useLook } from "@/components/look-context";
import { useIsDesktop } from "@/components/mobile/viewport";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "./provider";
import { AgentStatus } from "./agent-status";
export function MapMark({ level, closed = false }: { level: number; closed?: boolean }) {
  const { look } = useLook();
  return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center [&>svg]:max-h-10 [&>svg]:max-w-10">{look === "world" ? (level === 0 ? <TownCenterSprite /> : level === 1 ? <FarmhouseSprite hue={250} /> : <FarmField stage={2} hue={250} selected={false} fallow={closed} />) : level < 2 ? <Sphere r={level === 0 ? 15 : 10} palette={PLANET_PALETTES[level]} light={-0.8} bands={level === 0} /> : <span className={`satellite block size-3 rounded-full ${closed ? "is-closed" : "is-open"}`} />}</span>;
}
export function Hierarchy({ nested = false }: { nested?: boolean }) {
  const { look } = useLook();
  const labels = look === "world" ? ["City", "Farm", "Field"] : ["Planet", "Moon", "Satellite"];
  const rows = ["Project", "Workspace", "Session"];
  const row = (i: number): React.ReactNode => <><div className="flex items-center gap-2"><MapMark level={i} /><span><strong>{rows[i]}</strong> · {labels[i]}</span></div>{nested && i < 2 && <div className="ml-5 rounded border p-2">{row(i + 1)}</div>}</>;
  return nested ? <div className="rounded border p-2 text-sm" aria-label="Project, Workspace, Session hierarchy">{row(0)}</div> : <ol className="space-y-1 text-sm">{rows.map((term, i) => <li key={term} className="flex items-center gap-2"><MapMark level={i} /><span><strong>{term}</strong> · {labels[i]}</span></li>)}</ol>;
}
export function Intro({ hasProjects }: { hasProjects: boolean }) {
  const onboarding = useOnboarding();
  const pathname = usePathname();
  const desktop = useIsDesktop();
  const open = pathname === "/projects" && !onboarding.seen("intro");
  const [step, setStep] = useState(0);
  const close = () => { onboarding.markSeen("intro"); setStep(0); };
  const title = ["How work is organised", "Where context lives", "Your agents and setup"][step];
  const content = <div className="space-y-5" onKeyDown={(e) => {
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setStep((s) => Math.max(0, Math.min(2, s + (e.key === "ArrowRight" ? 1 : -1)))); }
  }}>
    {desktop ? <><DialogTitle>{title}</DialogTitle><DialogDescription>A quick introduction to Thunk.</DialogDescription></> : <><SheetTitle>{title}</SheetTitle><SheetDescription>A quick introduction to Thunk.</SheetDescription></>}
    {step === 0 && <div className="space-y-3 text-sm"><p><strong>Project:</strong> a home for your repos or folders.</p><p><strong>Workspace:</strong> one task inside a project, in place or in its own git worktree.</p><p><strong>Session:</strong> one chat in a workspace.</p>{desktop && <Hierarchy nested />}</div>}
    {step === 1 && <div className="space-y-3 text-sm"><p><strong>Notes:</strong> plans and notebooks that you and agents both read and write.</p><p><strong>Tasks:</strong> the work list; send a task to a session.</p><p><strong>Routines:</strong> agent sessions that start on a schedule or event.</p><p>Agents read all of this, so write it down once.</p></div>}
    {step === 2 && <div className="space-y-3 text-sm"><AgentStatus /><p>Project instructions and connectors live in project settings.</p><p>A <code>thunk.json</code> in the repo sets Setup and Run scripts and notebooks.</p></div>}
    <div className="flex items-center justify-center gap-2" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map((i) => <span key={i} aria-hidden="true" className={`size-2 rounded-full ${step === i ? "bg-foreground" : "bg-muted-foreground/30"}`} />)}</div>
    <div className="flex flex-wrap gap-2"><Button className="max-md:self-start" variant="ghost" onClick={close}>Skip</Button><div className="ml-auto flex gap-2">{step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}{step < 2 ? <Button onClick={() => setStep(step + 1)}>Next</Button> : <Button onClick={() => { close(); if (!hasProjects) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-add-project]")?.click()); }}>{hasProjects ? "Done" : "Add your first project"}</Button>}</div></div>
  </div>;
  return desktop ? <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}><DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-lg">{content}</DialogContent></Dialog> : <Sheet open={open} onOpenChange={(value) => { if (!value) close(); }}><SheetContent side="bottom" className="max-h-[90dvh] overflow-auto p-5 pb-[max(4rem,env(safe-area-inset-bottom))]">{content}</SheetContent></Sheet>;
}
