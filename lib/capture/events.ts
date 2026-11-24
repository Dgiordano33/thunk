import "server-only";
import { EventEmitter } from "node:events";
type CaptureEvent = { id: string };
const g = globalThis as typeof globalThis & { __thunkCaptureEvents?: EventEmitter };
const events = (g.__thunkCaptureEvents ??= new EventEmitter().setMaxListeners(0));
export function emitCapture(event: CaptureEvent) { events.emit("capture", event); }
export function subscribeCaptures(listener: (event: CaptureEvent) => void) {
  events.on("capture", listener);
  return () => { events.off("capture", listener); };
}
