# -*- coding: utf-8 -*-
import os, re, urllib.request

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
outdir = os.path.join(base, "assets", "build", "fonts")
os.makedirs(outdir, exist_ok=True)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36"

families = [
    ("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&display=swap", "fraunces"),
    ("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap", "inter"),
]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8")

wanted = {"latin"}
faces = []
for css_url, prefix in families:
    css = fetch(css_url)
    blocks = re.split(r"/\*\s*([\w-]+)\s*\*/", css)
    i = 1
    while i < len(blocks) - 1:
        subset = blocks[i].strip()
        body = blocks[i + 1]
        i += 2
        if subset not in wanted:
            continue
        style = re.search(r"font-style:\s*(\w+)", body)
        weight = re.search(r"font-weight:\s*(\d+)\s*(\d+)?", body)
        urlm = re.search(r"src:\s*url\((https://[^)]+\.woff2)\)", body)
        if not urlm:
            continue
        st = style.group(1) if style else "normal"
        wt = weight.group(1) if weight else "400"
        fn = f"{prefix}-{wt}-{st}-{subset}.woff2"
        data = urllib.request.urlopen(urllib.request.Request(urlm.group(1), headers={"User-Agent": UA}), timeout=60).read()
        open(os.path.join(outdir, fn), "wb").write(data)
        faces.append(fn)
        print(f"{fn:38} {len(data)//1024} KB")

print("\nTotal files:", len(faces))
