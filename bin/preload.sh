#!/bin/sh
# Reads what the TV needs first into the page cache: mpv and its libraries,
# and the home backdrop clip (data/backdrop-path, saved by the app). Run in
# the background by picast.service while Node loads, which takes ~20 s on a
# Pi 3 at boot; from a cold SD card, mpv and the clip took ~7 s more to show.
cd "$(dirname "$0")/.." || exit 0
mpv --version >/dev/null 2>&1
backdrop=$(cat data/backdrop-path 2>/dev/null)
[ -f "$backdrop" ] && cat "$backdrop" >/dev/null
exit 0
