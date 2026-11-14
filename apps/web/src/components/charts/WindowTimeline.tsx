"use client";

import { horizonElevationAt, type TimeWindow } from "@lunar/core";
import { useMemo, useState } from "react";
import type { SiteAnalysis } from "@/lib/conditions";
import { COLORS, fmtDeg, fmtUtc } from "@/lib/format";
import { useApp } from "@/lib/store";
import { useWidth } from "@/lib/useSize";

const DAY = 86_400_000;
const PAD = { l: 64, r: 8, t: 6, b: 18 };

/**
 * 30-day operational timeline for one site: Sunlight / Earth in view / both,
 * plus the Sun's elevation against the terrain horizon at the Sun's azimuth.
 * Click anywhere to move the simulation clock there.
 */
export function WindowTimeline({
  a,
  showElevation = true,
  compact = false,
}: {
  a: SiteAnalysis;
  showElevation?: boolean;
  compact?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const timeMs = useApp((s) => s.timeMs);
  const setTimeMs = useApp((s) => s.setTimeMs);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const c = a.conditions;
  const rowH = compact ? 10 : 14;
  const rows = [
    { label: "Sunlight", windows: c.sunWindows, color: COLORS.sun },
    { label: "Earth (DTE)", windows: c.earthWindows, color: COLORS.earth },
    { label: "Both", windows: c.bothWindows, color: COLORS.both },
  ];
  const elevH = showElevation ? (compact ? 48 : 72) : 0;
  const h =
    PAD.t + rows.length * (rowH + 4) + (showElevation ? elevH + 8 : 0) + PAD.b;
  const w = width;
  const x = (t: number) =>
    PAD.l + ((t - c.startMs) / (c.endMs - c.startMs)) * (w - PAD.l - PAD.r);

  const elev = useMemo(() => {
    if (!showElevation) return null;
    let lo = Infinity;
    let hi = -Infinity;
    const sun: [number, number][] = [];
    const hor: [number, number][] = [];
    for (const s of c.samples) {
      const hz = horizonElevationAt(a.mask, s.sunAzimuthDeg);
      sun.push([s.timeMs, s.sunElevationDeg]);
      hor.push([s.timeMs, hz]);
      lo = Math.min(lo, s.sunElevationDeg, hz);
      hi = Math.max(hi, s.sunElevationDeg, hz);
    }
    lo = Math.floor(lo - 0.5);
    hi = Math.ceil(hi + 0.5);
    return { sun, hor, lo, hi };
  }, [c, a.mask, showElevation]);

  const top = PAD.t + rows.length * (rowH + 4) + 8;
  const ey = (v: number) =>
    elev ? top + (1 - (v - elev.lo) / (elev.hi - elev.lo)) * elevH : 0;
  const line = (pts: [number, number][]) =>
    pts.map(([t, v]) => `${x(t).toFixed(1)},${ey(v).toFixed(1)}`).join(" ");

  const days: number[] = [];
  const firstMidnight = Math.ceil(c.startMs / DAY) * DAY;
  for (let t = firstMidnight; t <= c.endMs; t += DAY) days.push(t);

  const hoverSample =
    hoverT !== null
      ? c.samples[Math.round((hoverT - c.startMs) / (c.stepMinutes * 60_000))]
      : undefined;

  const inWin = (ws: TimeWindow[], t: number) =>
    ws.some((wi) => wi.startMs <= t && t <= wi.endMs);

  return (
    <div ref={ref} className="w-full">
      <svg
        width={w}
        height={h}
        className="block cursor-crosshair select-none"
        role="img"
        aria-label={`30-day windows for ${a.site.name}: sunlit ${Math.round(c.sunlitFraction * 100)}% of the time, Earth visible ${Math.round(c.earthVisibleFraction * 100)}%.`}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const t =
            c.startMs +
            ((e.clientX - r.left - PAD.l) / (w - PAD.l - PAD.r)) *
              (c.endMs - c.startMs);
          setHoverT(t >= c.startMs && t <= c.endMs ? t : null);
        }}
        onMouseLeave={() => setHoverT(null)}
        onClick={() => hoverT !== null && setTimeMs(hoverT)}
      >
        {days.map((t, i) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={PAD.t}
              y2={h - PAD.b}
              stroke={COLORS.grid}
            />
            {i % (w < 420 ? 7 : 5) === 0 && (
              <text x={x(t) + 2} y={h - 5} fontSize={9} fill="#a1a1aa">
                {fmtUtc(t, false).slice(5)}
              </text>
            )}
          </g>
        ))}
        {rows.map((r, i) => {
          const yy = PAD.t + i * (rowH + 4);
          return (
            <g key={r.label}>
              <text
                x={PAD.l - 6}
                y={yy + rowH / 2 + 3}
                textAnchor="end"
                fontSize={10}
                fill="#d4d4d8"
              >
                {r.label}
              </text>
              <rect
                x={PAD.l}
                y={yy}
                width={w - PAD.l - PAD.r}
                height={rowH}
                fill="#18181b"
                rx={2}
              />
              {r.windows.map((wi) => (
                <rect
                  key={wi.startMs}
                  x={x(wi.startMs) + 1}
                  y={yy}
                  width={Math.max(1.5, x(wi.endMs) - x(wi.startMs) - 2)}
                  height={rowH}
                  rx={2}
                  fill={r.color}
                />
              ))}
            </g>
          );
        })}
        {elev && (
          <g>
            <text
              x={PAD.l - 6}
              y={top + 10}
              textAnchor="end"
              fontSize={10}
              fill="#d4d4d8"
            >
              Sun elev.
            </text>
            <text
              x={PAD.l - 6}
              y={top + 22}
              textAnchor="end"
              fontSize={9}
              fill="#a1a1aa"
            >
              {elev.hi}° / {elev.lo}°
            </text>
            <rect
              x={PAD.l}
              y={top}
              width={w - PAD.l - PAD.r}
              height={elevH}
              fill={COLORS.surface}
            />
            {elev.lo < 0 && elev.hi > 0 && (
              <line
                x1={PAD.l}
                x2={w - PAD.r}
                y1={ey(0)}
                y2={ey(0)}
                stroke="#52525b"
                strokeDasharray="3 3"
              />
            )}
            <polyline
              points={line(elev.hor)}
              fill="none"
              stroke={COLORS.terrainEdge}
              strokeWidth={1.25}
              strokeDasharray="4 2"
            />
            <polyline
              points={line(elev.sun)}
              fill="none"
              stroke={COLORS.sun}
              strokeWidth={2}
            />
          </g>
        )}
        <line
          x1={x(timeMs)}
          x2={x(timeMs)}
          y1={PAD.t - 2}
          y2={h - PAD.b}
          stroke="#fafafa"
          strokeWidth={1.5}
        />
        {hoverT !== null && hoverSample && (
          <g pointerEvents="none">
            <line
              x1={x(hoverT)}
              x2={x(hoverT)}
              y1={PAD.t}
              y2={h - PAD.b}
              stroke="#fafafa"
              strokeOpacity={0.4}
            />
            <foreignObject
              x={Math.min(x(hoverT) + 8, w - 178)}
              y={PAD.t}
              width={170}
              height={78}
            >
              <div className="rounded border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[10px] leading-4 text-zinc-200">
                <div className="font-medium">{fmtUtc(hoverT)}</div>
                <div>
                  Sun {fmtDeg(hoverSample.sunElevationDeg)} ·{" "}
                  {inWin(c.sunWindows, hoverT) ? "lit" : "dark"}
                </div>
                <div>
                  Earth {fmtDeg(hoverSample.earthElevationDeg)} ·{" "}
                  {inWin(c.earthWindows, hoverT) ? "in view" : "hidden"}
                </div>
                <div className="text-zinc-400">click to jump here</div>
              </div>
            </foreignObject>
          </g>
        )}
      </svg>
      {showElevation && !compact && (
        <p className="mt-1 text-[10px] text-neutral-500">
          Solid: Sun elevation · dashed: terrain horizon in the Sun&apos;s
          direction. Sunlight = Sun centre above the terrain.
        </p>
      )}
    </div>
  );
}
