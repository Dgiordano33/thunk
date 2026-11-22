"use client";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SLACK_APP_MANIFEST } from "@/lib/integrations/slack/manifest";
import { cn } from "@/lib/utils";
import { settingsPath } from "./sections";
import { useSlack } from "./use-slack";

function Status({ state }: { state: "on" | "off" | "setup" }) {
  const label = { on: "On", off: "Off", setup: "Not set up" }[state];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]", state === "on" ? "text-foreground" : "text-muted-foreground")}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", state === "on" ? "bg-emerald-500" : "bg-muted-foreground/50")} />
      {label}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button type="button" size="xs" variant="outline" onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => toast.error("Could not copy"))}>
      {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : label}
    </Button>
  );
}

function SlackSetupSteps() {
  return (
    <ol className="text-muted-foreground list-decimal space-y-2 pl-4 text-xs leading-relaxed">
      <li>
        Create a Slack app from this manifest at{" "}
        <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer" className="text-foreground inline-flex items-center gap-0.5 underline-offset-2 hover:underline">api.slack.com/apps<ExternalLinkIcon className="size-3" /></a>{" "}
        (Create New App → From a manifest).
        <div className="mt-1.5 flex items-start gap-2">
          <pre className="bg-muted/60 max-h-28 flex-1 overflow-auto rounded-md p-2 text-[11px] leading-snug">{SLACK_APP_MANIFEST}</pre>
          <CopyButton text={SLACK_APP_MANIFEST} label="Copy" />
        </div>
      </li>
      <li>Install it to your workspace, then copy the <strong className="text-foreground font-medium">Bot User OAuth Token</strong> from OAuth &amp; Permissions. It starts with <code>xoxb-</code>.</li>
      <li>In Slack, open your profile, choose <strong className="text-foreground font-medium">⋯ → Copy member ID</strong>, and paste it below.</li>
    </ol>
  );
}

function SlackCard() {
  const { slack, error, save, connected } = useSlack();
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "toggle" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const member = userId ?? slack?.userId ?? "";
  const ready = Boolean(slack?.hasToken && slack.userId);
  const dirty = Boolean(token.trim()) || (userId !== null && userId !== (slack?.userId ?? ""));
  const state = connected ? "on" : ready ? "off" : "setup";

  const run = async (kind: "save" | "test" | "toggle", work: () => Promise<string | void>) => {
    setBusy(kind); setResult(null);
    try { const text = await work(); if (text) setResult({ ok: true, text }); }
    catch (e) { setResult({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" }); }
    finally { setBusy(null); }
  };
  const saveFields = () => run("save", async () => {
    await save({ ...(token.trim() ? { botToken: token.trim() } : {}), ...(userId !== null ? { userId } : {}) });
    setToken(""); setUserId(null);
    return "Saved.";
  });
  const test = () => run("test", async () => {
    const response = await fetch("/api/integrations/slack/test", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Test failed");
    return `Sent a DM from ${data.bot} in ${data.team}. Check Slack.`;
  });
  const toggle = () => run("toggle", async () => { await save({ enabled: !slack?.enabled }); });

  return (
    <section className="rounded-lg border bg-background/60" aria-labelledby="slack-title">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 id="slack-title" className="text-sm font-medium">Slack</h3>
          <p className="text-muted-foreground text-xs">A DM to you when something needs you and you haven&apos;t seen it in Thunk for 30 seconds. Settled notifications are crossed out.</p>
        </div>
        {slack && <Status state={state} />}
      </header>
      <div className="space-y-4 px-4 py-4">
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        {!slack && !error && <p role="status" className="text-muted-foreground text-sm">Loading…</p>}
        {slack && <>
          {ready ? <details className="text-xs"><summary className="text-muted-foreground cursor-pointer">Setup steps</summary><div className="mt-3"><SlackSetupSteps /></div></details> : <SlackSetupSteps />}
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (dirty) void saveFields(); }}>
            <label className="space-y-1 text-xs">
              <span className="block font-medium">Bot token</span>
              <Input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} disabled={slack.tokenFromEnv}
                placeholder={slack.tokenFromEnv ? "Set by SLACK_BOT_TOKEN" : slack.hasToken ? `Saved (${slack.tokenHint}). Paste to replace.` : "xoxb-…"} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block font-medium">Your member ID</span>
              <Input autoComplete="off" spellCheck={false} value={member} onChange={(e) => setUserId(e.target.value)} disabled={slack.userFromEnv} placeholder="U0123ABCDEF" />
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={!dirty || busy !== null}>{busy === "save" ? "Saving…" : "Save"}</Button>
              <Button type="button" size="sm" variant="outline" disabled={!ready || dirty || busy !== null} onClick={() => void test()}>{busy === "test" ? "Sending…" : "Send test DM"}</Button>
              <Button type="button" size="sm" variant={slack.enabled ? "outline" : "default"} disabled={!ready || dirty || busy !== null} onClick={() => void toggle()} aria-pressed={slack.enabled}>
                {slack.enabled ? "Turn off" : "Turn on"}
              </Button>
              {result && <span role={result.ok ? "status" : "alert"} className={cn("text-xs", result.ok ? "text-muted-foreground" : "text-destructive")}>{result.text}</span>}
            </div>
          </form>
          <p className="text-muted-foreground text-xs">
            Choose which kinds go to Slack in <Link href={settingsPath("notifications")} className="text-foreground underline-offset-2 hover:underline">Notifications</Link>. By default, only the ones where an agent is waiting on you.
            The token is stored on the server in <code>~/.thunk/config/integrations.json</code> and never shown again.
          </p>
        </>}
      </div>
    </section>
  );
}

export function IntegrationSettings() {
  return (
    <div className="space-y-6">
      <SlackCard />
      <section className="rounded-lg border border-dashed px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">Linear</h3>
            <p className="text-muted-foreground text-xs">Issues assigned to you become tasks, and closing a task closes its issue. Coming next.</p>
          </div>
          <span className="text-muted-foreground text-[11px]">Soon</span>
        </div>
      </section>
    </div>
  );
}
