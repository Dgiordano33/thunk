// Shared between server and client (the form previews upcoming runs).
import { Cron } from "croner";

/** Five fields only: croner also accepts seconds, which would let a routine fire every second. */
export function cronError(expr: string, tz?: string | null): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "Use five fields: minute hour day-of-month month day-of-week";
  try {
    new Cron(expr.trim(), { timezone: tz || undefined, paused: true });
    return null;
  } catch (err) {
    return (err as Error).message.replace(/^CronPattern:\s*/, "");
  }
}

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The first run strictly after `after`, or null when there's no schedule (or it never fires again). */
export function computeNextRun(cron: string | null, tz: string | null, after: Date = new Date()): Date | null {
  if (!cron || cronError(cron, tz)) return null;
  return new Cron(cron.trim(), { timezone: tz || undefined, paused: true }).nextRun(after);
}

export function nextRuns(cron: string, tz: string | null, n: number, after: Date = new Date()): Date[] {
  if (cronError(cron, tz)) return [];
  return new Cron(cron.trim(), { timezone: tz || undefined, paused: true }).nextRuns(n, after);
}

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const pad = (n: string) => n.padStart(2, "0");

/** Short human wording for the common shapes; falls back to the expression itself. */
export function describeCron(cron: string | null): string {
  if (!cron) return "No schedule";
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  if (cron.trim() === "* * * * *") return "Every minute";
  const at = /^\d+$/.test(hour) && /^\d+$/.test(min) ? `${pad(hour)}:${pad(min)}` : null;
  if (/^\d+$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") return min === "0" ? "Hourly" : `Hourly at :${pad(min)}`;
  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (everyMin && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${everyMin[1]} min`;
  const everyHour = /^\*\/(\d+)$/.exec(hour);
  if (/^\d+$/.test(min) && everyHour && dom === "*" && mon === "*" && dow === "*") return `Every ${everyHour[1]}h`;
  if (at && dom === "*" && mon === "*") {
    if (dow === "*") return `Daily ${at}`;
    if (dow === "1-5") return `Weekdays ${at}`;
    if (/^[0-6]$/.test(dow)) return `${DAYS[Number(dow)]} ${at}`;
  }
  return cron.trim();
}
