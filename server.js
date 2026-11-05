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
const ALLOWED_COMMANDS = new Set(["next", "previous"]);
const SIDES = ["left", "right", "center"];

if (!ACCESS_TOKEN) {
  console.error("ACCESS_TOKEN fehlt. Bitte als Umgebungsvariable setzen.");
  process.exit(1);
}

const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keynote-Steuerung</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; height: 100dvh; overflow: hidden; display: flex; flex-direction: column; gap: 12px;
         font-family: -apple-system, system-ui, sans-serif; background: #111; color: #fff; }
  #status { text-align: center; padding: 4px; min-height: 1.6em; }
  #cols { flex: 3; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  #mid { flex: 2; min-height: 0; display: flex; }
  .col { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
  #mid .col { flex: 1; }
  h2 { margin: 0; text-align: center; font-size: 1.1rem; }
  .info { text-align: center; font-size: .8rem; min-height: 1.2em; opacity: .8; }
  .info.err { color: #ff8a80; opacity: 1; }
  button { border: 0; min-height: 0; border-radius: 14px; color: #fff; touch-action: manipulation;
           display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
  button:disabled { opacity: .35; }
  .next { flex: 3; background: #0a7f45; font-size: 1.6rem; }
  .next .num { font-size: 2.4rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .prev { flex: 1; background: #444; font-size: 1.4rem; }
</style>
</head>
<body>
<div id="status">Verbinde …</div>
<div id="cols"></div>
<div id="mid"></div>
<script src="/socket.io/socket.io.js"></script>
<script>
  var token = new URLSearchParams(location.hash.slice(1)).get("token");
  var status = document.getElementById("status");
  var SIDES = [["left", "Links", "cols"], ["right", "Rechts", "cols"], ["center", "Mitte", "mid"]];
  var ui = {};
  var connected = false;
  var state = {};
  var socket = io({ auth: { token: token, role: "controller" } });

  SIDES.forEach(function (entry) {
    var side = entry[0];
    var col = document.createElement("section");
    col.className = "col";
    col.innerHTML = '<h2></h2><div class="info"></div>' +
      '<button class="next"><span>Weiter</span><span class="num">–</span></button>' +
      '<button class="prev">Zurück</button>';
    col.querySelector("h2").textContent = entry[1];
    document.getElementById(entry[2]).appendChild(col);
    ui[side] = {
      info: col.querySelector(".info"),
      num: col.querySelector(".num"),
      next: col.querySelector(".next"),
      prev: col.querySelector(".prev"),
    };
    // volatile: Ein Klick ohne Verbindung wird nicht später nachgeholt.
    ui[side].next.addEventListener("click", function () { socket.volatile.emit("cmd", { side: side, cmd: "next" }); });
    ui[side].prev.addEventListener("click", function () { socket.volatile.emit("cmd", { side: side, cmd: "previous" }); });
  });

  function render() {
    SIDES.forEach(function (entry) {
      var side = entry[0];
      var s = state[side] || { players: 0 };
      var el = ui[side];
      var offline = s.players === 0;
      el.num.textContent = s.slide ? s.slide + " / " + s.total : "–";
      el.info.textContent = offline ? "Mac offline" : (s.error || (s.players + " Mac(s)"));
      el.info.className = "info" + (!offline && s.error ? " err" : "");
      el.next.disabled = el.prev.disabled = !connected || offline;
    });
  }

  socket.on("connect", function () { connected = true; status.textContent = ""; render(); });
  socket.on("state", function (s) { state = s; render(); });
  socket.on("disconnect", function () { connected = false; status.textContent = "Verbindung getrennt …"; render(); });
  socket.on("connect_error", function (error) {
    connected = false;
    status.textContent = error.message === "unauthorized" ? "Zugangscode fehlt oder ist falsch" : "Verbinde …";
    render();
  });
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

const server = http.createServer((req, res) => {
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

// Zustand pro Seite. seq zählt die Befehle hoch; log merkt die letzten Befehle,
// damit ein Mac nach kurzer Offline-Zeit verpasste Befehle nachholen kann.
const sides = Object.fromEntries(
  SIDES.map((side) => [side, { seq: 0, log: [], lastCommandAt: 0, slide: null, total: null, error: null }]),
);

function playerCount(side) {
  return io.sockets.adapter.rooms.get(`players:${side}`)?.size ?? 0;
}

function snapshot() {
  return Object.fromEntries(
    SIDES.map((side) => {
      const { slide, total, error } = sides[side];
      return [side, { slide, total, error, players: playerCount(side) }];
    }),
  );
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
  } else {
    socket.data.role = "controller";
  }
  next();
});

io.on("connection", (socket) => {
  if (socket.data.role === "player") {
    const { side, lastSeq } = socket.data;
    const st = sides[side];
    socket.join(`players:${side}`);

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
      const { side, cmd } = msg;
      if (!SIDES.includes(side) || !ALLOWED_COMMANDS.has(cmd)) return;

      const st = sides[side];
      const now = Date.now();
      if (now - st.lastCommandAt < DEBOUNCE_MS) return;
      st.lastCommandAt = now;

      const entry = { seq: ++st.seq, cmd };
      st.log.push(entry);
      if (st.log.length > LOG_SIZE) st.log.shift();
      io.to(`players:${side}`).emit("cmd", entry);
    });
  }

  broadcastState();
  socket.on("disconnect", broadcastState);
});

server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
