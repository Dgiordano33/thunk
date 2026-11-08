import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK spawns a native `claude` binary over stdio; never bundle it.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "node-pty"],
  // The proxy buffers API bodies; Vault uploads send one file (up to 25MB) per request.
  experimental: { proxyClientMaxBodySize: "30mb" },
};

export default nextConfig;
