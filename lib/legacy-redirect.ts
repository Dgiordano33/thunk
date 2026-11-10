import "server-only";

type Query = Record<string, string | string[] | undefined>;

/** `?a=1&b=2` from Next's searchParams, or "" when empty: legacy URLs keep their query when they redirect. */
export function queryString(query: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}
