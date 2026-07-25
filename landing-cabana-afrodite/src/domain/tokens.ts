/**
 * Tokens e referências não previsíveis (para URLs públicas de acompanhamento,
 * external_reference do Mercado Pago e token do calendário .ics).
 * Não expõem IDs sequenciais internos.
 */
import { randomBytes, randomUUID } from "node:crypto";

/** Token público opaco para a página de acompanhamento da reserva. */
export function publicToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** external_reference estável e único para o Mercado Pago. */
export function externalReference(): string {
  return `caf_${randomUUID()}`;
}

/** Código curto amigável exibido ao hóspede (não é segredo, apenas rótulo). */
export function friendlyCode(now: Date = new Date()): string {
  const y = now.getFullYear().toString().slice(2);
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `CAF-${y}-${rand}`;
}

export function newIcalExportToken(): string {
  return randomBytes(24).toString("hex");
}
