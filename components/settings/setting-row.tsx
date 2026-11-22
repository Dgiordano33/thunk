import { cn } from "@/lib/utils";

/** A group of settings under a small heading. */
export function SettingGroup({ title, description, children, className }: { title?: string; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-1", className)}>
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      {description && <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>}
      <div className="divide-y rounded-lg border bg-background/60">{children}</div>
    </section>
  );
}

/** One setting: label and a one-line description on the left, its control on the right. */
export function SettingRow({ label, description, htmlFor, children, className }: { label: React.ReactNode; description?: React.ReactNode; htmlFor?: string; children?: React.ReactNode; className?: string }) {
  const Label = htmlFor ? "label" : "div";
  return (
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3", className)}>
      <div className="min-w-0 flex-1 basis-56">
        <Label htmlFor={htmlFor} className="block text-sm">{label}</Label>
        {description && <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
