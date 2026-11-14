/**
 * Calibrate the NASA SVS GLB (Moon_NASA_LRO_8k_Topo.glb, SVS #14959) against LOLA.
 *
 * Least squares on the random vertex sample written by optimize-glb.ts
 * (u, v, radius in scene units):
 *
 *   r_glb = c0 + c2·sin²(lat) + c4·sin⁴(lat) + unitsPerKm · h_km
 *
 * The sin² / sin⁴ terms absorb the model's slightly prolate base shape (a plain
 * r = a + b·h fit only reaches corr ≈ 0.5). Baked exaggeration =
 * unitsPerKm · 1737.4 / c0. The result feeds SVS_GLB_FIT in
 * apps/web/src/lib/svsGlb.ts, which the vertex shader uses to rebuild the
 * surface with a true, user-controlled exaggeration (1× = real relief).
 *
 * Usage: npm run glb:fit -w @lunar/scripts [-- sample.csv ldem_16_uint.tif]
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MOON_RADIUS_KM, uvToLatLon } from "@lunar/core";
import { GlobalDem } from "./lib/dem";
import { ROOT, SVS_4720 } from "./lib/paths";

const MAX_ABS_LAT = 88; // the UV sphere is pinched at the poles

/** Solve the normal equations (AᵀA)x = Aᵀb by Gaussian elimination with pivoting. */
function leastSquares(rows: number[][], b: number[]): number[] {
  const n = rows[0].length;
  const M = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  rows.forEach((a, k) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) M[i][j] += a[i] * a[j];
      M[i][n] += a[i] * b[k];
    }
  });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function correlation(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n,
    my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

async function main(): Promise<void> {
  const samplePath =
    process.argv[2] ?? join(ROOT, "data/cache/glb-radius-sample.csv");
  const demPath = process.argv[3] ?? join(SVS_4720, "ldem_16_uint.tif");
  const dem = await GlobalDem.load(demPath);
  const lines = (await readFile(samplePath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .slice(1);

  const A: number[][] = [];
  const r: number[] = [];
  const hKm: number[] = [];
  for (const line of lines) {
    const [u, v, radius] = line.split(",").map(Number);
    const { lat, lon } = uvToLatLon(u, v);
    if (Math.abs(lat) >= MAX_ABS_LAT) continue;
    const h = dem.sample(lat, lon) / 1000;
    const s2 = Math.sin((lat * Math.PI) / 180) ** 2;
    A.push([1, s2, s2 * s2, h]);
    r.push(radius);
    hKm.push(h);
  }
  const [c0, c2, c4, unitsPerKm] = leastSquares(A, r);
  const pred = A.map(
    (a) => c0 * a[0] + c2 * a[1] + c4 * a[2] + unitsPerKm * a[3],
  );
  const rmsUnits = Math.sqrt(
    pred.reduce((s, p, i) => s + (p - r[i]) ** 2, 0) / r.length,
  );
  // Correlation of the relief part: radius minus the fitted base shape vs LOLA height.
  const relief = r.map((x, i) => x - (c0 + c2 * A[i][1] + c4 * A[i][2]));
  console.log(
    JSON.stringify(
      {
        samples: r.length,
        c0,
        c2,
        c4,
        unitsPerKm,
        bakedExaggeration: (unitsPerKm * MOON_RADIUS_KM) / c0,
        corr: correlation(hKm, relief),
        rmsKm: rmsUnits / unitsPerKm,
      },
      null,
      2,
    ),
  );
}

await main();
