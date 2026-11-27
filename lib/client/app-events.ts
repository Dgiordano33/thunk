import type { NoteEvent } from "@/lib/notes/types";
import type { TaskEvent } from "@/lib/tasks/types";
import type { NotificationEvent } from "@/lib/notifications/types";

type Events = { notes: NoteEvent; tasks: TaskEvent; notifications: NotificationEvent; captures: { id: string } };
type Listener = { topic: keyof Events; onEvent: (event: never) => void; onOpen?: () => void; onError?: () => void };
type Message = { type: "open" | "error" } | { type: "event"; data: string };

const listeners = new Set<Listener>();
let disconnect: (() => void) | null = null;
let open = false;
let suspended = false;
let workerFailed = false;

function receive(message: Message) {
  if (message.type !== "event") open = message.type === "open";
  let event: { topic: keyof Events; event: never } | undefined;
  if (message.type === "event") {
    try { event = JSON.parse(message.data); }
    catch { return; }
  }
  for (const listener of listeners) {
    try {
      if (event?.topic === listener.topic) listener.onEvent(event.event);
      else if (message.type === "open") listener.onOpen?.();
      else if (message.type === "error") listener.onError?.();
    } catch (error) { console.error("[thunk] app event", error); }
  }
}

function start() {
  if (disconnect || suspended || !listeners.size) return;
  if (!workerFailed && typeof SharedWorker !== "undefined") {
    try {
      const worker = new SharedWorker("/app-events-worker.js", { name: "thunk-app-events-v1" });
      let active = true;
      disconnect = () => {
        active = false;
        worker.port.postMessage("close");
        worker.port.close();
      };
      worker.port.onmessage = (message: MessageEvent<Message>) => { if (active) receive(message.data); };
      worker.onerror = () => {
        if (!active) return;
        // A blocked/unsupported worker must not leave the UI without live updates.
        workerFailed = true;
        stop();
        start();
      };
      worker.port.start();
      worker.port.postMessage("connect");
      return;
    } catch { workerFailed = true; }
  }
  // One multiplexed stream per tab when SharedWorker is unavailable.
  const source = new EventSource("/api/events");
  let active = true;
  disconnect = () => { active = false; source.close(); };
  source.onopen = () => { if (active) receive({ type: "open" }); };
  source.onerror = () => { if (active) receive({ type: "error" }); };
  source.onmessage = (message) => { if (active) receive({ type: "event", data: message.data }); };
}

function stop() {
  disconnect?.();
  disconnect = null;
  open = false;
}
function hide() { suspended = true; stop(); }
function show() { suspended = false; start(); }
function online() {
  // A tab's snapshot request can fail while the worker remains connected (for
  // example when that page resumes). Retry reads when its network returns.
  if (open) receive({ type: "open" });
}

/** Passive feeds share one connection across tabs. Chat replay stays on its own stream.
 * onOpen must refresh a snapshot: these change notifications are not a durable log.
 */
export function subscribeAppEvents<K extends keyof Events>(topic: K, handlers: {
  onEvent: (event: Events[K]) => void;
  onOpen?: () => void;
  onError?: () => void;
}) {
  const listener: Listener = { topic, ...handlers };
  listeners.add(listener);
  if (listeners.size === 1) {
    suspended = false;
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("online", online);
    start();
  }
  if (open) queueMicrotask(() => { if (open && listeners.has(listener)) listener.onOpen?.(); });
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stop();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("online", online);
    }
  };
}
