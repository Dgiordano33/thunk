export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureNotificationProducers } = await import("./lib/notifications/producers");
    ensureNotificationProducers();
    const { ensureDeliveryPolling } = await import("./lib/projects/delivery");
    ensureDeliveryPolling();
    const { recoverWorkers } = await import("./lib/workers/service");
    void recoverWorkers().catch((err) => console.error("[thunk] worker recovery failed", err));
    const { ensureScheduler } = await import("./lib/routines/scheduler");
    ensureScheduler();
    const { recoverVaultQueue } = await import("./lib/vault/service");
    void recoverVaultQueue().catch((err) => console.error("[thunk] vault recovery failed", err));
  }
}
