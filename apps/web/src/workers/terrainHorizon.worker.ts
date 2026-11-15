/// <reference lib="webworker" />
/**
 * Terrain computed off the main thread from LOLA DEM tiles (dem/manifest.json
 * on the assets host, made by scripts/src/dem-tiles.ts): the horizon of a
 * custom point, or the cell horizons of the sunlight map around a site. Tiles
 * stay in memory for nearby points.
 */
import {
  computeTiledHorizon,
  computeTiledIllumination,
  TileStore,
  type DemManifest,
} from "@lunar/core";
import type {
  TerrainPhase,
  TerrainRequest,
  TerrainResponse,
} from "../lib/terrainHorizon";

declare const self: DedicatedWorkerGlobalScope;

/** Raw tile bytes kept in memory before the cache is dropped. */
const CACHE_LIMIT_BYTES = 160e6;

let manifest: { base: string; p: Promise<DemManifest> } | null = null;
const stores = new Map<string, TileStore>();
const jobs = new Map<number, AbortController>();

function post(msg: TerrainResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

function getManifest(base: string, signal: AbortSignal): Promise<DemManifest> {
  if (!manifest || manifest.base !== base) {
    const p = fetch(`${base}manifest.json`, { signal }).then((r) => {
      if (!r.ok) throw new Error(`DEM manifest: HTTP ${r.status}`);
      return r.json() as Promise<DemManifest>;
    });
    manifest = { base, p };
    stores.clear();
    p.catch(() => {
      if (manifest?.p === p) manifest = null;
    });
  }
  return manifest.p;
}

async function gunzip(buf: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([buf as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function compute(
  req: Extract<TerrainRequest, { type: "compute" }>,
): Promise<void> {
  const ctrl = new AbortController();
  jobs.set(req.jobId, ctrl);
  let bytes = 0;
  const progress = (phase: TerrainPhase, done: number, total: number) =>
    post({ type: "progress", jobId: req.jobId, phase, done, total, bytes });
  try {
    const m = await getManifest(req.baseUrl, ctrl.signal);
    if (jobs.size === 1) {
      let held = 0;
      for (const s of stores.values()) held += s.bytes;
      if (held > CACHE_LIMIT_BYTES) stores.clear();
    }
    const options = {
      manifest: m,
      stores,
      siteId: req.siteId,
      lat: req.lat,
      lon: req.lon,
      signal: ctrl.signal,
      // Small polar tiles: latency-bound, HTTP/2 multiplexes them.
      concurrency: 16,
      now: () => performance.now(),
      onProgress: (done: number, total: number, b: number) => {
        bytes = b;
        progress("tiles", done, total);
      },
      fetchTile: async (path: string) => {
        const res = await fetch(`${req.baseUrl}${path}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`DEM tile ${path}: HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        // gzip magic; a host that sent Content-Encoding: gzip already inflated it.
        const raw = buf[0] === 0x1f && buf[1] === 0x8b ? await gunzip(buf) : buf;
        return { raw, bytes: buf.byteLength };
      },
    };
    if (req.kind === "horizon") {
      const { mask, stats } = await computeTiledHorizon(options);
      post({ type: "done", jobId: req.jobId, mask, stats });
    } else {
      const { horizons, stats } = await computeTiledIllumination({
        ...options,
        onCompute: (phase, done, total) => progress(phase, done, total),
      });
      post({ type: "illum-done", jobId: req.jobId, horizons, stats }, [
        horizons.horizonDeg.buffer,
        horizons.cellLat.buffer,
        horizons.cellLon.buffer,
        horizons.gridNorthDeg.buffer,
        horizons.cellElevationM.buffer,
        horizons.relief.heightM.buffer,
      ]);
    }
  } catch (e) {
    post({
      type: "error",
      jobId: req.jobId,
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    jobs.delete(req.jobId);
  }
}

self.onmessage = (e: MessageEvent<TerrainRequest>) => {
  const req = e.data;
  if (req.type === "compute") void compute(req);
  else jobs.get(req.jobId)?.abort();
};
