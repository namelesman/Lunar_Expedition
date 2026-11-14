"""Recover the reference radius and baked vertical exaggeration of the NASA SVS GLB.

Fits r_glb = a + b * h_lola (h in km above 1737.4 km) on a random vertex sample
exported by scripts/node/optimize-glb.mjs, using the LOLA 16 ppd DEM from the
CGI Moon Kit (svs.gsfc.nasa.gov/4720).

    a          = GLB radius of the 1737.4 km reference sphere (scene units)
    b * 1737.4 / a = vertical exaggeration baked into the model

Usage: python -I scripts/fit_glb_scale.py data/cache/glb-radius-sample.csv data/raw/svs-4720/ldem_16_uint.tif
"""
import csv
import json
import sys

import numpy as np
import rasterio

sample_path, dem_path = sys.argv[1], sys.argv[2]
u, v, r = np.loadtxt(sample_path, delimiter=",", skiprows=1, unpack=True)
with rasterio.open(dem_path) as ds:
    print("DEM", ds.width, ds.height, ds.dtypes, ds.transform, ds.crs)
    dem = ds.read(1).astype(np.float64)
# uint16 half-meters relative to 1727.4 km -> km relative to 1737.4 km
h_km = dem * 0.5 / 1000.0 - 10.0
H, W = dem.shape
lon = u * 360.0 - 180.0
lat = 90.0 - v * 180.0
col = np.clip(((lon + 180.0) / 360.0 * W).astype(int), 0, W - 1)
row = np.clip(((90.0 - lat) / 180.0 * H).astype(int), 0, H - 1)
h = h_km[row, col]
ok = np.abs(lat) < 85  # avoid the pinched poles of the UV sphere
A = np.vstack([np.ones(ok.sum()), h[ok]]).T
(a, b), res, *_ = np.linalg.lstsq(A, r[ok], rcond=None)
pred = a + b * h[ok]
rms = float(np.sqrt(np.mean((pred - r[ok]) ** 2)))
corr = float(np.corrcoef(h[ok], r[ok])[0, 1])
exag = b * 1737.4 / a
out = {"referenceRadius": a, "exaggeration": exag, "rmsResidual": rms, "corr": corr,
       "hMinKm": float(h_km.min()), "hMaxKm": float(h_km.max())}
print(json.dumps(out, indent=2))
