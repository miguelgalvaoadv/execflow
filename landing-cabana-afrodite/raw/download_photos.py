# -*- coding: utf-8 -*-
import json, os, urllib.request, ssl

base = r"C:\Users\Miguel Galvão\Documents\execflow\landing-cabana-afrodite"
media = json.load(open(os.path.join(base, "raw", "media-raw.json"), encoding="utf-8"))

# categoria por faixa de indice (ordem do tour de fotos do Airbnb)
def cat_for(i):
    if i <= 3:   return "sala"
    if i <= 10:  return "cozinha"
    if i <= 19:  return "jantar"
    if i <= 24:  return "quarto"
    if i <= 30:  return "banheiro"
    if i <= 37:  return "exterior"
    if i == 38:  return "lareira"
    if i <= 43:  return "adega"
    return "extra"

LABELS = {
    "sala": "Sala de estar", "cozinha": "Cozinha", "jantar": "Sala de jantar",
    "quarto": "Quarto", "banheiro": "Banheiro", "exterior": "Área externa",
    "lareira": "Lareira", "adega": "Adega / carrinho bar", "extra": "Cabana Afrodite",
}

photos = []
for m in media:
    c = cat_for(m["i"])
    photos.append({"i": m["i"], "uuid": m["uuid"], "cat": c,
                   "label": LABELS[c], "orient": m["o"]})

json.dump(photos, open(os.path.join(base, "raw", "airbnb-photos.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

outdir = os.path.join(base, "assets", "img", "airbnb")
os.makedirs(outdir, exist_ok=True)
BASEURL = "https://a0.muscache.com/im/pictures/hosting/Hosting-1309401960357292675/original/{}.jpeg"
hdr = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

ok = fail = 0
for p in photos:
    fname = f"{p['i']:03d}-{p['cat']}.jpg"
    dest = os.path.join(outdir, fname)
    if os.path.exists(dest) and os.path.getsize(dest) > 5000:
        ok += 1; continue
    url = BASEURL.format(p["uuid"])
    try:
        req = urllib.request.Request(url, headers=hdr)
        with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
            data = r.read()
        open(dest, "wb").write(data)
        ok += 1
        print(f"OK  {fname}  {len(data)//1024} KB")
    except Exception as e:
        fail += 1
        print(f"FAIL {fname}: {e}")

print(f"\nTotal OK={ok} FAIL={fail}  files={len(os.listdir(outdir))}")
