import { isTrustedLocalRequest } from "@nexu/shared";
import type { LocalRequestMetadata } from "@nexu/shared";

export type { LocalRequestMetadata };
// The controller port is called cross-port by the Vite dev server, so it
// accepts any loopback origin. The desktop embedded web server serves the
// renderer and the API from one origin and pins itself to `same-origin`.
export { isTrustedLocalRequest };

interface UpgradeRequestLike {
  url?: string;
  headers: {
    host?: string | string[];
    origin?: string | string[];
    "sec-fetch-site"?: string | string[];
  };
}

interface UpgradeSocketLike {
  end(chunk: string): unknown;
}

export function acceptTrustedLocalUpgrade(
  req: UpgradeRequestLike,
  socket: UpgradeSocketLike,
): boolean {
  const accepted = isTrustedLocalRequest({
    requestUrl: req.url,
    host: req.headers.host,
    origin: req.headers.origin,
    secFetchSite: req.headers["sec-fetch-site"],
  });
  if (accepted) return true;

  socket.end(
    "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
  );
  return false;
}
