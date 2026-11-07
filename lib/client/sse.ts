import type { HarnessEvent } from "@/lib/agent/types";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "not_live";

/**
 * Subscribe to a session's SSE stream. The browser's EventSource retries
 * transient drops itself (sending Last-Event-ID); when the stream is closed
 * for good (e.g. 404 after a server restart) we check liveness and either
 * back off and reconnect from `lastSeq` or report `not_live`.
 */
export function connectSession(
  sessionId: string,
  opts: {
    getLastSeq: () => number;
    onEvent: (e: HarnessEvent) => void;
    onState: (s: ConnectionState) => void;
  },
) {
  let es: EventSource | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    opts.onState(attempt === 0 ? "connecting" : "reconnecting");
    es = new EventSource(`/api/sessions/${sessionId}/stream?since=${opts.getLastSeq()}`);
    es.onopen = () => {
      attempt = 0;
      opts.onState("open");
    };
    es.onmessage = (m) => {
      try {
        opts.onEvent(JSON.parse(m.data) as HarnessEvent);
      } catch (err) {
        console.error("[thunk] bad event", err);
      }
    };
    es.onerror = () => {
      if (stopped || !es) return;
      if (es.readyState !== EventSource.CLOSED) {
        opts.onState("reconnecting");
        return;
      }
      es = null;
      void checkAndRetry();
    };
  };

  const checkAndRetry = async () => {
    const live = await fetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((d) => Boolean(d.session?.live))
      .catch(() => null);
    if (stopped) return;
    if (live === false) {
      opts.onState("not_live");
      return;
    }
    attempt++;
    opts.onState("reconnecting");
    timer = setTimeout(open, Math.min(500 * 2 ** attempt, 10_000));
  };

  open();

  return {
    close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      es?.close();
    },
    reconnect() {
      es?.close();
      es = null;
      attempt = 0;
      if (timer) clearTimeout(timer);
      open();
    },
  };
}
