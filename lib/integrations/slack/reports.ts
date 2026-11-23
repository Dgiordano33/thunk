import "server-only";
import { slackSettings } from "@/lib/integrations/config";
import { publicUrl } from "@/lib/public-url";
import { slackClient } from "./client";
import { runReportMessage, type RunReportInput } from "./report-message";

/**
 * DM a routine's run report when the routine asks for it and Slack is on. Never throws: a Slack outage must not
 * fail the run.
 */
export async function postRunReport(report: Omit<RunReportInput, "noteUrl" | "sessionUrl"> & { notePath: string | null; sessionPath: string | null }) {
  try {
    const s = await slackSettings();
    if (!s.enabled || !s.botToken || !s.userId) return;
    const base = publicUrl();
    const client = slackClient(s.botToken);
    const channel = await client.openDm(s.userId);
    await client.post(channel, runReportMessage({
      ...report,
      noteUrl: report.notePath ? new URL(report.notePath, base).href : null,
      sessionUrl: report.sessionPath ? new URL(report.sessionPath, base).href : null,
    }));
  } catch (error) {
    console.error(`[thunk] slack: could not post the "${report.routine}" report`, error);
  }
}
