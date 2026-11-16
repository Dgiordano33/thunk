import { useId } from "react";
import type { PlanetPalette } from "@/lib/world/system";
import { cn } from "@/lib/utils";

const n = (v: number) => Math.round(v * 100) / 100;
const circle = (cx: number, cy: number, r: number) => `M${n(cx - r)},${n(cy)}a${n(r)},${n(r)} 0 1,0 ${n(2 * r)},0a${n(r)},${n(r)} 0 1,0 ${n(-2 * r)},0Z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) => `M${n(cx - rx)},${n(cy)}a${n(rx)},${n(ry)} 0 1,0 ${n(2 * rx)},0a${n(rx)},${n(ry)} 0 1,0 ${n(-2 * rx)},0Z`;
/** A concave four-point sparkle with arms `s` long, centred on the origin. */
export const sparklePath = (s: number, k = 0.1) => `M0,${-s}Q${n(s * k)},${n(-s * k)} ${s},0Q${n(s * k)},${n(s * k)} 0,${s}Q${n(-s * k)},${n(s * k)} ${-s},0Q${n(-s * k)},${n(-s * k)} 0,${-s}Z`;

/**
 * Fallback art: what the server renders and what stays when WebGL2 is missing. The canvas draws the real bodies on top
 * and this fades out (`.fallback-art`), so keep positions, sizes and hues in step with it, not every detail.
 *
 * Line art: a tinted disc with an outline, and a hatched crescent on the side away from the light. `light` is the
 * direction (radians, screen space) the light comes from. Larger worlds get band lines; `ringed` adds a ring.
 * Colours come from `--h` and `--c` through the `.sp-sphere` rules in globals.css, so they follow the theme.
 */
export function Sphere({
  r,
  palette,
  light,
  bands = false,
  ringed = false,
  dim = false,
  className,
}: {
  r: number;
  palette: PlanetPalette;
  light: number;
  bands?: boolean;
  ringed?: boolean;
  /** Dormant worlds: the same drawing in grey. */
  dim?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const pad = Math.ceil(ringed ? r * 1.15 : 4);
  const size = 2 * (r + pad);
  const mid = size / 2;
  const lx = Math.cos(light);
  const ly = Math.sin(light);
  const tilt = -14;
  const outline = Math.max(1.5, r * 0.05);
  const thin = n(Math.max(1, r * 0.03));
  const gap = n(Math.max(3.5, r * 0.13));
  // The lit part is a disc slid toward the light; what it leaves uncovered is the night side.
  const lit = circle(mid + lx * r * 0.42, mid + ly * r * 0.42, r * 1.03);
  const night = circle(mid, mid, r) + lit;
  const band = (y: number) => `M${n(mid - r * 1.1)},${n(mid + y)}Q${mid},${n(mid + y + r * 0.22)} ${n(mid + r * 1.1)},${n(mid + y)}`;
  const ring = <path d={ellipse(mid, mid, r * 2.05, r * 0.66) + ellipse(mid, mid, r * 1.4, r * 0.45)} fillRule="evenodd" fill="var(--void)" stroke="var(--ln)" strokeWidth={thin} transform={`rotate(${tilt} ${mid} ${mid})`} />;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className={cn("fallback-art sp-sphere overflow-visible", dim && "is-dim", className)}
      style={{ "--h": palette.h, "--c": dim ? 0.008 : palette.c } as React.CSSProperties}
    >
      <defs>
        <clipPath id={`${id}-clip`}>
          <circle cx={mid} cy={mid} r={r} />
        </clipPath>
        <clipPath id={`${id}-front`}>
          <rect x={0} y={mid} width={size} height={size} transform={`rotate(${tilt} ${mid} ${mid})`} />
        </clipPath>
        <clipPath id={`${id}-back`}>
          <rect x={0} y={mid - size} width={size} height={size} transform={`rotate(${tilt} ${mid} ${mid})`} />
        </clipPath>
        <pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width={gap} height={gap} patternTransform={`rotate(${n((light * 180) / Math.PI + 55)})`}>
          <line x1={0} y1={0} x2={0} y2={gap} stroke="var(--ln)" strokeWidth={n(Math.max(0.9, r * 0.028))} />
        </pattern>
      </defs>
      {ringed && <g clipPath={`url(#${id}-back)`}>{ring}</g>}
      <g clipPath={`url(#${id}-clip)`}>
        <rect x={mid - r} y={mid - r} width={2 * r} height={2 * r} fill="var(--fl)" />
        {bands && (
          <g fill="none" stroke="var(--ln)" strokeWidth={thin} opacity={0.9} transform={`rotate(${tilt} ${mid} ${mid})`}>
            {[-0.62, -0.32, 0.02, 0.36].map((y) => <path key={y} d={band(y * r)} />)}
          </g>
        )}
        <path d={night} fillRule="evenodd" fill="var(--sh)" />
        <path d={night} fillRule="evenodd" fill={`url(#${id}-hatch)`} opacity={0.9} />
        <path d={lit} fill="none" stroke="var(--ln)" strokeWidth={thin} />
      </g>
      <circle cx={mid} cy={mid} r={n(r - outline / 2)} fill="none" stroke="var(--ln)" strokeWidth={n(outline)} />
      {ringed && <g clipPath={`url(#${id}-front)`}>{ring}</g>}
    </svg>
  );
}

/** The star as line art: a solid core in a ring, on two nested sparkles. Fallback for the canvas's star. */
export function StarMark({ cx, cy, r = 13 }: { cx: number; cy: number; r?: number }) {
  const w = Math.max(1.25, r * 0.1);
  return (
    <g transform={`translate(${cx} ${cy})`} stroke="var(--star-core)" strokeLinejoin="round" fill="var(--void)">
      <path d={sparklePath(n(r * 6.4), 0.09)} strokeWidth={w} />
      <path d={sparklePath(n(r * 4), 0.16)} strokeWidth={n(w * 0.85)} opacity={0.8} transform="rotate(45)" />
      <circle r={n(r * 1.67)} strokeWidth={n(w * 1.15)} />
      <circle r={r} fill="var(--star-core)" stroke="none" />
    </g>
  );
}
