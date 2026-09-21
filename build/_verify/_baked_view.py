# -*- coding: utf-8 -*-
"""Full-res left-half crops of baked posters for rows 07, 08, 11, 12."""
from PIL import Image
BAKED = "C:/Users/37615/Projects/game/build/assets/codex_baked"
files = ["07_冲田总悟.png", "08_桂小太郎.png", "11_神威.png", "12_虚_吉田松阳.png"]
tiles = []
for fn in files:
    im = Image.open(BAKED + "/" + fn).convert("RGB").crop((0, 0, 560, 1024)).resize((280, 512))
    tiles.append(im)
sheet = Image.new("RGB", (280 * 4 + 30, 512), (40, 40, 44))
for i, t in enumerate(tiles):
    sheet.paste(t, (i * (280 + 10), 0))
sheet.save("C:/Users/37615/Projects/game/build/_verify/_baked_left.png")
print("ok")
