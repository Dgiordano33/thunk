// Shared between server and client.
export type TriageSettings = { enabled: boolean; cron: string; tz?: string | null; nextRunAt: string | null; lastRunAt: string | null; lastResult: string | null };
