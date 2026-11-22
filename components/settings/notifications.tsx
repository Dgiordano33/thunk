"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useDesktopAlerts } from "@/lib/client/use-desktop-alerts";
import { NOTIFICATION_GROUPS, NOTIFICATION_LABELS, type NotificationKind } from "@/lib/notifications/types";
import { setMuted, setSlackKinds, useNotifications } from "@/lib/store/notifications-store";
import { cn } from "@/lib/utils";
import { settingsPath } from "./sections";
import { SettingGroup, SettingRow } from "./setting-row";
import { useSlack } from "./use-slack";

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
  return "A system notification when something lands in the Inbox while Thunk is in the background. On or off for this browser only.";
}

const tri = (on: number, all: number) => (on === all ? true : on === 0 ? false : "indeterminate");
const saved = (work: Promise<unknown>) => void work.catch((e: Error) => toast.error(e.message));

export function NotificationSettings() {
  const muted = useNotifications((s) => s.muted);
  const slackKinds = useNotifications((s) => s.slackKinds);
  const loaded = useNotifications((s) => s.prefsLoaded);
  const permission = usePermission();
  const { notifications, notificationMessage, toggleNotifications } = useDesktopAlerts();
  const { slack, connected } = useSlack();
  const blocked = permission === "denied" || permission === "unsupported";

  const setDesktop = (kinds: NotificationKind[], on: boolean) => saved(setMuted(on ? muted.filter((k) => !kinds.includes(k)) : [...new Set([...muted, ...kinds])]));
  const setSlack = (kinds: NotificationKind[], on: boolean) => saved(setSlackKinds(on ? [...new Set([...slackKinds, ...kinds])] : slackKinds.filter((k) => !kinds.includes(k))));

  return (
    <div className="space-y-6">
      <SettingGroup>
        <SettingRow label="Desktop alerts" description={notificationMessage ?? alertsDescription(notifications, permission)}>
          <span role="status" className="text-muted-foreground text-xs">{blocked ? "Blocked" : notifications && permission === "granted" ? "On" : "Off"}</span>
          <Button size="sm" variant="outline" aria-pressed={notifications} disabled={blocked && !notifications} onClick={() => void toggleNotifications()}>{notifications ? "Turn off" : "Turn on"}</Button>
        </SettingRow>
        <SettingRow label="Slack" description={connected ? "Unread notifications are sent to you as a Slack DM after 30 seconds." : slack?.hasToken ? "Slack is set up but turned off." : "Get a Slack DM when something needs you and you're away."}>
          <span className="text-muted-foreground text-xs">{connected ? "On" : "Off"}</span>
          <Button asChild size="sm" variant="outline"><Link href={settingsPath("integrations")}>{connected ? "Manage" : "Set up"}</Link></Button>
        </SettingRow>
      </SettingGroup>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">What reaches you</h3>
          <p className="text-muted-foreground text-xs">Everything still shows in the Inbox. These choices apply on every device that opens this server.</p>
        </div>
        <div className={cn("overflow-hidden rounded-lg border bg-background/60", !loaded && "opacity-60")}>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">Kind</th>
                <th scope="col" className="w-24 px-2 py-2 text-center font-medium">Desktop</th>
                <th scope="col" className="w-24 px-2 py-2 text-center font-medium">Slack{!connected && <span className="block font-normal">off</span>}</th>
              </tr>
            </thead>
            {NOTIFICATION_GROUPS.map((group) => {
              const desktopOn = group.kinds.filter((k) => !muted.includes(k)).length;
              const slackOn = group.kinds.filter((k) => slackKinds.includes(k)).length;
              return (
                <tbody key={group.label} className="border-b last:border-b-0">
                  <tr className="bg-muted/40">
                    <th scope="rowgroup" className="px-4 py-2 text-left font-medium">
                      {group.label}
                      <span className="text-muted-foreground block text-xs font-normal">{group.description}</span>
                    </th>
                    <td className="px-2 text-center"><Checkbox className="mx-auto" disabled={!loaded} aria-label={`Desktop alerts for all ${group.label}`} checked={tri(desktopOn, group.kinds.length)} onCheckedChange={() => setDesktop(group.kinds, desktopOn !== group.kinds.length)} /></td>
                    <td className="px-2 text-center"><Checkbox className="mx-auto" disabled={!loaded} aria-label={`Slack for all ${group.label}`} checked={tri(slackOn, group.kinds.length)} onCheckedChange={() => setSlack(group.kinds, slackOn !== group.kinds.length)} /></td>
                  </tr>
                  {group.kinds.map((kind) => (
                    <tr key={kind} className="hover:bg-muted/30">
                      <th scope="row" className="py-1.5 pr-4 pl-8 text-left font-normal">{NOTIFICATION_LABELS[kind]}</th>
                      <td className="px-2 text-center"><Checkbox className="mx-auto" disabled={!loaded} aria-label={`Desktop alerts for ${NOTIFICATION_LABELS[kind]}`} checked={!muted.includes(kind)} onCheckedChange={(v) => setDesktop([kind], v === true)} /></td>
                      <td className={cn("px-2 text-center", !connected && "opacity-60")}><Checkbox className="mx-auto" disabled={!loaded} aria-label={`Slack for ${NOTIFICATION_LABELS[kind]}`} checked={slackKinds.includes(kind)} onCheckedChange={(v) => setSlack([kind], v === true)} /></td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
    </div>
  );
}
