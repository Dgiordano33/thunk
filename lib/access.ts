/**
 * Who may reach Thunk. The server can spawn agents with arbitrary cwd and permission modes,
 * so by default only loopback requests are served.
 *
 * Remote access goes through Tailscale Serve: Thunk still listens on 127.0.0.1, Serve terminates
 * HTTPS on the tailnet name and proxies to it, adding `Tailscale-User-Login` for the signed-in
 * tailnet user. Serve overwrites any client-supplied copy of that header, so it can be trusted
 * while Thunk is reachable only through loopback.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export const TAILSCALE_USER_HEADER = "tailscale-user-login";

export type AccessConfig = {
  /** Lower-cased hostnames (no port) allowed besides loopback, e.g. `mac.tail1234.ts.net`. */
  trustedHosts: string[];
  /** Tailscale login that remote requests must carry. Remote access stays off without it. */
  trustedUser?: string;
};

export type AccessRequest = {
  host: string | null;
  origin: string | null;
  tailscaleUser: string | null;
};

export function parseTrustedHosts(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => hostname(entry.includes("://") ? entry : `http://${entry}`))
    .filter((entry): entry is string => Boolean(entry));
}

export function accessConfigFromEnv(env: Record<string, string | undefined>): AccessConfig {
  const trustedUser = env.THUNK_TRUSTED_USER?.trim().toLowerCase();
  return { trustedHosts: parseTrustedHosts(env.THUNK_TRUSTED_HOSTS), trustedUser: trustedUser || undefined };
}

function hostname(urlish: string): string | null {
  try {
    return new URL(urlish).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Returns null when the request may proceed, otherwise a short reason. */
export function denyReason(req: AccessRequest, config: AccessConfig): string | null {
  const host = req.host ? hostname(`http://${req.host}`) : null;
  if (!host) return "missing or invalid Host";

  const remote = !LOOPBACK.has(host);
  // Remote needs both a listed host and a user; either alone keeps Thunk loopback-only.
  const remoteEnabled = config.trustedHosts.length > 0 && Boolean(config.trustedUser);
  if (remote && !(remoteEnabled && config.trustedHosts.includes(host))) return "host not allowed";

  if (req.origin) {
    const origin = hostname(req.origin);
    // Cross-site and DNS-rebinding requests: the Origin must be one of our own names.
    if (!origin || !(LOOPBACK.has(origin) || (remoteEnabled && config.trustedHosts.includes(origin)))) {
      return "origin not allowed";
    }
  }

  // A remote request must carry the trusted login. A loopback request that carries the header came
  // through Serve too (in case Serve rewrites Host), so it gets the same check.
  const user = req.tailscaleUser?.trim().toLowerCase();
  if (remote && !user) return "missing Tailscale identity";
  if (user && user !== config.trustedUser) return "Tailscale user not allowed";
  return null;
}
