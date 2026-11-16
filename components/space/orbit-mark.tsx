import { useId } from "react";
import { PLAIN_ICONS, PixelIcon, type PixelIconName } from "@/components/world/pixel-icon";
import { cn } from "@/lib/utils";
import { sparklePath } from "./sphere";

/**
 * The empty-state mark in the solar-system look: the section's line icon on a small line-art planet with a hatched
 * night side, circled by a dotted orbit, with two sparkles. Hidden in the game look.
 */
export function OrbitMark({ name, className }: { name: PixelIconName; className?: string }) {
  const id = useId().replace(/:/g, "");
  const Icon = PLAIN_ICONS[name];
  const orbit = "M6,40a42,13 0 1,0 84,0a42,13 0 1,0 -84,0";
  return (
    <span aria-hidden="true" className={cn("sp-orbit-mark relative block h-[72px] w-24 world:hidden", className)}>
      <svg viewBox="0 0 96 72" className="absolute inset-0 size-full overflow-visible" fill="none">
        <defs>
          <clipPath id={`${id}-front`}>
            <rect x="0" y="40" width="96" height="40" transform="rotate(-12 48 40)" />
          </clipPath>
          <clipPath id={`${id}-disc`}>
            <circle cx="48" cy="36" r="20" />
          </clipPath>
          <pattern id={`${id}-hatch`} patternUnits="userSpaceOnUse" width="3.6" height="3.6" patternTransform="rotate(-35)">
            <line x1="0" y1="0" x2="0" y2="3.6" stroke="currentColor" strokeWidth="0.9" />
          </pattern>
        </defs>
        <path d={orbit} transform="rotate(-12 48 40)" stroke="currentColor" strokeWidth="1.6" strokeDasharray="0.1 5" strokeLinecap="round" opacity="0.6" />
        <circle cx="48" cy="36" r="20" fill="currentColor" fillOpacity="0.08" />
        <g clipPath={`url(#${id}-disc)`}>
          <path d="M28,36a20,20 0 1,0 40,0a20,20 0 1,0 -40,0ZM20,30a22,22 0 1,1 44,0a22,22 0 1,1 -44,0Z" fillRule="evenodd" fill={`url(#${id}-hatch)`} opacity="0.55" />
        </g>
        <circle cx="48" cy="36" r="20" stroke="currentColor" strokeWidth="1.5" />
        <g clipPath={`url(#${id}-front)`}>
          <path d={orbit} transform="rotate(-12 48 40)" stroke="currentColor" strokeWidth="1.6" strokeDasharray="0.1 5" strokeLinecap="round" opacity="0.6" />
        </g>
        <circle cx="86" cy="31" r="3" fill="currentColor" />
        <path d={sparklePath(6, 0.12)} transform="translate(13 12)" fill="var(--star-core)" />
        <path d={sparklePath(3.5, 0.14)} transform="translate(82 10)" fill="var(--star-core)" opacity="0.8" />
      </svg>
      <Icon strokeWidth={1.6} className="text-foreground absolute top-[26px] left-1/2 size-5 -translate-x-1/2" />
    </span>
  );
}

/** An empty state's mark in either look: the orbit mark in the solar-system look, the pixel icon in the game look. */
export function EmptyMark({ name, className, pixelClassName }: { name: PixelIconName; className?: string; pixelClassName?: string }) {
  return (
    <>
      <OrbitMark name={name} className={className} />
      <PixelIcon name={name} className={cn("space:hidden", pixelClassName)} />
    </>
  );
}
