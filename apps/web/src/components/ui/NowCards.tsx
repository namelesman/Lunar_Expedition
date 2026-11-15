"use client";

import type { BodyPosition, Transition } from "@lunar/core";
import type { SiteAnalysis } from "@/lib/conditions";
import {
  COLORS,
  fmtDeg,
  fmtIn,
  fmtKWhM2,
  fmtPct,
  fmtUtc,
  fmtWm2,
} from "@/lib/format";

function status(p: BodyPosition): {
  text: string;
  tone: "ok" | "warn" | "bad";
} {
  if (p.visibleFraction >= 0.999)
    return { text: "Fully above the terrain", tone: "ok" };
  if (p.visibleFraction > 0.001)
    return {
      text: `${fmtPct(p.visibleFraction)} of disk visible`,
      tone: "warn",
    };
  if (p.elevationDeg > 0) return { text: "Blocked by terrain", tone: "bad" };
  return { text: "Below the horizon", tone: "bad" };
}

const TONE = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
} as const;
const ICON = { ok: "●", warn: "◐", bad: "○" } as const;

function Countdown({
  tr,
  now,
  body,
}: {
  tr: Transition | null;
  now: number;
  body: "sun" | "earth";
}) {
  const set = body === "sun" ? "Sunset" : "Earthset";
  const rise = body === "sun" ? "Sunrise" : "Earthrise";
  if (!tr)
    return (
      <span className="text-neutral-400">
        No {body === "sun" ? "sunrise/sunset" : "Earthrise/Earthset"} in the
        next 30 days
      </span>
    );
  return (
    <span>
      <span className="text-neutral-400">
        {tr.kind === "set" ? set : rise} in{" "}
      </span>
      <span className="font-mono font-semibold text-neutral-100">
        {fmtIn(tr.timeMs - now)}
      </span>
      <span className="block text-[10px] text-neutral-500">
        {fmtUtc(tr.timeMs)}
      </span>
    </span>
  );
}

/** "Right now" status for power (Sun) and direct-to-Earth comms (Earth). */
export function NowCards({
  a,
  timeMs,
  compact = false,
}: {
  a: SiteAnalysis;
  timeMs: number;
  compact?: boolean;
}) {
  const cards = [
    {
      key: "sun" as const,
      title: "Sun · power",
      p: a.now.sun,
      tr: a.nextSun,
      color: COLORS.sun,
      hint: "Solar elevation drives power: at the poles the Sun skims the horizon, so a few degrees of terrain decide light or darkness.",
    },
    {
      key: "earth" as const,
      title: "Earth · comms",
      p: a.now.earth,
      tr: a.nextEarth,
      color: COLORS.earth,
      hint: "Direct-to-Earth radio needs Earth above the local horizon. Libration makes Earth rise and set near the poles; the far side never sees it.",
    },
  ];
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
      {cards.map((c) => {
        const s = status(c.p);
        return (
          <div
            key={c.key}
            className="rounded-md border border-white/10 bg-white/[0.03] p-2.5"
            title={c.hint}
          >
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-neutral-400">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: c.color }}
              />
              {c.title}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold text-neutral-50">
                {fmtDeg(c.p.elevationDeg)}
              </span>
              <span className="text-[11px] text-neutral-400">
                elev · az {fmtDeg(c.p.azimuthDeg, 0)}
              </span>
            </div>
            <div className={`mt-0.5 text-xs ${TONE[s.tone]}`}>
              <span aria-hidden>{ICON[s.tone]} </span>
              {s.text}
            </div>
            <div className="mt-0.5 text-[10px] text-neutral-500">
              terrain at this azimuth: {fmtDeg(c.p.terrainHorizonDeg, 2)}
            </div>
            <div className="mt-1.5 text-xs">
              <Countdown tr={c.tr} now={timeMs} body={c.key} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Metrics({ a }: { a: SiteAnalysis }) {
  const c = a.conditions;
  const items = [
    {
      label: "Sunlit",
      value: fmtPct(c.sunlitFraction),
      hint: "Share of the 30-day window with the Sun centre above the terrain.",
    },
    {
      label: "Earth in view",
      value: fmtPct(c.earthVisibleFraction),
      hint: "Share of time with direct line of sight to Earth.",
    },
    {
      label: "Sun + Earth",
      value: fmtPct(
        c.bothWindows.reduce((s, w) => s + (w.endMs - w.startMs), 0) /
          (c.endMs - c.startMs),
      ),
      hint: "Power and direct comms at the same time.",
    },
    {
      label: "Longest night",
      value: fmtIn(a.longestNightMs),
      hint: "Longest continuous darkness in the window (battery / heater sizing).",
    },
    {
      label: "Longest comms gap",
      value: fmtIn(a.longestCommsGapMs),
      hint: "Longest interval without Earth in view.",
    },
    {
      label: "Max Sun elev.",
      value: fmtDeg(c.maxSunElevationDeg),
      hint: "Highest solar elevation in the window.",
    },
  ];
  return (
    <dl className="grid grid-cols-3 gap-1.5">
      {items.map((i) => (
        <div
          key={i.label}
          className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5"
          title={i.hint}
        >
          <dt className="text-[10px] uppercase tracking-wide text-neutral-500">
            {i.label}
          </dt>
          <dd className="font-mono text-sm text-neutral-100">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Sunlight reaching 1 m² of panel over the 30-day window, for the two simple
 * layouts. No cell efficiency, dust or temperature: the physical input only.
 */
export function SolarEnergy({ a }: { a: SiteAnalysis }) {
  const e = a.energy;
  const panels = [
    {
      label: "Vertical, facing the Sun",
      mean: e.verticalMeanWm2,
      total: e.verticalWhPerM2,
      peak: e.verticalPeakWm2,
    },
    {
      label: "Flat on the ground",
      mean: e.horizontalMeanWm2,
      total: e.horizontalWhPerM2,
      peak: e.horizontalPeakWm2,
    },
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-1.5">
        {panels.map((p) => (
          <div
            key={p.label}
            className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5"
          >
            <dt className="text-[10px] uppercase tracking-wide text-neutral-500">
              {p.label}
            </dt>
            <dd>
              <span className="font-mono text-sm text-neutral-100">
                {fmtWm2(p.mean)}
              </span>{" "}
              <span className="text-[10px] text-neutral-400">average</span>
              <span className="block text-[10px] text-neutral-400">
                {fmtKWhM2(p.total)} in 30 days
              </span>
              <span className="block text-[10px] text-neutral-400">
                peak {fmtWm2(p.peak)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[10px] leading-snug text-neutral-500">
        Sunlight reaching the panel, before cell efficiency: 1361 W/m² at 1 AU,
        scaled by the Sun&apos;s distance, times the share of the Sun&apos;s
        disk above the terrain and the cosine of the angle to the panel.
        Averages include the night. Near the poles the Sun stays low, so
        vertical panels suit polar sites.
      </p>
    </div>
  );
}
