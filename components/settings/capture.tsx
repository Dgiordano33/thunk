"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { DEFAULT_APP_SHORTCUT, fromEvent, isMac, label, problem, useIsMac } from "@/lib/capture/shortcut";
import { Checkbox } from "@/components/ui/checkbox";
import { useUi } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";
import { SettingGroup, SettingRow } from "./setting-row";

type DesktopState = { shortcut: string; unavailable?: string; openAtLogin?: boolean | null };
type Bridge = { settings: (value?: string, options?: { openAtLogin?: boolean }) => Promise<DesktopState> };
const bridge = () => (window as Window & { thunkCapture?: Bridge }).thunkCapture;

/** Click, then press the keys. Escape cancels. */
function ShortcutRecorder({ id, value, onChange, fallback }: { id: string; value: string; onChange: (accel: string) => Promise<void> | void; fallback: string }) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const mac = useIsMac();
  const shown = mac === null ? "" : label(value, mac);
  const save = async (accel: string) => {
    try { await onChange(accel); setMessage({ text: accel ? `Saved: ${label(accel)}` : "Turned off" }); }
    catch (e) { setMessage({ text: (e as Error).message.replace(/^.*Error: /, ""), error: true }); }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button id={id} type="button" data-shortcut-recorder aria-label={recording ? "Press the new shortcut" : `Change shortcut, now ${shown}`}
          className={cn("bg-background flex h-9 min-w-36 items-center justify-center rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", recording && "ring-ring ring-2")}
          onClick={() => { setRecording(true); setMessage(null); }}
          onBlur={() => setRecording(false)}
          onKeyDown={(e) => {
            if (!recording) return;
            e.preventDefault(); e.stopPropagation();
            if (e.key === "Escape") { setRecording(false); return; }
            const accel = fromEvent(e.nativeEvent);
            if (!accel) return; // A lone modifier: keep listening.
            const why = problem(accel);
            setRecording(false);
            if (why) setMessage({ text: why, error: true }); else void save(accel);
          }}>
          {recording ? <span className="text-muted-foreground">Press keys…</span> : value ? <Kbd className="pointer-events-none">{shown}</Kbd> : <span className="text-muted-foreground">Off</span>}
        </button>
        {value !== fallback && <Button variant="ghost" size="sm" onClick={() => void save(fallback)}>Reset</Button>}
        {value && <Button variant="ghost" size="sm" onClick={() => void save("")}>Turn off</Button>}
      </div>
      <p role="status" className={cn("min-h-4 text-xs", message?.error ? "text-destructive" : "text-muted-foreground")}>{message?.text}</p>
    </div>
  );
}

function DesktopShortcut() {
  const [state, setState] = useState<DesktopState | null>(null);
  const [loginError, setLoginError] = useState("");
  useEffect(() => { void bridge()?.settings().then(setState).catch(() => {}); }, []);
  if (state === null) return (
    <SettingRow label="Anywhere on your computer" description={<>Needs the Thunk desktop app running: a shortcut then opens a small Capture window over whatever app you&apos;re in. Get it from Thunk → Download Latest Release, then set the shortcut here in the app.</>} />
  );
  const mac = isMac();
  return <>
    <SettingRow label="Anywhere on your computer" htmlFor="capture-desktop-shortcut"
      description={<>Opens a small Capture window over whatever app is in front{mac ? ", full-screen ones included" : ""}, while Thunk is running. Stored on this computer.
        {state.unavailable && <span role="alert" className="text-destructive mt-1 block">Another app took {label(state.unavailable)} before Thunk started, so this shortcut is off. Pick another.</span>}</>}>
      <ShortcutRecorder id="capture-desktop-shortcut" value={state.shortcut} fallback="Alt+Space" onChange={async (accel) => setState(await bridge()!.settings(accel))} />
    </SettingRow>
    {state.openAtLogin !== null && (
      <SettingRow label="Open Thunk at login" htmlFor="capture-open-at-login" description={<>Keeps the shortcut working after you restart your {mac ? "Mac" : "computer"}.{loginError && <span role="alert" className="text-destructive mt-1 block">{loginError}</span>}</>}>
        <Checkbox id="capture-open-at-login" checked={state.openAtLogin} onCheckedChange={async (checked) => {
          const openAtLogin = checked === true;
          setLoginError("");
          try { setState(await bridge()!.settings(undefined, { openAtLogin })); } catch (e) { setLoginError((e as Error).message.replace(/^.*Error: /, "")); }
        }} />
      </SettingRow>
    )}
  </>;
}

export function CaptureSettings() {
  const shortcut = useUi((s) => s.captureShortcut);
  const setShortcut = useUi((s) => s.setCaptureShortcut);
  return (
    <div className="space-y-6">
      <SettingGroup title="Shortcuts" description="Capture opens a one-line field: type a thought, press Enter, and a worker takes a first crack at it. Click a shortcut, then press the keys you want.">
        <SettingRow label="Inside Thunk" htmlFor="capture-app-shortcut" description="Opens Capture from any Thunk page. Stored in this browser.">
          <ShortcutRecorder id="capture-app-shortcut" value={shortcut} fallback={DEFAULT_APP_SHORTCUT} onChange={setShortcut} />
        </SettingRow>
        <DesktopShortcut />
      </SettingGroup>
    </div>
  );
}
