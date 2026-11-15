import { cn } from "@/lib/utils";
import type { CityActivity } from "@/lib/world/cities";

export type Tone = "running" | "attention" | "error" | null;

export const statusTone = (activity: CityActivity): Tone =>
  activity === "Needs attention" ? "attention" : activity === "Session error" ? "error" : activity === "Running" ? "running" : null;

const LABEL: Record<Exclude<Tone, null>, { glyph: string; text: string }> = {
  running: { glyph: "●", text: "Running" },
  attention: { glyph: "!", text: "Needs you" },
  error: { glyph: "×", text: "Error" },
};

/** A small status pill: glyph plus word, so the state reads without colour. */
export function StatusBadge({ activity, tone, compact, className }: { activity?: CityActivity; tone?: Tone; compact?: boolean; className?: string }) {
  const t = tone ?? statusTone(activity ?? null);
  if (!t) return null;
  const { glyph, text } = LABEL[t];
  return (
    <span className={cn("status-badge inline-flex items-center gap-1 rounded-full px-1.5 text-[10.5px] leading-4 font-medium", `is-${t}`, className)}>
      <span aria-hidden="true" className={cn(t === "running" && "text-[8px]")}>{glyph}</span>
      {!compact && text}
    </span>
  );
}
