# KeynoteRemote

Keynote auf mehrere Macs (links / rechts / Mitte) per Handy fernsteuern. Node.js + Socket.IO.

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
Auf den anderen Macs `PLAYER_SIDE=right` bzw. `PLAYER_SIDE=center` (Mitte, quer unter den beiden anderen).

Alternativ die Werte in eine `.env` schreiben (Vorlage: `.env.example`), dann reicht `node client.js`. Lokal den Server testen: `ACCESS_TOKEN` in `.env`, dann `node server.js`. Optional `POLL_MS=0` schaltet die 3-s-Folienabfrage aus.

## Start per Doppelklick
`start.command` startet den Client (installiert bei Bedarf die Pakete und hält den Mac wach). Auf den Schreibtisch legen:
```bash
ln -s ~/Repos/KeynoteRemote/start.command ~/Desktop/Keynote-Remote.command
```
Zum automatischen Start beim Login die Datei unter Systemeinstellungen → Allgemein → Anmeldeobjekte hinzufügen.

## Autostart beim Login (Mac)
```bash
./autostart.sh install     # einrichten und starten
./autostart.sh status
./autostart.sh uninstall
```
Legt einen LaunchAgent an, der `client.js` beim Login startet, nach einem Absturz neu startet und den Mac wach hält. Log: `~/Library/Logs/keynote-remote.log`. Die `.env` muss vorher angelegt sein. Beim ersten Start fragt macOS einmal nach der Automation-Berechtigung (Keynote, System Events), diesmal für `node` statt für Terminal.

## Hinweise
- Terminal braucht auf jedem Mac die Automation-Berechtigung für Keynote.
- Verpasste Befehle werden nach dem Wiederverbinden nachgeholt (letzte 100 pro Seite).
- `/health` ist ein Endpunkt für einen externen Ping gegen das Einschlafen (kostenloser Render-Plan); aktuell nicht eingerichtet.
- Nicht getestet: echtes Keynote, Render, Handys.
