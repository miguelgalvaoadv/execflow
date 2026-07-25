/* Widget de reserva da Cabana Afrodite — vanilla, acessível, degrada com elegância. */
(function () {
  "use strict";
  var mount = document.getElementById("bk-mount");
  if (!mount) return;
  var API = "/api";

  function brl(cents) {
    return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function todayISO() {
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  async function api(path, opts) {
    var res = await fetch(API + path, opts);
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data: data };
  }

  var state = { adults: 2, children: 0, quote: null, available: false, token: null };

  // ---------- acompanhamento (?reserva=TOKEN) ----------
  var params = new URLSearchParams(location.search);
  var trackToken = params.get("reserva") || (location.pathname.match(/\/reserva\/([^/?]+)/) || [])[1];
  if (trackToken) { renderTracking(trackToken); return; }

  renderForm();

  function renderForm() {
    mount.innerHTML = "";
    var form = el(
      '<div>' +
        '<div class="bk-row">' +
          '<div class="bk-field"><label for="bk-in">Check-in</label><input type="date" id="bk-in" min="' + todayISO() + '" required></div>' +
          '<div class="bk-field"><label for="bk-out">Check-out</label><input type="date" id="bk-out" min="' + todayISO() + '" required></div>' +
        '</div>' +
        '<div class="bk-steppers">' +
          stepper("adults", "Adultos", state.adults, 1) +
          stepper("children", "Crianças", state.children, 0) +
        '</div>' +
        '<div class="bk-actions"><button class="bk-btn" id="bk-check" type="button">Ver disponibilidade e preço</button></div>' +
        '<div class="bk-msg err" id="bk-err" role="alert" style="display:none"></div>' +
        '<div class="bk-summary" id="bk-sum" aria-live="polite"></div>' +
        '<div class="bk-guest" id="bk-guest"></div>' +
      '</div>'
    );
    mount.appendChild(form);
    wireSteppers(form);
    form.querySelector("#bk-check").addEventListener("click", onCheck);
    form.querySelector("#bk-in").addEventListener("change", function (e) {
      var out = form.querySelector("#bk-out");
      var next = new Date(e.target.value); next.setDate(next.getDate() + 1);
      out.min = next.toISOString().slice(0, 10);
      if (out.value && out.value <= e.target.value) out.value = out.min;
    });
  }

  function stepper(key, label, val, min) {
    return (
      '<div class="bk-step" data-key="' + key + '" data-min="' + min + '">' +
        '<span class="lbl">' + label + '</span>' +
        '<span class="ctrl">' +
          '<button type="button" data-d="-1" aria-label="Diminuir ' + label + '">−</button>' +
          '<span class="val" aria-live="polite">' + val + '</span>' +
          '<button type="button" data-d="1" aria-label="Aumentar ' + label + '">+</button>' +
        '</span>' +
      '</div>'
    );
  }
  function wireSteppers(root) {
    root.querySelectorAll(".bk-step").forEach(function (step) {
      var key = step.getAttribute("data-key");
      var min = parseInt(step.getAttribute("data-min"), 10);
      step.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () {
          var d = parseInt(b.getAttribute("data-d"), 10);
          state[key] = Math.max(min, Math.min(10, state[key] + d));
          step.querySelector(".val").textContent = state[key];
        });
      });
    });
  }

  function showErr(msg) {
    var e = mount.querySelector("#bk-err");
    if (!e) return;
    e.textContent = msg; e.style.display = msg ? "block" : "none";
  }

  async function onCheck() {
    showErr("");
    var inEl = mount.querySelector("#bk-in"), outEl = mount.querySelector("#bk-out");
    var checkIn = inEl.value, checkOut = outEl.value;
    if (!checkIn || !checkOut) return showErr("Selecione as datas de entrada e saída.");
    if (checkOut <= checkIn) return showErr("O check-out deve ser posterior ao check-in.");

    var btn = mount.querySelector("#bk-check");
    btn.disabled = true; btn.innerHTML = '<span class="bk-spinner"></span> Consultando…';
    try {
      var r = await api("/availability", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkIn: checkIn, checkOut: checkOut, adults: state.adults, children: state.children }),
      });
      if (!r.ok) { showErr((r.data && r.data.error) || "Não foi possível consultar agora."); return; }
      state.quote = r.data.quote; state.available = r.data.available; state.checkIn = checkIn; state.checkOut = checkOut;
      renderSummary(r.data);
    } catch (e) {
      showErr("Sem conexão com o sistema de reservas. Fale conosco no WhatsApp para reservar.");
    } finally {
      btn.disabled = false; btn.textContent = "Ver disponibilidade e preço";
    }
  }

  function renderSummary(data) {
    var q = data.quote, sum = mount.querySelector("#bk-sum");
    if (!data.available) {
      sum.className = "bk-summary show";
      sum.innerHTML = '<div class="bk-msg err">Estas datas não estão disponíveis. Tente outro período.</div>';
      mount.querySelector("#bk-guest").className = "bk-guest";
      return;
    }
    if (data.issues && data.issues.length) {
      sum.className = "bk-summary show";
      sum.innerHTML = '<div class="bk-msg err">' + data.issues.map(function (i) { return i.message; }).join("<br>") + "</div>";
      mount.querySelector("#bk-guest").className = "bk-guest";
      return;
    }
    var lines = "";
    q.nightlyGroups.forEach(function (g) {
      lines += line(g.count + " noite" + (g.count > 1 ? "s" : "") + " × " + brl(g.rateCents), brl(g.subtotalCents));
    });
    if (q.discount && q.discount.cents > 0) lines += line((q.discount.reason || "Desconto"), "− " + brl(q.discount.cents));
    if (q.cleaningFeeCents) lines += line("Taxa de limpeza", brl(q.cleaningFeeCents));
    if (q.extraGuest && q.extraGuest.cents > 0) lines += line("Hóspede(s) adicional(is)", brl(q.extraGuest.cents));
    var pay = q.payNowCents;
    lines += '<div class="bk-line total"><b>Total</b><b>' + brl(q.totalCents) + "</b></div>";
    if (pay !== q.totalCents) lines += line("A pagar agora", brl(pay));

    sum.className = "bk-summary show";
    var upd = "";
    if (data.icalLastSyncAt) {
      var d = new Date(data.icalLastSyncAt);
      upd = "Disponibilidade atualizada em " + d.toLocaleString("pt-BR");
    }
    if (data.icalStale) {
      upd = '<strong>Atenção:</strong> os dados de disponibilidade podem estar desatualizados. ' +
        "A confirmação final é feita pelo anfitrião." + (upd ? "<br>" + upd : "");
    }
    var note = '<p class="bk-note">Disponibilidade sujeita à confirmação do anfitrião — não é garantida até a aprovação.' +
      (upd ? "<br>" + upd : "") + "</p>";
    sum.innerHTML = '<div class="bk-msg ' + (data.icalStale ? "err" : "ok") + '">Datas disponíveis! Revise os valores e envie sua solicitação.</div>' + lines + note;
    renderGuest();
  }
  function line(l, v) { return '<div class="bk-line"><span>' + l + "</span><b>" + v + "</b></div>"; }

  function renderGuest() {
    var g = mount.querySelector("#bk-guest");
    g.className = "bk-guest show";
    g.innerHTML =
      '<div class="bk-row">' +
        '<div class="bk-field"><label for="g-name">Nome completo</label><input id="g-name" type="text" required></div>' +
        '<div class="bk-field"><label for="g-email">E-mail</label><input id="g-email" type="email" required></div>' +
      '</div>' +
      '<div class="bk-row" style="margin-top:16px">' +
        '<div class="bk-field"><label for="g-phone">WhatsApp / telefone</label><input id="g-phone" type="tel"></div>' +
        '<div class="bk-field"><label for="g-notes">Observações (opcional)</label><input id="g-notes" type="text"></div>' +
      '</div>' +
      '<div class="bk-consents">' +
        consent("c-rules", "Li e aceito as <a href=\"#localizacao\">regras da casa</a>.") +
        consent("c-cancel", "Aceito a política de cancelamento (não reembolsável; troca de data uma vez até 15 dias antes).") +
        consent("c-priv", "Concordo com o tratamento dos meus dados conforme a política de privacidade (LGPD).") +
      '</div>' +
      '<div class="bk-actions"><button class="bk-btn" id="g-submit" type="button">Enviar solicitação de reserva</button></div>' +
      '<p class="bk-note">Sua solicitação passa por aprovação do anfitrião antes do pagamento. Você não é cobrado agora.</p>' +
      '<div class="bk-msg err" id="g-err" role="alert" style="display:none"></div>';
    g.querySelector("#g-submit").addEventListener("click", onSubmit);
  }
  function consent(id, text) {
    return '<label class="bk-consent"><input type="checkbox" id="' + id + '"><span>' + text + "</span></label>";
  }

  async function onSubmit() {
    var gErr = mount.querySelector("#g-err");
    gErr.style.display = "none";
    var name = val("#g-name"), email = val("#g-email");
    if (name.length < 2) return err(gErr, "Informe seu nome completo.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(gErr, "Informe um e-mail válido.");
    if (!checked("#c-rules") || !checked("#c-cancel") || !checked("#c-priv"))
      return err(gErr, "É necessário aceitar as regras, o cancelamento e a privacidade.");

    var btn = mount.querySelector("#g-submit");
    btn.disabled = true; btn.innerHTML = '<span class="bk-spinner"></span> Enviando…';
    try {
      var r = await api("/reservations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkIn: state.checkIn, checkOut: state.checkOut, adults: state.adults, children: state.children,
          fullName: name, email: email, phone: val("#g-phone"), notes: val("#g-notes"),
          acceptedRules: true, acceptedCancellation: true, acceptedPrivacy: true,
        }),
      });
      if (!r.ok) { err(gErr, (r.data && r.data.error) || "Não foi possível enviar. Tente novamente."); return; }
      renderSuccess(r.data);
    } catch (e) {
      err(gErr, "Sem conexão. Fale conosco no WhatsApp para concluir.");
    } finally {
      btn.disabled = false; btn.textContent = "Enviar solicitação de reserva";
    }
  }

  function renderSuccess(data) {
    var link = location.origin + "/?reserva=" + encodeURIComponent(data.token);
    mount.innerHTML =
      '<div class="bk-msg ok" style="font-size:1rem">' +
        "<strong>Solicitação enviada!</strong> Código <b>" + data.code + "</b>.<br>" +
        "Assim que o anfitrião confirmar a disponibilidade, você recebe o link de pagamento seguro por e-mail." +
      "</div>" +
      '<div class="bk-actions">' +
        '<a class="bk-btn" href="' + link + '">Acompanhar minha solicitação</a>' +
        '<a class="bk-btn ghost" href="https://wa.me/5521972887766?text=' +
          encodeURIComponent("Olá! Enviei a solicitação " + data.code + " pelo site da Cabana Afrodite.") +
          '" target="_blank" rel="noopener">Avisar no WhatsApp</a>' +
      "</div>";
    mount.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------- acompanhamento ----------
  async function renderTracking(token) {
    mount.innerHTML = '<div class="bk-msg">Carregando sua reserva…</div>';
    var r = await api("/reservations/" + encodeURIComponent(token) + "?token=" + encodeURIComponent(token), {}).catch(function () { return { ok: false }; });
    if (!r.ok || !r.data) { mount.innerHTML = '<div class="bk-msg err">Reserva não encontrada.</div>'; return; }
    var d = r.data;
    var labels = {
      pending_approval: "Aguardando aprovação do anfitrião",
      awaiting_payment: "Aprovada — aguardando pagamento",
      payment_pending: "Pagamento em processamento",
      paid: "Pagamento aprovado",
      confirmed: "Reserva confirmada 🎉",
      rejected: "Solicitação recusada",
      expired: "Prazo de pagamento expirado",
      cancelled: "Reserva cancelada",
      refunded: "Reembolsada",
      completed: "Estadia concluída",
    };
    var html =
      '<div class="bk-line total"><b>' + (labels[d.status] || d.status) + "</b></div>" +
      line("Código", d.code) +
      line("Período", d.checkIn + " → " + d.checkOut) +
      line("Hóspedes", d.guests.adults + " adulto(s)" + (d.guests.children ? " + " + d.guests.children + " criança(s)" : "")) +
      line("Total", brl(d.totalCents)) +
      line("A pagar agora", brl(d.payNowCents));
    mount.innerHTML = '<div class="bk-summary show">' + html + '<div class="bk-actions" id="bk-pay-actions"></div></div>';
    var actions = mount.querySelector("#bk-pay-actions");
    if (d.canPay) {
      var payBtn = el('<button class="bk-btn" type="button">Pagar agora com Mercado Pago</button>');
      payBtn.addEventListener("click", async function () {
        payBtn.disabled = true; payBtn.innerHTML = '<span class="bk-spinner"></span> Redirecionando…';
        var p = await api("/pay", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: token }),
        });
        if (p.ok && p.data && p.data.initPoint) location.href = p.data.initPoint;
        else { payBtn.disabled = false; payBtn.textContent = "Pagar agora com Mercado Pago"; }
      });
      actions.appendChild(payBtn);
    }
  }

  function val(sel) { var e = mount.querySelector(sel); return e ? e.value.trim() : ""; }
  function checked(sel) { var e = mount.querySelector(sel); return e && e.checked; }
  function err(node, msg) { node.textContent = msg; node.style.display = "block"; }
})();
