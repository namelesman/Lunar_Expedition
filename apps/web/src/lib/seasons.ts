"use client";

import {
  lunationSky,
  lunationSummaries,
  lunationsFrom,
  type HorizonMask,
  type Lunation,
  type LunationSummary,
  type MoonSkyState,
  type Site,
} from "@lunar/core";
import { useEffect, useState } from "react";
import { useApp } from "./store";

/** Lunations shown: the one of the analysis window and the next 12. */
export const SEASON_LUNATIONS = 13;
/** 2-hour samples: ≈ 4,400 sky states for the year, ≈ 150 ms once. */
const SEASON_STEP_MINUTES = 120;
const DAY_MS = 86_400_000;

/** Year of sky states, shared by every site; the last two kept. */
const years = new Map<number, { lunations: Lunation[]; sky: MoonSkyState[] }>();

function yearFrom(fromMs: number) {
  const first = lunationsFrom(fromMs, 1)[0];
  let y = years.get(first.startMs);
  if (!y) {
    const lunations = lunationsFrom(first.startMs + DAY_MS, SEASON_LUNATIONS);
    y = { lunations, sky: lunationSky(lunations, SEASON_STEP_MINUTES) };
    years.set(first.startMs, y);
    const oldest = years.keys().next().value;
    if (years.size > 2 && oldest !== undefined) years.delete(oldest);
  }
  return y;
}

/**
 * Sunlit / Earth-visible shares of each of the next 13 lunations at a site,
 * starting with the lunation of the analysis window's first day. Computed off
 * the first paint (a few hundred ms once, then a few tens per site).
 */
export function useSeasons(
  site: Site,
  mask: HorizonMask | null,
): LunationSummary[] | null {
  const windowStartMs = useApp((s) => s.windowStartMs);
  const [result, setResult] = useState<{
    key: string;
    rows: LunationSummary[];
  } | null>(null);
  const key = `${site.id}|${mask?.demSource ?? "sphere"}|${mask?.siteElevationM ?? ""}|${windowStartMs}`;
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      const { lunations, sky } = yearFrom(windowStartMs + DAY_MS);
      const rows = lunationSummaries(site.id, site, mask, sky, lunations);
      if (alive) setResult({ key, rows });
    }, 30);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [site, mask, windowStartMs, key]);
  return result?.key === key ? result.rows : null;
}
