// Pure routing-tag parsing and note write-back. Shared between server and tests; no imports.

export type RouteTarget = { projectId: string; name: string; slug: string; workspaces: { id: string; slug: string; name: string }[] };

export type RoutingItem = {
  /** 0-based line in the note body. */
  line: number;
  text: string;
  done: boolean;
  /** Route reference already written onto the line, so the item is not routed twice. */
  routed: string | null;
  /** The project (and workspace) the note pins this item to, from a `#tag` or a `## heading`. */
  target: { projectId: string; workspaceId: string | null; via: "tag" | "heading" } | null;
  /** A tag that names no project or workspace. */
  unknownTag: string | null;
};

const CHECK = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const TAG = /(?:^|\s)#([a-z0-9][a-z0-9_-]*)(?:\/([a-z0-9][a-z0-9_-]*))?(?=$|[\s.,;:!?)])/gi;
const MARK = /\s+→ [^\n]*\(r:([0-9a-f]{8})\)\s*$/;

export const slugOf = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const newRouteRef = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

function findProject(targets: RouteTarget[], word: string) {
  const key = slugOf(word);
  return key ? targets.find((t) => t.slug === key || slugOf(t.name) === key) ?? null : null;
}

/**
 * Checklist items of a note with where the note itself says they go. `#project` or `#project/workspace`
 * on the line wins; otherwise the nearest heading that names a project applies. A heading that names
 * no project ends the previous heading's scope.
 */
export function parseRoutingItems(markdown: string, targets: RouteTarget[]): RoutingItem[] {
  const items: RoutingItem[] = [];
  let heading: RoutingItem["target"] = null;
  let fence = false;
  for (const [line, raw] of markdown.split("\n").entries()) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const h = HEADING.exec(raw);
    if (h && !CHECK.test(raw)) {
      const project = findProject(targets, h[1].replace(/^#/, ""));
      heading = project ? { projectId: project.projectId, workspaceId: null, via: "heading" } : null;
      continue;
    }
    const m = CHECK.exec(raw);
    if (!m) continue;
    const routed = MARK.exec(m[4])?.[1] ?? null;
    const text = m[4].replace(MARK, "").trim();
    let target = heading;
    let unknownTag: string | null = null;
    for (const t of text.matchAll(TAG)) {
      const project = findProject(targets, t[1]);
      if (!project) { unknownTag ??= `#${t[1]}${t[2] ? `/${t[2]}` : ""}`; continue; }
      const workspace = t[2] ? project.workspaces.find((w) => w.slug === slugOf(t[2]!) || slugOf(w.name) === slugOf(t[2]!)) : null;
      if (t[2] && !workspace) { unknownTag ??= `#${t[1]}/${t[2]}`; continue; }
      target = { projectId: project.projectId, workspaceId: workspace?.id ?? null, via: "tag" };
      unknownTag = null;
      break;
    }
    items.push({ line, text, done: m[2] !== " ", routed, target, unknownTag });
  }
  return items;
}

/** Items still to route: unchecked and not yet marked. */
export const openItems = (items: RoutingItem[]) => items.filter((i) => !i.done && !i.routed);

/** Write ` → <label> (r:<ref>)` onto a checklist line, replacing an earlier mark. Null when the line is not a checklist item. */
export function markLine(markdown: string, line: number, ref: string, label: string, done?: boolean): string | null {
  const lines = markdown.split("\n");
  const m = CHECK.exec(lines[line] ?? "");
  if (!m) return null;
  const body = m[4].replace(MARK, "").trimEnd();
  lines[line] = `${m[1]}${done === undefined ? m[2] : done ? "x" : " "}${m[3]}${body} → ${label.replace(/[()\n]/g, " ").trim()} (r:${ref})`;
  return lines.join("\n");
}

/** Update the mark for `ref` wherever it now is (the person may have moved the line). Null when it is gone. */
export function updateMark(markdown: string, ref: string, label: string, done?: boolean): string | null {
  const line = markdown.split("\n").findIndex((l) => CHECK.test(l) && MARK.exec(l)?.[1] === ref);
  return line < 0 ? null : markLine(markdown, line, ref, label, done);
}
