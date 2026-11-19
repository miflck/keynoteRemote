// Render.com-Server: nimmt Befehle von Handys an und verteilt sie an die Macs.
// Drei Seiten ("left" / "right" / "center"): jeder Mac meldet sich mit seiner Seite an und
// bekommt nur die Befehle dieser Seite (Socket.IO-Rooms).
//
// Render-Einstellungen:
//   Build Command: npm install socket.io
//   Start Command: node server.js
//   Environment:   ACCESS_TOKEN=<langer zufälliger Code>
//
// Handy-Adresse: https://DEIN-DIENST.onrender.com/#token=DEIN_CODE
// Health-Check:  https://DEIN-DIENST.onrender.com/health

require("dotenv").config(); // lokal: Werte aus .env (auf Render gelten die Environment-Variablen)

const crypto = require("crypto");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const DEBOUNCE_MS = 400; // pro Seite
const LOG_SIZE = 100; // so viele Befehle pro Seite werden für Nachholen gemerkt
const ALLOWED_COMMANDS = new Set(["next", "previous", "reset"]);
const SIDES = ["left", "right", "center"];
// Zwei Gruppen von Bildschirmen, die getrennt zwischen VJ-Playern und Keynote wechseln.
const GROUPS = { center: ["center"], sides: ["left", "right"] };

if (!ACCESS_TOKEN) {
  console.error("ACCESS_TOKEN fehlt. Bitte als Umgebungsvariable setzen.");
  process.exit(1);
}

const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Keynote">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#111111">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" href="/icon-512.png">
<title>Keynote-Steuerung</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); height: 100dvh; overflow: hidden; display: flex; flex-direction: column; gap: 12px;
         font-family: -apple-system, system-ui, sans-serif; background: #111; color: #fff; }
  #status { text-align: center; padding: 4px; min-height: 1.6em; }
  #view { display: flex; gap: 12px; }
  #view:empty { display: none; }
  #view button { flex: 1; padding: 10px 0; font-size: 1.05rem; background: #2d5fa8; }
  #view button small { font-size: .8rem; opacity: .85; }
  #view button.keynote { background: #8a4b12; }
  #big { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
  #big .next { flex: 3; background: #0a7f45; font-size: 2.4rem; }
  #big .nums { font-size: 1rem; font-weight: 400; opacity: .9; font-variant-numeric: tabular-nums; }
  #big .prev { flex: 1; background: #444; font-size: 1.7rem; }
  #reset { padding: 8px 0; font-size: .95rem; background: #7a1f1f; flex-direction: row; }
  #reset.armed { background: #c62828; }
  #small { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .mini { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .mini .head { text-align: center; font-size: .78rem; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini .head.err { color: #ff8a80; opacity: 1; }
  .mini .btns { display: flex; gap: 4px; }
  .mini button { flex: 1; padding: 12px 0; font-size: 1.3rem; background: #333; border-radius: 10px; }
  .mini .next { background: #0a6a3b; }
  button { border: 0; min-height: 0; border-radius: 14px; color: #fff; touch-action: manipulation;
           display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
  button:disabled { opacity: .35; }
</style>
</head>
<body>
<div id="status">Verbinde …</div>
<div id="view"></div>
<div id="big">
  <button class="next" id="bigNext"><span>Weiter</span><span class="nums" id="nums"></span></button>
  <button class="prev" id="bigPrev">Zurück</button>
</div>
<button id="reset">Reset: alle an den Anfang</button>
<div id="small"></div>
<script src="/socket.io/socket.io.js"></script>
<script>
  var token = new URLSearchParams(location.hash.slice(1)).get("token");
  // Code merken, falls die Home-Bildschirm-App ohne #token=… gestartet wird.
  try { if (token) localStorage.setItem("token", token); else token = localStorage.getItem("token"); } catch (e) {}
  var statusEl = document.getElementById("status");
  var SIDES = [["left", "Links"], ["right", "Rechts"], ["center", "Mitte"]];
  var ui = {};
  var connected = false;
  var state = {};
  var socket = io({ auth: { token: token, role: "controller" } });
  // volatile: Ein Klick ohne Verbindung wird nicht später nachgeholt.
  function send(side, cmd) { socket.volatile.emit("cmd", { side: side, cmd: cmd }); }

  var bigNext = document.getElementById("bigNext");
  var bigPrev = document.getElementById("bigPrev");
  var nums = document.getElementById("nums");
  bigNext.addEventListener("click", function () { send("all", "next"); });
  bigPrev.addEventListener("click", function () { send("all", "previous"); });

  // Reset braucht zwei Tipper (gegen versehentliches Auslösen).
  var resetBtn = document.getElementById("reset");
  var resetTimer = null;
  function disarm() { clearTimeout(resetTimer); resetTimer = null; resetBtn.classList.remove("armed"); resetBtn.textContent = "Reset: alle an den Anfang"; }
  resetBtn.addEventListener("click", function () {
    if (resetTimer) { disarm(); send("all", "reset"); return; }
    resetBtn.classList.add("armed");
    resetBtn.textContent = "Nochmal tippen zum Zurücksetzen";
    resetTimer = setTimeout(disarm, 3000);
  });

  SIDES.forEach(function (entry) {
    var side = entry[0];
    var mini = document.createElement("section");
    mini.className = "mini";
    mini.innerHTML = '<div class="head"></div><div class="btns"><button class="prev">‹</button><button class="next">›</button></div>';
    document.getElementById("small").appendChild(mini);
    ui[side] = { head: mini.querySelector(".head"), next: mini.querySelector(".next"), prev: mini.querySelector(".prev") };
    ui[side].next.addEventListener("click", function () { send(side, "next"); });
    ui[side].prev.addEventListener("click", function () { send(side, "previous"); });
  });

  var viewBox = document.getElementById("view");
  var GROUPS = [["sides", "Links / Rechts"], ["center", "Mitte"]];
  var viewButtons = {};
  GROUPS.forEach(function (entry) {
    var b = document.createElement("button");
    b.addEventListener("click", function () { socket.volatile.emit("cmd", { cmd: "toggle", group: entry[0] }); });
    viewButtons[entry[0]] = b;
  });

  function render() {
    var v = state.view || {};
    // Je Gruppe nur anzeigen, wenn ein Mac mit CAN_FOCUS=1 verbunden ist.
    viewBox.textContent = "";
    GROUPS.forEach(function (entry) {
      var g = v[entry[0]] || { available: 0 };
      if (!(g.available > 0)) return;
      var b = viewButtons[entry[0]];
      b.textContent = "";
      b.appendChild(document.createTextNode(entry[1]));
      var small = document.createElement("small");
      small.textContent = g.mode === "keynote" ? "Keynote vorne" : "VJ vorne";
      b.appendChild(small);
      b.className = g.mode === "keynote" ? "keynote" : "";
      b.disabled = !connected;
      viewBox.appendChild(b);
    });
    var online = 0;
    var parts = [];
    SIDES.forEach(function (entry) {
      var side = entry[0];
      var s = state[side] || { players: 0 };
      var el = ui[side];
      var offline = s.players === 0;
      if (!offline) online++;
      var num = s.slide ? s.slide + " / " + s.total : "–";
      if (!offline) parts.push(entry[1] + " " + (s.slide || "–"));
      el.head.textContent = entry[1] + " · " + (offline ? "offline" : (s.error ? s.error : num));
      el.head.className = "head" + (!offline && s.error ? " err" : "");
      el.next.disabled = el.prev.disabled = !connected || offline;
    });
    nums.textContent = parts.join("  ·  ");
    bigNext.disabled = bigPrev.disabled = !connected || online === 0;
  }

  socket.on("connect", function () { connected = true; statusEl.textContent = ""; render(); });
  socket.on("state", function (s) { state = s; render(); });
  socket.on("disconnect", function () { connected = false; statusEl.textContent = "Verbindung getrennt …"; render(); });
  socket.on("connect_error", function (error) {
    connected = false;
    statusEl.textContent = error.message === "unauthorized" ? "Zugangscode fehlt oder ist falsch" : "Verbinde …";
    render();
  });
  // Handy-Bildschirm wach halten (Wake Lock) und nach dem Aufwecken sofort neu verbinden.
  var wakeLock = null;
  function keepAwake() {
    if (!("wakeLock" in navigator) || wakeLock) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () {});
  }
  document.addEventListener("pointerdown", keepAwake); // manche Browser verlangen eine Berührung
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    keepAwake();
    if (!socket.connected) socket.connect();
  });
  keepAwake();

  render();
</script>
</body>
</html>`;

function isValidToken(token) {
  if (typeof token !== "string") return false;
  const received = crypto.createHash("sha256").update(token).digest();
  const expected = crypto.createHash("sha256").update(ACCESS_TOKEN).digest();
  return crypto.timingSafeEqual(received, expected);
}

// App-Icons für den Home-Bildschirm (Ordner public/).
const fs = require("fs");
const path = require("path");
const ICONS = {
  "/apple-touch-icon.png": "apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png": "apple-touch-icon.png",
  "/icon-512.png": "icon-512.png",
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  if (Object.hasOwn(ICONS, urlPath)) {
    fs.readFile(path.join(__dirname, "public", ICONS[urlPath]), (error, data) => {
      if (error) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }).end(data);
    });
    return;
  }
  if (req.url === "/health") {
    res.setHeader("Content-Type", "text/plain");
    res.end("ok");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(page);
});

const io = new Server(server);
// Was ist je Gruppe vorne: "vj" oder "keynote" (Annahme am Anfang: VJ).
const view = { center: "vj", sides: "vj" };
const lastViewAt = { center: 0, sides: 0 };

// Zustand pro Seite. seq zählt die Befehle hoch; log merkt die letzten Befehle,
// damit ein Mac nach kurzer Offline-Zeit verpasste Befehle nachholen kann.
const sides = Object.fromEntries(
  SIDES.map((side) => [side, { seq: 0, log: [], lastCommandAt: 0, slide: null, total: null, error: null }]),
);

function playerCount(side) {
  return io.sockets.adapter.rooms.get(`players:${side}`)?.size ?? 0;
}

function roomSize(room) {
  return io.sockets.adapter.rooms.get(room)?.size ?? 0;
}

// Anzahl verbundener Macs mit CAN_FOCUS=1 in einer Gruppe.
function focusCount(group) {
  return GROUPS[group].reduce((sum, side) => sum + roomSize(`focusers:${side}`), 0);
}

function snapshot() {
  const state = Object.fromEntries(
    SIDES.map((side) => {
      const { slide, total, error } = sides[side];
      return [side, { slide, total, error, players: playerCount(side) }];
    }),
  );
  state.view = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, { mode: view[g], available: focusCount(g) }]));
  return state;
}

function broadcastState() {
  io.to("controllers").emit("state", snapshot());
}

io.use((socket, next) => {
  const auth = socket.handshake.auth ?? {};
  if (!isValidToken(auth.token)) {
    next(new Error("unauthorized"));
    return;
  }
  if (auth.role === "player") {
    if (!SIDES.includes(auth.side)) {
      next(new Error("invalid side"));
      return;
    }
    socket.data.role = "player";
    socket.data.side = auth.side;
    socket.data.lastSeq = Number.isInteger(auth.lastSeq) ? auth.lastSeq : null;
    socket.data.canFocus = auth.focus === true;
  } else {
    socket.data.role = "controller";
  }
  next();
});

// Befehl für eine Seite nummerieren, merken und an deren Macs schicken.
function dispatch(side, cmd) {
  const st = sides[side];
  const now = Date.now();
  if (now - st.lastCommandAt < DEBOUNCE_MS) return;
  st.lastCommandAt = now;

  const entry = { seq: ++st.seq, cmd };
  st.log.push(entry);
  if (st.log.length > LOG_SIZE) st.log.shift();
  io.to(`players:${side}`).emit("cmd", entry);
}

io.on("connection", (socket) => {
  if (socket.data.role === "player") {
    const { side, lastSeq } = socket.data;
    const st = sides[side];
    socket.join(`players:${side}`);
    if (socket.data.canFocus) socket.join(`focusers:${side}`);

    // Aktuellen Zählerstand mitteilen, dann verpasste Befehle nachliefern.
    socket.emit("sync", st.seq);
    if (lastSeq !== null && lastSeq < st.seq) {
      for (const entry of st.log) {
        if (entry.seq > lastSeq) socket.emit("cmd", entry);
      }
    }

    // Rückmeldung des Macs: aktuelle Folie oder Fehler.
    socket.on("report", (report) => {
      if (!report || typeof report !== "object") return;
      const { slide, total, error } = report;
      st.slide = Number.isInteger(slide) ? slide : null;
      st.total = Number.isInteger(total) ? total : null;
      st.error = typeof error === "string" && error ? error.slice(0, 80) : null;
      broadcastState();
    });
  } else {
    socket.join("controllers");
    socket.emit("state", snapshot());

    socket.on("cmd", (msg) => {
      if (!msg || typeof msg !== "object") return;
      const { side, cmd, group } = msg;

      // Gruppe zwischen VJ-Playern und Keynote umschalten.
      if (cmd === "toggle") {
        if (!Object.hasOwn(GROUPS, group)) return;
        const now = Date.now();
        if (now - lastViewAt[group] < DEBOUNCE_MS) return;
        lastViewAt[group] = now;
        view[group] = view[group] === "keynote" ? "vj" : "keynote";
        for (const s of GROUPS[group]) io.to(`focusers:${s}`).emit("view", view[group]);
        broadcastState();
        return;
      }

      if (!ALLOWED_COMMANDS.has(cmd)) return;
      // "all": alle Seiten gleichzeitig (Macs, die gerade offline sind, holen es beim Verbinden nach).
      if (side === "all") SIDES.forEach((sd) => dispatch(sd, cmd));
      else if (SIDES.includes(side)) dispatch(side, cmd);
    });
  }

  broadcastState();
  socket.on("disconnect", broadcastState);
});

server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
