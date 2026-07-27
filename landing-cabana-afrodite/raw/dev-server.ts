/**
 * Mini dev-server LOCAL (não é produção) — serve o site/ estático e roteia
 * /api/* para as Netlify Functions reais, em modo mock. Rodar: npx tsx raw/dev-server.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// Modo mock (memória + Mercado Pago simulado) — nenhuma credencial necessária.
process.env.APP_ENV ??= "mock";
process.env.SITE_URL ??= "http://localhost:3000";
process.env.ICAL_EXPORT_TOKEN ??= "dev-token";

const ROOT = fileURLToPath(new URL("../site", import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".ics": "text/calendar; charset=utf-8", ".ico": "image/x-icon",
};

// Mapa de rotas /api/* -> nome do arquivo em netlify/functions (espelha o netlify.toml)
function resolveApi(method: string, path: string): { file: string; query: Record<string, string> } | null {
  const q: Record<string, string> = {};
  if (path === "/api/availability") return { file: "availability", query: q };
  if (path === "/api/reservations" && method === "POST") return { file: "create-reservation", query: q };
  if (path === "/api/pay") return { file: "create-preference", query: q };
  if (path === "/api/webhooks/mercadopago") return { file: "mercadopago-webhook", query: q };
  let m = path.match(/^\/api\/reservations\/([^/]+)$/);
  if (m) return { file: "get-reservation", query: { token: decodeURIComponent(m[1]!) } };
  m = path.match(/^\/api\/calendar\/(.+)$/);
  if (m) return { file: "ical-export", query: { file: decodeURIComponent(m[1]!) } };
  if (path === "/api/reconcile") return { file: "reconcile", query: q };
  m = path.match(/^\/api\/admin\/(.+)$/);
  if (m) return { file: `admin-${m[1]}`, query: q };
  return null;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, route: { file: string; query: Record<string, string> }) {
  const mod = await import(`../netlify/functions/${route.file}.ts`).catch(() => null);
  if (!mod?.default) { res.writeHead(404).end("função não encontrada: " + route.file); return; }

  const url = new URL(req.url!, `http://localhost:${PORT}`);
  for (const [k, v] of Object.entries(route.query)) url.searchParams.set(k, v);

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("x-nf-client-connection-ip", "127.0.0.1");

  const request = new Request(url.toString(), { method: req.method, headers, body: body?.length ? body : undefined });
  try {
    const response: Response = await mod.default(request);
    const buf = Buffer.from(await response.arrayBuffer());
    const h: Record<string, string> = {};
    response.headers.forEach((v, k) => (h[k] = v));
    res.writeHead(response.status, h).end(buf);
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: (e as Error).message }));
  }
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  let path = decodeURIComponent(new URL(req.url!, `http://localhost:${PORT}`).pathname);
  if (path === "/" || path.endsWith("/")) path += "index.html";
  const full = normalize(join(ROOT, path));
  if (!full.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const s = await stat(full);
    if (s.isDirectory()) { res.writeHead(301, { location: path + "/" }).end(); return; }
    const data = await readFile(full);
    res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" }).end(data);
  } catch {
    // SPA-ish fallback: rotas /reserva/... e ?reserva= abrem a home
    const home = await readFile(join(ROOT, "index.html")).catch(() => null);
    if (home) res.writeHead(200, { "content-type": MIME[".html"]! }).end(home);
    else res.writeHead(404).end("não encontrado");
  }
}

createServer(async (req, res) => {
  const path = new URL(req.url!, `http://localhost:${PORT}`).pathname;
  const api = path.startsWith("/api/") ? resolveApi(req.method ?? "GET", path) : null;
  if (api) return handleApi(req, res, api);
  return serveStatic(req, res);
}).listen(PORT, () => {
  console.log(`Cabana Afrodite (mock) em http://localhost:${PORT}`);
});
