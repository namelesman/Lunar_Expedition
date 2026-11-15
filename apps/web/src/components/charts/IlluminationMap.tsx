"use client";

import {
  cellOffsetM,
  illuminationFractions,
  moonSkyState,
  type CellHorizons,
  type Site,
} from "@lunar/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSkySeries } from "@/lib/conditions";
import { fmtLatLon, fmtUtc } from "@/lib/format";
import { useApp } from "@/lib/store";
import { startIllumination } from "@/lib/terrainHorizon";
import { makeCustomSite } from "../ui/CustomSiteForm";

type Mode = "sun" | "earth" | "now";

/**
 * Sequential single-hue ramps for the dark panel: dark (0 %) → light (100 %),
 * lightness strictly increasing. Amber = Sun (power), blue = Earth (comms),
 * the same hues as the rest of the app.
 */
const RAMPS: Record<"sun" | "earth", string[]> = {
  sun: ["#1f1c18", "#4d330d", "#8f560f", "#d18f17", "#fde68a"],
  earth: ["#161b22", "#12365c", "#1b63a3", "#3f9be0", "#c4e8ff"],
};

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 256-entry RGB lookup table of a ramp (evenly spaced stops). */
function rampLut(stops: string[]): Uint8ClampedArray {
  const rgb = stops.map(hexRgb);
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (rgb.length - 1);
    const k = Math.min(rgb.length - 2, Math.floor(f));
    const w = f - k;
    for (let c = 0; c < 3; c++)
      out[i * 3 + c] = rgb[k][c] * (1 - w) + rgb[k + 1][c] * w;
  }
  return out;
}
const LUTS = { sun: rampLut(RAMPS.sun), earth: rampLut(RAMPS.earth) };

/** Hillshade (0–1) of the relief grid, light from the north-west at 45°. */
function hillshade(h: CellHorizons): Float32Array {
  const { n, stepM, heightM: z } = h.relief;
  const out = new Float32Array(n * n);
  const lx = -0.5,
    ly = 0.5,
    lz = Math.SQRT1_2;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const at = (a: number, b: number) =>
        z[Math.min(n - 1, Math.max(0, a)) * n + Math.min(n - 1, Math.max(0, b))];
      const dzdx = (at(i, j + 1) - at(i, j - 1)) / (2 * stepM);
      const dzdy = (at(i - 1, j) - at(i + 1, j)) / (2 * stepM); // row 0 = north
      const len = Math.hypot(dzdx, dzdy, 1);
      out[i * n + j] = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / len);
    }
  }
  return out;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Distance (km) and compass direction of a cell from the site (north at the site). */
function placeOf(h: CellHorizons, idx: number): { km: number; dir: string } {
  const { x, y } = cellOffsetM(h, Math.floor(idx / h.n), idx % h.n);
  const km = Math.hypot(x, y) / 1000;
  const b = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return { km, dir: COMPASS[Math.round(b / 45) % 8] };
}

function placeText(h: CellHorizons, idx: number): string {
  const p = placeOf(h, idx);
  return p.km < 0.25 ? "at the site" : `${p.km.toFixed(1)} km ${p.dir}`;
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** Best cells by value, at least `sepCells` apart, ties to the one nearest the site. */
function topSpots(h: CellHorizons, v: Float32Array, k: number, sepCells = 3) {
  const order = Array.from(v.keys()).sort(
    (a, b) => v[b] - v[a] || placeOf(h, a).km - placeOf(h, b).km,
  );
  const out: number[] = [];
  for (const idx of order) {
    if (out.length === k) break;
    const r = Math.floor(idx / h.n),
      c = idx % h.n;
    if (
      out.every(
        (o) =>
          Math.max(Math.abs(Math.floor(o / h.n) - r), Math.abs((o % h.n) - c)) >=
          sepCells,
      )
    )
      out.push(idx);
  }
  return out;
}

/**
 * Sunlight and Earth-visibility map of the 20 × 20 km around a site,
 * computed on demand in the browser from LOLA tiles.
 */
export function IlluminationMap({ site }: { site: Site }) {
  const state = useApp((s) => s.illumination[site.id]);
  if (!state) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => startIllumination(site)}
          className="w-full rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-xs text-amber-100 hover:bg-amber-400/20"
        >
          Map sunlight &amp; Earth view within 10 km of this site
        </button>
        <p className="text-[10px] text-neutral-500">
          Finds the best-lit and best-connected spots nearby: the terrain
          horizon of 1,681 points (every 500 m), computed in your browser from
          NASA LOLA elevation data (downloads about 2–5 MB, a few seconds).
        </p>
      </div>
    );
  }
  if (state.status === "computing") {
    const label =
      state.phase === "tiles"
        ? state.total > 0
          ? `Downloading LOLA terrain: ${state.done}/${state.total} tiles · ${(state.bytes / 1e6).toFixed(1)} MB`
          : "Finding terrain tiles…"
        : state.phase === "grid"
          ? "Resampling the terrain around the site…"
          : `Computing horizons: ${state.done}/${state.total} rows`;
    const f = state.total > 0 ? state.done / state.total : 0;
    return (
      <div role="status" aria-live="polite" className="space-y-1">
        <p className="text-[11px] text-sky-300/90">{label}</p>
        <div className="h-1 overflow-hidden rounded bg-white/10">
          <div
            className="h-full bg-sky-400/70 transition-[width]"
            style={{ width: `${Math.round(f * 100)}%` }}
          />
        </div>
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="text-[11px] text-amber-300/80" role="status">
        Could not build the map ({state.reason}).{" "}
        <button
          type="button"
          onClick={() => startIllumination(site)}
          className="underline hover:text-amber-200"
        >
          Retry
        </button>
      </p>
    );
  }
  return (
    <ReadyMap
      key={site.id}
      site={site}
      h={state.horizons}
      info={`${state.stats.fetched > 0 ? `${(state.stats.bytes / 1e6).toFixed(1)} MB downloaded` : "terrain already in memory"}, ${(state.ms / 1000).toFixed(1)} s`}
    />
  );
}

function ReadyMap({
  site,
  h,
  info,
}: {
  site: Site;
  h: CellHorizons;
  info: string;
}) {
  const series = useSkySeries();
  const timeMs = useApp((s) => s.timeMs);
  const addCustomSite = useApp((s) => s.addCustomSite);
  const [mode, setMode] = useState<Mode>("sun");
  const [hover, setHover] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  const window30 = useMemo(() => illuminationFractions(h, series), [h, series]);
  const now = useMemo(
    () => (mode === "now" ? illuminationFractions(h, [moonSkyState(timeMs)]) : null),
    [h, mode, timeMs],
  );
  const shade = useMemo(() => hillshade(h), [h]);
  const values =
    mode === "now" && now
      ? now.sun
      : mode === "earth"
        ? window30.earth
        : window30.sun;

  const n = h.n;
  const rn = h.relief.n;
  const k = (rn - 1) / (n - 1); // relief pixels per cell (5)
  const centre = ((n - 1) / 2) * n + (n - 1) / 2;

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(rn, rn);
    const lut = mode === "earth" ? LUTS.earth : LUTS.sun;
    for (let i = 0; i < rn; i++) {
      const v = i / k;
      const r0 = Math.min(n - 2, Math.floor(v)),
        fv = v - r0;
      for (let j = 0; j < rn; j++) {
        const u = j / k;
        const c0 = Math.min(n - 2, Math.floor(u)),
          fu = u - c0;
        const a = r0 * n + c0;
        let f =
          (values[a] * (1 - fu) + values[a + 1] * fu) * (1 - fv) +
          (values[a + n] * (1 - fu) + values[a + n + 1] * fu) * fv;
        // "now" is lit or shadow: a sharp edge along the interpolated boundary.
        if (mode === "now") f = f >= 0.5 ? 1 : 0;
        const li = Math.round(Math.min(1, Math.max(0, f)) * 255) * 3;
        const s = 0.35 + 0.65 * shade[i * rn + j];
        const o = (i * rn + j) * 4;
        img.data[o] = lut[li] * s;
        img.data[o + 1] = lut[li + 1] * s;
        img.data[o + 2] = lut[li + 2] * s;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [values, shade, mode, n, rn, k]);

  const stats = useMemo(() => {
    let min = Infinity,
      max = -Infinity;
    for (const v of values) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return { min, max, spots: topSpots(h, values, 5) };
  }, [h, values]);
  const best = stats.spots[0];
  /** Less than 3 points between the best and worst cells: no "best spot". */
  const uniform = stats.max - stats.min < 0.03;

  const toCell = (e: React.MouseEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - b.left) / b.width) * rn;
    const y = ((e.clientY - b.top) / b.height) * rn;
    const c = Math.min(n - 1, Math.max(0, Math.round((x - 0.5) / k)));
    const r = Math.min(n - 1, Math.max(0, Math.round((y - 0.5) / k)));
    return r * n + c;
  };
  const open = (idx: number) =>
    addCustomSite(makeCustomSite(h.cellLat[idx], h.cellLon[idx]));

  const what =
    mode === "earth"
      ? "Earth above the terrain horizon"
      : mode === "now"
        ? "Sunlit now"
        : "Sunlit";
  const summary =
    mode === "now"
      ? `${fmtUtc(timeMs)}: ${pct(values.reduce((s, v) => s + v, 0) / values.length)} of the map is sunlit; the site is ${values[centre] >= 0.5 ? "in sunlight" : "in shadow"}.`
      : uniform
        ? `${what} ${pct(stats.min)}–${pct(stats.max)} of the time everywhere on the map: the terrain makes little difference here.`
        : `${what} ${pct(values[centre])} of the time at the site. Best within 10 km: ${pct(values[best])}, ${placeText(h, best)} (${Math.round(h.cellElevationM[best])} m). Range on the map ${pct(stats.min)}–${pct(stats.max)}.`;

  const px = (idx: number) => ({
    x: (idx % n) * k + 0.5,
    y: Math.floor(idx / n) * k + 0.5,
  });
  const hv = hover === null ? null : px(hover);
  const bp = px(best);

  return (
    <div className="space-y-2">
      <div
        className="flex overflow-hidden rounded border border-white/15 text-[11px]"
        role="radiogroup"
        aria-label="Map layer"
      >
        {(
          [
            ["sun", "Sun · 30 days"],
            ["earth", "Earth · 30 days"],
            ["now", "Shadows now"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`flex-1 px-2 py-1 ${mode === m ? "bg-white/15 text-neutral-50" : "text-neutral-400 hover:bg-white/5"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="relative mx-auto aspect-square w-full max-w-[320px]">
        <canvas
          ref={canvas}
          width={rn}
          height={rn}
          className="absolute inset-0 h-full w-full rounded"
          role="img"
          aria-label={`${summary} Map of 20 by 20 km centred on ${site.name}, north up.`}
        />
        <svg
          viewBox={`0 0 ${rn} ${rn}`}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onPointerMove={(e) => setHover(toCell(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => open(toCell(e))}
          aria-hidden
        >
          {mode !== "now" && !uniform && best !== centre && (
            <circle
              cx={bp.x}
              cy={bp.y}
              r={4.5}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1}
              strokeDasharray="2 1.5"
            />
          )}
          <circle
            cx={rn / 2}
            cy={rn / 2}
            r={4}
            fill="none"
            stroke="#0d0d0f"
            strokeWidth={2.5}
          />
          <circle
            cx={rn / 2}
            cy={rn / 2}
            r={4}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.2}
          />
          {hv && (
            <rect
              x={hv.x - k / 2}
              y={hv.y - k / 2}
              width={k}
              height={k}
              fill="none"
              stroke="#ffffff"
              strokeWidth={0.8}
            />
          )}
          <g fontSize={8} fill="#e5e5e5" stroke="#0d0d0f" strokeWidth={2} paintOrder="stroke">
            <text x={6} y={12}>
              N ↑
            </text>
            <line x1={6} x2={6 + 5000 / h.relief.stepM} y1={rn - 8} y2={rn - 8} stroke="#e5e5e5" strokeWidth={1.5} />
            <text x={6} y={rn - 12}>
              5 km
            </text>
          </g>
        </svg>
      </div>

      {mode === "now" ? (
        <div className="flex items-center justify-center gap-3 text-[10px] text-neutral-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: RAMPS.sun[4] }} />
            Sunlit
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-white/20" style={{ background: RAMPS.sun[0] }} />
            In shadow
          </span>
        </div>
      ) : (
        <div className="mx-auto max-w-[320px]">
          <div
            className="h-2 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${RAMPS[mode].join(", ")})`,
            }}
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-neutral-500">
            <span>0%</span>
            <span>{mode === "earth" ? "Earth visible, share of 30 days" : "Sunlit, share of 30 days"}</span>
            <span>100%</span>
          </div>
        </div>
      )}

      <p className="min-h-[2.5em] text-[11px] text-neutral-300" aria-live="polite">
        {hover !== null ? (
          <>
            <span className="font-medium text-neutral-100">{placeText(h, hover)}</span>
            {" · "}Sun {pct(window30.sun[hover])} · Earth {pct(window30.earth[hover])}
            {" · "}
            {Math.round(h.cellElevationM[hover])} m{" · "}
            <span className="font-mono text-neutral-500">
              {fmtLatLon(h.cellLat[hover], h.cellLon[hover])}
            </span>
            <span className="text-neutral-500"> — click to open it as a custom point</span>
          </>
        ) : (
          summary
        )}
      </p>

      {mode !== "now" && !uniform && (
        <details className="text-[11px] text-neutral-300">
          <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">
            Best {stats.spots.length} spots ({mode === "earth" ? "Earth" : "Sun"}, at least 1.5 km apart)
          </summary>
          <table className="mt-1 w-full text-left">
            <thead className="text-[10px] text-neutral-500">
              <tr>
                <th className="font-normal">Where</th>
                <th className="font-normal">Sun</th>
                <th className="font-normal">Earth</th>
                <th className="font-normal">Elev.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stats.spots.map((idx) => (
                <tr key={idx}>
                  <td>{placeText(h, idx)}</td>
                  <td>{pct(window30.sun[idx])}</td>
                  <td>{pct(window30.earth[idx])}</td>
                  <td>{Math.round(h.cellElevationM[idx])} m</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => open(idx)}
                      className="rounded border border-white/15 px-1.5 hover:bg-white/10"
                      aria-label={`Open the spot ${placeText(h, idx)} as a custom point`}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <p className="text-[10px] leading-relaxed text-neutral-500">
        {mode === "now"
          ? "Cells whose terrain horizon is above the Sun's centre at the selected time; play the clock to watch the shadows move."
          : `Share of ${fmtUtc(window30.startMs, false)} → ${fmtUtc(window30.endMs, false)} (${window30.samples} samples, every 30 min) with the ${mode === "earth" ? "Earth's" : "Sun's"} centre above the local terrain horizon.`}{" "}
        Observer {h.observerHeightM} m above ground at each 500 m cell; horizon to{" "}
        300 km from {h.demSource}. Shading shows relief (light from the NW), north
        at the site is up. Computed in your browser: {info}.
      </p>
    </div>
  );
}
