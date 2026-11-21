"use client";
import { useDesktopAlerts } from "@/lib/client/use-desktop-alerts";
import { Button } from "@/components/ui/button";
export function DesktopAlerts() {
  const { notifications, notificationMessage, toggleNotifications } = useDesktopAlerts();
  if (notifications) return null;
  return <div className="mt-3"><Button variant="outline" onClick={toggleNotifications}>Turn on desktop alerts</Button>{notificationMessage && <p role="status" className="mt-2 text-xs">{notificationMessage}</p>}</div>;
}
