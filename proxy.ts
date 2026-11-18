import { NextResponse, type NextRequest } from "next/server";
import { accessConfigFromEnv, denyReason, TAILSCALE_USER_HEADER } from "./lib/access";

const access = accessConfigFromEnv(process.env);

/**
 * Every route (pages and API) is guarded: loopback only, plus the Tailscale names and user in
 * THUNK_TRUSTED_HOSTS / THUNK_TRUSTED_USER. See lib/access.ts and docs/remote.md.
 */
export function proxy(req: NextRequest) {
  const request = {
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    tailscaleUser: req.headers.get(TAILSCALE_USER_HEADER),
  };
  const reason = denyReason(request, access);
  if (!reason) return NextResponse.next();
  console.warn(`[access] denied ${req.method} ${req.nextUrl.pathname}: ${reason} (host=${request.host ?? "-"}, origin=${request.origin ?? "-"})`);
  const message = access.trustedHosts.length ? "Forbidden" : "Forbidden: local access only";
  return req.nextUrl.pathname.startsWith("/api/")
    ? NextResponse.json({ error: message }, { status: 403 })
    : new NextResponse(message, { status: 403, headers: { "content-type": "text/plain" } });
}

export const config = {
  // Build output under _next/static is public code; everything else, including pages, is checked.
  matcher: "/((?!_next/static|_next/image).*)",
};
