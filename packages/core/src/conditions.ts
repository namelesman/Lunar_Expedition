import { bodyPositionAt, moonSkyState, type MoonSkyState } from "./ephemeris";
import type {
  Body,
  ConditionSample,
  HorizonMask,
  LatLon,
  SiteConditions,
  TimeWindow,
} from "./types";

const MIN = 60_000;
const HOUR = 3_600_000;

/** A body counts as "visible" when at least half of its disk is above the terrain horizon. */
export const VISIBLE_THRESHOLD = 0.5;

/** Sky states for a time range (site-independent; reuse it across sites). */
export function skySeries(
  startMs: number,
  endMs: number,
  stepMinutes: number,
): MoonSkyState[] {
  const out: MoonSkyState[] = [];
  const step = stepMinutes * MIN;
  for (let t = startMs; t <= endMs + 1; t += step) out.push(moonSkyState(t));
  return out;
}

export function sampleAt(
  site: LatLon,
  sky: MoonSkyState,
  mask?: HorizonMask | null,
): ConditionSample {
  const s = bodyPositionAt("sun", site, sky, mask);
  const e = bodyPositionAt("earth", site, sky, mask);
  return {
    timeMs: sky.timeMs,
    sunAzimuthDeg: s.azimuthDeg,
    sunElevationDeg: s.elevationDeg,
    sunVisibleFraction: s.visibleFraction,
    earthAzimuthDeg: e.azimuthDeg,
    earthElevationDeg: e.elevationDeg,
    earthVisibleFraction: e.visibleFraction,
  };
}

function windowsFrom(
  samples: ConditionSample[],
  pred: (s: ConditionSample) => boolean,
  stepMs: number,
): TimeWindow[] {
  const out: TimeWindow[] = [];
  let start: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const on = pred(samples[i]);
    if (on && start === null) start = i;
    if ((!on || i === samples.length - 1) && start !== null) {
      const endIdx = on ? i : i - 1;
      out.push({
        startMs: samples[start].timeMs,
        endMs: samples[endIdx].timeMs + (on ? 0 : stepMs / 2),
        openStart: start === 0,
        openEnd: on && i === samples.length - 1,
      });
      start = null;
    }
  }
  return out;
}

const sunUp = (s: ConditionSample) => s.sunVisibleFraction >= VISIBLE_THRESHOLD;
const earthUp = (s: ConditionSample) =>
  s.earthVisibleFraction >= VISIBLE_THRESHOLD;

export function computeConditions(
  siteId: string,
  site: LatLon,
  mask: HorizonMask | null | undefined,
  sky: MoonSkyState[],
): SiteConditions {
  const samples = sky.map((k) => sampleAt(site, k, mask));
  const stepMs = sky.length > 1 ? sky[1].timeMs - sky[0].timeMs : HOUR;
  const n = Math.max(1, samples.length);
  return {
    siteId,
    startMs: sky[0]?.timeMs ?? 0,
    endMs: sky[sky.length - 1]?.timeMs ?? 0,
    stepMinutes: stepMs / MIN,
    samples,
    sunWindows: windowsFrom(samples, sunUp, stepMs),
    earthWindows: windowsFrom(samples, earthUp, stepMs),
    bothWindows: windowsFrom(samples, (s) => sunUp(s) && earthUp(s), stepMs),
    sunlitFraction: samples.filter(sunUp).length / n,
    earthVisibleFraction: samples.filter(earthUp).length / n,
    maxSunElevationDeg: samples.reduce(
      (m, s) => Math.max(m, s.sunElevationDeg),
      -90,
    ),
  };
}

export interface Transition {
  body: Body;
  /** "set" = goes below the terrain horizon, "rise" = comes above it. */
  kind: "rise" | "set";
  timeMs: number;
}

function visibleAt(
  body: Body,
  site: LatLon,
  t: number,
  mask?: HorizonMask | null,
): boolean {
  return (
    bodyPositionAt(body, site, moonSkyState(t), mask).visibleFraction >=
    VISIBLE_THRESHOLD
  );
}

/**
 * Next rise or set of `body` after `fromMs` (searching up to `horizonDays`),
 * located by coarse stepping then bisection to ~1 minute.
 * Returns null when the state never changes in the search range
 * (e.g. permanently shadowed, or Earth always below the horizon).
 */
export function nextTransition(
  body: Body,
  site: LatLon,
  fromMs: number,
  mask?: HorizonMask | null,
  horizonDays = 35,
  coarseMinutes = 60,
): Transition | null {
  const step = coarseMinutes * MIN;
  const initial = visibleAt(body, site, fromMs, mask);
  let a = fromMs;
  const limit = fromMs + horizonDays * 24 * HOUR;
  for (let b = fromMs + step; b <= limit; b += step) {
    if (visibleAt(body, site, b, mask) !== initial) {
      let lo = a;
      let hi = b;
      while (hi - lo > MIN) {
        const mid = (lo + hi) / 2;
        if (visibleAt(body, site, mid, mask) === initial) lo = mid;
        else hi = mid;
      }
      return { body, kind: initial ? "set" : "rise", timeMs: hi };
    }
    a = b;
  }
  return null;
}

/** Window containing `t`, if any. */
export function windowAt(
  windows: TimeWindow[],
  t: number,
): TimeWindow | undefined {
  return windows.find((w) => w.startMs <= t && t <= w.endMs);
}

/** "3 d 4 h", "5 h 12 min", "8 min". */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(Math.abs(ms) / MIN);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/**
 * Next rise/set of `body` after `fromMs`, read from precomputed samples and
 * linearly interpolated on (visibleFraction − 0.5). Cheap enough to run every
 * animation frame; accurate to a few minutes with 30-min samples.
 * `currentFraction` is the exact visible fraction at `fromMs`.
 */
export function transitionFromSamples(
  samples: ConditionSample[],
  body: Body,
  fromMs: number,
  currentFraction: number,
): Transition | null {
  const key = body === "sun" ? "sunVisibleFraction" : "earthVisibleFraction";
  const initial = currentFraction >= VISIBLE_THRESHOLD;
  let prevT = fromMs;
  let prevF = currentFraction;
  for (const s of samples) {
    if (s.timeMs <= fromMs) continue;
    const f = s[key];
    if (f >= VISIBLE_THRESHOLD !== initial) {
      const a = prevF - VISIBLE_THRESHOLD;
      const b = f - VISIBLE_THRESHOLD;
      const w = a === b ? 0.5 : a / (a - b);
      return {
        body,
        kind: initial ? "set" : "rise",
        timeMs: prevT + (s.timeMs - prevT) * Math.min(1, Math.max(0, w)),
      };
    }
    prevT = s.timeMs;
    prevF = f;
  }
  return null;
}

/** Longest continuous interval without the condition (e.g. longest night), ms. */
export function longestGapMs(
  windows: TimeWindow[],
  startMs: number,
  endMs: number,
): number {
  let cursor = startMs;
  let best = 0;
  for (const w of windows) {
    best = Math.max(best, w.startMs - cursor);
    cursor = Math.max(cursor, w.endMs);
  }
  return Math.max(best, endMs - cursor);
}
