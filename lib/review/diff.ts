export type DiffComment = { id: string; path: string; hunk: string; body: string };

export function diffHunks(diff: string): string[] {
  const start = diff.search(/^@@ /m);
  return start < 0 ? [] : diff.slice(start).split(/\n(?=@@ )/);
}

export function buildReview(comments: DiffComment[]) {
  return "Please address this code review. The quoted hunks are snapshots; check the current files before editing.\n\n" +
    comments.map((c) => `File: ${JSON.stringify(c.path)}\nComment: ${c.body}\nDiff snapshot:\n${c.hunk}`).join("\n\n---\n\n");
}
