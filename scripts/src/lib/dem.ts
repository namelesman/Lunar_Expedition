/**
 * LOLA digital elevation models used by the offline pipeline.
 *
 * All samplers return heights in meters relative to the 1737.4 km sphere.
 *
 * GlobalDem — CGI Moon Kit "ldem_<ppd>_uint.tif" (svs.gsfc.nasa.gov/4720):
 *   uint16 half-meters relative to 1727.4 km (h = dn * 0.5 - 10000 m),
 *   equirectangular, lon -180 at the left edge, row 0 = 90N. Verified: the DEM
 *   minimum falls in Antoniadi (70.3S 172.5W), the maximum at 5.4N 158.6W.
 *
 * PolarDem — LOLA GDR south polar stereographic "LDEM_<lat>S_<res>M.IMG"
 *   (imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/): int16 LE, h = dn * 0.5 m.
 *   x = rho sin(lon), y = rho cos(lon), rho = 2R tan(pi/4 + lat/2),
 *   col = SAMPLE_PROJECTION_OFFSET + x/MAP_SCALE, row = LINE_PROJECTION_OFFSET - y/MAP_SCALE
 *   (0-based). Orientation checked against ldem_64: RMS 12.8 m over 4000
 *   random points 80.5–86S; the three other sign conventions give > 2.6 km.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fromFile } from "geotiff";
import { MOON_RADIUS_M } from "@lunar/core";

const DEG = Math.PI / 180;

export interface DemSampler {
  readonly name: string;
  /** Height (m) at lat/lon, or NaN when the point is outside the DEM. */
  sample(lat: number, lon: number): number;
}

export class GlobalDem implements DemSampler {
  private constructor(
    readonly name: string,
    private readonly data: Uint16Array,
    readonly width: number,
    readonly height: number,
    readonly ppd: number,
  ) {}

  static async load(path: string): Promise<GlobalDem> {
    const tiff = await fromFile(path);
    const img = await tiff.getImage();
    const width = img.getWidth();
    const height = img.getHeight();
    const ppd = width / 360;
    if (height !== 180 * ppd)
      throw new Error(`unexpected DEM shape ${width}x${height}`);
    const rasters = await img.readRasters({ samples: [0], interleave: true });
    const data = rasters as unknown as Uint16Array;
    if (!(data instanceof Uint16Array))
      throw new Error("expected a uint16 DEM");
    const file = path.split(/[\\/]/).pop() ?? path;
    return new GlobalDem(
      `LOLA ${ppd} px/deg (CGI Moon Kit ${file}, svs.gsfc.nasa.gov/4720)`,
      data,
      width,
      height,
      ppd,
    );
  }

  /** Bilinear, wraps in longitude, clamps in latitude. */
  sample(lat: number, lon: number): number {
    const W = this.width,
      H = this.height,
      ppd = this.ppd;
    const x = ((((lon + 180) % 360) + 360) % 360) * ppd - 0.5;
    let y = (90 - lat) * ppd - 0.5;
    y = Math.min(Math.max(y, 0), H - 1.000001);
    let x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0,
      fy = y - y0;
    x0 = ((x0 % W) + W) % W;
    const x1 = (x0 + 1) % W;
    const y1 = Math.min(y0 + 1, H - 1);
    const d = this.data;
    const v =
      (d[y0 * W + x0] * (1 - fx) + d[y0 * W + x1] * fx) * (1 - fy) +
      (d[y1 * W + x0] * (1 - fx) + d[y1 * W + x1] * fx) * fy;
    return v * 0.5 - 10_000;
  }
}

function lblNumber(lbl: string, key: string): number {
  const m = lbl.match(new RegExp(`^\\s*${key}\\s*=\\s*([-0-9.]+)`, "m"));
  if (!m) throw new Error(`label key ${key} not found`);
  return Number(m[1]);
}

export class PolarDem implements DemSampler {
  private constructor(
    readonly name: string,
    private readonly data: Int16Array,
    readonly size: number,
    readonly scaleM: number,
    readonly center: number,
    readonly maxLat: number,
    private readonly scaling: number,
  ) {}

  /** Loads `<path>.IMG` with its `<path>.LBL`; returns null when the files are absent. */
  static async load(pathNoExt: string): Promise<PolarDem | null> {
    if (!existsSync(`${pathNoExt}.IMG`) || !existsSync(`${pathNoExt}.LBL`))
      return null;
    const lbl = await readFile(`${pathNoExt}.LBL`, "latin1");
    if (
      !/SAMPLE_TYPE\s*=\s*LSB_INTEGER/.test(lbl) ||
      lblNumber(lbl, "SAMPLE_BITS") !== 16
    ) {
      throw new Error(`${pathNoExt}: expected 16-bit LSB integers`);
    }
    if (lblNumber(lbl, "CENTER_LATITUDE") !== -90)
      throw new Error(`${pathNoExt}: not a south polar product`);
    const size = lblNumber(lbl, "LINES");
    if (lblNumber(lbl, "LINE_SAMPLES") !== size)
      throw new Error(`${pathNoExt}: not square`);
    const center = lblNumber(lbl, "LINE_PROJECTION_OFFSET");
    if (lblNumber(lbl, "SAMPLE_PROJECTION_OFFSET") !== center)
      throw new Error(`${pathNoExt}: off-centre`);
    const buf = await readFile(`${pathNoExt}.IMG`);
    if (buf.byteLength !== size * size * 2)
      throw new Error(`${pathNoExt}: size mismatch`);
    // Copy into an aligned buffer (Node Buffers may share a pool with an odd offset).
    const data = new Int16Array(size * size);
    new Uint8Array(data.buffer).set(buf);
    const file = pathNoExt.split(/[\\/]/).pop() ?? pathNoExt;
    const scaleM = lblNumber(lbl, "MAP_SCALE");
    return new PolarDem(
      `LOLA ${file} (${scaleM} m/px polar stereographic, imbrium.mit.edu LOLA GDR)`,
      data,
      size,
      scaleM,
      center,
      lblNumber(lbl, "MAXIMUM_LATITUDE"),
      lblNumber(lbl, "SCALING_FACTOR"),
    );
  }

  sample(lat: number, lon: number): number {
    if (lat > this.maxLat) return NaN;
    const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + (lat * DEG) / 2);
    const col = this.center + (rho * Math.sin(lon * DEG)) / this.scaleM;
    const row = this.center - (rho * Math.cos(lon * DEG)) / this.scaleM;
    const c0 = Math.floor(col),
      r0 = Math.floor(row);
    // Stay one pixel inside the edge (the corners beyond maxLat hold no data).
    if (c0 < 1 || r0 < 1 || c0 >= this.size - 2 || r0 >= this.size - 2)
      return NaN;
    const fc = col - c0,
      fr = row - r0,
      n = this.size,
      d = this.data;
    const v =
      (d[r0 * n + c0] * (1 - fc) + d[r0 * n + c0 + 1] * fc) * (1 - fr) +
      (d[(r0 + 1) * n + c0] * (1 - fc) + d[(r0 + 1) * n + c0 + 1] * fc) * fr;
    return v * this.scaling;
  }
}

/** First sampler (finest first) that covers the point; tracks which one was used. */
export class LayeredDem implements DemSampler {
  readonly used: number[];
  constructor(readonly layers: DemSampler[]) {
    this.used = layers.map(() => 0);
  }
  get name(): string {
    return this.layers.map((l) => l.name).join(" + ");
  }
  sample(lat: number, lon: number): number {
    for (let i = 0; i < this.layers.length; i++) {
      const v = this.layers[i].sample(lat, lon);
      if (!Number.isNaN(v)) {
        this.used[i]++;
        return v;
      }
    }
    return NaN;
  }
  resetUsage(): void {
    this.used.fill(0);
  }
}
