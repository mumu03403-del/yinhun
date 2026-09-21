# -*- coding: utf-8 -*-
"""Measure per-file bright-pixel extent (old garbled glyph) and overlay word bbox."""
import os
from PIL import Image

SRC = "C:/Users/37615/Projects/game/build/h5-fallback/assets/codex"
OVER = "C:/Users/37615/Projects/game/build/assets/codex_calligraphy"
W = H = 1024

FILES = sorted(os.listdir(SRC))
for fn in FILES:
    base = Image.open(os.path.join(SRC, fn)).convert("L")
    px = base.load()
    max_x = -1
    hist = {}
    for y in range(H):
        for x in range(W):
            if px[x, y] > 200:
                if x > max_x:
                    max_x = x
    # word bbox from overlay: pixels that are white-ish with alpha
    ov = Image.open(os.path.join(OVER, fn))
    opx = ov.load()
    minx, miny, maxx, maxy = W, H, -1, -1
    for y in range(H):
        for x in range(W):
            r, g, b, a = opx[x, y]
            if a > 30 and r > 200 and g > 200 and b > 200:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    print(f"{fn:24s} bright_max_x={max_x} ({max_x/W*100:.1f}%W)  "
          f"word_bbox=({minx},{miny})-({maxx},{maxy})  "
          f"band=[{0.28*H:.0f},{0.72*H:.0f}] {'OK' if miny>=0.28*H and maxy<=0.72*H else 'VIOLATION'}")
