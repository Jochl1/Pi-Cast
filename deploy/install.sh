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
  check_power before
}

# Undervoltage corrupts SD card writes, and the install writes a lot.
# vcgencmd get_throttled: bit 0 = undervolted now, bit 16 = since boot.
check_power() {
  local when="$1" t
  command -v vcgencmd >/dev/null || return 0
  t="$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)"
  [[ "$t" == 0x* ]] || return 0
  (( (t & 0x10001) == 0 )) && return 0
  if [[ "$when" == before ]]; then
    [[ "${PICAST_IGNORE_POWER:-}" == 1 ]] && { warn "Undervoltage detected ($t), continuing anyway."; return 0; }
    die "The Pi reports undervoltage (throttled=$t). Writing to the SD card like this can corrupt it.
   Use a 5 V / 2.5 A power supply with a short cable, reboot, and run the installer again.
   To install anyway: PICAST_IGNORE_POWER=1 ./deploy/install.sh"
  fi
  warn "The Pi reported undervoltage during the install (throttled=$t). Get a better power supply soon."
}

# Checks that the kernel and initramfs the firmware boots from match the
# packaged copies, so a damaged SD card shows up now instead of as a Pi that
# no longer boots (green LED blinking 7 times).
verify_boot_files() {
  local fw=/boot/firmware kver
  [[ -d "$fw" ]] || fw=/boot
  kver="$(uname -r)"
  say "Checking the boot files"
  sync
  sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches' # read back from the card, not the cache
  if [[ -f "$fw/kernel8.img" && -f "/boot/vmlinuz-$kver" ]] \
    && ! sudo cmp -s "$fw/kernel8.img" "/boot/vmlinuz-$kver"; then
    die "$fw/kernel8.img is damaged. Don't reboot yet: the Pi wouldn't start.
   Try once: sudo cp /boot/vmlinuz-$kver $fw/kernel8.img && sync
   then run the installer again. If it fails again, the SD card is faulty; replace it."
  fi
  if [[ -f "$fw/initramfs8" && -f "/boot/initrd.img-$kver" ]] \
    && ! sudo cmp -s "$fw/initramfs8" "/boot/initrd.img-$kver"; then
    warn "$fw/initramfs8 differs from /boot/initrd.img-$kver. If the Pi doesn't boot, copy it over."
  fi
}

install_packages() {
  say "Installing system packages (this takes a while)"
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    mpv ffmpeg python3-venv curl ca-certificates cec-utils v4l-utils \
    plymouth plymouth-themes imagemagick librsvg2-bin fontconfig git shairport-sync
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
  say "Installing yt-dlp, streamlink and instagrapi into $REPO/.venv"
  [[ -x "$REPO/.venv/bin/pip" ]] || python3 -m venv "$REPO/.venv"
  "$REPO/.venv/bin/pip" install -q -U pip
  "$REPO/.venv/bin/pip" install -U "yt-dlp[default]" streamlink instagrapi

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
# The boot splash stays until Pi-Cast is ready to draw (it says so with sd_notify).
Before=plymouth-quit.service plymouth-quit-wait.service

[Service]
Type=notify
NotifyAccess=all
TimeoutStartSec=180
User=$APP_USER
WorkingDirectory=$REPO
# Reads the home screen's files into the page cache while Node loads (in the background).
ExecStartPre=-/bin/sh -c 'sh bin/preload.sh &'
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

install_airplay() {
  say "Setting up AirPlay (shairport-sync)"
  # pi-cast reads the metadata pipe for the TV screen. The HDMI device takes one
  # program at a time; pi-cast's sounds helper keeps off it during a session.
  if install_file /etc/shairport-sync.conf <<'EOF'
// pi-cast: AirPlay speaker. Generated by install.sh.
general = {
	name = "pi-cast";
	output_backend = "alsa";
};
sessioncontrol = {
	allow_session_interruption = "yes";
	session_timeout = 20;
};
alsa = {
	output_device = "hdmi:CARD=vc4hdmi,DEV=0";
};
metadata = {
	enabled = "yes";
	include_cover_art = "yes";
	pipe_name = "/tmp/shairport-sync-metadata";
	pipe_timeout = 5000;
};
EOF
  then
    sudo systemctl restart shairport-sync
  fi
  sudo systemctl enable --now shairport-sync >/dev/null 2>&1 || true
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

install_boot_splash() {
  say "Installing the boot splash"
  (cd "$REPO" && node scripts/boot-splash.js)

  # Root helper the app calls (via sudo) after the accent/style changes.
  install_file /usr/local/sbin/picast-plymouth-update 755 <<EOF || true
#!/bin/bash
# Copies the Pi-Cast boot splash built by the app into the Plymouth theme and
# rebuilds the initramfs (about a minute on a Pi 3). Generated by install.sh.
set -euo pipefail
exec 9>/run/picast-plymouth.lock
flock 9
SRC="$REPO/data/plymouth"
DEST=/usr/share/plymouth/themes/picast
install -d "\$DEST"
install -m 644 "\$SRC"/*.png "\$SRC/picast.script" "\$SRC/picast.plymouth" "\$DEST/"
plymouth-set-default-theme -R picast >/dev/null
EOF

  # The splash helper, restarting shairport-sync to end an AirPlay session,
  # and the settings panel's power row.
  if install_file /etc/sudoers.d/picast 440 <<EOF
$APP_USER ALL=(root) NOPASSWD: /usr/local/sbin/picast-plymouth-update
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart shairport-sync
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff
EOF
  then
    sudo visudo -cf /etc/sudoers.d/picast >/dev/null \
      || { sudo rm -f /etc/sudoers.d/picast; die "The generated sudoers rule is invalid."; }
  fi

  say "Rebuilding the initramfs with the splash (about a minute)"
  sudo /usr/local/sbin/picast-plymouth-update
}

configure_boot() {
  say "Hiding boot text"
  local cfg=/boot/firmware/config.txt cmd=/boot/firmware/cmdline.txt line p
  [[ -f "$cfg" ]] || cfg=/boot/config.txt
  [[ -f "$cmd" ]] || cmd=/boot/cmdline.txt

  # No rainbow screen. Appended under [all] so it isn't caught in a [pi4]-style section.
  if ! grep -q '^disable_splash=1' "$cfg"; then
    backup "$cfg"
    printf '\n[all]\n# Pi-Cast: no rainbow screen at boot\ndisable_splash=1\n' | sudo tee -a "$cfg" >/dev/null
  fi

  # Kernel command line (one line): quiet boot, splash, console moved off the TV's tty1.
  line="$(head -n1 "$cmd")"
  line="$(sed -E 's/(^| )console=tty1( |$)/\1console=tty3\2/' <<<"$line")"
  for p in quiet splash loglevel=3 logo.nologo vt.global_cursor_default=0 consoleblank=0 plymouth.ignore-serial-consoles; do
    [[ " $line " == *" $p "* ]] || line+=" $p"
  done
  if [[ "$line" != "$(head -n1 "$cmd")" ]]; then
    backup "$cmd"
    echo "$line" | sudo tee "$cmd" >/dev/null
  fi

  # No login prompt on the TV (SSH still works).
  sudo systemctl disable getty@tty1.service 2>/dev/null || true
  if [[ "$(systemctl get-default)" == "graphical.target" ]]; then
    sudo systemctl set-default multi-user.target
    warn "The Pi booted to a desktop before; it now boots to the console, so Pi-Cast owns the screen."
  fi

  # Keep the splash on screen after boot until mpv draws, instead of flashing a console.
  install_file /etc/systemd/system/plymouth-quit.service.d/picast.conf <<'EOF' || true
[Service]
ExecStart=
ExecStart=-/usr/bin/plymouth quit --retain-splash
EOF
  sudo systemctl daemon-reload
}

finish() {
  local host
  host="$(hostname)"
  sudo apt-get clean # frees a few hundred MB on the card
  check_power after
  say "Done"
  cat <<EOF

  Reboot now:            sudo reboot   (don't just unplug it)
  Then on your iPhone:   http://$host.local:8080
  Cast from YouTube:     tap Cast → Pi-Cast
  Logs:                  journalctl -u picast -f

  TV black but showing a signal? Turn the TV off and on once.

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
install_airplay
disable_wifi_powersave
install_boot_splash
configure_boot
verify_boot_files
finish
