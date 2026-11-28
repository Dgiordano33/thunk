export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Windows has no SIGTERM to send, so the desktop app asks over IPC and the usual shutdown runs.
    if (process.send) process.on("message", (message) => { if (message === "thunk:shutdown") process.emit("SIGTERM"); });
    const { describeDatabase } = await import("./lib/db/server");
    console.log(`[thunk] database: ${describeDatabase()}`);
    // Before anything reads orchestration state: older versions kept it in files.
    const { importStateFiles } = await import("./lib/db/import-files");
    await importStateFiles().catch((err) => console.error("[thunk] importing orchestration state failed", err));
    const { ensureNotificationProducers } = await import("./lib/notifications/producers");
    ensureNotificationProducers();
    const { ensureSlackNotifier } = await import("./lib/integrations/slack");
    ensureSlackNotifier();
    const { ensureLinearWriteBack } = await import("./lib/integrations/linear/service");
    ensureLinearWriteBack();
    const { ensureDeliveryPolling } = await import("./lib/projects/delivery");
    ensureDeliveryPolling();
    const { recoverWorkers } = await import("./lib/workers/service");
    void recoverWorkers().then(async () => { const { recoverCaptures } = await import('./lib/capture/service'); await recoverCaptures(); }).catch((err) => console.error("[thunk] worker recovery failed", err));
    const { ensureScheduler } = await import("./lib/routines/scheduler");
    ensureScheduler();
    const { ensureTriageScheduler } = await import("./lib/home/triage");
    ensureTriageScheduler();
    const { ensureBackupScheduler } = await import("./lib/backup/service");
    ensureBackupScheduler();
    const { recoverVaultQueue } = await import("./lib/vault/service");
    void recoverVaultQueue().catch((err) => console.error("[thunk] vault recovery failed", err));
  }
}
