"use client";

import { latLonToVector3, type Site } from "@lunar/core";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
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

/**
 * HTML markers pinned to the sphere. Visibility is computed analytically
 * (a point p on the unit sphere is visible from camera C iff p·C > 1), which is
 * far cheaper than raycasting the 500k-triangle model.
 */
export function SiteMarkers() {
  const sites = useApp((s) => s.sites);
  const selectedId = useApp((s) => s.selectedId);
  const compareIds = useApp((s) => s.compareIds);
  const select = useApp((s) => s.select);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const tmp = new THREE.Vector3();

  useFrame(({ camera }) => {
    for (const site of sites) {
      const el = refs.current.get(site.id);
      if (!el) continue;
      const p = latLonToVector3(site.lat, site.lon);
      tmp.set(p.x, p.y, p.z);
      const visible = tmp.dot(camera.position) > 1.0005;
      el.style.opacity = visible ? "1" : "0";
      el.style.pointerEvents = visible ? "auto" : "none";
    }
  });

  return (
    <>
      {sites.map((site) => {
        const p = latLonToVector3(site.lat, site.lon, 1.0015);
        const selected = site.id === selectedId;
        const compared = compareIds.includes(site.id);
        return (
          <Html key={site.id} position={[p.x, p.y, p.z]} center zIndexRange={[20, 0]}>
            <div
              ref={(el) => {
                if (el) refs.current.set(site.id, el);
                else refs.current.delete(site.id);
              }}
              className="transition-opacity duration-150"
            >
              <button
                type="button"
                onClick={() => select(site.id)}
                title={`${site.name} — ${site.mission}`}
                className="group flex items-center gap-1.5 whitespace-nowrap"
              >
                <span
                  className="block rounded-full border-2 border-black/60 shadow-[0_0_6px_rgba(0,0,0,0.9)]"
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
          </Html>
        );
      })}
    </>
  );
}
