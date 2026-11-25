"use client";

import { RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProjectDetailsLink } from "@/components/project/project-details-link";
import { relativeTime } from "@/components/session/labels";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { CONTROL_BUTTON, IsoViewport } from "@/components/world/iso-viewport";
import type { ProjectSummary } from "@/lib/projects/types";
import { projectPath } from "@/lib/routes";
import { useAmbient } from "@/lib/store/ambient-store";
import { cn } from "@/lib/utils";
import { bodyKind } from "@/lib/world/bodies";
import { cityActivity, cityLevel, cityMood, type CityActivity } from "@/lib/world/cities";
import { POSITIONS_COOKIE, POSITIONS_MAX_AGE, clampOffset, encodePositions, floatLayout, positionKey, type Offset } from "@/lib/world/positions";
import { TILT, planetPalette, planetRadius } from "@/lib/world/system";
import { CardEyebrow, CardStats, shortAge } from "./card";
import { SceneContext, makeBody, useBodyHover, useSceneStore, type SceneData, type SceneStore } from "./scene/scene-store";
import { SpaceCanvas } from "./scene/space-canvas";
import { Sphere, StarMark } from "./sphere";
import { StatusBadge, statusTone } from "./status";

type Placed = { project: ProjectSummary; x: number; y: number; level: number; dormant: boolean; order: number };
type Mover = { move: (id: string, at: Offset) => void; drop: (id: string, at: Offset) => void; scene: SceneStore; star: { x: number; y: number } };

/** Pointer travel (px) before a press on a planet becomes a drag instead of a click. */
const DRAG_SLOP = 4;
/** Alt+arrow nudges a focused planet this far (map px). */
const NUDGE = 24;

/**
 * The home map: a star and one planet per project, floating free. Drag a planet (or Alt+arrow it) to rearrange;
 * the layout is saved in a cookie so the server renders it too. `positions` is that cookie, read on the server.
 * `activity` overrides live state (design mocks).
 */
export function SystemMap({ projects, positions = {}, activity, children }: { projects: ProjectSummary[]; positions?: Record<string, Offset>; activity?: Record<string, CityActivity>; children?: React.ReactNode }) {
  const sessions = useAmbient((s) => s.sessions);
  const scene = useSceneStore();
  // Saved layout (cookie) plus the drag in progress, by cookie key.
  const [saved, setSaved] = useState(positions);
  const [live, setLive] = useState<Record<string, Offset>>({});
  const { w, h, base } = useMemo(() => {
    const { offsets, w, h } = floatLayout(projects, saved);
    return { w, h, base: offsets };
  }, [projects, saved]);
  const star = useMemo(() => ({ x: w / 2, y: h / 2 }), [w, h]);
  // Entrance order: nearest the star first. From the resting layout, so a drag doesn't reshuffle it.
  const orderOf = useMemo(() => {
    const ids = [...base].sort(([, a], [, b]) => Math.hypot(a.x, a.y / TILT) - Math.hypot(b.x, b.y / TILT)).map(([id]) => id);
    return new Map(ids.map((id, i) => [id, i]));
  }, [base]);
  const planets = useMemo<Placed[]>(
    () =>
      projects.flatMap((project) => {
        const o = live[positionKey(project.id)] ?? base.get(project.id);
        if (!o) return [];
        return [{ project, x: w / 2 + o.x, y: h / 2 + o.y, level: cityLevel(project), dormant: cityMood(project) === "dormant", order: orderOf.get(project.id) ?? 0 }];
      }),
    [projects, base, live, w, h, orderOf],
  );
  const activityOf = useMemo(
    () => new Map(projects.map((p) => [p.id, activity ? activity[p.id] ?? null : cityActivity(sessions, p.id)])),
    [projects, activity, sessions],
  );

  const data = useMemo<SceneData>(() => ({
    star,
    orbits: [],
    bodies: planets.map((p) =>
      makeBody({ id: p.project.id, x: p.x, y: p.y, r: planetRadius(p.level), kind: bodyKind(p.level), palette: planetPalette(p.project.id), dormant: p.dormant && !activityOf.get(p.project.id), order: p.order, float: true }),
    ),
  }), [planets, star, activityOf]);
  useEffect(() => scene.setData(data), [scene, data]);

  const persist = useCallback((next: Record<string, Offset>) => {
    const value = encodePositions(next);
    document.cookie = value
      ? `${POSITIONS_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${POSITIONS_MAX_AGE}; samesite=lax`
      : `${POSITIONS_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }, []);
  const mover = useMemo<Mover>(() => ({
    scene,
    star,
    move: (id, at) => setLive({ [positionKey(id)]: clampOffset(at, w, h) }),
    drop: (id, at) => {
      setLive({});
      setSaved((prev) => {
        // Unmoved planets don't need saving: their default spot never changes as projects are added.
        const next = { ...prev, [positionKey(id)]: clampOffset(at, w, h) };
        persist(next);
        return next;
      });
    },
  }), [scene, star, w, h, persist]);
  const arranged = Object.keys(saved).length > 0;
  const reset = () => {
    setSaved({});
    persist({});
  };

  return (
    <SceneContext.Provider value={scene}>
      <div className="space space-enter absolute inset-0">
        <IsoViewport
          width={w}
          height={h}
          label="Projects. Drag a planet, or press Alt and an arrow key on one, to move it"
          smooth
          underlay={<SpaceCanvas scene={scene} />}
          onView={scene.setView}
          controlsClassName="map-controls"
          stage={
            <>
              <Orbits w={w} h={h} radii={[]} />
              {planets.map((p) => (
                <Planet key={p.project.id} planet={p} mover={mover} activity={activityOf.get(p.project.id) ?? null} />
              ))}
            </>
          }
          controls={
            <>
              {arranged && (
                <button type="button" aria-label="Reset planet layout" title="Reset planet layout" onClick={reset} className={CONTROL_BUTTON}>
                  <RotateCcwIcon className="size-4" />
                </button>
              )}
            </>
          }
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
      {radii.map((r) => (
        <ellipse key={r} cx={w / 2} cy={h / 2} rx={r} ry={r * TILT} fill="none" stroke="var(--orbit)" strokeWidth={1.7} strokeDasharray="0.1 6.5" strokeLinecap="round" />
      ))}
      {star && <StarMark cx={w / 2} cy={h / 2} />}
    </svg>
  );
}

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const Planet = memo(function Planet({ planet, mover, activity }: { planet: Placed; mover: Mover; activity: CityActivity }) {
  const { project, x, y, level, order } = planet;
  const dormant = planet.dormant && !activity;
  const r = planetRadius(level);
  const light = Math.atan2(mover.star.y - y, mover.star.x - x);
  const tone = statusTone(activity);
  const hover = useBodyHover(project.id);
  const scene = useContext(SceneContext);
  const meta = dormant ? (project.lastActivityAt ? `Idle ${shortAge(project.lastActivityAt)}` : "No activity") : `${project.workspaceCount} ws · ${project.sessionCount} sess`;
  const [cardOpen, setCardOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; at: Offset; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const offset = (): Offset => ({ x: x - mover.star.x, y: y - mover.star.y });

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // Keep the viewport from panning: this press belongs to the planet.
    event.stopPropagation();
    const o = offset();
    drag.current = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: o.x, oy: o.y, at: o, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.sx;
    const dy = event.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!d.moved) {
      d.moved = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setDragging(true);
      mover.scene.setDragging(project.id);
    }
    const z = mover.scene.view.z || 1;
    d.at = { x: d.ox + dx / z, y: d.oy + dy / z };
    mover.move(project.id, d.at);
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    suppressClick.current = true;
    setDragging(false);
    mover.scene.setDragging(null);
    mover.drop(project.id, d.at);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] };
    if (!event.altKey || !step[event.key]) return;
    event.preventDefault();
    const o = offset();
    mover.drop(project.id, { x: o.x + step[event.key][0], y: o.y + step[event.key][1] });
  };

  return (
    <div
      ref={scene ? scene.float(project.id) : undefined}
      className="absolute flex flex-col items-center"
      style={{ left: x, top: y, transform: `translate(-50%, -${r}px)`, zIndex: dragging ? 10_000 : Math.round(y), "--i": order } as React.CSSProperties}
    >
    <HoverCard openDelay={120} closeDelay={60} open={cardOpen && !dragging} onOpenChange={setCardOpen}>
      <HoverCardTrigger asChild>
        <Link
          href={projectPath(project)}
          draggable={false}
          aria-label={`${project.name}, ${plural(project.workspaceCount, "workspace")}, ${plural(project.sessionCount, "session")}${activity ? `, ${activity}` : dormant ? ", idle" : ""}`}
          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
          className={cn("sp-body group flex touch-none flex-col items-center outline-none", dragging && "is-dragging cursor-grabbing")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          onClick={(event) => {
            // A drag that ends over the planet must not open it.
            if (suppressClick.current) {
              event.preventDefault();
              suppressClick.current = false;
            }
          }}
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
        <CardEyebrow>Project</CardEyebrow>
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
      <ProjectDetailsLink project={project} />
    </div>
  );
});
