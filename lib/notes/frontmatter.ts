// Pure note-file helpers, shared by server and client. Agents edit these files by hand,
// so parsing is tolerant: missing or garbled frontmatter falls back to defaults.
import type { NoteFlags, NoteTask } from "./types";

export type NoteFrontmatter = NoteFlags & { title: string | null; created: string | null; updated: string | null };

export type ParsedNote = { frontmatter: NoteFrontmatter; body: string; rawHeader?: string };

const DEFAULTS: NoteFrontmatter = {
  title: null,
  pinned: false,
  inject: false,
  actionable: false,
  tags: [],
  created: null,
  updated: null,
};

const FENCE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(v: string) {
  const m = /^(["'])([\s\S]*)\1$/.exec(v);
  if (!m) return v;
  return m[1] === '"' ? m[2].replace(/\\(["\\])/g, "$1") : m[2].replace(/''/g, "'");
}

function parseBool(v: string): boolean | null {
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^(false|no|off)$/i.test(v)) return false;
  return null;
}

function parseList(v: string): string[] {
  const inner = /^\[([\s\S]*)\]$/.exec(v)?.[1] ?? v;
  return inner
    .split(",")
    .map((t) => unquote(t.trim()))
    .filter(Boolean);
}

/** Split a note file into frontmatter and body. Flat `key: value` and `[a, b]` lists only. */
export function parseNote(raw: string): ParsedNote {
  const fm: NoteFrontmatter = { ...DEFAULTS, tags: [] };
  const m = FENCE.exec(raw);
  if (!m) return { frontmatter: fm, body: raw };
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let value = kv[2].trim();
    // YAML block list: `tags:` followed by `- a` lines.
    if (!value && key === "tags") {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) items.push(unquote(lines[++i].replace(/^\s*-\s+/, "").trim()));
      fm.tags = items.filter(Boolean);
      continue;
    }
    value = value.replace(/\s+#.*$/, "");
    switch (key) {
      case "title":
        fm.title = unquote(value) || null;
        break;
      case "pinned":
      case "inject":
      case "actionable": {
        const b = parseBool(value);
        if (b !== null) fm[key] = b;
        break;
      }
      case "tags":
        fm.tags = parseList(value);
        break;
      case "created":
      case "updated": {
        const v = unquote(value);
        fm[key] = v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
        break;
      }
    }
  }
  return { frontmatter: fm, body: raw.slice(m[0].length), rawHeader: m[0] };
}

function quote(v: string) {
  return /^[\w .,/()&+-]*$/.test(v) && v.trim() === v && v !== "" && parseBool(v) === null ? v : JSON.stringify(v);
}

export function serializeNote(fm: NoteFrontmatter, body: string, original?: ParsedNote): string {
  if (original) {
    const changed = (Object.keys(fm) as (keyof NoteFrontmatter)[]).filter((key) => JSON.stringify(fm[key]) !== JSON.stringify(original.frontmatter[key]));
    if (!changed.length) return (original.rawHeader ?? "") + body;
    const newline = original.rawHeader?.includes("\r\n") ? "\r\n" : "\n";
    const lines = original.rawHeader ? FENCE.exec(original.rawHeader)![1].split(/\r?\n/) : [];
    for (const key of changed) {
      const value = fm[key];
      const line = `${key}: ${Array.isArray(value) ? `[${value.map(quote).join(", ")}]` : typeof value === "string" ? quote(value) : String(value)}`;
      const index = lines.findIndex((l) => new RegExp(`^${key}\\s*:`, "i").test(l));
      if (index < 0) lines.push(line);
      else {
        let end = index + 1;
        while (end < lines.length && /^(\s+\S|\s*-\s)/.test(lines[end])) end++;
        lines.splice(index, end - index, line);
      }
    }
    return `---${newline}${lines.join(newline)}${newline}---${newline}${body}`;
  }
  const lines = [
    "---",
    `title: ${quote(fm.title ?? "Untitled")}`,
    `pinned: ${fm.pinned}`,
    `inject: ${fm.inject}`,
    `actionable: ${fm.actionable}`,
    `tags: [${fm.tags.map(quote).join(", ")}]`,
    ...(fm.created ? [`created: ${fm.created}`] : []),
    ...(fm.updated ? [`updated: ${fm.updated}`] : []),
    "---",
  ];
  return `${lines.join("\n")}\n${body.replace(/^\n+/, "")}`;
}

/** The note's title: frontmatter, else the first `#` heading, else the fallback (usually the file name). */
export function noteTitle(parsed: ParsedNote, fallback: string) {
  if (parsed.frontmatter.title) return parsed.frontmatter.title;
  const h = /^#\s+(.+?)\s*#*\s*$/m.exec(parsed.body);
  return h ? h[1] : fallback;
}

/** A one-line plain-text preview, skipping a leading heading that just repeats the title. */
export function noteExcerpt(body: string, title?: string, max = 140) {
  const lines = body
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, "")
        .replace(/[*_`~]|!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim(),
    )
    .filter(Boolean);
  if (title && lines[0] === title) lines.shift();
  const text = lines.join(" ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const TASK = /^(\s*[-*+]\s+)\[([ xX])\]\s+(.+)\r?$/;

/** Every `- [ ]` / `- [x]` line in the body, outside fenced code. */
export function extractTasks(body: string): Omit<NoteTask, "noteId" | "noteTitle" | "notePath">[] {
  const tasks: Omit<NoteTask, "noteId" | "noteTitle" | "notePath">[] = [];
  let fence = false;
  body.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const m = TASK.exec(line);
    if (m) tasks.push({ line: i, text: m[3].trim(), done: m[2] !== " " });
  });
  return tasks;
}

/** Tick or untick the task on `line`. Returns the body unchanged if that line isn't a task. */
export function setTaskDone(body: string, line: number, done: boolean) {
  const lines = body.split("\n");
  const m = TASK.exec(lines[line] ?? "");
  if (!m) return body;
  lines[line] = lines[line].replace(/^(\s*[-*+]\s+)\[[ xX]\]/, `$1[${done ? "x" : " "}]`);
  return lines.join("\n");
}
