/**
 * Abstração de e-mail transacional.
 *   - dev (padrão/mock): registra o envio, sem rede. Nunca falha o fluxo.
 *   - resend:            envia via API do Resend (EMAIL_API_KEY).
 *   - brevo:             stub preparado (mesma interface) — completar quando escolhido.
 *
 * Recomendado para baixo volume: Resend (100 e-mails/dia grátis) ou Brevo
 * (300/dia grátis). Ambos exigem domínio verificado para produção.
 * O sistema NUNCA quebra se o e-mail falhar — apenas registra o erro.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
export interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}
export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage, from: string): Promise<EmailResult>;
}

export class DevEmailProvider implements EmailProvider {
  readonly name = "dev";
  sent: EmailMessage[] = [];
  async send(msg: EmailMessage, _from?: string): Promise<EmailResult> {
    this.sent.push(msg);
    return { ok: true, id: `dev-${this.sent.length}` };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {}
  async send(msg: EmailMessage, from: string): Promise<EmailResult> {
    try {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body?.message ?? `Resend ${res.status}` };
      return { ok: true, id: body?.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export function createEmailProvider(opts: { provider: string; apiKey: string | null; fetchImpl?: typeof fetch }): EmailProvider {
  switch (opts.provider) {
    case "resend":
      if (!opts.apiKey) return new DevEmailProvider();
      return new ResendEmailProvider(opts.apiKey, opts.fetchImpl);
    // case "brevo": return new BrevoEmailProvider(...);  // preparar quando escolhido
    default:
      return new DevEmailProvider();
  }
}
