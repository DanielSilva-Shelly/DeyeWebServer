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
      // Autonomia: SOC até onde a descarga conta (por omissão, o lowSocPct) e a
      // constante de tempo da média da potência da bateria. Sem média, um
      // compressor a arrancar fazia a estimativa saltar horas de um lado para o outro.
      reserveSocPct: null,
      autonomyTauS: 300,
      batteryKwh: null, // sobrepõe-se ao sensor "Capacidade da Bateria"
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
      ups: "Saída LOAD",
      gen: "Potência do Gerador",
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
      iBat: "Corrente da Bateria",
      cap: "Capacidade da Bateria",
      pvMes: "Produção Este Mês",
      loadMes: "Consumo Este Mês",
      hist: "Histórico Mensal",
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
    plug: "M16,7V3H14V7H10V3H8V7H8C7,7 6,8 6,9V14.5L9.5,18V21H14.5V18L18,14.5V9C18,8 17,7 16,7Z",
    gen: "M7,4V6H10V8H7L5,10V13H3V10H1V18H3V15H5V18H8L10,20H18V16H20V19H23V9H20V12H18V8H12V6H15V4H7Z",
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
        // O ramo de cima e o de baixo dividem-se em dois quando há gerador ou
        // saída LOAD: os nós afastam-se 56 para cada lado e os traços passam a
        // diagonais. A geometria é trocada em branch(), conforme os sensores.
        // O viewBox começa em -36 para caber o texto por cima dos nós de topo.
        '<svg class="dd-flow" viewBox="0 -36 340 366" role="img" data-f="flow">' +
        link("pv", "M170 72V126", "var(--dd-solar)") +
        link("gen", "M180 74L216 122", "var(--dd-gen)") +
        link("bat", "M76 150H146", "var(--dd-bat)") +
        link("grid", "M264 150H194", "var(--dd-grid)") +
        link("home", "M170 174V228", "var(--dd-home)") +
        link("ups", "M180 176L216 226", "var(--dd-ups)") +
        '<g data-f="gPv">' + node("pv", 170, 44, "var(--dd-solar)", ICON.solar, "Solar") +
        '<text x="170" y="2" text-anchor="middle" data-f="fPv">—</text>' +
        '<text class="lbl" x="170" y="-16" text-anchor="middle">Solar</text></g>' +
        '<g data-f="gGen" hidden>' + node("gen", 170, 44, "var(--dd-gen)", ICON.gen, "Gerador") +
        '<text x="170" y="2" text-anchor="middle" data-f="fGen">—</text>' +
        '<text class="lbl" x="170" y="-16" text-anchor="middle">Gerador</text></g>' +
        node("bat", 48, 150, "var(--dd-bat)", ICON.bat, "Bateria") +
        node("grid", 292, 150, "var(--dd-grid)", ICON.grid, "Rede") +
        '<g data-f="gHome">' + node("home", 170, 256, "var(--dd-home)", ICON.home, "Casa") +
        '<text x="170" y="302" text-anchor="middle" data-f="fHome">—</text>' +
        '<text class="lbl" x="170" y="320" text-anchor="middle" data-f="fHomeL">Casa</text></g>' +
        '<g data-f="gUps" hidden>' + node("ups", 170, 256, "var(--dd-ups)", ICON.plug, "Saída LOAD") +
        '<text x="170" y="302" text-anchor="middle" data-f="fUps">—</text>' +
        '<text class="lbl" x="170" y="320" text-anchor="middle">Saída LOAD</text></g>' +
        '<g class="hub"><title>Inversor</title><rect x="146" y="126" width="48" height="48" rx="12"/>' +
        '<path class="ic" transform="translate(158 138)" d="' + ICON.bolt + '"/></g>' +
        '<text x="48" y="202" text-anchor="middle" data-f="fBat">—</text>' +
        '<text class="lbl" x="48" y="220" text-anchor="middle" data-f="fBatL">Bateria</text>' +
        '<text x="292" y="202" text-anchor="middle" data-f="fGrid">—</text>' +
        '<text class="lbl" x="292" y="220" text-anchor="middle" data-f="fGridL">Rede</text>' +
        "</svg></section></div>" +
        '<div class="dd-tiles">' +
        tile("pv", "Solar", "var(--dd-solar)", ICON.solar) +
        tile("soc", "Bateria", "var(--dd-bat)", ICON.bat, '<p class="dd-st" data-f="au" hidden></p><div class="dd-meter" aria-hidden="true"><span data-f="meter"></span></div>') +
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
        kv("sUps", "Saída LOAD (UPS)", "sUps") +
        "</dl></section></div>" +
        '<section class="dd-card dd-months" data-row="months" hidden aria-label="Produção e consumo por mês">' +
        '<div class="dd-months-h"><h2 class="dd-h2">Por mês</h2><p class="dd-legend">' +
        '<span><span class="dd-key" style="--c:var(--dd-solar)"></span>Produção</span>' +
        '<span><span class="dd-key" style="--c:var(--dd-cons)"></span>Consumo</span></p></div>' +
        '<div class="dd-mchart"><svg data-f="mchart" role="img"></svg><div class="dd-mtip" data-f="mtip" hidden></div></div>' +
        '<details class="dd-mtable"><summary>Ver tabela</summary><table data-f="mtable"></table></details></section>' +
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
    setupMonths();
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
  function setLink(id, d) {
    var g = ui.links[id];
    if (!g || g.getAttribute("data-d") === d) return;
    g.setAttribute("data-d", d);
    g.querySelectorAll("path").forEach(function (n) {
      n.setAttribute("d", d);
    });
  }
  // Abre ou fecha um ramo duplo do diagrama. Fechado, o primeiro nó fica ao
  // centro com o traço a direito; aberto, os dois afastam-se 56 para cada lado
  // e os traços passam a diagonais. Só mexe no DOM quando o estado muda, senão
  // reiniciava a animação dos traços a cada render.
  var branchOpen = {};
  function branch(name, a, b, la, lb, solo, splitA, splitB, open) {
    if (branchOpen[name] === open) return;
    branchOpen[name] = open;
    ui[a].setAttribute("transform", open ? "translate(-56 0)" : "translate(0 0)");
    ui[b].setAttribute("transform", "translate(56 0)");
    // O grupo nasce com o atributo hidden no markup, para não piscar antes do
    // primeiro render. Tira-se o atributo e mexe-se no display: só o style
    // sozinho não chegava, porque a regra [hidden] continuaria a escondê-lo.
    ui[b].removeAttribute("hidden");
    ui[b].style.display = open ? "" : "none";
    setLink(la, open ? splitA : solo);
    setLink(lb, splitB);
    // O traço do segundo nó tem de desaparecer com ele: a track é desenhada
    // mesmo sem potência a passar, e ficavam diagonais soltas a sair do hub.
    var g = ui.links[lb];
    if (g) g.style.display = open ? "" : "none";
  }
  // ---------- Autonomia da bateria -----------------------------------------
  var emaB = null;
  var emaT = 0;
  function batAvg(b) {
    var now = Date.now();
    // Recomeça a média quando muda o sentido (carga ↔ descarga): misturar os
    // dois dava uma estimativa sem sentido durante minutos.
    if (b == null || emaB == null || (b >= 0) !== (emaB >= 0)) {
      emaB = b;
    } else {
      var dt = Math.max(0, (now - emaT) / 1000);
      emaB += (1 - Math.exp(-dt / CFG.autonomyTauS)) * (b - emaB);
    }
    emaT = now;
    return emaB;
  }
  function capKwh() {
    var c = CFG.batteryKwh != null ? CFG.batteryKwh : val.cap;
    return c > 0 ? c : null;
  }
  function duration(h) {
    if (h > 48) return "mais de 2 dias";
    var m = Math.round(h * 60);
    if (m < 60) return m + " min";
    return Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
  }
  // Texto curto com o tempo até à reserva (a descarregar) ou até cheia (a
  // carregar), ou null quando não há dados ou a bateria está parada.
  function autonomy(bAvg) {
    var c = capKwh();
    if (c == null || bAvg == null || !has("soc") || Math.abs(bAvg) < CFG.idleW) return null;
    var reserve = CFG.reserveSocPct != null ? CFG.reserveSocPct : CFG.lowSocPct;
    // A corrente que entra na conta: a mesma média de 5 minutos da potência,
    // passada a amperes pela tensão atual. É o número que se compara com o BMS.
    var amps = has("vBat") && val.vBat > 10 ? " a " + nf1.format(Math.abs(bAvg) / val.vBat) + " A" : "";
    if (bAvg > 0) {
      var left = ((val.soc - reserve) / 100) * c * 1000;
      if (left <= 0) return null;
      return "≈ " + duration(left / bAvg) + " até " + nf0.format(reserve) + " %" + amps;
    }
    var toFull = ((100 - val.soc) / 100) * c * 1000;
    if (toFull <= 0) return null;
    return "cheia em ≈ " + duration(toFull / -bAvg) + amps;
  }

  // ---------- Histórico mensal --------------------------------------------
  // O ESP publica "AAAAMM;AAAAMM:prod:cons,..." (o primeiro é o mês em curso) e
  // os dois valores do mês em curso em sensores à parte, que mudam a cada minuto.
  var MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  var monthsKey = "";
  var monthsData = [];
  var monthsGeom = { W: 640, L: 44, R: 8 };
  function kwhShort(v) {
    return v == null ? "—" : (v < 100 ? nf1 : nf0).format(v) + " kWh";
  }
  function monthLabel(ym, withYear) {
    var m = MES[(ym % 100) - 1] || "?";
    return withYear ? m + " " + String(Math.floor(ym / 100)).slice(2) : m;
  }
  function monthSeries() {
    if (!has("hist")) return null;
    var parts = String(val.hist).split(";");
    var cur = parseInt(parts[0], 10);
    if (!(cur > 190001)) return null;
    var map = {};
    (parts[1] || "").split(",").forEach(function (e) {
      var f = e.split(":");
      if (f.length === 3) map[f[0]] = [parseFloat(f[1]), parseFloat(f[2])];
    });
    map[cur] = [has("pvMes") ? val.pvMes : null, has("loadMes") ? val.loadMes : null];
    // Os 12 meses que acabam no mês em curso; começa no primeiro que tem dados.
    var list = [];
    for (var i = 11; i >= 0; i--) {
      var y = Math.floor(cur / 100), m = (cur % 100) - i;
      while (m < 1) { m += 12; y--; }
      var ym = y * 100 + m;
      var d = map[ym];
      if (d || list.length) list.push({ ym: ym, pv: d ? d[0] : null, ld: d ? d[1] : null, cur: ym === cur });
    }
    return list;
  }
  function niceMax(v) {
    if (!(v > 0)) return 10;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  // Barra com o topo arredondado a 4 e a base direita, assente na linha de base.
  function barPath(x, y, w, base) {
    var r = Math.min(4, w / 2, base - y);
    if (base - y <= 0) return "";
    return "M" + x + " " + base + "V" + (y + r) + "Q" + x + " " + y + " " + (x + r) + " " + y +
      "H" + (x + w - r) + "Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) + "V" + base + "Z";
  }
  function renderMonths() {
    var list = monthSeries();
    show("months", !!list);
    if (!list) return;
    // Desenha à largura real: com um viewBox fixo, no telemóvel o SVG encolhia
    // tudo por igual e o texto dos eixos ficava ilegível.
    var W = Math.max(280, Math.round(ui.mchart.clientWidth || 640));
    var key = W + JSON.stringify(list);
    if (key === monthsKey) return;
    monthsKey = key;
    monthsData = list;

    var H = 220, L = 44, R = 8, T = 12, B = 30;
    monthsGeom = { W: W, L: L, R: R };
    var max = niceMax(Math.max.apply(null, list.map(function (d) { return Math.max(d.pv || 0, d.ld || 0); })));
    var band = (W - L - R) / list.length;
    var bw = Math.min(24, (band - 12) / 2); // nunca preenche a faixa: o resto é ar
    var base = H - B;
    var sy = function (v) { return base - (v / max) * (H - T - B); };
    var s = "";
    for (var g = 0; g <= 2; g++) {
      var gv = (max / 2) * g, gy = sy(gv);
      s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>' +
        '<text class="ax" x="' + (L - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + nf0.format(gv) + "</text>";
    }
    list.forEach(function (d, i) {
      var cx = L + band * i + band / 2;
      var x1 = cx - bw - 1, x2 = cx + 1; // 2 de ar entre as duas barras
      if (d.pv != null) s += '<path class="bar" style="--c:var(--dd-solar)" d="' + barPath(x1, sy(d.pv), bw, base) + '"/>';
      if (d.ld != null) s += '<path class="bar" style="--c:var(--dd-cons)" d="' + barPath(x2, sy(d.ld), bw, base) + '"/>';
      var first = i === 0 || d.ym % 100 === 1;
      // Faixas estreitas: um rótulo sim, outro não, sempre a contar do mês em curso.
      var step = band < 40 ? 2 : 1;
      var lbl = (list.length - 1 - i) % step === 0;
      s += (lbl ? '<text class="ax' + (d.cur ? " cur" : "") + '" x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle">' + monthLabel(d.ym, first) + "</text>" : "") +
        '<rect class="hit" data-i="' + i + '" x="' + (L + band * i) + '" y="' + T + '" width="' + band + '" height="' + (base - T) + '" tabindex="0"' +
        ' aria-label="' + monthLabel(d.ym, true) + ": produção " + kwhShort(d.pv) + ", consumo " + kwhShort(d.ld) + '"/>';
    });
    s += '<line class="base" x1="' + L + '" x2="' + (W - R) + '" y1="' + base + '" y2="' + base + '"/>';
    ui.mchart.setAttribute("viewBox", "0 0 " + W + " " + H);
    ui.mchart.setAttribute("aria-label", "Produção e consumo por mês, " + list.length + " meses");
    ui.mchart.innerHTML = s;

    var rows = "<thead><tr><th>Mês</th><th>Produção</th><th>Consumo</th></tr></thead><tbody>";
    list.slice().reverse().forEach(function (d) {
      rows += "<tr><td>" + monthLabel(d.ym, true) + (d.cur ? " (em curso)" : "") + "</td><td>" + kwhShort(d.pv) + "</td><td>" + kwhShort(d.ld) + "</td></tr>";
    });
    ui.mtable.innerHTML = rows + "</tbody>";
  }
  function monthTip(i) {
    var d = monthsData[i];
    if (!d) return hideMonthTip();
    var tip = ui.mtip;
    tip.innerHTML = "<b>" + monthLabel(d.ym, true) + (d.cur ? " · em curso" : "") + "</b>" +
      '<span><span class="dd-key" style="--c:var(--dd-solar)"></span>Produção <b>' + kwhShort(d.pv) + "</b></span>" +
      '<span><span class="dd-key" style="--c:var(--dd-cons)"></span>Consumo <b>' + kwhShort(d.ld) + "</b></span>";
    tip.hidden = false;
    var box = ui.mchart.getBoundingClientRect();
    var n = monthsData.length;
    var G = monthsGeom;
    var cx = ((G.L + ((G.W - G.L - G.R) / n) * (i + 0.5)) / G.W) * box.width;
    var left = Math.max(0, Math.min(box.width - tip.offsetWidth, cx - tip.offsetWidth / 2));
    tip.style.left = left + "px";
  }
  function hideMonthTip() {
    ui.mtip.hidden = true;
  }
  function setupMonths() {
    var svg = ui.mchart;
    var on = function (e) {
      var i = e.target.getAttribute && e.target.getAttribute("data-i");
      if (i != null) monthTip(+i);
    };
    svg.addEventListener("pointerover", on);
    svg.addEventListener("focusin", on);
    svg.addEventListener("pointerleave", hideMonthTip);
    svg.addEventListener("focusout", hideMonthTip);
    window.addEventListener("resize", function () {
      clearTimeout(setupMonths.t);
      setupMonths.t = setTimeout(renderMonths, 150);
    });
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

    renderMonths();

    // Diagrama. O nó do gerador e o da saída LOAD seguem a app da Deye: só
    // aparecem quando há mesmo potência a passar por eles.
    var u = has("ups") && val.ups >= idle ? val.ups : null;
    var gn = has("gen") && val.gen >= idle ? val.gen : null;
    var lHome = u != null && l != null ? Math.max(0, l - u) : l;
    branch("top", "gPv", "gGen", "pv", "gen", "M170 72V126", "M114 72L152 126", "M226 72L188 126", gn != null);
    branch("bottom", "gHome", "gUps", "home", "ups", "M170 174V228", "M152 174L114 228", "M188 174L226 228", u != null);
    flow("pv", s);
    flow("gen", gn);
    flow("bat", b);
    flow("grid", g);
    flow("home", lHome);
    flow("ups", u);
    set("fGen", gn == null ? "—" : powerTxt(gn));
    set("fUps", u == null ? "—" : powerTxt(u));
    set("fPv", powerTxt(s));
    set("fBat", b == null ? "—" : powerTxt(Math.abs(b)));
    set("fBatL", "Bateria" + (has("soc") ? " · " + nf0.format(val.soc) + " %" : ""));
    set("fGrid", g == null ? "—" : powerTxt(Math.abs(g)));
    set("fGridL", g == null || Math.abs(g) < idle ? "Rede" : g > 0 ? "Rede · compra" : "Rede · venda");
    set("fHome", loadTxt(lHome));
    set("fHomeL", !loadMeasured() ? "Casa (estimado)" : u != null ? "Casa (sem LOAD)" : "Casa");
    ui.flow.setAttribute(
      "aria-label",
      "Fluxo de energia: solar " + powerTxt(s) + ", bateria " + batText(b).toLowerCase() + ", rede: " + gridText(g).toLowerCase() +
        (g != null && Math.abs(g) >= idle ? " " + powerTxt(Math.abs(g)) : "") + ", casa " + loadTxt(lHome) +
        (u != null ? ", saída LOAD " + powerTxt(u) : "") + (gn != null ? ", gerador " + powerTxt(gn) : "")
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
    // A estimativa vai numa linha própria: colada ao estado, partia a meio.
    var au = autonomy(batAvg(b));
    set("soc.au", au || "");
    if (ui["soc.au"].hidden === !!au) ui["soc.au"].hidden = !au;
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
    row("sBat", has("vBat") || has("iBat") || has("tBat"), function () {
      set("sBat", join([has("vBat") && nf2.format(val.vBat) + " V", has("iBat") && nf1.format(Math.abs(val.iBat)) + " A", has("tBat") && nf1.format(val.tBat) + " °C"]));
    });
    row("sTemp", has("tDc") || has("tAc"), function () {
      set("sTemp", join([has("tDc") && "DC " + nf1.format(val.tDc) + " °C", has("tAc") && "AC " + nf1.format(val.tAc) + " °C"]));
    });
    row("sPv", has("vPv1") || has("vPv2"), function () {
      set("sPv", join([has("vPv1") && "PV1 " + nf0.format(val.vPv1) + " V", has("vPv2") && "PV2 " + nf0.format(val.vPv2) + " V"]));
    });
    // Potência que sai pelos bornes LOAD. Está incluída no "Consumo da Casa"
    // (registo 178), por isso mostra-se também o resto da casa, que é a diferença.
    row("sUps", has("ups"), function () {
      set("sUps", join([nf0.format(val.ups) + " W", has("load") && "resto da casa " + nf0.format(val.load - val.ups) + " W"]));
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
