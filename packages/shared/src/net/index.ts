const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

type HeaderValue = string | string[] | undefined;

/**
 * How strictly a browser `Origin` must relate to the request's own authority.
 *
 * - `same-origin` fits a server that hands the renderer and the API the same
 *   loopback origin (the packaged desktop embedded web server). Any other
 *   origin — including a different loopback port — is rejected.
 * - `any-loopback` fits a server reached directly from a separate loopback
 *   origin (the controller port, which the Vite dev server calls cross-port).
 */
export type LoopbackOriginPolicy = "same-origin" | "any-loopback";

export interface LocalRequestMetadata {
  requestUrl?: string;
  host?: HeaderValue;
  origin?: HeaderValue;
  secFetchSite?: HeaderValue;
}

function readSingleHeader(value: HeaderValue): string | undefined {
  // A repeated header is ambiguous and smells like request smuggling, so treat
  // it as absent and let the caller's "present but unreadable" check reject it.
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] : undefined;
  }
  return value;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function parseAuthorityHostname(authority: string): string | null {
  if (!authority || authority !== authority.trim()) return null;

  try {
    const parsed = new URL(`http://${authority}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Decides whether a request may reach an unauthenticated loopback control
 * plane. Rejects non-loopback `Host` values (DNS rebinding), cross-site
 * fetches, and browser origins outside the configured policy.
 *
 * Single source of truth for the controller HTTP/WS guard and the desktop
 * embedded web server; they differ only by `policy`.
 */
export function isTrustedLocalRequest(
  metadata: LocalRequestMetadata,
  policy: LoopbackOriginPolicy = "any-loopback",
): boolean {
  const host = readSingleHeader(metadata.host);
  if (metadata.host !== undefined && host === undefined) return false;

  let hostname: string | null = host ? parseAuthorityHostname(host) : null;
  if (!hostname && !host && metadata.requestUrl) {
    try {
      hostname = new URL(metadata.requestUrl).hostname;
    } catch {
      return false;
    }
  }
  if (!hostname || !isLoopbackHostname(hostname)) return false;

  const secFetchSite = readSingleHeader(metadata.secFetchSite);
  if (metadata.secFetchSite !== undefined && secFetchSite === undefined) {
    return false;
  }
  if (secFetchSite?.toLowerCase() === "cross-site") return false;

  const origin = readSingleHeader(metadata.origin);
  if (metadata.origin !== undefined && origin === undefined) return false;
  if (!origin) return true;

  try {
    const parsedOrigin = new URL(origin);
    if (
      parsedOrigin.protocol !== "http:" ||
      !isLoopbackHostname(parsedOrigin.hostname)
    ) {
      return false;
    }
    if (policy === "any-loopback") return true;
    if (host === undefined) return false;
    // Compare through URL on both sides so default ports and host casing
    // normalize identically ("localhost:80" and "LOCALHOST" must not diverge).
    try {
      return parsedOrigin.origin === new URL(`http://${host}`).origin;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
