"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDesktopAlerts } from "@/lib/client/use-desktop-alerts";
import { NOTIFICATION_GROUPS, NOTIFICATION_KINDS, NOTIFICATION_LABELS, type NotificationKind } from "@/lib/notifications/types";
import { setMuted, useNotifications } from "@/lib/store/notifications-store";
import { SettingGroup, SettingRow } from "./setting-row";

type Permission = NotificationPermission | "unsupported";

/** The browser's notification permission, re-read when it changes or the window regains focus. */
function usePermission(): Permission | null {
  const [permission, setPermission] = useState<Permission | null>(null);
  useEffect(() => {
    const read = () => setPermission("Notification" in window ? Notification.permission : "unsupported");
    read();
    window.addEventListener("focus", read);
    let status: PermissionStatus | undefined;
    navigator.permissions?.query({ name: "notifications" }).then((s) => { status = s; s.onchange = read; }).catch(() => {});
    return () => { window.removeEventListener("focus", read); if (status) status.onchange = null; };
  }, []);
  return permission;
}

function alertsDescription(on: boolean, permission: Permission | null) {
  if (permission === "unsupported") return "This browser cannot show desktop notifications.";
  if (permission === "denied") return "Notifications are blocked for this site. Allow them in your browser's site settings, then turn alerts on.";
  if (on && permission === "default") return "Turn alerts on again to let the browser ask for permission.";
  return "Show a system notification when something lands in the Inbox while Thunk is in the background.";
}

export function NotificationSettings() {
  const muted = useNotifications((s) => s.muted);
  const permission = usePermission();
  const { notifications, notificationMessage, toggleNotifications } = useDesktopAlerts();
  const blocked = permission === "denied" || permission === "unsupported";
  const setGroup = (kinds: NotificationKind[], on: boolean) => setMuted(on ? muted.filter((k) => !kinds.includes(k)) : [...new Set([...muted, ...kinds])]);
  const allOn = muted.length === 0;
  return (
    <div className="space-y-6">
      <SettingGroup>
        <SettingRow label="Desktop alerts" description={notificationMessage ?? alertsDescription(notifications, permission)}>
          <span role="status" className="text-muted-foreground text-xs">{blocked ? "Blocked" : notifications && permission === "granted" ? "On" : "Off"}</span>
          <Button size="sm" variant="outline" aria-pressed={notifications} disabled={blocked && !notifications} onClick={() => void toggleNotifications()}>{notifications ? "Turn off" : "Turn on"}</Button>
        </SettingRow>
      </SettingGroup>
      <div className="space-y-3">
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">Alert kinds</h3>
            <p className="text-muted-foreground text-xs">Which kinds raise a desktop alert. Everything still shows in the Inbox.</p>
          </div>
          <Button size="xs" variant="ghost" onClick={() => setMuted(allOn ? [...NOTIFICATION_KINDS] : [])}>{allOn ? "Mute all" : "Unmute all"}</Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {NOTIFICATION_GROUPS.map((group) => {
            const on = group.kinds.filter((k) => !muted.includes(k)).length;
            const id = `alert-group-${group.label.toLowerCase().replace(/\W+/g, "-")}`;
            return (
              <fieldset key={group.label} className="rounded-lg border bg-background/60" aria-describedby={`${id}-desc`}>
                <legend className="sr-only">{group.label}</legend>
                <label className="flex items-start gap-2.5 border-b px-4 py-3">
                  <Checkbox className="mt-0.5" checked={on === group.kinds.length ? true : on === 0 ? false : "indeterminate"} onCheckedChange={() => setGroup(group.kinds, on !== group.kinds.length)} aria-label={`All ${group.label}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{group.label}</span>
                    <span id={`${id}-desc`} className="text-muted-foreground block text-xs">{group.description}</span>
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">{on}/{group.kinds.length}</span>
                </label>
                <div className="space-y-2 px-4 py-3 pl-10">
                  {group.kinds.map((kind) => (
                    <label key={kind} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={!muted.includes(kind)} onCheckedChange={(v) => setGroup([kind], v === true)} />
                      {NOTIFICATION_LABELS[kind]}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>
    </div>
  );
}
