/**
 * Terrain horizon masks for every landing site, from LOLA.
 *
 * For each site and each azimuth (0.5° steps) we march along the great circle
 * up to MAX_KM and keep the highest elevation angle of the terrain seen by an
 * observer OBS_H m above the ground. Curvature is exact:
 *
 *   observer radius r0 = R + h_site + OBS_H, target radius r1 = R + h(d)
 *   central angle   t  = d / R
 *   elevation       e  = atan2(r1·cos t − r0, r1·sin t)
 *
 * No atmosphere on the Moon, so there is no refraction term: the horizon is the
 * terrain (or the limb of the sphere, which this formula also yields).
 *
 * DEM: CGI Moon Kit ldem_64_uint.tif (SVS #4720) — see lib/dem.ts.
 * Output: apps/web/public/data/horizons.json (small, committed; consumed by
 * @lunar/core HorizonMask).
 *
 * Usage: npm run data:horizons [-- path/to/ldem_64_uint.tif]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { destinationPoint, MOON_RADIUS_M, type HorizonMask } from "@lunar/core";
import { GlobalDem } from "./lib/dem";
import { loadSites, round, SVS_4720, WEB_DATA } from "./lib/paths";

const OBS_H = 2.0;
const AZ_STEP = 0.5;
const MAX_KM = 300;
const R = MOON_RADIUS_M;

export function marchDistancesM(): number[] {
  const d: number[] = [];
  for (let x = 60; x < 5_000; x += 60) d.push(x);
  for (let x = 5_000; x < 50_000; x += 250) d.push(x);
  for (let x = 50_000; x <= MAX_KM * 1000; x += 1_000) d.push(x);
  return d;
}

function horizonMask(
  dem: GlobalDem,
  siteId: string,
  lat: number,
  lon: number,
): HorizonMask {
  const h0 = dem.sample(lat, lon);
  const r0 = R + h0 + OBS_H;
  const dist = marchDistancesM();
  const elevationsDeg: number[] = [];
  const distancesKm: number[] = [];
  for (let az = 0; az < 360; az += AZ_STEP) {
    let best = -Infinity,
      bestD = 0;
    for (const d of dist) {
      const p = destinationPoint({ lat, lon }, az, d, R);
      const r1 = R + dem.sample(p.lat, p.lon);
      const t = d / R;
      const e = Math.atan2(r1 * Math.cos(t) - r0, r1 * Math.sin(t));
      if (e > best) {
        best = e;
        bestD = d;
      }
    }
    elevationsDeg.push(round((best * 180) / Math.PI, 3));
    distancesKm.push(round(bestD / 1000, 2));
  }
  return {
    siteId,
    lat,
    lon,
    observerHeightM: OBS_H,
    siteElevationM: round(h0, 1),
    azimuthStepDeg: AZ_STEP,
    elevationsDeg,
    distancesKm,
    maxDistanceKm: MAX_KM,
    demSource: dem.name,
  };
}

async function main(): Promise<void> {
  const demPath = process.argv[2] ?? join(SVS_4720, "ldem_64_uint.tif");
  const dem = await GlobalDem.load(demPath);
  const out: Record<string, HorizonMask> = {};
  for (const s of loadSites()) {
    const m = horizonMask(dem, s.id, s.lat, s.lon);
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
