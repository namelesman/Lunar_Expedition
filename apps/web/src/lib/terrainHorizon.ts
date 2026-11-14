"use client";

/**
 * Terrain horizons for custom points, computed in the browser: a Web Worker
 * downloads the LOLA DEM tiles around the point from the assets host and runs
 * the same horizonMask as the offline pipeline (packages/core/src/terrain.ts).
 * On any failure or after 15 s the point keeps the smooth-sphere horizon and
 * the panel says so; the app never depends on it.
 */
import type { HorizonMask, Site, TiledHorizonStats } from "@lunar/core";
import { useEffect } from "react";
import { assetUrl } from "./assets";
import { useApp } from "./store";

export const TERRAIN_TIMEOUT_MS = 15_000;

export type TerrainRequest =
  | {
      type: "compute";
      jobId: number;
      siteId: string;
      lat: number;
      lon: number;
      /** Absolute URL of the DEM folder (ends with "/"). */
      baseUrl: string;
    }
  | { type: "abort"; jobId: number };

export type TerrainResponse =
  | { type: "progress"; jobId: number; done: number; total: number; bytes: number }
  | { type: "done"; jobId: number; mask: HorizonMask; stats: TiledHorizonStats }
  | { type: "error"; jobId: number; message: string };

export type TerrainState =
  | { status: "computing"; done: number; total: number; bytes: number }
  | { status: "ready"; mask: HorizonMask; stats: TiledHorizonStats; ms: number }
  | { status: "failed"; reason: string };

interface Job {
  resolve: (r: { mask: HorizonMask; stats: TiledHorizonStats }) => void;
  reject: (e: Error) => void;
  onProgress: (done: number, total: number, bytes: number) => void;
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
    if (msg.type === "progress") job.onProgress(msg.done, msg.total, msg.bytes);
    else {
      jobs.delete(msg.jobId);
      if (msg.type === "done") job.resolve(msg);
      else job.reject(new Error(msg.message));
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

/** Terrain horizon of a point; rejects on any error or after TERRAIN_TIMEOUT_MS. */
export function computeTerrainHorizon(
  site: Pick<Site, "id" | "lat" | "lon">,
  onProgress: Job["onProgress"],
): Promise<{ mask: HorizonMask; stats: TiledHorizonStats }> {
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
    const timer = setTimeout(() => {
      jobs.delete(jobId);
      w.postMessage({ type: "abort", jobId } satisfies TerrainRequest);
      reject(new Error(`no answer within ${TERRAIN_TIMEOUT_MS / 1000} s`));
    }, TERRAIN_TIMEOUT_MS);
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
      jobId,
      siteId: site.id,
      lat: site.lat,
      lon: site.lon,
      baseUrl: new URL(assetUrl("dem/"), window.location.href).href,
    } satisfies TerrainRequest);
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
