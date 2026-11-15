import { cn } from "@/lib/utils";

/** Mono caps label above a hover card's title. */
export function CardEyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("sp-eyebrow", className)}>{children}</p>;
}

/** Hover-card stat rows: label left, tabular mono value right, hairline dividers between rows. */
export function CardStats({ rows, className }: { rows: [label: string, value: React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("sp-stats mt-3 text-xs", className)}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate font-mono text-[11px] tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "45D", "3H", "12M": compact age for mono meta lines. */
export function shortAge(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m}M`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}H`;
  return `${Math.round(h / 24)}D`;
}
