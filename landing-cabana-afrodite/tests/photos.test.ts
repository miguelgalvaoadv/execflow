import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRepository } from "../src/db/memory.js";

describe("galeria — gestão de fotos", () => {
  let repo: InMemoryRepository;
  beforeEach(async () => {
    repo = new InMemoryRepository();
    // simula as fotos originais do site (arquivos estáticos)
    await repo.createPhoto({ url: "/assets/img/000.jpg", category: "externa", caption: "Fachada" });
    await repo.createPhoto({ url: "/assets/img/001.jpg", category: "interior", caption: "Sala" });
  });

  it("lista na ordem definida e só as ativas por padrão", async () => {
    const all = await repo.listPhotos();
    expect(all.map((p) => p.url)).toEqual(["/assets/img/000.jpg", "/assets/img/001.jpg"]);
    expect(all[0]!.source).toBe("builtin");
  });

  it("upload entra na galeria com a categoria escolhida", async () => {
    const id = await repo.createPhoto({
      url: "https://x.supabase.co/storage/v1/object/public/photos/gallery/nova.jpg",
      storagePath: "gallery/nova.jpg", category: "quarto", caption: "Quarto novo",
    });
    const photos = await repo.listPhotos();
    const nova = photos.find((p) => p.id === id)!;
    expect(nova.source).toBe("upload");
    expect(nova.category).toBe("quarto");
    expect(nova.sortOrder).toBe(2); // vai para o fim
  });

  it("recusa url duplicada", async () => {
    await expect(repo.createPhoto({ url: "/assets/img/000.jpg", category: "mais" })).rejects.toThrow(/duplicada/i);
  });

  it("excluir foto ORIGINAL apenas oculta (arquivo do deploy permanece)", async () => {
    const [first] = await repo.listPhotos();
    const res = await repo.deletePhoto(first!.id);
    expect(res).toEqual({ storagePath: null, source: "builtin" });
    expect((await repo.listPhotos()).some((p) => p.id === first!.id)).toBe(false);
    const comOcultas = await repo.listPhotos({ includeInactive: true });
    expect(comOcultas.find((p) => p.id === first!.id)!.active).toBe(false);
  });

  it("excluir foto ENVIADA remove o registro e devolve o caminho do arquivo", async () => {
    const id = await repo.createPhoto({ url: "https://x/y.jpg", storagePath: "gallery/y.jpg", category: "mais" });
    const res = await repo.deletePhoto(id);
    expect(res).toEqual({ storagePath: "gallery/y.jpg", source: "upload" });
    expect((await repo.listPhotos({ includeInactive: true })).some((p) => p.id === id)).toBe(false);
  });

  it("foto oculta pode ser reexibida", async () => {
    const [first] = await repo.listPhotos();
    await repo.deletePhoto(first!.id);
    await repo.updatePhoto(first!.id, { active: true });
    expect((await repo.listPhotos()).some((p) => p.id === first!.id)).toBe(true);
  });

  it("trocar categoria e legenda", async () => {
    const [first] = await repo.listPhotos();
    await repo.updatePhoto(first!.id, { category: "banho", caption: "Banheira" });
    const p = (await repo.listPhotos()).find((x) => x.id === first!.id)!;
    expect(p.category).toBe("banho");
    expect(p.caption).toBe("Banheira");
  });

  it("só existe uma capa por vez", async () => {
    const [a, b] = await repo.listPhotos();
    await repo.setCoverPhoto(a!.id);
    expect((await repo.listPhotos()).filter((p) => p.isCover).map((p) => p.id)).toEqual([a!.id]);
    await repo.setCoverPhoto(b!.id);
    const covers = (await repo.listPhotos()).filter((p) => p.isCover);
    expect(covers).toHaveLength(1);
    expect(covers[0]!.id).toBe(b!.id);
  });

  it("reordenar troca a posição na listagem", async () => {
    const [a, b] = await repo.listPhotos();
    await repo.updatePhoto(a!.id, { sortOrder: b!.sortOrder });
    await repo.updatePhoto(b!.id, { sortOrder: a!.sortOrder });
    expect((await repo.listPhotos()).map((p) => p.id)).toEqual([b!.id, a!.id]);
  });
});
