# -*- coding: utf-8 -*-
import os
from PIL import Image
OUT = r"C:\Users\MIGUEL~1\AppData\Local\Temp\claude\C--Users-Miguel-Galv-o-Documents-execflow\747ddf52-101a-4b31-ab18-e108f8146d63\scratchpad"

def slice(name, parts, prefix, capw=1200):
    im = Image.open(os.path.join(OUT, name)).convert("RGB")
    w, h = im.size
    seg = h // parts
    res = []
    for i in range(parts):
        y0 = i * seg
        y1 = h if i == parts - 1 else (i + 1) * seg + 40
        c = im.crop((0, y0, w, y1))
        if c.width > capw:
            r = capw / c.width
            c = c.resize((capw, int(c.height * r)))
        fn = f"{prefix}-{i+1}.png"
        c.save(os.path.join(OUT, fn))
        res.append(fn)
    print(name, "h=", h, "->", res)

slice("cdp-desk.png", 7, "D")
slice("cdp-mob.png", 6, "M", capw=430)
