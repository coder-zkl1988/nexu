import { randomUUID } from "node:crypto";

/**
 * The session-key shape the runtime guard treats as "the person is at the
 * desktop app": `agent:<botId>:main` or `agent:<botId>:<uuid>`.
 *
 * This pattern is duplicated — not imported — inside
 * `static/runtime-plugins/nexu-toolcall-guard/index.js`, because that plugin is
 * materialized standalone into the OpenClaw extensions directory and cannot
 * import from this package. `tests/desktop-session-key-parity.test.ts` drives
 * the plugin's real hook to keep the two from drifting.
 */
const DESKTOP_SESSION_KEY_PATTERN =
  /^agent:[^:]+:(?:main|[0-9a-f]{8}-[0-9a-f-]{27})$/i;

export function isDesktopSessionKey(sessionKey: string): boolean {
  return DESKTOP_SESSION_KEY_PATTERN.test(sessionKey);
}

/**
 * Mint the key for a session derived from `parentSessionKey` (fork, branch).
 *
 * A derived session must never be more trusted than the one it came from.
 * Minting `agent:<bot>:<uuid>` unconditionally let a channel conversation be
 * forked into desktop shape, which is how a remote sender could reach the
 * desktop-only browser control and runtime control-plane tools.
 */
export function mintDerivedSessionKey(
  botId: string,
  parentSessionKey: string,
  kind: "fork" | "branch",
): string {
  const suffix = randomUUID();
  return isDesktopSessionKey(parentSessionKey)
    ? `agent:${botId}:${suffix}`
    : `agent:${botId}:${kind}:${suffix}`;
}
