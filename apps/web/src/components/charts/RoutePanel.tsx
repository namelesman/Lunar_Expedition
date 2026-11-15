"use client";

import { formatDuration, type Route, type RouteResult } from "@lunar/core";
import { Fragment } from "react";
import { useWidth } from "@/lib/useSize";

/** Diagonal hatch of impassable ground (light and dark lines: visible on any colour). */
export const STEEP_HATCH_CSS =
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.85) 0 1px, rgba(0,0,0,0.7) 1px 2px, transparent 2px 4px)";

const pct = (f: number) => `${Math.round(f * 100)}%`;
const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

export function RouteControls({
  maxSlope,
  setMaxSlope,
  preferSun,
  setPreferSun,
}: {
  maxSlope: number;
  setMaxSlope: (v: number) => void;
  preferSun: boolean;
  setPreferSun: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-300">
      <label className="flex items-center gap-2">
        Max slope
        <input
          type="range"
          min={5}
          max={30}
          step={1}
          value={maxSlope}
          onChange={(e) => setMaxSlope(Number(e.target.value))}
          aria-valuetext={`${maxSlope} degrees`}
          className="w-24 accent-neutral-300"
        />
        <span className="w-6 tabular-nums">{maxSlope}°</span>
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={preferSun}
          onChange={(e) => setPreferSun(e.target.checked)}
          className="accent-amber-400"
        />
        Prefer sunlit ground
      </label>
    </div>
  );
}

/** One sentence for a route that could not be planned, or for no destination yet. */
export function routeProblem(result: RouteResult | null, maxSlope: number): string | null {
  if (!result) return "Click the map (or “Route” in the best spots) to choose a destination; the route starts at the site.";
  if (result.ok) return null;
  switch (result.reason) {
    case "blocked-goal":
      return `That spot is steeper than ${maxSlope}°: pick another, or raise the slope limit.`;
    case "blocked-start":
      return `The ground at the site is steeper than ${maxSlope}°: raise the slope limit to leave it.`;
    case "no-path":
      return `No route under ${maxSlope}° inside the map: steeper ground cuts the site off from that spot.`;
    case "out-of-grid":
      return "That spot is outside the map.";
  }
}

export function RouteStats({ route }: { route: Route }) {
  const rows: [string, string][] = [
    ["Distance", `${dist(route.lengthM)} (${dist(route.straightM)} in a straight line)`],
    [
      "Driving time",
      `${formatDuration(route.estimatedTimeH * 3_600_000)} at ${route.params.roverSpeedMps} m/s`,
    ],
    ["Steepest ground", `${route.maxSlopeDeg.toFixed(0)}°`],
    ["Climb / descent", `${Math.round(route.climbM)} m / ${Math.round(route.descentM)} m`],
  ];
  if (route.meanSunShare !== null)
    rows.push(["Sunlit along the way", `${pct(route.meanSunShare)} of the 30 days`]);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-neutral-500">{k}</dt>
          <dd className="tabular-nums text-neutral-200">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Elevation along the route; hovering a point marks it on the map. */
export function RouteProfile({
  route,
  probe,
  onProbe,
}: {
  route: Route;
  probe: number | null;
  onProbe: (i: number | null) => void;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(300);
  const H = 78,
    L = 44,
    R = 8,
    T = 8,
    B = 16;
  const pts = route.points;
  const total = Math.max(1, route.lengthM);
  let dMin = Infinity,
    dMax = -Infinity;
  for (const p of pts) {
    dMin = Math.min(dMin, p.elevationM);
    dMax = Math.max(dMax, p.elevationM);
  }
  const pad = Math.max(10, (dMax - dMin) * 0.08);
  const lo = dMin - pad,
    hi = dMax + pad;
  const x = (d: number) => L + (d / total) * (w - L - R);
  const y = (e: number) => T + (1 - (e - lo) / (hi - lo)) * (H - T - B);
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${x(p.distanceM).toFixed(1)},${y(p.elevationM).toFixed(1)}`)
    .join("");
  const area = `${line}L${x(total).toFixed(1)},${H - B}L${L},${H - B}Z`;
  const p = probe !== null && probe < pts.length ? pts[probe] : null;
  const twoLabels = y(dMin) - y(dMax) >= 11;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const d = ((e.clientX - b.left - L) / (w - L - R)) * total;
    let best = 0;
    for (let i = 1; i < pts.length; i++)
      if (Math.abs(pts[i].distanceM - d) < Math.abs(pts[best].distanceM - d)) best = i;
    onProbe(best);
  };

  return (
    <div ref={ref}>
      <svg
        width={w}
        height={H}
        className="block cursor-crosshair touch-none select-none"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => onProbe(null)}
        role="img"
        aria-label={`Elevation along the route: ${Math.round(pts[0].elevationM)} m at the site, ${Math.round(pts[pts.length - 1].elevationM)} m at the destination, between ${Math.round(dMin)} and ${Math.round(dMax)} m over ${dist(route.lengthM)}.`}
      >
        <path d={area} fill="rgba(255,255,255,0.07)" />
        <line x1={L} x2={w - R} y1={H - B} y2={H - B} stroke="#3f3f46" />
        <path d={line} fill="none" stroke="#e5e5e5" strokeWidth={2} strokeLinejoin="round" />
        <g fontSize={9} fill="#a3a3a3">
          <text x={L - 5} y={y(dMax) + 3} textAnchor="end">
            {Math.round(dMax)} m
          </text>
          {twoLabels && (
            <text x={L - 5} y={y(dMin) + 3} textAnchor="end">
              {Math.round(dMin)} m
            </text>
          )}
          <text x={L} y={H - 4}>
            site
          </text>
          <text x={w - R} y={H - 4} textAnchor="end">
            {dist(route.lengthM)}
          </text>
        </g>
        {p && (
          <>
            <line
              x1={x(p.distanceM)}
              x2={x(p.distanceM)}
              y1={T}
              y2={H - B}
              stroke="#a1a1aa"
              strokeDasharray="2 2"
            />
            <circle
              cx={x(p.distanceM)}
              cy={y(p.elevationM)}
              r={4}
              fill="#e5e5e5"
              stroke="#0d0d0f"
              strokeWidth={2}
            />
          </>
        )}
      </svg>
      <p className="min-h-[1.4em] text-[10px] text-neutral-400" aria-live="polite">
        {p
          ? `${dist(p.distanceM)} · ${Math.round(p.elevationM)} m · slope ${p.slopeDeg.toFixed(0)}°${p.sunShare !== null ? ` · sunlit ${pct(p.sunShare)}` : ""}`
          : "Hover or touch the profile to follow the route on the map."}
      </p>
    </div>
  );
}
