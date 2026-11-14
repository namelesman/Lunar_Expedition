import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { Site } from "@lunar/core";

export const ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);
export const RAW = join(ROOT, "data/raw");
export const SVS_4720 = join(RAW, "svs-4720");
export const LOLA_POLAR = join(RAW, "lola-polar");
export const WEB_DATA = join(ROOT, "apps/web/public/data");
export const CORE_FIXTURES = join(ROOT, "packages/core/test/fixtures");

/** Sites with official coordinates (entries marked `todo` are skipped). */
export function loadSites(): Site[] {
  const all = JSON.parse(
    readFileSync(join(ROOT, "data/sites.json"), "utf8"),
  ) as Site[];
  return all.filter((s) => !s.todo);
}

export function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
