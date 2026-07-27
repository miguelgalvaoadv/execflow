import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { PHOTO_CATEGORIES, type PhotoCategory } from "../../src/db/repository.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

/**
 * Gestão da galeria.
 *  GET                       lista todas (inclusive ocultas)
 *  POST   {url,category,...} registra uma foto enviada ao Storage
 *  PATCH  {id, ...}          categoria, legenda, ordem, visibilidade, capa
 *  DELETE ?id=               remove (upload) ou oculta (foto original do site)
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET", "POST", "PATCH", "DELETE"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  const isCategory = (v: unknown): v is PhotoCategory => PHOTO_CATEGORIES.includes(v as PhotoCategory);

  if (req.method === "GET") {
    return json({ photos: await repo.listPhotos({ includeInactive: true }), categories: PHOTO_CATEGORIES });
  }

  if (req.method === "POST") {
    const b = await readJson<{ url?: string; storagePath?: string; category?: string; caption?: string }>(req);
    const url = str(b?.url, 600);
    if (!url) return json({ error: "url ausente." }, 422);
    const category = isCategory(b?.category) ? b!.category : "mais";
    try {
      const id = await repo.createPhoto({
        url, storagePath: str(b?.storagePath, 400) || null, category, caption: str(b?.caption, 200) || null,
      });
      await repo.logAudit({ actor: auth.email, action: "photo.create", entity: "photos", entityId: id, metadata: { category } });
      return json({ id }, 201);
    } catch (e) {
      return json({ error: (e as Error).message }, 409);
    }
  }

  if (req.method === "PATCH") {
    const b = await readJson<{ id?: string; category?: string; caption?: string; sortOrder?: number; active?: boolean; isCover?: boolean }>(req);
    const id = str(b?.id, 60);
    if (!id) return json({ error: "id ausente." }, 422);
    try {
      if (b?.isCover === true) {
        await repo.setCoverPhoto(id);
        await repo.logAudit({ actor: auth.email, action: "photo.set_cover", entity: "photos", entityId: id });
        return json({ ok: true });
      }
      const patch: Record<string, unknown> = {};
      if (b?.category !== undefined) {
        if (!isCategory(b.category)) return json({ error: "Categoria inválida." }, 422);
        patch.category = b.category;
      }
      if (b?.caption !== undefined) patch.caption = str(b.caption, 200) || null;
      if (b?.sortOrder !== undefined) patch.sortOrder = Math.trunc(Number(b.sortOrder));
      if (b?.active !== undefined) patch.active = Boolean(b.active);
      await repo.updatePhoto(id, patch);
      await repo.logAudit({ actor: auth.email, action: "photo.update", entity: "photos", entityId: id, metadata: { fields: Object.keys(patch) } });
      return json({ ok: true });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  // DELETE
  const id = new URL(req.url).searchParams.get("id") || str((await readJson<{ id?: string }>(req))?.id, 60);
  if (!id) return json({ error: "id ausente." }, 422);
  const removed = await repo.deletePhoto(id);
  if (!removed) return json({ error: "Foto não encontrada." }, 404);
  if (removed.source === "upload" && removed.storagePath && "removePhotoFile" in repo) {
    try { await (repo as { removePhotoFile(p: string): Promise<void> }).removePhotoFile(removed.storagePath); } catch { /* metadado já removido */ }
  }
  await repo.logAudit({ actor: auth.email, action: "photo.delete", entity: "photos", entityId: id, metadata: { source: removed.source } });
  return json({ ok: true, hidden: removed.source === "builtin" });
};
