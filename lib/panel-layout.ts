/**
 * Panel layouts (react-resizable-panels) are saved in cookies rather than localStorage, so the server can render the
 * same sizes the browser will and hydration matches. The library keys a layout "react-resizable-panels:<id>"; cookie
 * names can't hold ":", so it is replaced.
 */
export const panelCookieName = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, "_");
export const PANEL_COOKIE_PREFIX = panelCookieName("react-resizable-panels:");
/** A year: a layout is a preference, not a session. */
export const PANEL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The request's panel layout cookies, by name, for the server render. */
export const panelCookies = (all: { name: string; value: string }[]) =>
  Object.fromEntries(all.filter((c) => c.name.startsWith(PANEL_COOKIE_PREFIX)).map((c) => [c.name, c.value]));
