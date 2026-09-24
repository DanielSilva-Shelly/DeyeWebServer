/*!
 * Deye Dashboard — ESPHome web_server v3
 * https://github.com/DanielSilva-Shelly/DeyeWebServer
 *
 * Carregado via `js_url`. Desenha o dashboard, carrega o UI original do
 * ESPHome (recolhido por baixo) e reutiliza a mesma ligação SSE (/events),
 * para o ESP servir apenas um cliente por separador.
 *
 * Os sensores são identificados pelo nome no YAML. Só pv, soc, bat e grid
 * são essenciais; os restantes, se existirem, ativam secções extra.
 * Opções: definir window.DEYE_DASH = {...} antes deste script (ver README).
 */
(function () {
  "use strict";
  if (window.__deyeDash) return;
  window.__deyeDash = true;

  var USER = window.DEYE_DASH || {};
  var CFG = Object.assign(
    {
      batteryPositiveIsDischarge: true, // Deye: + descarga, − carga
      gridPositiveIsImport: true, // Deye: + compra à rede, − venda
      idleW: 20, // abaixo disto conta como parado
      lowSocPct: 20,
      historyPoints: 360,
      loadEsphomeUi: true,
      esphomeUiUrl: "https://oi.esphome.io/v3/www.js",
      eventsUrl: "events",
    },
    USER
  );
  // Nome exato de cada entidade no YAML do ESPHome
  CFG.sensors = Object.assign(
    {
      pv: "Produção PV1",
      pv2: "Produção PV2",
      soc: "Nível da Bateria",
      bat: "Potência da Bateria",
      grid: "Potência da Rede",
      load: "Consumo da Casa",
      ePv: "Produção Solar Hoje",
      eLoad: "Consumo Hoje",
      eBuy: "Energia Comprada Hoje",
      eSell: "Energia Vendida Hoje",
      eChg: "Carga da Bateria Hoje",
      eDis: "Descarga da Bateria Hoje",
      state: "Estado do Inversor",
      link: "Ligação ao Inversor",
      vGrid: "Tensão da Rede",
      fGrid: "Frequência da Rede",
      vBat: "Tensão da Bateria",
      tBat: "Temperatura da Bateria",
      tDc: "Temperatura DC do Inversor",
      tAc: "Temperatura AC do Inversor",
      vPv1: "Tensão PV1",
      vPv2: "Tensão PV2",
    },
    USER.sensors
  );

  var ICON = {
    solar:
      "M11.45,2V5.55L15,3.77L11.45,2M10.45,8L8,10.46L11.75,11.71L10.45,8M2,11.45L3.77,15L5.55,11.45H2M10,2H2V10C2.57,10.17 3.17,10.25 3.77,10.25C7.35,10.26 10.26,7.35 10.27,3.75C10.26,3.16 10.17,2.57 10,2M17,22V16H14L19,7V13H22L17,22Z",
    bat: "M16 20H8V6H16M16.67 4H15V2H9V4H7.33C6.6 4 6 4.6 6 5.33V20.67C6 21.4 6.6 22 7.33 22H16.67C17.41 22 18 21.41 18 20.67V5.33C18 4.6 17.4 4 16.67 4M15 16H9V19H15V16M15 7H9V10H15V7M15 11.5H9V14.5H15V11.5Z",
    grid: "M8.28,5.45L6.5,4.55L7.76,2H16.23L17.5,4.55L15.72,5.44L15,4H9L8.28,5.45M18.62,8H14.09L13.3,5H10.7L9.91,8H5.38L4.1,10.55L5.89,11.44L6.62,10H17.38L18.1,11.45L19.89,10.56L18.62,8M17.77,22H15.7L15.46,21.1L12,15.9L8.53,21.1L8.3,22H6.23L9.12,11H11.19L10.83,12.35L12,14.1L13.16,12.35L12.81,11H14.88L17.77,22M11.4,15L10.5,13.65L9.32,18.13L11.4,15M14.68,18.12L13.5,13.64L12.6,15L14.68,18.12Z",
    home: "M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z",
    bolt: "M11 15H6L13 1V9H18L11 23V15Z",
    alert:
      "M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z",
  };

  // ---------- Estado --------------------------------------------------------
  var val = {};
  Object.keys(CFG.sensors).forEach(function (k) {
    val[k] = null;
  });
  var dirty = {};
  var hist = { pv: [], soc: [], grid: [], load: [] };
  var peak = null;
  var lastState = 0; // última leitura válida do inversor
  var seenState = false; // já chegaram estados, mesmo que vazios
  var lastEvent = 0;
  var connected = false;
  var keyByName = {};
  var legacyNames = {};
  Object.keys(CFG.sensors).forEach(function (k) {
    keyByName[CFG.sensors[k]] = k;
  });

  // ---------- Formatação ----------------------------------------------------
  function nf(min, max) {
    return new Intl.NumberFormat("pt-PT", { minimumFractionDigits: min, maximumFractionDigits: max });
  }
  var nf0 = nf(0, 0);
  var nf1 = nf(1, 1);
  var nf2 = nf(2, 2);

  function power(w) {
    if (w == null) return ["—", ""];
    if (Math.abs(w) >= 1000) return [nf2.format(w / 1000), "kW"];
    return [nf0.format(Math.round(w) || 0), "W"];
  }
  function powerTxt(w) {
    var p = power(w);
    return p[1] ? p[0] + " " + p[1] : p[0];
  }
  function kwh(v) {
    return v == null ? "—" : nf1.format(v) + " kWh";
  }
  function pct(x) {
    return nf0.format(Math.round(x * 100)) + " %";
  }
  function clock(t) {
    return new Date(t).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  }
  function ago(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return "há " + s + " s";
    var m = Math.round(s / 60);
    return m < 60 ? "há " + m + " min" : "há " + Math.round(m / 60) + " h";
  }
  function has(k) {
    return val[k] != null;
  }
  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  // ---------- Grandezas derivadas -------------------------------------------
  // Convenção interna: bateria + = descarga, rede + = importação
  function solar() {
    return has("pv") ? val.pv + (val.pv2 || 0) : null;
  }
  function batSigned() {
    return has("bat") ? (CFG.batteryPositiveIsDischarge ? val.bat : -val.bat) : null;
  }
  function gridSigned() {
    return has("grid") ? (CFG.gridPositiveIsImport ? val.grid : -val.grid) : null;
  }
  function loadMeasured() {
    return has("load");
  }
  // Consumo da casa: registo do inversor se existir; senão, balanço solar + bateria + rede
  function load() {
    if (loadMeasured()) return Math.max(0, val.load);
    var s = solar();
    var b = batSigned();
    var g = gridSigned();
    if (s == null || b == null || g == null) return null;
    return Math.max(0, s + b + g);
  }
  function loadTxt(w) {
    return w == null ? "—" : (loadMeasured() ? "" : "≈ ") + powerTxt(w);
  }

  // ---------- DOM -----------------------------------------------------------
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function icon(d, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  function node(id, cx, cy, color, d, title) {
    return (
      '<g class="node" style="--c:' + color + '"><title>' + title + "</title>" +
      '<circle cx="' + cx + '" cy="' + cy + '" r="28"/>' +
      '<path class="ic" transform="translate(' + (cx - 14) + " " + (cy - 14) + ') scale(1.1667)" d="' + d + '"/></g>'
    );
  }
  function link(id, d, color) {
    return (
      '<g class="link" data-l="' + id + '" style="--c:' + color + '">' +
      '<path class="track" d="' + d + '"/><path class="dash" d="' + d + '"/></g>'
    );
  }
  function tile(k, title, color, ic, extra) {
    return (
      '<article class="dd-card dd-tile" data-k="' + k + '" style="--c:' + color + '">' +
      '<div class="dd-tile-h">' + icon(ic, "dd-ic") + "<h2>" + title + "</h2></div>" +
      '<p class="dd-val"><span data-f="n">—</span><span class="dd-u" data-f="u"></span></p>' +
      '<p class="dd-st" data-f="st">A aguardar dados…</p>' +
      (extra || "") +
      '<div class="dd-spark"><svg data-f="sp" aria-hidden="true"></svg>' +
      '<p class="dd-cap" data-f="cap">A recolher histórico…</p></div></article>'
    );
  }
  function kv(f, label, row) {
    return "<div" + (row ? ' data-row="' + row + '" hidden' : "") + "><dt>" + label + '</dt><dd data-f="' + f + '">—</dd></div>';
  }
  function mini(f, label, color) {
    return (
      '<div class="dd-mini" data-row="' + f + '" hidden><dt><span class="dd-key" style="--c:' + color + '"></span>' + label +
      '</dt><dd data-f="' + f + '">—</dd></div>'
    );
  }
  function ratio(f, label) {
    return (
      '<div class="dd-ratio" data-row="' + f + '" hidden><div class="dd-ratio-h"><span>' + label + '</span><b data-f="' + f + '">—</b></div>' +
      '<div class="dd-meter dd-meter-n" aria-hidden="true"><span data-f="' + f + 'Bar"></span></div></div>'
    );
  }

  var root;
  var ui = {};

  function build() {
    root = el(
      '<div id="deye-dash">' +
        '<header class="dd-top"><div><h1 data-f="title">Deye Inverter</h1>' +
        '<p class="dd-sub">Produção e fluxo de energia em tempo real</p></div>' +
        '<p class="dd-status" data-s="connecting" role="status"><span class="dd-dot"></span><span data-f="status">A ligar…</span></p></header>' +
        '<div class="dd-main">' +
        '<section class="dd-card dd-hero" aria-label="Resumo">' +
        '<div><p class="dd-eyebrow">Produção solar agora</p>' +
        '<p class="dd-hero-v"><span data-f="hero">—</span><span class="dd-u" data-f="heroU"></span></p></div>' +
        '<dl class="dd-kv">' +
        kv("hLoad", "Consumo da casa") +
        kv("hSelf", "Autossuficiência agora") +
        kv("hToday", "Produção hoje", "hToday") +
        kv("hPeak", "Pico nesta sessão") +
        "</dl></section>" +
        '<section class="dd-card dd-flow-card" aria-label="Fluxo de energia">' +
        '<svg class="dd-flow" viewBox="0 0 340 300" role="img" data-f="flow">' +
        link("pv", "M170 72V126", "var(--dd-solar)") +
        link("bat", "M76 150H146", "var(--dd-bat)") +
        link("grid", "M264 150H194", "var(--dd-grid)") +
        link("home", "M170 174V228", "var(--dd-home)") +
        node("pv", 170, 44, "var(--dd-solar)", ICON.solar, "Solar") +
        node("bat", 48, 150, "var(--dd-bat)", ICON.bat, "Bateria") +
        node("grid", 292, 150, "var(--dd-grid)", ICON.grid, "Rede") +
        node("home", 170, 256, "var(--dd-home)", ICON.home, "Casa") +
        '<g class="hub"><title>Inversor</title><rect x="146" y="126" width="48" height="48" rx="12"/>' +
        '<path class="ic" transform="translate(158 138)" d="' + ICON.bolt + '"/></g>' +
        '<text x="208" y="40" data-f="fPv">—</text><text class="lbl" x="208" y="58">Solar</text>' +
        '<text x="48" y="202" text-anchor="middle" data-f="fBat">—</text>' +
        '<text class="lbl" x="48" y="220" text-anchor="middle" data-f="fBatL">Bateria</text>' +
        '<text x="292" y="202" text-anchor="middle" data-f="fGrid">—</text>' +
        '<text class="lbl" x="292" y="220" text-anchor="middle" data-f="fGridL">Rede</text>' +
        '<text x="208" y="252" data-f="fHome">—</text><text class="lbl" x="208" y="270" data-f="fHomeL">Casa</text>' +
        "</svg></section></div>" +
        '<div class="dd-tiles">' +
        tile("pv", "Solar", "var(--dd-solar)", ICON.solar) +
        tile("soc", "Bateria", "var(--dd-bat)", ICON.bat, '<div class="dd-meter" aria-hidden="true"><span data-f="meter"></span></div>') +
        tile("grid", "Rede", "var(--dd-grid)", ICON.grid) +
        tile("load", "Casa", "var(--dd-home)", ICON.home) +
        "</div>" +
        '<div class="dd-row2">' +
        '<section class="dd-card dd-today" data-row="today" hidden aria-label="Energia de hoje"><h2 class="dd-h2">Hoje</h2>' +
        '<dl class="dd-minis">' +
        mini("tPv", "Produzido", "var(--dd-solar)") +
        mini("tLoad", "Consumido", "var(--dd-home)") +
        mini("tBuy", "Comprado à rede", "var(--dd-grid)") +
        mini("tSell", "Vendido à rede", "var(--dd-grid)") +
        "</dl>" +
        ratio("tSelf", "Autossuficiência (consumo sem rede)") +
        ratio("tOwn", "Autoconsumo (solar usado em casa)") +
        '<p class="dd-note" data-row="tBat" hidden data-f="tBat"></p></section>' +
        '<section class="dd-card dd-sys" data-row="sys" hidden aria-label="Sistema"><h2 class="dd-h2">Sistema</h2><dl class="dd-kv">' +
        kv("sState", "Estado do inversor", "sState") +
        kv("sLink", "Comunicação Modbus", "sLink") +
        kv("sGrid", "Rede", "sGrid") +
        kv("sBat", "Bateria", "sBat") +
        kv("sTemp", "Temperaturas", "sTemp") +
        kv("sPv", "Tensão das strings", "sPv") +
        "</dl></section></div>" +
        '<footer class="dd-foot"><button type="button" class="dd-btn" data-f="toggle" aria-expanded="false">Mostrar painel ESPHome</button>' +
        '<span data-f="last"></span></footer></div>'
    );

    root.querySelectorAll("[data-f]").forEach(function (n) {
      var k = n.getAttribute("data-f");
      var t = n.closest("[data-k]");
      ui[t ? t.getAttribute("data-k") + "." + k : k] = n;
    });
    ui.rows = {};
    root.querySelectorAll("[data-row]").forEach(function (n) {
      ui.rows[n.getAttribute("data-row")] = n;
    });
    ui.statusBox = root.querySelector(".dd-status");
    ui.links = {};
    root.querySelectorAll("[data-l]").forEach(function (g) {
      ui.links[g.getAttribute("data-l")] = g;
    });
    ui.tiles = {};
    root.querySelectorAll("[data-k]").forEach(function (t) {
      ui.tiles[t.getAttribute("data-k")] = t;
    });

    var app = document.querySelector("esp-app");
    document.body.insertBefore(root, app);
    document.body.classList.add("dd-ready");

    setupToggle();
    ["pv", "soc", "grid", "load"].forEach(setupSparkHover);
    window.addEventListener("resize", debounce(renderSparks, 150));
  }

  function set(k, text) {
    if (ui[k] && ui[k].textContent !== text) ui[k].textContent = text;
  }
  function show(row, on) {
    var n = ui.rows[row];
    if (n && n.hidden === !!on) n.hidden = !on;
  }
  function bar(k, x) {
    ui[k].style.width = x == null ? "0" : clamp01(x) * 100 + "%";
  }

  // ---------- Painel ESPHome original --------------------------------------
  var STORE = "deye-dash:esp-open";
  function setupToggle() {
    var btn = ui.toggle;
    var open = false;
    try {
      open = localStorage.getItem(STORE) === "1";
    } catch (e) {}
    function apply() {
      document.body.classList.toggle("dd-esp-open", open);
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? "Ocultar painel ESPHome" : "Mostrar painel ESPHome";
    }
    btn.addEventListener("click", function () {
      open = !open;
      try {
        localStorage.setItem(STORE, open ? "1" : "0");
      } catch (e) {}
      apply();
    });
    apply();
  }
  function hideToggle() {
    ui.toggle.hidden = true;
  }

  // ---------- Render --------------------------------------------------------
  function speed(w) {
    return w < 300 ? 2.2 : w < 1500 ? 1.4 : w < 4000 ? 0.9 : 0.6;
  }
  function flow(id, w) {
    var g = ui.links[id];
    var on = w != null && Math.abs(w) >= CFG.idleW;
    g.classList.toggle("is-on", on);
    g.classList.toggle("is-rev", on && w < 0);
    if (on) g.style.setProperty("--dur", speed(Math.abs(w)) + "s");
  }
  function batText(b) {
    if (b == null) return "Sem leitura";
    if (b <= -CFG.idleW) return "A carregar · " + powerTxt(-b);
    if (b >= CFG.idleW) return "A descarregar · " + powerTxt(b);
    return "Em repouso";
  }
  function gridText(g) {
    if (g == null) return "Sem leitura";
    if (g >= CFG.idleW) return "A comprar à rede";
    if (g <= -CFG.idleW) return "A vender à rede";
    return "Sem trocas";
  }

  function render() {
    var s = solar();
    var b = batSigned();
    var g = gridSigned();
    var l = load();
    var idle = CFG.idleW;
    var p;

    // Destaque
    p = power(s);
    set("hero", p[0]);
    set("heroU", p[1]);
    set("hLoad", loadTxt(l));
    set("hSelf", l == null || g == null || l < idle ? "—" : pct(1 - Math.min(Math.max(g, 0), l) / l));
    show("hToday", has("ePv"));
    set("hToday", kwh(val.ePv));
    set("hPeak", peak && peak.v >= idle ? powerTxt(peak.v) + " · " + clock(peak.t) : "—");

    // Diagrama
    flow("pv", s);
    flow("bat", b);
    flow("grid", g);
    flow("home", l);
    set("fPv", powerTxt(s));
    set("fBat", b == null ? "—" : powerTxt(Math.abs(b)));
    set("fBatL", "Bateria" + (has("soc") ? " · " + nf0.format(val.soc) + " %" : ""));
    set("fGrid", g == null ? "—" : powerTxt(Math.abs(g)));
    set("fGridL", g == null || Math.abs(g) < idle ? "Rede" : g > 0 ? "Rede · compra" : "Rede · venda");
    set("fHome", loadTxt(l));
    set("fHomeL", loadMeasured() ? "Casa" : "Casa (estimado)");
    ui.flow.setAttribute(
      "aria-label",
      "Fluxo de energia: solar " + powerTxt(s) + ", bateria " + batText(b).toLowerCase() + ", rede: " + gridText(g).toLowerCase() +
        (g != null && Math.abs(g) >= idle ? " " + powerTxt(Math.abs(g)) : "") + ", casa " + loadTxt(l)
    );

    // Solar
    p = power(s);
    set("pv.n", p[0]);
    set("pv.u", p[1]);
    if (s == null) set("pv.st", "Sem leitura");
    else if (s < idle) set("pv.st", "Sem produção");
    else set("pv.st", has("pv2") ? "PV1 " + powerTxt(val.pv) + " · PV2 " + powerTxt(val.pv2) : "Em produção");

    // Bateria
    set("soc.n", has("soc") ? nf0.format(val.soc) : "—");
    set("soc.u", has("soc") ? "%" : "");
    bar("soc.meter", has("soc") ? val.soc / 100 : null);
    var low = has("soc") && val.soc < CFG.lowSocPct;
    ui.tiles.soc.classList.toggle("is-low", low);
    var bs = batText(b);
    var html = low ? icon(ICON.alert, "dd-alert") + "<span>Baixa · " + bs + "</span>" : "<span>" + bs + "</span>";
    if (ui["soc.st"].innerHTML !== html) ui["soc.st"].innerHTML = html;

    // Rede
    p = power(g == null ? null : Math.abs(g));
    set("grid.n", p[0]);
    set("grid.u", p[1]);
    set("grid.st", gridText(g));

    // Casa
    p = power(l);
    html = l == null ? "—" : (loadMeasured() ? "" : '<span class="dd-approx">≈</span>') + p[0];
    if (ui["load.n"].innerHTML !== html) ui["load.n"].innerHTML = html;
    set("load.u", p[1]);
    set("load.st", loadMeasured() ? "Medido pelo inversor" : "Estimado pelo balanço");

    renderToday();
    renderSystem();
    renderSparks();
    renderStatus();
  }

  function renderToday() {
    var any = ["ePv", "eLoad", "eBuy", "eSell", "eChg", "eDis"].some(has);
    show("today", any);
    if (!any) return;
    [["tPv", "ePv"], ["tLoad", "eLoad"], ["tBuy", "eBuy"], ["tSell", "eSell"]].forEach(function (m) {
      show(m[0], has(m[1]));
      set(m[0], kwh(val[m[1]]));
    });
    var selfOk = has("eLoad") && has("eBuy") && val.eLoad > 0;
    show("tSelf", selfOk);
    if (selfOk) {
      var x = clamp01(1 - val.eBuy / val.eLoad);
      set("tSelf", pct(x));
      bar("tSelfBar", x);
    }
    var ownOk = has("ePv") && has("eSell") && val.ePv > 0;
    show("tOwn", ownOk);
    if (ownOk) {
      var y = clamp01(1 - val.eSell / val.ePv);
      set("tOwn", pct(y));
      bar("tOwnBar", y);
    }
    var batOk = has("eChg") || has("eDis");
    show("tBat", batOk);
    if (batOk) set("tBat", "Bateria: " + kwh(val.eChg) + " carregados · " + kwh(val.eDis) + " descarregados");
  }

  var STATE_LEVEL = { normal: "good", standby: "idle", autoteste: "idle", "self-test": "idle", alarme: "warn", alarm: "warn", falha: "crit", fault: "crit" };

  function statusHtml(level, text) {
    return '<span class="dd-state" data-l="' + level + '"><span class="dd-dot"></span>' + text + "</span>";
  }

  function renderSystem() {
    var any = false;
    function row(r, ok, fn) {
      show(r, ok);
      if (ok) {
        any = true;
        fn();
      }
    }
    row("sState", has("state"), function () {
      var h = statusHtml(STATE_LEVEL[String(val.state).toLowerCase()] || "idle", String(val.state));
      if (ui.sState.innerHTML !== h) ui.sState.innerHTML = h;
    });
    row("sLink", has("link"), function () {
      var h = val.link ? statusHtml("good", "A comunicar") : statusHtml("crit", "Sem resposta");
      if (ui.sLink.innerHTML !== h) ui.sLink.innerHTML = h;
    });
    row("sGrid", has("vGrid") || has("fGrid"), function () {
      set("sGrid", join([has("vGrid") && nf1.format(val.vGrid) + " V", has("fGrid") && nf2.format(val.fGrid) + " Hz"]));
    });
    row("sBat", has("vBat") || has("tBat"), function () {
      set("sBat", join([has("vBat") && nf2.format(val.vBat) + " V", has("tBat") && nf1.format(val.tBat) + " °C"]));
    });
    row("sTemp", has("tDc") || has("tAc"), function () {
      set("sTemp", join([has("tDc") && "DC " + nf1.format(val.tDc) + " °C", has("tAc") && "AC " + nf1.format(val.tAc) + " °C"]));
    });
    row("sPv", has("vPv1") || has("vPv2"), function () {
      set("sPv", join([has("vPv1") && "PV1 " + nf0.format(val.vPv1) + " V", has("vPv2") && "PV2 " + nf0.format(val.vPv2) + " V"]));
    });
    show("sys", any);
  }
  function join(parts) {
    return parts.filter(Boolean).join(" · ");
  }

  function renderStatus() {
    var now = Date.now();
    var s, txt;
    if (!connected || now - lastEvent > 25000) {
      s = lastEvent ? "offline" : "connecting";
      txt = lastEvent ? "Sem ligação ao ESP" : "A ligar…";
    } else if (val.link === false) {
      s = "stale";
      txt = "Inversor sem resposta";
    } else if (!lastState) {
      // Sensores a chegar sem valor ("NA"): o ESP está ligado mas o Modbus não responde
      s = seenState ? "stale" : "connecting";
      txt = seenState ? "Sem leituras do inversor" : "A aguardar dados…";
    } else if (now - lastState > 180000) {
      s = "stale";
      txt = "Sem leituras novas · " + ago(now - lastState);
    } else {
      s = "live";
      txt = "Em direto · " + ago(now - lastState);
    }
    if (ui.statusBox.getAttribute("data-s") !== s) ui.statusBox.setAttribute("data-s", s);
    set("status", txt);
    set("last", lastState ? "Última leitura às " + new Date(lastState).toLocaleTimeString("pt-PT") : "");
  }

  // ---------- Sparklines ----------------------------------------------------
  var SPARK = {
    pv: { fmt: powerTxt },
    soc: { min: 0, max: 100, fmt: function (v) { return nf0.format(v) + " %"; } },
    grid: { fmt: function (v) { return powerTxt(Math.abs(v)) + (v >= CFG.idleW ? " · compra" : v <= -CFG.idleW ? " · venda" : ""); } },
    load: { fmt: function (v) { return loadTxt(v); } },
  };
  var SH = 44;
  var PAD = 5;

  function renderSparks() {
    Object.keys(SPARK).forEach(drawSpark);
  }

  function drawSpark(k) {
    var svg = ui[k + ".sp"];
    var cfg = SPARK[k];
    var pts = hist[k];
    var w = svg.clientWidth || 200;
    svg.setAttribute("viewBox", "0 0 " + w + " " + SH);
    if (!pts.length) {
      svg.innerHTML = "";
      svg._s = null;
      return;
    }
    var vs = pts.map(function (p) { return p.v; });
    var lo = cfg.min != null ? cfg.min : Math.min(0, Math.min.apply(null, vs));
    var hi = cfg.max != null ? cfg.max : Math.max(0, Math.max.apply(null, vs));
    if (cfg.max == null && hi - lo < 100) hi = lo + 100;
    var t0 = pts[0].t;
    var span = pts[pts.length - 1].t - t0;
    var x = function (t) { return span ? PAD + ((t - t0) / span) * (w - 2 * PAD) : w - PAD; };
    var y = function (v) { return PAD + ((hi - v) / (hi - lo)) * (SH - 2 * PAD); };
    var y0 = y(Math.max(lo, Math.min(hi, 0))).toFixed(1);

    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1); }).join("");
    var last = pts[pts.length - 1];
    var html = "";
    if (pts.length > 1) html += '<path class="ar" d="' + line + "L" + x(last.t).toFixed(1) + " " + y0 + "L" + x(t0).toFixed(1) + " " + y0 + 'Z"/>';
    if (lo < 0) html += '<line class="zero" x1="0" x2="' + w + '" y1="' + y0 + '" y2="' + y0 + '"/>';
    if (pts.length > 1) html += '<path class="ln" d="' + line + '"/>';
    html += '<circle class="end" r="4" cx="' + x(last.t).toFixed(1) + '" cy="' + y(last.v).toFixed(1) + '"/>';
    html += '<line class="xh" y1="0" y2="' + SH + '" visibility="hidden"/><circle class="hv" r="4" visibility="hidden"/>';
    svg.innerHTML = html;
    svg._s = { pts: pts, x: x, y: y };

    if (!svg._hover) set(k + ".cap", sparkCaption(pts));
  }

  function sparkCaption(pts) {
    if (pts.length < 2) return "A recolher histórico…";
    var min = Math.round((pts[pts.length - 1].t - pts[0].t) / 60000);
    if (min < 1) return "Último minuto";
    return min < 90 ? "Últimos " + min + " min" : "Últimas " + nf0.format(min / 60) + " h";
  }

  function setupSparkHover(k) {
    var svg = ui[k + ".sp"];
    function move(ev) {
      var s = svg._s;
      if (!s) return;
      var px = ev.clientX - svg.getBoundingClientRect().left;
      var best = 0;
      var bd = Infinity;
      for (var i = 0; i < s.pts.length; i++) {
        var d = Math.abs(s.x(s.pts[i].t) - px);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      var p = s.pts[best];
      var cx = s.x(p.t).toFixed(1);
      var xh = svg.querySelector(".xh");
      var hv = svg.querySelector(".hv");
      xh.setAttribute("x1", cx);
      xh.setAttribute("x2", cx);
      xh.setAttribute("visibility", "visible");
      hv.setAttribute("cx", cx);
      hv.setAttribute("cy", s.y(p.v).toFixed(1));
      hv.setAttribute("visibility", "visible");
      svg._hover = true;
      set(k + ".cap", new Date(p.t).toLocaleTimeString("pt-PT") + " · " + SPARK[k].fmt(p.v));
    }
    function leave() {
      svg._hover = false;
      drawSpark(k);
    }
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("pointercancel", leave);
  }

  // ---------- Dados ---------------------------------------------------------
  function push(series, v, t) {
    if (v == null) return;
    var a = hist[series];
    a.push({ t: t, v: v });
    if (a.length > CFG.historyPoints) a.shift();
  }

  var commitTimer = null;
  // As leituras de cada ciclo Modbus chegam quase juntas: agrupa-as num só ponto.
  function commit() {
    commitTimer = null;
    var t = Date.now();
    if (dirty.pv || dirty.pv2) push("pv", solar(), t);
    if (dirty.soc) push("soc", val.soc, t);
    if (dirty.grid) push("grid", gridSigned(), t);
    if (dirty.load || dirty.pv || dirty.pv2 || dirty.bat || dirty.grid) push("load", load(), t);
    var s = solar();
    if (s != null && (!peak || s > peak.v)) peak = { v: s, t: t };
    dirty = {};
    render();
  }

  var DOMAINS = { sensor: 1, text_sensor: 1, binary_sensor: 1 };

  // id atual: "sensor/Nome" (ou "sensor/Dispositivo/Nome"); antigo: "sensor-object_id"
  function resolveKey(d) {
    var id = String(d.name_id || d.id || "");
    var slash = id.indexOf("/");
    if (slash > 0) {
      if (!DOMAINS[id.slice(0, slash)]) return undefined;
      var rest = id.slice(slash + 1);
      return keyByName[d.name] || keyByName[rest] || keyByName[rest.slice(rest.lastIndexOf("/") + 1)];
    }
    var dash = id.indexOf("-");
    if (dash > 0 && DOMAINS[id.slice(0, dash)]) {
      if (d.name) legacyNames[id] = d.name; // o nome só vem no 1.º evento
      return keyByName[legacyNames[id]];
    }
    return undefined;
  }

  function parseValue(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "boolean") return v;
    if (typeof v === "string" && v !== "" && v !== "NA") return v;
    return null;
  }

  function onState(e) {
    lastEvent = Date.now();
    var d;
    try {
      d = JSON.parse(e.data);
    } catch (err) {
      return;
    }
    var k = resolveKey(d);
    if (!k) return;
    val[k] = parseValue(d.value);
    dirty[k] = true;
    seenState = true;
    if (val[k] != null && k !== "link") lastState = lastEvent;
    if (!commitTimer) commitTimer = setTimeout(commit, 250);
  }

  function onPing(e) {
    lastEvent = Date.now();
    connected = true;
    if (!e.data) return;
    try {
      var d = JSON.parse(e.data);
      if (d.title) set("title", d.title);
    } catch (err) {}
  }

  function attach(es) {
    es.addEventListener("state", onState);
    es.addEventListener("ping", onPing);
    es.addEventListener("log", function () {
      lastEvent = Date.now();
    });
    es.addEventListener("open", function () {
      connected = true;
      lastEvent = Date.now();
      renderStatus();
    });
    es.addEventListener("error", function () {
      connected = es.readyState === 1;
      renderStatus();
    });
    if (es.readyState === 1) {
      connected = true;
      lastEvent = Date.now();
    }
  }

  function ownSource() {
    attach(new EventSource(CFG.eventsUrl));
  }

  function connect() {
    // Já existe a ligação do UI do ESPHome (ex.: carregado via js_include)
    if (window.source && window.source.addEventListener) return attach(window.source);
    if (!CFG.loadEsphomeUi) {
      hideToggle();
      return ownSource();
    }
    var s = document.createElement("script");
    s.src = CFG.esphomeUiUrl;
    // O www.js cria window.source ao executar; o 'load' dispara logo a seguir,
    // antes de qualquer mensagem SSE, por isso nada se perde.
    s.onload = function () {
      if (window.source && window.source.addEventListener) attach(window.source);
      else ownSource();
    };
    s.onerror = function () {
      hideToggle();
      ownSource();
    };
    document.body.appendChild(s);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function start() {
    build();
    render();
    connect();
    setInterval(renderStatus, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
