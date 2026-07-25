import { describe, it, expect } from "vitest";
import { InMemoryRepository } from "../src/db/memory.js";
import { buildStatusChange, type ReservationStatus } from "../src/domain/reservation-state.js";
import { findConflicts } from "../src/domain/availability.js";
import type { ReservationRecord } from "../src/db/repository.js";
import { randomUUID } from "node:crypto";

function mkRecord(checkIn: string, checkOut: string): ReservationRecord {
  const id = randomUUID();
  return {
    id, friendlyCode: "CAF-" + id.slice(0, 4), publicToken: "tok-" + id, externalReference: "ref-" + id,
    status: "pending_approval", checkIn, checkOut, adults: 2, children: 0, quote: {},
    totalCents: 100000, payNowCents: 100000, currency: "BRL", paymentExpiresAt: null,
    createdAt: new Date().toISOString(),
    guest: { fullName: "T", email: "t@e.com", acceptedRules: true, acceptedCancellation: true, acceptedPrivacy: true },
  };
}
async function move(repo: InMemoryRepository, r: ReservationRecord, chain: ReservationStatus[]) {
  let from: ReservationStatus = r.status;
  for (const to of chain) {
    await repo.transitionStatus(r.id, to, buildStatusChange({ from, to, origin: "admin", technicalId: randomUUID() }));
    from = to;
  }
}
async function icalBusy(repo: InMemoryRepository) {
  return repo.listBusyPeriods();
}

describe("prevenção de sobreposição — quais status bloqueiam", () => {
  it("awaiting_payment / paid / confirmed BLOQUEIAM", async () => {
    for (const chain of [["awaiting_payment"], ["awaiting_payment", "paid"], ["awaiting_payment", "paid", "confirmed"]] as ReservationStatus[][]) {
      const repo = new InMemoryRepository();
      const r = mkRecord("2026-08-10", "2026-08-13");
      await repo.createReservation(r);
      await move(repo, r, chain);
      const busy = await icalBusy(repo);
      expect(findConflicts({ checkIn: "2026-08-11", checkOut: "2026-08-12" }, busy).length).toBe(1);
    }
  });

  it("rejected / expired / cancelled NÃO bloqueiam (datas reutilizáveis)", async () => {
    // rejected (a partir de pending)
    let repo = new InMemoryRepository();
    let r = mkRecord("2026-08-10", "2026-08-13");
    await repo.createReservation(r);
    await move(repo, r, ["rejected"]);
    expect((await icalBusy(repo)).length).toBe(0);

    // expired (awaiting_payment -> expired)
    repo = new InMemoryRepository();
    r = mkRecord("2026-08-10", "2026-08-13");
    await repo.createReservation(r);
    await move(repo, r, ["awaiting_payment", "expired"]);
    expect((await icalBusy(repo)).length).toBe(0);

    // cancelled (confirmed -> cancelled)
    repo = new InMemoryRepository();
    r = mkRecord("2026-08-10", "2026-08-13");
    await repo.createReservation(r);
    await move(repo, r, ["awaiting_payment", "paid", "confirmed", "cancelled"]);
    expect((await icalBusy(repo)).length).toBe(0);
  });

  it("bloqueio manual participa da verificação", async () => {
    const repo = new InMemoryRepository();
    await repo.addManualBlock({ checkIn: "2026-09-01", checkOut: "2026-09-05", reason: "manutenção" });
    const busy = await icalBusy(repo);
    expect(findConflicts({ checkIn: "2026-09-02", checkOut: "2026-09-03" }, busy).length).toBe(1);
  });

  it("período do iCal participa da verificação", async () => {
    const repo = new InMemoryRepository();
    await repo.replaceIcalEvents([{ checkIn: "2026-10-10", checkOut: "2026-10-14", source: "ical_airbnb", ref: "abnb-1" }], "http://x");
    const busy = await icalBusy(repo);
    expect(findConflicts({ checkIn: "2026-10-11", checkOut: "2026-10-13" }, busy).length).toBe(1);
  });

  it("bloqueio manual impede transição para status bloqueante (atômico)", async () => {
    const repo = new InMemoryRepository();
    await repo.addManualBlock({ checkIn: "2026-11-01", checkOut: "2026-11-05" });
    const r = mkRecord("2026-11-02", "2026-11-04");
    await repo.createReservation(r);
    await expect(move(repo, r, ["awaiting_payment"])).rejects.toThrowError(/indispon/i);
  });
});
