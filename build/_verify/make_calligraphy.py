# -*- coding: utf-8 -*-
"""
Bake a dedicated brush calligraphy word into each of the 12 codex posters.
Re-runnable generator. Uses Pillow only (numpy not available).
Outputs:
  codex_baked/<fn>         -> composited poster (panel + word)
  codex_calligraphy/<fn>   -> transparent overlay (panel + word) for reuse/debug
  codex_calligraphy/CONTACT_SHEET.png -> human approval sheet

Does NOT touch h5-fallback/assets/codex/*.png or any index.html.
"""
import os
import sys
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

PY = "C:/Users/37615/.workbuddy/binaries/python/versions/3.13.12/python.exe"
SRC_DIR  = "C:/Users/37615/Projects/game/build/h5-fallback/assets/codex"
BAKED_DIR = "C:/Users/37615/Projects/game/build/assets/codex_baked"
OVER_DIR  = "C:/Users/37615/Projects/game/build/assets/codex_calligraphy"
FONT_PATH = "C:/Windows/Fonts/STXINGKA.TTF"

W = H = 1024
# NOTE: spec suggested plateau 0.34W -> zero 0.44W @ alpha 0.90. Real garbled
# glyph ink reaches ~0.38W and, at alpha 0.90, ~10% bleed-through keeps the old
# glyphs readable as gray ghosts (lum ~35 vs ~10 background). Plateau is
# therefore widened to 0.40W and alpha raised to 0.99 so the old calligraphy is
# truly unreadable; the torn ramp edge now falls at 0.50W.
PLATEAU = 0.40 * W   # x where solid ~0.99 alpha ends
ZERO    = 0.50 * W   # x where ramp reaches 0
PLATEAU_A = 0.99
METRIC_X = int(0.40 * W)   # coverage metric boundary
CENTER_X = 0.19 * W        # word horizontal center
BAND_TOP = 0.28 * H
BAND_BOT = 0.72 * H
INK = (8, 10, 14)          # near-black panel colour

WORDS = {
    "01_坂田银时.png":   ["万", "事"],
    "02_志村新八.png":   ["眼", "镜"],
    "03_神乐.png":       ["夜", "兔"],
    "04_定春.png":       ["犬", "神"],
    "05_近藤勋.png":     ["猩", "猩"],
    "06_土方十四郎.png": ["蛋", "黄", "酱"],
    "07_冲田总悟.png":   ["抖", "S"],
    "08_桂小太郎.png":   ["攘", "夷"],
    "09_伊丽莎白.png":   ["看", "板"],
    "10_高杉晋助.png":   ["鬼", "兵"],
    "11_神威.png":       ["春", "雨"],
    "12_虚_吉田松阳.png": ["虚"],
}

# label font (clean, for QC sheet) with fallback
try:
    LABEL_FONT = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 16)
    LABEL_FONT_SM = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 13)
except Exception:
    LABEL_FONT = ImageFont.load_default()
    LABEL_FONT_SM = ImageFont.load_default()


def load_font(size):
    return ImageFont.truetype(FONT_PATH, size)


def glyph_bbox_ink(ch, size=200):
    """Return ink coverage fraction within the glyph's own bbox (sanity check)."""
    img = Image.new("L", (size * 2, size * 2), 0)
    dr = ImageDraw.Draw(img)
    font = load_font(size)
    bbox = dr.textbbox((0, 0), ch, font=font)
    dr.text((-bbox[0] + size // 2, -bbox[1] + size // 2), ch, fill=255, font=font)
    cb = img.crop(img.getbbox())
    if cb is None:
        return 0.0
    px = cb.load()
    cw, chh = cb.size
    ink = 0
    for y in range(chh):
        for x in range(cw):
            if px[x, y] > 20:
                ink += 1
    return ink / (cw * chh)


def render_glyph(ch, s, textured=True):
    """Render one char as an s x s RGBA sprite (white, AA). 2x then LANCZOS.
    If textured, multiply alpha by a blotchy dry-brush field (飞白)."""
    big = int(round(2 * s))
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    font = load_font(int(2.4 * s))
    bbox = dr.textbbox((0, 0), ch, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    ox = (big - tw) / 2 - bbox[0]
    oy = (big - th) / 2 - bbox[1]
    dr.text((ox, oy), ch, fill=(255, 255, 255, 255), font=font)
    img = img.resize((s, s), Image.LANCZOS)

    if textured:
        noise = Image.effect_noise((s, s), 55).filter(ImageFilter.GaussianBlur(4))
        nd = noise.load()
        pd = img.load()
        for y in range(s):
            for x in range(s):
                r, g, b, a = pd[x, y]
                if a == 0:
                    continue
                n = nd[x, y] / 255.0
                m = 0.55 + 0.45 * n
                if n < 0.12:          # occasional holes -> dry brush
                    m = 0.0
                pd[x, y] = (255, 255, 255, int(a * m))
    return img


def build_panel_alpha(base_lum_rows):
    """Per-pixel alpha for the ink panel.
    - ramp plateau 0.90 at x<=PLATEAU, linear to 0 at x=ZERO
    - per-row jitter from noise (~ +/-3% W) -> brush-torn right edge
    - vertical alpha variation +/-5%
    - guarantee: any pixel x<METRIC_X with original luminance>200 gets >=0.55
      (hides the old garbled calligraphy in the acceptance region)."""
    prof = []
    for x in range(W):
        if x <= PLATEAU:
            prof.append(PLATEAU_A)
        elif x < ZERO:
            prof.append(PLATEAU_A * (ZERO - x) / (ZERO - PLATEAU))
        else:
            prof.append(0.0)

    jnoise = Image.effect_noise((1, H), 55)
    jd = list(jnoise.getdata())
    vnoise = Image.effect_noise((1, H), 30)
    vd = list(vnoise.getdata())

    jitter = [int(round((jd[r] - 128) / 128.0 * 0.03 * W)) for r in range(H)]
    vfac = [1.0 + 0.03 * ((vd[r] - 128) / 128.0) for r in range(H)]

    flat = bytearray()
    for r in range(H):
        sh = jitter[r]
        vf = vfac[r]
        lum_row = base_lum_rows[r]
        for x in range(W):
            idx = x - sh
            if idx < 0:
                a = 0.90
            elif idx < W:
                a = prof[idx]
            else:
                a = 0.0
            a = a * vf
            if x < METRIC_X and lum_row[x] > 200:
                if a < 0.55:
                    a = 0.55
            if a > 1.0:
                a = 1.0
            flat.append(int(a * 255))
    alpha = Image.new("L", (W, H))
    alpha.putdata(flat)
    return alpha


def build_overlay(chars, tier, base_lum_rows, want_word=True):
    """Return RGBA overlay (panel + halo + word) on transparent canvas.
    want_word=False -> panel only (used for the residual-glyph QC metric)."""
    panel = Image.new("RGBA", (W, H), (INK[0], INK[1], INK[2], 255))
    panel.putalpha(build_panel_alpha(base_lum_rows))

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    overlay = Image.alpha_composite(overlay, panel)

    n = len(chars)
    s = min(0.30 * W, 0.44 * H / n) * 0.94
    s = int(s)
    gap = int(0.02 * s)
    total = n * s + (n - 1) * gap
    y_start = (BAND_TOP + BAND_BOT) / 2 - total / 2
    y_start = int(round(y_start))

    rng = random.Random(tier)   # deterministic per tier
    jitters = [int(round(rng.uniform(-5, 5))) for _ in range(n)]

    word_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, ch in enumerate(chars):
        cx = int(round(CENTER_X)) + jitters[i]
        y_top = y_start + i * (s + gap)
        x_left = int(cx - s / 2)
        y_top = int(round(y_top))

        glyph = render_glyph(ch, s, textured=True)
        # halo
        halo_a = glyph.split()[3].filter(ImageFilter.GaussianBlur(5))
        halo_a = halo_a.point(lambda v: int(v * 0.06))
        halo = Image.new("RGBA", (s, s), (255, 255, 255, 0))
        halo.putalpha(halo_a)
        # composite with straight alpha (paste-with-RGBA-mask would square alpha)
        region = word_layer.crop((x_left, y_top, x_left + s, y_top + s))
        region = Image.alpha_composite(region, halo)
        region = Image.alpha_composite(region, glyph)
        word_layer.paste(region, (x_left, y_top))

    if want_word:
        overlay = Image.alpha_composite(overlay, word_layer)
    return overlay


def render_word_tile(chars, tw=64, th=82):
    """Word alone at true in-game panel size, white on dark, for legibility QC."""
    tile = Image.new("RGBA", (tw, th), (INK[0], INK[1], INK[2], 255))
    n = len(chars)
    s = int(min(tw * 0.92, th * 0.92 / n))
    gap = int(0.02 * s)
    total = n * s + (n - 1) * gap
    y0 = (th - total) // 2
    cx = tw // 2
    for i, ch in enumerate(chars):
        glyph = render_glyph(ch, s, textured=False)
        x = cx - s // 2
        y = y0 + i * (s + gap)
        region = tile.crop((x, y, x + s, y + s))
        region = Image.alpha_composite(region, glyph)
        tile.paste(region, (x, y))
    return tile


def luminance_fraction_above(lum_bytes, thr=200):
    cnt = 0
    tot = 0
    for idx, v in enumerate(lum_bytes):
        x = idx % W
        if x < METRIC_X:
            tot += 1
            if v > thr:
                cnt += 1
    return cnt / tot if tot else 0.0


def make_contact_sheet(results):
    cols = [
        ("ORIGINAL", 256),
        ("BAKED", 256),
        ("CODEX CARD", 178),
        ("WORD", 64),
    ]
    gap = 12
    label_w = 150
    row_h = 256
    header_h = 34
    total_w = label_w + sum(c[1] for c in cols) + gap * (len(cols) + 1)
    total_h = header_h + len(results) * row_h + (len(results) - 1) * gap

    sheet = Image.new("RGBA", (total_w, total_h), (16, 18, 22, 255))
    dr = ImageDraw.Draw(sheet)

    # header
    hx = label_w + gap
    for name, cw in cols:
        dr.text((hx, 8), name, fill=(220, 220, 220, 255), font=LABEL_FONT)
        hx += cw + gap

    y = header_h
    for res in results:
        fn = res["fn"]
        tier = res["tier"]
        orig = res["orig"]
        baked = res["baked"]

        # label
        dr.text((6, y + 6), f"T{tier:02d}", fill=(255, 220, 120, 255), font=LABEL_FONT)
        # wrap filename (strip .png)
        name = fn[:-4]
        dr.text((6, y + 30), name, fill=(210, 210, 210, 255), font=LABEL_FONT_SM)

        x = label_w + gap
        # original
        o = orig.resize((256, 256), Image.LANCZOS)
        sheet.paste(o, (x, y))
        x += 256 + gap
        # baked
        b = baked.resize((256, 256), Image.LANCZOS)
        sheet.paste(b, (x, y))
        x += 256 + gap
        # simulated codex card
        card = baked.crop((0, int(0.27 * H), W, int(0.73 * H))).resize((178, 82), Image.LANCZOS)
        cy = y + (row_h - 82) // 2
        sheet.paste(card, (x, cy))
        dr.rectangle([x, cy, x + 178, cy + 82], outline=(120, 120, 120, 255), width=1)
        x += 178 + gap
        # word alone
        tile = res["tile"]
        ty = y + (row_h - 82) // 2
        sheet.paste(tile, (x, ty))
        dr.rectangle([x, ty, x + 64, ty + 82], outline=(120, 120, 120, 255), width=1)

        y += row_h + gap

    return sheet


def main():
    os.makedirs(BAKED_DIR, exist_ok=True)
    os.makedirs(OVER_DIR, exist_ok=True)

    # ---- sanity pass: every glyph must have real ink coverage ----
    print("=== Sanity: glyph ink coverage (bbox) ===")
    coverages = {}
    for fn, chars in WORDS.items():
        cov = []
        for ch in chars:
            c = glyph_bbox_ink(ch)
            cov.append(c)
            if not (0.08 <= c <= 0.60):
                print(f"FAIL .notdef?: {fn} char {ch!r} coverage={c:.3f}")
                sys.exit(1)
        coverages[fn] = cov
        print(f"  {fn:24s} {chars} -> {[f'{c*100:.1f}%' for c in cov]}")

    results = []
    tier = 0
    for fn, chars in WORDS.items():
        tier += 1
        src = os.path.join(SRC_DIR, fn)
        base = Image.open(src).convert("RGBA")
        base_lum = base.convert("L")
        base_lum_bytes = base_lum.tobytes()
        base_lum_rows = [base_lum_bytes[r * W:(r + 1) * W] for r in range(H)]

        before_metric = luminance_fraction_above(base_lum_bytes)

        overlay = build_overlay(chars, tier, base_lum_rows)
        baked = Image.alpha_composite(base, overlay)

        after_metric = luminance_fraction_above(baked.convert("L").tobytes())

        # residual old-glyph metric: panel only, NO word (word is legitimately white)
        overlay_panel = build_overlay(chars, tier, base_lum_rows, want_word=False)
        residual_metric = luminance_fraction_above(
            Image.alpha_composite(base, overlay_panel).convert("L").tobytes())

        # word bbox (white ink) for band-compliance check
        opx = overlay.load()
        wbox = (W, H, -1, -1)
        for y in range(int(BAND_TOP) - 40, int(BAND_BOT) + 40):
            for x in range(0, METRIC_X):
                r, g, b, a = opx[x, y]
                if a > 30 and r > 200 and g > 200 and b > 200:
                    if x < wbox[0]: wbox = (x, wbox[1], wbox[2], wbox[3])
                    if x > wbox[2]: wbox = (wbox[0], wbox[1], x, wbox[3])
                    if y < wbox[1]: wbox = (wbox[0], y, wbox[2], wbox[3])
                    if y > wbox[3]: wbox = (wbox[0], wbox[1], wbox[2], y)
        band_ok = wbox[1] >= BAND_TOP and wbox[3] <= BAND_BOT

        baked_path = os.path.join(BAKED_DIR, fn)
        over_path = os.path.join(OVER_DIR, fn)
        baked.save(baked_path, "PNG")
        overlay.save(over_path, "PNG")

        tile = render_word_tile(chars, 64, 82)

        results.append({
            "fn": fn, "tier": tier, "chars": chars,
            "orig": base, "baked": baked, "tile": tile,
            "before": before_metric, "after": after_metric,
            "residual": residual_metric, "wbox": wbox, "band_ok": band_ok,
            "baked_path": baked_path, "over_path": over_path,
        })
        bs = os.path.getsize(baked_path)
        os_ = os.path.getsize(over_path)
        print(f"  [{tier:02d}] {fn:22s} baked={bs:>9d}B  overlay={os_:>9d}B")
        print(f"       lum>200 x<0.40W: before={before_metric*100:.3f}%  "
              f"after_raw={after_metric*100:.4f}% (incl. new word)  "
              f"residual_panel_only={residual_metric*100:.4f}%")
        print(f"       word_bbox={wbox} band=[{BAND_TOP:.0f},{BAND_BOT:.0f}] "
              f"{'OK' if band_ok else 'VIOLATION'}")

    sheet = make_contact_sheet(results)
    sheet_path = os.path.join(OVER_DIR, "CONTACT_SHEET.png")
    sheet.save(sheet_path, "PNG")
    print(f"CONTACT_SHEET -> {sheet_path} ({os.path.getsize(sheet_path)}B)")

    # stash coverages for reporting
    with open(os.path.join(OVER_DIR, "_coverages.txt"), "w", encoding="utf-8") as f:
        for fn, cov in coverages.items():
            f.write(f"{fn}\t{['%.3f'%c for c in cov]}\n")

    print("DONE")


if __name__ == "__main__":
    main()
