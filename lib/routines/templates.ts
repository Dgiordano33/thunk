// Shared between server and client. Keep free of server-only imports.
import type { ROUTINE_SCHEDULE_PRESETS } from "./types";

export type RoutineTemplate = {
  name: string;
  prompt: string;
  /** A ROUTINE_SCHEDULE_PRESETS id. */
  schedule: (typeof ROUTINE_SCHEDULE_PRESETS)[number]["id"];
  /** Whether the new routine starts switched on. Templates that act on their own start off. */
  enabled: boolean;
  /** Needs a GitHub remote to be useful. */
  needsRemote: boolean;
};

export const MEMORY_UPKEEP_PROMPT = `Tidy this project's memory. Change nothing yourself: propose changes with memory_propose and the person reviews them.

1. Read the whole project memory file (MEMORY.md; its path is in your system prompt) and the sources sidecar beside it, sources.json. The sidecar is keyed by a hash of each entry's text and records its kind (decision or workaround), sources and, for workarounds, a reviewAfter date.
2. Look for:
   - duplicates: entries that say the same thing. Propose one replace that merges them and removes the rest.
   - contradictions: entries that disagree. Check the code to see which is true, and replace or remove the wrong one.
   - workarounds past their reviewAfter date: check whether each is still needed. Remove it if the underlying problem is fixed; otherwise replace it as is, with a reason, to renew its date.
   - entries naming files, directories, scripts or commands that no longer exist. Check with ls, git ls-files, rg and the package scripts, then replace or remove them.
3. For replace and remove, target must be the exact existing text from MEMORY.md, copied character for character. Give every item a reason, a kind and its sources (keep the sidecar's sources for entries you replace).
4. Call memory_propose once with every change. If nothing needs changing, call it with no items: the run then ends quietly, with no Inbox card.

Do not edit MEMORY.md, sources.json or any other file. End with one line saying what you proposed.`;

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  { name: "Daily PR summary", prompt: "Summarise open pull requests for this project and note anything that needs my attention. Do not change code.", schedule: "daily", enabled: true, needsRemote: true },
  { name: "Weekly project review", prompt: "Review project notes and tasks. Summarise progress and suggest the next priorities without changing code.", schedule: "weekly", enabled: true, needsRemote: false },
  // Off by default: it proposes changes to memory every week, so the person turns it on.
  { name: "Memory upkeep", prompt: MEMORY_UPKEEP_PROMPT, schedule: "weekly", enabled: false, needsRemote: false },
];
