// Pure and client-safe: the review screen previews with it, and Apply writes what it returns.
import type { MemoryOp } from "./types";

export type ComposeItem = { id: string; op: MemoryOp; target: string | null; text: string | null };
export type ComposeOutcome = { id: string; applied: boolean; flag: string | null };

function occurrences(haystack: string, needle: string) {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) count++;
  return count;
}

const isBullet = (line: string) => /^\s*([-*+]|\d+\.)\s/.test(line);
const tidy = (content: string) => content.replace(/\n{3,}/g, "\n\n");

function append(content: string, text: string) {
  const base = content.trimEnd();
  if (!base) return `${text}\n`;
  const last = base.split("\n").at(-1) ?? "";
  const first = text.split("\n")[0] ?? "";
  return `${base}${isBullet(last) && isBullet(first) ? "\n" : "\n\n"}${text}\n`;
}

/** Remove `target`, taking its line break with it when it fills whole lines. */
function cut(content: string, target: string) {
  const at = content.indexOf(target);
  const end = at + target.length;
  const wholeLines = (at === 0 || content[at - 1] === "\n") && (end === content.length || content[end] === "\n");
  return tidy(content.slice(0, at) + content.slice(wholeLines && end < content.length ? end + 1 : end));
}

/**
 * Apply items in order to `content`. A replace or remove whose target is missing, or appears more than once, is flagged
 * and skipped; so is an add whose text memory already holds. Items match against the running result, so a later item
 * sees earlier ones.
 */
export function composeMemory(content: string, items: ComposeItem[]): { content: string; outcomes: ComposeOutcome[] } {
  let next = content;
  const outcomes: ComposeOutcome[] = [];
  for (const item of items) {
    const text = item.text?.trim() ?? "";
    const target = item.target ?? "";
    let flag: string | null = null;
    if (item.op === "add") {
      if (!text) flag = "Nothing to add";
      else if (next.includes(text)) flag = "Already in memory";
      else next = append(next, text);
    } else if (!target.trim()) flag = "No target text";
    else {
      const count = occurrences(next, target);
      if (count === 0) flag = "No longer in memory";
      else if (count > 1) flag = "Appears more than once in memory";
      else if (item.op === "replace") {
        if (!text) flag = "Nothing to replace it with";
        else next = next.replace(target, () => text);
      } else next = cut(next, target);
    }
    outcomes.push({ id: item.id, applied: !flag, flag });
  }
  return { content: next, outcomes };
}

/** Text spans of `after` that the applied items put there, for marking changes in the document editor. */
export function addedTexts(items: ComposeItem[], outcomes: ComposeOutcome[]) {
  const applied = new Set(outcomes.filter((o) => o.applied).map((o) => o.id));
  return items.filter((i) => applied.has(i.id) && i.op !== "remove" && i.text?.trim()).map((i) => i.text!.trim());
}
