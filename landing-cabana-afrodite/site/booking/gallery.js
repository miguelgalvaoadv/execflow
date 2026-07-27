/*
 * Galeria dinâmica com degradação graciosa.
 *
 * O HTML já vem com as fotos embutidas (rápido, funciona sem JS e sem API).
 * Este script só substitui o conteúdo quando o painel personalizou a galeria —
 * fotos novas, ocultas, recategorizadas ou reordenadas. Se a API falhar ou
 * devolver exatamente o mesmo conjunto, nada muda na tela.
 */
(function () {
  "use strict";
  var grid = document.getElementById("masonry");
  if (!grid) return;

  var CAT_LABEL = { externa: "Área externa", banho: "Banheira & banho", quarto: "Quarto", interior: "Interior", mais: "Cabana Afrodite" };

  function currentUrls() {
    return [].slice.call(grid.querySelectorAll(".g-item img")).map(function (i) { return i.getAttribute("src"); });
  }

  fetch("/api/photos", { headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.photos || !data.photos.length) return; // mantém o embutido
      var incoming = data.photos.map(function (p) { return p.url; });
      var current = currentUrls();
      // mesmo conjunto e mesma ordem => nada a fazer (evita repintar à toa)
      if (incoming.length === current.length && incoming.every(function (u, i) { return u === current[i]; })) return;

      grid.innerHTML = data.photos.map(function (p) {
        var label = CAT_LABEL[p.category] || "Cabana Afrodite";
        var alt = p.caption ? p.caption : "Cabana Afrodite — " + label;
        return '<figure class="g-item" data-f="' + p.category + '" tabindex="0" role="button" aria-label="Ampliar: ' + alt.replace(/"/g, "&quot;") + '">' +
          '<img loading="lazy" decoding="async" src="' + p.url + '" alt="' + alt.replace(/"/g, "&quot;") + '"></figure>';
      }).join("");

      var count = document.getElementById("gc");
      if (count) count.textContent = String(data.photos.length);

      // o lightbox e os filtros são ligados no script embutido; avisamos que o
      // conteúdo mudou para que ele se re-registre nos novos elementos.
      document.dispatchEvent(new CustomEvent("gallery:updated"));
    })
    .catch(function () { /* silencioso: a galeria embutida continua válida */ });
})();
