/**
 * What a typed link becomes: a web or mail address kept as is, a relative one (/path, #anchor) kept, a bare
 * domain given https://, and anything else with a scheme (javascript:, data:, file:) refused.
 */
export type LinkInput = { href: string } | { remove: true } | { error: string };

export function normalizeLink(input: string): LinkInput {
  const text = input.trim();
  if (!text) return { remove: true };
  if (/^(https?:\/\/|mailto:)/i.test(text)) return { href: text };
  if (/^[/#]/.test(text)) return { href: text };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^:/]+:\d+(\/|$)/.test(text)) return { error: "Use a web or email address." };
  if (/\s/.test(text)) return { error: "A link can’t contain spaces." };
  return { href: `https://${text}` };
}
