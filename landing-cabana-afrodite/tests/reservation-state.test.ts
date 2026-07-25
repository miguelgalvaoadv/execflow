import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  buildStatusChange,
  isTerminal,
  InvalidTransitionError,
} from "../src/domain/reservation-state.js";

describe("reservation state machine", () => {
  it("fluxo feliz é permitido", () => {
    expect(canTransition("pending_approval", "awaiting_payment")).toBe(true);
    expect(canTransition("awaiting_payment", "paid")).toBe(true);
    expect(canTransition("paid", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "completed")).toBe(true);
  });

  it("transições ilegais são bloqueadas", () => {
    expect(canTransition("pending_approval", "paid")).toBe(false);
    expect(canTransition("rejected", "confirmed")).toBe(false);
    expect(canTransition("completed", "cancelled")).toBe(false);
  });

  it("assertTransition lança em transição inválida", () => {
    expect(() => assertTransition("pending_approval", "confirmed")).toThrow(InvalidTransitionError);
  });

  it("estados terminais", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
    expect(isTerminal("confirmed")).toBe(false);
  });

  it("buildStatusChange registra origem e valida", () => {
    const change = buildStatusChange({
      from: "awaiting_payment",
      to: "paid",
      origin: "webhook",
      technicalId: "evt-1",
      externalEvent: "mp-payment-123",
    });
    expect(change.fromStatus).toBe("awaiting_payment");
    expect(change.toStatus).toBe("paid");
    expect(change.origin).toBe("webhook");
    expect(change.externalEvent).toBe("mp-payment-123");
    expect(typeof change.at).toBe("string");
  });

  it("expirada pode ser reaberta pelo admin", () => {
    expect(canTransition("expired", "awaiting_payment")).toBe(true);
  });
});
