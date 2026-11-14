"use client";

import { latLonToVector3, type Site } from "@lunar/core";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useApp } from "@/lib/store";

const CATEGORY_COLOR: Record<Site["category"], string> = {
  apollo: "#facc15",
  clps: "#38bdf8",
  international: "#f472b6",
  artemis: "#a78bfa",
  "south-pole-feature": "#34d399",
  custom: "#fb923c",
};

export function siteColor(site: Pick<Site, "category">): string {
  return CATEGORY_COLOR[site.category] ?? "#e5e5e5";
}

/** DOM elements of the marker layer, keyed by site id (filled by MarkerLayer refs). */
const markerEls = new Map<string, HTMLElement>();

const tmp = new THREE.Vector3();

/**
 * Inside the Canvas: projects every site to screen space each frame and moves
 * its DOM marker. Visibility is analytic: a point p on the unit sphere faces a
 * camera at C iff p·C > 1 (cheaper than raycasting a 500k-triangle mesh).
 */
export function MarkerProjector() {
  useFrame(({ camera, size }) => {
    const { sites } = useApp.getState();
    for (const site of sites) {
      const el = markerEls.get(site.id);
      if (!el) continue;
      const p = latLonToVector3(site.lat, site.lon, 1.001);
      tmp.set(p.x, p.y, p.z);
      const facing = tmp.dot(camera.position) > 1.0005;
      tmp.project(camera);
      const onScreen =
        facing && tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
      if (!onScreen) {
        el.style.visibility = "hidden";
        continue;
      }
      const x = ((tmp.x + 1) / 2) * size.width;
      const y = ((1 - tmp.y) / 2) * size.height;
      el.style.visibility = "visible";
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}

/** Outside the Canvas: the clickable marker buttons. */
export function MarkerLayer() {
  const sites = useApp((s) => s.sites);
  const selectedId = useApp((s) => s.selectedId);
  const compareIds = useApp((s) => s.compareIds);
  const select = useApp((s) => s.select);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {sites.map((site) => {
        const selected = site.id === selectedId;
        const compared = compareIds.includes(site.id);
        return (
          <div
            key={site.id}
            ref={(el) => {
              if (el) markerEls.set(site.id, el);
              else markerEls.delete(site.id);
            }}
            className="absolute left-0 top-0"
            style={{ visibility: "hidden", zIndex: selected ? 2 : 1 }}
          >
            <button
              type="button"
              onClick={() => select(site.id)}
              title={`${site.name} — ${site.mission}`}
              className="group pointer-events-auto flex items-center gap-1.5 whitespace-nowrap"
              style={{ transform: `translate(-${selected ? 7 : 5}px, -50%)` }}
            >
              <span
                className="block shrink-0 rounded-full border-2 border-black/60 shadow-[0_0_6px_rgba(0,0,0,0.9)]"
                style={{
                  width: selected ? 14 : 10,
                  height: selected ? 14 : 10,
                  background: siteColor(site),
                  outline: compared ? "2px solid white" : undefined,
                  outlineOffset: 1,
                }}
              />
              <span
                className={`rounded bg-black/70 px-1.5 py-0.5 text-[11px] leading-none text-neutral-100 ${
                  selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                {site.name}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
