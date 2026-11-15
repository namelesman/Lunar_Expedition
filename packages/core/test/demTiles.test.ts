/**
 * Terrain horizons from DEM tiles (the browser path) against the precomputed
 * horizons of the curated sites (apps/web/public/data/horizons.json, made by
 * scripts/src/horizons.ts from the whole ldem_64 raster).
 *
 * Needs the tiles: `npm run data:dem-tiles` (writes apps/web/public/dem/,
 * git-ignored). Skipped when they are absent.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  cellHorizonMask,
  computeTiledHorizon,
  computeTiledIllumination,
  horizonElevationAt,
  TileStore,
  type DemManifest,
  type HorizonMask,
} from "../src";

const DEM = fileURLToPath(
  new URL("../../../apps/web/public/dem/", import.meta.url),
);
const HORIZONS = fileURLToPath(
  new URL("../../../apps/web/public/data/horizons.json", import.meta.url),
);
const SITES = fileURLToPath(new URL("../../../data/sites.json", import.meta.url));
const haveTiles = existsSync(join(DEM, "manifest.json"));

/** Apollo 11 and every curated site south of 80°S. */
const SITE_IDS = ["apollo-11", "im-1-odysseus", "im-2-athena", "shackleton-crater"];

function load() {
  const manifest = JSON.parse(
    readFileSync(join(DEM, "manifest.json"), "utf8"),
  ) as DemManifest;
  const horizons = JSON.parse(readFileSync(HORIZONS, "utf8")) as Record<
    string,
    HorizonMask
  >;
  const sites = (
    JSON.parse(readFileSync(SITES, "utf8")) as {
      id: string;
      lat: number;
      lon: number;
    }[]
  ).filter((s) => SITE_IDS.includes(s.id));
  return { manifest, horizons, sites };
}

const fetchTile = async (path: string) => {
  const gz = readFileSync(join(DEM, path));
  return { raw: gunzipSync(gz), bytes: gz.byteLength };
};

function diff(a: HorizonMask, b: HorizonMask) {
  let max = 0,
    sq = 0,
    at = 0;
  a.elevationsDeg.forEach((e, i) => {
    const d = Math.abs(e - b.elevationsDeg[i]);
    if (d > max) {
      max = d;
      at = i * a.azimuthStepDeg;
    }
    sq += d * d;
  });
  return { max, rms: Math.sqrt(sq / a.elevationsDeg.length), at };
}

async function run(
  manifest: DemManifest,
  stores: Map<string, TileStore>,
  s: { id: string; lat: number; lon: number },
) {
  return computeTiledHorizon({
    manifest,
    stores,
    siteId: s.id,
    lat: s.lat,
    lon: s.lon,
    fetchTile,
  });
}

describe.skipIf(!haveTiles)("terrain horizon from DEM tiles", () => {
  it("tiled ldem_64 reproduces horizons.json exactly (tiling is lossless)", async () => {
    const { manifest, horizons, sites } = load();
    const m: DemManifest = { ...manifest, near: ["ldem-64"], far: ["ldem-64"] };
    const stores = new Map<string, TileStore>();
    for (const s of sites) {
      const { mask } = await run(m, stores, s);
      const ref = horizons[s.id];
      expect(mask.elevationsDeg).toEqual(ref.elevationsDeg);
      expect(mask.distancesKm).toEqual(ref.distancesKm);
      expect(mask.siteElevationM).toBe(ref.siteElevationM);
      expect(mask.demSource).toBe(ref.demSource);
    }
  }, 120_000);

  it("far layers (50–300 km) change the horizon by < 0.3°; app layers reported", async () => {
    const { manifest, horizons, sites } = load();
    // Same near DEM as horizons.json (ldem_64), the app's far stack: isolates
    // the coarser 50–300 km layers (ldem_16 and the polar 960 m / 948 m grids).
    const farOnly: DemManifest = { ...manifest, near: ["ldem-64"] };
    const stores = new Map<string, TileStore>();
    const rows: string[] = [];
    const checks: (() => void)[] = [];
    for (const s of sites) {
      const ref = horizons[s.id];
      const f = diff((await run(farOnly, stores, s)).mask, ref);
      const { mask } = await run(manifest, stores, s);
      const a = diff(mask, ref);
      rows.push(
        `${s.id.padEnd(18)} far layers: max ${f.max.toFixed(3)}° rms ${f.rms.toFixed(3)}° | app layers: max ${a.max.toFixed(3)}° (az ${a.at}°) rms ${a.rms.toFixed(3)}°`,
      );
      checks.push(() => {
        expect(f.max).toBeLessThan(0.3);
        // Outside the LOLA 80 m polar DEM the app uses the rasters of horizons.json.
        if (s.lat > -80) expect(a.max).toBeLessThan(0.3);
        // South of 80°S the near field comes from 80 m data that resolves
        // relief ldem_64 (474 m) smooths: a real difference, bounded here.
        else expect(a.max).toBeLessThan(3);
      });
    }
    console.log(
      ["horizon vs horizons.json (ldem_64 everywhere):", ...rows].join("\n"),
    );
    for (const c of checks) c();
  }, 120_000);

  it("illumination map: the centre cell's horizon matches the site horizon (< 0.5°)", async () => {
    const { manifest, sites } = load();
    const rows: string[] = [];
    const checks: (() => void)[] = [];
    for (const s of sites.filter((x) =>
      ["apollo-11", "shackleton-crater"].includes(x.id),
    )) {
      // Fresh cache: the download of a site whose horizon is not loaded yet.
      const stores = new Map<string, TileStore>();
      const t0 = performance.now();
      const { horizons, stats } = await computeTiledIllumination({
        manifest,
        stores,
        siteId: s.id,
        lat: s.lat,
        lon: s.lon,
        fetchTile,
      });
      const ms = performance.now() - t0;
      const { mask } = await run(manifest, stores, s);
      const m = (horizons.n - 1) / 2;
      const cell = cellHorizonMask(horizons, m, m);
      let max = 0;
      cell.elevationsDeg.forEach((e, k) => {
        max = Math.max(
          max,
          Math.abs(e - horizonElevationAt(mask, k * cell.azimuthStepDeg)),
        );
      });
      rows.push(
        `${s.id.padEnd(18)} ${stats.fetched} tiles, ${(stats.bytes / 1e6).toFixed(2)} MB, ${Math.round(stats.computeMs)} ms compute, ${Math.round(ms)} ms total | centre vs site horizon: max ${max.toFixed(3)}°`,
      );
      checks.push(() => expect(max).toBeLessThan(0.5));
    }
    console.log(["illumination map (Node, local tiles):", ...rows].join("\n"));
    for (const c of checks) c();
  }, 180_000);
});
