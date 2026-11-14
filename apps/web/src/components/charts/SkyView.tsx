"use client";

import type { HorizonMask } from "@lunar/core";
import { horizonElevationAt } from "@lunar/core";
import { useMemo, useState } from "react";
import type { SiteAnalysis } from "@/lib/conditions";
import { COLORS, fmtDeg } from "@/lib/format";
import { useWidth } from "@/lib/useSize";

type Mode = "horizon" | "sky";

const PAD = { l: 34, r: 8, t: 10, b: 22 };
const CARDINALS: [number, string][] = [
  [0, "N"],
  [45, "NE"],
  [90, "E"],
  [135, "SE"],
  [180, "S"],
  [225, "SW"],
  [270, "W"],
  [315, "NW"],
  [360, "N"],
];

function horizonRange(mask: HorizonMask | null): [number, number] {
  if (!mask) return [-3, 10];
  const lo = Math.min(...mask.elevationsDeg);
  const hi = Math.max(...mask.elevationsDeg);
  return [Math.floor(Math.min(-3, lo - 1)), Math.ceil(Math.max(10, hi + 4))];
}

/**
 * 360° panorama of the local sky: terrain horizon from LOLA, the Sun and Earth
 * now, and their tracks over the 30-day window. "Horizon" mode zooms on the
 * horizon band (where south-pole action happens); "Full sky" goes to the zenith.
 */
export function SkyView({
  a,
  height = 190,
  compact = false,
}: {
  a: SiteAnalysis;
  height?: number;
  compact?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const polar = Math.abs(a.site.lat) > 60;
  const [mode, setMode] = useState<Mode>(polar ? "horizon" : "sky");
  const [hoverAz, setHoverAz] = useState<number | null>(null);

  const [yMin, yMax] =
    mode === "horizon"
      ? horizonRange(a.mask)
      : [Math.min(-5, horizonRange(a.mask)[0]), 90];
  const w = width;
  const h = height;
  const x = (az: number) => PAD.l + (az / 360) * (w - PAD.l - PAD.r);
  const y = (el: number) =>
    PAD.t +
    (1 - (Math.min(yMax, Math.max(yMin, el)) - yMin) / (yMax - yMin)) *
      (h - PAD.t - PAD.b);

  const terrainPath = useMemo(() => {
    const m = a.mask;
    const pts: string[] = [];
    const n = m ? m.elevationsDeg.length : 2;
    for (let i = 0; i <= n; i++) {
      const az = m ? (i * m.azimuthStepDeg) % 360 : (i / n) * 360;
      const el = m ? m.elevationsDeg[i % n] : 0;
      pts.push(`${x(i === n ? 360 : az).toFixed(1)},${y(el).toFixed(1)}`);
    }
    return `M${x(0)},${h - PAD.b} L${pts.join(" L")} L${x(360)},${h - PAD.b} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.mask, w, h, yMin, yMax]);

  const tracks = useMemo(() => {
    const build = (
      azKey: "sunAzimuthDeg" | "earthAzimuthDeg",
      elKey: "sunElevationDeg" | "earthElevationDeg",
    ) => {
      const segs: string[] = [];
      let cur: string[] = [];
      let prevAz: number | null = null;
      for (const s of a.conditions.samples) {
        const az = s[azKey];
        if (prevAz !== null && Math.abs(az - prevAz) > 180) {
          if (cur.length > 1) segs.push(cur.join(" "));
          cur = [];
        }
        cur.push(`${x(az).toFixed(1)},${y(s[elKey]).toFixed(1)}`);
        prevAz = az;
      }
      if (cur.length > 1) segs.push(cur.join(" "));
      return segs;
    };
    return {
      sun: build("sunAzimuthDeg", "sunElevationDeg"),
      earth: build("earthAzimuthDeg", "earthElevationDeg"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.conditions, w, h, yMin, yMax]);

  const yTicks = useMemo(() => {
    const span = yMax - yMin;
    const step = span > 60 ? 15 : span > 25 ? 5 : span > 12 ? 2 : 1;
    const out: number[] = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step)
      out.push(v);
    return out;
  }, [yMin, yMax]);

  const bodies = [
    { key: "earth", label: "Earth", p: a.now.earth, color: COLORS.earth },
    { key: "sun", label: "Sun", p: a.now.sun, color: COLORS.sun },
  ] as const;

  const summary = `Sky at ${a.site.name}: Sun at azimuth ${a.now.sun.azimuthDeg.toFixed(0)}°, elevation ${a.now.sun.elevationDeg.toFixed(1)}°; Earth at azimuth ${a.now.earth.azimuthDeg.toFixed(0)}°, elevation ${a.now.earth.elevationDeg.toFixed(1)}°.`;

  return (
    <div ref={ref} className="w-full">
      {!compact && (
        <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-400">
          <div className="flex items-center gap-3">
            <LegendDot color={COLORS.sun} label="Sun" />
            <LegendDot color={COLORS.earth} label="Earth" />
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-3 rounded-sm"
                style={{ background: COLORS.terrain }}
              />
              Terrain (LOLA)
            </span>
            <span className="text-neutral-500">lines: next 30 days</span>
          </div>
          <div className="flex overflow-hidden rounded border border-white/10">
            {(["horizon", "sky"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 ${mode === m ? "bg-white/15 text-neutral-100" : "hover:bg-white/5"}`}
              >
                {m === "horizon" ? "Horizon" : "Full sky"}
              </button>
            ))}
          </div>
        </div>
      )}
      <svg
        width={w}
        height={h}
        role="img"
        aria-label={summary}
        className="block select-none"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const az = ((e.clientX - r.left - PAD.l) / (w - PAD.l - PAD.r)) * 360;
          setHoverAz(az >= 0 && az <= 360 ? az : null);
        }}
        onMouseLeave={() => setHoverAz(null)}
      >
        <rect
          x={PAD.l}
          y={PAD.t}
          width={w - PAD.l - PAD.r}
          height={h - PAD.t - PAD.b}
          fill={COLORS.surface}
        />
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={w - PAD.r}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? "#52525b" : COLORS.grid}
              strokeWidth={1}
              strokeDasharray={v === 0 ? "3 3" : undefined}
            />
            <text
              x={PAD.l - 4}
              y={y(v) + 3}
              textAnchor="end"
              fontSize={9}
              fill="#a1a1aa"
            >
              {v}°
            </text>
          </g>
        ))}
        {CARDINALS.map(([az, l]) => (
          <text
            key={az}
            x={x(az)}
            y={h - 6}
            textAnchor="middle"
            fontSize={9}
            fill="#a1a1aa"
          >
            {l}
          </text>
        ))}
        {tracks.sun.map((d, i) => (
          <polyline
            key={`s${i}`}
            points={d}
            fill="none"
            stroke={COLORS.sun}
            strokeOpacity={0.45}
            strokeWidth={1.25}
          />
        ))}
        {tracks.earth.map((d, i) => (
          <polyline
            key={`e${i}`}
            points={d}
            fill="none"
            stroke={COLORS.earth}
            strokeOpacity={0.45}
            strokeWidth={1.25}
          />
        ))}
        <path
          d={terrainPath}
          fill={COLORS.terrain}
          stroke={COLORS.terrainEdge}
          strokeWidth={1}
        />
        {bodies.map(({ key, label, p, color }) => {
          const clipped = p.elevationDeg > yMax || p.elevationDeg < yMin;
          const cx = x(p.azimuthDeg);
          const cy = y(p.elevationDeg);
          const r = Math.max(
            5,
            (p.angularRadiusDeg / (yMax - yMin)) * (h - PAD.t - PAD.b),
          );
          return (
            <g key={key}>
              <circle cx={cx} cy={cy} r={r + 2} fill={COLORS.surface} />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={color}
                fillOpacity={p.visibleFraction > 0 ? 1 : 0.35}
              />
              <text
                x={cx + r + 4 > w - 60 ? cx - r - 4 : cx + r + 4}
                y={cy + (key === "sun" ? -4 : 10)}
                textAnchor={cx + r + 4 > w - 60 ? "end" : "start"}
                fontSize={10}
                fill="#e4e4e7"
              >
                {label} {fmtDeg(p.elevationDeg)}
                {clipped ? (p.elevationDeg > yMax ? " ↑" : " ↓") : ""}
              </text>
            </g>
          );
        })}
        {hoverAz !== null && (
          <g pointerEvents="none">
            <line
              x1={x(hoverAz)}
              x2={x(hoverAz)}
              y1={PAD.t}
              y2={h - PAD.b}
              stroke="#e4e4e7"
              strokeOpacity={0.5}
            />
            <rect
              x={Math.min(x(hoverAz) + 6, w - 118)}
              y={PAD.t + 2}
              width={112}
              height={30}
              rx={3}
              fill="#18181b"
              stroke="#3f3f46"
            />
            <text
              x={Math.min(x(hoverAz) + 12, w - 112)}
              y={PAD.t + 14}
              fontSize={10}
              fill="#e4e4e7"
            >
              Azimuth {hoverAz.toFixed(0)}°
            </text>
            <text
              x={Math.min(x(hoverAz) + 12, w - 112)}
              y={PAD.t + 27}
              fontSize={10}
              fill="#a1a1aa"
            >
              Terrain {fmtDeg(horizonElevationAt(a.mask, hoverAz), 2)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
