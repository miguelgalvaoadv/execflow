# -*- coding: utf-8 -*-
import json, os, subprocess, sys

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
photos = json.load(open(os.path.join(base, "raw", "airbnb-photos.json"), encoding="utf-8"))
outdir = os.path.join(base, "assets", "img", "airbnb")
os.makedirs(outdir, exist_ok=True)

REFERER = "https://www.airbnb.com.br/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

ok = 0
fail = []
for p in photos:
    i = p["i"]
    w = 1440  # largura VÁLIDA do Airbnb (2048 dá "not found")
    url = p["url"] + "?im_w=" + str(w)
    fname = f"{i:02d}-{p['o']}.jpg"
    dest = os.path.join(outdir, fname)
    r = subprocess.run(
        ["curl.exe", "-s", "-L", "-e", REFERER, "-A", UA, "-o", dest, url],
        capture_output=True,
    )
    size = os.path.getsize(dest) if os.path.exists(dest) else 0
    if r.returncode == 0 and size > 5000:
        ok += 1
        print(f"OK {fname}  {size//1024} KB")
    else:
        fail.append((fname, size, r.returncode))
        print(f"FAIL {fname}  size={size} rc={r.returncode}")

print(f"\nTotal OK: {ok}/{len(photos)}  Fails: {len(fail)}")
for f in fail:
    print("  ", f)
