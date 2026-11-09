// Shared between server and client. Keep free of server-only imports.
import type { RunTrigger, SessionOrigin } from "./types";

/** Placeholders a routine prompt may use; shown as help text in the form. */
export const PROMPT_PLACEHOLDERS = ["{{event.type}}", "{{event.pr.url}}", "{{event.pr.title}}", "{{event.exitCode}}", "{{event.pr.branch}}", "{{event.previewUrl}}", "{{payload}}"];

type Payload = Record<string, unknown> | null | undefined;

function lookup(payload: Payload, key: string): unknown {
  let cur: unknown = payload;
  for (const part of key.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Fill `{{event.*}}` and `{{payload}}` from the trigger payload. The payload is `{ type, ...fields }`;
 * unknown placeholders become empty so a manual run of an event routine still reads sensibly.
 */
export function renderPrompt(template: string, trigger: RunTrigger, payload?: Payload): string {
  const event = { type: trigger, ...(payload ?? {}) };
  return template.replace(/\{\{\s*(event(?:\.[\w-]+)*|payload)\s*\}\}/g, (_, key: string) => {
    if (key === "payload") return payload ? JSON.stringify(payload, null, 2) : "";
    const value = key === "event" ? event : lookup(event, key.slice("event.".length));
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

export const SUMMARY_FENCE = "routine-summary";

/** Appended to the system prompt (Claude) or developer instructions (Codex) of routine sessions. */
export function routineSystemPrompt(origin: Extract<SessionOrigin, { kind: "routine" }>) {
  return `
# Thunk routine
This session was started by the routine **${origin.routineName}**${origin.trigger ? ` (trigger: ${origin.trigger})` : ""}. It runs unattended: nobody is watching while you work, and a person reads your report afterwards.
- Prefer finishing the task without asking questions. Make reasonable assumptions and state them in the report. Ask only if continuing would be unsafe or destructive.
- Never force-push, rewrite published history, or delete branches you did not create.
- If you change code, commit it on the current branch with a clear message. Open a pull request only if the routine's instructions ask for one.
- End your final message with exactly one fenced block in this format, and nothing after it:

\`\`\`${SUMMARY_FENCE}
outcome: ok | changes | nothing | blocked
summary: <2–4 sentences on what you found and did>
pr: <pull request URL or none>
\`\`\`
`.trim();
}

export type ParsedSummary = { outcome: string | null; summary: string; pr: string | null };

/** Read the agent's `routine-summary` fence; fall back to the tail of its final prose. */
export function parseRoutineSummary(markdown: string): ParsedSummary {
  const fence = new RegExp("```" + SUMMARY_FENCE + "\\s*\\n([\\s\\S]*?)```", "g");
  const match = [...markdown.matchAll(fence)].at(-1);
  if (!match) {
    const text = markdown.trim();
    return { outcome: null, summary: text.length > 600 ? `…${text.slice(-600).trimStart()}` : text, pr: null };
  }
  const fields: Record<string, string> = {};
  let current: string | null = null;
  for (const line of match[1].split("\n")) {
    const kv = /^(outcome|summary|pr):\s*(.*)$/i.exec(line.trim());
    if (kv) {
      current = kv[1].toLowerCase();
      fields[current] = kv[2].trim();
    } else if (current === "summary" && line.trim()) {
      fields.summary += ` ${line.trim()}`;
    }
  }
  const pr = fields.pr && !/^none$/i.test(fields.pr) ? fields.pr : null;
  return { outcome: fields.outcome?.toLowerCase() || null, summary: fields.summary ?? "", pr };
}

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

/** The last GitHub PR URL mentioned in the text. */
export function findPrUrl(text: string): string | null {
  return [...text.matchAll(PR_URL)].at(-1)?.[0] ?? null;
}
