"use client";

import { useEffect, useRef } from "react";
import { useApp } from "@/lib/store";

const GLOSSARY: [string, string][] = [
  [
    "Terrain horizon",
    "The skyline seen from the site: for every compass direction, the highest angle of the surrounding terrain (craters, ridges, mountains up to 300 km away), from NASA LOLA laser-altimeter elevation data, for an observer 2 m above the ground (a lander camera or antenna). On the Moon there is no air, so the terrain alone decides when the Sun or the Earth is visible.",
  ],
  [
    "Sunlit / power window",
    "Time when at least half of the Sun's disk is above the terrain horizon: solar panels get direct light.",
  ],
  [
    "Earth visible / DTE window",
    "Time when at least half of the Earth's disk is above the terrain horizon: a direct-to-Earth (DTE) radio link is possible without a relay satellite.",
  ],
  [
    "Solar energy (W/m²)",
    "Sunlight reaching 1 m² of solar panel, before the cells' efficiency: 1361 W/m² at Earth's mean distance from the Sun, times the share of the Sun's disk above the terrain and the cosine of the angle to the panel. A vertical panel turned to the Sun suits the poles, where the Sun stays low; a flat panel suits the equator.",
  ],
  [
    "Lunar day and night",
    "The Moon turns once per lunation, so near the equator a day lasts about 15 Earth days and a night about 15 more. Near the poles the Sun skims the horizon instead, and terrain decides everything.",
  ],
  [
    "Lunation",
    "One synodic month, new Moon to new Moon, about 29.5 days: one full cycle of lunar day and night.",
  ],
  [
    "Polar seasons",
    "The Moon's axis is tilted only 1.54°, but at the poles that is enough to make a polar summer (Sun a little higher) and a polar winter. The 12-lunation chart shows it.",
  ],
  [
    "Permanently shadowed region (PSR)",
    "Ground, usually crater floors near the poles, where the Sun never rises above the terrain horizon. Cold traps that can hold water ice, but with no solar power.",
  ],
  [
    "Libration",
    "A slow wobble of the Moon as seen from Earth (up to about 7° in latitude and 8° in longitude per month). From sites near the limb or the poles the Earth rises and sets with it.",
  ],
  [
    "Azimuth / elevation",
    "Compass direction (0° = north, 90° = east) and angle above the local horizontal plane.",
  ],
  [
    "LOLA, LROC, DEM",
    "LOLA is the laser altimeter of NASA's Lunar Reconnaissance Orbiter; its elevation models (DEMs) give the terrain. LROC is its camera; its mosaics colour the 3D Moon.",
  ],
  [
    "Smooth-sphere horizon",
    "The fallback when no terrain data is available: a perfect sphere, so the horizon is flat. Optimistic near mountains and craters; the panel says when it is used.",
  ],
  [
    "Vertical exaggeration",
    "Stretches the 3D relief to make it easier to see. 1× is the real relief; it never changes the computed horizons.",
  ],
];

const STEPS = [
  "Pick a landing site from the list (the “Sites” button on a phone) or a marker on the Moon, or type any coordinates — or double-click the Moon (desktop) to drop a point there.",
  "The cards show where the Sun and the Earth are now, against the real terrain horizon, and how long until sunset, sunrise, Earthset or Earthrise.",
  "“Local sky” is a 360° panorama of the horizon with the Sun and Earth tracks; “Next 30 days” shows the power and communication windows. Click the timeline to move the clock.",
  "“Next 12 lunations” compares seasons; click a column to analyse that month.",
  "“Sunlight & Earth view around the site” maps 20 × 20 km of terrain to find a better-lit or better-connected spot nearby; click a spot to open it.",
  "Pin up to three sites with “+ Compare” and open “Compare pinned sites” to see them side by side. The time bar at the bottom plays the lunar month or jumps to any date (UTC).",
];

/** About, how to use, glossary, accuracy, data and privacy. Native <dialog>: Esc closes, focus is trapped. */
export function HelpDialog() {
  const open = useApp((s) => s.helpOpen);
  const setOpen = useApp((s) => s.setHelpOpen);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === ref.current && setOpen(false)}
      aria-labelledby="help-title"
      className="m-auto max-h-[85dvh] w-[42rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-white/15 bg-neutral-950 p-0 text-sm text-neutral-300 backdrop:bg-black/70"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-white/10 bg-neutral-950 px-4 py-3">
        <h2 id="help-title" className="text-base font-semibold text-neutral-50">
          About this tool
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10"
          aria-label="Close help"
        >
          ✕
        </button>
      </div>
      <div className="space-y-5 p-4 leading-relaxed">
        <p>
          The Lunar Landing Site Navigator helps mission planners, educators
          and anyone curious compare places and dates to land on the Moon. It
          answers two questions that decide whether a lander survives: will it
          see the Sun (power) and will it see the Earth (direct
          communication)? Both depend on the real terrain around the site,
          not only on latitude.
        </p>

        <section>
          <h3 className="mb-1 font-medium text-neutral-100">How to use it</h3>
          <ol className="list-decimal space-y-1 pl-5">
            {STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>

        <section>
          <h3 className="mb-1 font-medium text-neutral-100">Glossary</h3>
          <dl className="space-y-2">
            {GLOSSARY.map(([term, def]) => (
              <div key={term}>
                <dt className="font-medium text-neutral-200">{term}</dt>
                <dd className="text-neutral-400">{def}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="mb-1 font-medium text-neutral-100">Accuracy and limits</h3>
          <ul className="list-disc space-y-1 pl-5 text-neutral-400">
            <li>
              Sun and Earth positions come from astronomy-engine with the IAU
              lunar rotation model; tested against JPL Horizons (DE441) to
              0.01° in elevation and 0.05° in azimuth.
            </li>
            <li>
              Horizons are computed every 0.5° of azimuth up to 300 km, from
              LOLA elevation models of 80 m (south of 80°S) to about 474 m per
              pixel elsewhere. Features smaller than that are not seen.
            </li>
            <li>
              Windows are sampled every 30 minutes (2 hours for the 12-lunation
              view). Landing-site coordinates come from the cited sources; a
              site without an official position is marked as such.
            </li>
            <li>
              This is a planning and teaching aid, not a certified mission
              analysis tool.
            </li>
          </ul>
        </section>

        <section id="credits">
          <h3 className="mb-1 font-medium text-neutral-100">Data (all NASA, public)</h3>
          <ul className="list-disc space-y-1 pl-5 text-neutral-400">
            <li>
              <a className="underline hover:text-neutral-200" href="https://svs.gsfc.nasa.gov/14959" target="_blank" rel="noreferrer">
                NASA Scientific Visualization Studio
              </a>{" "}
              — LRO 3D Moon model and the{" "}
              <a className="underline hover:text-neutral-200" href="https://svs.gsfc.nasa.gov/4720" target="_blank" rel="noreferrer">
                CGI Moon Kit
              </a>
              .
            </li>
            <li>
              <a className="underline hover:text-neutral-200" href="https://lola.gsfc.nasa.gov/" target="_blank" rel="noreferrer">
                LRO LOLA
              </a>{" "}
              (NASA/GSFC) elevation, including the{" "}
              <a className="underline hover:text-neutral-200" href="https://pds-geosciences.wustl.edu/missions/lro/lola.htm" target="_blank" rel="noreferrer">
                polar DEMs (PDS)
              </a>
              ;{" "}
              <a className="underline hover:text-neutral-200" href="https://www.lroc.asu.edu/" target="_blank" rel="noreferrer">
                LRO LROC
              </a>{" "}
              imagery (NASA/GSFC/ASU).
            </li>
            <li>
              <a className="underline hover:text-neutral-200" href="https://svs.gsfc.nasa.gov/4851" target="_blank" rel="noreferrer">
                Deep Star Maps 2020
              </a>{" "}
              (NASA SVS) and{" "}
              <a className="underline hover:text-neutral-200" href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/" target="_blank" rel="noreferrer">
                Blue Marble
              </a>{" "}
              (NASA Earth Observatory) for the sky and the Earth.
            </li>
            <li>
              <a className="underline hover:text-neutral-200" href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noreferrer">
                JPL Horizons
              </a>{" "}
              as the reference for the ephemeris tests.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="mb-1 font-medium text-neutral-100">Privacy</h3>
          <p className="text-neutral-400">
            No account, no cookies, no analytics. Everything is computed in your
            browser; the only downloads are the 3D model, textures and public
            NASA terrain tiles. Points you add stay on this page and are not
            sent anywhere. The hosting provider keeps standard server access
            logs.
          </p>
        </section>

        <section>
          <h3 className="mb-1 font-medium text-neutral-100">Use of AI</h3>
          <p className="text-neutral-400">
            The code was written with an AI coding assistant (Claude Code,
            Anthropic). All data and imagery are NASA&apos;s; none is
            AI-generated.
          </p>
        </section>

        <p className="text-xs text-neutral-500">
          NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator ·
          Recife. Source code under the Apache-2.0 license.
        </p>
      </div>
    </dialog>
  );
}
