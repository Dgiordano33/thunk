"use client";

import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { relativeTime } from "@/components/session/labels";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CONTROL_BUTTON, IsoViewport } from "@/components/world/iso-viewport";
import { needsPerson } from "@/lib/agent/types";
import { deliveryCue } from "@/lib/projects/delivery-types";
import { useAmbient } from "@/lib/store/ambient-store";
import { cn } from "@/lib/utils";
import { CORE_RADIUS, SATELLITE_RADIUS, SATELLITE_RINGS, SPEND_THRESHOLDS, type PlanetLayout, type SpendStep } from "@/lib/world/planet";
import { TILT, planetPalette } from "@/lib/world/system";
import { Sphere } from "./sphere";
import { StatusBadge, type Tone } from "./status";
import { Orbits } from "./system-map";

export type PlanetMoon = {
  id: string;
  label: string;
  branch: string | null;
  hasGit?: boolean;
  sessionCount: number;
  overflow: number;
  lastActivityAt: string;
  x: number;
  y: number;
};

export type PlanetSatellite = {
  id: string;
  workspaceId: string;
  title: string | null;
  model: string;
  createdAt: string;
  costUsd: number;
  step: SpendStep;
  closed: boolean;
  x: number;
  y: number;
};

export type PlanetSection = { key: string; label: string; href: string; count?: number; attention?: boolean; selected?: boolean };
export type PlanetSelection = { session?: string; ws?: string };

type Live = { status: string; pending: number; waitingOn?: "chief" | null };
type Cue = NonNullable<ReturnType<typeof deliveryCue>>;

/** Light falls from the upper left in the planet view. */
const LIGHT = -2.3;
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

export function PlanetView({
  projectId,
  projectName,
  baseHref,
  overviewHref,
  layout,
  moons,
  satellites,
  sections,
  selected,
  live: liveOverride,
  cues,
  children,
}: {
  projectId: string;
  projectName: string;
  /** This project's page; selection is added as query parameters. */
  baseHref: string;
  overviewHref: string;
  layout: Pick<PlanetLayout, "w" | "h" | "core" | "orbits">;
  moons: PlanetMoon[];
  satellites: PlanetSatellite[];
  sections: PlanetSection[];
  selected: PlanetSelection & { overview?: boolean };
  /** Design mocks: live session state instead of the ambient feed. */
  live?: Record<string, Live>;
  cues?: Record<string, Cue | null>;
  children?: React.ReactNode;
}) {
  const sessions = useAmbient((s) => s.sessions);
  const deliveries = useAmbient((s) => s.deliveries);
  const runs = useAmbient((s) => s.runs);
  const routineAttention = runs.some((r) => r.projectId === projectId && r.status === "needs_attention");
  const live = new Map<string, Live>(liveOverride ? Object.entries(liveOverride) : sessions.map((s) => [s.id, s]));
  const toneOf = (id: string, closed: boolean): Tone => {
    const l = live.get(id);
    if (!l) return null;
    if (l.status === "error") return "error";
    if (closed || l.status === "closed") return null;
    if (l.pending > 0 || needsPerson(l)) return "attention";
    if (l.status === "running" || l.status === "starting") return "running";
    return null;
  };
  const moonTone = (wsId: string): Tone => {
    const tones = satellites.filter((s) => s.workspaceId === wsId).map((s) => toneOf(s.id, s.closed));
    return tones.includes("attention") ? "attention" : tones.includes("error") ? "error" : tones.includes("running") ? "running" : null;
  };
  const projectTone = moons.map((m) => moonTone(m.id));
  const coreTone: Tone = projectTone.includes("attention") ? "attention" : projectTone.includes("error") ? "error" : null;
  // The core sits in the middle, so fitting the whole system on open also centres it.
  const { w, h, core } = layout;
  const link = (q: string) => `${baseHref}${baseHref.includes("?") ? "&" : "?"}${q}`;

  return (
    <div className="space absolute inset-0">
      <IsoViewport
        width={w}
        height={h}
        label={`${projectName}: workspaces and sessions`}
        stage={
          <>
            <Orbits w={w} h={h} radii={layout.orbits} star={false} />
            <svg width={w} height={h} className="absolute inset-0" aria-hidden="true">
              {moons.filter((m) => m.sessionCount > 0).flatMap((m) =>
                SATELLITE_RINGS.map(({ r }) => (
                  <ellipse key={`${m.id}-${r}`} cx={m.x} cy={m.y} rx={r} ry={r * TILT} fill="none" stroke="var(--orbit)" strokeOpacity={0.5} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
                )),
              )}
            </svg>
            <Core projectId={projectId} name={projectName} x={core.x} y={core.y} href={overviewHref} selected={!!selected.overview} tone={coreTone} />
            {moons.map((m) => {
              const delivery = deliveries.find((d) => d.workspaceId === m.id);
              const cue = cues ? cues[m.id] ?? null : m.hasGit === false ? null : deliveryCue(delivery?.status.pr ?? null);
              return <Moon key={m.id} moon={m} href={link(`ws=${m.id}`)} selected={selected.ws === m.id} tone={moonTone(m.id)} cue={cue} serving={!!delivery?.running} />;
            })}
            {satellites.map((s) => (
              <Satellite
                key={s.id}
                sat={s}
                workspace={moons.find((m) => m.id === s.workspaceId)?.label ?? ""}
                href={link(`session=${s.id}`)}
                selected={selected.session === s.id}
                tone={toneOf(s.id, s.closed)}
                closed={s.closed || live.get(s.id)?.status === "closed"}
              />
            ))}
          </>
        }
        controls={<Legend />}
      >
        <SectionDock sections={routineAttention ? sections.map((s) => (s.key === "routines" ? { ...s, attention: true } : s)) : sections} />
        {children}
      </IsoViewport>
    </div>
  );
}

function Core({ projectId, name, x, y, href, selected, tone }: { projectId: string; name: string; x: number; y: number; href: string; selected: boolean; tone: Tone }) {
  const r = CORE_RADIUS;
  return (
    <Link
      href={href}
      scroll={false}
      draggable={false}
      aria-label={`${name} overview${tone === "attention" ? ", needs attention" : tone === "error" ? ", a session failed" : ""}`}
      aria-current={selected ? "page" : undefined}
      className="group absolute flex flex-col items-center outline-none"
      style={{ left: x, top: y, transform: `translate(-50%, -${r}px)`, zIndex: Math.round(y) }}
    >
      <span className="relative flex items-center justify-center" style={{ width: 2 * r, height: 2 * r }}>
        <span className="absolute flex items-center justify-center">
          <Sphere r={r} palette={planetPalette(projectId)} light={LIGHT} bands ringed={false} />
        </span>
        <span className={cn("absolute rounded-full ring-(--ring) ring-offset-(--void) group-focus-visible:ring-2 group-focus-visible:ring-offset-4", selected && "ring-2 ring-offset-4 ring-(--foreground)/70")} style={{ inset: -2 }} />
      </span>
      <span className="planet-label mt-3 flex flex-col items-center gap-1 whitespace-nowrap">
        <span className="text-base leading-5 font-semibold">{name}</span>
        {tone ? <StatusBadge tone={tone} /> : <span className="text-muted-foreground text-[11px] group-hover:text-foreground">Overview</span>}
      </span>
    </Link>
  );
}

/** Labels hang below the satellites' outer loop, so session dots never sit on the text. */
const LABEL_DROP = SATELLITE_RINGS[SATELLITE_RINGS.length - 1].r * TILT + 6;

const Moon = memo(function Moon({ moon, href, selected, tone, cue, serving }: { moon: PlanetMoon; href: string; selected: boolean; tone: Tone; cue: Cue | null; serving: boolean }) {
  const r = 11 + Math.min(5, moon.sessionCount) * 0.8;
  const branch = moon.branch && moon.branch !== moon.label ? moon.branch : null;
  return (
    <HoverCard openDelay={150} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          scroll={false}
          draggable={false}
          aria-label={`Workspace ${moon.label}${cue ? `, ${cue.label}` : ""}${tone === "attention" ? ", needs attention" : tone === "running" ? ", running" : tone === "error" ? ", error" : ""}${serving ? ", dev server running" : ""}`}
          aria-current={selected ? "page" : undefined}
          className="group absolute flex flex-col items-center outline-none"
          style={{ left: moon.x, top: moon.y, transform: `translate(-50%, -${r}px)`, zIndex: Math.round(moon.y) + 1 }}
        >
          <span className="relative flex items-center justify-center" style={{ width: 2 * r, height: 2 * r }}>
            {tone === "running" && <span className="orbit-pulse absolute rounded-full" style={{ inset: -5 }} />}
            <span className="absolute flex items-center justify-center transition-transform duration-150 group-hover:scale-110">
              <Sphere r={r} palette={planetPalette(moon.id)} light={LIGHT} />
            </span>
            <span className={cn("absolute rounded-full ring-(--ring) ring-offset-(--void) group-focus-visible:ring-2 group-focus-visible:ring-offset-2", selected && "ring-2 ring-offset-2 ring-(--foreground)/70")} style={{ inset: -3 }} />
          </span>
          <span className="planet-label flex flex-col items-center gap-0.5 whitespace-nowrap" style={{ marginTop: moon.sessionCount ? LABEL_DROP - r : 6 }}>
            <span className="flex items-center gap-1.5 text-[13px] leading-4 font-medium">
              {moon.label}
              {serving && <span className="status-dot is-ok" title="Dev server running" />}
            </span>
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] leading-4">
              {branch && <span className="max-w-36 truncate font-mono">{branch}</span>}
              {cue && <span className={cn("status-cue", `is-${cue.kind}`)} title={cue.label}>{cue.symbol} {cue.kind === "pass" ? "PR" : cue.kind === "fail" ? "PR failing" : cue.kind === "pending" ? "checks" : cue.kind === "draft" ? "draft" : "PR"}</span>}
              {moon.overflow > 0 && <span className="tabular-nums">+{moon.overflow}</span>}
            </span>
            {tone && tone !== "running" && <StatusBadge tone={tone} />}
          </span>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={12} className="w-64 text-xs">
        <p className="text-sm font-medium">{moon.label}</p>
        {moon.branch && <p className="text-muted-foreground truncate font-mono text-[11px]">{moon.branch}</p>}
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Sessions</dt>
          <dd className="text-right tabular-nums">{moon.sessionCount}</dd>
          {cue && <><dt className="text-muted-foreground">Pull request</dt><dd className="text-right">{cue.label}</dd></>}
          <dt className="text-muted-foreground">Last activity</dt>
          <dd className="text-right">{relativeTime(moon.lastActivityAt)}</dd>
        </dl>
        {moon.overflow > 0 && <p className="text-muted-foreground mt-2">{moon.overflow} older sessions are listed in the panel.</p>}
        <p className="mt-2 text-right font-medium">Open workspace →</p>
      </HoverCardContent>
    </HoverCard>
  );
});

const Satellite = memo(function Satellite({ sat, workspace, href, selected, tone, closed }: { sat: PlanetSatellite; workspace: string; href: string; selected: boolean; tone: Tone; closed: boolean }) {
  const r = SATELLITE_RADIUS[sat.step];
  const status = tone === "error" ? "Error" : closed ? "Closed" : tone === "attention" ? "Needs you" : tone === "running" ? "Running" : "Idle";
  return (
    <HoverCard openDelay={150} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          scroll={false}
          draggable={false}
          aria-label={`Session ${sat.title || "Untitled"}, ${status}`}
          aria-current={selected ? "page" : undefined}
          className="group absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none"
          style={{ left: sat.x, top: sat.y, zIndex: Math.round(sat.y) + 2 }}
        >
          <span
            className={cn("satellite block rounded-full transition-transform group-hover:scale-125", closed ? "is-closed" : tone ? `is-${tone}` : "is-open", selected && "ring-2 ring-(--foreground) ring-offset-1 ring-offset-(--void)", "group-focus-visible:ring-2 group-focus-visible:ring-(--ring)")}
            style={{ width: 2 * r, height: 2 * r }}
          />
        </Link>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={10} className="w-64 text-xs">
        <p className="truncate text-sm font-medium">{sat.title || "Untitled session"}</p>
        <p className="text-muted-foreground">{workspace}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-right">{status}</dd>
          <dt className="text-muted-foreground">Spend</dt>
          <dd className="text-right tabular-nums">{usd(sat.costUsd)}</dd>
          <dt className="text-muted-foreground">Model</dt>
          <dd className="truncate text-right">{sat.model}</dd>
          <dt className="text-muted-foreground">Started</dt>
          <dd className="text-right">{relativeTime(sat.createdAt)}</dd>
        </dl>
        <p className="mt-2 text-right font-medium">Open chat →</p>
      </HoverCardContent>
    </HoverCard>
  );
});

/** Project sections, bottom centre: plain labelled links instead of buildings. */
function SectionDock({ sections }: { sections: PlanetSection[] }) {
  return (
    <nav
      aria-label="Project sections"
      className={cn("pointer-events-none absolute inset-x-0 z-20 flex justify-center px-20", process.env.NODE_ENV === "development" ? "bottom-18" : "bottom-4")}
    >
      <ul className="dock pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border p-1">
        {sections.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              scroll={false}
              aria-current={s.selected ? "page" : undefined}
              className={cn(
                "hover:bg-muted focus-visible:ring-ring flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2",
                s.selected ? "bg-foreground text-background hover:bg-foreground" : "text-foreground",
              )}
            >
              {s.label}
              {s.count !== undefined && <span className={cn("tabular-nums", s.selected ? "opacity-70" : "text-muted-foreground")}>{s.count}</span>}
              {s.attention && <StatusBadge tone="attention" compact />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Legend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Legend" title="Legend" className={CONTROL_BUTTON}>
          <InfoIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="end" className="w-64 text-xs" aria-label="Legend">
        <p className="text-sm font-medium">Legend</p>
        <ul className="text-muted-foreground mt-1 grid gap-0.5">
          <li><span className="text-foreground">Planet</span>: this project. Opens the overview.</li>
          <li><span className="text-foreground">Moon</span>: a workspace, “main” innermost.</li>
          <li><span className="text-foreground">Dot</span>: a session, newest {SATELLITE_RINGS.reduce((n, s) => n + s.slots, 0)} per workspace.</li>
        </ul>
        <p className="mt-2 mb-1 font-medium">Dots grow with spend</p>
        <ul className="grid gap-1">
          {SATELLITE_RADIUS.map((r, i) => (
            <li key={r} className="flex items-center gap-2">
              <span className="flex w-4 justify-center"><span className="satellite is-open block rounded-full" style={{ width: 2 * r, height: 2 * r }} /></span>
              <span className="text-muted-foreground ml-auto tabular-nums">{i === 0 ? "$0" : `$${SPEND_THRESHOLDS[i - 1]}+`}</span>
            </li>
          ))}
          <li className="flex items-center gap-2"><span className="flex w-4 justify-center"><span className="satellite is-closed block size-2 rounded-full" /></span> Closed session</li>
        </ul>
        <ul className="mt-2 grid gap-1 border-t pt-2">
          <li className="flex items-center gap-2"><StatusBadge tone="running" /> working now</li>
          <li className="flex items-center gap-2"><StatusBadge tone="attention" /> waiting on you</li>
          <li className="flex items-center gap-2"><StatusBadge tone="error" /> failed</li>
          <li className="text-muted-foreground">PR marks: ✓ checks passed · … running · × failing · – draft</li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
