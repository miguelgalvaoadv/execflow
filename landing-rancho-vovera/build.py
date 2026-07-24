# -*- coding: utf-8 -*-
"""Monta index.html autossuficiente (fontes woff2 + imagens webp em base64) + artifact.html + index-dev.html."""
import os, base64, json

BASE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(BASE, "assets", "build", "fonts")
IMGS = os.path.join(BASE, "assets", "build", "img")

def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")

FONT_FACES = [
    ("Fraunces", "normal", 400, "fraunces-400-normal-latin.woff2"),
    ("Fraunces", "normal", 500, "fraunces-500-normal-latin.woff2"),
    ("Fraunces", "normal", 600, "fraunces-600-normal-latin.woff2"),
    ("Fraunces", "normal", 700, "fraunces-700-normal-latin.woff2"),
    ("Fraunces", "italic", 500, "fraunces-500-italic-latin.woff2"),
    ("Inter", "normal", 400, "inter-400-normal-latin.woff2"),
    ("Inter", "normal", 500, "inter-500-normal-latin.woff2"),
    ("Inter", "normal", 600, "inter-600-normal-latin.woff2"),
    ("Inter", "normal", 700, "inter-700-normal-latin.woff2"),
]

def fonts_css(embed=True):
    out = []
    for fam, st, wt, fn in FONT_FACES:
        p = os.path.join(FONTS, fn)
        if not os.path.exists(p):
            print("WARN missing font", fn); continue
        src = ("data:font/woff2;base64," + b64(p)) if embed else ("assets/build/fonts/" + fn)
        out.append("@font-face{font-family:'%s';font-style:%s;font-weight:%d;font-display:swap;"
                   "src:url(%s) format('woff2');}" % (fam, st, wt, src))
    return "\n".join(out)

def img_map(embed=True):
    m = {}
    for fn in sorted(os.listdir(IMGS)):
        if fn.endswith(".webp"):
            key = fn[:-5]
            m[key] = ("data:image/webp;base64," + b64(os.path.join(IMGS, fn))) if embed else ("assets/build/img/" + fn)
    return m

def wrap_doc(content):
    marker = "</style>"
    i = content.index(marker) + len(marker)
    head, body = content[:i], content[i:]
    return ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
            + head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n')

def render(embed):
    tpl = open(os.path.join(BASE, "src", "template.html"), encoding="utf-8").read()
    reviews = json.load(open(os.path.join(BASE, "raw", "reviews.json"), encoding="utf-8"))
    c = tpl.replace("/*__FONTS__*/", fonts_css(embed))
    c = c.replace("/*__IMG_MAP__*/", "const IMG=" + json.dumps(img_map(embed), ensure_ascii=False) + ";")
    c = c.replace("/*__REVIEWS__*/[]", json.dumps(reviews, ensure_ascii=False))
    for ph in ["/*__FONTS__*/", "/*__IMG_MAP__*/", "/*__REVIEWS__*/"]:
        if ph in c: print("!! placeholder ainda presente:", ph)
    return c

def main():
    # standalone (base64)
    content = render(embed=True)
    open(os.path.join(BASE, "index.html"), "w", encoding="utf-8").write(wrap_doc(content))
    print("OK index.html      %.2f MB" % (os.path.getsize(os.path.join(BASE, "index.html"))/1024/1024))
    # artifact (conteúdo puro)
    open(os.path.join(BASE, "artifact.html"), "w", encoding="utf-8").write(content)
    print("OK artifact.html   %.2f MB" % (os.path.getsize(os.path.join(BASE, "artifact.html"))/1024/1024))
    # dev (externo, leve)
    open(os.path.join(BASE, "index-dev.html"), "w", encoding="utf-8").write(wrap_doc(render(embed=False)))
    print("OK index-dev.html (externo)")
    print("fonts:", len(FONT_FACES), " imagens:", len(img_map(False)))

if __name__ == "__main__":
    main()
