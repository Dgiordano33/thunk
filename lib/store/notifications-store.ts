"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { subscribeAppEvents } from "@/lib/client/app-events";
import { api } from "@/lib/client/api";
import type { Notification, NotificationCounts, NotificationEvent, NotificationKind } from "@/lib/notifications/types";

export const useNotifications = create<{
  items: Notification[]; before: { at: string; id: string } | null; counts: NotificationCounts; loaded: boolean; error: string | null;
  /** Server-wide channel preferences (lib/notifications/preferences.ts). */
  muted: NotificationKind[]; slackKinds: NotificationKind[]; prefsLoaded: boolean;
}>(() => ({ items: [], before: null, counts: { total: 0, action: 0, byProject: {} }, loaded: false, error: null, muted: [], slackKinds: [], prefsLoaded: false }));

type Preferences = { desktopMuted: NotificationKind[]; slack: NotificationKind[]; migrated: boolean };
async function savePreferences(patch: Partial<Preferences>) {
  const response = await fetch("/api/notifications/preferences", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not save");
  useNotifications.setState({ muted: data.desktopMuted, slackKinds: data.slack, prefsLoaded: true });
}
/** Kinds that never raise a desktop alert, on every browser that opens this server. */
export function setMuted(muted: NotificationKind[]) {
  useNotifications.setState({ muted });
  return savePreferences({ desktopMuted: muted });
}
/** Kinds sent to Slack. */
export function setSlackKinds(slackKinds: NotificationKind[]) {
  useNotifications.setState({ slackKinds });
  return savePreferences({ slack: slackKinds });
}
/** Load preferences; the first browser to load them copies its old local mute list to the server. */
async function loadPreferences() {
  try {
    const response = await fetch("/api/notifications/preferences", { cache: "no-store" });
    if (!response.ok) return;
    const prefs: Preferences = await response.json();
    useNotifications.setState({ muted: prefs.desktopMuted, slackKinds: prefs.slack, prefsLoaded: true });
    if (prefs.migrated) return;
    let local: unknown = [];
    try { local = JSON.parse(localStorage.getItem("thunk.notifications.muted") || "[]"); } catch { /* Storage is optional. */ }
    const kinds = Array.isArray(local) ? local.filter((k): k is NotificationKind => typeof k === "string") : [];
    await savePreferences({ migrated: true, ...(kinds.length && !prefs.desktopMuted.length ? { desktopMuted: kinds } : {}) });
  } catch { /* Keep defaults; the settings screen shows its own errors. */ }
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
  if (n.urgency === "info" && ["turn_finished", "worker_report", "run_succeeded", "agent_request"].includes(n.kind)) return;
  if (!("Notification" in window) || window.Notification.permission !== "granted") return;
  try {
    if (localStorage.getItem("thunk.notifications") !== "on") return;
  } catch { return; }
  if (useNotifications.getState().muted.includes(n.kind)) return;
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
let unsubscribe: (() => void) | null = null;
let refs = 0;
export function useNotificationsEvents() {
  useEffect(() => {
    refs++;
    if (!unsubscribe) {
      void loadPreferences();
      unsubscribe = subscribeAppEvents("notifications", {
        // Merge a fresh snapshot after reconnect without losing scroll or older rows.
        onOpen: scheduleRefresh,
        onError: () => useNotifications.setState({ error: "Inbox connection lost. Reconnecting…" }),
        onEvent: (event) => {
          apply(event);
          if (event.kind === "opened") void desktopAlert(event.notification);
          scheduleRefresh();
        },
      });
      // The Inbox still loads if the live connection is unavailable. Coalesce
      // its initial snapshot with onOpen when the connection opens promptly.
      scheduleRefresh();
    }
    return () => { if (--refs === 0) { unsubscribe?.(); unsubscribe = null; if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null; } };
  }, []);
}
