#!/usr/bin/env bash
# Pi-Cast installer. Run on the Pi as your normal user (not root):
#   ./deploy/install.sh
# Safe to run again: every step checks what's already done.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="$(id -un)"
BACKUP_DIR="/var/backups/picast"

say()  { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }

# Copies a system file to $BACKUP_DIR once, before we first touch it.
backup() {
  local f="$1" dest="$BACKUP_DIR$1.orig"
  [[ -e "$f" && ! -e "$dest" ]] || return 0
  sudo mkdir -p "$(dirname "$dest")"
  sudo cp -a "$f" "$dest"
}

# Writes stdin to a root-owned file, only if the content changed.
# Returns 0 if the file was (re)written.
install_file() {
  local dest="$1" mode="${2:-644}" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if sudo cmp -s "$tmp" "$dest" 2>/dev/null; then
    rm -f "$tmp"
    return 1
  fi
  backup "$dest"
  sudo install -D -m "$mode" "$tmp" "$dest"
  rm -f "$tmp"
}

check_system() {
  say "Checking the system"
  [[ $EUID -ne 0 ]] || die "Run this as your normal user, not with sudo. It asks for sudo when needed."
  [[ "$(uname -m)" == "aarch64" ]] || die "Needs 64-bit Raspberry Pi OS (aarch64), found $(uname -m). Re-flash with 'Raspberry Pi OS Lite (64-bit)'."
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == "debian" || "${ID:-}" == "raspbian" || "${ID_LIKE:-}" == *debian* ]] \
    || die "Needs Raspberry Pi OS, found ${PRETTY_NAME:-unknown}."
  (( ${VERSION_ID:-0} >= 12 )) || die "Needs Raspberry Pi OS Bookworm (12) or newer, found ${PRETTY_NAME:-unknown}."
  sudo -v || die "sudo is required."
}

install_packages() {
  say "Installing system packages (this takes a while)"
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    mpv ffmpeg python3-venv curl ca-certificates v4l-utils \
    plymouth plymouth-themes imagemagick librsvg2-bin fontconfig git
}

install_node() {
  local major=0
  command -v node >/dev/null && major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major >= 22 )); then
    say "Node.js $(node -v) is new enough"
    return
  fi
  say "Installing Node.js 22 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

install_app() {
  say "Installing yt-dlp and streamlink into $REPO/.venv"
  [[ -x "$REPO/.venv/bin/pip" ]] || python3 -m venv "$REPO/.venv"
  "$REPO/.venv/bin/pip" install -q -U pip
  "$REPO/.venv/bin/pip" install -U "yt-dlp[default]" streamlink

  say "Installing Node packages"
  (cd "$REPO" && npm ci --omit=dev --no-audit --no-fund)
  mkdir -p "$REPO/data" "$REPO/mpv-scripts"
}

install_fonts() {
  local dest=/usr/local/share/fonts/picast
  say "Installing the Sora and JetBrains Mono fonts for the TV screens"
  sudo install -d "$dest"
  sudo install -m 644 "$REPO"/assets/fonts/*.ttf "$REPO"/assets/fonts/OFL-*.txt "$dest/"
  sudo fc-cache -f "$dest" >/dev/null
}

install_sponsorblock() {
  local dest="$REPO/mpv-scripts/sponsorblock_minimal.lua" branch
  [[ -s "$dest" ]] && return
  say "Downloading the SponsorBlock mpv script"
  for branch in master main; do
    if curl -fsSL -o "$dest.tmp" \
      "https://codeberg.org/jouni/mpv_sponsorblock_minimal/raw/branch/$branch/sponsorblock_minimal.lua"; then
      mv "$dest.tmp" "$dest"
      return
    fi
  done
  rm -f "$dest.tmp"
  warn "Couldn't download the SponsorBlock script; sponsor skipping stays off. Re-run the installer later."
}

setup_groups() {
  say "Adding $APP_USER to the video, render, audio and input groups"
  sudo usermod -aG video,render,audio,input "$APP_USER"
}

install_services() {
  say "Installing systemd services"
  install_file /etc/systemd/system/picast.service <<EOF || true
[Unit]
Description=Pi-Cast receiver
Wants=network-online.target
After=network-online.target sound.target

[Service]
User=$APP_USER
WorkingDirectory=$REPO
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
SupplementaryGroups=video render audio input
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  # YouTube breaks old yt-dlp versions regularly, so update daily.
  install_file /etc/systemd/system/picast-update.service <<EOF || true
[Unit]
Description=Update yt-dlp and streamlink for Pi-Cast
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$APP_USER
ExecStart=$REPO/.venv/bin/pip install -q -U yt-dlp[default] streamlink
EOF

  install_file /etc/systemd/system/picast-update.timer <<'EOF' || true
[Unit]
Description=Daily yt-dlp/streamlink update for Pi-Cast

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable picast.service picast-update.timer
}

disable_wifi_powersave() {
  say "Turning off Wi-Fi power saving"
  # 2 = disabled. Avoids stutter and cast discovery dropping out.
  if install_file /etc/NetworkManager/conf.d/picast-wifi-powersave.conf <<'EOF'
[connection]
wifi.powersave = 2
EOF
  then
    warn "Wi-Fi power saving is off from the next reboot."
  fi
}

finish() {
  local host
  host="$(hostname)"
  say "Done"
  cat <<EOF

  Reboot now:            sudo reboot
  Then on your iPhone:   http://$host.local:8080
  Cast from YouTube:     tap Cast → $(node -p "require('$REPO/src/../package.json') && 'Pi-Cast'")
  Logs:                  journalctl -u picast -f

EOF
}

check_system
install_packages
install_node
install_app
install_fonts
install_sponsorblock
setup_groups
install_services
disable_wifi_powersave
finish
