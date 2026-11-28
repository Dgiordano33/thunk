"use client";
import Image from "next/image";
import { Sphere } from "@/components/space/sphere";
import { PLANET_PALETTES } from "@/lib/world/system";
import { FolderIcon, GitBranchIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useLook } from "@/components/look-context";
import { useIsDesktop } from "@/components/mobile/viewport";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "./provider";
import { AgentStatus } from "./agent-status";
import { HandoffScene } from "./handoff-scene";
import { Kbd } from "@/components/ui/kbd";
import { label as shortcutLabel, useIsMac } from "@/lib/capture/shortcut";
import { useUi } from "@/lib/store/ui-store";
const LAST = 4;
/** Vanilla's plain version of the handoff scene. */
function Handoff() {
  const steps = [["You relay", "a thought or a note"], ["The chief splits it", "one task per item"], ["Workers build", "each in its own worktree"], ["You decide", "in the Inbox"]];
  return <ol aria-label="How work is handed off" className="grid grid-cols-4 gap-2 text-xs space:hidden">{steps.map(([title, detail], i) => <li key={title} className="rounded border p-2"><span className="text-muted-foreground block">{i + 1}</span><strong className="block">{title}</strong><span className="text-muted-foreground block">{detail}</span></li>)}</ol>;
}
export function MapMark({ level, closed = false }: { level: number; closed?: boolean }) {
  const { look } = useLook();
  return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center [&>svg]:max-h-10 [&>svg]:max-w-10">{look === "vanilla" ? (level === 0 ? <FolderIcon /> : level === 1 ? <GitBranchIcon /> : <MessageSquareIcon />) : level < 2 ? <Sphere r={level === 0 ? 15 : 10} palette={PLANET_PALETTES[level]} light={-0.8} bands={level === 0} /> : <span className={`satellite block size-3 rounded-full ${closed ? "is-closed" : "is-open"}`} />}</span>;
}
export function Hierarchy({ nested = false }: { nested?: boolean }) {
  const { look } = useLook();
  const labels = look === "space" ? ["Planet", "Moon", "Satellite"] : null;
  const rows = ["Project", "Workspace", "Session"];
  const row = (i: number): React.ReactNode => <><div className="flex items-center gap-2"><MapMark level={i} /><span><strong>{rows[i]}</strong>{labels && <> · {labels[i]}</>}</span></div>{nested && i < 2 && <div className="ml-5 rounded border p-2">{row(i + 1)}</div>}</>;
  return nested ? <div className="rounded border p-2 text-sm" aria-label="Project, Workspace, Session hierarchy">{row(0)}</div> : <ol className="space-y-1 text-sm">{rows.map((term, i) => <li key={term} className="flex items-center gap-2"><MapMark level={i} /><span><strong>{term}</strong>{labels && <> · {labels[i]}</>}</span></li>)}</ol>;
}
export function Intro({ hasProjects }: { hasProjects: boolean }) {
  const onboarding = useOnboarding();
  const { look, setLook } = useLook();
  const pathname = usePathname();
  const desktop = useIsDesktop();
  const open = pathname === "/projects" && !onboarding.seen("intro");
  const [step, setStep] = useState(0);
  const shortcut = useUi((s) => s.captureShortcut);
  const mac = useIsMac();
  const keys = shortcut && mac !== null ? shortcutLabel(shortcut, mac) : "";
  const close = () => { onboarding.markSeen("intro"); setStep(0); };
  const title = ["Choose your theme", "How work is organised", "Where context lives", "Write it down, relay it", "Your agents and setup"][step];
  const content = <div className="space-y-5" onKeyDown={(e) => {
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setStep((s) => Math.max(0, Math.min(LAST, s + (e.key === "ArrowRight" ? 1 : -1)))); }
  }}>
    {desktop ? <><DialogTitle>{title}</DialogTitle><DialogDescription>A quick introduction to Thunk.</DialogDescription></> : <><SheetTitle>{title}</SheetTitle><SheetDescription>A quick introduction to Thunk.</SheetDescription></>}
    {step === 0 && <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        {([
          { value: "space", name: "Space", image: "space", detail: "Explore projects on a planet map." },
          { value: "vanilla", name: "Plain", image: "plain", detail: "Browse projects in a sidebar and list." },
        ] as const).map((option) => (
          <Button
            key={option.value}
            variant={look === option.value ? "default" : "outline"}
            className="h-auto min-w-0 flex-col items-stretch justify-start gap-0 overflow-hidden whitespace-normal p-0 text-left"
            onClick={() => {
              if (look !== option.value) setLook(option.value);
              setStep(1);
            }}
          >
            <Image src={`/onboarding/${option.image}.webp`} alt="" width={1120} height={690} unoptimized className="w-full border-b" />
            <span className="p-3">
              <span className="block font-medium">{look === option.value ? "Continue in" : "Switch to"} {option.name}</span>
              <span className="mt-1 block text-xs font-normal">{option.detail}</span>
            </span>
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">You can switch later in Settings → Appearance.</p>
    </div>}
    {step === 1 && <div className="space-y-3 text-sm"><p><strong>Project:</strong> a home for your chats, notes, canvases, tasks, and repos.</p><p><strong>Workspace:</strong> a clean environment created automatically when an agent starts an effort.</p><p><strong>Session:</strong> a chat with its own workspace. Agents on the same canvas share its workspace.</p>{desktop && <Hierarchy nested />}</div>}
    {step === 2 && <div className="space-y-3 text-sm"><p><strong>Notes:</strong> plans and notebooks that you and agents both read and write.</p><p><strong>Tasks:</strong> the work list; send a task to a session.</p><p><strong>Canvas:</strong> boards of cards, images and charts that you and agents build together.</p><p><strong>Vault:</strong> docs, screenshots and transcripts you upload for agents to read.</p><p><strong>Memory:</strong> what agents learn as they work. Harvest keeps a workspace&apos;s memory in the project when the workspace goes.</p><p><strong>Routines:</strong> agent sessions that start on a schedule or event.</p><p>Agents read all of this, so write it down once.</p></div>}
    {step === 3 && <div className="space-y-3 text-sm">
      <p>What you write becomes work agents do in the background, and comes back to you as decisions.</p>
      <HandoffScene />
      {desktop && <Handoff />}
      <p><strong>Relay a thought:</strong> {!desktop ? "tap Relay" : keys ? <>press <Kbd>{keys}</Kbd> on any page</> : "click the Relay bar"}, type it and press Enter. Thunk picks the project and hands it to that project&apos;s chief.</p>
      <p><strong>Relay a note:</strong> write a plan with a checklist, then choose Relay. The chief turns each unchecked item into a task.</p>
      <p><strong>Chief:</strong> the one session in each project that coordinates. It never edits code. It decides what a relay needs (a note, something on a canvas, tasks, a workspace, one worker or several), and hears back from its workers. Nothing merges on its own.</p>
      <p><strong>Inbox:</strong> the chief&apos;s answer arrives there as a message. Reply to keep going, or mark it done.</p>
    </div>}
    {step === LAST && <div className="space-y-3 text-sm"><AgentStatus /><p>Project instructions and connectors live in project settings.</p><p>A <code>thunk.json</code> in the repo sets Setup and Run scripts and notebooks.</p></div>}
    <div className="flex items-center justify-center gap-2" aria-label={`Step ${step + 1} of ${LAST + 1}`}>{Array.from({ length: LAST + 1 }, (_, i) => i).map((i) => <span key={i} aria-hidden="true" className={`size-2 rounded-full ${step === i ? "bg-foreground" : "bg-muted-foreground/30"}`} />)}</div>
    <div className="flex flex-wrap gap-2"><Button className="max-md:self-start" variant="ghost" onClick={close}>Skip</Button><div className="ml-auto flex gap-2">{step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}{step === 0 ? null : step < LAST ? <Button onClick={() => setStep(step + 1)}>Next</Button> : <Button onClick={() => { close(); if (!hasProjects) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-add-project]")?.click()); }}>{hasProjects ? "Done" : "Add your first project"}</Button>}</div></div>
  </div>;
  return desktop ? <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}><DialogContent className={`max-h-[85dvh] overflow-auto ${step === 0 ? "sm:max-w-5xl" : "sm:max-w-lg"}`}>{content}</DialogContent></Dialog> : <Sheet open={open} onOpenChange={(value) => { if (!value) close(); }}><SheetContent side="bottom" className="max-h-[90dvh] overflow-auto p-5 pb-[max(4rem,env(safe-area-inset-bottom))]">{content}</SheetContent></Sheet>;
}
