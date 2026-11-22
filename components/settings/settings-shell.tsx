"use client";
import { BellIcon, BotIcon, CalendarClockIcon, ChartNoAxesColumnIcon, ChevronRightIcon, LifeBuoyIcon, MonitorIcon, ServerIcon, SunMoonIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useIsDesktop } from "@/components/mobile/viewport";
import { CivPanel } from "@/components/world/civ-panel";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS, settingsPath, settingsSection, type SettingsScope, type SettingsSectionId } from "./sections";

const ICONS: Record<SettingsSectionId, LucideIcon> = {
  appearance: SunMoonIcon,
  notifications: BellIcon,
  agents: BotIcon,
  automation: CalendarClockIcon,
  usage: ChartNoAxesColumnIcon,
  help: LifeBuoyIcon,
};

const noop = () => () => {};

/** Where a section's settings are stored, so a remote server's settings are not mistaken for this browser's. */
function ScopeLabel({ scope }: { scope: SettingsScope }) {
  const host = useSyncExternalStore(noop, () => window.location.hostname, () => null);
  const Icon = scope === "browser" ? MonitorIcon : ServerIcon;
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
      <Icon className="size-3.5" aria-hidden="true" />
      {scope === "browser" ? "Stored in this browser" : <>Stored on the server{host && <> · <code>{host}</code></>}</>}
    </span>
  );
}

/** /settings frame: a rail of sections beside the open one. On phones, one section per page under the top bar. */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const desktop = useIsDesktop();
  const pathname = usePathname();
  const section = settingsSection(pathname.split("/")[2] ?? "");

  if (!desktop)
    return (
      <main className="h-dvh overflow-auto px-4 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {section && <div className="mb-4"><ScopeLabel scope={section.scope} /></div>}
        {children}
      </main>
    );

  return (
    <main className="absolute inset-x-4 top-20 z-10 flex justify-center" style={{ bottom: process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" }}>
      <CivPanel className="w-full max-w-5xl" bodyClassName="flex h-full min-h-0">
        <nav aria-label="Settings" className="flex w-52 shrink-0 flex-col gap-0.5 border-r p-2">
          <p className="pixel text-muted-foreground px-2 pt-1 pb-2 text-[11px] tracking-widest uppercase">Settings</p>
          {SETTINGS_SECTIONS.map((s) => {
            const Icon = ICONS[s.id];
            const active = s.id === section?.id;
            return (
              <Link
                key={s.id}
                href={settingsPath(s.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2 world:rounded-none",
                  active ? "bg-muted text-foreground world:bg-[color-mix(in_oklch,var(--w-bronze)_30%,transparent)]" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {s.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {section && (
            <header className="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-1 border-b px-6 py-3">
              <div className="min-w-0 flex-1">
                <h1 className="pixel text-lg leading-tight">{section.label}</h1>
                <p className="text-muted-foreground text-xs">{section.blurb}</p>
              </div>
              <ScopeLabel scope={section.scope} />
            </header>
          )}
          <div className="min-h-0 flex-1 overflow-auto px-6 py-5">{children}</div>
        </div>
      </CivPanel>
    </main>
  );
}

/** /settings on a phone: the list of sections. */
export function SettingsIndex() {
  return (
    <nav aria-label="Settings" className="divide-y rounded-lg border bg-background">
      {SETTINGS_SECTIONS.map((s) => {
        const Icon = ICONS[s.id];
        return (
          <Link key={s.id} href={settingsPath(s.id)} className="flex min-h-14 items-center gap-3 px-4 py-3">
            <Icon className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{s.label}</span>
              <span className="text-muted-foreground block truncate text-xs">{s.blurb}</span>
            </span>
            <ChevronRightIcon className="text-muted-foreground size-4" aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}
