import os, sys
from PIL import Image, ImageFont, ImageFilter

print("Python:", sys.version)
import PIL
print("Pillow:", PIL.__version__)

SRC_DIR = "C:/Users/37615/Projects/game/build/h5-fallback/assets/codex"
FONT = "C:/Windows/Fonts/STXINGKA.TTF"

print("--- source dir exists:", os.path.isdir(SRC_DIR))
if os.path.isdir(SRC_DIR):
    files = sorted(os.listdir(SRC_DIR))
    print("source files count:", len(files))
    for f in files:
        p = os.path.join(SRC_DIR, f)
        try:
            im = Image.open(p)
            print(f"  {f:28s} {im.size} {im.mode}")
        except Exception as e:
            print(f"  {f:28s} ERROR {e}")

print("--- font exists:", os.path.isfile(FONT))

# effect_noise availability
try:
    n = Image.effect_noise((16,16), 50)
    print("effect_noise OK:", n.size, n.mode)
except Exception as e:
    print("effect_noise FAIL:", e)

# Font load + glyph coverage
WORDS = {
    "01_坂田银时.png": ["万","事"],
    "02_志村新八.png": ["眼","镜"],
    "03_神乐.png": ["夜","兔"],
    "04_定春.png": ["犬","神"],
    "05_近藤勋.png": ["猩","猩"],
    "06_土方十四郎.png": ["蛋","黄","酱"],
    "07_冲田总悟.png": ["抖","S"],
    "08_桂小太郎.png": ["攘","夷"],
    "09_伊丽莎白.png": ["看","板"],
    "10_高杉晋助.png": ["鬼","兵"],
    "11_神威.png": ["春","雨"],
    "12_虚_吉田松阳.png": ["虚"],
}

if os.path.isfile(FONT):
    font = ImageFont.truetype(FONT, 200)
    for fn, chars in WORDS.items():
        covs = []
        for ch in chars:
            img = Image.new("L", (400,400), 0)
            d = ImageDraw if False else None
            from PIL import ImageDraw
            dr = ImageDraw.Draw(img)
            bbox = dr.textbbox((0,0), ch, font=font)
            w = bbox[2]-bbox[0]; h = bbox[3]-bbox[1]
            dr.text((200 - (bbox[0]+bbox[2])//2, 200 - (bbox[1]+bbox[3])//2), ch, fill=255, font=font)
            # crop to ink bbox
            bbox2 = img.getbbox()
            if bbox2 is None:
                covs.append("EMPTY")
                continue
            crop = img.crop(bbox2)
            px = crop.load()
            cw, chh = crop.size
            ink = sum(1 for y in range(chh) for x in range(cw) if px[x,y] > 20)
            cov = ink / (cw*chh)
            covs.append(f"{cov*100:.1f}%")
        print(f"  {fn:24s} {chars} -> {covs}")
