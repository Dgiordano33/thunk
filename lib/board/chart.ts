import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';

/** Most series a chart may carry: one per palette slot, so a hue is never reused. */
export const MAX_SERIES = 8;
/** Pie slices drawn individually; the rest are summed into "Other" so a hue is never reused. */
export const MAX_SLICES = 8;
const cell = z.union([z.string().max(200), z.number().finite(), z.null()]);
const key = z.string().min(1).max(80);
export const chartShape = {
    type: z.enum(['line', 'bar', 'pie', 'scatter', 'stat']),
    /** Row key holding each row's x value: a label (line, bar, pie) or a number (scatter). */
    x: key.optional(),
    /** Display name for x: the scatter x axis caption and the first column of the data table. */
    xLabel: z.string().max(80).optional(),
    /** Row keys plotted as numeric series, in a fixed order. A pie has exactly one. */
    series: z.array(z.object({ key, label: z.string().max(80).optional() })).max(MAX_SERIES).optional(),
    rows: z.array(z.record(key, cell)).max(500).optional(),
    /** Bar only: stack the series in one bar per row instead of side by side. */
    stacked: z.boolean().optional(),
    /** Headline numbers (stat). */
    stats: z.array(z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(40), detail: z.string().max(80).optional() })).max(8).optional(),
    /** Unit of the plotted values: "$" is prefixed, anything else is appended. */
    unit: z.string().max(12).optional(),
};
export type ChartSpec = z.infer<z.ZodObject<typeof chartShape>>;
export type ChartRow = NonNullable<ChartSpec['rows']>[number];
/** Where a pin on a chart sits: the row with this x value, in this series. Follows the row when the data changes. */
export type ChartAnchor = { x: string | number; series?: string; row?: number };

const isNum = (v: unknown): v is number => typeof v === 'number';

/** Validates a chart spec and drops the fields its type does not use; throws with a message the agent can act on. */
export function parseChart(input: unknown): ChartSpec {
    const spec = z.strictObject(chartShape).parse(input);
    if (spec.type === 'stat') {
        if (!spec.stats?.length)
            throw new Error('A stat chart needs at least one entry in stats');
        return { type: 'stat', stats: spec.stats };
    }
    const { type, x, series, rows } = spec;
    if (!x || !series?.length || !rows?.length)
        throw new Error(`A ${type} chart needs x, series and rows`);
    if (new Set(series.map(s => s.key)).size !== series.length || series.some(s => s.key === x))
        throw new Error('Series keys must be unique and differ from x');
    if (type === 'pie' && series.length !== 1)
        throw new Error('A pie chart has exactly one series: the size of each slice');
    for (const [i, row] of rows.entries()) {
        if (row[x] === undefined || row[x] === null || row[x] === '')
            throw new Error(`Row ${i} has no "${x}" value`);
        if (type === 'scatter' && !isNum(row[x]))
            throw new Error(`Row ${i} "${x}" must be a number: a scatter chart plots x as a number`);
        for (const s of series) {
            const v = row[s.key];
            if (v !== undefined && v !== null && !isNum(v))
                throw new Error(`Row ${i} "${s.key}" must be a number or null`);
            if (type === 'pie' && isNum(v) && v < 0)
                throw new Error(`Row ${i} "${s.key}" is negative; pie slices cannot be`);
        }
    }
    if (type !== 'scatter' && new Set(rows.map(r => r[x])).size !== rows.length)
        throw new Error(`Each row needs a different "${x}" value`);
    for (const s of series)
        if (!rows.some(r => isNum(r[s.key])))
            throw new Error(`Series "${s.key}" has no numeric values`);
    if (type === 'pie' && !rows.some(r => isNum(r[series[0].key]) && r[series[0].key] as number > 0))
        throw new Error('A pie chart needs at least one slice above zero');
    return { type, x, ...(spec.xLabel ? { xLabel: spec.xLabel } : {}), series, rows, ...(type === 'bar' && spec.stacked && series.length > 1 ? { stacked: true } : {}), ...(spec.unit ? { unit: spec.unit } : {}) };
}

/**
 * Applies what a chart's source command printed: a JSON array of rows (of stats, for a stat chart), or an object
 * carrying `rows`, `stats` or `series`. Log lines before the JSON are tolerated when the JSON is on the last line.
 */
export function applyRefresh(spec: ChartSpec, stdout: string): ChartSpec {
    const text = stdout.trim();
    let data: unknown;
    try {
        data = JSON.parse(text);
    }
    catch {
        try {
            data = JSON.parse(text.split('\n').at(-1) ?? '');
        }
        catch {
            throw new Error('The source command did not print JSON');
        }
    }
    const update = Array.isArray(data) ? { [spec.type === 'stat' ? 'stats' : 'rows']: data } : data && typeof data === 'object' ? Object.fromEntries(Object.entries(data).filter(([k]) => ['rows', 'stats', 'series'].includes(k))) : null;
    if (!update || !Object.keys(update).length)
        throw new Error('The source command printed JSON without rows or stats');
    return parseChart({ ...spec, ...update });
}

/** The chart as diffable lines, one per row, so a hand edit reads as a small patch. */
const chartLines = (s: ChartSpec) => [`type: ${s.type}${s.stacked ? ' (stacked)' : ''}`, ...(s.type === 'stat' ? (s.stats ?? []).map(t => JSON.stringify(t)) : [`series: ${JSON.stringify(s.series)}`, ...(s.rows ?? []).map(r => JSON.stringify(r))])].join('\n') + '\n';
export const chartDiff = (before: ChartSpec, after: ChartSpec) => createTwoFilesPatch('before', 'after', chartLines(before), chartLines(after));

/** Finds the row a pin points at. */
export function anchorRow(spec: ChartSpec, a: ChartAnchor) {
    const rows = spec.rows ?? [];
    // Scatter x values can repeat, so a scatter pin also remembers its row.
    return a.row !== undefined && rows[a.row]?.[spec.x!] === a.x ? a.row : rows.findIndex(r => r[spec.x!] === a.x);
}

/** Evenly spaced round axis values covering lo..hi; `zero` stretches the range to include zero. */
export function niceTicks(lo: number, hi: number, count = 4, zero = true) {
    if (zero) {
        lo = Math.min(0, lo);
        hi = Math.max(0, hi);
    }
    if (hi === lo) {
        lo = zero ? lo : lo - 1;
        hi = lo + (zero ? 1 : 2);
    }
    const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const ticks: number[] = [];
    for (let v = Math.floor(lo / step) * step; v < hi + step - step * 1e-9; v += step)
        ticks.push(Math.round(v / step) * step);
    return ticks;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
/** A value with its unit; `short` abbreviates thousands for axis labels. */
export function formatValue(v: number, unit = '', short = false) {
    const n = (short ? compact : full).format(Math.abs(v)), sign = v < 0 ? '−' : '';
    return unit === '$' ? `${sign}$${n}` : `${sign}${n}${unit && !/^[%°]/.test(unit) ? ' ' : ''}${unit}`;
}

/** Approximate rendered height of a chart card, so stacked cards start near their final spot. */
export const chartHeight = (spec: ChartSpec, width: number) => spec.type === 'stat' ? Math.ceil((spec.stats?.length ?? 1) / Math.max(1, Math.floor(width / 170))) * 98 : spec.type === 'pie' && width < 460 ? 460 : 320;
