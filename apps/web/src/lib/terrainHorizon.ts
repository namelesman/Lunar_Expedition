"use client";

/**
 * Terrain computed in the browser from the LOLA DEM tiles on the assets host,
 * in a Web Worker (src/workers/terrainHorizon.worker.ts):
 *  - the terrain horizon of custom points: the same horizonMask as the
 *    offline pipeline (packages/core/src/terrain.ts). On any failure or after
 *    15 s the point keeps the smooth-sphere horizon and the panel says so; the
 *    app never depends on it.
 *  - on demand, the horizons of every cell of the 20 × 20 km sunlight /
 *    Earth-visibility map around a site (packages/core/src/illumination.ts).
 */
import type {
  CellHorizons,
  HorizonMask,
  Site,
  TiledHorizonStats,
  TiledIlluminationStats,
} from "@lunar/core";
import { useEffect } from "react";
import { assetUrl } from "./assets";
import { useApp } from "./store";

export const TERRAIN_TIMEOUT_MS = 15_000;

type JobKind = "horizon" | "illum";

export type TerrainRequest =
  | {
      type: "compute";
      kind: JobKind;
      jobId: number;
      siteId: string;
      lat: number;
      lon: number;
      /** Absolute URL of the DEM folder (ends with "/"). */
      baseUrl: string;
    }
  | { type: "abort"; jobId: number };

/** "tiles": download; "grid": resampling the DEM; "horizons": the cell marches (rows). */
export type TerrainPhase = "tiles" | "grid" | "horizons";

export interface TerrainProgress {
  phase: TerrainPhase;
  done: number;
  total: number;
  /** Compressed bytes downloaded so far. */
  bytes: number;
}

export type TerrainResponse =
  | ({ type: "progress"; jobId: number } & TerrainProgress)
  | { type: "done"; jobId: number; mask: HorizonMask; stats: TiledHorizonStats }
  | {
      type: "illum-done";
      jobId: number;
      horizons: CellHorizons;
      stats: TiledIlluminationStats;
    }
  | { type: "error"; jobId: number; message: string };

export type TerrainState =
  | { status: "computing"; done: number; total: number; bytes: number }
  | { status: "ready"; mask: HorizonMask; stats: TiledHorizonStats; ms: number }
  | { status: "failed"; reason: string };

export type IlluminationState =
  | ({ status: "computing" } & TerrainProgress)
  | {
      status: "ready";
      horizons: CellHorizons;
      stats: TiledIlluminationStats;
      ms: number;
    }
  | { status: "failed"; reason: string };

type Done = Exclude<TerrainResponse, { type: "progress" } | { type: "error" }>;

interface Job {
  resolve: (r: Done) => void;
  reject: (e: Error) => void;
  onProgress: (p: TerrainProgress) => void;
}

let worker: Worker | null = null;
let nextJobId = 1;
const jobs = new Map<number, Job>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(
    new URL("../workers/terrainHorizon.worker.ts", import.meta.url),
    { type: "module", name: "terrain-horizon" },
  );
  w.onmessage = (e: MessageEvent<TerrainResponse>) => {
    const msg = e.data;
    const job = jobs.get(msg.jobId);
    if (!job) return;
    if (msg.type === "progress") job.onProgress(msg);
    else {
      jobs.delete(msg.jobId);
      if (msg.type === "error") job.reject(new Error(msg.message));
      else job.resolve(msg);
    }
  };
  w.onerror = (e) => {
    e.preventDefault();
    for (const job of jobs.values())
      job.reject(new Error(e.message || "terrain worker failed"));
    jobs.clear();
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

/** Runs one worker job; rejects on any error or after `timeoutMs` (if given). */
function runJob(
  kind: JobKind,
  site: Pick<Site, "id" | "lat" | "lon">,
  onProgress: (p: TerrainProgress) => void,
  timeoutMs: number | null,
): Promise<Done> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      if (typeof DecompressionStream === "undefined")
        throw new Error("this browser cannot decompress the DEM tiles");
      w = getWorker();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    const jobId = nextJobId++;
    const timer =
      timeoutMs === null
        ? undefined
        : setTimeout(() => {
            jobs.delete(jobId);
            w.postMessage({ type: "abort", jobId } satisfies TerrainRequest);
            reject(new Error(`no answer within ${timeoutMs / 1000} s`));
          }, timeoutMs);
    jobs.set(jobId, {
      onProgress,
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    w.postMessage({
      type: "compute",
      kind,
      jobId,
      siteId: site.id,
      lat: site.lat,
      lon: site.lon,
      baseUrl: new URL(assetUrl("dem/"), window.location.href).href,
    } satisfies TerrainRequest);
  });
}

/** Terrain horizon of a point; rejects on any error or after TERRAIN_TIMEOUT_MS. */
export async function computeTerrainHorizon(
  site: Pick<Site, "id" | "lat" | "lon">,
  onProgress: (done: number, total: number, bytes: number) => void,
): Promise<{ mask: HorizonMask; stats: TiledHorizonStats }> {
  const r = await runJob(
    "horizon",
    site,
    (p) => onProgress(p.done, p.total, p.bytes),
    TERRAIN_TIMEOUT_MS,
  );
  if (r.type !== "done") throw new Error("unexpected worker answer");
  return r;
}

/** Cell horizons of the sunlight / Earth-visibility map around a site (on demand: no timeout). */
export async function computeIlluminationHorizons(
  site: Pick<Site, "id" | "lat" | "lon">,
  onProgress: (p: TerrainProgress) => void,
): Promise<{ horizons: CellHorizons; stats: TiledIlluminationStats }> {
  const r = await runJob("illum", site, onProgress, null);
  if (r.type !== "illum-done") throw new Error("unexpected worker answer");
  return r;
}

/** Starts the map job of a site; its state lives in the store. */
export function startIllumination(site: Pick<Site, "id" | "lat" | "lon">): void {
  const { setIllumination } = useApp.getState();
  const t0 = performance.now();
  setIllumination(site.id, {
    status: "computing",
    phase: "tiles",
    done: 0,
    total: 0,
    bytes: 0,
  });
  computeIlluminationHorizons(site, (p) =>
    setIllumination(site.id, {
      status: "computing",
      phase: p.phase,
      done: p.done,
      total: p.total,
      bytes: p.bytes,
    }),
  )
    .then(({ horizons, stats }) => {
      const ms = performance.now() - t0;
      console.info(
        `[illumination] ${site.id}: ${stats.fetched} tiles fetched (${(stats.bytes / 1e6).toFixed(2)} MB), ${stats.cached} cached, ${Math.round(ms)} ms total, ${Math.round(stats.computeMs)} ms horizons`,
      );
      setIllumination(site.id, { status: "ready", horizons, stats, ms });
    })
    .catch((e: Error) => {
      console.warn(`[illumination] ${site.id}: ${e.message}`);
      setIllumination(site.id, { status: "failed", reason: e.message });
    });
}

/** Starts a terrain-horizon job for every custom point that has none yet. */
export function useTerrainHorizonJobs(): void {
  const sites = useApp((s) => s.sites);
  const terrain = useApp((s) => s.terrain);
  const setTerrain = useApp((s) => s.setTerrain);
  useEffect(() => {
    for (const site of sites) {
      if (site.category !== "custom" || terrain[site.id]) continue;
      const t0 = performance.now();
      setTerrain(site.id, { status: "computing", done: 0, total: 0, bytes: 0 });
      computeTerrainHorizon(site, (done, total, bytes) =>
        setTerrain(site.id, { status: "computing", done, total, bytes }),
      )
        .then(({ mask, stats }) => {
          const ms = performance.now() - t0;
          console.info(
            `[terrain] ${site.id}: ${stats.fetched} tiles fetched (${(stats.bytes / 1e6).toFixed(2)} MB), ${stats.cached} cached, ${Math.round(ms)} ms total, ${Math.round(stats.computeMs)} ms march`,
          );
          setTerrain(site.id, { status: "ready", mask, stats, ms });
        })
        .catch((e: Error) => {
          console.warn(`[terrain] ${site.id}: ${e.message}`);
          setTerrain(site.id, { status: "failed", reason: e.message });
        });
    }
  }, [sites, terrain, setTerrain]);
}
