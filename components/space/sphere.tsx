import { useId } from "react";
import type { PlanetPalette } from "@/lib/world/system";
import { cn } from "@/lib/utils";

const ok = (l: number, c: number, h: number, a = 1) => `oklch(${Math.max(0, Math.min(1, l)).toFixed(3)} ${Math.max(0, c).toFixed(3)} ${h} / ${a})`;

/**
 * Fallback art: what the server renders and what stays when WebGL2 is missing. The canvas draws the real bodies on top
 * and this fades out (`.fallback-art`), so keep positions, sizes and hues in step with it, not every detail.
 *
 * A softly lit sphere, as an SVG sized to `r` plus its glow. `light` is the direction (radians, screen space) the light
 * comes from; the lit side faces it and the far side falls into shadow. Larger worlds get faint bands; `ringed` adds a ring.
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
  /** Dormant worlds: desaturated, darker, no glow. */
  dim?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const { h, c } = palette;
  const pad = Math.ceil(ringed ? r * 1.05 : r * 0.55);
  const size = 2 * (r + pad);
  const mid = size / 2;
  // Highlight sits toward the light, about a third of the way to the limb.
  const lx = Math.round((0.5 + 0.3 * Math.cos(light)) * 1000) / 1000;
  const ly = Math.round((0.5 + 0.3 * Math.sin(light)) * 1000) / 1000;
  const tilt = -14;
  // Terminator: a gradient across the disc, lit side clear, night side dark.
  const tx1 = Math.round((0.5 + 0.5 * Math.cos(light)) * 1000) / 1000;
  const ty1 = Math.round((0.5 + 0.5 * Math.sin(light)) * 1000) / 1000;
  const tx2 = Math.round((1 - tx1) * 1000) / 1000;
  const ty2 = Math.round((1 - ty1) * 1000) / 1000;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={cn("fallback-art overflow-visible", dim && "saturate-[0.15] brightness-75", className)}>
      <defs>
        <radialGradient id={`${id}-body`} cx={lx} cy={ly} r={0.85} fx={lx} fy={ly}>
          <stop offset="0" stopColor={ok(0.9, c * 0.45, h)} />
          <stop offset="0.35" stopColor={ok(0.68, c, h)} />
          <stop offset="0.75" stopColor={ok(0.42, c * 0.9, h)} />
          <stop offset="1" stopColor={ok(0.2, c * 0.6, h)} />
        </radialGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0.6" stopColor={ok(0.75, c, h, 0.28)} />
          <stop offset="1" stopColor={ok(0.75, c, h, 0)} />
        </radialGradient>
        <linearGradient id={`${id}-night`} x1={tx1} y1={ty1} x2={tx2} y2={ty2}>
          <stop offset="0.45" stopColor="oklch(0.08 0.02 262)" stopOpacity="0" />
          <stop offset="0.72" stopColor="oklch(0.08 0.02 262)" stopOpacity="0.55" />
          <stop offset="1" stopColor="oklch(0.08 0.02 262)" stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1={tx1} y1={ty1} x2={tx2} y2={ty2}>
          <stop offset="0" stopColor={ok(0.92, c * 0.5, h)} stopOpacity="0.55" />
          <stop offset="0.5" stopColor={ok(0.92, c * 0.5, h)} stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx={mid} cy={mid} r={r} />
        </clipPath>
        <clipPath id={`${id}-front`}>
          <rect x={0} y={mid} width={size} height={size} transform={`rotate(${tilt} ${mid} ${mid})`} />
        </clipPath>
      </defs>
      {!dim && <circle className="sphere-glow" cx={mid} cy={mid} r={r * 1.5} fill={`url(#${id}-glow)`} />}
      {ringed && <Ring mid={mid} r={r} h={h} tilt={tilt} />}
      <circle cx={mid} cy={mid} r={r} fill={`url(#${id}-body)`} />
      {bands && (
        <g clipPath={`url(#${id}-clip)`} opacity={0.16}>
          <ellipse cx={mid} cy={mid - r * 0.35} rx={r * 1.2} ry={r * 0.12} fill="white" />
          <ellipse cx={mid} cy={mid + r * 0.15} rx={r * 1.2} ry={r * 0.18} fill="black" />
          <ellipse cx={mid} cy={mid + r * 0.55} rx={r * 1.2} ry={r * 0.08} fill="white" />
        </g>
      )}
      <circle cx={mid} cy={mid} r={r} fill={`url(#${id}-night)`} />
      {/* A thin rim catches the light on the lit limb only. */}
      <circle cx={mid} cy={mid} r={r - 0.5} fill="none" stroke={`url(#${id}-rim)`} strokeWidth={1} />
      {ringed && <g clipPath={`url(#${id}-front)`}><Ring mid={mid} r={r} h={h} tilt={tilt} /></g>}
    </svg>
  );
}

function Ring({ mid, r, h, tilt }: { mid: number; r: number; h: number; tilt: number }) {
  return (
    <ellipse
      cx={mid}
      cy={mid}
      rx={r * 1.85}
      ry={r * 0.42}
      fill="none"
      stroke={ok(0.82, 0.03, h, 0.6)}
      strokeWidth={Math.max(1.5, r * 0.16)}
      transform={`rotate(${tilt} ${mid} ${mid})`}
    />
  );
}
