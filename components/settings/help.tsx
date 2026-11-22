"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useOnboarding } from "@/components/onboarding/provider";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { PROJECTS_PATH } from "@/lib/routes";
import type { ServerInfo } from "@/lib/server/info";
import { SettingGroup, SettingRow } from "./setting-row";

const SHORTCUTS: [string, string][] = [["⌘K", "Search and jump anywhere"], ["⌘,", "Open Settings"]];

function About() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/server/info", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error(); setInfo(await r.json()); }).catch(() => setError(true));
  }, []);
  const copy = () => {
    if (!info) return;
    const text = [`Thunk ${info.revision ?? "unknown build"}`, `Host: ${info.host} (${info.platform})`, `Node: ${info.node}`, `Database: ${info.database}`, `Browser: ${navigator.userAgent}`].join("\n");
    navigator.clipboard.writeText(text).then(() => toast.success("Copied"), () => toast.error("Could not copy"));
  };
  const rows: [string, React.ReactNode][] = info ? [
    ["Build", info.revision ? <code>{info.revision.slice(0, 7)}</code> : "Unknown"],
    ["Server", <>{info.host} <span className="text-muted-foreground">· {info.platform}</span></>],
    ["Database", info.database],
    ["Running since", new Date(info.startedAt).toLocaleString()],
    ["Node", info.node],
  ] : [];
  return (
    <SettingGroup title="About this server" description="Useful when reporting a problem.">
      {error && <p role="alert" className="px-4 py-3 text-sm">Could not load server details.</p>}
      {!info && !error && <p role="status" className="text-muted-foreground px-4 py-3 text-sm">Loading…</p>}
      {info && <>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-xs">
          {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
        </dl>
        <div className="flex justify-end px-4 py-2"><Button size="xs" variant="ghost" onClick={copy}>Copy details</Button></div>
      </>}
    </SettingGroup>
  );
}

export function HelpSettings() {
  const router = useRouter();
  const onboarding = useOnboarding();
  const go = (action: () => void) => { action(); router.push(PROJECTS_PATH); };
  return (
    <div className="space-y-6">
      <SettingGroup title="Guides">
        <SettingRow label="Intro" description="The short tour shown on first launch.">
          <Button size="sm" variant="outline" onClick={() => go(() => onboarding.replay("intro"))}>Show intro</Button>
        </SettingRow>
        <SettingRow label="Map legend" description="What the shapes and badges on the projects map mean.">
          <Button size="sm" variant="outline" onClick={() => go(() => onboarding.replay("map-legend"))}>Show legend</Button>
        </SettingRow>
        <SettingRow label="Hints" description="Bring back every hint and the getting-started checklist you dismissed.">
          <Button size="sm" variant="outline" onClick={() => go(() => onboarding.resetAll())}>Reset hints</Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Keyboard shortcuts">
        {SHORTCUTS.map(([keys, label]) => <SettingRow key={keys} label={label}><Kbd>{keys}</Kbd></SettingRow>)}
      </SettingGroup>
      <About />
    </div>
  );
}
