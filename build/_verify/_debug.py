# -*- coding: utf-8 -*-
"""Debug: (a) per-column bright-pixel profile in left band to find glyph tail;
(b) sample overlay pixels where the word should be."""
import os
from PIL import Image

SRC = "C:/Users/37615/Projects/game/build/h5-fallback/assets/codex"
OVER = "C:/Users/37615/Projects/game/build/assets/codex_calligraphy"
W = H = 1024

print("=== (a) bright(>200) count per column, x in [300,650], step 10 ===")
for fn in sorted(os.listdir(SRC)):
    base = Image.open(os.path.join(SRC, fn)).convert("L")
    px = base.load()
    counts = []
    for x in range(300, 651):
        c = 0
        for y in range(H):
            if px[x, y] > 200:
                c += 1
        counts.append((x, c))
    # find last x with count >= 8 before a sustained gap
    last_sig = 0
    run_zero = 0
    for x, c in counts:
        if c >= 8:
            last_sig = x
            run_zero = 0
        else:
            run_zero += 1
    profile = " ".join(f"{x}:{c}" for x, c in counts if x % 50 == 0)
    print(f"{fn:24s} last_sig_col={last_sig} ({last_sig/W*100:.1f}%W) | {profile}")

print()
print("=== (b) overlay pixel samples ===")
for fn in ["01_坂田银时.png", "07_冲田总悟.png"]:
    ov = Image.open(os.path.join(OVER, fn)).convert("RGBA")
    opx = ov.load()
    samples = [(195, 512), (195, 400), (195, 600), (150, 512), (240, 512)]
    vals = [opx[x, y] for x, y in samples]
    white = 0
    for y in range(H):
        for x in range(W):
            r, g, b, a = opx[x, y]
            if a > 30 and r > 200 and g > 200 and b > 200:
                white += 1
    print(f"{fn}: samples={vals} white_px={white}")
