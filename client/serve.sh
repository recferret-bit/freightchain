#!/bin/sh
# Serve the game locally and open it. Usage: ./serve.sh [port]
cd "$(dirname "$0")" || exit 1
PORT="${1:-8765}"
( sleep 1; command -v open >/dev/null && open "http://localhost:$PORT/" || command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT/" ) >/dev/null 2>&1 &
echo "Serving http://localhost:$PORT/  (Ctrl+C to stop)"
exec python3 -m http.server "$PORT"
