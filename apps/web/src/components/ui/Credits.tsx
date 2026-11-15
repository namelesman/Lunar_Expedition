"use client";

import { useApp } from "@/lib/store";

const LINKS: [string, string][] = [
  ["https://svs.gsfc.nasa.gov/14959", "NASA's Scientific Visualization Studio"],
  ["https://www.lroc.asu.edu/", "LRO LROC (NASA/GSFC/ASU)"],
  ["https://lola.gsfc.nasa.gov/", "LRO LOLA (NASA/GSFC)"],
  ["https://svs.gsfc.nasa.gov/4851", "Deep Star Maps 2020"],
  [
    "https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/",
    "Blue Marble",
  ],
];

/** One line of data credits; the full list (CGI Moon Kit, LOLA polar DEMs, JPL Horizons) is in Help. */
export function Credits() {
  const setHelpOpen = useApp((s) => s.setHelpOpen);
  return (
    <footer className="pointer-events-auto absolute bottom-0 left-0 right-0 flex items-center gap-x-3 overflow-hidden whitespace-nowrap bg-gradient-to-t from-black/80 to-transparent px-4 pb-2 pt-6 text-[11px] text-neutral-400 max-md:px-2 max-md:pb-1 max-md:pt-2">
      <span className="max-md:hidden">Data:</span>
      {LINKS.map(([href, label], i) => (
        <span key={href} className="flex items-center gap-x-3 max-lg:hidden">
          {i > 0 && <span aria-hidden>·</span>}
          <a
            className="underline hover:text-neutral-200"
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            {label}
          </a>
        </span>
      ))}
      <span aria-hidden className="max-lg:hidden">
        ·
      </span>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className="underline hover:text-neutral-200"
      >
        <span className="lg:hidden">Data: NASA (SVS, LRO LOLA &amp; LROC) — </span>
        all credits
      </button>
      <span className="ml-auto">
        <span className="max-md:hidden">NASA Space Apps Challenge 2026 · Recife</span>
        <span className="md:hidden">Space Apps 2026</span>
      </span>
    </footer>
  );
}
