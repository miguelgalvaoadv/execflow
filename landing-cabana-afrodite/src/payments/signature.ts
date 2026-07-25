/**
 * Validação da assinatura do webhook do Mercado Pago (esquema atual — conferido
 * na documentação oficial em jul/2026).
 *
 * Header `x-signature`: "ts=<timestamp>,v1=<hmac_hex>"
 * Header `x-request-id`: <request id>
 * Query `data.id`: id do recurso (minúsculo se alfanumérico)
 *
 * Manifesto: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * (segmentos ausentes são omitidos)
 * HMAC-SHA256(hex) com a chave secreta do webhook, comparado a v1 (timing-safe).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface MpSignatureParts {
  ts: string;
  v1: string;
}

export function parseXSignature(header: string | undefined | null): MpSignatureParts | null {
  if (!header) return null;
  const parts: Record<string, string> = {};
  for (const seg of header.split(",")) {
    const idx = seg.indexOf("=");
    if (idx < 0) continue;
    const k = seg.slice(0, idx).trim();
    const v = seg.slice(idx + 1).trim();
    if (k) parts[k] = v;
  }
  if (!parts.ts || !parts.v1) return null;
  return { ts: parts.ts, v1: parts.v1 };
}

export function buildManifest(params: { dataId?: string | null; requestId?: string | null; ts: string }): string {
  const segs: string[] = [];
  if (params.dataId != null && params.dataId !== "") segs.push(`id:${params.dataId.toLowerCase()};`);
  if (params.requestId != null && params.requestId !== "") segs.push(`request-id:${params.requestId};`);
  segs.push(`ts:${params.ts};`);
  return segs.join("");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface VerifyInput {
  xSignature: string | undefined | null;
  xRequestId: string | undefined | null;
  dataId: string | undefined | null;
  secret: string;
  /** Tolerância opcional de replay (segundos). 0 = desativado. */
  toleranceSeconds?: number;
  now?: Date;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

export function verifyMercadoPagoSignature(input: VerifyInput): VerifyResult {
  if (!input.secret) return { valid: false, reason: "webhook secret ausente" };
  const parsed = parseXSignature(input.xSignature);
  if (!parsed) return { valid: false, reason: "x-signature ausente ou malformado" };

  if (input.toleranceSeconds && input.toleranceSeconds > 0) {
    const tsMs = Number(parsed.ts) * (parsed.ts.length > 12 ? 1 : 1000);
    const now = (input.now ?? new Date()).getTime();
    if (Number.isFinite(tsMs) && Math.abs(now - tsMs) > input.toleranceSeconds * 1000) {
      return { valid: false, reason: "timestamp fora da tolerância (possível replay)" };
    }
  }

  const manifest = buildManifest({ dataId: input.dataId, requestId: input.xRequestId, ts: parsed.ts });
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  return safeEqualHex(expected, parsed.v1)
    ? { valid: true }
    : { valid: false, reason: "assinatura não confere" };
}
