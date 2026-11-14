/**
 * Small albedo fixture used by packages/core tests (coords.test.ts).
 *
 * Downsamples the CGI Moon Kit LROC color preview (lroc_color_2k.jpg, SVS #4720,
 * equirectangular, centred on lon 0) to a 720×360 8-bit grayscale raw file
 * (0.5° per pixel, row 0 = 90N, col 0 = 180W).
 *
 * Usage: npm run data:fixtures [-- path/to/lroc_color_2k.jpg]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { CORE_FIXTURES, SVS_4720 } from "./lib/paths";

const src = process.argv[2] ?? join(SVS_4720, "lroc_color_2k.jpg");
const out = join(CORE_FIXTURES, "lroc-albedo-720x360.u8");

const { data, info } = await sharp(src)
  .greyscale()
  .resize(720, 360, { fit: "fill", kernel: "linear" })
  .raw()
  .toBuffer({ resolveWithObject: true });
if (info.channels !== 1 || data.length !== 720 * 360)
  throw new Error(`unexpected output ${JSON.stringify(info)}`);
await mkdir(CORE_FIXTURES, { recursive: true });
await writeFile(out, data);
console.log(`wrote ${out} (${data.length} bytes)`);
