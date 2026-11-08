import { cn } from "@/lib/utils";

/**
 * Tiny pixel-art icons drawn from string grids: each character is one pixel, `.` is transparent and other characters
 * index into `palette`.
 */
const ICONS = {
  checklist: {
    palette: { a: "var(--w-bronze-dark)", b: "var(--w-parchment)", c: "var(--w-parchment-ink)" },
    rows: [".aaaaaaaaa.", ".abbbbbbba.", ".abcbcccba.", ".abbbbbbba.", ".abcbcccba.", ".abbbbbbba.", ".abcbcccba.", ".abbbbbbba.", ".aaaaaaaaa."],
  },
  castle: {
    palette: { a: "var(--w-bronze-dark)", b: "var(--w-mountain)", c: "var(--w-snow)", d: "oklch(0.6 0.19 25)" },
    rows: [
      "......d.....",
      "......dd....",
      "......a.....",
      ".b.b.bbb.b.b",
      ".bbb.bcb.bbb",
      ".bcb.bbb.bcb",
      ".bbbbbbbbbbb",
      ".bcbbbaabbcb",
      ".bbbbaaaabbb",
      ".bbbbaaaabbb",
    ],
  },
  scroll: {
    palette: { a: "var(--w-bronze-dark)", b: "var(--w-parchment)", c: "var(--w-parchment-ink)" },
    rows: [
      ".aaaaaaaaa..",
      "abbbbbbbbba.",
      ".abcccccba..",
      ".abbbbbbba..",
      ".abccccbba..",
      ".abbbbbbba..",
      ".abcccccba..",
      ".abbbbbbba..",
      "abbbbbbbbba.",
      ".aaaaaaaaa..",
    ],
  },
  quill: {
    palette: { a: "var(--w-bronze-dark)", b: "var(--w-snow)", c: "var(--w-parchment-ink)", d: "var(--w-bronze-light)" },
    rows: [
      ".........bb",
      "........bbb",
      ".......bbb.",
      "......bbb..",
      ".....bbb...",
      "....bbb....",
      "...dbb.....",
      "..dd.......",
      ".ad........",
      "aaa..cc....",
      ".a..cccc...",
    ],
  },
  hourglass: {
    palette: { a: "var(--w-bronze-dark)", b: "var(--w-snow)", c: "var(--w-plains)" },
    rows: [
      "aaaaaaaaaa",
      ".abbbbbba.",
      ".acccccca.",
      "..acccca..",
      "...acca...",
      "...abba...",
      "..abcbba..",
      ".abbccbba.",
      ".acccccca.",
      "aaaaaaaaaa",
    ],
  },
  chest: {
    palette: { a: "var(--w-bronze-dark)", b: "var(--w-bronze)", c: "var(--w-bronze-light)", d: "oklch(0.83 0.15 85)" },
    rows: [
      "..aaaaaaaa..",
      ".abbbbbbbba.",
      "abccccccccba",
      "abbbbbbbbbba",
      "aaaaaddaaaaa",
      "abbbbddbbbba",
      "abbbbbbbbbba",
      "abccccccccba",
      "abbbbbbbbbba",
      "aaaaaaaaaaaa",
    ],
  },
} satisfies Record<string, { palette: Record<string, string>; rows: string[] }>;

export type PixelIconName = keyof typeof ICONS;

export function PixelIcon({ name, className }: { name: PixelIconName; className?: string }) {
  const { palette, rows } = ICONS[name];
  const width = Math.max(...rows.map((r) => r.length));
  return (
    <svg viewBox={`0 0 ${width} ${rows.length}`} className={cn("pixel", className)} aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === "." ? null : <rect key={`${x},${y}`} x={x} y={y} width={1.02} height={1.02} fill={palette[ch as keyof typeof palette]} />,
        ),
      )}
    </svg>
  );
}
