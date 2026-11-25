import "server-only";
import { boardFor } from "./service";
import { readCard } from "./store";
import { canvasPath } from "@/lib/routes";
import type { Project } from "@/lib/projects/types";

/** "Start session from card" on a canvas: the card's text as the first prompt. Null when the card is gone. */
export async function cardPrompt(project: Project, boardId: string, cardId: string) {
  try {
    const { dir } = await boardFor(project.id, boardId);
    const c = await readCard(dir, cardId);
    const text = c.kind === "doc" ? c.markdown.trim() : "";
    return `${text || c.title}\n\n(From a card on this project's canvas: ${canvasPath(project, boardId, c.id)})`;
  } catch {
    return undefined;
  }
}
