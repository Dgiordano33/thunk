// The Slack DM for a finished routine run. Pure, so it can be tested without Slack.
import type { SlackMessage } from "./client";

export type RunReportInput = {
  routine: string;
  project: string;
  status: "succeeded" | "failed" | "cancelled" | "needs_attention" | "queued" | "running";
  summary: string;
  diff: { files: number; additions: number; deletions: number } | null;
  prUrl: string | null;
  costUsd: number;
  error: string | null;
  /** Absolute links back into Thunk. */
  noteUrl: string | null;
  sessionUrl: string | null;
};

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ICON: Record<RunReportInput["status"], string> = { succeeded: "✅", failed: "❌", cancelled: "⏹️", needs_attention: "✋", queued: "⏳", running: "⏳" };
const WORD: Record<RunReportInput["status"], string> = { succeeded: "succeeded", failed: "failed", cancelled: "was cancelled", needs_attention: "needs you", queued: "is queued", running: "is running" };

export function runReportMessage(r: RunReportInput): SlackMessage {
  const headline = `${ICON[r.status]} *${esc(r.routine)}* ${WORD[r.status]}`;
  const facts = [
    esc(r.project),
    r.diff ? (r.diff.files ? `+${r.diff.additions} −${r.diff.deletions} in ${r.diff.files} ${r.diff.files === 1 ? "file" : "files"}` : "no changes") : null,
    `$${r.costUsd.toFixed(2)}`,
  ].filter(Boolean).join(" · ");
  const summary = r.summary.trim() ? esc(r.summary.trim().length > 1200 ? `${r.summary.trim().slice(0, 1200)}…` : r.summary.trim()) : "_The agent did not write a summary._";
  const buttons = [
    r.prUrl && { type: "button", text: { type: "plain_text", text: "Pull request" }, url: r.prUrl },
    r.noteUrl && { type: "button", text: { type: "plain_text", text: "Report" }, url: r.noteUrl },
    r.sessionUrl && { type: "button", text: { type: "plain_text", text: "Session" }, url: r.sessionUrl },
  ].filter(Boolean);
  return {
    text: `${r.routine} ${WORD[r.status]}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: headline } },
      { type: "context", elements: [{ type: "mrkdwn", text: facts }] },
      { type: "section", text: { type: "mrkdwn", text: summary } },
      ...(r.error ? [{ type: "context", elements: [{ type: "mrkdwn", text: `Error: ${esc(r.error.slice(0, 300))}` }] }] : []),
      ...(buttons.length ? [{ type: "actions", elements: buttons }] : []),
    ],
  };
}
