"""Terrain horizon masks for every landing site, from LOLA.

For each site and each azimuth (0.5 deg steps) we march along the great circle
up to MAX_KM and keep the highest elevation angle of the terrain seen by an
observer OBS_H m above the ground. Curvature is exact:

    observer radius r0 = R + h_site + OBS_H, target radius r1 = R + h(d)
    central angle  t  = d / R
    elevation      e  = atan2(r1*cos(t) - r0, r1*sin(t))

No atmosphere on the Moon, so there is no refraction term: the horizon is the
terrain (or the limb of the sphere, which this formula also yields).

DEM: CGI Moon Kit "ldem_64_uint.tif" (SVS #4720) — LOLA, 64 px/deg,
uint16 half-meters relative to 1727.4 km, equirectangular, lon -180..180,
row 0 = 90N (verified: min at Antoniadi 70.3S 172.5W, max at 5.4N 158.6W).

Output: apps/web/public/data/horizons.json  (small, committed; consumed by
@lunar/core HorizonMask).

Usage: python -I scripts/horizons.py [data/raw/svs-4720/ldem_64_uint.tif]
"""
from __future__ import annotations

import json
import sys
import warnings
from pathlib import Path

import numpy as np
import rasterio

warnings.filterwarnings("ignore", category=rasterio.errors.NotGeoreferencedWarning)

ROOT = Path(__file__).resolve().parents[1]
R_M = 1_737_400.0
OBS_H = 2.0
AZ_STEP = 0.5
MAX_KM = 300.0


def load_dem(path: Path) -> tuple[np.ndarray, int]:
    with rasterio.open(path) as ds:
        dem = ds.read(1)
    ppd = dem.shape[1] // 360
    assert dem.shape == (180 * ppd, 360 * ppd), dem.shape
    return dem, ppd


def sample(dem: np.ndarray, ppd: int, lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Bilinear sample, meters relative to 1737.4 km. Wraps in longitude."""
    H, W = dem.shape
    x = (np.mod(lon + 180.0, 360.0)) * ppd - 0.5
    y = (90.0 - lat) * ppd - 0.5
    y = np.clip(y, 0, H - 1.000001)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = x - x0
    fy = y - y0
    x0 %= W
    x1 = (x0 + 1) % W
    y1 = np.minimum(y0 + 1, H - 1)
    v00 = dem[y0, x0].astype(np.float64)
    v01 = dem[y0, x1].astype(np.float64)
    v10 = dem[y1, x0].astype(np.float64)
    v11 = dem[y1, x1].astype(np.float64)
    v = (v00 * (1 - fx) + v01 * fx) * (1 - fy) + (v10 * (1 - fx) + v11 * fx) * fy
    return v * 0.5 - 10_000.0


def destination(lat: float, lon: float, az_deg: np.ndarray, d_m: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    p1 = np.radians(lat)
    l1 = np.radians(lon)
    b = np.radians(az_deg)[:, None]
    dd = (d_m / R_M)[None, :]
    p2 = np.arcsin(np.sin(p1) * np.cos(dd) + np.cos(p1) * np.sin(dd) * np.cos(b))
    l2 = l1 + np.arctan2(np.sin(b) * np.sin(dd) * np.cos(p1), np.cos(dd) - np.sin(p1) * np.sin(p2))
    return np.degrees(p2), np.degrees(l2)


def distances_m() -> np.ndarray:
    return np.concatenate([
        np.arange(60, 5_000, 60),
        np.arange(5_000, 50_000, 250),
        np.arange(50_000, MAX_KM * 1000 + 1, 1_000),
    ]).astype(np.float64)


def horizon_mask(dem: np.ndarray, ppd: int, lat: float, lon: float) -> dict:
    h0 = float(sample(dem, ppd, np.array([lat]), np.array([lon]))[0])
    az = np.arange(0, 360, AZ_STEP)
    d = distances_m()
    plat, plon = destination(lat, lon, az, d)
    h = sample(dem, ppd, plat, plon)
    r0 = R_M + h0 + OBS_H
    r1 = R_M + h
    t = (d / R_M)[None, :]
    elev = np.degrees(np.arctan2(r1 * np.cos(t) - r0, r1 * np.sin(t)))
    k = np.argmax(elev, axis=1)
    e = elev[np.arange(len(az)), k]
    return {
        "lat": lat,
        "lon": lon,
        "observerHeightM": OBS_H,
        "siteElevationM": round(h0, 1),
        "azimuthStepDeg": AZ_STEP,
        "elevationsDeg": [round(float(x), 3) for x in e],
        "distancesKm": [round(float(x), 2) for x in d[k] / 1000],
        "maxDistanceKm": MAX_KM,
        "demSource": f"LOLA {ppd} px/deg (CGI Moon Kit ldem_{ppd}, svs.gsfc.nasa.gov/4720)",
    }


def main() -> None:
    dem_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data/raw/svs-4720/ldem_64_uint.tif"
    dem, ppd = load_dem(dem_path)
    sites = [s for s in json.loads((ROOT / "data/sites.json").read_text(encoding="utf-8")) if not s.get("todo")]
    out: dict[str, dict] = {}
    for s in sites:
        m = horizon_mask(dem, ppd, s["lat"], s["lon"])
        m["siteId"] = s["id"]
        out[s["id"]] = m
        e = np.array(m["elevationsDeg"])
        print(f"{s['id']:22s} h={m['siteElevationM']:8.1f} m  horizon min {e.min():6.2f}  max {e.max():6.2f} deg")
    dst = ROOT / "apps/web/public/data/horizons.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {dst} ({dst.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
