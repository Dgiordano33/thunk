"use client";
import { useState } from "react";

export type DayCost = { date: string; cost: number };

const W = 640;
const H = 160;
const PAD = { top: 12, right: 8, bottom: 22, left: 44 };

/** Daily cost as bars (one series, so no legend), with a per-bar tooltip. Missing days are drawn as zero. */
export function UsageChart({ days, format }: { days: DayCost[]; format: (cost: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.cost), 0) || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const gap = Math.min(2, slot / 3);
  const barW = Math.max(slot - gap, 1);
  const r = Math.min(4, barW / 2);
  const dateLabel = (date: string, long = false) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, long ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
  const active = hover === null ? null : days[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Daily cost, ${dateLabel(days[0].date)} to ${dateLabel(days.at(-1)!.date)}`} onMouseLeave={() => setHover(null)}>
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} className="stroke-border" strokeDasharray="2 3" />
        <text x={PAD.left - 6} y={PAD.top} dy="0.35em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{format(max)}</text>
        <text x={PAD.left - 6} y={PAD.top + plotH} dy="0.35em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">$0</text>
        {days.map((d, i) => {
          const h = (d.cost / max) * plotH;
          const x = PAD.left + i * slot + gap / 2;
          const y = PAD.top + plotH - h;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={h > r ? `M${x},${y + h} V${y + r} q0,-${r} ${r},-${r} h${barW - 2 * r} q${r},0 ${r},${r} V${y + h} Z` : `M${x},${y + h} h${barW} v-${h} h-${barW} Z`}
                  fill="var(--ring)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} className="stroke-border" />
        <text x={PAD.left} y={H - 6} className="fill-muted-foreground text-[10px]">{dateLabel(days[0].date)}</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">{dateLabel(days.at(-1)!.date)}</text>
      </svg>
      {active && hover !== null && (
        <div
          className="bg-popover pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border px-2 py-1 text-xs shadow-sm"
          style={{ left: `${((PAD.left + (hover + 0.5) * slot) / W) * 100}%` }}
        >
          <p className="text-muted-foreground">{dateLabel(active.date, true)}</p>
          <p className="font-medium tabular-nums">{format(active.cost)}</p>
        </div>
      )}
    </div>
  );
}
