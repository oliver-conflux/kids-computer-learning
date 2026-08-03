#!/bin/bash
# Double-click me from Finder.
# Stops any server already on the port, starts a fresh one from THIS folder,
# and opens the menu. Closing this Terminal window stops the server.

set -u

PORT=8777
URL="http://localhost:${PORT}/games-menu.html"

cd "$(dirname "$0")" || exit 1

port_is_serving() {
  # -f matters: without it curl exits 0 for ANY HTTP response, so an unrelated
  # process on this port answering 404 would read as "our server is already up"
  # and we would open a dead URL. -f makes >=400 a failure.
  curl -sf -o /dev/null -m 2 "http://127.0.0.1:${PORT}/games-menu.html"
}

port_listeners() {
  # -sTCP:LISTEN IS NOT OPTIONAL. Without it, lsof also reports every process
  # with an ESTABLISHED connection to this port — which includes the browser
  # that has the games open. That would make Chrome look like it was holding
  # the port, and the guard below would refuse to start and tell you to go kill
  # your own browser. Only the process actually bound to the socket counts.
  lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null
}

# ALWAYS RESTART, NEVER ADOPT. This used to see a live server on the port and
# hand it the browser, which is wrong in the one case that actually happens: the
# server on 8777 belongs to a DIFFERENT checkout, or was started before the code
# it is serving changed. Node reads its modules once at boot, so a serve.js
# edited afterwards is not the serve.js that is running.
#
# That failure is invisible in the worst way — the menu loads, every game opens,
# and only the one feature added since that server booted is missing. It cost an
# afternoon once: a server started six seconds before the commit that taught it
# about the timeclock's log answered `unknown game` for the rest of the day, so
# the timer refused to start and looked broken while the code was fine.
#
# `port_is_serving` cannot tell the difference — any server on this port answers
# it. Nothing can, from the outside. So the only reliable move is to take the
# port back and start a server we know is this folder's.
if [ -n "$(port_listeners)" ]; then
  # Only ever kill our own server. A stranger on this port gets reported, not
  # killed — the whole point is to be sure what is serving, and silently taking
  # out an unrelated process would trade one confusion for a worse one.
  ours=""
  strangers=""
  for pid in $(port_listeners); do
    if ps -o command= -p "$pid" 2>/dev/null | grep -q 'serve\.js'; then
      ours="${ours} ${pid}"
    else
      strangers="${strangers} ${pid}"
    fi
  done

  if [ -n "${strangers# }" ]; then
    echo "Port ${PORT} is held by something that is not the games server:"
    for pid in $strangers; do
      echo "  pid ${pid}: $(ps -o command= -p "$pid" 2>/dev/null)"
    done
    echo "Stop it yourself, then run this again."
    echo "Press any key to close."
    read -r -n 1
    exit 1
  fi

  if [ -n "${ours# }" ]; then
    echo "Stopping the old server (pid${ours} ) so this folder's code is what runs."
    # shellcheck disable=SC2086
    kill $ours 2>/dev/null

    # Wait for the port to actually free. Killing is asynchronous, and binding
    # before the old socket is released fails with EADDRINUSE — which would look
    # exactly like "the server did not come up" and send you hunting the wrong
    # thing.
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      [ -z "$(port_listeners)" ] && break
      sleep 0.25
    done

    if [ -n "$(port_listeners)" ]; then
      # shellcheck disable=SC2086
      kill -9 $ours 2>/dev/null
      sleep 0.5
    fi
  fi
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
echo "Server is running from: $(pwd)"
echo "Close this window (or press Ctrl-C) to stop it."
wait "$SERVER_PID"
