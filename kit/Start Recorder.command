#!/bin/bash
# Double-click to run the sonar recorder. First run installs what it needs (about 1 minute).
cd "$(dirname "$0")" || exit 1
echo "== Sonar breathing recorder =="
if ! /usr/bin/python3 -c "import sys; assert sys.version_info >= (3, 9)" 2>/dev/null; then
  echo "Python 3 is missing. A macOS window should offer to install the developer tools: accept it, then double-click this file again."
  read -r -p "Press Enter to close."; exit 1
fi
if [ ! -x .venv/bin/python ]; then
  echo "First run: installing (about 1 minute)..."
  /usr/bin/python3 -m venv .venv && .venv/bin/pip -q install --upgrade pip && .venv/bin/pip -q install rumps sounddevice numpy \
    || { echo "Install failed. Send a screenshot of this window to whoever sent you this."; read -r -p "Press Enter to close."; exit 1; }
fi
mkdir -p data
if [ ! -s data/who.txt ]; then read -r -p "Your first name (labels your recordings): " who; echo "$who" > data/who.txt; fi
[ -s data/plan.txt ] || echo "normal 30, hold 20, x3" > data/plan.txt
if [ ! -s data/track.txt ]; then
  echo; echo "How much do you want to help? (you can change this later in the menu)"
  (cd collect && ../.venv/bin/python -c "import tracks; [print(f'  {n}. {tracks.label(n)}') for n in tracks.NAMES]" 2>/dev/null)
  read -r -p "Type 1, 2 or 3 (just Enter = 1): " tier
  case "$tier" in 2|3) ;; *) tier=1 ;; esac
  echo "$tier" > data/track.txt
fi
if [ "$(osascript -e 'output muted of (get volume settings)')" = "true" ]; then
  echo "Your Mac is MUTED. Unmute it and set the volume to about half (the sound is too high to hear)."
  read -r -p "Press Enter once unmuted."
fi
export SONAR_WHO="$(head -1 data/who.txt)"
echo
echo "Look at the top-right of your screen for the  ◌  icon in the menu bar."
echo "macOS will ask to let Terminal use the microphone: click Allow."
echo "Leave this window open. Choose Quit from the  ◌  menu when you are done."
.venv/bin/python collect/menubar.py
# Pack the takes into one zip on the Desktop to send back
n=$(ls data/*take-*.wav 2>/dev/null | wc -l | tr -d ' ')
if [ "$n" -gt 0 ]; then
  out="$HOME/Desktop/sonar-takes-$SONAR_WHO.zip"; rm -f "$out"
  (cd data && zip -q "$out" ./*take-*.wav ./*take-*.json)
  echo; echo "Saved $n take(s) to $out . Send that file back (AirDrop or Google Drive)."
  open -R "$out"
else echo "No takes recorded."; fi
read -r -p "Press Enter to close."
