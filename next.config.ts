import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK spawns a native `claude` binary over stdio; never bundle it.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
