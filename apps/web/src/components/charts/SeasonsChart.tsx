"use client";

import { formatDuration, type LunationSummary } from "@lunar/core";
import { useState } from "react";
import type { SiteAnalysis } from "@/lib/conditions";
import { COLORS, fmtUtc } from "@/lib/format";
import { useSeasons } from "@/lib/seasons";
import { useApp } from "@/lib/store";
import { useWidth } from "@/lib/useSize";

const PAD = { l: 64, r: 8, t: 4, b: 16 };
const ROW_H = 46;
const ROW_GAP = 10;
const DAY = 86_400_000;
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** Month (and year for January / the first column) of a lunation's midpoint. */
function monthOf(l: LunationSummary, withYear = false): string {
  const d = new Date((l.startMs + l.endMs) / 2);
  const m = MONTHS[d.getUTCMonth()];
  return withYear ? `${m} ${d.getUTCFullYear()}` : m;
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** Bar with rounded top corners, anchored to the baseline. */
function bar(x: number, base: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(2, w / 2, h);
  const top = base - h;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

function nightText(ms: number, l: LunationSummary[]): string {
  const span = l[l.length - 1].endMs - l[0].startMs;
  return ms >= span - DAY ? "no sunrise all year" : formatDuration(ms);
}

/**
 * Sunlit and Earth-visible share of each lunation (new Moon to new Moon) over
 * the next year: polar seasons from the Moon's 1.54° tilt and the monthly
 * libration. Click a column to move the 30-day analysis window there.
 */
export function SeasonsChart({ a }: { a: SiteAnalysis }) {
  const rows = useSeasons(a.site, a.mask);
  // One element for every state: useWidth observes the element of the first render.
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="w-full space-y-1">
      {rows ? (
        <Chart a={a} rows={rows} w={width} />
      ) : (
        <p className="text-[11px] text-neutral-500" role="status">
          Computing the next 12 lunations…
        </p>
      )}
    </div>
  );
}

function Chart({
  a,
  rows,
  w,
}: {
  a: SiteAnalysis;
  rows: LunationSummary[];
  w: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const timeMs = useApp((s) => s.timeMs);
  const jumpTo = useApp((s) => s.jumpTo);

  const n = rows.length;
  const bw = (w - PAD.l - PAD.r) / n;
  const barW = Math.max(2, Math.min(18, bw - 4));
  const h = PAD.t + 2 * ROW_H + ROW_GAP + PAD.b;
  const series = [
    { label: "Sunlight", key: "sunlitFraction", color: COLORS.sun },
    { label: "Earth (DTE)", key: "earthVisibleFraction", color: COLORS.earth },
  ] as const;
  const current = rows.findIndex((r) => r.startMs <= timeMs && timeMs < r.endMs);

  const sun = rows.map((r) => r.sunlitFraction);
  const earth = rows.map((r) => r.earthVisibleFraction);
  const iMax = sun.indexOf(Math.max(...sun));
  const iMin = sun.indexOf(Math.min(...sun));
  const night = rows.reduce((m, r, i) => (r.longestNightMs > rows[m].longestNightMs ? i : m), 0);
  const sunSpread = sun[iMax] - sun[iMin];
  const earthSpread = Math.max(...earth) - Math.min(...earth);
  const summary = [
    sun[iMax] === 0
      ? "The Sun never clears the terrain horizon here in the next 12 lunations."
      : sunSpread >= 0.05
        ? `Most sunlight: ${monthOf(rows[iMax], true)} (${pct(sun[iMax])}); least: ${monthOf(rows[iMin], true)} (${pct(sun[iMin])}).`
        : `Sunlight about the same every lunation (${pct(Math.min(...sun))}–${pct(sun[iMax])}).`,
    earthSpread >= 0.05
      ? `Earth visible ${pct(Math.min(...earth))}–${pct(Math.max(...earth))} depending on the lunation.`
      : `Earth visible ${pct(Math.max(...earth))} of every lunation.`,
    sun[iMax] > 0
      ? `Longest night: ${nightText(rows[night].longestNightMs, rows)} (${monthOf(rows[night], true)}).`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const col = (i: number) => PAD.l + i * bw;
  const hv = hover === null ? null : rows[hover];

  return (
    <>
      <svg
        width={w}
        height={h}
        className="block cursor-pointer select-none"
        role="img"
        aria-label={`Next 12 lunations at ${a.site.name}. ${summary}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((e.clientX - r.left - PAD.l) / bw);
          setHover(i >= 0 && i < n ? i : null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={() => hover !== null && jumpTo(rows[hover].startMs + DAY)}
      >
        {current >= 0 && (
          <rect
            x={col(current)}
            y={PAD.t}
            width={bw}
            height={2 * ROW_H + ROW_GAP}
            fill="#ffffff"
            opacity={0.06}
            rx={2}
          />
        )}
        {hover !== null && (
          <rect
            x={col(hover)}
            y={PAD.t}
            width={bw}
            height={2 * ROW_H + ROW_GAP}
            fill="none"
            stroke="#a1a1aa"
            rx={2}
          />
        )}
        {series.map((s, si) => {
          const top = PAD.t + si * (ROW_H + ROW_GAP);
          const base = top + ROW_H;
          return (
            <g key={s.key}>
              <text x={PAD.l - 6} y={top + 12} textAnchor="end" fontSize={10} fill="#d4d4d8">
                {s.label}
              </text>
              <text x={PAD.l - 6} y={top + 24} textAnchor="end" fontSize={9} fill="#a1a1aa">
                0–100%
              </text>
              {[0, 0.5, 1].map((g) => (
                <line
                  key={g}
                  x1={PAD.l}
                  x2={w - PAD.r}
                  y1={base - g * ROW_H}
                  y2={base - g * ROW_H}
                  stroke={COLORS.grid}
                  strokeDasharray={g === 0.5 ? "2 3" : undefined}
                />
              ))}
              {rows.map((r, i) => (
                <path
                  key={r.startMs}
                  d={bar(col(i) + (bw - barW) / 2, base, barW, r[s.key] * ROW_H)}
                  fill={s.color}
                />
              ))}
            </g>
          );
        })}
        {rows.map((r, i) =>
          i % (bw < 24 ? 2 : 1) === 0 ? (
            <text
              key={r.startMs}
              x={col(i) + bw / 2}
              y={h - 4}
              textAnchor="middle"
              fontSize={9}
              fill={i === current ? "#e5e5e5" : "#a1a1aa"}
            >
              {monthOf(r)}
            </text>
          ) : null,
        )}
      </svg>
      <p className="min-h-[2.5em] text-[11px] text-neutral-300" aria-live="polite">
        {hv ? (
          <>
            <span className="font-medium text-neutral-100">
              {fmtUtc(hv.startMs, false)} → {fmtUtc(hv.endMs, false)}
            </span>
            {` · Sun ${pct(hv.sunlitFraction)} · Earth ${pct(hv.earthVisibleFraction)} · both ${pct(hv.bothFraction)} · longest night ${nightText(hv.longestNightMs, rows)}`}
            <span className="text-neutral-500"> — click to analyse these 30 days</span>
          </>
        ) : (
          summary
        )}
      </p>
      <details className="text-[11px] text-neutral-300">
        <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">
          Table of the 13 lunations
        </summary>
        <table className="mt-1 w-full text-left">
          <thead className="text-[10px] text-neutral-500">
            <tr>
              <th className="font-normal">New Moon</th>
              <th className="font-normal">Sun</th>
              <th className="font-normal">Earth</th>
              <th className="font-normal">Both</th>
              <th className="font-normal">Longest night</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.startMs}>
                <td>{fmtUtc(r.startMs, false)}</td>
                <td>{pct(r.sunlitFraction)}</td>
                <td>{pct(r.earthVisibleFraction)}</td>
                <td>{pct(r.bothFraction)}</td>
                <td>{nightText(r.longestNightMs, rows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="text-[10px] text-neutral-500">
        Each column is one lunation, new Moon to new Moon (≈ 29.5 days), sampled every 2 h against the
        same terrain horizon. Near the poles the Moon&apos;s 1.54° axial tilt makes a polar summer and
        winter; libration moves the Earth by up to ~7°. Highlighted: the lunation of the selected time.
      </p>
    </>
  );
}
