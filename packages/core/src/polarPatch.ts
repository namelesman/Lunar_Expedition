import { latLonToVector3 } from "./coords";
import {
  tileCols,
  tileExists,
  tileRect,
  tileRows,
  type DemManifest,
  type PolarLayerSpec,
} from "./demTiles";
import { polarPixelToLatLon, polarRho, type PixelSource } from "./terrain";
import { MOON_RADIUS_M } from "./types";

/**
 * Polar caps of the 3D Moon rebuilt from LOLA polar DEM tiles.
 *
 * The NASA SVS model is a latitude/longitude mesh simplified for the web, and
 * near the poles it shows a radial "fan" of sliver triangles. The app hides
 * the model poleward of POLAR_GLB_CUT_DEG and draws these caps instead: one
 * vertex per DEM pixel (or every `stride` pixels), heights from LOLA, normals
 * from the same heights. The caps reach POLAR_PATCH_EDGE_DEG, a little
 * equatorward of the cut, so the two surfaces overlap in a thin ring and the
 * depth test hides any step between them.
 */
export const POLAR_PATCH_EDGE_DEG = 80;
export const POLAR_GLB_CUT_DEG = 80.4;

/** DEM layer of each cap (about 950 m per pixel). */
export const POLAR_PATCH_LAYERS = {
  south: "polar-s-960m",
  north: "ldem-16-n",
} as const;

export type Pole = keyof typeof POLAR_PATCH_LAYERS;

export interface PolarPatchMesh {
  pole: Pole;
  layerId: string;
  /** Unit vectors in the scene frame (x = 90°E, y = north, z = lon 0), 3 per vertex. */
  directions: Float32Array;
  /** Surface elevation, m relative to the 1737.4 km sphere, 1 per vertex. */
  heightsM: Float32Array;
  /** Unit surface normals at 1× relief, scene frame, 3 per vertex. */
  normals: Float32Array;
  index: Uint32Array;
  /** Grid spacing on the ground, m (pixel size × stride). */
  spacingM: number;
}

/** Radius (px) of the cap on a polar layer, with a one-cell margin. */
function capRadiusPx(spec: PolarLayerSpec, stride: number): number {
  const edgeLat = spec.pole === "south" ? -POLAR_PATCH_EDGE_DEG : POLAR_PATCH_EDGE_DEG;
  return polarRho(spec, edgeLat) / spec.scaleM + stride + 1;
}

/** Tiles of the layer that the cap reads. */
export function polarPatchTiles(
  manifest: DemManifest,
  pole: Pole,
  stride = 1,
): Map<string, Set<number>> {
  const id = POLAR_PATCH_LAYERS[pole];
  const spec = manifest.layers[id];
  if (!spec || spec.kind !== "polar-stereo" || spec.pole !== pole)
    throw new Error(`DEM manifest has no ${pole} polar layer "${id}"`);
  const r = capRadiusPx(spec, stride) + 1;
  const c = spec.center;
  const set = new Set<number>();
  for (let i = 0; i < tileCols(spec) * tileRows(spec); i++) {
    const t = tileRect(spec, i);
    const dx = Math.max(t.x0 - c, 0, c - (t.x0 + t.w - 1));
    const dy = Math.max(t.y0 - c, 0, c - (t.y0 + t.h - 1));
    if (Math.hypot(dx, dy) <= r && tileExists(spec, i)) set.add(i);
  }
  return new Map([[id, set]]);
}

/**
 * Builds the cap mesh from the layer's pixels (the tiles of polarPatchTiles
 * must be loaded). Throws if a pixel inside the cap is missing.
 */
export function buildPolarPatch(
  spec: PolarLayerSpec,
  pixels: PixelSource,
  stride = 1,
): PolarPatchMesh {
  const pole: Pole = spec.pole;
  const c = Math.round(spec.center);
  const half = Math.ceil(capRadiusPx(spec, stride) / stride);
  const n = 2 * half + 1;
  const count = n * n;
  const R = MOON_RADIUS_M;
  const pos = new Float64Array(count * 3); // metres, for the normals
  const directions = new Float32Array(count * 3);
  const heightsM = new Float32Array(count);
  const inside = new Uint8Array(count);
  const maxPx = spec.size - 1;
  const rCapPx = capRadiusPx(spec, stride);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const col = c + (i - half) * stride;
      const row = c + (j - half) * stride;
      const inCap =
        Math.hypot(col - spec.center, row - spec.center) <= rCapPx &&
        col >= 0 && row >= 0 && col <= maxPx && row <= maxPx;
      let h = 0;
      if (inCap) {
        h = pixels.pixel(col, row) * spec.scale;
        if (!Number.isFinite(h))
          throw new Error(`${spec.id}: no elevation at pixel ${col},${row}`);
        inside[k] = 1;
      }
      const ll = polarPixelToLatLon(spec, col, row);
      const d = latLonToVector3(ll.lat, ll.lon);
      directions[k * 3] = d.x;
      directions[k * 3 + 1] = d.y;
      directions[k * 3 + 2] = d.z;
      heightsM[k] = h;
      pos[k * 3] = d.x * (R + h);
      pos[k * 3 + 1] = d.y * (R + h);
      pos[k * 3 + 2] = d.z * (R + h);
    }
  }

  // Normals: cross product of the central differences along the two grid axes
  // (one-sided at the cap's edge, where the outer neighbour has no height).
  const normals = new Float32Array(count * 3);
  const nb = (k: number, other: number) => (inside[other] ? other : k);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const iL = nb(k, j * n + Math.max(0, i - 1));
      const iR = nb(k, j * n + Math.min(n - 1, i + 1));
      const jU = nb(k, Math.max(0, j - 1) * n + i);
      const jD = nb(k, Math.min(n - 1, j + 1) * n + i);
      if (iL === iR || jU === jD) {
        normals.set(directions.subarray(k * 3, k * 3 + 3), k * 3);
        continue;
      }
      const ax = pos[iR * 3] - pos[iL * 3];
      const ay = pos[iR * 3 + 1] - pos[iL * 3 + 1];
      const az = pos[iR * 3 + 2] - pos[iL * 3 + 2];
      const bx = pos[jU * 3] - pos[jD * 3];
      const by = pos[jU * 3 + 1] - pos[jD * 3 + 1];
      const bz = pos[jU * 3 + 2] - pos[jD * 3 + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      // Point outwards.
      if (nx * directions[k * 3] + ny * directions[k * 3 + 1] + nz * directions[k * 3 + 2] < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      normals[k * 3] = nx / l;
      normals[k * 3 + 1] = ny / l;
      normals[k * 3 + 2] = nz / l;
    }
  }

  // Two triangles per cell whose four corners are in the cap, wound
  // counter-clockwise seen from outside.
  const tris: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i,
        b = a + 1,
        d = a + n,
        e = d + 1;
      if (!(inside[a] && inside[b] && inside[d] && inside[e])) continue;
      tris.push(a, d, b, b, d, e);
    }
  }
  const index = new Uint32Array(tris);
  // Fix the winding once from the first triangle's geometric normal.
  if (index.length >= 3) {
    const [a, b, d] = [index[0], index[1], index[2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[d * 3] - pos[a * 3], vy = pos[d * 3 + 1] - pos[a * 3 + 1], vz = pos[d * 3 + 2] - pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const out = nx * directions[a * 3] + ny * directions[a * 3 + 1] + nz * directions[a * 3 + 2];
    if (out < 0) {
      for (let t = 0; t < index.length; t += 3) {
        const tmp = index[t + 1];
        index[t + 1] = index[t + 2];
        index[t + 2] = tmp;
      }
    }
  }
  return {
    pole,
    layerId: spec.id,
    directions,
    heightsM,
    normals,
    index,
    spacingM: spec.scaleM * stride,
  };
}
