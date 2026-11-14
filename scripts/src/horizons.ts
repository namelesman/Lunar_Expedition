/**
 * Terrain horizon masks for every curated landing site, from LOLA.
 *
 * The algorithm (horizonMask in @lunar/core, packages/core/src/terrain.ts)
 * marches each azimuth (0.5° steps) up to 300 km with exact curvature, for an
 * observer 2 m above the ground. The browser runs the same function on DEM
 * tiles for custom points (scripts/src/dem-tiles.ts).
 *
 * DEM: CGI Moon Kit ldem_64_uint.tif (SVS #4720) at every distance — see lib/dem.ts.
 * Output: apps/web/public/data/horizons.json (small, committed; consumed by
 * @lunar/core HorizonMask).
 *
 * Usage: npm run data:horizons [-- path/to/ldem_64_uint.tif]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { horizonMask, type HorizonMask } from "@lunar/core";
import { GlobalDem } from "./lib/dem";
import { loadSites, SVS_4720, WEB_DATA } from "./lib/paths";

async function main(): Promise<void> {
  const demPath = process.argv[2] ?? join(SVS_4720, "ldem_64_uint.tif");
  const dem = await GlobalDem.load(demPath);
  const out: Record<string, HorizonMask> = {};
  for (const s of loadSites()) {
    const m = horizonMask({ near: dem }, s.id, s.lat, s.lon);
    out[s.id] = m;
    const lo = Math.min(...m.elevationsDeg).toFixed(2),
      hi = Math.max(...m.elevationsDeg).toFixed(2);
    console.log(
      `${s.id.padEnd(22)} h=${m.siteElevationM.toFixed(1).padStart(8)} m  horizon min ${lo.padStart(6)}  max ${hi.padStart(6)} deg`,
    );
  }
  await mkdir(WEB_DATA, { recursive: true });
  const dst = join(WEB_DATA, "horizons.json");
  const json = JSON.stringify(out);
  await writeFile(dst, json, "utf8");
  console.log(`wrote ${dst} (${(json.length / 1024).toFixed(0)} KB)`);
}

await main();
