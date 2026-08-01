#!/bin/bash
# Double-click me from Finder.
# Starts the local games server (if it is not already up) and opens the menu.
# Closing this Terminal window stops the server.

set -u

PORT=8777
URL="http://localhost:${PORT}/games-menu.html"

cd "$(dirname "$0")" || exit 1

port_is_serving() {
  # -f matters: without it curl exits 0 for ANY HTTP response, so an unrelated
  # process on this port answering 404 would read as "our server is already up"
  # and we would skip startup and open a dead URL. -f makes >=400 a failure.
  curl -sf -o /dev/null -m 2 "http://127.0.0.1:${PORT}/games-menu.html"
}

if port_is_serving; then
  echo "Server already running on port ${PORT}."
  open "$URL"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed or not on PATH. Install Node 22+ and try again."
  echo "Press any key to close."
  read -r -n 1
  exit 1
fi

echo "Starting server on http://localhost:${PORT}/ ..."
node server/serve.js &
SERVER_PID=$!

trap 'kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM

# Wait for it to answer before opening the browser.
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if port_is_serving; then
    break
  fi
  sleep 0.25
done

if ! port_is_serving; then
  echo "Server did not come up on port ${PORT}."
  echo "Press any key to close."
  read -r -n 1
  exit 1
fi

open "$URL"

echo ""
echo "Server is running. Close this window (or press Ctrl-C) to stop it."
wait "$SERVER_PID"
