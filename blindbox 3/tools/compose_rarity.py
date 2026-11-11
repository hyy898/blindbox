#!/usr/bin/env python3
from PIL import Image
from pathlib import Path
import sys
root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
ids = ["ms-01", "ms-04", "ms-06", "ms-07"]
imgs = [Image.open(root / f"_rarity_{i}.png") for i in ids]
w, h = imgs[0].size
cw = 770
left = max(0, (w - cw) // 2)
cropped = [im.crop((left, 0, left + cw, h)) for im in imgs]
out = Image.new("RGB", (cw * 4, h))
for i, im in enumerate(cropped):
    out.paste(im, (i * cw, 0))
out.save(root / "09-rarity-compare.png", "PNG")
for i in ids:
    (root / f"_rarity_{i}.png").unlink(missing_ok=True)
print("composed 09-rarity-compare.png", out.size)
