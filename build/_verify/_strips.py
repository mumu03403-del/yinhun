# -*- coding: utf-8 -*-
"""Strip sheet: left band x in [0.30W, 0.60W] of each original, to eyeball glyph extent.
Vertical guide lines drawn at 0.40W and 0.50W of full width."""
import os
from PIL import Image, ImageDraw, ImageFont

SRC = "C:/Users/37615/Projects/game/build/h5-fallback/assets/codex"
W = H = 1024
X0, X1 = 307, 614   # 0.30W .. 0.60W
SCALE = 0.45

files = sorted(os.listdir(SRC))
sw = int((X1 - X0) * SCALE)
sh = int(H * SCALE)
gap = 8
label_w = 110
sheet = Image.new("RGB", (label_w + len(files) * (sw + gap) + gap, sh + 30), (30, 30, 34))
dr = ImageDraw.Draw(sheet)
try:
    lf = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 12)
except Exception:
    lf = ImageFont.load_default()

for i, fn in enumerate(files):
    im = Image.open(os.path.join(SRC, fn)).convert("RGB").crop((X0, 0, X1, H))
    im = im.resize((sw, sh))
    x = label_w + gap + i * (sw + gap)
    sheet.paste(im, (x, 25))
    dr.text((x, 5), fn[:14], fill=(230, 230, 230), font=lf)
    # guides: 0.40W -> (409-307)*0.45 ; 0.50W -> (512-307)*0.45
    for gx, col in [((409 - X0) * SCALE, (255, 80, 80)), ((512 - X0) * SCALE, (80, 160, 255))]:
        dr.line([(x + gx, 25), (x + gx, 25 + sh)], fill=col, width=1)

sheet.save("C:/Users/37615/Projects/game/build/_verify/_strips.png")
print("saved", sheet.size)
