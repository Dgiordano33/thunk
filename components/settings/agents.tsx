"use client";
import { AgentSetup } from "@/components/onboarding/agent-setup";
import { AgentStatus } from "@/components/onboarding/agent-status";

export function AgentSettings() {
  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h3 className="text-sm font-medium">Installed agents</h3>
        <p className="text-muted-foreground text-xs">Thunk runs the agents installed on this server.</p>
        <AgentStatus />
      </section>
      <AgentSetup />
    </div>
  );
}
