export function fuzzyMatch(value: string, query: string) {
  let index = 0;
  const target = value.toLowerCase();
  for (const char of query.toLowerCase()) {
    index = target.indexOf(char, index);
    if (index < 0) return false;
    index++;
  }
  return true;
}

export function completionAt(text: string, cursor: number) {
  const match = text.slice(0, cursor).match(/(?:^|\s)(@[^\s]*|\/[^\s]*)$/);
  if (!match || (match[1][0] === "/" && text.slice(0, cursor).trimStart() !== match[1])) return null;
  return { start: cursor - match[1].length, end: cursor, kind: match[1][0], query: match[1].slice(1) };
}
