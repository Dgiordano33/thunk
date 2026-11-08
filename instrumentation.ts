export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureScheduler } = await import("./lib/routines/scheduler");
    ensureScheduler();
  }
}
