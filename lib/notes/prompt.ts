import "server-only";
import { mkdir } from "node:fs/promises";
import type { Project, Workspace } from "@/lib/projects/types";
import { notesDirsFor } from "./resolve";
import { listNotes } from "./store";
import type { Note } from "./types";

/** Cap on injected note text so a big notebook can't crowd out the conversation. */
const INJECT_LIMIT = 24_000;

export type SessionNotes = { projectDir: string; workspaceDir: string; project: Note[]; workspace: Note[] };

/** Ensure both notes dirs exist (agents may create files there) and read their notes, memory excluded. */
export async function loadSessionNotes(project: Project, workspace: Workspace): Promise<SessionNotes> {
  const dirs = notesDirsFor(project, workspace);
  await Promise.all([mkdir(dirs.project.notesDir, { recursive: true }), mkdir(dirs.workspace.notesDir, { recursive: true })]);
  const [p, w] = await Promise.all([
    listNotes(dirs.project, { withMemory: false }).catch(() => []),
    listNotes(dirs.workspace, { withMemory: false }).catch(() => []),
  ]);
  return { projectDir: dirs.project.notesDir, workspaceDir: dirs.workspace.notesDir, project: p, workspace: w };
}

const day = (iso: string) => iso.slice(0, 10);

function indexLine(n: Note) {
  const flags = [n.pinned && "pinned", n.inject && "injected below", n.actionable && "actionable"].filter(Boolean);
  const tasks = n.openTasks ? ` · ${n.openTasks} open task${n.openTasks === 1 ? "" : "s"}` : "";
  return `- ${n.title} (\`${n.path}\`) · updated ${day(n.updatedAt)}${tasks}${flags.length ? ` · ${flags.join(", ")}` : ""}`;
}

// A follow-up could expose structured note writes as an in-process MCP server
// (`createSdkMcpServer`); for now agents edit the files with their normal tools.
export function notesPrompt(notes: SessionNotes) {
  const lines = [
    "# Thunk notes",
    "Besides memory, the user keeps a notebook per project and per workspace. Each note is a markdown file with a small frontmatter block (`title`, `pinned`, `inject`, `actionable`, `tags`, `created`, `updated`). Read and edit them with your file tools:",
    `- Project notes: \`${notes.projectDir}\``,
    `- Workspace notes: \`${notes.workspaceDir}\``,
    "",
    "Edit notes in place and keep the frontmatter intact. Put follow-ups the user should see as `- [ ]` checklist items in a note with `actionable: true`, and tick them `- [x]` when done. When a topic doesn't fit an existing note, create `<random-lowercase-id>.md` with frontmatter (title, `pinned: false`, `inject: false`, `actionable`, `tags: []`). This list was captured when the session started; re-read the files for current contents.",
  ];
  for (const [label, list] of [["Project notes", notes.project], ["Workspace notes", notes.workspace]] as const) {
    lines.push("", `## ${label}`, ...(list.length ? list.map(indexLine) : ["- (none yet)"]));
  }

  const injected = [...notes.project, ...notes.workspace].filter((n) => n.inject && n.markdown.trim());
  if (injected.length) {
    lines.push("", "## Injected notes (current contents)");
    let budget = INJECT_LIMIT;
    let cut = 0;
    for (const n of injected) {
      const text = n.markdown.trim();
      if (budget <= 0) {
        cut++;
        continue;
      }
      const piece = text.length > budget ? `${text.slice(0, budget)}\n…(truncated)` : text;
      if (text.length > budget) cut++;
      budget -= piece.length;
      lines.push("", `### ${n.title} (\`${n.path}\`)`, piece);
    }
    if (cut) lines.push("", `(${cut} injected note${cut === 1 ? " was" : "s were"} truncated or omitted to stay under ${INJECT_LIMIT} characters; read the files for the rest.)`);
  }
  return lines.join("\n");
}
