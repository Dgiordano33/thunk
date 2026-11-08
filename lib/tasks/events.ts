import "server-only";
import { EventEmitter } from "node:events";
import type { TaskEvent } from "./types";
const g = globalThis as typeof globalThis & { __thunkTaskEvents?: EventEmitter };
const events = (g.__thunkTaskEvents ??= new EventEmitter().setMaxListeners(0));
export function emitTask(event: TaskEvent) { events.emit("task", event); }
export function subscribeTasks(listener: (event: TaskEvent) => void) {
  events.on("task", listener);
  return () => { events.off("task", listener); };
}
