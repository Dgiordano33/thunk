"use client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDesktopAlerts } from "@/lib/client/use-desktop-alerts";
import { NOTIFICATION_KINDS, NOTIFICATION_LABELS } from "@/lib/notifications/types";
import { setMuted, useNotifications } from "@/lib/store/notifications-store";
import { SettingGroup, SettingRow } from "./setting-row";

export function NotificationSettings() {
  const muted = useNotifications((s) => s.muted);
  const { notifications, notificationMessage, toggleNotifications } = useDesktopAlerts();
  const allOn = muted.length === 0;
  return (
    <div className="space-y-6">
      <SettingGroup>
        <SettingRow label="Desktop alerts" description={notificationMessage ?? "Show a system notification when something lands in the Inbox while Thunk is in the background."}>
          <span className="text-muted-foreground text-xs" role="status">{notifications ? "On" : "Off"}</span>
          <Button size="sm" variant="outline" aria-pressed={notifications} onClick={() => void toggleNotifications()}>{notifications ? "Turn off" : "Turn on"}</Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Alert kinds" description="Which kinds raise a desktop alert. Everything still shows in the Inbox.">
        <div className="grid gap-x-6 gap-y-2.5 px-4 py-3 sm:grid-cols-2">
          {NOTIFICATION_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <Checkbox checked={!muted.includes(kind)} onCheckedChange={(on) => setMuted(on === true ? muted.filter((k) => k !== kind) : [...muted, kind])} />
              {NOTIFICATION_LABELS[kind]}
            </label>
          ))}
        </div>
        <div className="flex justify-end px-4 py-2">
          <Button size="xs" variant="ghost" onClick={() => setMuted(allOn ? [...NOTIFICATION_KINDS] : [])}>{allOn ? "Mute all" : "Unmute all"}</Button>
        </div>
      </SettingGroup>
    </div>
  );
}
