"use client";

import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { memo, useEffect, useMemo } from "react";
import { relativeTime } from "@/components/session/labels";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CONTROL_BUTTON, IsoViewport } from "@/components/world/iso-viewport";
import type { ProjectSummary } from "@/lib/projects/types";
import { projectPath } from "@/lib/routes";
import { useAmbient } from "@/lib/store/ambient-store";
import { cn } from "@/lib/utils";
import { bodyKind, type BodyKind } from "@/lib/world/bodies";
import { LEVEL_THRESHOLDS, cityActivity, cityLevel, cityMood, type CityActivity } from "@/lib/world/cities";
import { TILT, orbitRadius, placePlanets, planetPalette, planetRadius, systemSize } from "@/lib/world/system";
import { CardEyebrow, CardStats, shortAge } from "./card";
import { SceneContext, makeBody, useBodyHover, useSceneStore, type SceneData } from "./scene/scene-store";
import { SpaceCanvas } from "./scene/space-canvas";
import { Sphere } from "./sphere";
import { StatusBadge, statusTone } from "./status";

type Placed = { project: ProjectSummary; x: number; y: number; ring: number; level: number; dormant: boolean; order: number };

export const KIND_LABEL: Record<BodyKind, string> = { rock: "Rock", ice: "Ice world", cloud: "Cloud world", gas: "Gas giant", giant: "Great giant" };

/** The home map: a star, its orbits, and one planet per project. `activity` overrides live state (design mocks). */
export function SystemMap({ projects, activity, children }: { projects: ProjectSummary[]; activity?: Record<string, CityActivity>; children?: React.ReactNode }) {
  const sessions = useAmbient((s) => s.sessions);
  const scene = useSceneStore();
  const { planets, rings, w, h } = useMemo(() => {
    const { spots, rings } = placePlanets(projects);
    const { w, h } = systemSize(rings);
    const planets: Placed[] = projects
      .flatMap((project) => {
        const s = spots.get(project.id);
        if (!s) return [];
        return [{ project, x: w / 2 + s.x, y: h / 2 + s.y, ring: s.ring, level: cityLevel(project), dormant: cityMood(project) === "dormant", order: 0 }];
      })
      // Entrance order: inner rings first, then around each ring.
      .sort((a, b) => a.ring - b.ring || Math.atan2(a.y - h / 2, a.x - w / 2) - Math.atan2(b.y - h / 2, b.x - w / 2))
      .map((p, order) => ({ ...p, order }));
    return { planets, rings, w, h };
  }, [projects]);
  const live = useMemo(
    () => new Map(planets.map((p) => [p.project.id, activity ? activity[p.project.id] ?? null : cityActivity(sessions, p.project.id)])),
    [planets, activity, sessions],
  );

  const data = useMemo<SceneData>(() => ({
    star: { x: w / 2, y: h / 2 },
    bodies: planets.map((p) =>
      makeBody({ id: p.project.id, x: p.x, y: p.y, r: planetRadius(p.level), kind: bodyKind(p.level), palette: planetPalette(p.project.id), dormant: p.dormant && !live.get(p.project.id), order: p.order }),
    ),
    orbits: Array.from({ length: rings }, (_, i) => ({
      cx: w / 2,
      cy: h / 2,
      r: orbitRadius(i),
      tilt: TILT,
      bodies: planets.filter((p) => p.ring === i).map((p) => p.project.id),
      ticks: i === rings - 1,
    })),
  }), [planets, rings, w, h, live]);
  useEffect(() => scene.setData(data), [scene, data]);

  return (
    <SceneContext.Provider value={scene}>
      <div className="space space-enter absolute inset-0">
        <IsoViewport
          width={w}
          height={h}
          label="Projects"
          smooth
          underlay={<SpaceCanvas scene={scene} />}
          onView={scene.setView}
          controlsClassName="map-controls"
          stage={
            <>
              <Orbits w={w} h={h} radii={Array.from({ length: rings }, (_, i) => orbitRadius(i))} />
              {planets.map((p) => (
                <Planet key={p.project.id} planet={p} star={{ x: w / 2, y: h / 2 }} activity={live.get(p.project.id) ?? null} />
              ))}
            </>
          }
          controls={<Legend />}
        >
          {children}
        </IsoViewport>
      </div>
    </SceneContext.Provider>
  );
}

/** Orbit ellipses and the star they circle. Fallback art: the canvas draws these once WebGL is ready. */
export function Orbits({ w, h, radii, star = true }: { w: number; h: number; radii: number[]; star?: boolean }) {
  return (
    <svg width={w} height={h} className="fallback-art sp-enter-orbits absolute inset-0" aria-hidden="true">
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
  const { project, x, y, level, order } = planet;
  const dormant = planet.dormant && !activity;
  const r = planetRadius(level);
  const light = Math.atan2(star.y - y, star.x - x);
  const tone = statusTone(activity);
  const hover = useBodyHover(project.id);
  const meta = dormant ? (project.lastActivityAt ? `Idle ${shortAge(project.lastActivityAt)}` : "No activity") : `${project.workspaceCount} ws · ${project.sessionCount} sess`;
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={projectPath(project)}
          draggable={false}
          aria-label={`${project.name}, ${plural(project.workspaceCount, "workspace")}, ${plural(project.sessionCount, "session")}${activity ? `, ${activity}` : dormant ? ", idle" : ""}`}
          className="sp-body group absolute flex flex-col items-center outline-none"
          style={{ left: x, top: y, transform: `translate(-50%, -${r}px)`, zIndex: Math.round(y), "--i": order } as React.CSSProperties}
          {...hover}
        >
          <span className="relative flex items-center justify-center" style={{ width: 2 * r, height: 2 * r }}>
            {tone === "running" && <span className="orbit-pulse absolute rounded-full" style={{ inset: -7 }} />}
            <span className="sp-enter-body sp-fallback-hover absolute flex items-center justify-center">
              <Sphere r={r} palette={planetPalette(project.id)} light={light} bands={level >= 3} ringed={level >= 4} dim={dormant} />
            </span>
            <span className="absolute rounded-full ring-(--ring) ring-offset-(--void) group-focus-visible:ring-2 group-focus-visible:ring-offset-2" style={{ inset: -4 }} />
          </span>
          <span className="planet-label sp-enter-label flex flex-col items-center whitespace-nowrap">
            <span className="sp-tick" aria-hidden="true" />
            <span className={cn("sp-name", dormant && "is-dim")}>{project.name}</span>
            <span className="sp-meta">{meta}</span>
            {activity && <StatusBadge activity={activity} className="mt-1" />}
          </span>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={14} className="w-72">
        <CardEyebrow>Project · {KIND_LABEL[bodyKind(level)]}</CardEyebrow>
        <p className="mt-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.011em]">{project.name}</p>
        <p className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
          {project.repos.length > 1 ? `${project.repos.length} repositories` : project.repos[0] ? tildify(project.repos[0].path) : "No repositories"}
        </p>
        <CardStats
          rows={[
            ["Workspaces", project.workspaceCount],
            ["Sessions", project.sessionCount],
            ["Last activity", project.lastActivityAt ? relativeTime(project.lastActivityAt) : "Never"],
            ...(activity || dormant ? [["Status", activity ?? "Idle 30+ days"] as [string, React.ReactNode]] : []),
          ]}
        />
        <Link href={projectPath(project)} className="mt-2 block text-right text-xs font-medium underline-offset-2 hover:underline">
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
      <PopoverContent side="left" align="end" className="w-64 text-xs" aria-label="Map legend">
        <CardEyebrow>Legend</CardEyebrow>
        <p className="text-muted-foreground mt-1 mb-2">Each planet is a project. Size = workspaces × 2 + sessions.</p>
        <ul className="grid gap-1">
          {sizes.map((s) => (
            <li key={s.level} className="flex items-center gap-2">
              <span className="flex w-9 justify-center">
                <span className="bg-foreground/70 rounded-full" style={{ width: planetRadius(s.level) * 0.75, height: planetRadius(s.level) * 0.75 }} />
              </span>
              <span>{KIND_LABEL[bodyKind(s.level)]}</span>
              <span className="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">{s.range}</span>
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
