"use client";

import { useEffect, useRef } from "react";
import { fmtUtc } from "@/lib/format";
import { useApp, WINDOW_DAYS } from "@/lib/store";

const DAY = 86_400_000;
const RATES = [1, 6, 24, 72];

function toInputValue(t: number) {
  return new Date(t).toISOString().slice(0, 16);
}

/** Date/time (UTC) picker, month slider and animation over the lunar month. */
export function TimeBar() {
  const timeMs = useApp((s) => s.timeMs);
  const windowStartMs = useApp((s) => s.windowStartMs);
  const playing = useApp((s) => s.playing);
  const rate = useApp((s) => s.playRateHps);
  const setTimeMs = useApp((s) => s.setTimeMs);
  const jumpTo = useApp((s) => s.jumpTo);
  const setPlaying = useApp((s) => s.setPlaying);
  const setPlayRate = useApp((s) => s.setPlayRate);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (last.current !== null) {
        const dt = (now - last.current) / 1000;
        const s = useApp.getState();
        s.setTimeMs(s.timeMs + dt * s.playRateHps * 3_600_000);
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const end = windowStartMs + WINDOW_DAYS * DAY;
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-xs backdrop-blur">
      <button
        type="button"
        onClick={() => setPlaying(!playing)}
        className="w-16 rounded border border-white/15 px-2 py-1 hover:bg-white/10"
        aria-label={playing ? "Pause animation" : "Play animation"}
      >
        {playing ? "❚❚ Pause" : "▶ Play"}
      </button>
      <label className="flex items-center gap-1 text-neutral-400">
        speed
        <select
          value={rate}
          onChange={(e) => setPlayRate(Number(e.target.value))}
          className="rounded border border-white/10 bg-neutral-900 px-1 py-0.5 text-neutral-200"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r} h/s
            </option>
          ))}
        </select>
      </label>
      <input
        type="range"
        min={windowStartMs}
        max={end}
        step={30 * 60_000}
        value={Math.min(end, Math.max(windowStartMs, timeMs))}
        onChange={(e) => setTimeMs(Number(e.target.value))}
        className="min-w-40 flex-1 accent-amber-500"
        aria-label="Time within the 30-day window"
      />
      <label className="flex items-center gap-1 text-neutral-400">
        UTC
        <input
          type="datetime-local"
          value={toInputValue(timeMs)}
          onChange={(e) => {
            const t = Date.parse(`${e.target.value}:00Z`);
            if (Number.isFinite(t)) jumpTo(t);
          }}
          className="rounded border border-white/10 bg-neutral-900 px-1 py-0.5 font-mono text-neutral-200 [color-scheme:dark]"
        />
      </label>
      <button
        type="button"
        onClick={() => jumpTo(Date.now())}
        className="rounded border border-white/15 px-2 py-1 hover:bg-white/10"
      >
        Now
      </button>
      <span className="hidden font-mono text-neutral-500 lg:inline">
        {fmtUtc(timeMs)}
      </span>
    </div>
  );
}
