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
