"use client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { usePaths } from "@/components/layout/paths-context";
import type { Card } from "@/lib/board/types";

/**
 * Adds a text card to a project's main canvas, with a link back to where it came from, and offers to open
 * the canvas on it. For Tasks and Notes.
 */
export function useAddToCanvas() {
  const router = useRouter();
  const paths = usePaths();
  return async (projectId: string, item: { title: string; markdown: string; from: string; href: string }) => {
    try {
      const markdown = [`# ${item.title}`, item.markdown.trim(), `From ${item.from}: [${item.title}](${item.href})`].filter(Boolean).join("\n\n");
      const r = await fetch(`/api/projects/${projectId}/board/cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: item.title.slice(0, 200), markdown: markdown.slice(0, 100_000) }) });
      const data = (await r.json()) as { card?: Card; error?: string };
      if (!r.ok || !data.card) throw new Error(data.error || "Could not add it to the canvas");
      const href = `${paths.project(projectId)}/canvas?card=${encodeURIComponent(data.card.id)}`;
      toast("Added to Canvas", { description: item.title, action: { label: "Open canvas", onClick: () => router.push(href) } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
}
