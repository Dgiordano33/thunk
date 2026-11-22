#!/usr/bin/env node
// npm run server:sync-config -- https://<host>.<tailnet> [--dry-run]
// Send this Mac's Claude Code and Codex setup to a Thunk server, the same as Settings → Agents → Sync in the Mac app.
// See "Your Claude Code and Codex setup" in docs/server.md.
import { createRequire } from "node:module";

const { syncSetup, describeSummary } = createRequire(import.meta.url)("../../desktop/setup-sync.cjs");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const url = args.find((a) => !a.startsWith("-"));
if (!url || !/^https?:\/\//.test(url)) {
  console.error("usage: npm run server:sync-config -- https://<host>.<tailnet> [--dry-run]");
  process.exit(2);
}
try {
  const result = await syncSetup({ baseUrl: url, dryRun, onProgress: (text) => console.log(text) });
  if (dryRun) console.log(`Would send ${result.changed} of ${result.total} files (${(result.bytes / 1e6).toFixed(1)} MB) and update ${result.documents.join(", ")}. Nothing was changed.`);
  else console.log(`\n${describeSummary(result)}\nNew sessions use it; running sessions keep what they started with.`);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
