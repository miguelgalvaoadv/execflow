import type { Cents } from "../domain/money.js";

export type PaymentStatus =
  | "pending"
  | "approved"
  | "authorized"
  | "in_process"
  | "in_mediation"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back";

export interface CreatePreferenceInput {
  externalReference: string;
  title: string;
  amountCents: Cents;
  currency: "BRL";
  quantity?: number;
  payer?: { name?: string; email?: string };
  backUrls: { success: string; pending: string; failure: string };
  notificationUrl: string;
  expiresAt?: string | null; // ISO
  maxInstallments?: number;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface Preference {
  id: string;
  initPoint: string; // URL do checkout hospedado
  sandboxInitPoint?: string;
  externalReference: string;
}

export interface PaymentInfo {
  id: string;
  status: PaymentStatus;
  statusDetail?: string;
  externalReference: string | null;
  amountCents: Cents;
  currency: string;
  liveMode: boolean; // false em sandbox/teste
  raw?: unknown;
}

export interface PaymentProvider {
  readonly mode: "mock" | "sandbox" | "production";
  createPreference(input: CreatePreferenceInput): Promise<Preference>;
  getPayment(paymentId: string): Promise<PaymentInfo>;
}
