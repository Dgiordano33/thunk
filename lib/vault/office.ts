import { inflateRawSync } from "node:zlib";

// Just enough of a zip reader to pull text out of .docx / .pptx / .xlsx without a dependency.

type Entry = { name: string; method: number; compressedSize: number; offset: number };

function entries(buf: Buffer): Entry[] {
  // End of central directory: scan back over the (max 64KB) trailing comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString("utf8", p + 46, p + 46 + nameLen), method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf: Buffer, e: Entry): Buffer {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("Corrupt zip entry");
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 });
  throw new Error(`Unsupported zip compression method ${e.method}`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** OOXML → plain text: paragraph/row ends become newlines, tabs stay tabs, tags go. */
export function xmlToText(xml: string) {
  return xml
    .replace(/<w:tab\/>|<a:tab\/>/g, "\t")
    .replace(/<w:br\/>|<a:br\/>|<\/w:p>|<\/a:p>|<\/row>|<\/si>/g, "\n")
    .replace(/<\/c>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) =>
      code[0] === "#" ? String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)) : (ENTITIES[code] ?? m),
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const num = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);

/** Text of a .docx, .pptx or .xlsx, with slide/sheet headers so the model keeps the structure. */
export function officeText(buf: Buffer, ext: string): string {
  const all = entries(buf);
  const pick = (re: RegExp) => all.filter((e) => re.test(e.name)).sort((a, b) => num(a.name) - num(b.name));
  const text = (e: Entry) => xmlToText(read(buf, e).toString("utf8"));
  if (ext === "docx") {
    return pick(/^word\/(document|footnotes|endnotes)\.xml$/).map(text).filter(Boolean).join("\n\n");
  }
  if (ext === "pptx") {
    const slides = pick(/^ppt\/slides\/slide\d+\.xml$/).map((e, i) => `## Slide ${i + 1}\n\n${text(e)}`);
    const notes = pick(/^ppt\/notesSlides\/notesSlide\d+\.xml$/).map((e) => text(e)).filter(Boolean);
    return [...slides, ...(notes.length ? [`## Speaker notes\n\n${notes.join("\n\n")}`] : [])].join("\n\n");
  }
  if (ext === "xlsx") {
    // Cells with t="s" hold an index into sharedStrings; swap the text in before stripping tags.
    const shared = pick(/^xl\/sharedStrings\.xml$/).flatMap((e) =>
      [...read(buf, e).toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlToText(m[1]).replace(/\s+/g, " ")),
    );
    const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return pick(/^xl\/worksheets\/sheet\d+\.xml$/)
      .map((e, i) => {
        const xml = read(buf, e).toString("utf8").replace(/<c\b([^>]*\bt="s"[^>]*)>\s*<v>(\d+)<\/v>/g, (_m, attrs: string, n: string) => `<c${attrs}>${escape(shared[Number(n)] ?? "")}`);
        return `## Sheet ${i + 1}\n\n${xmlToText(xml)}`;
      })
      .join("\n\n");
  }
  throw new Error(`Unsupported office format .${ext}`);
}
