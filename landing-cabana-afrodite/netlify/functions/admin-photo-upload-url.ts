import { getContext } from "../../src/runtime/context.js";
import { authenticateAdmin } from "../../src/auth/admin.js";
import { json, methodGuard, readJson, str } from "./_shared.js";

/**
 * Devolve uma URL assinada para o navegador enviar a foto DIRETO ao Supabase
 * Storage. Evita trafegar a imagem pela Function (limite de payload) e não
 * expõe a service role no cliente — a URL é válida só para aquele caminho.
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["POST"]);
  if (guard) return guard;
  const { cfg, repo } = getContext();
  const auth = await authenticateAdmin(req, cfg);
  if (!auth) return json({ error: "Não autorizado" }, 401);

  if (!("createPhotoUploadUrl" in repo)) {
    return json({ error: "Upload de fotos indisponível neste ambiente (requer Supabase).", code: "NO_STORAGE" }, 503);
  }
  const fileName = str((await readJson<{ fileName?: string }>(req))?.fileName, 120) || "foto.jpg";
  try {
    const r = await (repo as { createPhotoUploadUrl(f: string): Promise<{ path: string; signedUrl: string; token: string; publicUrl: string }> })
      .createPhotoUploadUrl(fileName);
    return json(r);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
