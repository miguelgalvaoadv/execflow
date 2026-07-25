/**
 * Máquina de estados da reserva. Toda transição é explícita e registrada em
 * reservation_status_history. Transições não listadas são proibidas.
 */
export type ReservationStatus =
  | "pending_approval"
  | "rejected"
  | "awaiting_payment"
  | "payment_pending"
  | "paid"
  | "confirmed"
  | "cancelled"
  | "refunded"
  | "expired"
  | "completed";

export const ALL_STATUSES: ReservationStatus[] = [
  "pending_approval",
  "rejected",
  "awaiting_payment",
  "payment_pending",
  "paid",
  "confirmed",
  "cancelled",
  "refunded",
  "expired",
  "completed",
];

/** Transições permitidas (from -> to[]). */
const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending_approval: ["awaiting_payment", "rejected", "cancelled", "expired"],
  rejected: [],
  awaiting_payment: ["payment_pending", "paid", "expired", "cancelled"],
  payment_pending: ["paid", "awaiting_payment", "expired", "cancelled"],
  paid: ["confirmed", "refunded", "cancelled"],
  confirmed: ["completed", "cancelled", "refunded"],
  cancelled: ["refunded"],
  refunded: [],
  expired: ["awaiting_payment"], // reabertura administrativa após re-checar disponibilidade
  completed: [],
};

export const TERMINAL_STATUSES: ReservationStatus[] = ["rejected", "refunded", "completed"];

export type TransitionOrigin = "guest" | "admin" | "system" | "webhook";

export function isValidStatus(s: unknown): s is ReservationStatus {
  return typeof s === "string" && (ALL_STATUSES as string[]).includes(s);
}

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNext(from: ReservationStatus): ReservationStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

export function isTerminal(s: ReservationStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

export class InvalidTransitionError extends Error {
  constructor(public from: ReservationStatus, public to: ReservationStatus) {
    super(`Transição inválida: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: ReservationStatus, to: ReservationStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export interface StatusChange {
  fromStatus: ReservationStatus | null;
  toStatus: ReservationStatus;
  at: string; // ISO
  origin: TransitionOrigin;
  adminUser?: string | null;
  externalEvent?: string | null;
  note?: string | null;
  technicalId: string;
}

/** Constrói um registro de histórico validando a transição. */
export function buildStatusChange(params: {
  from: ReservationStatus | null;
  to: ReservationStatus;
  origin: TransitionOrigin;
  technicalId: string;
  adminUser?: string | null;
  externalEvent?: string | null;
  note?: string | null;
  at?: Date;
}): StatusChange {
  if (params.from !== null) assertTransition(params.from, params.to);
  return {
    fromStatus: params.from,
    toStatus: params.to,
    at: (params.at ?? new Date()).toISOString(),
    origin: params.origin,
    adminUser: params.adminUser ?? null,
    externalEvent: params.externalEvent ?? null,
    note: params.note ?? null,
    technicalId: params.technicalId,
  };
}
