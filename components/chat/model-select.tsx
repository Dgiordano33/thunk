"use client";
import { useAgentStatus } from "@/components/onboarding/agent-status";

import {
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
} from "@/components/ai-elements/prompt-input";
import { SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select";
import { PROVIDER_LABELS, providerOf, type AgentProvider, type ModelOption } from "@/lib/agent/types";

/** Model picker grouped by provider (Claude, Codex). Keeps an unknown current value selectable. */
export function ModelSelect({
  models,
  value,
  onValueChange,
  disabled,
}: {
  models: ModelOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const status = useAgentStatus();
  const all =
    value && !models.some((m) => m.id === value)
      ? [...models, { id: value, label: value, provider: providerOf(value) }]
      : models;
  // Until status loads, treat every agent as available so nothing flickers.
  const notReady = (provider: AgentProvider) => !!status && status[provider].state !== "ready";
  const groups = (["claude", "codex"] as AgentProvider[])
    .map((provider) => ({ provider, models: all.filter((m) => m.provider === provider) }))
    .filter((g) => g.models.length || notReady(g.provider));

  return (
    <PromptInputSelect value={value} onValueChange={onValueChange} disabled={disabled}>
      <PromptInputSelectTrigger className="h-7 min-w-0 shrink text-xs">
        <PromptInputSelectValue />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent>
        {groups.map((g, i) => (
          <SelectGroup key={g.provider}>
            {i > 0 && <SelectSeparator />}
            <SelectLabel>{PROVIDER_LABELS[g.provider]}{notReady(g.provider) && ` · ${status![g.provider].message}`}</SelectLabel>
            {!g.models.length && <PromptInputSelectItem value={`unavailable-${g.provider}`} disabled>No models available</PromptInputSelectItem>}
            {g.models.map((m) => (
              <PromptInputSelectItem key={m.id} value={m.id} disabled={notReady(g.provider)} title={notReady(g.provider) ? status![g.provider].message : m.description}>
                {m.label}
              </PromptInputSelectItem>
            ))}
          </SelectGroup>
        ))}
      </PromptInputSelectContent>
    </PromptInputSelect>
  );
}
