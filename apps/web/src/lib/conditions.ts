"use client";

import {
  computeConditions,
  longestGapMs,
  skySeries,
  sunInfo,
  transitionFromSamples,
  type HorizonMask,
  type Site,
  type SiteConditions,
  type SunInfo,
  type Transition,
} from "@lunar/core";
import type { MoonSkyState } from "@lunar/core";
import { useEffect, useMemo, useState } from "react";
import { useApp, WINDOW_DAYS } from "./store";

export const SAMPLE_MINUTES = 30;
const DAY_MS = 86_400_000;

let horizonsPromise: Promise<Record<string, HorizonMask>> | null = null;

/** Terrain horizon masks for the curated sites (scripts/horizons.py → public/data/horizons.json). */
export function useHorizons(): Record<string, HorizonMask> | null {
  const [data, setData] = useState<Record<string, HorizonMask> | null>(null);
  useEffect(() => {
    horizonsPromise ??= fetch("/data/horizons.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    let alive = true;
    horizonsPromise.then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** Sky states for the current 30-day window (shared by every site). */
export function useSkySeries(): MoonSkyState[] {
  const windowStartMs = useApp((s) => s.windowStartMs);
  return useMemo(
    () =>
      skySeries(
        windowStartMs,
        windowStartMs + WINDOW_DAYS * DAY_MS,
        SAMPLE_MINUTES,
      ),
    [windowStartMs],
  );
}

export interface SiteAnalysis {
  site: Site;
  mask: HorizonMask | null;
  conditions: SiteConditions;
  now: SunInfo;
  nextSun: Transition | null;
  nextEarth: Transition | null;
  longestNightMs: number;
  longestCommsGapMs: number;
}

export function analyzeSite(
  site: Site,
  mask: HorizonMask | null,
  series: MoonSkyState[],
  conditions: SiteConditions | undefined,
  timeMs: number,
): SiteAnalysis {
  const c = conditions ?? computeConditions(site.id, site, mask, series);
  const now = sunInfo(site.id, site, timeMs, mask);
  return {
    site,
    mask,
    conditions: c,
    now,
    nextSun: transitionFromSamples(
      c.samples,
      "sun",
      timeMs,
      now.sun.visibleFraction,
    ),
    nextEarth: transitionFromSamples(
      c.samples,
      "earth",
      timeMs,
      now.earth.visibleFraction,
    ),
    longestNightMs: longestGapMs(c.sunWindows, c.startMs, c.endMs),
    longestCommsGapMs: longestGapMs(c.earthWindows, c.startMs, c.endMs),
  };
}

/** Full analysis for one site at the current simulation time. */
export function useSiteAnalysis(site: Site | undefined): SiteAnalysis | null {
  const horizons = useHorizons();
  const series = useSkySeries();
  const timeMs = useApp((s) => s.timeMs);
  const mask = site ? (horizons?.[site.id] ?? null) : null;
  const conditions = useMemo(
    () =>
      site && horizons
        ? computeConditions(site.id, site, mask, series)
        : undefined,
    [site, mask, series, horizons],
  );
  return useMemo(
    () =>
      site && conditions
        ? analyzeSite(site, mask, series, conditions, timeMs)
        : null,
    [site, mask, series, conditions, timeMs],
  );
}
