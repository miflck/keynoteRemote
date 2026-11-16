#!/bin/bash
# Startet client.js automatisch beim Login (macOS LaunchAgent).
#   ./autostart.sh install     einrichten und sofort starten
#   ./autostart.sh uninstall   entfernen
#   ./autostart.sh status      läuft er?
# Log: ~/Library/Logs/keynote-remote.log
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="ch.keynoteremote.client"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/keynote-remote.log"
DOMAIN="gui/$(id -u)"

case "$1" in
  install)
    NODE="$(command -v node || true)"
    [ -n "$NODE" ] || { echo "node nicht gefunden. Bitte Node.js installieren."; exit 1; }
    [ -f "$DIR/.env" ] || { echo ".env fehlt in $DIR (Vorlage: .env.example)."; exit 1; }
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    # caffeinate hält den Mac wach, solange der Client läuft.
    cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-di</string>
    <string>$NODE</string>
    <string>$DIR/client.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF
    plutil -lint "$PLIST" >/dev/null
    if [ -z "$DRY_RUN" ]; then
      launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
      launchctl bootstrap "$DOMAIN" "$PLIST"
    fi
    echo "Eingerichtet. Läuft ab jetzt bei jedem Login. Log: $LOG"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Entfernt."
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state|pid" || echo "läuft nicht"
    ;;
  *)
    echo "Benutzung: $0 install | uninstall | status"
    exit 1
    ;;
esac
