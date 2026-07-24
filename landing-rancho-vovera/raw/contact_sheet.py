# -*- coding: utf-8 -*-
import os, glob
from PIL import Image, ImageDraw, ImageFont

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
imgdir = os.path.join(base, "assets", "img", "airbnb")
files = sorted(glob.glob(os.path.join(imgdir, "*.jpg")))

cols = 8
cell = 300
label_h = 26
rows = (len(files) + cols - 1) // cols
W = cols * cell
H = rows * (cell + label_h)
sheet = Image.new("RGB", (W, H), (20, 20, 20))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arialbd.ttf", 20)
except Exception:
    font = ImageFont.load_default()

for idx, f in enumerate(files):
    r, c = divmod(idx, cols)
    x = c * cell
    y = r * (cell + label_h)
    im = Image.open(f).convert("RGB")
    im.thumbnail((cell, cell))
    ox = x + (cell - im.width) // 2
    oy = y + label_h + (cell - im.height) // 2
    sheet.paste(im, (ox, oy))
    name = os.path.basename(f).replace(".jpg", "")
    draw.text((x + 4, y + 3), name, fill=(255, 220, 120), font=font)

out = os.path.join(base, "raw", "contact-sheet.png")
sheet.save(out, quality=85)
print("saved", out, sheet.size)
