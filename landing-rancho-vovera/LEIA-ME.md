# Rancho da Vó Vera — Landing page

Página de alta conversão, **autossuficiente** (fotos e fontes embutidas em base64), para o anúncio do Airbnb.

## Arquivos de entrega
- **`index.html`** — página completa standalone (abra direto no navegador; ~7 MB, tudo embutido). É o arquivo para publicar/enviar.
- **`artifact.html`** — mesma página, publicada como Artifact (link compartilhável).
- `index-dev.html` — versão leve (imagens/fontes por arquivo) usada só para testes.

## ⚠️ Trocar o número do WhatsApp (quando o cliente enviar)
O número está com um **placeholder**. Para trocar:
1. Abra **`src/template.html`** e procure `const WHATSAPP =`.
2. Troque `"5599999999999"` pelo número real (formato: **55 + DDD + número, só dígitos** — ex.: `"5514998887777"`).
3. Rode no terminal, dentro da pasta `landing-rancho-vovera/`:
   ```
   python build.py
   ```
   Isso regenera `index.html` e `artifact.html` com o número certo.

(Se preferir não rodar o build, dá para editar direto o `const WHATSAPP=` dentro do `index.html`, mas o jeito recomendado é o `template.html` + `build.py`.)

## Como foi montada (para referência)
- **83 fotos** do Airbnb baixadas (`assets/img/airbnb/`), otimizadas em WebP (`assets/build/img/`).
- **20 avaliações reais** (todas 5★) em `raw/reviews.json`.
- Conteúdo consolidado em `raw/CONTEUDO.md`; categorização das fotos em `raw/foto-categorias.md`.
- Fontes: **Fraunces** (títulos) + **Inter** (texto), embutidas.
- Scripts reutilizáveis em `raw/` (download_photos, optimize_images, get_fonts, cdp_shot, slice) e `build.py`.

## Observações
- **Preço:** não é exibido (o Airbnb não mostra valor sem datas). Os CTAs levam a "consultar disponibilidade e valores".
- **Google Maps:** é um botão que abre o mapa em nova aba (coordenadas aproximadas de Bariri/SP). Iframe não funciona em Artifact por segurança (CSP).
- **Instagram:** @rancho.vovera (no rodapé).
- Testada em **desktop e mobile (375–390px)**: header fixo/sólido, sem texto sobrepondo texto, galeria em mosaico com lightbox.
