/**
 * Loaders for the LOLA digital elevation models used by the offline pipeline.
 * The sampling math lives in @lunar/core (terrain.ts) and is shared with the
 * browser, which reads the same rasters as tiles (scripts/src/dem-tiles.ts).
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
import {
  arrayPixels,
  EquirectDem,
  PolarStereoDem,
  type EquirectGrid,
  type PolarGrid,
} from "@lunar/core";

export { LayeredDem, type DemSampler } from "@lunar/core";

export class GlobalDem extends EquirectDem {
  private constructor(
    name: string,
    grid: EquirectGrid,
    readonly data: Uint16Array,
    readonly file: string,
  ) {
    super(name, grid, arrayPixels(data, grid.width));
  }

  get width(): number {
    return this.grid.width;
  }
  get height(): number {
    return this.grid.height;
  }
  get ppd(): number {
    return this.grid.ppd;
  }

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
      { width, height, ppd, scale: 0.5, offset: -10_000 },
      data,
      file,
    );
  }
}

function lblNumber(lbl: string, key: string): number {
  const m = lbl.match(new RegExp(`^\\s*${key}\\s*=\\s*([-0-9.]+)`, "m"));
  if (!m) throw new Error(`label key ${key} not found`);
  return Number(m[1]);
}

export class PolarDem extends PolarStereoDem {
  private constructor(
    name: string,
    grid: PolarGrid,
    readonly data: Int16Array,
    readonly file: string,
  ) {
    super(name, grid, arrayPixels(data, grid.size));
  }

  get size(): number {
    return this.grid.size;
  }
  get scaleM(): number {
    return this.grid.scaleM;
  }
  get center(): number {
    return this.grid.center;
  }
  get maxLat(): number {
    return this.grid.edgeLat;
  }

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
      {
        pole: "south",
        size,
        center,
        scaleM,
        edgeLat: lblNumber(lbl, "MAXIMUM_LATITUDE"),
        scale: lblNumber(lbl, "SCALING_FACTOR"),
      },
      data,
      file,
    );
  }
}
