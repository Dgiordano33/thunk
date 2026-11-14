import type { Card } from './types';
export async function flattenImage(card: Card, url: string): Promise<Blob> {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1568 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Image rendering unavailable');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#e44848';
    ctx.lineWidth = 3;
    for (const s of card.strokes) {
        ctx.beginPath();
        s.points.forEach((p, i) => { if (i)
            ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
        else
            ctx.moveTo(p.x * canvas.width, p.y * canvas.height); });
        ctx.stroke();
    }
    card.comments.filter(t => t.x !== undefined).forEach((t, i) => { const x = t.x! * canvas.width, y = t.y! * canvas.height; ctx.fillStyle = '#e44848'; ctx.beginPath(); ctx.arc(x, y, 12, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = 'white'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y); });
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not flatten image')), 'image/png'));
}
/** Renders a freehand drawing card as dark strokes on white for the agent. */
export async function flattenDrawing(card: Card): Promise<Blob> {
    const scale = Math.min(2, 1568 / Math.max(card.width, card.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(card.width * scale));
    canvas.height = Math.max(1, Math.round(card.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Drawing rendering unavailable');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1f1f1f';
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of card.strokes) {
        ctx.beginPath();
        s.points.forEach((p, i) => i ? ctx.lineTo(p.x * canvas.width, p.y * canvas.height) : ctx.moveTo(p.x * canvas.width, p.y * canvas.height));
        if (s.points.length === 1)
            ctx.lineTo(s.points[0].x * canvas.width + .1, s.points[0].y * canvas.height);
        ctx.stroke();
    }
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not flatten drawing')), 'image/png'));
}
const PAINT = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline'];
/**
 * Renders a chart card as the user sees it, with their ink and pins, for the agent. The chart is styled by
 * classes and CSS variables, so each element's computed paint is inlined before the svg leaves the page.
 */
export async function flattenChart(card: Card): Promise<Blob> {
    const svg = document.querySelector<SVGSVGElement>(`[data-id="${CSS.escape(card.id)}"] svg[data-plot]`);
    if (!svg)
        throw new Error('Could not find the chart to render; reload and send again');
    const clone = svg.cloneNode(true) as SVGSVGElement, from = [svg, ...svg.querySelectorAll('*')], to = [clone, ...clone.querySelectorAll('*')];
    from.forEach((el, i) => { const css = getComputedStyle(el), target = to[i] as SVGElement; target.removeAttribute('class'); target.setAttribute('style', PAINT.map(p => `${p}:${css.getPropertyValue(p)}`).join(';')); });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const width = svg.viewBox.baseVal.width, height = svg.viewBox.baseVal.height, scale = Math.min(2, 1568 / Math.max(width, height));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('Chart rendering unavailable');
        ctx.fillStyle = getComputedStyle(svg.closest('.bg-card') ?? document.body).backgroundColor || 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not flatten chart')), 'image/png'));
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
