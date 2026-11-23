import "server-only";
import { officeText } from "./office";
import { textToNote } from "./to-note";
import { extOf, type VaultItem } from "./types";

/** A Vault item's original as note markdown: text as-is (frontmatter dropped), Word documents as extracted text. */
export function noteMarkdownFrom(item: Pick<VaultItem, "kind" | "filename" | "title">, bytes: Buffer) {
  if (item.kind === "office") return { title: item.title, markdown: officeText(bytes, extOf(item.filename)).trim() };
  return textToNote(item.filename, bytes.toString("utf8"), item.title);
}
