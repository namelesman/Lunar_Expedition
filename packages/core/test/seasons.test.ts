import { describe, expect, it } from "vitest";
import {
  computeConditions,
  lunationSky,
  lunationSummaries,
  lunationsFrom,
} from "../src";

const DAY = 86_400_000;
const from = Date.UTC(2026, 10, 14);
const lunations = lunationsFrom(from, 13);
const sky = lunationSky(lunations, 120);

describe("lunations", () => {
  it("are contiguous synodic months, the first one containing the start", () => {
    expect(lunations).toHaveLength(13);
    expect(lunations[0].startMs).toBeLessThanOrEqual(from);
    expect(lunations[0].endMs).toBeGreaterThan(from);
    for (let i = 0; i < lunations.length; i++) {
      const days = (lunations[i].endMs - lunations[i].startMs) / DAY;
      expect(days).toBeGreaterThan(29.2);
      expect(days).toBeLessThan(29.9);
      if (i > 0) expect(lunations[i].startMs).toBe(lunations[i - 1].endMs);
    }
    // New Moon of 2026-11-09 (USNO: 07:02 UTC).
    expect(Math.abs(lunations[0].startMs - Date.UTC(2026, 10, 9, 7, 2))).toBeLessThan(
      10 * 60_000,
    );
  });
});

describe("lunation summaries", () => {
  it("equatorial site: about half of every lunation sunlit, nights of ~15 days", () => {
    const rows = lunationSummaries("eq", { lat: 0, lon: 0 }, null, sky, lunations);
    for (const r of rows) {
      expect(r.sunlitFraction).toBeGreaterThan(0.46);
      expect(r.sunlitFraction).toBeLessThan(0.54);
      expect(r.earthVisibleFraction).toBe(1);
      expect(r.longestNightMs / DAY).toBeGreaterThan(14);
      expect(r.longestNightMs / DAY).toBeLessThan(15.5);
    }
  });

  it("south pole: the Moon's axial tilt makes polar summer and winter", () => {
    const rows = lunationSummaries(
      "sp",
      { lat: -89.67, lon: 129.78 },
      null,
      sky,
      lunations,
    );
    const f = rows.map((r) => r.sunlitFraction);
    expect(Math.max(...f)).toBeGreaterThan(0.9);
    expect(Math.min(...f)).toBeLessThan(0.1);
  });

  it("each share equals computeConditions over the same samples", () => {
    const site = { lat: -85.4, lon: 31.4 };
    const rows = lunationSummaries("t", site, null, sky, lunations);
    for (const [i, l] of lunations.entries()) {
      const sub = sky.filter((k) => k.timeMs >= l.startMs && k.timeMs < l.endMs);
      const c = computeConditions("t", site, null, sub);
      expect(rows[i].sunlitFraction).toBeCloseTo(c.sunlitFraction, 10);
      expect(rows[i].earthVisibleFraction).toBeCloseTo(c.earthVisibleFraction, 10);
    }
  });
});
