/** Modelos de mensagem (texto). Sem dados sensíveis além do necessário. */
export interface TemplateData {
  code?: string;
  checkIn?: string;
  checkOut?: string;
  trackUrl?: string;
  payUrl?: string;
  firstName?: string;
  adminUrl?: string;
  detail?: string;
  amount?: string;
  guestName?: string;
  checkInTime?: string;
  checkOutTime?: string;
}

/** Templates destinados ao ANFITRIÃO (nunca vão ao hóspede). */
export const ADMIN_TEMPLATES = new Set([
  "admin_new_request",
  "payment_needs_manual",
  "payment_mismatch",
  "payment_after_conflict",
  "airbnb_block_needed",
]);

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

  // ---------- hóspede: lembretes e avisos (spec §20) ----------
  payment_reminder: (d) => ({
    subject: `Lembrete: seu pagamento vence em breve — ${d.code}`,
    text: `Olá${d.firstName ? " " + d.firstName : ""}! A reserva ${d.code} (${d.checkIn} a ${d.checkOut}) ainda aguarda pagamento. Conclua antes do prazo para garantir as datas: ${d.payUrl ?? d.trackUrl ?? ""}`,
  }),
  payment_pending: (d) => ({
    subject: `Pagamento em processamento — ${d.code}`,
    text: `Recebemos seu pagamento da reserva ${d.code} e ele está sendo processado pelo Mercado Pago. Avisamos assim que for aprovado. Acompanhe: ${d.trackUrl ?? ""}`,
  }),
  refund_registered: (d) => ({
    subject: `Reembolso da reserva ${d.code}`,
    text: `Registramos o reembolso${d.amount ? " de " + d.amount : ""} referente à reserva ${d.code}. O prazo de compensação depende do meio de pagamento utilizado.${d.detail ? " " + d.detail : ""}`,
  }),
  checkin_reminder: (d) => ({
    subject: `Sua estadia está chegando! — Cabana Afrodite (${d.code})`,
    text: `Olá${d.firstName ? " " + d.firstName : ""}! Faltam poucos dias para sua estadia na Cabana Afrodite (${d.checkIn} a ${d.checkOut}). Check-in a partir das ${d.checkInTime ?? "15:00"} e check-out até ${d.checkOutTime ?? "11:00"}. Em breve enviamos as instruções de chegada.`,
  }),
  checkin_instructions: (d) => ({
    subject: `Instruções de chegada — Cabana Afrodite (${d.code})`,
    text: `Sua chegada é amanhã (${d.checkIn})! Check-in a partir das ${d.checkInTime ?? "15:00"} com self check-in por cofre de chaves.${d.detail ? " " + d.detail : ""} Qualquer dúvida, fale conosco pelo WhatsApp. Boa viagem!`,
  }),

  // ---------- anfitrião: alertas operacionais ----------
  admin_new_request: (d) => ({
    subject: `Nova solicitação de reserva — ${d.code}`,
    text: `Você recebeu uma nova solicitação (${d.code}) de ${d.guestName ?? "um hóspede"} para ${d.checkIn} a ${d.checkOut}. Confira a disponibilidade e aprove ou recuse no painel: ${d.adminUrl ?? ""}`,
  }),
  payment_needs_manual: (d) => ({
    subject: `AÇÃO NECESSÁRIA: pagamento recebido sem confirmação automática — ${d.code}`,
    text: `A reserva ${d.code} (${d.checkIn} a ${d.checkOut}) foi PAGA, mas não pôde ser confirmada automaticamente porque a sincronização com o Airbnb estava indisponível ou desatualizada.${d.detail ? " Detalhe: " + d.detail + "." : ""} Verifique manualmente a disponibilidade no Airbnb e confirme no painel: ${d.adminUrl ?? ""}`,
  }),
  payment_mismatch: (d) => ({
    subject: `ATENÇÃO: pagamento com valor divergente — ${d.code}`,
    text: `Recebemos um pagamento para a reserva ${d.code} cujo valor não corresponde ao esperado, por isso ela NÃO foi confirmada.${d.detail ? " " + d.detail + "." : ""} Analise no Mercado Pago e trate manualmente (confirmar ou reembolsar): ${d.adminUrl ?? ""}`,
  }),
  payment_after_conflict: (d) => ({
    subject: `URGENTE: pagamento recebido para datas indisponíveis — ${d.code}`,
    text: `A reserva ${d.code} (${d.checkIn} a ${d.checkOut}) foi paga, mas as datas ficaram INDISPONÍVEIS nesse intervalo (provável reserva concorrente no Airbnb). A reserva não foi confirmada. É necessário tratar manualmente — reembolso ou realocação: ${d.adminUrl ?? ""}`,
  }),
  airbnb_block_needed: (d) => ({
    subject: `Bloqueie estas datas no Airbnb — ${d.code}`,
    text: `A reserva ${d.code} foi CONFIRMADA para ${d.checkIn} a ${d.checkOut}. O Airbnb pode demorar horas para reimportar o calendário do site — bloqueie ou atualize essas datas manualmente no Airbnb AGORA para evitar dupla reserva. Painel: ${d.adminUrl ?? ""}`,
  }),
};

export function renderTemplate(name: string, data: TemplateData): { subject: string; text: string } | null {
  const fn = T[name];
  return fn ? fn(data) : null;
}
