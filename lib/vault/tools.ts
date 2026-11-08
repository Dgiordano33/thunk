import "server-only";
import { z } from "zod";
import { getProject } from "@/lib/supabase/repo/projects";
import { listItems, readItem } from "./store";
import { vaultDirOf } from "./dir";
import { IDEA_LABELS, KIND_LABELS, type VaultItem } from "./types";

// Read-only Vault tools for agent sessions. Plain objects (like lib/tasks/tools.ts) so tests don't need the SDK.

export type VaultToolContext = { projectId: string };
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
  return `${i.id} · ${KIND_LABELS[i.kind]} · ${i.status} · ${i.title.replace(/\s+/g, " ")}${ideas}${tags}${i.summary ? ` — ${firstLine(i.summary)}` : ""}`;
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
      return readText(item);
    }),
  ];
}

/** System prompt paragraph: what's in the Vault right now. */
export function vaultPrompt(items: VaultItem[], dir: string) {
  const lines = [
    "# Thunk vault",
    `The project's Vault holds source material the user uploaded, each with a summary and extracted ideas. Originals live under \`${dir}\` (read-only for you). Use vault_list to browse and vault_read for a summary, ideas and the original's path. Consult it when the user refers to a doc, screenshot, spec or transcript they shared.`,
  ];
  const ready = items.filter((i) => i.status === "ready").slice(0, 20);
  if (ready.length) lines.push("", `Recent items (${items.length} total):`, ...ready.map((i) => `- ${i.id} · ${i.title.replace(/\s+/g, " ")}`));
  else lines.push("", items.length ? `${items.length} items, none read yet.` : "The Vault is empty.");
  return lines.join("\n");
}
