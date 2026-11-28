import { editsBlock, ensureNl, escapeXml } from "@/lib/revisions/build-payload";
import type { ContextKind } from "./types";

/** Full text rides along up to this size, like a document revision's edited document. */
export const FULL_TEXT_LIMIT = 40_000;

const attr = (s: string) => escapeXml(s).replace(/"/g, "&quot;");

/** Something the person added to a running session: a note, task or Vault item. */
export function buildAttachmentPayload(input: { kind: Extract<ContextKind, "note" | "task" | "vault">; id: string; title: string; path?: string | null; text: string }) {
  const cut = input.text.length > FULL_TEXT_LIMIT;
  const text = cut ? `${input.text.slice(0, FULL_TEXT_LIMIT)}\n…(cut at ${FULL_TEXT_LIMIT.toLocaleString("en-US")} characters; read the file for the rest)` : input.text;
  const lead = input.kind === "note"
    ? "The user attached this note to the conversation. Treat it as context for the work; edit the file at the path shown if asked to change it."
    : input.kind === "task"
      ? "The user attached this task to the conversation. Use the tasks tools with its ID to update it."
      : "The user attached this Vault item to the conversation. Read the original at the path shown for detail.";
  return [
    `<context_attachment kind="${input.kind}" id="${attr(input.id)}" title="${attr(input.title)}"${input.path ? ` path="${attr(input.path)}"` : ""}>`,
    lead,
    "",
    text.trimEnd(),
    "</context_attachment>",
  ].join("\n");
}

/** A note the session already holds changed: send the diff from its copy, the way a document revision does. */
export function buildNoteUpdatePayload(input: { noteId: string; title: string; path: string; before: string | null; after: string }) {
  const after = ensureNl(input.after);
  const parts = [`<note_update note_id="${attr(input.noteId)}" title="${attr(input.title)}" path="${attr(input.path)}">`];
  parts.push("This note changed since you last saw it. The user is sending the new version; treat it as current and replace what you knew of it.", "");
  if (input.before !== null) parts.push(editsBlock(input.before, after), "");
  if (after.length <= FULL_TEXT_LIMIT) parts.push("<current_note>", after.trimEnd(), "</current_note>");
  else parts.push(`<current_note omitted="true" chars="${after.length}" />`);
  parts.push("</note_update>");
  return parts.join("\n");
}
