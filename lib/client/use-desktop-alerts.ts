"use client";
import { useEffect, useState } from "react";
import { useAmbient } from "@/lib/store/ambient-store";
export function useDesktopAlerts() {
  const notifications = useAmbient((s) => s.notifications);
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  useEffect(() => {
    try { useAmbient.setState({ notifications: localStorage.getItem("thunk.notifications") === "on" }); } catch { /* Storage is optional. */ }
  }, []);
  const toggleNotifications = async () => {
    setNotificationMessage(null);
    if (!notifications) {
      if (!("Notification" in window)) { setNotificationMessage("Desktop notifications are unavailable in this browser."); return; }
      try {
        if (await Notification.requestPermission() !== "granted") { setNotificationMessage("Allow notifications in your browser settings to enable alerts."); return; }
      } catch { setNotificationMessage("Could not enable desktop notifications."); return; }
    }
    useAmbient.setState({ notifications: !notifications });
    try { localStorage.setItem("thunk.notifications", notifications ? "off" : "on"); } catch { /* Storage is optional. */ }
  };
  return { notifications, notificationMessage, setNotificationMessage, toggleNotifications };
}
