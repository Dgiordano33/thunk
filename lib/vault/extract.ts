import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { officeText } from "./office";
import { readOriginal, updateItem, type VaultDir } from "./store";
import { IDEA_KINDS, extOf, type VaultIdea, type VaultItem } from "./types";
import { customAlphabet } from "nanoid";

// One-shot extraction: hand Claude the upload, get back a title, summary, ideas and tags.

const newIdeaId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);
export const MAX_TEXT_CHARS = 400_000;

/** Anthropic content blocks; kept loose so this module doesn't need the SDK's types at test time. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; title?: string; source: { type: "base64"; media_type: "application/pdf"; data: string } | { type: "text"; media_type: "text/plain"; data: string } };

export class UnsupportedError extends Error {}

function clip(text: string) {
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[… truncated: ${text.length - MAX_TEXT_CHARS} more characters]` : text;
}

/** The upload as content blocks, plus a short instruction naming the file. */
export function buildContent(item: Pick<VaultItem, "filename" | "mime" | "kind" | "title">, bytes: Buffer): ContentBlock[] {
  const intro: ContentBlock = { type: "text", text: `File: ${item.filename} (${item.mime}). Read it and return the JSON described in your instructions.` };
  switch (item.kind) {
    case "image":
      return [{ type: "image", source: { type: "base64", media_type: item.mime, data: bytes.toString("base64") } }, intro];
    case "pdf":
      return [{ type: "document", title: item.filename, source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } }, intro];
    case "text": {
      const text = bytes.toString("utf8");
      if (!text.trim()) throw new UnsupportedError("The file is empty.");
      return [{ type: "document", title: item.filename, source: { type: "text", media_type: "text/plain", data: clip(text) } }, intro];
    }
    case "office": {
      const text = officeText(bytes, extOf(item.filename));
      if (!text.trim()) throw new UnsupportedError("No text found in this document.");
      return [{ type: "document", title: item.filename, source: { type: "text", media_type: "text/plain", data: clip(text) } }, intro];
    }
    default:
      throw new UnsupportedError(`Can't read ${item.mime || "this file type"} yet. Try an image, PDF, text, or Office (.docx/.pptx/.xlsx) file.`);
  }
}

export const ExtractionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(20_000),
  ideas: z
    .array(z.object({ title: z.string().trim().min(1).max(300), detail: z.string().trim().max(4000).default(""), kind: z.enum(IDEA_KINDS).catch("idea") }))
    .max(30)
    .default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});
export type Extraction = { title: string; summary: string; ideas: VaultIdea[]; tags: string[] };

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "ideas", "tags"],
  properties: {
    title: { type: "string", description: "A short, specific title for the material (max ~8 words)." },
    summary: { type: "string", description: "Markdown summary, at most ~300 words." },
    ideas: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "kind"],
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          kind: { type: "string", enum: [...IDEA_KINDS] },
        },
      },
    },
    tags: { type: "array", maxItems: 6, items: { type: "string" } },
  },
} as const;

export const SYSTEM_PROMPT = `You are the Vault's reader. The user uploads source material (documents, images, transcripts, notes, slides, spreadsheets) to a software project's vault. Read it closely and return JSON only:

{"title": string, "summary": string, "ideas": [{"title": string, "detail": string, "kind": "idea"|"insight"|"question"|"action"}], "tags": string[]}

- title: short and specific (max ~8 words), better than the file name.
- summary: markdown, at most ~300 words. Lead with what the material is and why it matters; then the key points as a short bullet list.
- ideas: up to 12 distinct, self-contained ideas worth keeping. Each title is one line; detail is 1–3 sentences with enough context to act on without reopening the source. Use kind "insight" for a finding or fact, "question" for an open question it raises, "action" for something concrete to do, "idea" otherwise. Prefer non-obvious ideas over restating headings.
- tags: up to 6 lowercase topic tags.
For an image, describe what it shows (UI, diagram, whiteboard, photo) and extract ideas from it. Never invent content that isn't in the material. Output only the JSON object.`;

/** Accepts structured output, a bare JSON string, or JSON inside a ```json fence or surrounding prose. */
export function parseExtraction(raw: unknown): Extraction {
  let value = raw;
  if (typeof raw === "string") {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
    const candidate = fenced ?? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    try {
      value = JSON.parse(candidate);
    } catch {
      throw new Error("Claude's reply wasn't valid JSON.");
    }
  }
  const parsed = ExtractionSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Claude's reply didn't match the expected shape: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  const d = parsed.data;
  return { title: d.title, summary: d.summary, tags: [...new Set(d.tags.map((t) => t.toLowerCase()))], ideas: d.ideas.map((i) => ({ id: newIdeaId(), ...i })) };
}

export type Runner = (content: ContentBlock[]) => Promise<unknown>;

/** Default runner: a tool-less, settings-less one-shot Agent SDK query. Works with an API key or the local `claude` login. */
export const runWithClaude: Runner = async (content) => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  async function* prompt() {
    yield { type: "user" as const, message: { role: "user" as const, content: content as never }, parent_tool_use_id: null };
  }
  const q = query({
    prompt: prompt(),
    options: {
      model: env.DEFAULT_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      settingSources: [],
      persistSession: false,
      // Structured output answers through a tool call, so allow a couple of turns.
      maxTurns: 4,
      outputFormat: { type: "json_schema", schema: JSON_SCHEMA as unknown as Record<string, unknown> },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "thunk/0.1.0" },
    },
  });
  let out: unknown;
  for await (const msg of q) {
    if (msg.type !== "result") continue;
    if (msg.subtype !== "success") throw new Error(`Extraction failed (${msg.subtype}).`);
    out = msg.structured_output ?? msg.result;
  }
  if (out === undefined) throw new Error("Claude returned no result.");
  return out;
};

/** queued → processing → ready | failed. Never throws. */
export async function processItem(v: VaultDir, id: string, run: Runner = runWithClaude): Promise<VaultItem | null> {
  const item = await updateItem(v, id, { status: "processing" });
  if (!item) return null;
  try {
    const content = buildContent(item, await readOriginal(v, item));
    const result = parseExtraction(await run(content));
    return updateItem(v, id, (cur) => ({
      status: "ready",
      // Keep a title the user typed; replace the one derived from the file name.
      title: cur.titled ? cur.title : result.title,
      summary: result.summary,
      ideas: result.ideas,
      tags: result.tags,
      promoted: [],
    }));
  } catch (err) {
    if (!(err instanceof UnsupportedError)) console.error("[thunk] vault extraction failed", id, err);
    return updateItem(v, id, { status: "failed", error: err instanceof Error ? err.message : "Extraction failed." });
  }
}

// In-process queue, two at a time. Kept on globalThis so dev hot reloads share it.
type Queue = { pending: { v: VaultDir; id: string }[]; active: number; keys: Set<string> };
const g = globalThis as unknown as { __thunkVaultQueue?: Queue };
const queue = (g.__thunkVaultQueue ??= { pending: [], active: 0, keys: new Set() });
const CONCURRENCY = 2;

export function enqueue(v: VaultDir, id: string) {
  const key = `${v.dir}/${id}`;
  if (queue.keys.has(key)) return;
  queue.keys.add(key);
  queue.pending.push({ v, id });
  pump();
}

function pump() {
  while (queue.active < CONCURRENCY && queue.pending.length) {
    const job = queue.pending.shift()!;
    queue.active++;
    void processItem(job.v, job.id).finally(() => {
      queue.active--;
      queue.keys.delete(`${job.v.dir}/${job.id}`);
      pump();
    });
  }
}
