/* Painel administrativo — Cabana Afrodite. Vanilla JS, sem build. */
(function () {
  "use strict";

  var API = "/api/admin";
  var TOKEN_KEY = "caf_admin_token";
  var app = document.getElementById("app");
  var state = { token: sessionStorage.getItem(TOKEN_KEY) || null, email: "", reservations: [], calMonth: null };

  // ---------- utilidades ----------
  function h(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function brl(cents) { return ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function dt(iso) { return iso ? new Date(iso).toLocaleString("pt-BR") : "—"; }
  function d10(s) { return s ? s.split("-").reverse().join("/") : "—"; }
  var STATUS_PT = {
    pending_approval: "Aguardando aprovação", awaiting_payment: "Aguardando pagamento",
    payment_pending: "Pagamento processando", paid: "Pago", confirmed: "Confirmada",
    rejected: "Recusada", cancelled: "Cancelada", expired: "Expirada",
    refunded: "Reembolsada", completed: "Concluída",
  };
  function pill(s) { return '<span class="pill ' + s + '">' + (STATUS_PT[s] || s) + "</span>"; }

  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (state.token) headers.authorization = "Bearer " + state.token;
    var res = await fetch(API + path, Object.assign({}, opts, { headers: headers }));
    if (res.status === 401) { logout(); throw new Error("Sessão expirada. Entre novamente."); }
    var data = null;
    try { data = await res.json(); } catch (e) { /* pode não ser JSON (CSV) */ }
    if (!res.ok) throw new Error((data && data.error) || "Erro " + res.status);
    return data;
  }

  function toast(where, kind, text) {
    var el = document.getElementById(where);
    if (!el) return;
    el.innerHTML = '<div class="msg ' + kind + '">' + esc(text) + "</div>";
    if (kind === "ok") setTimeout(function () { if (el) el.innerHTML = ""; }, 4000);
  }

  function logout() { state.token = null; sessionStorage.removeItem(TOKEN_KEY); renderLogin(); }

  // ---------- login ----------
  function renderLogin(errMsg) {
    app.innerHTML = "";
    var card = h(
      '<div class="login-wrap"><div class="login-card">' +
        '<h1>Cabana <em>Afrodite</em></h1><p class="sub">Painel do anfitrião</p>' +
        '<div id="loginmsg"></div>' +
        '<div class="field"><label for="em">E-mail</label><input id="em" type="email" autocomplete="username"></div>' +
        '<div class="field"><label for="pw">Senha</label><input id="pw" type="password" autocomplete="current-password"></div>' +
        '<button class="btn" id="go" style="width:100%">Entrar</button>' +
      "</div></div>"
    );
    app.appendChild(card);
    if (errMsg) toast("loginmsg", "err", errMsg);
    var go = document.getElementById("go");
    function submit() {
      var email = document.getElementById("em").value.trim();
      var password = document.getElementById("pw").value;
      if (!email || !password) return toast("loginmsg", "err", "Informe e-mail e senha.");
      go.disabled = true; go.innerHTML = '<span class="spin"></span> Entrando…';
      fetch(API + "/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email, password: password }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (r) {
          if (!r.ok) throw new Error(r.d && r.d.error ? r.d.error : "Credenciais inválidas.");
          state.token = r.d.token; state.email = email;
          sessionStorage.setItem(TOKEN_KEY, r.d.token);
          renderShell();
        })
        .catch(function (e) { toast("loginmsg", "err", e.message); })
        .finally(function () { go.disabled = false; go.textContent = "Entrar"; });
    }
    go.addEventListener("click", submit);
    document.getElementById("pw").addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
  }

  // ---------- shell ----------
  var TABS = [
    { id: "reservas", label: "Reservas", render: renderReservas },
    { id: "calendario", label: "Calendário", render: renderCalendario },
    { id: "precos", label: "Preços", render: renderPrecos },
    { id: "pagamentos", label: "Pagamentos", render: renderPagamentos },
    { id: "sync", label: "Sincronização", render: renderSync },
    { id: "notificacoes", label: "Notificações", render: renderNotificacoes },
    { id: "logs", label: "Logs", render: renderLogs },
  ];

  function renderShell() {
    app.innerHTML = "";
    app.appendChild(h(
      '<div><header class="topbar">' +
        '<div class="brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3 3 20h18L12 3Z"/></svg><span>Cabana <i>Afrodite</i></span></div>' +
        '<div style="display:flex;align-items:center;gap:12px"><span class="who">' + esc(state.email) + '</span>' +
        '<button class="btn ghost sm" id="out">Sair</button></div>' +
      "</header>" +
      '<nav class="tabs" id="tabs"></nav><div id="airbnbAlert"></div><main id="main"></main></div>'
    ));
    document.getElementById("out").addEventListener("click", logout);
    var nav = document.getElementById("tabs");
    TABS.forEach(function (t) {
      var b = h('<button data-tab="' + t.id + '">' + t.label + "</button>");
      b.addEventListener("click", function () { location.hash = t.id; });
      nav.appendChild(b);
    });
    window.addEventListener("hashchange", route);
    route();
    refreshAirbnbAlert();
  }

  /**
   * Faixa fixa: reservas confirmadas cujas datas ainda precisam ser bloqueadas
   * manualmente no Airbnb. Fica visível em todas as abas até o admin confirmar,
   * porque é a janela em que uma dupla reserva pode acontecer.
   */
  async function refreshAirbnbAlert() {
    var box = document.getElementById("airbnbAlert");
    if (!box) return;
    try {
      var d = await api("/airbnb-pending");
      var list = d.pending || [];
      if (!list.length) { box.innerHTML = ""; return; }
      box.innerHTML =
        '<div class="airbnb-alert"><h4>⚠️ Bloqueie estas datas no Airbnb</h4>' +
        "<p>Reservas confirmadas no site. O Airbnb pode demorar horas para reimportar o calendário — bloqueie manualmente agora para evitar dupla reserva.</p><ul>" +
        list.map(function (p) {
          return "<li><span><b>" + esc(p.code) + "</b> · " + d10(p.checkIn) + " → " + d10(p.checkOut) + "</span>" +
            '<button class="btn sm" data-ack="' + esc(p.code) + '">Já bloqueei</button></li>';
        }).join("") + "</ul></div>";
      Array.prototype.forEach.call(box.querySelectorAll("[data-ack]"), function (b) {
        b.addEventListener("click", async function () {
          b.disabled = true; b.innerHTML = '<span class="spin"></span>';
          try { await api("/airbnb-pending", { method: "POST", body: JSON.stringify({ code: b.getAttribute("data-ack") }) }); refreshAirbnbAlert(); }
          catch (e) { b.disabled = false; b.textContent = "Já bloqueei"; }
        });
      });
    } catch (e) { box.innerHTML = ""; }
  }

  function route() {
    var id = (location.hash || "#reservas").slice(1);
    var tab = TABS.filter(function (t) { return t.id === id; })[0] || TABS[0];
    Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-tab") === tab.id);
    });
    var main = document.getElementById("main");
    main.innerHTML = '<div class="empty">Carregando…</div>';
    Promise.resolve(tab.render(main)).catch(function (e) {
      main.innerHTML = '<div class="msg err">' + esc(e.message) + "</div>";
    });
  }

  // ---------- aba: reservas ----------
  async function renderReservas(main) {
    main.innerHTML =
      "<h2>Reservas</h2><p class=\"hint\">Aprove, recuse, cancele e acompanhe cada solicitação.</p>" +
      '<div id="rmsg"></div>' +
      '<div class="toolbar">' +
        '<input id="q" placeholder="Buscar por nome, e-mail ou código">' +
        '<select id="st"><option value="">Todos os status</option>' +
          Object.keys(STATUS_PT).map(function (k) { return '<option value="' + k + '">' + STATUS_PT[k] + "</option>"; }).join("") +
        "</select>" +
        '<button class="btn ghost sm" id="reload">Atualizar</button>' +
        '<button class="btn ghost sm" id="csv">Exportar CSV</button>' +
      '</div><div id="rlist"></div>';

    async function load() {
      var q = document.getElementById("q").value.trim();
      var st = document.getElementById("st").value;
      var qs = [];
      if (q) qs.push("search=" + encodeURIComponent(q));
      if (st) qs.push("status=" + encodeURIComponent(st));
      var data = await api("/reservations" + (qs.length ? "?" + qs.join("&") : ""));
      state.reservations = data.reservations || [];
      var list = document.getElementById("rlist");
      if (!state.reservations.length) { list.innerHTML = '<div class="empty">Nenhuma reserva encontrada.</div>'; return; }
      list.innerHTML =
        '<div class="tablewrap"><table><thead><tr><th>Código</th><th>Hóspede</th><th>Período</th>' +
        '<th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>' +
        state.reservations.map(function (r) {
          return "<tr><td class=\"mono\">" + esc(r.code) + "</td>" +
            "<td>" + esc(r.guest.name) + "<br><span style=\"color:var(--dim);font-size:.8rem\">" + esc(r.guest.email) + "</span></td>" +
            "<td class=\"num\">" + d10(r.checkIn) + " → " + d10(r.checkOut) + "</td>" +
            '<td class="num">' + brl(r.totalCents) + "</td>" +
            "<td>" + pill(r.status) + "</td>" +
            '<td><button class="btn ghost sm" data-open="' + esc(r.token) + '">Abrir</button></td></tr>';
        }).join("") + "</tbody></table></div>";
      Array.prototype.forEach.call(list.querySelectorAll("[data-open]"), function (b) {
        b.addEventListener("click", function () { openDetail(b.getAttribute("data-open")); });
      });
    }

    document.getElementById("reload").addEventListener("click", load);
    document.getElementById("st").addEventListener("change", load);
    var timer; document.getElementById("q").addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(load, 350); });
    document.getElementById("csv").addEventListener("click", async function () {
      try {
        var res = await fetch(API + "/export-csv", { headers: { authorization: "Bearer " + state.token } });
        if (!res.ok) throw new Error("Falha ao exportar.");
        var blob = await res.blob();
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "reservas-cabana-afrodite.csv"; a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) { toast("rmsg", "err", e.message); }
    });
    await load();
  }

  // ---------- detalhe da reserva ----------
  async function openDetail(token) {
    var r = state.reservations.filter(function (x) { return x.token === token; })[0];
    if (!r) return;
    var modal = h('<div class="modal open"><div class="modal-card"><div id="dmsg"></div>' +
      "<h3>" + esc(r.code) + "</h3><p style=\"color:var(--dim);font-size:.85rem\">" + pill(r.status) + "</p>" +
      '<dl class="kv">' +
        "<dt>Hóspede</dt><dd>" + esc(r.guest.name) + "</dd>" +
        "<dt>E-mail</dt><dd>" + esc(r.guest.email) + "</dd>" +
        "<dt>Telefone</dt><dd>" + esc(r.guest.phone || "—") + "</dd>" +
        "<dt>Período</dt><dd>" + d10(r.checkIn) + " → " + d10(r.checkOut) + "</dd>" +
        "<dt>Hóspedes</dt><dd>" + r.adults + " adulto(s)" + (r.children ? " + " + r.children + " criança(s)" : "") + "</dd>" +
        "<dt>Total</dt><dd>" + brl(r.totalCents) + "</dd>" +
        "<dt>A pagar</dt><dd>" + brl(r.payNowCents) + "</dd>" +
        "<dt>Prazo</dt><dd>" + dt(r.paymentExpiresAt) + "</dd>" +
        "<dt>Criada em</dt><dd>" + dt(r.createdAt) + "</dd>" +
      "</dl><div class=\"actions\" id=\"acts\"></div><div id=\"hist\" class=\"hist\">Carregando histórico…</div>" +
      '<div style="margin-top:16px;text-align:right"><button class="btn ghost sm" id="close">Fechar</button></div>' +
      "</div></div>");
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.remove(); });
    modal.querySelector("#close").addEventListener("click", function () { modal.remove(); });

    // ações conforme o status
    var acts = modal.querySelector("#acts");
    function act(label, cls, fn) {
      var b = h('<button class="btn ' + cls + ' sm">' + label + "</button>");
      b.addEventListener("click", async function () {
        b.disabled = true; var old = b.textContent; b.innerHTML = '<span class="spin"></span>';
        try { await fn(); modal.remove(); route(); refreshAirbnbAlert(); }
        catch (e) { toast("dmsg", "err", e.message); b.disabled = false; b.textContent = old; }
      });
      acts.appendChild(b);
    }
    var body = JSON.stringify({ token: token });
    if (r.status === "pending_approval") {
      act("Aprovar", "", function () { return api("/approve", { method: "POST", body: body }); });
      act("Recusar", "ghost", function () {
        var reason = prompt("Motivo da recusa (opcional):") || "";
        return api("/reject", { method: "POST", body: JSON.stringify({ token: token, reason: reason }) });
      });
    }
    if (r.status === "awaiting_payment" || r.status === "payment_pending") {
      act("Reenviar link de pagamento", "ghost", function () { return api("/resend-payment-link", { method: "POST", body: body }); });
      act("Confirmar pagamento manualmente", "ghost", function () {
        if (!confirm("Confirme apenas se você verificou o pagamento no Mercado Pago.")) throw new Error("Cancelado.");
        return api("/confirm", { method: "POST", body: JSON.stringify({ token: token, overrideStaleIcal: true, note: "Confirmado pelo painel" }) });
      });
    }
    if (r.status === "confirmed") {
      act("Marcar como concluída", "ghost", function () { return api("/complete", { method: "POST", body: body }); });
    }
    if (["pending_approval", "awaiting_payment", "payment_pending", "paid", "confirmed"].indexOf(r.status) >= 0) {
      act("Cancelar reserva", "danger", function () {
        var reason = prompt("Motivo do cancelamento:") || "";
        if (r.status === "paid" || r.status === "confirmed") {
          alert("Atenção: esta reserva já foi paga. O estorno deve ser feito manualmente no painel do Mercado Pago.");
        }
        return api("/cancel", { method: "POST", body: JSON.stringify({ token: token, reason: reason }) });
      });
    }

    try {
      var hd = await api("/history?token=" + encodeURIComponent(token));
      var hist = modal.querySelector("#hist");
      hist.innerHTML = "<strong style=\"font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:var(--dim)\">Histórico</strong><ul style=\"margin-top:8px\">" +
        (hd.history || []).map(function (x) {
          return "<li><b>" + (STATUS_PT[x.toStatus] || x.toStatus) + "</b> · " + dt(x.at) + " · " + esc(x.origin) +
            (x.adminUser ? " (" + esc(x.adminUser) + ")" : "") +
            (x.note ? "<br>" + esc(x.note) : "") + "</li>";
        }).join("") + "</ul>";
    } catch (e) { modal.querySelector("#hist").innerHTML = '<span style="color:var(--dim)">Histórico indisponível.</span>'; }
  }

  // ---------- aba: calendário ----------
  async function renderCalendario(main) {
    var data = await api("/blocks");
    var busy = (data.busy || []).map(function (b) { return { from: b.checkIn, to: b.checkOut, kind: b.source === "manual_block" ? "block" : "busy" }; });
    if (!state.calMonth) { var n = new Date(); state.calMonth = n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0"); }

    main.innerHTML = "<h2>Calendário</h2><p class=\"hint\">Datas ocupadas (reservas e Airbnb) e bloqueios manuais.</p>" +
      '<div id="cmsg"></div>' +
      '<div class="card"><div class="calhead"><button class="btn ghost sm" id="prev">‹</button>' +
      '<span class="mon" id="mon"></span><button class="btn ghost sm" id="next">›</button></div>' +
      '<div class="cal" id="cal"></div>' +
      '<div class="callegend"><span><i style="background:color-mix(in srgb,var(--danger) 40%,transparent)"></i>Ocupado</span>' +
      '<span><i style="background:color-mix(in srgb,var(--warn) 40%,transparent)"></i>Bloqueio manual</span></div></div>' +
      '<div class="card"><h3>Bloquear datas manualmente</h3>' +
        '<div class="row"><div class="field"><label for="bi">Entrada</label><input id="bi" type="date"></div>' +
        '<div class="field"><label for="bo">Saída</label><input id="bo" type="date"></div>' +
        '<div class="field"><label for="br">Motivo</label><input id="br" placeholder="Manutenção, uso próprio…"></div></div>' +
        '<button class="btn" id="addblock">Bloquear período</button></div>' +
      '<div class="card"><h3>Bloqueios ativos</h3><div id="blist"></div></div>';

    function inRange(day) {
      for (var i = 0; i < busy.length; i++) if (day >= busy[i].from && day < busy[i].to) return busy[i].kind;
      return null;
    }
    function drawCal() {
      var parts = state.calMonth.split("-"), y = +parts[0], m = +parts[1];
      document.getElementById("mon").textContent = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      var first = new Date(y, m - 1, 1), start = first.getDay(), days = new Date(y, m, 0).getDate();
      var today = new Date().toISOString().slice(0, 10);
      var html = ["D", "S", "T", "Q", "Q", "S", "S"].map(function (d) { return '<div class="dow">' + d + "</div>"; }).join("");
      for (var i = 0; i < start; i++) html += '<div class="day out"></div>';
      for (var d = 1; d <= days; d++) {
        var iso = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
        var k = inRange(iso);
        html += '<div class="day ' + (k || "") + (iso === today ? " today" : "") + '">' + d + "</div>";
      }
      document.getElementById("cal").innerHTML = html;
    }
    function shift(n) {
      var p = state.calMonth.split("-"), dte = new Date(+p[0], +p[1] - 1 + n, 1);
      state.calMonth = dte.getFullYear() + "-" + String(dte.getMonth() + 1).padStart(2, "0");
      drawCal();
    }
    document.getElementById("prev").addEventListener("click", function () { shift(-1); });
    document.getElementById("next").addEventListener("click", function () { shift(1); });
    drawCal();

    function drawBlocks() {
      var el = document.getElementById("blist");
      var bl = data.blocks || [];
      if (!bl.length) { el.innerHTML = '<div class="empty">Nenhum bloqueio ativo.</div>'; return; }
      el.innerHTML = '<div class="tablewrap"><table><tbody>' + bl.map(function (b) {
        return "<tr><td class=\"num\">" + d10(b.checkIn) + " → " + d10(b.checkOut) + "</td><td>" + esc(b.reason || "—") +
          '</td><td style="text-align:right"><button class="btn ghost sm" data-rm="' + esc(b.id) + '">Remover</button></td></tr>';
      }).join("") + "</tbody></table></div>";
      Array.prototype.forEach.call(el.querySelectorAll("[data-rm]"), function (btn) {
        btn.addEventListener("click", async function () {
          btn.disabled = true;
          try { await api("/block", { method: "POST", body: JSON.stringify({ removeId: btn.getAttribute("data-rm") }) }); route(); }
          catch (e) { toast("cmsg", "err", e.message); btn.disabled = false; }
        });
      });
    }
    drawBlocks();

    document.getElementById("addblock").addEventListener("click", async function () {
      var bi = document.getElementById("bi").value, bo = document.getElementById("bo").value;
      if (!bi || !bo || bo <= bi) return toast("cmsg", "err", "Informe um período válido (saída depois da entrada).");
      try {
        await api("/block", { method: "POST", body: JSON.stringify({ checkIn: bi, checkOut: bo, reason: document.getElementById("br").value }) });
        route();
      } catch (e) { toast("cmsg", "err", e.message); }
    });
  }

  // ---------- aba: preços ----------
  async function renderPrecos(main) {
    var data = await api("/pricing");
    var p = data.pricing;
    var wd = p.weekdayNightlyCents || {};
    var DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    function money(c) { return c == null ? "" : (c / 100).toFixed(2); }

    main.innerHTML = "<h2>Preços e regras</h2><p class=\"hint\">Valores em reais. Alterações valem para novas cotações imediatamente.</p>" +
      '<div id="pmsg"></div>' +
      '<div class="card"><h3>Diárias</h3><div class="row">' +
        '<div class="field"><label>Diária padrão (R$)</label><input id="f_default" type="number" step="0.01" value="' + money(p.defaultNightlyCents) + '"></div>' +
        DAYS.map(function (d, i) { return '<div class="field"><label>' + d + ' (R$)</label><input class="wd" data-day="' + i + '" type="number" step="0.01" placeholder="padrão" value="' + money(wd[i]) + '"></div>'; }).join("") +
      "</div></div>" +
      '<div class="card"><h3>Taxas e capacidade</h3><div class="row">' +
        '<div class="field"><label>Taxa de limpeza (R$)</label><input id="f_clean" type="number" step="0.01" value="' + money(p.cleaningFeeCents) + '"></div>' +
        '<div class="field"><label>Hóspedes inclusos</label><input id="f_incl" type="number" value="' + p.includedGuests + '"></div>' +
        '<div class="field"><label>Taxa hóspede extra (R$)</label><input id="f_extra" type="number" step="0.01" value="' + money(p.extraGuestFeeCents) + '"></div>' +
        '<div class="field"><label>Cobrança do extra</label><select id="f_extraper"><option value="night"' + (p.extraGuestPer === "night" ? " selected" : "") + '>Por noite</option><option value="stay"' + (p.extraGuestPer === "stay" ? " selected" : "") + ">Por estadia</option></select></div>" +
        '<div class="field"><label>Máx. de hóspedes</label><input id="f_max" type="number" value="' + p.maxGuests + '"></div>' +
        '<div class="field"><label>Mín. de noites</label><input id="f_minn" type="number" value="' + p.minNights + '"></div>' +
        '<div class="field"><label>Intervalo de preparo (noites)</label><input id="f_prep" type="number" value="' + p.prepBufferNights + '"></div>' +
      "</div></div>" +
      '<div class="card"><h3>Descontos e caução</h3><div class="row">' +
        '<div class="field"><label>Desconto geral (%)</label><input id="f_flat" type="number" step="0.5" value="' + (p.flatDiscountPercent || 0) + '"></div>' +
        '<div class="field"><label>Caução (R$)</label><input id="f_dep" type="number" step="0.01" value="' + money(p.securityDepositCents) + '"></div>' +
        '<div class="field"><label>Cobrar caução junto</label><select id="f_depup"><option value="no"' + (!p.chargeDepositUpfront ? " selected" : "") + '>Não</option><option value="yes"' + (p.chargeDepositUpfront ? " selected" : "") + ">Sim</option></select></div>" +
      "</div></div>" +
      '<div class="card"><h3>Pagamento</h3><div class="row">' +
        '<div class="field"><label>Modalidade</label><select id="f_mode"><option value="full"' + (p.payment.mode === "full" ? " selected" : "") + '>Pagamento integral</option><option value="signal"' + (p.payment.mode === "signal" ? " selected" : "") + ">Sinal (percentual)</option></select></div>" +
        '<div class="field"><label>Sinal (%)</label><input id="f_signal" type="number" step="1" value="' + p.payment.signalPercent + '"></div>' +
        '<div class="field"><label>Prazo de pagamento (horas)</label><input id="f_exp" type="number" value="' + p.payment.expirationHours + '"></div>' +
        '<div class="field"><label>Máx. de parcelas</label><input id="f_inst" type="number" value="' + p.payment.maxInstallments + '"></div>' +
      "</div><button class=\"btn\" id=\"save\">Salvar alterações</button></div>" +
      '<div class="card"><h3>Períodos especiais e feriados</h3><div id="sp"></div>' +
        '<div class="row" style="margin-top:14px">' +
          '<div class="field"><label>Nome</label><input id="sp_name" placeholder="Réveillon"></div>' +
          '<div class="field"><label>Primeira noite</label><input id="sp_start" type="date"></div>' +
          '<div class="field"><label>Última noite</label><input id="sp_end" type="date"></div>' +
          '<div class="field"><label>Diária (R$)</label><input id="sp_rate" type="number" step="0.01"></div>' +
          '<div class="field"><label>Mín. noites</label><input id="sp_min" type="number"></div>' +
        "</div><button class=\"btn\" id=\"addsp\">Adicionar período</button></div>";

    function cents(id) { var v = document.getElementById(id).value; return v === "" ? undefined : Math.round(parseFloat(v) * 100); }
    function int(id) { var v = document.getElementById(id).value; return v === "" ? undefined : parseInt(v, 10); }

    document.getElementById("save").addEventListener("click", async function () {
      var btn = this; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Salvando…';
      var weekday = {};
      Array.prototype.forEach.call(document.querySelectorAll(".wd"), function (i) {
        if (i.value !== "") weekday[i.getAttribute("data-day")] = Math.round(parseFloat(i.value) * 100);
      });
      try {
        await api("/pricing", { method: "PUT", body: JSON.stringify({
          defaultNightlyCents: cents("f_default"), weekdayNightlyCents: weekday,
          cleaningFeeCents: cents("f_clean"), includedGuests: int("f_incl"),
          extraGuestFeeCents: cents("f_extra"), extraGuestPer: document.getElementById("f_extraper").value,
          maxGuests: int("f_max"), minNights: int("f_minn"), prepBufferNights: int("f_prep"),
          flatDiscountPercent: parseFloat(document.getElementById("f_flat").value || "0"),
          securityDepositCents: cents("f_dep"), chargeDepositUpfront: document.getElementById("f_depup").value === "yes",
          paymentMode: document.getElementById("f_mode").value,
          signalPercent: parseFloat(document.getElementById("f_signal").value || "30"),
          paymentExpirationHours: int("f_exp"), maxInstallments: int("f_inst"),
        }) });
        toast("pmsg", "ok", "Preços atualizados.");
      } catch (e) { toast("pmsg", "err", e.message); }
      finally { btn.disabled = false; btn.textContent = "Salvar alterações"; }
    });

    async function loadSP() {
      var d = await api("/special-periods");
      var el = document.getElementById("sp");
      if (!d.periods.length) { el.innerHTML = '<div class="empty">Nenhum período especial cadastrado.</div>'; return; }
      el.innerHTML = '<div class="tablewrap"><table><tbody>' + d.periods.map(function (x) {
        return "<tr><td>" + esc(x.name) + "</td><td class=\"num\">" + d10(x.startDate) + " → " + d10(x.endDate) +
          '</td><td class="num">' + (x.nightlyCents != null ? brl(x.nightlyCents) : "—") + "</td>" +
          '<td style="text-align:right"><button class="btn ghost sm" data-sp="' + esc(x.id) + '">Remover</button></td></tr>';
      }).join("") + "</tbody></table></div>";
      Array.prototype.forEach.call(el.querySelectorAll("[data-sp]"), function (b) {
        b.addEventListener("click", async function () {
          b.disabled = true;
          try { await api("/special-periods?id=" + encodeURIComponent(b.getAttribute("data-sp")), { method: "DELETE" }); loadSP(); }
          catch (e) { toast("pmsg", "err", e.message); b.disabled = false; }
        });
      });
    }
    document.getElementById("addsp").addEventListener("click", async function () {
      try {
        await api("/special-periods", { method: "POST", body: JSON.stringify({
          name: document.getElementById("sp_name").value,
          startDate: document.getElementById("sp_start").value,
          endDate: document.getElementById("sp_end").value,
          nightlyCents: cents("sp_rate"), minNights: int("sp_min"),
        }) });
        toast("pmsg", "ok", "Período adicionado."); loadSP();
      } catch (e) { toast("pmsg", "err", e.message); }
    });
    await loadSP();
  }

  // ---------- aba: pagamentos ----------
  async function renderPagamentos(main) {
    var d = await api("/payments");
    main.innerHTML = "<h2>Pagamentos</h2><p class=\"hint\">Transações registradas pelo Mercado Pago.</p>" +
      (!d.payments.length ? '<div class="empty">Nenhum pagamento registrado ainda.</div>' :
        '<div class="tablewrap"><table><thead><tr><th>Data</th><th>ID</th><th>Status</th><th class="num">Valor</th><th>Ambiente</th></tr></thead><tbody>' +
        d.payments.map(function (p) {
          return "<tr><td class=\"num\">" + dt(p.createdAt) + '</td><td class="mono">' + esc(p.paymentId || "—") + "</td>" +
            "<td>" + esc(p.status || "—") + '</td><td class="num">' + brl(p.amountCents) + "</td>" +
            "<td>" + (p.liveMode ? "produção" : "teste") + "</td></tr>";
        }).join("") + "</tbody></table></div>");
  }

  // ---------- aba: sincronização ----------
  async function renderSync(main) {
    var s = await api("/sync-status");
    var t = await api("/ical-token");
    main.innerHTML = "<h2>Sincronização com o Airbnb</h2><p class=\"hint\">Importa as datas ocupadas do Airbnb e exporta as reservas do site.</p>" +
      '<div id="smsg"></div>' +
      (!s.airbnbConfigured ? '<div class="msg warn">O link iCal do Airbnb ainda não foi configurado (variável AIRBNB_ICAL_URL). A importação está inativa.</div>' :
        (s.stale ? '<div class="msg warn">Última sincronização há mais de ' + s.maxStalenessMinutes + " minutos. Aprovações e confirmações ficam bloqueadas até sincronizar.</div>"
                 : '<div class="msg ok">Sincronização em dia.</div>')) +
      '<div class="card"><h3>Importar do Airbnb</h3>' +
        "<p style=\"color:var(--dim);font-size:.86rem\">Última sincronização bem-sucedida: <b>" + dt(s.lastSuccessfulSyncAt) + "</b></p>" +
        '<button class="btn" id="force" style="margin-top:12px"' + (s.airbnbConfigured ? "" : " disabled") + ">Sincronizar agora</button></div>" +
      '<div class="card"><h3>Calendário do site (para importar no Airbnb)</h3>' +
        '<p class="mono" id="icalurl" style="margin-bottom:10px">' + esc(t.url) + "</p>" +
        '<button class="btn ghost sm" id="copy">Copiar link</button> ' +
        '<button class="btn ghost sm" id="regen">Regenerar token</button>' +
        '<p style="color:var(--dim);font-size:.8rem;margin-top:10px">Ao regenerar, o link antigo para de funcionar e você precisa reimportá-lo no Airbnb.</p></div>' +
      '<div class="card"><h3>Histórico de sincronizações</h3>' +
        (!s.logs.length ? '<div class="empty">Nenhuma sincronização registrada.</div>' :
          '<div class="tablewrap"><table><thead><tr><th>Quando</th><th>Resultado</th><th class="num">Períodos</th><th>Erro</th></tr></thead><tbody>' +
          s.logs.map(function (l) {
            return "<tr><td class=\"num\">" + dt(l.startedAt) + "</td><td>" + (l.success ? "✅ sucesso" : "❌ falha") +
              '</td><td class="num">' + (l.periodsImported != null ? l.periodsImported : "—") + "</td>" +
              "<td style=\"color:var(--dim)\">" + esc(l.errorMessage || "—") + "</td></tr>";
          }).join("") + "</tbody></table></div>") + "</div>";

    document.getElementById("force").addEventListener("click", async function () {
      var b = this; b.disabled = true; b.innerHTML = '<span class="spin"></span> Sincronizando…';
      try { var r = await api("/ical-sync", { method: "POST" }); toast("smsg", "ok", "Importados " + (r.periodsImported || 0) + " período(s)."); setTimeout(route, 900); }
      catch (e) { toast("smsg", "err", e.message); b.disabled = false; b.textContent = "Sincronizar agora"; }
    });
    document.getElementById("copy").addEventListener("click", function () {
      navigator.clipboard.writeText(document.getElementById("icalurl").textContent).then(function () { toast("smsg", "ok", "Link copiado."); });
    });
    document.getElementById("regen").addEventListener("click", async function () {
      if (!confirm("Regenerar o token? O link atual deixará de funcionar e precisará ser reimportado no Airbnb.")) return;
      try { var r = await api("/ical-token", { method: "POST" }); document.getElementById("icalurl").textContent = r.url; toast("smsg", "ok", "Token regenerado. Reimporte o link no Airbnb."); }
      catch (e) { toast("smsg", "err", e.message); }
    });
  }

  // ---------- aba: notificações ----------
  async function renderNotificacoes(main) {
    var d = await api("/notifications");
    var LABEL = {
      sent: "enviado", failed: "falhou", queued: "na fila",
      template_missing: "sem template", no_admin_email: "ADMIN_EMAIL não configurado", no_recipient: "sem destinatário",
    };
    main.innerHTML = "<h2>Notificações</h2><p class=\"hint\">Mensagens disparadas pelo sistema. Use para conferir o que chegou ao hóspede e ao anfitrião.</p>" +
      (!d.notifications.length ? '<div class="empty">Nenhuma notificação registrada ainda.</div>' :
        '<div class="tablewrap"><table><thead><tr><th>Quando</th><th>Mensagem</th><th>Destinatário</th><th>Status</th></tr></thead><tbody>' +
        d.notifications.map(function (n) {
          var bad = n.status !== "sent" && n.status !== "queued";
          return "<tr><td class=\"num\">" + dt(n.createdAt) + '</td><td class="mono">' + esc(n.template) + "</td>" +
            "<td>" + esc(n.recipient || "—") + "</td>" +
            '<td' + (bad ? ' style="color:var(--danger)"' : "") + ">" + esc(LABEL[n.status] || n.status) + "</td></tr>";
        }).join("") + "</tbody></table></div>");
  }

  // ---------- aba: logs ----------
  async function renderLogs(main) {
    var d = await api("/audit-logs");
    main.innerHTML = "<h2>Logs administrativos</h2><p class=\"hint\">Registro de quem fez o quê no painel.</p>" +
      (!d.logs.length ? '<div class="empty">Nenhuma ação registrada ainda.</div>' :
        '<div class="tablewrap"><table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Registro</th></tr></thead><tbody>' +
        d.logs.map(function (l) {
          return "<tr><td class=\"num\">" + dt(l.createdAt) + "</td><td>" + esc(l.actor || "—") + "</td>" +
            '<td class="mono">' + esc(l.action) + "</td><td class=\"mono\" style=\"color:var(--dim)\">" + esc(l.entityId || l.entity || "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>");
  }

  // ---------- boot ----------
  if (state.token) {
    // valida a sessão existente antes de mostrar o painel
    fetch(API + "/reservations", { headers: { authorization: "Bearer " + state.token } })
      .then(function (r) { if (r.ok) { renderShell(); } else { logout(); } })
      .catch(function () { renderLogin("Não foi possível conectar ao servidor."); });
  } else {
    renderLogin();
  }
})();
