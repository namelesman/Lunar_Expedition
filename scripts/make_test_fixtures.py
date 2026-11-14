"""Create the small albedo fixture used by packages/core tests.

Downsamples the CGI Moon Kit LROC color preview (lroc_color_2k.jpg, SVS #4720,
equirectangular, centred on lon 0) to a 720x360 8-bit grayscale raw file
(0.5 deg per pixel, row 0 = 90N, col 0 = 180W).

Usage: python -I scripts/make_test_fixtures.py data/raw/svs-4720/lroc_color_2k.jpg
"""
import sys
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1])
out = Path(__file__).resolve().parents[1] / "packages/core/test/fixtures/lroc-albedo-720x360.u8"
out.parent.mkdir(parents=True, exist_ok=True)
img = Image.open(src).convert("L").resize((720, 360), Image.Resampling.BOX)
out.write_bytes(img.tobytes())
print(f"wrote {out} ({out.stat().st_size} bytes)")
