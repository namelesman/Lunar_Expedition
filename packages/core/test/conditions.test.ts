import { describe, expect, it } from "vitest";
import {
  computeConditions,
  formatDuration,
  nextTransition,
  skySeries,
  type HorizonMask,
} from "../src";

const T = Date.UTC(2026, 10, 14, 18, 0, 0);
const DAY = 86_400_000;
const APOLLO_11 = { lat: 0.67416, lon: 23.47314 };
const SOUTH_POLE_SITE = { lat: -89.45, lon: -137.31 };

describe("site conditions over a lunar month", () => {
  const sky = skySeries(T, T + 30 * DAY, 60);

  it("Apollo 11: ~half the month in sunlight, Earth always up", () => {
    const c = computeConditions("apollo-11", APOLLO_11, null, sky);
    expect(c.sunlitFraction).toBeGreaterThan(0.45);
    expect(c.sunlitFraction).toBeLessThan(0.55);
    expect(c.earthVisibleFraction).toBe(1);
    expect(c.maxSunElevationDeg).toBeGreaterThan(60);
    expect(c.sunWindows.length).toBeGreaterThanOrEqual(1);
  });

  it("south pole: Sun always grazes the horizon (|elevation| < 2°)", () => {
    const c = computeConditions("sp", SOUTH_POLE_SITE, null, sky);
    for (const s of c.samples)
      expect(Math.abs(s.sunElevationDeg)).toBeLessThan(2.2);
    // Earth libration: it rises and sets over the month on a smooth sphere.
    expect(c.earthVisibleFraction).toBeGreaterThan(0.2);
    expect(c.earthVisibleFraction).toBeLessThan(0.8);
  });

  it("a terrain mask can put a site in permanent shadow", () => {
    const wall: HorizonMask = {
      siteId: "crater-floor",
      lat: SOUTH_POLE_SITE.lat,
      lon: SOUTH_POLE_SITE.lon,
      observerHeightM: 2,
      siteElevationM: -3000,
      azimuthStepDeg: 1,
      elevationsDeg: new Array(360).fill(5),
      maxDistanceKm: 50,
      demSource: "synthetic",
    };
    const c = computeConditions("crater-floor", SOUTH_POLE_SITE, wall, sky);
    expect(c.sunlitFraction).toBe(0);
    expect(c.sunWindows).toHaveLength(0);
    expect(nextTransition("sun", SOUTH_POLE_SITE, T, wall, 30)).toBeNull();
  });
});

describe("transitions", () => {
  it("finds the Apollo 11 sunrise of 2026-11-15 (Sun at -4.0° at T, rising)", () => {
    const tr = nextTransition("sun", APOLLO_11, T);
    expect(tr?.kind).toBe("rise");
    const hours = (tr!.timeMs - T) / 3_600_000;
    expect(hours).toBeGreaterThan(6);
    expect(hours).toBeLessThan(9);
  });

  it("formats durations", () => {
    expect(formatDuration(3 * DAY + 4 * 3_600_000)).toBe("3 d 4 h");
    expect(formatDuration(5 * 3_600_000 + 12 * 60_000)).toBe("5 h 12 min");
    expect(formatDuration(8 * 60_000)).toBe("8 min");
  });
});

describe("transitionFromSamples", () => {
  it("agrees with bisection within 15 minutes", async () => {
    const {
      transitionFromSamples,
      computeConditions: cc,
      skySeries: ss,
      sunInfo,
    } = await import("../src");
    const sky = ss(T, T + 30 * DAY, 30);
    const c = cc("apollo-11", APOLLO_11, null, sky);
    const now = sunInfo("apollo-11", APOLLO_11, T);
    const fast = transitionFromSamples(
      c.samples,
      "sun",
      T,
      now.sun.visibleFraction,
    );
    const exact = nextTransition("sun", APOLLO_11, T);
    expect(fast?.kind).toBe(exact?.kind);
    expect(Math.abs(fast!.timeMs - exact!.timeMs)).toBeLessThan(15 * 60_000);
  });
});
