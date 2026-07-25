import { getContext } from "../../src/runtime/context.js";
import { verifyMercadoPagoSignature } from "../../src/payments/signature.js";
import { json, methodGuard } from "./_shared.js";

/**
 * Webhook do Mercado Pago. NUNCA confia na URL de retorno do navegador.
 * Valida assinatura -> idempotência -> re-consulta API -> confere valor -> confirma.
 * Responde 200 rápido para o MP (evita reentregas), 401 se a assinatura falhar.
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;

  const { cfg, service } = getContext();
  const url = new URL(req.url);

  // data.id pode vir na query (?data.id=) ou no corpo
  let dataId = url.searchParams.get("data.id") || url.searchParams.get("id");
  let type = url.searchParams.get("type") || url.searchParams.get("topic");
  let rawBody: any = null;
  try { rawBody = await req.json(); } catch { /* corpo pode ser vazio */ }
  if (!dataId && rawBody?.data?.id) dataId = String(rawBody.data.id);
  if (!type && rawBody?.type) type = String(rawBody.type);

  // Só tratamos notificações de pagamento.
  if (type && type !== "payment") return json({ received: true, ignored: type }, 200);
  if (!dataId) return json({ received: true, note: "sem data.id" }, 200);

  // Validação de assinatura
  const secret = cfg.mp.webhookSecret;
  let signatureValid: boolean;
  if (secret) {
    const r = verifyMercadoPagoSignature({
      xSignature: req.headers.get("x-signature"),
      xRequestId: req.headers.get("x-request-id"),
      dataId,
      secret,
      toleranceSeconds: 600,
    });
    signatureValid = r.valid;
  } else {
    // Sem secret só é aceitável fora de produção (dev/mock).
    signatureValid = cfg.mode !== "production";
  }

  if (!signatureValid) return json({ error: "assinatura inválida" }, 401);

  try {
    const outcome = await service.processPaymentWebhook({
      signatureValid: true,
      eventKey: `payment:${dataId}`,
      paymentId: dataId,
      rawPayload: rawBody ?? {},
    });
    return json({ received: true, outcome: outcome.status }, 200);
  } catch {
    // Ainda respondemos 200 para o MP não reentregar em loop; erro fica logado.
    return json({ received: true, outcome: "error" }, 200);
  }
};
