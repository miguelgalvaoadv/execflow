/** Modelos de mensagem (texto). Sem dados sensíveis além do necessário. */
export interface TemplateData {
  code?: string;
  checkIn?: string;
  checkOut?: string;
  trackUrl?: string;
  payUrl?: string;
  firstName?: string;
}

const T: Record<string, (d: TemplateData) => { subject: string; text: string }> = {
  request_received: (d) => ({
    subject: `Recebemos sua solicitação — Cabana Afrodite (${d.code})`,
    text: `Olá${d.firstName ? " " + d.firstName : ""}! Recebemos sua solicitação ${d.code} para ${d.checkIn} a ${d.checkOut}. Assim que confirmarmos a disponibilidade, enviamos o link de pagamento. Acompanhe: ${d.trackUrl ?? ""}`,
  }),
  request_approved: (d) => ({
    subject: `Sua reserva foi aprovada — pague para confirmar (${d.code})`,
    text: `Boas notícias! Sua solicitação ${d.code} (${d.checkIn} a ${d.checkOut}) foi aprovada. Conclua o pagamento seguro pelo Mercado Pago: ${d.payUrl ?? d.trackUrl ?? ""}`,
  }),
  request_rejected: (d) => ({
    subject: `Sobre sua solicitação ${d.code} — Cabana Afrodite`,
    text: `Infelizmente não conseguimos confirmar as datas ${d.checkIn} a ${d.checkOut} da solicitação ${d.code}. Fale conosco para ver outras opções.`,
  }),
  payment_link: (d) => ({
    subject: `Link de pagamento — Cabana Afrodite (${d.code})`,
    text: `Para confirmar sua reserva ${d.code}, conclua o pagamento: ${d.payUrl ?? d.trackUrl ?? ""}`,
  }),
  reservation_confirmed: (d) => ({
    subject: `Reserva confirmada! 🎉 Cabana Afrodite (${d.code})`,
    text: `Sua reserva ${d.code} está confirmada para ${d.checkIn} a ${d.checkOut}. Até breve na Cabana Afrodite! Detalhes: ${d.trackUrl ?? ""}`,
  }),
  reservation_cancelled: (d) => ({
    subject: `Reserva cancelada — Cabana Afrodite (${d.code})`,
    text: `Sua reserva ${d.code} (${d.checkIn} a ${d.checkOut}) foi cancelada. Se houver valor a reembolsar, entraremos em contato com as orientações.`,
  }),
  reservation_expired: (d) => ({
    subject: `Prazo de pagamento expirado — ${d.code}`,
    text: `O prazo de pagamento da solicitação ${d.code} expirou e as datas foram liberadas. Se ainda tiver interesse, faça uma nova solicitação.`,
  }),
};

export function renderTemplate(name: string, data: TemplateData): { subject: string; text: string } | null {
  const fn = T[name];
  return fn ? fn(data) : null;
}
