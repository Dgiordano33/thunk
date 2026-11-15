"use client";

import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { memo, useMemo } from "react";
import { relativeTime } from "@/components/session/labels";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CONTROL_BUTTON, IsoViewport } from "@/components/world/iso-viewport";
import type { ProjectSummary } from "@/lib/projects/types";
import { projectPath } from "@/lib/routes";
import { useAmbient } from "@/lib/store/ambient-store";
import { cn } from "@/lib/utils";
import { LEVEL_THRESHOLDS, cityActivity, cityLevel, cityMood, type CityActivity } from "@/lib/world/cities";
import { TILT, orbitRadius, placePlanets, planetPalette, planetRadius, systemSize } from "@/lib/world/system";
import { Sphere } from "./sphere";
import { StatusBadge, statusTone } from "./status";

type Placed = { project: ProjectSummary; x: number; y: number; level: number; dormant: boolean };

/** The home map: a star, its orbits, and one planet per project. `activity` overrides live state (design mocks). */
export function SystemMap({ projects, activity, children }: { projects: ProjectSummary[]; activity?: Record<string, CityActivity>; children?: React.ReactNode }) {
  const sessions = useAmbient((s) => s.sessions);
  const { planets, rings, w, h } = useMemo(() => {
    const { spots, rings } = placePlanets(projects);
    const { w, h } = systemSize(rings);
    const planets: Placed[] = projects.flatMap((project) => {
      const s = spots.get(project.id);
      if (!s) return [];
      return [{ project, x: w / 2 + s.x, y: h / 2 + s.y, level: cityLevel(project), dormant: cityMood(project) === "dormant" }];
    });
    return { planets, rings, w, h };
  }, [projects]);

  return (
    <div className="space absolute inset-0">
      <IsoViewport
        width={w}
        height={h}
        label="Projects"
        stage={
          <>
            <Orbits w={w} h={h} radii={Array.from({ length: rings }, (_, i) => orbitRadius(i))} />
            {planets.map((p) => (
              <Planet key={p.project.id} planet={p} star={{ x: w / 2, y: h / 2 }} activity={activity ? activity[p.project.id] ?? null : cityActivity(sessions, p.project.id)} />
            ))}
          </>
        }
        controls={<Legend />}
      >
        {children}
      </IsoViewport>
    </div>
  );
}

/** Orbit ellipses and the star they circle. */
export function Orbits({ w, h, radii, star = true }: { w: number; h: number; radii: number[]; star?: boolean }) {
  return (
    <svg width={w} height={h} className="absolute inset-0" aria-hidden="true">
      <defs>
        <radialGradient id="star-corona">
          <stop offset="0" stopColor="var(--star-core)" stopOpacity="0.95" />
          <stop offset="0.2" stopColor="var(--star-glow)" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="var(--star-glow)" stopOpacity="0.12" />
          <stop offset="1" stopColor="var(--star-glow)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {radii.map((r) => (
        <ellipse key={r} cx={w / 2} cy={h / 2} rx={r} ry={r * TILT} fill="none" stroke="var(--orbit)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {star && (
        <>
          <circle cx={w / 2} cy={h / 2} r={84} fill="url(#star-corona)" />
          <circle cx={w / 2} cy={h / 2} r={15} fill="var(--star-core)" />
        </>
      )}
    </svg>
  );
}

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const Planet = memo(function Planet({ planet, star, activity }: { planet: Placed; star: { x: number; y: number }; activity: CityActivity }) {
  const { project, x, y, level } = planet;
  const dormant = planet.dormant && !activity;
  const r = planetRadius(level);
  const light = Math.atan2(star.y - y, star.x - x);
  const tone = statusTone(activity);
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={projectPath(project)}
          draggable={false}
          aria-label={`${project.name}, ${plural(project.workspaceCount, "workspace")}, ${plural(project.sessionCount, "session")}${activity ? `, ${activity}` : dormant ? ", idle" : ""}`}
          className="group absolute flex flex-col items-center outline-none"
          style={{ left: x, top: y, transform: `translate(-50%, -${r}px)`, zIndex: Math.round(y) }}
        >
          <span className="relative flex items-center justify-center" style={{ width: 2 * r, height: 2 * r }}>
            {tone === "running" && <span className="orbit-pulse absolute rounded-full" style={{ inset: -6 }} />}
            <span className="absolute flex items-center justify-center transition-transform duration-150 group-hover:scale-110">
              <Sphere r={r} palette={planetPalette(project.id)} light={light} bands={level >= 3} ringed={level >= 4} dim={dormant} />
            </span>
            <span className="absolute rounded-full ring-0 ring-(--ring) ring-offset-2 ring-offset-(--void) group-focus-visible:ring-2" style={{ inset: -4 }} />
          </span>
          <span className="planet-label mt-2 flex flex-col items-center gap-1 whitespace-nowrap">
            <span className={cn("text-[13px] leading-4 font-medium", dormant ? "text-muted-foreground" : "text-foreground")}>{project.name}</span>
            {activity ? <StatusBadge activity={activity} /> : dormant ? <span className="text-muted-foreground text-[11px]">Idle {project.lastActivityAt ? relativeTime(project.lastActivityAt) : ""}</span> : null}
          </span>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={14} className="w-72">
        <p className="truncate text-sm font-medium">{project.name}</p>
        <p className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
          {project.repos.length > 1 ? `${project.repos.length} repositories` : project.repos[0] ? tildify(project.repos[0].path) : "No repositories"}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Workspaces</dt>
          <dd className="text-right tabular-nums">{project.workspaceCount}</dd>
          <dt className="text-muted-foreground">Sessions</dt>
          <dd className="text-right tabular-nums">{project.sessionCount}</dd>
          <dt className="text-muted-foreground">Last activity</dt>
          <dd className="text-right">{project.lastActivityAt ? relativeTime(project.lastActivityAt) : "Never"}</dd>
          {(activity || dormant) && (
            <>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right">{activity ?? "Idle 30+ days"}</dd>
            </>
          )}
        </dl>
        <Link href={projectPath(project)} className="mt-3 block text-right text-xs font-medium underline-offset-2 hover:underline">
          Open project →
        </Link>
      </HoverCardContent>
    </HoverCard>
  );
});

function Legend() {
  const sizes = [1, 2, 3, 4, 5].map((level, i) => {
    const lo = i === 0 ? 0 : LEVEL_THRESHOLDS[i - 1];
    const hi = LEVEL_THRESHOLDS[i];
    return { level, range: hi === undefined ? `${lo}+` : `${lo}–${hi - 1}` };
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Map legend" title="Map legend" className={CONTROL_BUTTON}>
          <InfoIcon className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="end" className="w-60 text-xs" aria-label="Map legend">
        <p className="text-sm font-medium">Legend</p>
        <p className="text-muted-foreground mt-0.5 mb-2">Each planet is a project. Size = workspaces × 2 + sessions.</p>
        <ul className="grid gap-1">
          {sizes.map((s) => (
            <li key={s.level} className="flex items-center gap-2">
              <span className="flex w-8 justify-center">
                <span className="bg-foreground/70 rounded-full" style={{ width: planetRadius(s.level) * 0.9, height: planetRadius(s.level) * 0.9 }} />
              </span>
              <span className="text-muted-foreground ml-auto tabular-nums">{s.range}</span>
            </li>
          ))}
        </ul>
        <ul className="mt-2 grid gap-1 border-t pt-2">
          <li className="flex items-center gap-2"><StatusBadge activity="Running" /> a session is working</li>
          <li className="flex items-center gap-2"><StatusBadge activity="Needs attention" /> waiting on you</li>
          <li className="flex items-center gap-2"><StatusBadge activity="Session error" /> a session failed</li>
          <li className="text-muted-foreground">Dim planets have been idle 30+ days.</li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}
