export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureScheduler } = await import("./lib/routines/scheduler");
    ensureScheduler();
    const { recoverVaultQueue } = await import("./lib/vault/service");
    void recoverVaultQueue().catch((err) => console.error("[thunk] vault recovery failed", err));
  }
}
