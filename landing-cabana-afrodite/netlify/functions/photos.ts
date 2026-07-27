import { getContext } from "../../src/runtime/context.js";
import { json, methodGuard } from "./_shared.js";

/**
 * Galeria pública. Devolve apenas fotos ativas, na ordem definida no painel.
 * O site já vem com a galeria embutida no HTML — este endpoint só substitui
 * o conteúdo quando o admin personalizou algo (ver site/booking/gallery.js).
 */
export default async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, ["GET"]);
  if (guard) return guard;
  try {
    const { repo } = getContext();
    const photos = await repo.listPhotos();
    return json(
      {
        photos: photos.map((p) => ({ url: p.url, category: p.category, caption: p.caption, isCover: p.isCover })),
      },
      200,
      // curto de propósito: uma edição no painel precisa aparecer no site quase
      // imediatamente. stale-while-revalidate mantém a resposta rápida sob carga.
      { "cache-control": "public, max-age=15, stale-while-revalidate=60" },
    );
  } catch {
    // galeria embutida continua valendo se o banco estiver indisponível
    return json({ photos: [] }, 200);
  }
};
