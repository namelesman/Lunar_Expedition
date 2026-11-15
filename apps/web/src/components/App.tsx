"use client";

import { earthIlluminatedFraction, moonSkyState, type Site } from "@lunar/core";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { useTerrainHorizonJobs } from "@/lib/terrainHorizon";
import { ComparePanel } from "./ui/ComparePanel";
import { Credits } from "./ui/Credits";
import { CustomSiteForm, makeCustomSite } from "./ui/CustomSiteForm";
import { HelpDialog } from "./ui/HelpDialog";
import { SiteList } from "./ui/SiteList";
import { SitePanel } from "./ui/SitePanel";
import { TimeBar } from "./ui/TimeBar";
import { ViewControls } from "./ui/ViewControls";

const MoonScene = dynamic(() => import("./globe/MoonScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Loading 3D Moon…
    </div>
  ),
});

export function App({ initialSites }: { initialSites: Site[] }) {
  const setSites = useApp((s) => s.setSites);
  const setQuality = useApp((s) => s.setQuality);
  const addCustomSite = useApp((s) => s.addCustomSite);
  const selectedId = useApp((s) => s.selectedId);
  // Light follows the real Sun; recompute at most once per simulated 10 min.
  const timeBucket = useApp((s) => Math.floor(s.timeMs / 600_000));
  const [showCompare, setShowCompare] = useState(false);
  const [sitesOpen, setSitesOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const setHelpOpen = useApp((s) => s.setHelpOpen);
  useTerrainHorizonJobs();

  useEffect(() => setSites(initialSites), [initialSites, setSites]);

  const sky = useMemo(() => moonSkyState(timeBucket * 600_000), [timeBucket]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black text-neutral-100">
      {/* isolate: the marker layer's z-indices stay below the panels. */}
      <div className="absolute inset-0 isolate">
        <MoonScene
          sunDirection={sky.sunDir}
          earthDirection={sky.earthDir}
          earthIllumination={earthIlluminatedFraction(sky)}
          onPickSurface={(lat, lon) => addCustomSite(makeCustomSite(lat, lon))}
          onCapabilities={(max) => {
            const mem = (navigator as Navigator & { deviceMemory?: number })
              .deviceMemory;
            if (max < 8192 || (mem !== undefined && mem < 4))
              setQuality("lite");
          }}
        />
      </div>

      <header className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-start justify-between gap-4 p-3 max-md:p-2">
        <div className="pointer-events-auto min-w-0">
          <h1 className="text-lg font-semibold tracking-tight max-md:text-sm">
            Lunar Landing Site Navigator
          </h1>
          <p className="text-xs text-neutral-400 max-md:hidden">
            Sun · Earth · real terrain horizon — compare sites and dates
          </p>
          <div className="mt-1.5 flex gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setSitesOpen(true)}
              className="rounded border border-white/15 bg-black/60 px-2 py-1 hover:bg-white/10 md:hidden"
            >
              Sites
            </button>
            <button
              type="button"
              onClick={() => setViewOpen((v) => !v)}
              aria-expanded={viewOpen}
              aria-controls="view-controls"
              className={`rounded border px-2 py-1 md:hidden ${viewOpen ? "border-sky-400/60 bg-sky-400/15" : "border-white/15 bg-black/60 hover:bg-white/10"}`}
            >
              View
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="rounded border border-white/15 bg-black/60 px-2 py-1 hover:bg-white/10"
              aria-haspopup="dialog"
            >
              Help &amp; glossary
            </button>
          </div>
        </div>
        <div
          id="view-controls"
          className={`pointer-events-auto max-md:absolute max-md:left-2 max-md:right-2 max-md:top-[4.75rem] ${viewOpen ? "" : "max-md:hidden"}`}
        >
          <ViewControls />
        </div>
      </header>

      <aside className="absolute left-3 top-24 flex max-h-[calc(100dvh-12rem)] w-64 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/60 backdrop-blur max-md:hidden">
        <SitePicker onCompare={() => setShowCompare(true)} />
      </aside>

      <MobileSites
        open={sitesOpen}
        onClose={() => setSitesOpen(false)}
        onCompare={() => {
          setSitesOpen(false);
          setShowCompare(true);
        }}
      />

      <section
        className={`absolute right-3 top-56 bottom-28 w-[26rem] max-w-[calc(100vw-1.5rem)] max-md:bottom-36 max-md:left-2 max-md:right-2 max-md:top-auto max-md:w-auto ${
          selectedId ? "max-md:h-[52dvh]" : "max-md:hidden"
        }`}
      >
        <SitePanel />
      </section>

      {showCompare && (
        <div className="absolute inset-x-3 bottom-28 top-20 z-30">
          <ComparePanel onClose={() => setShowCompare(false)} />
        </div>
      )}

      <div className="pointer-events-none absolute bottom-9 left-3 right-3 z-20 max-md:bottom-7 max-md:left-2 max-md:right-2">
        <TimeBar />
      </div>

      <Credits />
      <HelpDialog />
    </div>
  );
}

/** Site list, custom coordinates and the compare button (sidebar on desktop, drawer on phones). */
function SitePicker({
  onCompare,
  onPick,
}: {
  onCompare: () => void;
  onPick?: () => void;
}) {
  const compareCount = useApp((s) => s.compareIds.length);
  return (
    <>
      <SiteList onPick={onPick} />
      <CustomSiteForm onAdded={onPick} />
      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onCompare}
          className="w-full rounded border border-white/15 px-2 py-1.5 text-xs hover:bg-white/10"
        >
          Compare pinned sites ({compareCount}/3)
        </button>
      </div>
    </>
  );
}

/** Phones: the site picker in a modal drawer (native <dialog>: Esc closes, focus is trapped). */
function MobileSites({
  open,
  onClose,
  onCompare,
}: {
  open: boolean;
  onClose: () => void;
  onCompare: () => void;
}) {
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
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Landing sites"
      className="m-0 h-dvh max-h-dvh w-80 max-w-[85vw] border-r border-white/15 bg-neutral-950 p-0 text-neutral-100 backdrop:bg-black/60"
    >
      <div className="flex h-full flex-col">
        <div className="flex justify-end p-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10"
            aria-label="Close the site list"
          >
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <SitePicker onCompare={onCompare} onPick={onClose} />
        </div>
      </div>
    </dialog>
  );
}
