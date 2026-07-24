# -*- coding: utf-8 -*-
import subprocess, time, json, os, urllib.request, base64
import websocket

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not os.path.exists(EDGE):
    EDGE = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
OUT = r"C:\Users\MIGUEL~1\AppData\Local\Temp\claude\C--Users-Miguel-Galv-o-Documents-execflow\747ddf52-101a-4b31-ab18-e108f8146d63\scratchpad"
os.makedirs(OUT, exist_ok=True)
PORT = 9347

def cdp(url, w, h, outfile, full=True, settle=3.0):
    udd = r"C:\Users\MIGUEL~1\AppData\Local\Temp\edge-cdp-%d" % PORT
    p = subprocess.Popen([EDGE, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
        "--force-device-scale-factor=1", "--remote-debugging-port=%d" % PORT, "--remote-allow-origins=*",
        "--user-data-dir=" + udd, "--window-size=%d,%d" % (w, h), url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws_url = None
        for _ in range(50):
            try:
                j = json.load(urllib.request.urlopen("http://127.0.0.1:%d/json" % PORT, timeout=1))
                for t in j:
                    if t.get("type") == "page":
                        ws_url = t["webSocketDebuggerUrl"]; break
                if ws_url: break
            except Exception:
                time.sleep(.3)
        ws = websocket.create_connection(ws_url, max_size=None, timeout=45)
        i = [0]
        def send(method, params=None):
            i[0] += 1; ws.send(json.dumps({"id": i[0], "method": method, "params": params or {}}))
            while True:
                m = json.loads(ws.recv())
                if m.get("id") == i[0]: return m
        send("Page.enable")
        send("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": w < 600})
        time.sleep(settle)
        send("Runtime.enable")
        send("Runtime.evaluate", {"expression":
            "var s=document.createElement('style');s.textContent='.reveal{opacity:1!important;transform:none!important}*{animation:none!important}';document.head.appendChild(s);"
            "document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in'));'ok'"})
        time.sleep(1.4)
        r = send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": bool(full), "fromSurface": True})
        data = base64.b64decode(r["result"]["data"])
        open(os.path.join(OUT, outfile), "wb").write(data)
        print(outfile, len(data)//1024, "KB")
        ws.close()
    finally:
        p.terminate(); time.sleep(1)

if __name__ == "__main__":
    U = "http://127.0.0.1:8823/index-dev.html"
    cdp(U, 1440, 900, "cdp-desk.png")
    cdp(U, 390, 844, "cdp-mob.png")
