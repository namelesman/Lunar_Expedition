/**
 * Heavy assets (optimized NASA models, tiles) are not in git. Locally they are
 * generated into apps/web/public/; in production they are served from object
 * storage whose base URL is set in NEXT_PUBLIC_ASSETS_BASE_URL.
 */
const BASE = (process.env.NEXT_PUBLIC_ASSETS_BASE_URL ?? "").replace(/\/$/, "");

export function assetUrl(path: string): string {
  return `${BASE}/${path.replace(/^\//, "")}`;
}
