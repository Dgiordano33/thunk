"use client";

import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { memo, useEffect, useMemo } from "react";
import { relativeTime } from "@/components/session/labels";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { IsoViewport } from "@/components/world/iso-viewport";
import { needsPerson } from "@/lib/agent/types";
import { deliveryCue } from "@/lib/projects/delivery-types";
import { useAmbient } from "@/lib/store/ambient-store";
import { cn } from "@/lib/utils";
import { CORE_RADIUS, SATELLITE_RADIUS, SATELLITE_RINGS, type PlanetLayout, type SpendStep } from "@/lib/world/planet";
import { bodyKind, moonKind } from "@/lib/world/bodies";
import { TILT, planetPalette } from "@/lib/world/system";
import { CardEyebrow, CardStats } from "./card";
import { SceneContext, makeBody, useBodyHover, useSceneStore, type SceneData } from "./scene/scene-store";
import { SpaceCanvas } from "./scene/space-canvas";
import { Sphere } from "./sphere";
import { StatusBadge, type Tone } from "./status";
import { Orbits } from "./system-map";

export type PlanetMoon = {
  id: string;
  /** The workspace page; clicking the moon goes here. Without it, the moon opens the workspace menu. */
  href?: string;
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
const moonRadius = (sessionCount: number) => 11 + Math.min(5, sessionCount) * 0.8;

export function PlanetView({
  projectId,
  projectName,
  level = 3,
  baseHref,
  overviewHref,
  layout,
  moons,
  satellites,
  sections,
  selected,
  live: liveOverride,
  cues,
  panelOpen = false,
  children,
}: {
  projectId: string;
  projectName: string;
  /** The project's size level (as on the home map), so the core is the same planet you clicked. */
  level?: number;
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
  /** A side panel is open on the right: the section bar moves left so the panel doesn't cover it. */
  panelOpen?: boolean;
  children?: React.ReactNode;
}) {
  const sessions = useAmbient((s) => s.sessions);
  const deliveries = useAmbient((s) => s.deliveries);
  const runs = useAmbient((s) => s.runs);
  const routineAttention = runs.some((r) => r.projectId === projectId && r.status === "needs_attention");
  const canvasAttention = useAmbient((s) => s.canvases.some((c) => c.projectId === projectId && c.status === "waiting"));
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

  const scene = useSceneStore();
  const data = useMemo<SceneData>(() => {
    // Which ring a moon is on: the orbit whose radius matches its distance from the core.
    const ringOf = (m: PlanetMoon) => {
      const d = Math.hypot(m.x - core.x, (m.y - core.y) / TILT);
      return layout.orbits.reduce((best, r, i) => (Math.abs(r - d) < Math.abs(layout.orbits[best] - d) ? i : best), 0);
    };
    return {
      star: null,
      keyLight: LIGHT,
      bodies: [
        makeBody({ id: projectId, x: core.x, y: core.y, r: CORE_RADIUS, kind: bodyKind(level), palette: planetPalette(projectId), order: 0 }),
        ...moons.map((m, i) => makeBody({ id: m.id, x: m.x, y: m.y, r: moonRadius(m.sessionCount), kind: moonKind(m.id), palette: planetPalette(m.id), order: i + 2 })),
      ],
      orbits: layout.orbits.map((r, i) => ({ cx: core.x, cy: core.y, r, tilt: TILT, bodies: moons.filter((m) => ringOf(m) === i).map((m) => m.id) })),
    };
  }, [projectId, level, core.x, core.y, layout.orbits, moons]);
  useEffect(() => scene.setData(data), [scene, data]);

  return (
    <SceneContext.Provider value={scene}>
    <div className="space space-enter absolute inset-0">
      <IsoViewport
        width={w}
        height={h}
        label={`${projectName}: workspaces and sessions`}
        smooth
        underlay={<SpaceCanvas scene={scene} />}
        onView={scene.setView}
        controlsClassName="map-controls"
        stage={
          <>
            <Orbits w={w} h={h} radii={layout.orbits} star={false} />
            <svg width={w} height={h} className="sp-enter-orbits absolute inset-0" aria-hidden="true">
              {moons.filter((m) => m.sessionCount > 0).flatMap((m) =>
                SATELLITE_RINGS.map(({ r }) => (
                  <ellipse key={`${m.id}-${r}`} className="sat-loop" cx={m.x} cy={m.y} rx={r} ry={r * TILT} fill="none" strokeOpacity={0.6} strokeDasharray="1.5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                )),
              )}
            </svg>
            <Core projectId={projectId} level={level} name={projectName} x={core.x} y={core.y} href={overviewHref} selected={!!selected.overview} tone={coreTone} />
            {moons.map((m, i) => {
              const delivery = deliveries.find((d) => d.workspaceId === m.id);
              const cue = cues ? cues[m.id] ?? null : m.hasGit === false ? null : deliveryCue(delivery?.status.pr ?? null);
              return <Moon key={m.id} order={i + 2} moon={m} href={m.href ?? link(`ws=${m.id}`)} menuHref={link(`ws=${m.id}`)} selected={selected.ws === m.id} tone={moonTone(m.id)} cue={cue} serving={!!delivery?.running} />;
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
      >
        <SectionDock sections={sections.map((s) => (s.key === "routines" && routineAttention) || (s.key === "canvas" && canvasAttention) ? { ...s, attention: true } : s)} aside={panelOpen} />
        {children}
      </IsoViewport>
    </div>
    </SceneContext.Provider>
  );
}

function Core({ projectId, level, name, x, y, href, selected, tone }: { projectId: string; level: number; name: string; x: number; y: number; href: string; selected: boolean; tone: Tone }) {
  const r = CORE_RADIUS;
  const hover = useBodyHover(projectId);
  return (
    <Link
      href={href}
      scroll={false}
      draggable={false}
      aria-label={`${name} overview${tone === "attention" ? ", needs attention" : tone === "error" ? ", a session failed" : ""}`}
      aria-current={selected ? "page" : undefined}
      className="sp-body group absolute flex flex-col items-center outline-none"
      style={{ left: x, top: y, transform: `translate(-50%, -${r}px)`, zIndex: Math.round(y), "--i": 0 } as React.CSSProperties}
      {...hover}
    >
      <span className="relative flex items-center justify-center" style={{ width: 2 * r, height: 2 * r }}>
        <span className="sp-enter-body sp-fallback-hover absolute flex items-center justify-center">
          <Sphere r={r} palette={planetPalette(projectId)} light={LIGHT} bands={level >= 3} ringed={level >= 4} />
        </span>
        <span className={cn("absolute rounded-full ring-(--ring) ring-offset-(--void) group-focus-visible:ring-2 group-focus-visible:ring-offset-4", selected && "ring-2 ring-offset-4 ring-(--foreground)/70")} style={{ inset: -2 }} />
      </span>
      <span className="planet-label sp-enter-label mt-1 flex flex-col items-center whitespace-nowrap">
        <span className="sp-tick" aria-hidden="true" />
        <span className="sp-eyebrow">Project</span>
        <span className="sp-core-name">{name}</span>
        {tone ? <StatusBadge tone={tone} className="mt-1" /> : <span className="sp-meta group-hover:text-foreground">Overview</span>}
      </span>
    </Link>
  );
}

/** Labels hang below the satellites' outer loop, so session dots never sit on the text. */
const LABEL_DROP = SATELLITE_RINGS[SATELLITE_RINGS.length - 1].r * TILT + 6;

const Moon = memo(function Moon({ moon, order, href, menuHref, selected, tone, cue, serving }: { moon: PlanetMoon; order: number; href: string; menuHref: string; selected: boolean; tone: Tone; cue: Cue | null; serving: boolean }) {
  const r = moonRadius(moon.sessionCount);
  const hover = useBodyHover(moon.id);
  const branch = moon.branch && moon.branch !== moon.label ? moon.branch : null;
  return (
    <div
      className="sp-body group/moon absolute flex flex-col items-center"
      style={{ left: moon.x, top: moon.y, transform: `translate(-50%, -${r}px)`, zIndex: Math.round(moon.y) + 1, "--i": order } as React.CSSProperties}
      {...hover}
    >
    <HoverCard openDelay={150} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          scroll={false}
          draggable={false}
          aria-label={`Workspace ${moon.label}${cue ? `, ${cue.label}` : ""}${tone === "attention" ? ", needs attention" : tone === "running" ? ", running" : tone === "error" ? ", error" : ""}${serving ? ", dev server running" : ""}`}
          className="group flex flex-col items-center outline-none"
        >
          <span className="relative flex items-center justify-center" style={{ width: 2 * r, height: 2 * r }}>
            {tone === "running" && <span className="orbit-pulse absolute rounded-full" style={{ inset: -5 }} />}
            <span className="sp-enter-body sp-fallback-hover absolute flex items-center justify-center">
              <Sphere r={r} palette={planetPalette(moon.id)} light={LIGHT} />
            </span>
            <span className={cn("absolute rounded-full ring-(--ring) ring-offset-(--void) group-focus-visible:ring-2 group-focus-visible:ring-offset-2", selected && "ring-2 ring-offset-2 ring-(--foreground)/70")} style={{ inset: -3 }} />
          </span>
          <span className="planet-label sp-enter-label flex flex-col items-center gap-0.5 whitespace-nowrap" style={{ marginTop: moon.sessionCount ? LABEL_DROP - r : 6 }}>
            <span className="flex items-center gap-1.5 text-[13px] leading-4 font-medium tracking-[-0.006em]">
              {moon.label}
              {serving && <span className="status-dot is-ok" title="Dev server running" />}
            </span>
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] leading-4">
              {branch && <span className="max-w-36 truncate font-mono text-[10.5px]">{branch}</span>}
              {cue && <span className={cn("status-cue", `is-${cue.kind}`)} title={cue.label}>{cue.symbol} {cue.kind === "pass" ? "PR" : cue.kind === "fail" ? "PR failing" : cue.kind === "pending" ? "checks" : cue.kind === "draft" ? "draft" : "PR"}</span>}
              {moon.overflow > 0 && <span className="font-mono text-[10.5px] tabular-nums">+{moon.overflow}</span>}
            </span>
            {tone && tone !== "running" && <StatusBadge tone={tone} />}
          </span>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={12} className="w-64 text-xs">
        <CardEyebrow>Workspace</CardEyebrow>
        <p className="mt-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.011em]">{moon.label}</p>
        {moon.branch && <p className="text-muted-foreground truncate font-mono text-[11px]">{moon.branch}</p>}
        <CardStats
          className="mt-2"
          rows={[
            ["Sessions", moon.sessionCount],
            ...(cue ? [["Pull request", cue.label] as [string, React.ReactNode]] : []),
            ["Last activity", relativeTime(moon.lastActivityAt)],
          ]}
        />
        {moon.overflow > 0 && <p className="text-muted-foreground mt-2">{moon.overflow} older sessions are listed in the panel.</p>}
        <p className="mt-2 text-right font-medium">Open workspace →</p>
      </HoverCardContent>
    </HoverCard>
      <Link
        href={menuHref}
        scroll={false}
        draggable={false}
        aria-label={`${moon.label} settings`}
        title="Workspace settings"
        aria-current={selected ? "page" : undefined}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:ring-ring mt-0.5 flex h-5 w-7 items-center justify-center rounded-full opacity-0 outline-none transition-opacity group-hover/moon:opacity-100 focus-visible:opacity-100 focus-visible:ring-2",
          selected && "text-foreground opacity-100",
        )}
      >
        <EllipsisIcon className="size-4" />
      </Link>
    </div>
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
        <CardEyebrow>Session · {workspace}</CardEyebrow>
        <p className="mt-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.011em]">{sat.title || "Untitled session"}</p>
        <CardStats
          className="mt-2"
          rows={[
            ["Status", status],
            ["Spend", usd(sat.costUsd)],
            ["Model", sat.model],
            ["Started", relativeTime(sat.createdAt)],
          ]}
        />
        <p className="mt-2 text-right font-medium">Open chat →</p>
      </HoverCardContent>
    </HoverCard>
  );
});

/** Project sections, bottom centre: plain labelled links instead of buildings. */
function SectionDock({ sections, aside }: { sections: PlanetSection[]; aside: boolean }) {
  return (
    <nav
      aria-label="Project sections"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 flex px-20",
        aside ? "justify-start" : "justify-center",
        process.env.NODE_ENV === "development" ? "bottom-18" : "bottom-4",
      )}
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
                s.selected ? "is-selected bg-foreground text-background hover:bg-foreground" : "text-foreground",
              )}
            >
              {s.label}
              {s.count !== undefined && <span className={cn("dock-count", s.selected ? "opacity-70" : "text-muted-foreground")}>{s.count}</span>}
              {s.attention && <StatusBadge tone="attention" compact />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
