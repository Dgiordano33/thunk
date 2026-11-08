export type Theme = "light" | "dark" | "system";

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("thunk.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Storage is optional. */ }
  return "system";
}

export function applyTheme(theme: Theme, systemDark: boolean) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && systemDark));
}

// Run before paint so a saved dark preference never flashes a light page.
export const themeScript = `(() => {
  let theme;
  try { theme = localStorage.getItem("thunk.theme"); } catch {}
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches));
})();`;
