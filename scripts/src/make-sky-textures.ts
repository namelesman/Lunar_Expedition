/**
 * Background textures for the 3D scene.
 *
 * 1. Star map — NASA SVS "Deep Star Maps 2020" (svs.gsfc.nasa.gov/4851),
 *    starmap_2020_8k.exr (celestial J2000 coordinates, linear HDR, 8192×4096).
 *    We average 2×2 blocks in linear light (keeps star fluxes), tone-map with
 *    1 − exp(−k·v), encode sRGB and write a 4096×2048 JPEG in a canonical
 *    layout: u = RA / 360° (RA 0 at the left edge, increasing to the right),
 *    row 0 = Dec +90°. The shader in SkyLayer.tsx relies on that layout.
 *
 *    The source layout is not assumed: we try every combination of RA
 *    direction, RA origin and vertical flip, and keep the one that puts star
 *    cores at the J2000 positions of the 19 brightest stars. The script aborts
 *    if no single layout fits.
 *
 * 2. Earth — NASA Blue Marble Next Generation, December 2004, topography and
 *    bathymetry (NASA Earth Observatory / Reto Stöckli), 5400×2700, lon −180 at
 *    the left, north up → 2048×1024 JPEG (small, committed).
 *
 * Inputs (git-ignored, see README): data/raw/svs-4851/starmap_2020_8k.exr,
 * data/raw/bmng/world.topo.bathy.200412.3x5400x2700.jpg
 * Outputs: apps/web/public/sky/starmap-4k.jpg (served from the assets project),
 *          apps/web/public/textures/earth-bmng-2k.jpg (committed)
 *
 * Usage: npm run sky:textures -w @lunar/scripts [-- --exposure 2.5]
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { DataUtils, FloatType, HalfFloatType } from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { RAW, ROOT } from "./lib/paths";

const STAR_SRC = join(RAW, "svs-4851/starmap_2020_8k.exr");
const EARTH_SRC = join(RAW, "bmng/world.topo.bathy.200412.3x5400x2700.jpg");
const STAR_OUT = join(ROOT, "apps/web/public/sky/starmap-4k.jpg");
const EARTH_OUT = join(ROOT, "apps/web/public/textures/earth-bmng-2k.jpg");

/** The 19 brightest stars, J2000 RA/Dec (Hipparcos), degrees. */
const BRIGHT_STARS: [string, number, number][] = [
  ["Sirius", 101.287, -16.716],
  ["Canopus", 95.988, -52.696],
  ["Arcturus", 213.915, 19.182],
  ["Vega", 279.234, 38.784],
  ["Capella", 79.172, 45.998],
  ["Rigel", 78.634, -8.202],
  ["Procyon", 114.825, 5.225],
  ["Betelgeuse", 88.793, 7.407],
  ["Achernar", 24.429, -57.237],
  ["Hadar", 210.956, -60.373],
  ["Altair", 297.696, 8.868],
  ["Acrux", 186.65, -63.099],
  ["Aldebaran", 68.98, 16.509],
  ["Antares", 247.352, -26.432],
  ["Spica", 201.298, -11.161],
  ["Pollux", 116.329, 28.026],
  ["Fomalhaut", 344.413, -29.622],
  ["Deneb", 310.358, 45.28],
  ["Regulus", 152.093, 11.967],
];
/** Star-core threshold on 4k luminance (p99.99 of the map is ~0.7; diffuse sky p99 ~0.03). */
const SATURATED = 0.5;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

interface Layout {
  raLeftToRight: boolean;
  raAtLeftEdge: number; // RA (deg) at u = 0
  topIsNorth: boolean;
}

function raDecToPixel(
  l: Layout,
  ra: number,
  dec: number,
  w: number,
  h: number,
): [number, number] {
  let du = (ra - l.raAtLeftEdge) / 360;
  if (!l.raLeftToRight) du = -du;
  du = ((du % 1) + 1) % 1;
  const v = l.topIsNorth ? (90 - dec) / 180 : (dec + 90) / 180;
  return [du * w, v * h];
}

async function starMap(exposure: number): Promise<void> {
  const buf = await readFile(STAR_SRC);
  const loader = new EXRLoader().setDataType(HalfFloatType);
  const tex = loader.parse(
    buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer,
  );
  const W = tex.width ?? 0,
    H = tex.height ?? 0;
  if (!W || !H) throw new Error("EXR without dimensions");
  const src = tex.data as Uint16Array;
  const channels = src.length / (W * H);
  console.log(
    `star map ${W}x${H}, ${channels} channels, type ${tex.type === FloatType ? "float" : "half"}`,
  );

  // 2×2 linear average → 4k, luminance for the self-check.
  const w = W / 2,
    h = H / 2;
  const lin = new Float32Array(w * h * 3);
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (const [dy, dx] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ]) {
        const i = ((2 * y + dy) * W + (2 * x + dx)) * channels;
        r += DataUtils.fromHalfFloat(src[i]);
        g += DataUtils.fromHalfFloat(src[i + 1]);
        b += DataUtils.fromHalfFloat(src[i + 2]);
      }
      const o = y * w + x;
      lin[3 * o] = r / 4;
      lin[3 * o + 1] = g / 4;
      lin[3 * o + 2] = b / 4;
      lum[o] =
        0.2126 * lin[3 * o] + 0.7152 * lin[3 * o + 1] + 0.0722 * lin[3 * o + 2];
    }
  }

  {
    const sorted = Float32Array.from(lum).sort();
    const q = (f: number) =>
      sorted[Math.floor(f * (sorted.length - 1))].toExponential(2);
    console.log(
      `4k luminance p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} p99.9 ${q(0.999)} p99.99 ${q(0.9999)} max ${q(1)}`,
    );
  }
  // Orientation self-check by pattern matching: for every candidate layout,
  // look for a saturated star core within 0.3° of each of the 19 brightest
  // stars. The map clips pixels at 1.0 and the diffuse Milky Way dominates any
  // integrated flux, so "find the brightest pixel" is not reliable; a whole
  // constellation of known positions is.
  const radius = Math.ceil((0.3 * w) / 360);
  const hasCoreNear = (px: number, py: number) => {
    for (let dy = -radius; dy <= radius; dy++) {
      const y = Math.floor(py) + dy;
      if (y < 0 || y >= h) continue;
      // Rows near the poles are stretched horizontally by 1/cos(dec).
      const rx = Math.ceil(
        radius / Math.max(0.05, Math.cos(((y + 0.5) / h - 0.5) * Math.PI)),
      );
      for (let dx = -rx; dx <= rx; dx++) {
        const x = (((Math.floor(px) + dx) % w) + w) % w;
        if (lum[y * w + x] >= SATURATED) return true;
      }
    }
    return false;
  };
  const scored: { l: Layout; hits: number }[] = [];
  for (const raLeftToRight of [true, false]) {
    for (const raAtLeftEdge of [0, 90, 180, 270]) {
      for (const topIsNorth of [true, false]) {
        const l = { raLeftToRight, raAtLeftEdge, topIsNorth };
        const hits = BRIGHT_STARS.filter(([, ra, dec]) =>
          hasCoreNear(...raDecToPixel(l, ra, dec, w, h)),
        ).length;
        scored.push({ l, hits });
      }
    }
  }
  scored.sort((a, b) => b.hits - a.hits);
  for (const { l, hits } of scored.slice(0, 4)) {
    console.log(
      `  layout ${JSON.stringify(l)}: ${hits}/${BRIGHT_STARS.length} bright stars matched`,
    );
  }
  const [best, second] = scored;
  if (
    best.hits < BRIGHT_STARS.length - 2 ||
    second.hits > BRIGHT_STARS.length / 2
  ) {
    throw new Error(
      "orientation check failed: no layout matches the bright stars unambiguously",
    );
  }
  const L = best.l;
  console.log(`source layout: ${JSON.stringify(L)}`);

  // Resample into the canonical layout (exact pixel permutation: no interpolation).
  const out = new Uint8Array(w * h * 3);
  const enc = (v: number) => {
    const t = 1 - Math.exp(-exposure * v);
    const s = t <= 0.0031308 ? 12.92 * t : 1.055 * t ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(s * 255)));
  };
  const shift = Math.round(((L.raAtLeftEdge % 360) / 360) * w);
  for (let y = 0; y < h; y++) {
    const sy = L.topIsNorth ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      // canonical column x covers RA = (x + 0.5)/w·360
      let sx = L.raLeftToRight ? x - shift : w - 1 - x + shift;
      sx = ((sx % w) + w) % w;
      const si = 3 * (sy * w + sx),
        oi = 3 * (y * w + x);
      out[oi] = enc(lin[si]);
      out[oi + 1] = enc(lin[si + 1]);
      out[oi + 2] = enc(lin[si + 2]);
    }
  }
  const pct = (q: number) => {
    const s = Float32Array.from(lum).sort();
    return s[Math.floor(q * (s.length - 1))];
  };
  console.log(
    `luminance p50 ${pct(0.5).toExponential(2)}  p99 ${pct(0.99).toExponential(2)}  p99.99 ${pct(0.9999).toExponential(2)}  exposure ${exposure}`,
  );
  await mkdir(join(ROOT, "apps/web/public/sky"), { recursive: true });
  const info = await sharp(out, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(STAR_OUT);
  console.log(`wrote ${STAR_OUT} (${(info.size / 1e6).toFixed(2)} MB)`);
}

async function earth(): Promise<void> {
  const info = await sharp(EARTH_SRC)
    .resize(2048, 1024, { fit: "fill", kernel: "lanczos3" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(EARTH_OUT);
  console.log(`wrote ${EARTH_OUT} (${(info.size / 1024).toFixed(0)} KB)`);
}

await earth();
await starMap(arg("exposure", 2.5));
