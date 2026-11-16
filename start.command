#!/bin/bash
# Doppelklick (oder Symlink auf dem Schreibtisch): startet den Keynote-Remote-Client.
# Fenster offen lassen; schliessen oder Ctrl+C beendet ihn.
SELF="$0"
[ -L "$SELF" ] && SELF="$(readlink "$SELF")"
cd "$(dirname "$SELF")" || exit 1

[ -f .env ] || { echo ".env fehlt (Vorlage: .env.example)."; read -r -p "Enter zum Schliessen"; exit 1; }
[ -d node_modules ] || npm install
exec caffeinate -di node client.js
