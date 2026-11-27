// One passive SSE connection for all tabs/windows on this origin. Keep this
// protocol in sync with lib/client/app-events.ts; session replay is separate.
const ports = new Set();
let source = null;
let retry = null;
const RETRY_MS = 3000;

function remove(port) {
  ports.delete(port);
  port.close();
  if (!ports.size) {
    source?.close();
    source = null;
    clearTimeout(retry);
    retry = null;
  }
}

function broadcast(message) {
  for (const port of ports) {
    try { port.postMessage(message); }
    catch { remove(port); }
  }
}

function connect() {
  clearTimeout(retry);
  retry = null;
  const current = new EventSource("/api/events");
  source = current;
  current.onopen = () => broadcast({ type: "open" });
  current.onerror = () => {
    broadcast({ type: "error" });
    // A CLOSED source (e.g. a proxy 502 during a restart) never reconnects by
    // itself, and this worker outlives tab reloads, so replace it.
    if (current.readyState !== EventSource.CLOSED || source !== current) return;
    source = null;
    if (ports.size) retry = setTimeout(connect, RETRY_MS);
  };
  current.onmessage = (event) => broadcast({ type: "event", data: event.data });
}

self.onconnect = ({ ports: [port] }) => {
  port.onmessage = ({ data }) => {
    if (data === "close") { remove(port); return; }
    if (data !== "connect" || ports.has(port)) return;
    ports.add(port);
    if (!source || source.readyState === EventSource.CLOSED) {
      source?.close();
      connect();
    } else if (source.readyState === EventSource.OPEN) {
      port.postMessage({ type: "open" });
    }
  };
  port.onmessageerror = () => remove(port);
  port.start();
};
