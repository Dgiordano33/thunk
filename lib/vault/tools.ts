import "server-only";
import { z } from "zod";
import { getProject } from "@/lib/db/repo/projects";
import { listItems, readItem } from "./store";
import { vaultDirOf } from "./dir";
import { IDEA_LABELS, KIND_LABELS, type VaultItem } from "./types";
import { contextKey, REASONS, type ContextItemDraft, type PromptPart } from "@/lib/context/types";

// Read-only Vault tools for agent sessions. Plain objects (like lib/tasks/tools.ts) so tests don't need the SDK.

/** `onRead` records what a session fetched (the Context view's "Fetched later"). */
export type VaultToolContext = { projectId: string; onRead?: (item: VaultItem, text: string) => void };
export const VAULT_TOOL_NAMES = ["vault_list", "vault_read"] as const;

function defineTool<S extends z.ZodRawShape>(name: (typeof VAULT_TOOL_NAMES)[number], description: string, schema: S,
  run: (args: z.infer<z.ZodObject<S>>) => Promise<string>) {
  return { name, description, schema, async handler(input: unknown) {
    try {
      const text = await run(z.strictObject(schema).parse(input ?? {}));
      return { content: [{ type: "text" as const, text }], isError: false };
    } catch (error) {
      return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Vault operation failed." }], isError: true };
    }
  } };
}

const firstLine = (s = "") => s.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean)?.slice(0, 160) ?? "";

export function listLine(i: VaultItem) {
  const tags = i.tags?.length ? ` · #${i.tags.join(" #")}` : "";
  const ideas = i.ideas?.length ? ` · ${i.ideas.length} ideas` : "";
  return `${i.id} · ${KIND_LABELS[i.kind]} · ${i.status}${i.pinned ? " · pinned" : ""} · ${i.title.replace(/\s+/g, " ")}${ideas}${tags}${i.summary ? ` — ${firstLine(i.summary)}` : ""}`;
}

export function readText(i: VaultItem) {
  const lines = [
    `# ${i.title}`,
    `id: ${i.id} · ${KIND_LABELS[i.kind]} · ${i.filename} · ${i.mime} · ${i.size} bytes · added ${i.createdAt} · status ${i.status}`,
    `Original file (read it with your file tools): ${i.path ?? "(missing)"}`,
  ];
  if (i.error) lines.push("", `Extraction error: ${i.error}`);
  if (i.tags?.length) lines.push("", `Tags: ${i.tags.join(", ")}`);
  if (i.summary) lines.push("", "## Summary", i.summary);
  if (i.ideas?.length) {
    lines.push("", "## Ideas");
    for (const idea of i.ideas) {
      const p = i.promoted?.find((x) => x.ideaId === idea.id);
      const sent = [p?.noteId && `note ${p.noteId}`, p?.taskId && `task ${p.taskId.slice(0, 8)}`].filter(Boolean).join(", ");
      lines.push(`- [${IDEA_LABELS[idea.kind]}] **${idea.title}**${idea.detail ? ` — ${idea.detail}` : ""}${sent ? ` (sent to ${sent})` : ""}`);
    }
  }
  return lines.join("\n");
}

export function vaultTools(ctx: VaultToolContext) {
  async function vault() {
    const project = await getProject(ctx.projectId);
    if (!project) throw new Error("Project not found.");
    return vaultDirOf(project);
  }
  return [
    defineTool("vault_list", "List the project's Vault: source material the user uploaded (docs, images, PDFs, transcripts) with Claude-written summaries and extracted ideas. Optional query filters by title, tag, file name or summary.", {
      query: z.string().max(200).optional(),
    }, async ({ query }) => {
      const items = await listItems(await vault());
      const q = query?.trim().toLowerCase();
      const hits = q ? items.filter((i) => [i.title, i.filename, i.summary ?? "", ...(i.tags ?? [])].some((s) => s.toLowerCase().includes(q))) : items;
      return hits.length ? hits.map(listLine).join("\n") : q ? "No vault items match." : "The Vault is empty.";
    }),
    defineTool("vault_read", "Read one Vault item by id: its summary, extracted ideas, tags, and the absolute path of the original file.", {
      id: z.string().regex(/^[a-z0-9]{10}$/, "Use a 10-character vault id from vault_list."),
    }, async ({ id }) => {
      const item = await readItem(await vault(), id);
      if (!item) throw new Error("Vault item not found in this project.");
      const text = readText(item);
      try {
        ctx.onRead?.(item, text);
      } catch (err) {
        console.error("[thunk] record vault read failed", err);
      }
      return text;
    }),
  ];
}

/** Cap on pinned summaries in the system prompt, like notes' INJECT_LIMIT. */
export const PINNED_LIMIT = 12_000;
const INDEX_LIMIT = 30;

/** System prompt section: pinned items' summaries in full, then an index of the rest with type and a one-line summary. */
export function vaultPrompt(all: VaultItem[], dir: string, { exclude }: { exclude?: Set<string> } = {}): PromptPart {
  const items = all.filter((i) => !exclude?.has(contextKey("vault", i.id)));
  const drafts: ContextItemDraft[] = [];
  const item = (i: VaultItem, mode: ContextItemDraft["mode"], chars: number, reason?: string) =>
    drafts.push({ kind: "vault", refId: i.id, title: i.title, path: i.path ?? null, mode, chars, reason: reason ?? null, source: i.summary ?? "" });
  const lines = [
    "# Thunk vault",
    `The project's Vault holds reference material the user brought in as-is (PDFs, screenshots, slides, docs, transcripts), shared by every workspace in the project. Each has a summary written when it was added. Originals live under \`${dir}\` (read-only for you). Use vault_list to search and vault_read for the full summary, extracted ideas and the original's path. Consult it when the user refers to a doc, deck, screenshot, spec or transcript, or when the work needs background the notes don't cover.`,
  ];
  if (!items.length) return { text: [...lines, "", "The Vault is empty."].join("\n"), items: drafts };
  const pinned = items.filter((i) => i.pinned && i.status === "ready" && i.summary?.trim());
  if (pinned.length) {
    lines.push("", "## Pinned (summaries; read the original for detail)");
    let budget = PINNED_LIMIT;
    let cut = 0;
    for (const i of pinned) {
      const text = i.summary!.trim();
      if (budget <= 0) {
        cut++;
        item(i, "omitted", 0, REASONS.overLimit(PINNED_LIMIT));
        continue;
      }
      const piece = text.length > budget ? `${text.slice(0, budget)}\n…(truncated)` : text;
      if (text.length > budget) {
        cut++;
        item(i, "truncated", budget, REASONS.overLimit(PINNED_LIMIT));
      } else item(i, "full", text.length);
      budget -= piece.length;
      lines.push("", `### ${i.title.replace(/\s+/g, " ")} (${KIND_LABELS[i.kind]}, \`${i.filename}\`, id ${i.id})`, piece);
    }
    if (cut) lines.push("", `(${cut} pinned summar${cut === 1 ? "y was" : "ies were"} truncated or omitted; use vault_read.)`);
  }
  const shown = new Set(pinned.map((i) => i.id));
  const rest = items.filter((i) => !shown.has(i.id));
  if (rest.length) {
    lines.push("", `## ${pinned.length ? "Other items" : "Items"} (${rest.length}${rest.length > INDEX_LIMIT ? `, newest ${INDEX_LIMIT} shown` : ""})`);
    for (const i of rest.slice(0, INDEX_LIMIT)) {
      const gist = i.status === "ready" ? firstLine(i.summary) : i.status === "failed" ? "couldn't be read" : "still being read";
      const line = `- ${i.id} · ${KIND_LABELS[i.kind]} · ${i.title.replace(/\s+/g, " ")}${gist ? ` — ${gist}` : ""}`;
      lines.push(line);
      item(i, "index", line.length, i.pinned ? undefined : REASONS.notPinned);
    }
    for (const i of rest.slice(INDEX_LIMIT)) item(i, "omitted", 0, REASONS.notListed(INDEX_LIMIT));
  }
  return { text: lines.join("\n"), items: drafts };
}
