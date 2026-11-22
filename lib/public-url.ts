import "server-only";
import { parseTrustedHosts } from "@/lib/access";

/** Where links sent outside Thunk (Slack) point: THUNK_PUBLIC_URL, else the first trusted host, else this machine. */
export function publicUrl() {
  const configured = process.env.THUNK_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = parseTrustedHosts(process.env.THUNK_TRUSTED_HOSTS)[0];
  if (host) return `https://${host}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}
