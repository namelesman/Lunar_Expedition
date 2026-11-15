import type { MoonSkyState } from "./ephemeris";
import type { ConditionSample, SiteConditions } from "./types";

/** Total solar irradiance at 1 AU, W/m² (Kopp & Lean 2011, SORCE/TIM). */
export const SOLAR_CONSTANT_WM2 = 1361;
/** Astronomical unit, km (IAU 2012). */
export const AU_KM = 149_597_870.7;

const DEG = Math.PI / 180;
const HOUR = 3_600_000;

/** Sunlight per m² perpendicular to the Sun's rays at this Sun distance (no atmosphere on the Moon). */
export function solarIrradianceWm2(sunDistanceKm: number = AU_KM): number {
  const r = sunDistanceKm / AU_KM;
  return SOLAR_CONSTANT_WM2 / (r * r);
}

/**
 * Irradiance on two simple panels at one sample, W/m², before cell efficiency.
 * Partly hidden Sun counts by the share of its disk above the terrain horizon.
 * - vertical: a vertical panel turned to face the Sun's azimuth (the usual
 *   layout for polar landers): cos(elevation).
 * - horizontal: a flat panel on level ground: sin(elevation), zero below 0°.
 */
export function panelIrradianceWm2(
  s: Pick<ConditionSample, "sunElevationDeg" | "sunVisibleFraction">,
  sunDistanceKm?: number,
): { vertical: number; horizontal: number } {
  const f = Math.max(0, Math.min(1, s.sunVisibleFraction));
  if (f === 0) return { vertical: 0, horizontal: 0 };
  const e = s.sunElevationDeg * DEG;
  const i = solarIrradianceWm2(sunDistanceKm) * f;
  return { vertical: i * Math.cos(e), horizontal: i * Math.max(0, Math.sin(e)) };
}

export interface SolarEnergy {
  /** Mean irradiance over the whole range (night included), W/m². */
  verticalMeanWm2: number;
  horizontalMeanWm2: number;
  /** Energy reaching 1 m² over the range, Wh/m² (before cell efficiency). */
  verticalWhPerM2: number;
  horizontalWhPerM2: number;
  /** Highest irradiance reached, W/m². */
  verticalPeakWm2: number;
  horizontalPeakWm2: number;
  hours: number;
}

/**
 * Solar energy reaching a panel at the site over the conditions' range.
 * Pass the sky series the conditions were computed from to account for the
 * Sun's distance (±3.4 % over a year); without it, 1 AU is assumed.
 */
export function solarEnergy(
  c: SiteConditions,
  sky?: MoonSkyState[],
): SolarEnergy {
  const n = c.samples.length;
  const useSky = sky && sky.length === n;
  let v = 0;
  let h = 0;
  let vPeak = 0;
  let hPeak = 0;
  for (let k = 0; k < n; k++) {
    const p = panelIrradianceWm2(
      c.samples[k],
      useSky ? sky[k].sunDistanceKm : undefined,
    );
    v += p.vertical;
    h += p.horizontal;
    if (p.vertical > vPeak) vPeak = p.vertical;
    if (p.horizontal > hPeak) hPeak = p.horizontal;
  }
  const hours = (c.endMs - c.startMs) / HOUR;
  const vMean = n ? v / n : 0;
  const hMean = n ? h / n : 0;
  return {
    verticalMeanWm2: vMean,
    horizontalMeanWm2: hMean,
    verticalWhPerM2: vMean * hours,
    horizontalWhPerM2: hMean * hours,
    verticalPeakWm2: vPeak,
    horizontalPeakWm2: hPeak,
    hours,
  };
}
