# -*- coding: utf-8 -*-
"""Build Cabana Afrodite landing page in two flavors:
   - embed  -> self-contained index.html + artifact.html (base64 images)
   - site   -> site/ folder for Netlify (external image files, light HTML)
"""
import json, os, base64, io, shutil
from PIL import Image, ImageOps

BASE = r"C:\Users\Miguel Galvão\Documents\execflow\landing-cabana-afrodite"
IMGDIR = os.path.join(BASE, "assets", "img", "airbnb")
photos = json.load(open(os.path.join(BASE, "raw", "airbnb-photos.json"), encoding="utf-8"))

BIG = {0, 1, 3, 80, 81, 82, 86}   # hero/featured -> larger + crisper

def encode(idx, longest, q):
    p = next(x for x in photos if x["i"] == idx)
    im = Image.open(os.path.join(IMGDIR, f"{idx:03d}-{p['cat']}.jpg"))
    im = ImageOps.exif_transpose(im).convert("RGB")
    w, h = im.size
    s = min(1.0, longest / max(w, h))
    if s < 1.0:
        im = im.resize((round(w*s), round(h*s)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
    return buf.getvalue()

# encode all once, keep bytes
BYTES = {}
for p in photos:
    i = p["i"]
    BYTES[i] = encode(i, 1400, 80) if i in BIG else encode(i, 860, 63)
total = sum(len(b) for b in BYTES.values())
print(f"images encoded: {len(BYTES)}  raw: {total/1e6:.2f} MB")

def datauri(i): return "data:image/jpeg;base64," + base64.b64encode(BYTES[i]).decode()
def filepath(i): return f"assets/img/{i:03d}.jpg"

# ---- fonts (embedded in both flavors; small)
def font_b64(name):
    return base64.b64encode(open(os.path.join(BASE, "assets", "fonts", name), "rb").read()).decode()
FR, JO = font_b64("fraunces.woff2"), font_b64("jost.woff2")

# ---- gallery order + filters
LABELS = {"sala":"Sala & lareira","cozinha":"Cozinha","jantar":"Sala de jantar","quarto":"Quarto",
          "banheiro":"Banheiro","exterior":"Área externa","lareira":"Sala & lareira","adega":"Adega","extra":"Mais fotos"}
FILTER = {"sala":"interior","cozinha":"interior","jantar":"interior","quarto":"quarto",
          "banheiro":"banho","exterior":"externa","lareira":"interior","adega":"interior","extra":"mais"}
order = []
def add(seq):
    for i in seq:
        if i not in order: order.append(i)
add([80,82,86,81,1,0,3])
add([x["i"] for x in photos if x["cat"]=="exterior"])
add([x["i"] for x in photos if x["cat"]=="quarto"])
add([x["i"] for x in photos if x["cat"]=="banheiro"])
add([x["i"] for x in photos if x["cat"] in ("sala","lareira")])
add([x["i"] for x in photos if x["cat"]=="jantar"])
add([x["i"] for x in photos if x["cat"]=="cozinha"])
add([x["i"] for x in photos if x["cat"]=="adega"])
add([x["i"] for x in photos])
catmap = {x["i"]: x["cat"] for x in photos}

TPL = open(os.path.join(BASE, "raw", "template.html"), encoding="utf-8").read()

BOOKING_HEAD = '<link rel="stylesheet" href="booking/booking.css">'
BOOKING_SCRIPT = '<script src="booking/booking.js" defer></script>'
BOOKING_SECTION = (
    '<section class="booking" id="reservar-online"><div class="wrap">'
    '<div class="bk-head rv"><p class="eyebrow">Reserva direta</p>'
    '<h2>Consulte datas e valores</h2>'
    '<p class="lead">Selecione o período, veja o preço na hora e envie sua solicitação. '
    'O pagamento é feito com segurança pelo Mercado Pago após a confirmação do anfitrião.</p></div>'
    '<div class="bk-card rv" id="bk-mount"></div></div></section>'
)

def render(src, include_booking=False):
    """src: function i->url string. Returns body-only HTML."""
    items = []
    for i in order:
        c = catmap[i]
        f = "banho" if c == "banheiro" else FILTER[c]
        lab = LABELS[c]
        items.append(
            f'<figure class="g-item" data-f="{f}" tabindex="0" role="button" aria-label="Ampliar: {lab}">'
            f'<img loading="lazy" decoding="async" src="{src(i)}" alt="Cabana Afrodite — {lab}"></figure>')
    html = (TPL
        .replace("__FR__", FR).replace("__JO__", JO)
        .replace("__HERO__", src(80)).replace("__EXP_INT__", src(1))
        .replace("__FEAT_TUB__", src(82)).replace("__FEAT_DECK__", src(86))
        .replace("__FEAT_VIEW__", src(81)).replace("__ROMANCE__", src(24))
        .replace("__CTA_BG__", src(80))
        .replace("<!--GALLERY-->", "\n".join(items)))
    if include_booking:
        html = (html
            .replace("<!--BOOKING_HEAD-->", BOOKING_HEAD)
            .replace("<!--BOOKING_SECTION-->", BOOKING_SECTION)
            .replace("<!--BOOKING_SCRIPT-->", BOOKING_SCRIPT))
    else:
        html = (html
            .replace("<!--BOOKING_HEAD-->", "")
            .replace("<!--BOOKING_SECTION-->", "")
            .replace("<!--BOOKING_SCRIPT-->", ""))
    return html

HEAD = ('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="description" content="Cabana Afrodite — refúgio A-frame na Serra do Rio de Janeiro. '
        'Banheira de hidromassagem, lareira e vista para a serra. 4,94 no Airbnb. Reserve pelo WhatsApp.">'
        '<meta name="theme-color" content="#0d1210">'
        '<meta property="og:title" content="Cabana Afrodite — refúgio A-frame na Serra do Rio">'
        '<meta property="og:description" content="Banheira de hidromassagem no deck, lareira e céu estrelado. '
        'Preferido dos hóspedes · 4,94 · Superhost.">'
        '<title>Cabana Afrodite · Refúgio A-frame na Serra do Rio</title></head><body>')
def wrap(body): return HEAD + body + "</body></html>"

# ---------- EMBED flavor (self-contained) ----------
embed = render(datauri)
open(os.path.join(BASE, "artifact.html"), "w", encoding="utf-8").write(embed)
open(os.path.join(BASE, "index.html"), "w", encoding="utf-8").write(wrap(embed))
print(f"WROTE index.html (self-contained)  {os.path.getsize(os.path.join(BASE,'index.html'))/1e6:.2f} MB")

# ---------- SITE flavor (Netlify, external images) ----------
SITE = os.path.join(BASE, "site")
if os.path.exists(SITE): shutil.rmtree(SITE)
os.makedirs(os.path.join(SITE, "assets", "img"), exist_ok=True)
for i, b in BYTES.items():
    open(os.path.join(SITE, "assets", "img", f"{i:03d}.jpg"), "wb").write(b)
os.makedirs(os.path.join(SITE, "booking"), exist_ok=True)
shutil.copy(os.path.join(BASE, "raw", "booking.css"), os.path.join(SITE, "booking", "booking.css"))
shutil.copy(os.path.join(BASE, "raw", "booking.js"), os.path.join(SITE, "booking", "booking.js"))
open(os.path.join(SITE, "index.html"), "w", encoding="utf-8").write(wrap(render(filepath, include_booking=True)))
# tiny netlify config (SPA-safe, long cache for images)
open(os.path.join(SITE, "netlify.toml"), "w", encoding="utf-8").write(
    '[[headers]]\n  for = "/assets/img/*"\n  [headers.values]\n    Cache-Control = "public, max-age=31536000, immutable"\n')
site_html = os.path.getsize(os.path.join(SITE, "index.html"))
img_total = sum(len(b) for b in BYTES.values())
print(f"WROTE site/index.html  {site_html/1024:.0f} KB  +  {len(BYTES)} imgs ({img_total/1e6:.2f} MB)")
