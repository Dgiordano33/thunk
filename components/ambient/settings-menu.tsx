"use client";

import { BellIcon, ChartNoAxesColumnIcon, SettingsIcon, SunMoonIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { UsageSummary } from "@/lib/ambient/types";
import { useAmbient } from "@/lib/store/ambient-store";
import type { SidebarProject } from "@/components/layout/app-sidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUi } from "@/lib/store/ui-store";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const usd = (cost: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(cost);

/** Sidebar footer: app-wide settings. */
export function SettingsMenu({ projects, className }: { projects: SidebarProject[]; className?: string }) {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const notifications = useAmbient((s) => s.notifications);
  const usageOpen = useAmbient((s) => s.usageOpen);
  const setUsageOpen = (open: boolean) => useAmbient.setState({ usageOpen: open });
  const [usage, setUsage] = useState<(UsageSummary & { persistent: boolean }) | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);

  useEffect(() => {
    try { useAmbient.setState({ notifications: localStorage.getItem("thunk.notifications") === "on" }); } catch { /* Storage is optional. */ }
  }, []);

  useEffect(() => {
    if (!usageOpen) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/ambient/usage?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Request failed");
        if (!controller.signal.aborted) { setUsage(data); setUsageError(null); }
      } catch (error) {
        if (!controller.signal.aborted) setUsageError(error instanceof Error ? error.message : "Usage unavailable");
      }
    };
    void load();
    const timer = setInterval(load, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [usageOpen]);

  const setNotifications = (on: boolean) => {
    useAmbient.setState({ notifications: on });
    try { localStorage.setItem("thunk.notifications", on ? "on" : "off"); } catch { /* Storage is optional. */ }
    setNotificationMessage(null);
  };
  const toggleNotifications = async () => {
    if (notifications) { setNotifications(false); return; }
    if (!("Notification" in window)) { setNotificationMessage("Desktop notifications are unavailable in this browser."); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setNotificationMessage("Allow notifications in your browser settings to enable alerts."); return; }
      setNotifications(true);
    } catch { setNotificationMessage("Could not enable desktop notifications."); }
  };

  return (
    <div className={cn("border-t px-2 py-2", className)}>
      <Popover onOpenChange={(open) => !open && setNotificationMessage(null)}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs">
            <SettingsIcon /> Settings
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-64 p-1">
          <div className="flex items-center gap-2 px-2 py-1 text-xs">
            <SunMoonIcon className="size-4" /><span id="appearance-label">Appearance</span>
            <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              <SelectTrigger size="sm" className="ml-auto w-24 text-xs" aria-labelledby="appearance-label"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={() => setUsageOpen(true)}>
            <ChartNoAxesColumnIcon /> Usage
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs" aria-pressed={notifications} onClick={toggleNotifications}>
            <BellIcon /> Desktop alerts <span className="text-muted-foreground ml-auto">{notifications ? "On" : "Off"}</span>
          </Button>
          {notificationMessage && <p role="status" className="text-muted-foreground px-2 py-1 text-xs">{notificationMessage}</p>}
        </PopoverContent>
      </Popover>
      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>Usage</DialogTitle>
          <DialogDescription>Agent-reported cost estimates, in USD. Subscription billing and Max plan limits are unavailable.</DialogDescription>
          {usageError && <p role="alert" className="text-destructive text-sm">{usageError}</p>}
          {!usage && !usageError && <p role="status">Loading usage…</p>}
          {usage && <>
            <div><p className="text-muted-foreground text-xs">Recorded total</p><p className="text-2xl font-semibold tabular-nums">{usd(usage.total)}</p></div>
            {!usage.persistent && <p className="text-muted-foreground text-xs">Memory mode: retained events from this server run only.</p>}
            <div className="grid max-h-80 gap-5 overflow-y-auto sm:grid-cols-2">
              <div><h3 className="mb-2 text-sm font-medium">By day · your time zone</h3><table className="w-full text-xs"><tbody>{usage.days.map((d) => <tr key={d.name}><th scope="row" className="py-1 text-left font-normal">{d.name}</th><td className="text-right tabular-nums">{usd(d.cost)}</td></tr>)}</tbody></table>{!usage.days.length && <p className="text-muted-foreground text-xs">No reported usage yet.</p>}</div>
              <div><h3 className="mb-2 text-sm font-medium">By workspace</h3><table className="w-full text-xs"><tbody>{usage.workspaces.map((w) => {
                const project = projects.find((p) => p.workspaces.some((item) => item.id === w.id));
                const name = project?.workspaces.find((item) => item.id === w.id)?.name || "Archived workspace";
                return <tr key={w.id}><th scope="row" className="py-1 text-left font-normal"><Link href={`/w/${w.id}`} onClick={() => setUsageOpen(false)} className="hover:underline">{name}</Link>{project && <span className="text-muted-foreground block">{project.name}</span>}</th><td className="text-right tabular-nums">{usd(w.cost)}</td></tr>;
              })}</tbody></table></div>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
