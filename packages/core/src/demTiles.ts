/**
 * LOLA DEMs cut into tiles, so the browser downloads only the terrain one site
 * needs (scripts/src/dem-tiles.ts writes them; a Web Worker reads them).
 *
 * Each tile is a gzip of the raw little-endian uint16/int16 pixels of a
 * tilePx × tilePx block (edge tiles of polar layers are narrower). A tiled
 * layer samples through the same EquirectDem / PolarStereoDem code as the
 * full raster, so heights are bit-identical; pixels on a tile edge simply read
 * the neighbouring tile.
 */
import type { HorizonMask } from "./types";
import {
  EquirectDem,
  forEachHorizonSample,
  HORIZON_MAX_KM,
  HORIZON_NEAR_KM,
  horizonMask,
  LayeredDem,
  PolarStereoDem,
  polarRho,
  type DemSampler,
  type EquirectGrid,
  type PixelSource,
  type PixelVisitor,
  type PolarGrid,
} from "./terrain";

export type TileDtype = "uint16" | "int16";

interface TiledLayerBase {
  id: string;
  /** Human-readable source, shown as the horizon's DEM source. */
  name: string;
  dtype: TileDtype;
  tilePx: number;
}
export interface EquirectLayerSpec extends TiledLayerBase, EquirectGrid {
  kind: "equirect";
}
export interface PolarLayerSpec extends TiledLayerBase, PolarGrid {
  kind: "polar-stereo";
}
export type DemLayerSpec = EquirectLayerSpec | PolarLayerSpec;

export interface DemManifest {
  version: 1;
  /** Folder of the tiles, relative to the manifest (ends with "/"). */
  tilesDir: string;
  /** Layer ids, finest first, sampled up to HORIZON_NEAR_KM from the site. */
  near: string[];
  /** Layer ids, finest first, sampled from HORIZON_NEAR_KM to HORIZON_MAX_KM. */
  far: string[];
  layers: Record<string, DemLayerSpec>;
  /** Compressed size of each layer's tile set (bytes). */
  bytes?: Record<string, number>;
  tileCount?: Record<string, number>;
  generatedBy: string;
}

export function layerWidth(spec: DemLayerSpec): number {
  return spec.kind === "equirect" ? spec.width : spec.size;
}
export function layerHeight(spec: DemLayerSpec): number {
  return spec.kind === "equirect" ? spec.height : spec.size;
}
export function tileCols(spec: DemLayerSpec): number {
  return Math.ceil(layerWidth(spec) / spec.tilePx);
}
export function tileRows(spec: DemLayerSpec): number {
  return Math.ceil(layerHeight(spec) / spec.tilePx);
}

export interface TileRect {
  index: number;
  row: number;
  col: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export function tileRect(spec: DemLayerSpec, index: number): TileRect {
  const cols = tileCols(spec);
  const row = Math.floor(index / cols),
    col = index % cols;
  const T = spec.tilePx;
  const x0 = col * T,
    y0 = row * T;
  return {
    index,
    row,
    col,
    x0,
    y0,
    w: Math.min(T, layerWidth(spec) - x0),
    h: Math.min(T, layerHeight(spec) - y0),
  };
}

export function tileIndexOf(spec: DemLayerSpec, x: number, y: number): number {
  return (
    Math.floor(y / spec.tilePx) * tileCols(spec) + Math.floor(x / spec.tilePx)
  );
}

/** Radius (px) of the disk that a polar layer covers (its cap down to edgeLat). */
export function polarCoverageRadiusPx(g: PolarGrid): number {
  return polarRho(g, g.edgeLat) / g.scaleM;
}

/**
 * Whether the tile is stored. Equirectangular layers: always. Polar layers: only
 * tiles that reach the covered disk (the square's corners are never sampled).
 */
export function tileExists(spec: DemLayerSpec, index: number): boolean {
  if (spec.kind === "equirect") return true;
  const t = tileRect(spec, index);
  const c = spec.center;
  const dx = Math.max(t.x0 - c, 0, c - (t.x0 + t.w - 1));
  const dy = Math.max(t.y0 - c, 0, c - (t.y0 + t.h - 1));
  return Math.hypot(dx, dy) <= polarCoverageRadiusPx(spec) + 2;
}

export function tilePath(
  manifest: DemManifest,
  spec: DemLayerSpec,
  index: number,
): string {
  const t = tileRect(spec, index);
  return `${manifest.tilesDir}${spec.id}/${t.row}-${t.col}.bin.gz`;
}

/** Decoded pixels of one tile from its raw (already gunzipped) bytes. */
export function decodeTile(
  spec: DemLayerSpec,
  index: number,
  raw: Uint8Array,
): Uint16Array | Int16Array {
  const t = tileRect(spec, index);
  if (raw.byteLength !== t.w * t.h * 2) {
    throw new Error(
      `${spec.id} tile ${t.row}-${t.col}: ${raw.byteLength} bytes, expected ${t.w * t.h * 2}`,
    );
  }
  // Copy into an aligned buffer (the source may sit at an odd byte offset).
  const buf = new ArrayBuffer(raw.byteLength);
  new Uint8Array(buf).set(raw);
  return spec.dtype === "uint16" ? new Uint16Array(buf) : new Int16Array(buf);
}

/** Tiles of one layer held in memory; a PixelSource for the layer's sampler. */
export class TileStore implements PixelSource {
  readonly cols: number;
  private readonly lastW: number;
  private readonly tiles: (Uint16Array | Int16Array | undefined)[];
  /** Pixel reads that hit a tile that is not loaded (must stay 0). */
  missing = 0;

  constructor(readonly spec: DemLayerSpec) {
    this.cols = tileCols(spec);
    this.lastW = layerWidth(spec) - (this.cols - 1) * spec.tilePx;
    this.tiles = new Array(this.cols * tileRows(spec));
  }
  has(index: number): boolean {
    return this.tiles[index] !== undefined;
  }
  set(index: number, data: Uint16Array | Int16Array): void {
    this.tiles[index] = data;
  }
  delete(index: number): void {
    this.tiles[index] = undefined;
  }
  /** Raw bytes held in memory. */
  get bytes(): number {
    let n = 0;
    for (const t of this.tiles) if (t) n += t.byteLength;
    return n;
  }
  pixel(x: number, y: number): number {
    const T = this.spec.tilePx;
    const c = Math.floor(x / T),
      r = Math.floor(y / T);
    const t = this.tiles[r * this.cols + c];
    if (t === undefined) {
      this.missing++;
      return NaN;
    }
    const w = c === this.cols - 1 ? this.lastW : T;
    return t[(y - r * T) * w + (x - c * T)];
  }
}

export type LayerDem = (EquirectDem | PolarStereoDem) & DemSampler;

export function layerDem(spec: DemLayerSpec, pixels: PixelSource): LayerDem {
  return spec.kind === "equirect"
    ? new EquirectDem(spec.name, spec, pixels)
    : new PolarStereoDem(spec.name, spec, pixels);
}

/**
 * Tiles each layer needs for the terrain horizon at lat/lon. Exact: a dry run
 * of the horizon march (forEachHorizonSample) that, for every sample, picks the
 * first layer of the near/far stack covering it — as LayeredDem will — and
 * collects the tiles of its bilinear footprint. Longitude convergence near the
 * poles and the polar stereographic geometry come out of the same code path
 * that samples the terrain, and a coarse layer is not fetched where a finer one
 * already covers the samples.
 */
export function requiredTiles(
  manifest: DemManifest,
  lat: number,
  lon: number,
  maxKm = HORIZON_MAX_KM,
): Map<string, Set<number>> {
  const zero: PixelSource = { pixel: () => 0 };
  const out = new Map<string, Set<number>>();
  const stack = (ids: string[]) =>
    ids.map((id) => {
      const spec = manifest.layers[id];
      if (!spec) throw new Error(`manifest: unknown layer ${id}`);
      let set = out.get(id);
      if (!set) out.set(id, (set = new Set()));
      const s = set;
      const visit: PixelVisitor = (x, y) => s.add(tileIndexOf(spec, x, y));
      return { dem: layerDem(spec, zero), visit };
    });
  const near = stack(manifest.near);
  const far = stack(manifest.far);
  const nearM = HORIZON_NEAR_KM * 1000,
    maxM = maxKm * 1000;
  const visitPoint = (p: { lat: number; lon: number }, d: number) => {
    if (d > maxM) return;
    for (const l of d <= nearM ? near : far) {
      if (l.dem.footprint(p.lat, p.lon, l.visit)) return;
    }
  };
  visitPoint({ lat, lon }, 0); // the site's own elevation
  forEachHorizonSample(lat, lon, visitPoint);
  for (const [id, s] of out) if (s.size === 0) out.delete(id);
  return out;
}

export interface TiledHorizonStats {
  /** Tiles the site needs, per layer id. */
  tilesByLayer: Record<string, number>;
  /** Tiles downloaded for this site (the rest were already in memory). */
  fetched: number;
  cached: number;
  /** Bytes transferred for the fetched tiles (compressed). */
  bytes: number;
  fetchMs: number;
  computeMs: number;
}

export interface TiledHorizonOptions {
  manifest: DemManifest;
  /** Tile stores by layer id; reused across sites (tile cache). */
  stores: Map<string, TileStore>;
  siteId: string;
  lat: number;
  lon: number;
  /** Returns the gunzipped tile bytes and the number of bytes transferred. */
  fetchTile: (path: string) => Promise<{ raw: Uint8Array; bytes: number }>;
  concurrency?: number;
  onProgress?: (done: number, total: number, bytes: number) => void;
  signal?: AbortSignal;
  now?: () => number;
}

/**
 * Terrain horizon of a site from DEM tiles: finds the tiles, loads the missing
 * ones, then runs horizonMask on the layered near/far DEMs. Throws if any tile
 * fails or if the march reads a pixel that is not loaded.
 */
export async function computeTiledHorizon(
  o: TiledHorizonOptions,
): Promise<{ mask: HorizonMask; stats: TiledHorizonStats }> {
  const now = o.now ?? (() => Date.now());
  const t0 = now();
  const need = requiredTiles(o.manifest, o.lat, o.lon);
  const queue: { spec: DemLayerSpec; store: TileStore; index: number }[] = [];
  const tilesByLayer: Record<string, number> = {};
  let cached = 0;
  for (const [id, set] of need) {
    const spec = o.manifest.layers[id];
    let store = o.stores.get(id);
    if (!store) o.stores.set(id, (store = new TileStore(spec)));
    tilesByLayer[id] = set.size;
    for (const index of set) {
      if (!tileExists(spec, index))
        throw new Error(`${id}: tile ${index} needed but not in the tile set`);
      if (store.has(index)) cached++;
      else queue.push({ spec, store, index });
    }
  }
  const total = queue.length;
  let done = 0,
    bytes = 0,
    next = 0;
  o.onProgress?.(0, total, 0);
  const worker = async () => {
    while (next < queue.length) {
      if (o.signal?.aborted) throw new Error("aborted");
      const job = queue[next++];
      const r = await o.fetchTile(tilePath(o.manifest, job.spec, job.index));
      job.store.set(job.index, decodeTile(job.spec, job.index, r.raw));
      bytes += r.bytes;
      done++;
      o.onProgress?.(done, total, bytes);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(o.concurrency ?? 8, total) }, worker),
  );
  const t1 = now();

  const dems = (ids: string[]) =>
    new LayeredDem(
      ids
        .filter((id) => need.has(id))
        .map((id) => {
          const store = o.stores.get(id)!;
          store.missing = 0;
          return layerDem(o.manifest.layers[id], store);
        }),
    );
  const near = dems(o.manifest.near);
  const far = dems(o.manifest.far);
  const sameStack =
    near.layers.length === far.layers.length &&
    near.layers.every((l, i) => l.name === far.layers[i].name);
  const mask = horizonMask(
    { near, far: sameStack ? near : far },
    o.siteId,
    o.lat,
    o.lon,
  );
  let missing = 0;
  for (const id of need.keys()) missing += o.stores.get(id)!.missing;
  if (missing > 0)
    throw new Error(`horizon read ${missing} pixels outside the loaded tiles`);
  return {
    mask,
    stats: {
      tilesByLayer,
      fetched: total,
      cached,
      bytes,
      fetchMs: t1 - t0,
      computeMs: now() - t1,
    },
  };
}
