# KeynoteRemote

Keynote auf zwei Macs (links / rechts) per Handy fernsteuern. Node.js + Socket.IO.

- `server.js` – läuft auf Render.com, liefert die Handy-Oberfläche und verteilt Befehle.
- `client.js` – läuft auf jedem Mac und steuert Keynote per `osascript`.

## Render
- Build Command: `npm install`
- Start Command: `node server.js`
- Environment: `ACCESS_TOKEN=<langer zufälliger Code>`

Handy-Adresse: `https://DEIN-DIENST.onrender.com/#token=DEIN_CODE`

## Mac
```bash
npm install
SERVER_URL=https://DEIN-DIENST.onrender.com ACCESS_TOKEN=DEIN_CODE PLAYER_SIDE=left node client.js
```
Auf dem anderen Mac `PLAYER_SIDE=right`. Optional `POLL_MS=0` schaltet die 3-s-Folienabfrage aus.

## Hinweise
- Terminal braucht auf jedem Mac die Automation-Berechtigung für Keynote.
- Verpasste Befehle werden nach dem Wiederverbinden nachgeholt (letzte 100 pro Seite).
- `/health` ist ein Endpunkt für einen externen Ping gegen das Einschlafen (kostenloser Render-Plan); aktuell nicht eingerichtet.
- Nicht getestet: echtes Keynote, Render, Handys.
