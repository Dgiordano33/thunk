import "server-only";
import { EventEmitter } from "node:events";
import type { NotificationEvent } from "./types";
const g = globalThis as typeof globalThis & { __thunkNotificationEvents?: EventEmitter };
const events = (g.__thunkNotificationEvents ??= new EventEmitter().setMaxListeners(0));
export function emitNotification(event: NotificationEvent) { events.emit("notification", event); }
export function subscribeNotifications(listener: (event: NotificationEvent) => void) {
  events.on("notification", listener);
  return () => { events.off("notification", listener); };
}
