/** Repo name from a GitHub URL or `owner/repo` shorthand. */
export function repoNameFromUrl(url: string) {
  const name = url.trim().replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop();
  if (!name) throw new Error(`Can't read a repo name from ${url}`);
  return name;
}
