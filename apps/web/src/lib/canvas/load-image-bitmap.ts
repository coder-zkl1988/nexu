/**
 * load-image-bitmap.ts — shared cross-origin-safe image loading helper (W3.3).
 *
 * Strategy: fetch(url) → blob() → createImageBitmap(blob)
 *
 * This sidesteps canvas cross-origin taint: drawing a cross-origin <img> via
 * drawImage would cause canvas.toDataURL() to throw SecurityError. Fetching
 * the bytes first + createImageBitmap avoids CORS taint entirely.
 *
 * data: URLs are also supported — the browser handles data: URLs via fetch().
 *
 * Relative servable URLs (e.g. /api/v1/media/state-file?path=…) are resolved
 * against the SDK client's configured baseUrl so the same code works in both
 * Vite dev (proxied to controller) and Electron (baseUrl injected via env).
 */

import { client } from "../../../lib/api/client.gen";

/**
 * Resolve relative servable URLs against the SDK client's configured baseUrl.
 * Absolute http(s) URLs and data: URLs pass through unchanged.
 * Module-level so it has a stable identity and is never a useEffect dependency.
 */
export function resolveMediaUrl(url: string): string {
  if (!url || url.startsWith("data:")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const cfg = client.getConfig() as { baseUrl?: string };
  const base = cfg.baseUrl ?? "";
  if (!base) return url;
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = url.startsWith("/") ? url : `/${url}`;
  return `${cleanBase}${cleanPath}`;
}

export interface LoadedImage {
  bitmap: ImageBitmap;
  objectUrl: string;
}

/**
 * Load an image URL into an ImageBitmap + object URL pair.
 *
 * The caller is responsible for:
 *   - calling bitmap.close() on unmount / disposal
 *   - calling URL.revokeObjectURL(objectUrl) on unmount / disposal
 *
 * Throws on HTTP error or createImageBitmap failure.
 */
export async function loadImageBitmap(url: string): Promise<LoadedImage> {
  const resolvedUrl = resolveMediaUrl(url);
  const resp = await fetch(resolvedUrl);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const objectUrl = URL.createObjectURL(blob);
  return { bitmap, objectUrl };
}
