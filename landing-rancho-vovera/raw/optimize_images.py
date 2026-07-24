# -*- coding: utf-8 -*-
import os
from PIL import Image, ImageOps

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(base, "assets", "img", "airbnb")
out = os.path.join(base, "assets", "build", "img")
os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    if f.endswith(".webp"):
        os.remove(os.path.join(out, f))

# fotos grandes (hero / destaques do mosaico) em resolução maior
HERO = {"82-L", "00-L", "12-L", "01-L", "02-L", "13-L", "15-L", "72-L"}
# filler fraco: não exportar
SKIP = {"79-L", "80-P"}

def opt(fn):
    key = fn[:-4]
    im = Image.open(os.path.join(src, fn)).convert("RGB")
    im = ImageOps.exif_transpose(im)
    if key in HERO:
        maxw, q = 1500, 72
    else:
        maxw, q = 880, 63
    if im.width > maxw:
        r = maxw / im.width
        im = im.resize((maxw, int(im.height * r)), Image.LANCZOS)
    dest = os.path.join(out, key + ".webp")
    im.save(dest, "WEBP", quality=q, method=6)
    return os.path.getsize(dest)

total = 0
n = 0
for fn in sorted(os.listdir(src)):
    if fn.endswith(".jpg") and fn[:-4] not in SKIP:
        s = opt(fn)
        total += s
        n += 1
print(f"\n{n} imagens · TOTAL build img: {total//1024} KB  (base64 ~{int(total*1.34)//1024} KB)")
