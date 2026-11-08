// Shared between server and client: no server-only imports here.

export const VAULT_KINDS = ["image", "pdf", "text", "office", "other"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

export const VAULT_STATUSES = ["queued", "processing", "ready", "failed"] as const;
export type VaultStatus = (typeof VAULT_STATUSES)[number];

export const IDEA_KINDS = ["idea", "insight", "question", "action"] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

export type VaultIdea = { id: string; title: string; detail: string; kind: IdeaKind };

/** Where an idea was sent: a project note and/or a task. */
export type VaultPromotion = { ideaId: string; noteId?: string; taskId?: string };

export type VaultItem = {
  id: string;
  projectId: string;
  title: string;
  /** True once the user renames it, so re-extraction keeps their title. */
  titled?: boolean;
  /** The uploaded file's name, or "pasted.md" for pasted text. */
  filename: string;
  mime: string;
  size: number;
  kind: VaultKind;
  createdAt: string;
  updatedAt: string;
  status: VaultStatus;
  error?: string;
  summary?: string;
  ideas?: VaultIdea[];
  tags?: string[];
  promoted?: VaultPromotion[];
  /** Absolute path of the original on disk (server-filled). */
  path?: string;
};

/** Per-file and per-upload limits. */
export const VAULT_MAX_BYTES = 25 * 1024 * 1024;
export const VAULT_MAX_FILES = 10;

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_EXT = new Set([
  "txt", "md", "markdown", "mdx", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "xml", "html", "htm", "css",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs",
  "php", "sh", "sql", "graphql", "vtt", "srt", "log", "ini", "env", "rtf", "tex", "org", "rst",
]);
const OFFICE_EXT = new Set(["docx", "pptx", "xlsx"]);
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function extOf(filename: string) {
  const m = /\.([a-z0-9]{1,10})$/i.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

/** Classify an upload by its extension first (browsers often send an empty or generic MIME), then by MIME. */
export function classify(filename: string, mime: string): { kind: VaultKind; mime: string } {
  const ext = extOf(filename);
  const guessed = EXT_MIME[ext] ?? (mime || "application/octet-stream");
  if (IMAGE_MIME.has(guessed)) return { kind: "image", mime: guessed };
  if (guessed === "application/pdf") return { kind: "pdf", mime: guessed };
  if (OFFICE_EXT.has(ext)) return { kind: "office", mime: guessed };
  if (TEXT_EXT.has(ext) || guessed.startsWith("text/") || guessed === "application/json") return { kind: "text", mime: guessed.startsWith("text/") ? guessed : "text/plain" };
  return { kind: "other", mime: guessed };
}

export const KIND_LABELS: Record<VaultKind, string> = { image: "Image", pdf: "PDF", text: "Text", office: "Document", other: "File" };
export const IDEA_LABELS: Record<IdeaKind, string> = { idea: "Idea", insight: "Insight", question: "Question", action: "Action" };

export const isBusy = (i: Pick<VaultItem, "status">) => i.status === "queued" || i.status === "processing";
