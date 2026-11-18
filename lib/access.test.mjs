import assert from "node:assert/strict";
import test from "node:test";
import { accessConfigFromEnv, denyReason, parseTrustedHosts } from "./access.ts";

const TAILNET = "mac.tail1234.ts.net";
const USER = "dan@example.com";
const remote = accessConfigFromEnv({ THUNK_TRUSTED_HOSTS: ` ${TAILNET.toUpperCase()} , other.ts.net`, THUNK_TRUSTED_USER: ` ${USER} ` });
const local = accessConfigFromEnv({});
const req = (host, origin = null, tailscaleUser = null) => ({ host, origin, tailscaleUser });

test("parses trusted hosts, dropping ports, schemes and blanks", () => {
  assert.deepEqual(parseTrustedHosts("a.ts.net, https://B.ts.net:443/,,c.ts.net:8443"), ["a.ts.net", "b.ts.net", "c.ts.net"]);
  assert.deepEqual(parseTrustedHosts(undefined), []);
  assert.deepEqual(remote, { trustedHosts: [TAILNET, "other.ts.net"], trustedUser: USER });
});

test("default config serves loopback only", () => {
  for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) assert.equal(denyReason(req(host), local), null);
  assert.equal(denyReason(req("127.0.0.1:3000", "http://localhost:3000"), local), null);
  assert.equal(denyReason(req(TAILNET), local), "host not allowed");
  assert.equal(denyReason(req("192.168.1.5:3000"), local), "host not allowed");
  assert.equal(denyReason(req(null), local), "missing or invalid Host");
});

test("trusted host with the trusted Tailscale user is allowed", () => {
  assert.equal(denyReason(req(TAILNET, `https://${TAILNET}`, USER), remote), null);
  assert.equal(denyReason(req(TAILNET, null, "DAN@example.com"), remote), null);
  assert.equal(denyReason(req(`${TAILNET}:443`, null, USER), remote), null);
});

test("trusted host without the right user is denied", () => {
  assert.equal(denyReason(req(TAILNET, `https://${TAILNET}`), remote), "missing Tailscale identity");
  assert.equal(denyReason(req(TAILNET, `https://${TAILNET}`, "someone@else.com"), remote), "Tailscale user not allowed");
});

test("foreign origins are denied on loopback and trusted hosts", () => {
  assert.equal(denyReason(req(TAILNET, "https://evil.example", USER), remote), "origin not allowed");
  assert.equal(denyReason(req("127.0.0.1:3000", "https://example.com"), remote), "origin not allowed");
  assert.equal(denyReason(req("127.0.0.1:3000", "null"), remote), "origin not allowed");
  assert.equal(denyReason(req("127.0.0.1:3000", `https://${TAILNET}`), local), "origin not allowed");
});

test("DNS rebinding: an attacker hostname resolving to loopback is denied", () => {
  assert.equal(denyReason(req("rebind.evil.example:3000", "http://rebind.evil.example:3000"), remote), "host not allowed");
  assert.equal(denyReason(req("mac.tail1234.ts.net.evil.example", null, USER), remote), "host not allowed");
});

test("remote access needs both settings", () => {
  const hostsOnly = accessConfigFromEnv({ THUNK_TRUSTED_HOSTS: TAILNET });
  assert.equal(denyReason(req(TAILNET, null, USER), hostsOnly), "host not allowed");
  const userOnly = accessConfigFromEnv({ THUNK_TRUSTED_USER: USER });
  assert.equal(denyReason(req(TAILNET, null, USER), userOnly), "host not allowed");
});

test("a loopback request carrying a Tailscale identity still needs the trusted user", () => {
  // Covers Serve forwarding with Host rewritten to the backend address.
  assert.equal(denyReason(req("127.0.0.1:3000", null, "someone@else.com"), remote), "Tailscale user not allowed");
  assert.equal(denyReason(req("127.0.0.1:3000", null, USER), remote), null);
  assert.equal(denyReason(req("127.0.0.1:3000", null, USER), local), "Tailscale user not allowed");
});
