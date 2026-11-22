import "server-only";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeDatabase } from "@/lib/db/server";

export type ServerInfo = { revision: string | null; host: string; platform: string; node: string; database: string; startedAt: string };

const startedAt = new Date().toISOString();
let revision: string | null | undefined;

/**
 * The commit this server was built from: the build directory's `.thunk-sha` on a server (scripts/server/thunk),
 * the Mac app's `version.json` (scripts/prepare-desktop.mjs), else the checkout's HEAD in development.
 */
function readRevision(): string | null {
  const attempts = [
    () => readFileSync(path.join(process.cwd(), process.env.THUNK_DIST_DIR || ".next", ".thunk-sha"), "utf8"),
    () => JSON.parse(readFileSync(path.join(path.dirname(process.argv[1] ?? ""), "..", "version.json"), "utf8")).revision,
    () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }),
  ];
  for (const attempt of attempts) {
    try {
      const value = String(attempt()).trim();
      if (/^[0-9a-f]{7,40}$/.test(value)) return value;
    } catch { /* try the next source */ }
  }
  return null;
}

export function serverInfo(): ServerInfo {
  revision ??= readRevision();
  return { revision, host: os.hostname(), platform: `${os.type()} ${os.release()}`, node: process.version, database: describeDatabase(), startedAt };
}
