#!/bin/bash
# Double-click to run the demo: starts the call server and the web server, opens the app in Chrome.
# Close this window (or press Ctrl+C) to stop both.
cd "$(dirname "$0")" || exit 1
echo "== Breathing sonar demo =="
pids=()
trap 'kill "${pids[@]}" 2>/dev/null; exit' INT TERM EXIT HUP

# Call server (phones the friend). Skip if already running.
if curl -s -o /dev/null http://127.0.0.1:8788/ 2>/dev/null || lsof -iTCP:8788 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Call server: already running"
else
  /usr/bin/python3 call/server.py & pids+=($!)
fi

# Web server for the app. Reuse one that already serves this repo on port 8000.
if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/app/hooks.js)" = 200 ]; then
  echo "Web server: already running"
else
  /usr/bin/python3 -m http.server 8000 --bind 127.0.0.1 >/dev/null 2>&1 & pids+=($!)
  for _ in $(seq 20); do curl -s -o /dev/null http://localhost:8000/ && break; sleep 0.25; done
fi

open -a "Google Chrome" "http://localhost:8000/app/" 2>/dev/null || open "http://localhost:8000/app/"
echo
echo "App open in Chrome. Allow the mic. Press Stop in the app to save the recording to Downloads."
echo "Leave this window open during the demo. Close it to stop everything."
wait
