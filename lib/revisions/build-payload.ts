import { createTwoFilesPatch, structuredPatch } from "diff";

export type RevisionComment = {
  id: string;
  status: "open" | "resolved";
  kind: "change" | "question" | "side_chat";
  /** Mark text re-read at send time (or the creation snapshot if the mark was deleted). */
  quote: string;
  /** e.g. "## Heading › paragraph 2" */
  context: string;
  body: string;
  replies: { body: string }[];
  detached?: boolean;
};

export type RevisionInput = {
  documentId: string;
  version: number;
  /** "response" documents revise an assistant turn; "plan" documents revise an ExitPlanMode proposal. */
  kind?: "response" | "plan";
  baselineMarkdown: string;
  editedMarkdown: string;
  comments: RevisionComment[];
};

export type RevisionStat = { added: number; removed: number; hunks: number; comments: number };

const FULL_DOC_LIMIT = 40_000;

export function diffStat(baseline: string, edited: string): Omit<RevisionStat, "comments"> {
  const patch = structuredPatch("a", "b", ensureNl(baseline), ensureNl(edited), "", "", { context: 0 });
  let added = 0;
  let removed = 0;
  for (const h of patch.hunks)
    for (const line of h.lines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  return { added, removed, hunks: patch.hunks.length };
}

export function buildRevisionPayload(input: RevisionInput): { payload: string; stat: RevisionStat } {
  const baseline = ensureNl(input.baselineMarkdown);
  const edited = ensureNl(input.editedMarkdown);
  const stat = diffStat(baseline, edited);
  const comments = input.comments.filter((c) => c.status === "open");
  const isPlan = input.kind === "plan";

  const intro = isPlan
    ? "The user reviewed your proposed plan as an editable document and requested changes. Apply their edits and address every comment, then propose the revised plan again with ExitPlanMode (the complete plan, not a diff). Stay in plan mode."
    : 'The user reviewed your previous response as an editable document. Apply their edits and address every comment. Reply with the complete revised document in markdown (not a diff), keeping anything they did not touch. Answer questions inline where natural and briefly in a short "Notes" section at the end.';

  const parts: string[] = [];
  parts.push(`<document_revision document_id="${input.documentId}" turn="${input.version}">`);
  parts.push(intro);
  parts.push("");

  if (stat.hunks > 0) {
    const patch = createTwoFilesPatch("original.md", "edited.md", baseline, edited, "", "", { context: 3 })
      .split("\n")
      .filter((l) => !l.startsWith("==="))
      .join("\n")
      .trim();
    parts.push(`<edits format="unified-diff" stat="+${stat.added} -${stat.removed}">`);
    parts.push(patch);
    parts.push("</edits>");
  } else {
    parts.push(`<edits format="unified-diff" stat="+0 -0">(no direct edits)</edits>`);
  }
  parts.push("");

  parts.push(`<comments count="${comments.length}">`);
  for (const c of comments) {
    parts.push(`<comment id="${c.id}" status="${c.status}" kind="${c.kind}"${c.detached ? ' detached="true"' : ""}>`);
    parts.push(`  <quote>${escapeXml(c.quote)}</quote>`);
    if (c.context) parts.push(`  <context>${escapeXml(c.context)}</context>`);
    parts.push(`  <body>${escapeXml(c.body)}</body>`);
    for (const r of c.replies) parts.push(`  <reply>${escapeXml(r.body)}</reply>`);
    parts.push(`</comment>`);
  }
  parts.push("</comments>");
  parts.push("");

  if (edited.length <= FULL_DOC_LIMIT) {
    parts.push("<edited_document>");
    parts.push(edited.trimEnd());
    parts.push("</edited_document>");
  } else {
    parts.push(`<edited_document omitted="true" chars="${edited.length}" />`);
  }
  parts.push("</document_revision>");

  return { payload: parts.join("\n"), stat: { ...stat, comments: comments.length } };
}

function ensureNl(s: string) {
  return s.endsWith("\n") ? s : `${s}\n`;
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
