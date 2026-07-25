import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { syncAirbnbIcal, _resetThrottle } from "../src/services/ical-sync.js";
import { InMemoryRepository } from "../src/db/memory.js";

const sample = readFileSync(new URL("./fixtures/airbnb-sample.ics", import.meta.url), "utf8");

function fetchOk(text: string): typeof fetch {
  return (async () => new Response(text, { status: 200 })) as unknown as typeof fetch;
}
function fetchFail(): typeof fetch {
  return (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
}

beforeEach(() => _resetThrottle());

describe("ical sync — cache, throttle e falhas", () => {
  it("importa períodos ocupados do Airbnb", async () => {
    const repo = new InMemoryRepository();
    const r = await syncAirbnbIcal(repo, "http://x/ical", { force: true, fetchImpl: fetchOk(sample) });
    expect(r.ok).toBe(true);
    expect(r.periodsImported).toBe(9); // 10 únicos - 1 cancelado
    expect((await repo.listBusyPeriods()).some((b) => b.source === "ical_airbnb")).toBe(true);
  });

  it("throttle: 2ª chamada não-forçada em <30s é pulada", async () => {
    const repo = new InMemoryRepository();
    await syncAirbnbIcal(repo, "http://x/ical", { force: true, fetchImpl: fetchOk(sample) });
    const second = await syncAirbnbIcal(repo, "http://x/ical", { fetchImpl: fetchOk(sample) });
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe("throttled");
  });

  it("cache: dentro do maxAge não busca de novo", async () => {
    const repo = new InMemoryRepository();
    await syncAirbnbIcal(repo, "http://x/ical", { force: true, fetchImpl: fetchOk(sample) });
    _resetThrottle(); // ignora o throttle para testar o cache por idade
    const cached = await syncAirbnbIcal(repo, "http://x/ical", { maxAgeMs: 60_000, fetchImpl: fetchOk(sample) });
    expect(cached.skipped).toBe(true);
    expect(cached.reason).toBe("fresh-cache");
  });

  it("falha de rede: mantém o último estado bom (não apaga eventos)", async () => {
    const repo = new InMemoryRepository();
    await syncAirbnbIcal(repo, "http://x/ical", { force: true, fetchImpl: fetchOk(sample) });
    const before = (await repo.listBusyPeriods()).filter((b) => b.source === "ical_airbnb").length;
    _resetThrottle();
    const failed = await syncAirbnbIcal(repo, "http://x/ical", { force: true, retries: 0, fetchImpl: fetchFail() });
    expect(failed.ok).toBe(false);
    const after = (await repo.listBusyPeriods()).filter((b) => b.source === "ical_airbnb").length;
    expect(after).toBe(before); // eventos preservados (fail-safe)
  });
});
