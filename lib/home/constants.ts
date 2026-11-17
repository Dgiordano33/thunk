// Shared between server and client. Keep free of server-only imports.

/**
 * The Home project is glue, not a place: it holds top-level notes, the top chief and its routing
 * memory, and is left out of every project list, map and picker.
 */
export const HOME_DATA_KEY = "__home";
export const HOME_SLUG = "__home";
export const HOME_NAME = "Top level";

export const isHomeProject = (p: { dataKey?: string; slug?: string } | null | undefined) => p?.dataKey === HOME_DATA_KEY;
