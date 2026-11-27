import { Sphere, StarMark, sparklePath } from "@/components/space/sphere";
import { PLANET_PALETTES } from "@/lib/world/system";

const ORBIT = "M102,82a78,25 0 1,0 156,0a78,25 0 1,0 -156,0Z";
const TILT = "rotate(-12 180 82)";
/** Where each worker sits on the orbit when nothing moves, and how far into the lap it starts. */
const WORKERS = [{ at: 8, tone: "var(--status-running)" }, { at: 41, tone: "var(--foreground)" }, { at: 74, tone: "var(--status-running)" }];
const SPARKLES: [number, number, number, number][] = [[96, 132, 3, 0.7], [150, 20, 2.5, 0.6], [262, 126, 3.5, 0.8], [300, 24, 2.5, 0.6], [344, 122, 2, 0.5], [16, 24, 2.5, 0.6]];
const label = { fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 8, letterSpacing: "0.12em", fill: "var(--sp-meta, var(--muted-foreground))" } as const;

/**
 * The handoff as a small star chart (solar-system look only): your writing is the star, the chief is the planet,
 * workers are the satellites circling it, and the Inbox is the moon they report to. Everything you relay travels to the
 * chief, which sends it on to its workers. Motion lives in globals.css (`.sp-handoff`) and stops for reduced motion.
 */
export function HandoffScene() {
  return (
    <figure className="sp-handoff world:hidden vanilla:hidden">
      <div className="overflow-hidden rounded-lg border" style={{ background: "linear-gradient(var(--sky-top), var(--sky-bot))" }}>
        <svg viewBox="0 0 360 150" className="block w-full" role="img" aria-label="A thought or note leaves you, the chief splits it between workers, and their reports land in your Inbox.">
          {SPARKLES.map(([x, y, s, o]) => <path key={`${x}-${y}`} d={sparklePath(s, 0.14)} transform={`translate(${x} ${y})`} fill="var(--star-core)" opacity={o} className="hf-twinkle" style={{ animationDelay: `${-(x % 7) * 0.6}s` }} />)}
          <g fill="none" stroke="var(--orbit)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="0.1 4.5">
            <path d="M62,60Q108,30 160,66" />
            <path d="M262,66Q288,56 308,74" />
            <path d={ORBIT} transform={TILT} />
          </g>
          <text {...label} x="104" y="32" textAnchor="middle">RELAY</text>
          <text {...label} x="288" y="50" textAnchor="middle">REPORTS</text>
          <StarMark cx={40} cy={80} r={5} />
          <g transform="translate(154 56)"><Sphere r={22} palette={PLANET_PALETTES[2]} light={-2.6} bands /></g>
          <g transform={TILT}>
            {WORKERS.map(({ at, tone }) => <g key={at} className="hf-sat" style={{ offsetDistance: `${at}%`, animationDelay: `${-(at / 100) * 22}s` }}><circle r="6.5" fill={tone} opacity="0.16" /><circle r="3.2" fill={tone} /></g>)}
          </g>
          <g className="hf-comet" style={{ offsetDistance: "55%" }}>
            <path d="M-16,0H-3" stroke="var(--star-core)" strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
            <path d={sparklePath(4.5, 0.14)} fill="var(--star-core)" />
          </g>
          <g transform="translate(306 66)"><Sphere r={12} palette={PLANET_PALETTES[5]} light={-2.6} /></g>
          <circle cx="333" cy="71" r="4" fill="var(--status-attention)" stroke="var(--void)" strokeWidth="1.5" />
        </svg>
      </div>
      <figcaption className="mt-2 grid grid-cols-[1fr_2fr_1fr] gap-2 text-center text-xs">
        <span><strong className="block">You relay</strong><span className="text-muted-foreground">a thought or a note</span></span>
        <span><strong className="block">The chief and its workers</strong><span className="text-muted-foreground">one worker per task, each in its own worktree</span></span>
        <span><strong className="block">You decide</strong><span className="text-muted-foreground">in the Inbox</span></span>
      </figcaption>
    </figure>
  );
}
