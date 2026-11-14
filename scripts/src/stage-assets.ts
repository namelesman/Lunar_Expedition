/**
 * Stage the heavy, git-ignored web assets into a static site for the Vercel
 * project "lunar-expedition-assets" (served at
 * https://lunar-expedition-assets.vercel.app, NEXT_PUBLIC_ASSETS_BASE_URL of the
 * app). Copies apps/web/public/{models,sky} and writes a vercel.json with CORS
 * and cache headers.
 *
 * Usage:
 *   npm run assets:stage
 *   cd data/cache/assets-site && vercel deploy --prod
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/paths";

const SITE = join(ROOT, "data/cache/assets-site");
const PUBLIC = join(ROOT, "apps/web/public");
const FOLDERS = ["models", "sky"];

await rm(SITE, { recursive: true, force: true });
await mkdir(SITE, { recursive: true });
for (const f of FOLDERS) {
  const src = join(PUBLIC, f);
  if (!existsSync(src))
    throw new Error(`${src} missing — run glb:optimize / sky:textures first`);
  await cp(src, join(SITE, f), { recursive: true });
}
const cors = { key: "Access-Control-Allow-Origin", value: "*" };
const cache = {
  key: "Cache-Control",
  value: "public, max-age=604800, stale-while-revalidate=86400",
};
await writeFile(
  join(SITE, "vercel.json"),
  JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      headers: [
        {
          source: "/models/(.*)",
          headers: [
            cors,
            cache,
            { key: "Content-Type", value: "model/gltf-binary" },
          ],
        },
        { source: "/sky/(.*)", headers: [cors, cache] },
      ],
    },
    null,
    2,
  ),
);
await writeFile(
  join(SITE, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Lunar Expedition assets</title>
<p>Web-optimized derivatives of NASA data for the Lunar Landing Site Navigator (NASA Space Apps Challenge 2026):
the SVS LRO Moon model (svs.gsfc.nasa.gov/14959; LROC + LOLA, NASA/GSFC/ASU) and the SVS Deep Star Maps 2020
(svs.gsfc.nasa.gov/4851).</p>
`,
);
console.log(`staged ${FOLDERS.join(", ")} in ${SITE}`);
