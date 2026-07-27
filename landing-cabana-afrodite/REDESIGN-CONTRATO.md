# Mapa de compatibilidade — o que o redesign NÃO pode quebrar

Levantado antes de qualquer alteração (branch `feat/cabana-afrodite-redesign`, a partir de
`389c287`). Serve de referência para a regressão funcional ao final.

## Arquitetura (inalterada)

- Site **estático** gerado por `raw/build.py` a partir de `raw/template.html` (não há framework).
- Backend em **Netlify Functions** (`netlify/functions/`), banco **Supabase**, pagamento
  **Mercado Pago**. **Nada disso é tocado pelo redesign** — é só front-end.
- Publicação: `publish = site`, `functions = netlify/functions` (`netlify.toml`).
- Dois artefatos: `site/index.html` (deploy) e `index.html` (brochura offline self-contained).

## Links externos (não podem mudar)

| Destino | URL |
|---|---|
| Airbnb | `https://www.airbnb.com.br/rooms/1309401960357292675` |
| WhatsApp | `https://wa.me/5521972887766` (+ variantes com `?text=`) |
| Google Maps (embed) | `...maps?q=-22.4013,-43.3419&z=13&hl=pt-BR&output=embed` |
| Google Maps (link) | `...maps?q=-22.4013,-43.3419&z=14` |
| Instagram | `https://instagram.com/cabanaafrodite` |

## Âncoras de navegação (devem continuar existindo)

`#top` · `#experiencia` · `#comodidades` · `#galeria` · `#localizacao` · `#reservar`
(+ `#reservar-online`, seção do widget de reserva, injetada pelo build)

## Contrato DOM — JavaScript existente depende destes IDs/classes

**`booking.js`** (widget de reserva, injetado só na versão `site/`):
`#bk-mount` (ponto de montagem) — o script cria internamente `#bk-in`, `#bk-out`, `#bk-check`,
`#bk-err`, `#bk-sum`, `#bk-guest`, `#g-submit`, `#g-err`, `#bk-pay-actions`, `.bk-step`, `.val`.

**`gallery.js`** (galeria dinâmica): `#masonry`, `.g-item img`, `#gc`, e dispara o evento
`gallery:updated`.

**Script inline do template:** `#nav` (+ classe `solid`), `#tgl` (tema), `#yr`, `#masonry`,
`#filters` (+ `button.on`, `data-f`), `#gc`, `.g-item` (+ classe `hide`, `data-f`),
lightbox `#lb`/`#lbImg`/`#lbCount`/`#lbClose`/`#lbNext`/`#lbPrev` (+ classe `open`),
reveal `.rv` (+ classe `in`).

**Placeholders do build** (`raw/build.py` substitui): `__FR__`, `__JO__`, `__HERO__`,
`__EXP_INT__`, `__FEAT_TUB__`, `__FEAT_DECK__`, `__FEAT_VIEW__`, `__ROMANCE__`, `__CTA_BG__`,
`<!--GALLERY-->`, `<!--BOOKING_HEAD-->`, `<!--BOOKING_SECTION-->`, `<!--BOOKING_SCRIPT-->`.

## Categorias da galeria (contrato com o banco e o painel)

`externa` · `banho` · `quarto` · `interior` · `mais` — usadas em `data-f`, na tabela `photos`
e no painel admin. **Não renomear.**

## SEO / metadados (preservar)

`<title>Cabana Afrodite · Refúgio A-frame na Serra do Rio}`, meta `description`,
`theme-color`, `og:title`, `og:description`, `lang="pt-BR"`, `viewport`.

## Conteúdo factual (não inventar/alterar)

4,94 · 132 avaliações · Superhost · 4 hóspedes · 1 quarto · 2 camas · 1 banheiro ·
Paty do Alferes/Petrópolis-RJ · 37 comodidades · sem forno · sem detector de fumaça/CO ·
política não reembolsável, troca de data uma vez até 15 dias antes.
Depoimentos reais em `raw/reviews.md`. Preços exibidos vêm do backend (hoje DEMO).

## Comportamentos a reverificar depois (Fase 7)

1. Landing carrega (200) e imagens aparecem
2. Navegação por âncora e menu
3. Tema claro/escuro (`#tgl`)
4. Galeria: filtros por categoria, contador, lightbox (teclado/swipe/Esc/clique fora)
5. `gallery.js` substitui a galeria quando o painel personaliza
6. Widget de reserva: datas → preço → solicitação
7. Links Airbnb/WhatsApp/Maps/Instagram
8. Barra fixa mobile
9. `npx vitest run` (129), `npx tsc --noEmit`, `python raw/build.py`
10. `/admin` e as rotas `/api/*` intactas
