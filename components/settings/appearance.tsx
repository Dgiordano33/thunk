"use client";
import { useLook } from "@/components/look-context";
import type { Look } from "@/lib/look";
import { useUi } from "@/lib/store/ui-store";
import type { Theme } from "@/lib/theme";
import { ChoiceCards } from "./choice-cards";

/** A tiny app window in fixed colours, so each card shows its theme whatever the current one is. */
function Window({ bg, panel, line, accent }: { bg: string; panel: string; line: string; accent: string }) {
  return (
    <svg viewBox="0 0 160 90" className="size-full" preserveAspectRatio="xMidYMid slice">
      <rect width="160" height="90" fill={bg} />
      <rect x="10" y="10" width="38" height="70" rx="4" fill={panel} />
      {[20, 30, 40].map((y) => <rect key={y} x="16" y={y} width={y === 20 ? 22 : 26} height="4" rx="2" fill={line} />)}
      <rect x="56" y="10" width="94" height="70" rx="4" fill={panel} />
      <rect x="64" y="20" width="44" height="6" rx="3" fill={accent} />
      {[34, 44, 54].map((y) => <rect key={y} x="64" y={y} width={y === 54 ? 50 : 76} height="4" rx="2" fill={line} />)}
    </svg>
  );
}
const LIGHT = { bg: "#eef1f7", panel: "#ffffff", line: "#d5dae4", accent: "#1f2433" };
const DARK = { bg: "#12141b", panel: "#1d2029", line: "#363a47", accent: "#e8eaf0" };

function SystemPreview() {
  return (
    <span className="relative block size-full">
      <span className="absolute inset-0"><Window {...LIGHT} /></span>
      <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]"><Window {...DARK} /></span>
    </span>
  );
}

function SpacePreview() {
  return (
    <svg viewBox="0 0 160 90" className="size-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="space-sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e7efff" /><stop offset="1" stopColor="#fbe9f7" /></linearGradient>
      </defs>
      <rect width="160" height="90" fill="url(#space-sky)" />
      <ellipse cx="80" cy="47" rx="56" ry="17" fill="none" stroke="#3b4a9c" strokeOpacity="0.45" strokeDasharray="1 4" strokeLinecap="round" />
      <circle cx="80" cy="45" r="13" fill="#fff" stroke="#3b4a9c" strokeWidth="1.5" />
      <path d="M71 50a13 13 0 0 0 20 4" stroke="#3b4a9c" strokeOpacity="0.5" fill="none" />
      <circle cx="132" cy="38" r="5" fill="#fff" stroke="#3b4a9c" strokeWidth="1.2" />
      <circle cx="30" cy="56" r="4" fill="#fff" stroke="#3b4a9c" strokeWidth="1.2" />
      {[[18, 16], [140, 72], [120, 14], [44, 78]].map(([x, y]) => <circle key={`${x}`} cx={x} cy={y} r="1" fill="#3b4a9c" fillOpacity="0.5" />)}
    </svg>
  );
}

function WorldPreview() {
  const tiles = ["sssssggggggsssss", "ssssggggmmgggsss", "sssgggggmmggggss", "ssgggfffgggggggs", "ssggfffggggcggss", "sssgggggggggssss", "sssssggggsssssss", "ssssssssssssssss", "ssssssssssssssss"];
  const fill: Record<string, string> = { s: "#2b5f86", g: "#5f9a4a", m: "#8c8f99", f: "#3f7a3a", c: "#c9a14a" };
  return (
    <svg viewBox="0 0 160 90" className="size-full" preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges">
      {tiles.flatMap((row, y) => [...row].map((t, x) => <rect key={`${x},${y}`} x={x * 10} y={y * 10} width="10" height="10" fill={fill[t]} />))}
      <rect x="110" y="40" width="10" height="10" fill="#e6d3a0" stroke="#5a3d1a" strokeWidth="1" />
    </svg>
  );
}

export function AppearanceSettings() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const { look, setLook } = useLook();
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Theme</h3>
          <p className="text-muted-foreground text-xs">{look === "world" ? "Applies everywhere except the game world map, which is always dark." : "Light, dark, or follow your system."}</p>
        </div>
        <ChoiceCards<Theme>
          label="Theme"
          value={theme}
          onChange={setTheme}
          className="max-w-2xl grid-cols-3"
          options={[
            { value: "system", label: "System", preview: <SystemPreview /> },
            { value: "light", label: "Light", preview: <Window {...LIGHT} /> },
            { value: "dark", label: "Dark", preview: <Window {...DARK} /> },
          ]}
        />
      </section>
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Look</h3>
          <p className="text-muted-foreground text-xs">How the projects map is drawn.</p>
        </div>
        <ChoiceCards<Look>
          label="Look"
          value={look}
          onChange={setLook}
          className="max-w-xl grid-cols-2"
          options={[
            { value: "space", label: "Solar system", description: "Projects as planets in a quiet, light sky.", preview: <SpacePreview /> },
            { value: "world", label: "Game world", description: "Projects as towns on a pixel-art map. Always dark.", preview: <WorldPreview /> },
          ]}
        />
      </section>
    </div>
  );
}
