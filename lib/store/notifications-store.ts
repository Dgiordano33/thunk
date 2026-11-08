"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/client/api";
import type { Notification, NotificationCounts, NotificationEvent, NotificationKind } from "@/lib/notifications/types";

export const useNotifications = create<{
  items: Notification[]; before: { at: string; id: string } | null; counts: NotificationCounts; loaded: boolean; error: string | null; muted: NotificationKind[];
}>(() => ({ items: [], before: null, counts: { total: 0, action: 0, byProject: {} }, loaded: false, error: null, muted: [] }));
export function setMuted(muted: NotificationKind[]) {
  useNotifications.setState({ muted });
  try { localStorage.setItem("thunk.notifications.muted", JSON.stringify(muted)); } catch { /* Storage is optional. */ }
}
let revision = 0;
let request = 0;
export async function refreshNotifications() {
  const rev = revision;
  const version = ++request;
  try {
    const [data, open] = await Promise.all([api.listNotifications(), api.listNotifications("status=open&limit=500")]);
    if (version !== request) return;
    if (rev !== revision) { void refreshNotifications(); return; }
    useNotifications.setState((s) => ({
      items: [...new Map([...s.items, ...open.notifications, ...data.notifications].map((n) => [n.id, n])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
      before: s.loaded ? s.before : data.notifications.length === 500 ? { at: data.notifications.at(-1)!.createdAt, id: data.notifications.at(-1)!.id } : null,
      counts: data.counts, loaded: true, error: null,
    }));
  } catch (err) { useNotifications.setState({ error: (err as Error).message }); }
}
function apply(event: NotificationEvent) {
  revision++;
  useNotifications.setState((s) => ({ items: [event.notification, ...s.items.filter((n) => n.id !== event.notification.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }));
}
async function desktopAlert(n: Notification) {
  if (!("Notification" in window) || window.Notification.permission !== "granted") return;
  try {
    if (localStorage.getItem("thunk.notifications") !== "on") return;
    const muted = JSON.parse(localStorage.getItem("thunk.notifications.muted") || "[]");
    if (Array.isArray(muted) && muted.includes(n.kind)) return;
  } catch { return; }
  const show = () => {
    const key = "thunk.notifications.shown";
    try {
      const shown: string[] = JSON.parse(localStorage.getItem(key) || "[]");
      if (shown.includes(n.id)) return;
      localStorage.setItem(key, JSON.stringify([...shown, n.id].slice(-500)));
      const url = new URL(n.href, window.location.origin);
      if (document.visibilityState === "visible" && document.hasFocus() && url.href === window.location.href) return;
      const alert = new window.Notification(n.title, { body: n.detail?.slice(0, 300) ?? "", tag: `thunk-${n.id}` });
      alert.onclick = () => { window.focus(); window.location.assign(n.href); alert.close(); };
    } catch { /* Browser alerts and storage are optional. */ }
  };
  // Web Locks serialize the claim across tabs; notification tags also collapse duplicates on older browsers.
  if (navigator.locks) await navigator.locks.request("thunk-notifications", show);
  else show();
}
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh() {
  refreshTimer ??= setTimeout(() => { refreshTimer = null; void refreshNotifications(); }, 100);
}
let source: EventSource | null = null;
let refs = 0;
export function useNotificationsEvents() {
  useEffect(() => {
    refs++;
    if (!source) {
      try {
        const muted = JSON.parse(localStorage.getItem("thunk.notifications.muted") || "[]");
        if (Array.isArray(muted)) useNotifications.setState({ muted });
      } catch { /* Storage is optional. */ }
      source = new EventSource("/api/notifications/events");
      source.onopen = () => { useNotifications.setState({ loaded: false, items: [], before: null }); void refreshNotifications(); };
      source.onerror = () => useNotifications.setState({ error: "Inbox connection lost. Reconnecting…" });
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as NotificationEvent;
          apply(event);
          if (event.kind === "opened") void desktopAlert(event.notification);
          scheduleRefresh();
        } catch (err) { console.error("[thunk] bad notification event", err); }
      };
      void refreshNotifications();
    }
    return () => { if (--refs === 0) { source?.close(); source = null; if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null; } };
  }, []);
}
