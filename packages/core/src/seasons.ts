/**
 * Season-to-season view of a site: the sunlit and Earth-visible shares of each
 * lunation (new Moon to new Moon, ≈ 29.5 days) over the next year. At the
 * poles the Sun's height changes with the Moon's 1.54° axial tilt over the
 * year, and the Earth's with the monthly libration, so the shares change from
 * one lunation to the next; near the equator they barely move.
 */
import * as Astronomy from "astronomy-engine";
import { computeConditions, skySeries } from "./conditions";
import type { MoonSkyState } from "./ephemeris";
import type { HorizonMask, LatLon, TimeWindow } from "./types";

export interface Lunation {
  /** New Moon (epoch ms). */
  startMs: number;
  /** Next new Moon. */
  endMs: number;
}

/** `count` consecutive lunations, the first one containing `fromMs`. */
export function lunationsFrom(fromMs: number, count: number): Lunation[] {
  let t = Astronomy.SearchMoonPhase(0, Astronomy.MakeTime(new Date(fromMs)), -35);
  if (!t) throw new Error("no new Moon found");
  const out: Lunation[] = [];
  for (let i = 0; i < count; i++) {
    const next = Astronomy.SearchMoonPhase(0, t.AddDays(1), 35);
    if (!next) throw new Error("no new Moon found");
    out.push({ startMs: t.date.getTime(), endMs: next.date.getTime() });
    t = next;
  }
  return out;
}

/** Sky states covering the lunations (site-independent; reuse it across sites). */
export function lunationSky(lunations: Lunation[], stepMinutes: number): MoonSkyState[] {
  return skySeries(
    lunations[0].startMs,
    lunations[lunations.length - 1].endMs,
    stepMinutes,
  );
}

export interface LunationSummary extends Lunation {
  sunlitFraction: number;
  earthVisibleFraction: number;
  /** Sun and Earth both visible: power and direct-to-Earth comms at once. */
  bothFraction: number;
  /**
   * Longest night (Sun below the terrain horizon) that overlaps the lunation,
   * whole length even where it runs into the next one (ms). Equal to the
   * whole series when the Sun never rises.
   */
  longestNightMs: number;
  /** Same for the Earth (longest gap in direct-to-Earth comms). */
  longestCommsGapMs: number;
  maxSunElevationDeg: number;
}

/** Gaps between windows over [startMs, endMs]. */
function gaps(ws: TimeWindow[], startMs: number, endMs: number): TimeWindow[] {
  const out: TimeWindow[] = [];
  let cursor = startMs;
  let openStart = true;
  for (const w of ws) {
    if (w.startMs > cursor)
      out.push({ startMs: cursor, endMs: w.startMs, openStart, openEnd: false });
    cursor = Math.max(cursor, w.endMs);
    openStart = false;
  }
  if (endMs > cursor)
    out.push({ startMs: cursor, endMs, openStart, openEnd: true });
  return out;
}

function longestOverlapping(gs: TimeWindow[], l: Lunation): number {
  let best = 0;
  for (const g of gs)
    if (g.startMs < l.endMs && g.endMs > l.startMs)
      best = Math.max(best, g.endMs - g.startMs);
  return best;
}

/** Per-lunation shares at a site, from one sky series spanning all of them. */
export function lunationSummaries(
  siteId: string,
  site: LatLon,
  mask: HorizonMask | null | undefined,
  sky: MoonSkyState[],
  lunations: Lunation[],
): LunationSummary[] {
  const all = computeConditions(siteId, site, mask, sky);
  const nights = gaps(all.sunWindows, all.startMs, all.endMs);
  const comms = gaps(all.earthWindows, all.startMs, all.endMs);
  return lunations.map((l) => {
    let n = 0,
      sun = 0,
      earth = 0,
      both = 0,
      maxEl = -90;
    for (const s of all.samples) {
      if (s.timeMs < l.startMs || s.timeMs >= l.endMs) continue;
      n++;
      const su = s.sunVisibleFraction >= 0.5;
      const eu = s.earthVisibleFraction >= 0.5;
      if (su) sun++;
      if (eu) earth++;
      if (su && eu) both++;
      maxEl = Math.max(maxEl, s.sunElevationDeg);
    }
    const d = Math.max(1, n);
    return {
      ...l,
      sunlitFraction: sun / d,
      earthVisibleFraction: earth / d,
      bothFraction: both / d,
      longestNightMs: longestOverlapping(nights, l),
      longestCommsGapMs: longestOverlapping(comms, l),
      maxSunElevationDeg: maxEl,
    };
  });
}

