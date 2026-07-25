import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyMercadoPagoSignature, buildManifest, parseXSignature } from "../src/payments/signature.js";

const SECRET = "test-webhook-secret-123";

function signedHeader(dataId: string, requestId: string, ts: string, secret = SECRET) {
  const manifest = buildManifest({ dataId, requestId, ts });
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("mercado pago signature", () => {
  it("monta o manifesto no formato oficial", () => {
    expect(buildManifest({ dataId: "12345", requestId: "req-9", ts: "1700000000" })).toBe(
      "id:12345;request-id:req-9;ts:1700000000;",
    );
  });

  it("id alfanumérico é normalizado para minúsculo", () => {
    expect(buildManifest({ dataId: "ABC123", requestId: "r", ts: "1" })).toBe("id:abc123;request-id:r;ts:1;");
  });

  it("parseia x-signature", () => {
    expect(parseXSignature("ts=1700000000,v1=deadbeef")).toEqual({ ts: "1700000000", v1: "deadbeef" });
    expect(parseXSignature("")).toBeNull();
    expect(parseXSignature("v1=x")).toBeNull();
  });

  it("assinatura válida é aceita", () => {
    const ts = "1700000000";
    const header = signedHeader("999", "req-1", ts);
    const r = verifyMercadoPagoSignature({ xSignature: header, xRequestId: "req-1", dataId: "999", secret: SECRET });
    expect(r.valid).toBe(true);
  });

  it("secret errado é rejeitado", () => {
    const header = signedHeader("999", "req-1", "1700000000", "outro-secret");
    const r = verifyMercadoPagoSignature({ xSignature: header, xRequestId: "req-1", dataId: "999", secret: SECRET });
    expect(r.valid).toBe(false);
  });

  it("dataId adulterado é rejeitado", () => {
    const header = signedHeader("999", "req-1", "1700000000");
    const r = verifyMercadoPagoSignature({ xSignature: header, xRequestId: "req-1", dataId: "1000", secret: SECRET });
    expect(r.valid).toBe(false);
  });

  it("x-signature ausente é rejeitado", () => {
    const r = verifyMercadoPagoSignature({ xSignature: null, xRequestId: "req-1", dataId: "999", secret: SECRET });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/x-signature/);
  });

  it("replay fora da tolerância é rejeitado", () => {
    const ts = "1000000000"; // muito antigo
    const header = signedHeader("999", "req-1", ts);
    const r = verifyMercadoPagoSignature({
      xSignature: header,
      xRequestId: "req-1",
      dataId: "999",
      secret: SECRET,
      toleranceSeconds: 300,
      now: new Date("2026-07-25T12:00:00Z"),
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/replay/);
  });
});
