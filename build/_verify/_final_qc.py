# -*- coding: utf-8 -*-
"""Final QC: list outputs, verify originals untouched (mtime intact), cleanup temp."""
import os, time

SRC = "C:/Users/37615/Projects/game/build/h5-fallback/assets/codex"
BAKED = "C:/Users/37615/Projects/game/build/assets/codex_baked"
OVER = "C:/Users/37615/Projects/game/build/assets/codex_calligraphy"

print("=== originals (untouched, read-only) ===")
for f in sorted(os.listdir(SRC)):
    st = os.stat(os.path.join(SRC, f))
    print(f"  {f:24s} {st.st_size:>9d}B  mtime={time.strftime('%Y-%m-%d %H:%M', time.localtime(st.st_mtime))}")

print("=== baked ===")
tb = 0
for f in sorted(os.listdir(BAKED)):
    st = os.stat(os.path.join(BAKED, f))
    tb += st.st_size
    print(f"  {f:24s} {st.st_size:>9d}B")
print(f"  total {tb}B")

print("=== overlay dir ===")
to = 0
for f in sorted(os.listdir(OVER)):
    st = os.stat(os.path.join(OVER, f))
    to += st.st_size
    print(f"  {f:24s} {st.st_size:>9d}B")
print(f"  total {to}B")

# cleanup temp debug images
for p in ["C:/Users/37615/Projects/game/build/_verify/_strips.png",
          "C:/Users/37615/Projects/game/build/_verify/_baked_left.png"]:
    if os.path.exists(p):
        os.remove(p)
        print("removed", p)
