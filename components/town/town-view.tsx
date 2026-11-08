"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { memo } from "react";
import { relativeTime } from "@/components/session/labels";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { CivPanel } from "@/components/world/civ-panel";
import { IsoViewport } from "@/components/world/iso-viewport";
import { TerrainLayer } from "@/components/world/terrain-layer";
import { LegendButton } from "@/components/world/world-map";
import type { ActivitySession } from "@/lib/ambient/types";
import { useAmbient } from "@/lib/store/ambient-store";
import { cn } from "@/lib/utils";
import { TILE_H, TILE_W, mapSize, toIso, type Cell, type Grid, type Tile } from "@/lib/world/terrain";
import { CROP_NAMES, CROP_THRESHOLDS, type CropStage } from "@/lib/world/town";
import {
  FarmField,
  TOWN_HALL_SIZE,
  TownHallSprite,
  LIBRARY_SIZE,
  LibrarySprite,
  SPRITE_SCALE,
  TownCenterSprite,
  WORKSHOP_SIZE,
  WorkshopSprite,
} from "./sprites";

export type TownWorkspace = {
  id: string;
  label: string;
  branch: string | null;
  capital: boolean;
  hue: number;
  sessionCount: number;
  overflow: number;
  col: number;
  row: number;
};

export type TownFarm = {
  id: string;
  workspaceId: string;
  title: string | null;
  model: string;
  createdAt: string;
  costUsd: number;
  stage: CropStage;
  col: number;
  row: number;
};

export type TownSelection = { session?: string; ws?: string; building?: "library" | "workshop" | "tasks"; note?: string };

type Live = { status: ActivitySession["status"]; pending: number } | undefined;

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
// Ring four is clear of farms (rings two/three) and neighbouring workspace centers.
const TOWN_HALL_OFFSET = { col: 4, row: 1 };
const ALERT = "pixel absolute left-1/2 flex size-5 -translate-x-1/2 items-center justify-center text-sm font-bold shadow-[2px_2px_0_#0005]";

export function TownView({
  projectId,
  projectName,
  grid,
  tiles,
  workspaces,
  farms,
  library,
  workshop,
  selected,
  children,
}: {
  projectId: string;
  projectName: string;
  grid: Grid;
  tiles: Tile[][];
  workspaces: TownWorkspace[];
  farms: TownFarm[];
  library: Cell;
  workshop: Cell;
  selected: TownSelection;
  /** The open panel, if any. */
  children?: React.ReactNode;
}) {
  const sessions = useAmbient((s) => s.sessions);
  const runs = useAmbient((s) => s.runs);
  const workshopAttention = runs.some((r) => r.projectId === projectId && r.status === "needs_attention");
  const live = new Map(sessions.map((s) => [s.id, { status: s.status, pending: s.pending }]));
  const base = `/p/${projectId}`;
  const { w, h } = mapSize(grid);
  const capital = workspaces.find((ws) => ws.capital) ?? workspaces[0];
  const townHall = { col: (capital?.col ?? library.col + 2) + TOWN_HALL_OFFSET.col, row: (capital?.row ?? library.row - 1) + TOWN_HALL_OFFSET.row };
  const focus = capital ? { ...toIso(capital.col, capital.row, grid), z: 1.1 } : undefined;
  const hueOf = new Map(workspaces.map((ws) => [ws.id, ws.hue]));

  return (
    <IsoViewport
      width={w}
      height={h}
      label={`${projectName} town`}
      focus={focus}
      stage={
        <>
          <TerrainLayer tiles={tiles} grid={grid} />
          {farms.map((farm) => (
            <Farm
              key={farm.id}
              farm={farm}
              grid={grid}
              hue={hueOf.get(farm.workspaceId) ?? 0}
              workspace={workspaces.find((ws) => ws.id === farm.workspaceId)?.label ?? ""}
              live={live.get(farm.id)}
              selected={selected.session === farm.id}
              href={`${base}?session=${farm.id}`}
            />
          ))}
          {workspaces.map((ws) => (
            <TownCenter
              key={ws.id}
              ws={ws}
              grid={grid}
              selected={selected.ws === ws.id}
              href={`${base}?ws=${ws.id}`}
              attention={sessions.some((s) => s.workspaceId === ws.id && (s.pending > 0 || s.status === "awaiting" || s.status === "error"))}
            />
          ))}
          <Building
            cell={library}
            grid={grid}
            name="Library"
            href={`${base}?building=library`}
            selected={selected.building === "library"}
            size={LIBRARY_SIZE}
            ground={29}
            blurb="This project's notebook: notes every session can read and edit."
          >
            <LibrarySprite building={false} />
          </Building>
          <Building
            cell={workshop}
            grid={grid}
            name="Workshop"
            href={`${base}?building=workshop`}
            selected={selected.building === "workshop"}
            size={WORKSHOP_SIZE}
            ground={31}
            blurb="Standing orders: agent sessions that run on a schedule or on events."
            attention={workshopAttention}
          >
            <WorkshopSprite building={false} />
          </Building>
          <Building cell={townHall} grid={grid} name="Town hall" href={`${base}?building=tasks`} selected={selected.building === "tasks"} size={TOWN_HALL_SIZE} ground={33} blurb="This project's task list: what's open, who's on it.">
            <TownHallSprite />
          </Building>
        </>
      }
      controls={
        <LegendButton label="Town legend">
          <TownLegend />
        </LegendButton>
      }
    >
      {children}
    </IsoViewport>
  );
}

function Plate({ children, badge, color }: { children: React.ReactNode; badge?: React.ReactNode; color?: string }) {
  return (
    <span className="pixel flex items-stretch whitespace-nowrap shadow-[2px_2px_0_#0006] ring-1 ring-black/40 group-focus-visible:ring-2 group-focus-visible:ring-white">
      {badge !== undefined && (
        <span className="flex min-w-5 items-center justify-center px-1 text-xs font-bold text-white" style={{ background: color }}>
          {badge}
        </span>
      )}
      <span className="bg-black/65 px-1.5 py-px text-[12px] leading-4 text-white">{children}</span>
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <HoverCardContent side="right" align="start" sideOffset={10} className="w-64 rounded-none bg-transparent p-0 shadow-none ring-0">
      <CivPanel parchment bodyClassName="p-3 text-xs">
        {children}
      </CivPanel>
    </HoverCardContent>
  );
}

const Farm = memo(function Farm({
  farm,
  grid,
  hue,
  workspace,
  live,
  selected,
  href,
}: {
  farm: TownFarm;
  grid: Grid;
  hue: number;
  workspace: string;
  live: Live;
  selected: boolean;
  href: string;
}) {
  const reduced = useReducedMotion();
  const { x, y } = toIso(farm.col, farm.row, grid);
  const running = live?.status === "running" || live?.status === "starting";
  const alert = live && (live.pending > 0 || live.status === "awaiting" || live.status === "error");
  const status = alert ? (live.status === "error" ? "Session error" : "Needs you") : running ? "Working" : live ? "Idle" : "Resting";
  return (
    <HoverCard openDelay={150} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          scroll={false}
          draggable={false}
          aria-label={`Session ${farm.title || "Untitled"}, ${status}`}
          aria-current={selected ? "page" : undefined}
          className="group absolute outline-none [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)] focus-visible:brightness-125"
          style={{ left: x - TILE_W / 2, top: y - TILE_H / 2, width: TILE_W, height: TILE_H, zIndex: farm.col + farm.row }}
        >
          <span className="block transition-[filter] group-hover:brightness-115">
            <FarmField stage={farm.stage} hue={hue} selected={selected} />
          </span>
        </Link>
      </HoverCardTrigger>
      {/* Villager and alert live outside the clipped link so they can stand above the field. */}
      {(running || alert) && (
        <span className="pointer-events-none absolute" style={{ left: x, top: y, zIndex: farm.col + farm.row + 1 }}>
          {running && (
            <motion.span
              className="absolute block"
              initial={false}
              animate={reduced ? { x: 0, y: -6 } : { x: [-10, 8, -10], y: [-10, -1, -10] }}
              transition={reduced ? { duration: 0 } : { duration: 4, repeat: Infinity, ease: "linear" }}
            >
              <Villager />
            </motion.span>
          )}
          {alert && (
            <motion.span
              className={cn(ALERT, "-top-8", live.status === "error" ? "bg-[oklch(0.62_0.21_25)] text-white" : "bg-[oklch(0.86_0.17_90)] text-[oklch(0.25_0.05_60)]")}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 0.9, repeat: Infinity }}
            >
              !
            </motion.span>
          )}
        </span>
      )}
      <Card>
        <p className="pixel truncate text-sm">{farm.title || "Untitled session"}</p>
        <p className="opacity-70">{workspace}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="opacity-70">Status</dt>
          <dd className="text-right">{status}</dd>
          <dt className="opacity-70">Crop</dt>
          <dd className="text-right">{CROP_NAMES[farm.stage]}</dd>
          <dt className="opacity-70">Spend</dt>
          <dd className="text-right tabular-nums">{usd(farm.costUsd)}</dd>
          <dt className="opacity-70">Model</dt>
          <dd className="truncate text-right">{farm.model}</dd>
          <dt className="opacity-70">Planted</dt>
          <dd className="text-right">{relativeTime(farm.createdAt)}</dd>
        </dl>
        <p className="pixel mt-2 text-right">Open chat →</p>
      </Card>
    </HoverCard>
  );
});

/** A 4×7 pixel farmer with a hoe. */
function Villager() {
  return (
    <svg viewBox="0 0 6 8" width={12} height={16} shapeRendering="crispEdges" className="pixel -translate-x-1/2 -translate-y-full" aria-hidden="true">
      <rect x={1} y={0} width={2} height={2} fill="oklch(0.78 0.08 60)" />
      <rect x={0} y={2} width={4} height={3} fill="oklch(0.55 0.15 250)" />
      <rect x={0} y={5} width={1} height={3} fill="oklch(0.35 0.04 50)" />
      <rect x={3} y={5} width={1} height={3} fill="oklch(0.35 0.04 50)" />
      <rect x={4} y={1} width={1} height={6} fill="oklch(0.48 0.08 55)" />
      <rect x={5} y={6} width={1} height={1} fill="oklch(0.6 0.02 70)" />
    </svg>
  );
}

function TownCenter({ ws, grid, selected, href, attention }: { ws: TownWorkspace; grid: Grid; selected: boolean; href: string; attention: boolean }) {
  const { x, y } = toIso(ws.col, ws.row, grid);
  const banner = `oklch(0.66 0.2 ${ws.hue})`;
  return (
    <HoverCard openDelay={150} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          scroll={false}
          draggable={false}
          aria-label={`${ws.capital ? "Capital town center" : "Town center"}: ${ws.label}`}
          aria-current={selected ? "page" : undefined}
          className="group absolute flex flex-col items-center outline-none"
          style={{ left: x, top: y + 10, transform: `translate(-50%, -${41 * SPRITE_SCALE}px)`, zIndex: ws.col + ws.row + 2 }}
        >
          <span className={cn("relative block transition-transform duration-150 group-hover:-translate-y-0.5", selected && "drop-shadow-[0_0_6px_white]")}>
            <TownCenterSprite hue={ws.hue} capital={ws.capital} />
            {attention && (
              <motion.span
                className={cn(ALERT, "-top-3 bg-[oklch(0.86_0.17_90)] text-[oklch(0.25_0.05_60)]")}
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              >
                !
              </motion.span>
            )}
          </span>
          <span className="-mt-1">
            <Plate badge={ws.sessionCount} color={banner}>
              {ws.capital ? "★ " : ""}
              {ws.label}
            </Plate>
          </span>
        </Link>
      </HoverCardTrigger>
      <Card>
        <p className="pixel text-sm">{ws.capital ? "Capital · " : ""}{ws.label}</p>
        {ws.branch && <p className="truncate font-mono text-[11px] opacity-70">{ws.branch}</p>}
        <p className="mt-2">
          {ws.sessionCount} {ws.sessionCount === 1 ? "field" : "fields"}
          {ws.overflow > 0 && <span className="opacity-70"> ({ws.overflow} older not shown)</span>}
        </p>
        <p className="pixel mt-2 text-right">{ws.capital ? "Project & workspace →" : "Workspace →"}</p>
      </Card>
    </HoverCard>
  );
}

function Building({
  cell,
  grid,
  name,
  href,
  selected,
  size,
  ground,
  blurb,
  attention,
  children,
}: {
  cell: Cell;
  grid: Grid;
  name: string;
  href: string;
  selected: boolean;
  size: { w: number; h: number };
  /** Sprite row the building stands on. */
  ground: number;
  blurb: string;
  /** Amber `!` over the building, e.g. a routine run waiting on approval. */
  attention?: boolean;
  children: React.ReactNode;
}) {
  const { x, y } = toIso(cell.col, cell.row, grid);
  return (
    <HoverCard openDelay={150} closeDelay={60}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          scroll={false}
          draggable={false}
          aria-label={attention ? `${name}, needs attention` : name}
          aria-current={selected ? "page" : undefined}
          className="group absolute flex flex-col items-center outline-none"
          style={{ left: x, top: y + 8, transform: `translate(-50%, -${ground * SPRITE_SCALE}px)`, zIndex: cell.col + cell.row + 2, width: size.w * SPRITE_SCALE }}
        >
          <span className={cn("relative block transition-transform duration-150 group-hover:-translate-y-0.5", selected && "drop-shadow-[0_0_6px_white]")}>
            {children}
            {attention && (
              <motion.span
                className={cn(ALERT, "-top-3 bg-[oklch(0.86_0.17_90)] text-[oklch(0.25_0.05_60)]")}
                animate={{ y: [0, -4, 0] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              >
                !
              </motion.span>
            )}
          </span>
          <span className="-mt-1">
            <Plate>{name}</Plate>
          </span>
        </Link>
      </HoverCardTrigger>
      <Card>
        <p className="pixel text-sm">{name}</p>
        <p className="mt-1 opacity-80">{blurb}</p>
      </Card>
    </HoverCard>
  );
}

function TownLegend() {
  return (
    <CivPanel className="w-56" bodyClassName="px-3 py-2 text-xs">
      <p className="pixel text-sm">Legend</p>
      <ul className="mt-1 grid gap-0.5">
        <li>Town center = workspace (★ capital = main)</li>
        <li>Field = session, fenced in its workspace&apos;s colour</li>
        <li>Library = notes · Workshop = routines · Town hall = tasks</li>
      </ul>
      <p className="text-muted-foreground mt-2 mb-1 text-[11px]">Crops ripen with session spend</p>
      <ul className="grid gap-0.5">
        {CROP_NAMES.map((name, i) => (
          <li key={name} className="flex">
            <span>{name}</span>
            <span className="text-muted-foreground ml-auto tabular-nums">{i === 0 ? "$0" : `$${CROP_THRESHOLDS[i - 1]}+`}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-2 grid gap-0.5 border-t pt-1.5">
        <li>Farmer in the field: session running</li>
        <li className="flex items-center gap-2"><span className="pixel flex size-3 items-center justify-center bg-[oklch(0.86_0.17_90)] text-[9px] text-black">!</span> Needs attention</li>
      </ul>
    </CivPanel>
  );
}
