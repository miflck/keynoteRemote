// Mac-Client: empfängt Befehle vom Render-Server und steuert Keynote lokal.
//
// Einrichtung:
//   npm install socket.io-client
//
// Start (PLAYER_SIDE = left, right oder center, je nach Mac):
//   SERVER_URL=https://DEIN-DIENST.onrender.com ACCESS_TOKEN=DEIN_CODE PLAYER_SIDE=left node client.js

require("dotenv").config(); // Werte aus .env (pro Mac)

const { execFile } = require("child_process");
const { io } = require("socket.io-client");

const SERVER_URL = process.env.SERVER_URL;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PLAYER_SIDE = process.env.PLAYER_SIDE;
// CAN_FOCUS=1 nur auf dem Mac mit Keynote UND den VJ-Playern: dort schalten die Handy-Buttons
// "VJ vorne" / "Keynote vorne" zwischen den laufenden VJ-Playern und Keynote um.
// VJ_APP_NAMES: Prozessnamen der Player (Komma-getrennt). Installierte App: "VJ Player",
// bei npm start: "Electron". VJ_HIDE=1 blendet die Player bei "Keynote vorne" zusätzlich aus.
const CAN_FOCUS = process.env.CAN_FOCUS === "1";
const VJ_APP_NAMES = (process.env.VJ_APP_NAMES || "VJ Player,Electron").split(",").map((n) => n.trim()).filter(Boolean);
const VJ_HIDE = process.env.VJ_HIDE === "1";
const POLL_MS = Number(process.env.POLL_MS ?? 3000);

if (!SERVER_URL || !ACCESS_TOKEN || !["left", "right", "center"].includes(PLAYER_SIDE)) {
  console.error("SERVER_URL, ACCESS_TOKEN und PLAYER_SIDE (left|right|center) müssen gesetzt sein.");
  process.exit(1);
}

// Gibt "Folie|Gesamt" oder "error|Meldung" zurück. Startet Keynote nie selbst.
function buildScript(action) {
  return `
if application "Keynote" is not running then return "error|Keynote läuft nicht"
tell application "Keynote"
  if not playing then return "error|Keine Präsentation gestartet"
  ${action}
  set d to front document
  return ((slide number of current slide of d) as text) & "|" & ((count of slides of d) as text)
end tell`;
}

const SCRIPT_BY_COMMAND = {
  next: buildScript("show next\n  delay 0.15"),
  previous: buildScript("show previous\n  delay 0.15"),
  status: buildScript(""),
};

function runKeynote(command) {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", SCRIPT_BY_COMMAND[command]], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve({ error: "osascript: " + error.message.split("\n")[0] });
        return;
      }
      const [first, second] = stdout.trim().split("|");
      if (first === "error") {
        resolve({ error: second });
        return;
      }
      resolve({ slide: Number(first), total: Number(second) });
    });
  });
}

// Alle Keynote-Aufrufe laufen nacheinander, damit die Reihenfolge stimmt.
let queue = Promise.resolve();
let pending = 0;
function enqueue(task) {
  pending++;
  queue = queue.then(task).catch((e) => console.error(e)).finally(() => { pending--; });
  return queue;
}

let lastSeq = null; // letzter ausgeführter Befehl; null = noch nie verbunden
let lastReport = "";

function report(result) {
  const payload = {
    slide: result.slide ?? null,
    total: result.total ?? null,
    error: result.error ?? null,
  };
  const key = JSON.stringify(payload);
  if (key === lastReport && socket.connected) return;
  lastReport = key;
  socket.emit("report", payload);
}

const socket = io(SERVER_URL, {
  // Funktion: bei jedem (Wieder-)Verbinden wird der aktuelle lastSeq mitgeschickt.
  auth: (cb) => cb({ token: ACCESS_TOKEN, role: "player", side: PLAYER_SIDE, focus: CAN_FOCUS, lastSeq }),
});

socket.on("connect", () => {
  console.log(`Verbunden mit ${SERVER_URL} als "${PLAYER_SIDE}"`);
  lastReport = ""; // nach Reconnect den Stand neu melden
  enqueue(async () => report(await runKeynote("status")));
});
socket.on("disconnect", (reason) => console.log("Verbindung getrennt:", reason));
socket.on("connect_error", (error) => console.error("Verbindungsfehler:", error.message));

// Server teilt den aktuellen Zählerstand mit. Beim ersten Start (oder nach einem
// Server-Neustart, wo der Zähler zurückgesetzt wurde) wird übernommen, nichts nachgeholt.
socket.on("sync", (serverSeq) => {
  if (lastSeq === null || lastSeq > serverSeq) lastSeq = serverSeq;
});

socket.on("cmd", ({ seq, cmd } = {}) => {
  if (!Number.isInteger(seq) || !Object.hasOwn(SCRIPT_BY_COMMAND, cmd) || cmd === "status") return;
  if (lastSeq !== null && seq <= lastSeq) return; // schon ausgeführt
  lastSeq = seq;

  enqueue(async () => {
    const result = await runKeynote(cmd);
    if (result.error) console.error(`"${cmd}" fehlgeschlagen:`, result.error);
    else console.log(`Ausgeführt: ${cmd} → Folie ${result.slide}/${result.total}`);
    report(result);
  });
});

// Alle laufenden VJ-Player (Prozesse mit passendem Namen) ein- bzw. ausblenden und nach vorne holen.
// Braucht für Terminal die Berechtigung "Automation → System Events".
const VJ_SCRIPT = `
on run argv
  set mode to item 1 of argv
  set found to 0
  tell application "System Events"
    repeat with p in (application processes whose background only is false)
      if (rest of argv) contains (name of p) then
        set found to found + 1
        if mode is "front" then
          set visible of p to true
          set frontmost of p to true
        else if mode is "hide" then
          set visible of p to false
        end if
      end if
    end repeat
  end tell
  if found is 0 then return "error|Kein VJ Player gefunden (" & (rest of argv as text) & ")"
  return "ok"
end run`;

function osascript(args) {
  return new Promise((resolve) => {
    execFile("osascript", args, { timeout: 8000 }, (error, stdout) => {
      if (error) resolve({ error: "osascript: " + error.message.split("\n")[0] });
      else if (stdout.startsWith("error|")) resolve({ error: stdout.trim().split("|")[1] });
      else resolve({});
    });
  });
}

socket.on("view", (mode) => {
  if (mode !== "vj" && mode !== "keynote") return;
  enqueue(async () => {
    let result;
    if (mode === "vj") {
      result = await osascript(["-e", VJ_SCRIPT, "front", ...VJ_APP_NAMES]);
    } else {
      result = await osascript(["-e", 'if application "Keynote" is running then tell application "Keynote" to activate']);
      if (VJ_HIDE && !result.error) result = await osascript(["-e", VJ_SCRIPT, "hide", ...VJ_APP_NAMES]);
    }
    if (result.error) console.error(`"${mode} vorne" fehlgeschlagen:`, result.error);
    else console.log(`${mode === "vj" ? "VJ-Player" : "Keynote"} nach vorne geholt`);
    const status = await runKeynote("status");
    report(result.error ? { ...status, slide: status.slide, error: result.error } : status);
  });
});

// Folie regelmässig abfragen (z. B. falls jemand von Hand weiterschaltet).
// Standard 3 s; ausschalten mit POLL_MS=0.
if (POLL_MS > 0) {
  setInterval(() => {
    if (!socket.connected || pending > 0) return;
    enqueue(async () => report(await runKeynote("status")));
  }, POLL_MS);
}
