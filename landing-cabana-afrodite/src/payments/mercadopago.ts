/**
 * Adapter do Mercado Pago Checkout Pro.
 *   - mock:        sem rede (dev/testes). Guarda pagamentos simulados em memória.
 *   - sandbox:     API real com credenciais de TESTE.
 *   - production:  API real com credenciais de produção.
 *
 * Usa a API REST oficial (api.mercadopago.com). O SDK oficial `mercadopago`
 * pode ser plugado no lugar de `realFetch` mantendo a mesma interface.
 * NUNCA processa dados de cartão — o checkout é 100% hospedado pelo MP.
 */
import type {
  CreatePreferenceInput,
  PaymentInfo,
  PaymentProvider,
  PaymentStatus,
  Preference,
} from "./types.js";

const API = "https://api.mercadopago.com";

function centsToUnit(cents: number): number {
  return Math.round(cents) / 100;
}

// ----------------------------- MOCK -----------------------------
export class MockMercadoPago implements PaymentProvider {
  readonly mode = "mock" as const;
  private payments = new Map<string, PaymentInfo>();
  private prefs = new Map<string, Preference>();

  async createPreference(input: CreatePreferenceInput): Promise<Preference> {
    const id = `mock-pref-${input.externalReference}`;
    const pref: Preference = {
      id,
      initPoint: `https://sandbox.mercadopago.com/checkout/mock/${id}`,
      sandboxInitPoint: `https://sandbox.mercadopago.com/checkout/mock/${id}`,
      externalReference: input.externalReference,
    };
    this.prefs.set(id, pref);
    return pref;
  }

  async getPayment(paymentId: string): Promise<PaymentInfo> {
    const found = this.payments.get(paymentId);
    if (found) return found;
    // padrão: pagamento aprovado fictício (para fluxos felizes em testes manuais)
    return {
      id: paymentId,
      status: "approved",
      externalReference: null,
      amountCents: 0,
      currency: "BRL",
      liveMode: false,
    };
  }

  /** Helper de teste: injeta um pagamento simulado com valores controlados. */
  seedPayment(p: PaymentInfo): void {
    this.payments.set(p.id, p);
  }
}

// --------------------------- REAL (sandbox/production) ---------------------------
export class RealMercadoPago implements PaymentProvider {
  constructor(
    public readonly mode: "sandbox" | "production",
    private accessToken: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit & { idempotencyKey?: string }): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
    if (init.idempotencyKey) headers["X-Idempotency-Key"] = init.idempotencyKey;
    const res = await this.fetchImpl(`${API}${path}`, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(`Mercado Pago ${res.status}: ${body?.message ?? text}`);
    }
    return body;
  }

  async createPreference(input: CreatePreferenceInput): Promise<Preference> {
    const body = {
      items: [
        {
          id: input.externalReference,
          title: input.title,
          quantity: input.quantity ?? 1,
          currency_id: input.currency,
          unit_price: centsToUnit(input.amountCents),
        },
      ],
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: {
        success: input.backUrls.success,
        pending: input.backUrls.pending,
        failure: input.backUrls.failure,
      },
      auto_return: "approved",
      ...(input.expiresAt ? { expires: true, expiration_date_to: input.expiresAt } : {}),
      payment_methods: {
        installments: input.maxInstallments ?? 12,
      },
      ...(input.payer?.email ? { payer: { email: input.payer.email, name: input.payer.name } } : {}),
      metadata: input.metadata ?? {},
    };
    const data = await this.request("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey: input.idempotencyKey,
    });
    return {
      id: String(data.id),
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point,
      externalReference: input.externalReference,
    };
  }

  async getPayment(paymentId: string): Promise<PaymentInfo> {
    const data = await this.request(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
    return {
      id: String(data.id),
      status: data.status as PaymentStatus,
      statusDetail: data.status_detail,
      externalReference: data.external_reference ?? null,
      amountCents: Math.round(Number(data.transaction_amount) * 100),
      currency: data.currency_id ?? "BRL",
      liveMode: Boolean(data.live_mode),
      raw: data,
    };
  }
}

export class PaymentNotConfiguredError extends Error {
  constructor() {
    super("Pagamento (Mercado Pago) ainda não configurado neste ambiente.");
    this.name = "PaymentNotConfiguredError";
  }
}

/** Placeholder usado quando o MP ainda não foi configurado: falha só ao ser usado. */
class NullMercadoPago implements PaymentProvider {
  constructor(public readonly mode: "sandbox" | "production") {}
  async createPreference(): Promise<Preference> { throw new PaymentNotConfiguredError(); }
  async getPayment(): Promise<PaymentInfo> { throw new PaymentNotConfiguredError(); }
}

export function createPaymentProvider(opts: {
  mode: "mock" | "sandbox" | "production";
  accessToken?: string | null;
  fetchImpl?: typeof fetch;
}): PaymentProvider {
  if (opts.mode === "mock") return new MockMercadoPago();
  // Sem token em sandbox/prod: não quebra o boot; as rotas de pagamento é que
  // retornam erro claro (permite subir o preview com Supabase antes do MP).
  if (!opts.accessToken) return new NullMercadoPago(opts.mode);
  return new RealMercadoPago(opts.mode, opts.accessToken, opts.fetchImpl);
}
