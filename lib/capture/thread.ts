// Client-safe. A thought handled by a chief keeps its back-and-forth in `summary`: the chief's report, then each
// reply you sent and each report that answered it, so the Inbox card reads as a conversation.
export type Turn = { who: "chief" | "you"; text: string };
const MARK = { you: "\n\n[[you]]\n", chief: "\n\n[[chief]]\n" } as const;

/** The first segment is always the chief's first report. */
export function parseThread(summary: string | null | undefined): Turn[] {
  if (!summary) return [];
  const turns: Turn[] = [];
  let who: Turn["who"] = "chief";
  let rest = summary;
  for (;;) {
    const next = (["you", "chief"] as const).map((w) => ({ w, at: rest.indexOf(MARK[w]) })).filter((m) => m.at >= 0).sort((a, b) => a.at - b.at)[0];
    const text = (next ? rest.slice(0, next.at) : rest).trim();
    if (text) turns.push({ who, text });
    if (!next) return turns;
    who = next.w;
    rest = rest.slice(next.at + MARK[next.w].length);
  }
}
export const appendTurn = (summary: string | null | undefined, who: Turn["who"], text: string) => (summary?.trim() ? summary.trim() + MARK[who] : who === "chief" ? "" : MARK[who]) + text.trim();
/** The chief's latest words, for places that show one line (the notification, the sent chip). */
export const lastReport = (summary: string | null | undefined) => parseThread(summary).filter((t) => t.who === "chief").at(-1)?.text ?? null;
