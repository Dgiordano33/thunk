'use client';
import { useMemo, useRef, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { BoardButton } from './board-ui';
import { MAX_SLICES, anchorRow, formatValue, niceTicks, parseChart, type ChartAnchor, type ChartRow, type ChartSpec } from '@/lib/board/chart';
import type { Stroke } from '@/lib/board/types';

const PLOT_HEIGHT = 240, TOP = 12, BOTTOM = 26, RIGHT = 12, LEGEND_ROW = 22;
const INK = '#e44848';
const color = (i: number) => `var(--viz-${i + 1})`;
const num = (v: unknown): v is number => typeof v === 'number';

/** A data point a pin can attach to, in svg coordinates. */
type Mark = { row: number; series: string; x: number; y: number };
type Point = { x: number; y: number };
export type ChartTool = 'none' | 'pin' | 'draw';
export type ChartPin = { id: string; anchor: ChartAnchor; n: number };

/** A bar from `y0` to `y1`; `round` rounds the data end, used on the outermost segment of a stack. */
function bar(x: number, w: number, y0: number, y1: number, round = true) {
    const r = round ? Math.min(4, w / 2, Math.abs(y1 - y0)) : 0, d = y1 < y0 ? 1 : -1;
    return `M${x},${y0}V${y1 + d * r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + d * r}V${y0}Z`;
}
const yAxisWidth = (ticks: number[], unit?: string) => Math.max(...ticks.map(t => formatValue(t, unit, true).length)) * 6.5 + 14;
const seriesLabel = (spec: ChartSpec, key: string) => spec.series?.find(s => s.key === key)?.label ?? key;

/** Line and bar charts: one band per row on a category x axis. */
function cartesian(spec: ChartSpec, width: number) {
    const rows = spec.rows ?? [], series = spec.series ?? [], isBar = spec.type === 'bar', stacked = isBar && !!spec.stacked, n = rows.length;
    const values = stacked
        ? rows.flatMap(r => [series.reduce((a, s) => a + (num(r[s.key]) && r[s.key] as number > 0 ? r[s.key] as number : 0), 0), series.reduce((a, s) => a + (num(r[s.key]) && r[s.key] as number < 0 ? r[s.key] as number : 0), 0)])
        : rows.flatMap(r => series.map(s => r[s.key])).filter(num);
    const ticks = niceTicks(Math.min(...values), Math.max(...values)), lo = ticks[0], hi = ticks[ticks.length - 1];
    const left = yAxisWidth(ticks, spec.unit), right = width - RIGHT, bottom = PLOT_HEIGHT - BOTTOM;
    const band = (right - left) / (isBar ? n : Math.max(1, n - 1));
    const cx = (i: number) => isBar ? left + band * (i + .5) : n === 1 ? (left + right) / 2 : left + band * i;
    const y = (v: number) => bottom - (v - lo) / (hi - lo) * (bottom - TOP);
    const labels = rows.map(r => String(r[spec.x!]));
    // As many x labels as fit without touching, always keeping the first.
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((right - left) / (Math.max(...labels.map(l => l.length)) * 6.5 + 16)))));
    const group = stacked ? Math.min(band * .6, 48) : Math.min(band * .7, series.length * 26), barWidth = stacked ? group : Math.max(1, group / series.length - 2);
    const bars: { key: string; si: number; d: string }[] = [], marks: Mark[] = [];
    rows.forEach((r, i) => {
        if (!isBar)
            return series.forEach(s => { const v = r[s.key]; if (num(v)) marks.push({ row: i, series: s.key, x: cx(i), y: y(v) }); });
        let pos = 0, neg = 0;
        const segments = series.map((s, si) => {
            const v = r[s.key];
            if (!num(v))
                return null;
            const x = stacked ? cx(i) - group / 2 : cx(i) - group / 2 + si * (group / series.length) + 1;
            const from = !stacked ? 0 : v >= 0 ? pos : neg, to = from + v;
            if (stacked) {
                if (v >= 0) pos = to;
                else neg = to;
            }
            return { key: s.key, si, x, from, to };
        }).filter(s => !!s);
        const lastUp = segments.findLast(s => s.to >= s.from), lastDown = segments.findLast(s => s.to < s.from);
        for (const s of segments) {
            bars.push({ key: `${s.key}-${i}`, si: s.si, d: bar(s.x, barWidth, y(s.from), y(s.to), !stacked || s === lastUp || s === lastDown) });
            marks.push({ row: i, series: s.key, x: s.x + barWidth / 2, y: y(s.to) });
        }
    });
    return { kind: 'cartesian' as const, height: PLOT_HEIGHT, ticks, left, right, bottom, band, cx, y, labels, every, bars, marks, isBar, stacked };
}

/** Scatter: numeric x and y axes, one dot per row and series. */
function scatter(spec: ChartSpec, width: number) {
    const rows = spec.rows ?? [], series = spec.series ?? [];
    const xs = rows.map(r => r[spec.x!] as number), ys = rows.flatMap(r => series.map(s => r[s.key])).filter(num);
    const xt = niceTicks(Math.min(...xs), Math.max(...xs), 5, false), yt = niceTicks(Math.min(...ys), Math.max(...ys), 4, false);
    const left = yAxisWidth(yt, spec.unit), right = width - RIGHT, bottom = PLOT_HEIGHT - BOTTOM;
    const px = (v: number) => left + (v - xt[0]) / (xt[xt.length - 1] - xt[0]) * (right - left);
    const y = (v: number) => bottom - (v - yt[0]) / (yt[yt.length - 1] - yt[0]) * (bottom - TOP);
    const marks: Mark[] = rows.flatMap((r, i) => series.flatMap(s => { const v = r[s.key]; return num(v) ? [{ row: i, series: s.key, x: px(r[spec.x!] as number), y: y(v) }] : []; }));
    // Thin the x labels until they fit.
    const widest = Math.max(...xt.map(t => formatValue(t, '', true).length)) * 6.5 + 16, every = Math.max(1, Math.ceil(xt.length / Math.max(1, Math.floor((right - left) / widest))));
    return { kind: 'scatter' as const, height: PLOT_HEIGHT, xt, yt, left, right, bottom, px, y, marks, every };
}

/** Pie: a donut with its legend beside it, or under it when the card is narrow. */
function pie(spec: ChartSpec, width: number) {
    const rows = spec.rows ?? [], key = spec.series![0].key, value = (r: ChartRow) => num(r[key]) ? Math.max(0, r[key] as number) : 0;
    let slices = rows.map((r, i) => ({ label: String(r[spec.x!]), value: value(r), row: i as number | null })).filter(s => s.value > 0);
    if (slices.length > MAX_SLICES) {
        // Keep the largest slices in their own order and fold the rest into one.
        const keep = new Set([...slices].sort((a, b) => b.value - a.value).slice(0, MAX_SLICES - 1));
        const rest = slices.filter(s => !keep.has(s));
        slices = [...slices.filter(s => keep.has(s)), { label: `Other (${rest.length})`, value: rest.reduce((a, s) => a + s.value, 0), row: null }];
    }
    const total = slices.reduce((a, s) => a + s.value, 0), side = width >= 460, R = 100, r = 62, cx = side ? 130 : width / 2, cy = PLOT_HEIGHT / 2;
    let angle = -Math.PI / 2;
    const at = (a: number, rad: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const arcs = slices.map((s, i) => {
        const a0 = angle, a1 = angle + s.value / total * Math.PI * 2, mid = (a0 + a1) / 2, large = a1 - a0 > Math.PI ? 1 : 0;
        angle = a1;
        // A single full slice cannot be drawn as one arc, so it is two halves.
        const end = a1 - a0 >= Math.PI * 2 - 1e-6 ? a0 + Math.PI * 2 - 1e-4 : a1;
        const [x0, y0] = at(a0, R), [x1, y1] = at(end, R), [x2, y2] = at(end, r), [x3, y3] = at(a0, r);
        return { ...s, i, mid, d: `M${x0},${y0}A${R},${R} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${large} 0 ${x3},${y3}Z` };
    });
    const marks: Mark[] = arcs.filter(a => a.row !== null).map(a => { const [x, y] = at(a.mid, (R + r) / 2); return { row: a.row!, series: key, x, y }; });
    const legendX = side ? cx + R + 36 : 16, legendY = side ? cy - slices.length * LEGEND_ROW / 2 : PLOT_HEIGHT;
    const height = side ? PLOT_HEIGHT : PLOT_HEIGHT + slices.length * LEGEND_ROW + 8;
    return { kind: 'pie' as const, height, arcs, total, cx, cy, marks, legendX, legendY, legendWidth: Math.min(320, width - legendX - RIGHT) };
}

type Layout = ReturnType<typeof cartesian> | ReturnType<typeof scatter> | ReturnType<typeof pie>;
const layoutOf = (spec: ChartSpec, width: number): Layout => spec.type === 'pie' ? pie(spec, width) : spec.type === 'scatter' ? scatter(spec, width) : cartesian(spec, width);
const nearest = (marks: Mark[], p: Point, within = 40) => marks.reduce<{ m: Mark; d: number } | null>((best, m) => { const d = Math.hypot(m.x - p.x, m.y - p.y); return d < within && (!best || d < best.d) ? { m, d } : best; }, null)?.m ?? null;
const fit = (text: string, px: number) => text.length * 6.5 <= px ? text : `${text.slice(0, Math.max(1, Math.floor(px / 6.5) - 1))}…`;

/** Strokes, pins and the capture layer for the Pin and Draw tools, drawn over any chart. */
function Annotations({ width, height, marks, locate, tool, strokes, pins, onPin, onStroke }: {
    width: number; height: number; marks: Mark[]; locate: (a: ChartAnchor) => Mark | null; tool: ChartTool; strokes: Stroke[]; pins: ChartPin[];
    onPin: (m: Mark) => void; onStroke: (points: Point[]) => void;
}) {
    const [preview, setPreview] = useState<Mark | null>(null), [live, setLive] = useState<Point[] | null>(null), drawing = useRef<Point[] | null>(null);
    const local = (e: React.PointerEvent<SVGRectElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * width, y: (e.clientY - r.top) / r.height * height }; };
    const line = (pts: Point[], key: string) => pts.length === 1 ? <circle key={key} cx={pts[0].x} cy={pts[0].y} r={1.5} fill={INK}/> : <polyline key={key} points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/>;
    return <g>
      {strokes.map(s => line(s.points.map(p => ({ x: p.x * width, y: p.y * height })), s.id))}
      {live && line(live, 'live')}
      {pins.map(p => { const m = locate(p.anchor); return m && <g key={p.id}><circle cx={m.x} cy={m.y - 14} r={9} fill={INK}/><path d={`M${m.x - 4},${m.y - 7}L${m.x},${m.y - 1}L${m.x + 4},${m.y - 7}Z`} fill={INK}/><text x={m.x} y={m.y - 14} fontSize={11} fontWeight={600} textAnchor="middle" dominantBaseline="central" fill="white">{p.n}</text></g>; })}
      {tool === 'pin' && preview && <circle cx={preview.x} cy={preview.y} r={7} fill="none" stroke={INK} strokeWidth={2}/>}
      {tool !== 'none' && <rect x={0} y={0} width={width} height={height} fill="transparent" className={tool === 'draw' ? 'cursor-crosshair' : preview ? 'cursor-pointer' : 'cursor-default'}
        onPointerMove={e => { const p = local(e); if (tool === 'pin') setPreview(nearest(marks, p)); else if (drawing.current) { drawing.current = [...drawing.current, p]; setLive(drawing.current); } }}
        onPointerLeave={() => setPreview(null)}
        onPointerDown={e => { e.stopPropagation(); e.preventDefault(); const p = local(e); if (tool === 'pin') { const m = nearest(marks, p); if (m) onPin(m); } else { drawing.current = [p]; setLive(drawing.current); e.currentTarget.setPointerCapture(e.pointerId); } }}
        onPointerUp={() => { if (drawing.current) { onStroke(drawing.current.map(p => ({ x: Math.max(0, Math.min(1, p.x / width)), y: Math.max(0, Math.min(1, p.y / height)) }))); drawing.current = null; setLive(null); } }}/>}
    </g>;
}

function Tooltip({ left, width, children }: { left: number; width: number; children: React.ReactNode }) {
    const flip = left > width / 2;
    return <div className="pointer-events-none absolute top-3 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-md tabular-nums" style={flip ? { right: width - left + 12 } : { left: left + 12 }}>{children}</div>;
}
const Swatch = ({ i }: { i: number }) => <span className="size-2 shrink-0 rounded-full" style={{ background: color(i) }}/>;

function Plot({ spec, layout, width, title, overlay }: { spec: ChartSpec; layout: Layout; width: number; title: string; overlay: React.ReactNode }) {
    const [hover, setHover] = useState<number | null>(null);
    const rows = spec.rows ?? [], series = spec.series ?? [], unit = spec.unit, n = rows.length;
    const svg = (body: React.ReactNode, label: string) => <svg data-plot width={width} height={layout.height} viewBox={`0 0 ${width} ${layout.height}`} className="block h-auto w-full text-[11px]" role="img" aria-label={`${title}: ${label}. Open Data for the values.`}>{body}{overlay}</svg>;
    const named = series.map(s => s.label ?? s.key).join(', ');

    if (layout.kind === 'pie') {
        const shown = hover === null ? null : layout.arcs[hover], key = series[0].key;
        return <div className="relative">{svg(<>
          {layout.arcs.map(a => <path key={a.i} d={a.d} fill={a.row === null ? 'var(--muted-foreground)' : color(a.i)} className="stroke-card" strokeWidth={2} opacity={hover === null || hover === a.i ? 1 : .45} onPointerEnter={() => setHover(a.i)} onPointerLeave={() => setHover(null)}/>)}
          <text x={layout.cx} y={layout.cy - 8} textAnchor="middle" className="fill-muted-foreground">{shown ? fit(shown.label, 110) : 'Total'}</text>
          <text x={layout.cx} y={layout.cy + 12} textAnchor="middle" className="fill-foreground text-[15px] font-semibold tabular-nums">{formatValue(shown ? shown.value : layout.total, unit)}</text>
          {layout.arcs.map((a, i) => <g key={a.i} transform={`translate(${layout.legendX},${layout.legendY + i * LEGEND_ROW})`} opacity={hover === null || hover === a.i ? 1 : .6} onPointerEnter={() => setHover(a.i)} onPointerLeave={() => setHover(null)}>
            <rect y={LEGEND_ROW / 2 - 5} width={10} height={10} rx={2} fill={a.row === null ? 'var(--muted-foreground)' : color(a.i)}/>
            <text x={18} y={LEGEND_ROW / 2 + 4} className="fill-foreground">{fit(a.label, layout.legendWidth - 120)}</text>
            <text x={layout.legendWidth} y={LEGEND_ROW / 2 + 4} textAnchor="end" className="fill-muted-foreground tabular-nums">{formatValue(a.value, unit)} · {Math.round(a.value / layout.total * 100)}%</text>
          </g>)}
        </>, `pie chart of ${seriesLabel(spec, key)} by ${spec.xLabel ?? spec.x}`)}</div>;
    }

    if (layout.kind === 'scatter') {
        const { xt, yt, left, right, bottom, px, y, marks, every } = layout, m = hover === null ? null : marks[hover];
        const move = (e: React.PointerEvent<SVGRectElement>) => {
            const r = e.currentTarget.getBoundingClientRect(), p = { x: left + (e.clientX - r.left) / r.width * (right - left), y: TOP + (e.clientY - r.top) / r.height * (bottom - TOP) };
            const near = nearest(marks, p, 24);
            setHover(near ? marks.indexOf(near) : null);
        };
        return <div className="relative">{svg(<>
          {yt.map(t => <g key={t}><line x1={left} x2={right} y1={y(t)} y2={y(t)} className="stroke-border"/><text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground">{formatValue(t, unit, true)}</text></g>)}
          {xt.map((t, i) => <g key={t}><line x1={px(t)} x2={px(t)} y1={TOP} y2={bottom} className="stroke-border" opacity={.6}/>{i % every === 0 && <text x={px(t)} y={PLOT_HEIGHT - 8} textAnchor={i === 0 ? 'start' : 'middle'} className="fill-muted-foreground">{formatValue(t, '', true)}</text>}</g>)}
          {marks.map((mk, i) => <circle key={i} cx={mk.x} cy={mk.y} r={hover === i ? 6 : 4.5} fill={color(series.findIndex(s => s.key === mk.series))} fillOpacity={hover === null || hover === i ? .85 : .5} className="stroke-card" strokeWidth={1}/>)}
          <rect x={left} y={TOP} width={right - left} height={bottom - TOP} fill="transparent" onPointerMove={move} onPointerLeave={() => setHover(null)}/>
        </>, `scatter chart of ${named} against ${spec.xLabel ?? spec.x}`)}
          {m && <Tooltip left={m.x} width={width}>
            <div className="text-muted-foreground">{spec.xLabel ?? spec.x}: {formatValue(rows[m.row][spec.x!] as number)}</div>
            <div className="flex items-center gap-2"><Swatch i={series.findIndex(s => s.key === m.series)}/>{seriesLabel(spec, m.series)}<b className="ml-auto pl-4 font-semibold">{formatValue(rows[m.row][m.series] as number, unit)}</b></div>
          </Tooltip>}
        </div>;
    }

    const { ticks, left, right, bottom, band, cx, y, labels, every, bars, isBar, stacked } = layout;
    const at = (e: React.PointerEvent<SVGRectElement>) => {
        const r = e.currentTarget.getBoundingClientRect(), px = left + (e.clientX - r.left) / r.width * (right - left);
        setHover(Math.max(0, Math.min(n - 1, isBar ? Math.floor((px - left) / band) : Math.round((px - left) / band))));
    };
    return <div className="relative">{svg(<>
        {ticks.map(t => <g key={t}><line x1={left} x2={right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-muted-foreground/50' : 'stroke-border'}/><text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground">{formatValue(t, unit, true)}</text></g>)}
        {labels.map((l, i) => i % every === 0 && <text key={i} x={cx(i)} y={PLOT_HEIGHT - 8} textAnchor={!isBar && i === 0 ? 'start' : 'middle'} className="fill-muted-foreground">{l}</text>)}
        {hover !== null && (isBar
          ? <rect x={left + band * hover} y={TOP} width={band} height={bottom - TOP} className="fill-muted-foreground/10"/>
          : <line x1={cx(hover)} x2={cx(hover)} y1={TOP} y2={bottom} className="stroke-muted-foreground/60"/>)}
        {isBar
          ? bars.map(b => <path key={b.key} d={b.d} fill={color(b.si)} className={stacked ? 'stroke-card' : undefined} strokeWidth={stacked ? 1 : undefined}/>)
          : series.map((s, si) => <g key={s.key}>
              {/* Gaps in the data break the line rather than being drawn through. */}
              <path fill="none" stroke={color(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" d={rows.map((r, i) => { const v = r[s.key]; return num(v) ? `${i > 0 && num(rows[i - 1][s.key]) ? 'L' : 'M'}${cx(i)},${y(v)}` : ''; }).join('')}/>
              {rows.map((r, i) => { const v = r[s.key]; return num(v) && (hover === i || n === 1 || !num(rows[i - 1]?.[s.key]) && !num(rows[i + 1]?.[s.key])) && <circle key={i} cx={cx(i)} cy={y(v)} r={4} fill={color(si)} className="stroke-card" strokeWidth={2}/>; })}
            </g>)}
        <rect x={left} y={TOP} width={right - left} height={bottom - TOP} fill="transparent" onPointerMove={at} onPointerLeave={() => setHover(null)}/>
      </>, `${stacked ? 'stacked ' : ''}${spec.type} chart of ${named} by ${spec.xLabel ?? spec.x}`)}
      {hover !== null && <Tooltip left={cx(hover)} width={width}>
        <div className="text-muted-foreground">{labels[hover]}</div>
        {series.map((s, si) => { const v = rows[hover][s.key]; return <div key={s.key} className="flex items-center gap-2"><Swatch i={si}/>{s.label ?? s.key}<b className="ml-auto pl-4 font-semibold">{num(v) ? formatValue(v, unit) : '–'}</b></div>; })}
        {stacked && <div className="mt-0.5 flex border-t pt-0.5">Total<b className="ml-auto pl-4 font-semibold">{formatValue(series.reduce((a, s) => a + (num(rows[hover][s.key]) ? rows[hover][s.key] as number : 0), 0), unit)}</b></div>}
      </Tooltip>}
    </div>;
}

/** A table cell that edits in place and commits on Enter or blur; Escape puts the value back. */
function Cell({ value, numeric, label, onCommit }: { value: ChartRow[string]; numeric: boolean; label: string; onCommit: (text: string) => boolean }) {
    const shown = value === null || value === undefined ? '' : String(value), [text, setText] = useState<string | null>(null);
    const commit = () => { if (text !== null && text !== shown && !onCommit(text)) return; setText(null); };
    return <input value={text ?? shown} aria-label={label} inputMode={numeric ? 'decimal' : undefined} placeholder={numeric ? '–' : undefined}
      className={`w-full min-w-16 rounded-sm bg-transparent px-1 py-0.5 outline-none tabular-nums hover:bg-muted focus:bg-background focus:ring-1 focus:ring-ring ${numeric ? 'text-right' : ''}`}
      onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(null); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); } }}/>;
}

/** Turns typed text into a cell value; `undefined` when it is not a valid number for a numeric cell. */
function parseCell(text: string, numeric: boolean, was: ChartRow[string]): ChartRow[string] | undefined {
    const t = text.trim();
    if (!numeric)
        return typeof was === 'number' && t !== '' && Number.isFinite(Number(t)) ? Number(t) : t;
    if (t === '' || t === '–')
        return null;
    const n = Number(t.replace(/[,\s$%]/g, '').replace('−', '-'));
    return Number.isFinite(n) ? n : undefined;
}

function Table({ spec, onEdit }: { spec: ChartSpec; onEdit?: (next: ChartSpec) => string | null }) {
    const series = spec.series ?? [], rows = spec.rows ?? [], x = spec.x!, [error, setError] = useState<string | null>(null);
    const apply = (next: ChartRow[]) => { const problem = onEdit?.({ ...spec, rows: next }) ?? null; setError(problem); return !problem; };
    const set = (i: number, key: string, text: string, numeric: boolean) => {
        const v = parseCell(text, numeric, rows[i][key]);
        if (v === undefined) { setError(`"${text}" is not a number`); return false; }
        return apply(rows.map((r, j) => j === i ? { ...r, [key]: v } : r));
    };
    const addRow = () => {
        const taken = new Set(rows.map(r => String(r[x])));
        let label = 'New row';
        for (let k = 2; taken.has(label); k++) label = `New row ${k}`;
        apply([...rows, { [x]: spec.type === 'scatter' ? (rows.at(-1)?.[x] ?? 0) : label, ...Object.fromEntries(series.map(s => [s.key, null])) }]);
    };
    return <div className="border-t">
      <div data-scroll className="max-h-72 overflow-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead><tr className="text-muted-foreground"><th scope="col" className="sticky top-0 bg-card px-3 py-1.5 text-left font-medium">{spec.xLabel ?? x}</th>{series.map(s => <th scope="col" key={s.key} className="sticky top-0 bg-card px-3 py-1.5 text-right font-medium">{s.label ?? s.key}</th>)}{onEdit && <th className="sticky top-0 w-7 bg-card"><span className="sr-only">Remove</span></th>}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={i} className="group/row border-t">
            <th scope="row" className="px-2 py-0.5 text-left font-normal">{onEdit ? <Cell value={row[x]} numeric={spec.type === 'scatter'} label={`Row ${i + 1} ${spec.xLabel ?? x}`} onCommit={t => set(i, x, t, spec.type === 'scatter')}/> : String(row[x])}</th>
            {series.map(s => { const v = row[s.key]; return <td key={s.key} className="px-2 py-0.5 text-right">{onEdit ? <Cell value={v} numeric label={`${String(row[x])} ${s.label ?? s.key}`} onCommit={t => set(i, s.key, t, true)}/> : num(v) ? formatValue(v, spec.unit) : '–'}</td>; })}
            {onEdit && <td className="pr-1"><button type="button" aria-label={`Remove row ${String(row[x])}`} className="rounded p-0.5 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-muted focus-visible:opacity-100" onClick={() => apply(rows.filter((_, j) => j !== i))}><XIcon className="size-3"/></button></td>}
          </tr>)}</tbody>
        </table>
      </div>
      {onEdit && <div className="flex items-center gap-2 border-t px-2 py-1">
        <BoardButton size="xs" variant="ghost" onClick={addRow}><PlusIcon aria-hidden="true"/>Row</BoardButton>
        <span role="status" className="text-xs text-destructive">{error}</span>
      </div>}
    </div>;
}

/** A chart card: the agent supplies the data, this draws it. Users can pin points, draw over it and edit its rows. */
export function BoardChart({ spec, title, width, showData, tool = 'none', strokes = [], pins = [], onPin, onStroke, onEdit }: {
    spec: ChartSpec; title: string; width: number; showData: boolean; tool?: ChartTool; strokes?: Stroke[]; pins?: ChartPin[];
    onPin?: (anchor: ChartAnchor, quote: string) => void; onStroke?: (points: Point[]) => void; onEdit?: (next: ChartSpec) => void;
}) {
    const plotWidth = width - 2, layout = useMemo(() => spec.type === 'stat' ? null : layoutOf(spec, plotWidth), [spec, plotWidth]);
    if (spec.type === 'stat' || !layout)
        return <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }} role="group" aria-label={title}>
          {(spec.stats ?? []).map((s, i) => <div key={i} className="rounded-lg border bg-card px-3.5 py-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-0.5 text-2xl leading-tight font-semibold tracking-tight tabular-nums">{s.value}</div>
            {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
          </div>)}
        </div>;
    const series = spec.series ?? [], rows = spec.rows ?? [];
    const locate = (a: ChartAnchor) => { const row = anchorRow(spec, a); return row < 0 ? null : layout.marks.find(m => m.row === row && (!a.series || m.series === a.series)) ?? null; };
    const pin = (m: Mark) => {
        const xv = rows[m.row][spec.x!], v = rows[m.row][m.series];
        onPin?.({ x: xv as string | number, series: m.series, ...(spec.type === 'scatter' ? { row: m.row } : {}) }, `${spec.type === 'scatter' ? `${spec.xLabel ?? spec.x} ${formatValue(xv as number)}` : String(xv)} · ${seriesLabel(spec, m.series)}: ${num(v) ? formatValue(v, spec.unit) : '–'}`);
    };
    const edit = onEdit && ((next: ChartSpec) => { try {
        onEdit(parseChart(next));
        return null;
    }
    catch (e) {
        return e instanceof Error && 'issues' in e ? 'That value is not allowed here' : (e as Error).message;
    } });
    return <div className="overflow-hidden rounded-lg border bg-card text-card-foreground">
      <div className="px-3.5 pt-2.5 text-[13px] font-semibold">{title}</div>
      {spec.type !== 'pie' && (series.length > 1 || spec.type === 'scatter') && <div className="flex flex-wrap gap-x-3.5 px-3.5 pt-1 text-xs text-muted-foreground">
        {series.map((s, i) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className={spec.type === 'bar' ? 'size-2 rounded-xs' : spec.type === 'scatter' ? 'size-2 rounded-full' : 'h-0.5 w-2.5 rounded-full'} style={{ background: color(i) }}/>{s.label ?? s.key}</span>)}
        {spec.type === 'scatter' && <span className="ml-auto">x: {spec.xLabel ?? spec.x}</span>}
      </div>}
      <Plot spec={spec} layout={layout} width={plotWidth} title={title} overlay={<Annotations width={plotWidth} height={layout.height} marks={layout.marks} locate={locate} tool={tool} strokes={strokes} pins={pins} onPin={pin} onStroke={p => onStroke?.(p)}/>}/>
      {showData && <Table spec={spec} onEdit={edit}/>}
    </div>;
}
