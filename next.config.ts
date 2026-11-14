import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Browser tests run their own dev server beside yours; Next allows one dev server per build directory.
  ...(process.env.THUNK_DIST_DIR ? { distDir: process.env.THUNK_DIST_DIR } : {}),
  outputFileTracingExcludes: {
    "/*": ["./build/**/*", "./dist-desktop/**/*", "./.context/**/*", "./.git/**/*", "./desktop/**/*"],
  },
  // The Agent SDK spawns a native `claude` binary over stdio; never bundle it.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "node-pty"],
  // The proxy buffers API bodies; Vault uploads send one file (up to 25MB) per request.
  experimental: { proxyClientMaxBodySize: "30mb" },
};

export default nextConfig;
