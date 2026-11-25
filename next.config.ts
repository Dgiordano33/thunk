import type { NextConfig } from "next";
import { parseTrustedHosts } from "./lib/access";

const nextConfig: NextConfig = {
  output: "standalone",
  // Only validate generated routes from the slot being built, never the older live slot.
  ...([".next-a", ".next-b"].includes(process.env.THUNK_DIST_DIR ?? "")
    ? { typescript: { tsconfigPath: `tsconfig.server-${process.env.THUNK_DIST_DIR!.slice(-1)}.json` } }
    : {}),
  // `next dev` blocks dev assets for non-localhost origins; allow the Tailscale names (docs/remote.md).
  allowedDevOrigins: parseTrustedHosts(process.env.THUNK_TRUSTED_HOSTS),
  // Browser tests run their own dev server beside yours; Next allows one dev server per build directory.
  ...(process.env.THUNK_DIST_DIR ? { distDir: process.env.THUNK_DIST_DIR } : {}),
  outputFileTracingExcludes: {
    "/*": ["./build/**/*", "./dist-desktop/**/*", "./.context/**/*", "./.git/**/*", "./desktop/**/*"],
  },
  // The Agent SDK spawns a native `claude` binary over stdio; never bundle it.
  // PGlite loads its Postgres WebAssembly and data files from its own package directory.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "node-pty", "@electric-sql/pglite", "pg"],
  // lib/db/server.ts reads the migrations at startup.
  outputFileTracingIncludes: { "/*": ["./db/migrations/*.sql"] },
  // The proxy buffers API bodies; Vault uploads send one file (up to 25MB) per request.
  experimental: { proxyClientMaxBodySize: "30mb" },
};

export default nextConfig;
