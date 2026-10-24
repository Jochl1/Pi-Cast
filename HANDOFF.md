# Pi-Cast — handoff prompt for a new session

> **Status (2026-10-24):** all build phases in §8 are done and pushed; nothing has run on
> the Pi yet. Next step is hardware testing (§9). Deviations from the plan below:
> - TV glow is drawn with blurred ASS shapes, not an `overlay-add` bitmap: mpv draws
>   overlay-add bitmaps above all ASS overlays, so a bitmap background would cover the text.
>   Thumbnails still use overlay-add. The optional drifting home-screen video was not built.
> - CEC uses libcec's `cec-client` (package `cec-utils`) instead of `cec-ctl --monitor`,
>   because it answers the TV's power/menu queries that many TVs need before sending keys.
> - streamlink 6+ always filters Twitch ads; `--twitch-disable-ads` is gone.
> - The receiver's node-persist store is replaced (`src/receiverStore.js`): it writes
>   before initialising and drops data.
> - `scripts/preview-tv.js` renders the TV screens to PNG with any libass-enabled ffmpeg.

> Paste this file (or point the new session at it) to continue the build.
> Everything below was decided with the user in the previous session.

## 0. How to work with this user

- **Show the plan before writing code.** The user explicitly objected when code was written before the plan was presented. At the start of the session, summarize this plan back in a few lines, confirm, then build phase by phase. Before each phase, say in one or two lines what you're about to do.
- The user writes casually (typos, short messages). Answer in plain language and keep it short.
- `P:\git\Pi-Cast` is **not a git repo yet**. Ask before `git init` or any commit.
- Nothing can be tested on the real Pi from here (dev machine is Windows 11). Keep code testable locally where cheap (e.g. `node --check`, run the web server without mpv). At the end, give a clear list of what must be verified on the hardware.

## 1. Goal

A custom, ad-free "Chromecast replacement" running on the user's **Raspberry Pi 3 Model B v1.2** (1 GB RAM, connected over **Wi-Fi**, HDMI to a **DYON Smart 40 Pro**, which is a 1080p TV). It should:

- show up as a cast target in the **YouTube app** (iPhone) and play without ads;
- play **Twitch** and other links sent from an **iPhone web app** (served by the Pi) or via an iOS Shortcut in the share sheet;
- look like a polished product: animated boot splash, no Linux text visible, a clean home/idle screen, pop-ups, a pause screen, and a settings panel;
- respond to the **TV remote via HDMI-CEC**. The user's Chromecast already gets play/pause from this TV, so CEC is supported at least for that.

Not in scope: a standalone browsing/search TV menu (the user dropped it), and DRM services like Netflix (impossible on this hardware).

## 2. Key technical facts (already verified)

- **Pi 3 decode limits:** hardware H.264 up to 1080p30 is smooth, 1080p60 is borderline, and VP9/AV1 can't be hardware-decoded. A browser on the Pi is far too heavy, so **no browser on the Pi**.
- **YouTube:** mpv + yt-dlp, forcing H.264 (avc1) at 1080p30 or lower. Ads never play because yt-dlp fetches the streams directly. Add SponsorBlock via an mpv Lua script.
- **yt-dlp needs a JS runtime for YouTube** (EJS). **Node.js ≥ 22** is supported. Install `yt-dlp[default]` (which includes `yt-dlp-ejs`) and pass `--js-runtimes node` (in mpv: `ytdl-raw-options-append=js-runtimes=node`). This is why the Pi must run **Raspberry Pi OS Lite 64-bit**: NodeSource only ships Node 22 for arm64, not armhf.
- **Cast receiver:** npm `yt-cast-receiver` **2.1.0**. It's ESM-only, needs Node ≥ 18, and its API was confirmed from the package typings:
  - `new YouTubeCastReceiver(player, { device: { name, screenName, brand, model }, dial: { port }, logLevel })`, then `start()` and `stop()`; events `senderConnect(sender)` (`sender.name`), `senderDisconnect`, `error` and `terminate`.
  - `class X extends Player` must implement `doPlay(video, position)` (`video.id`), `doPause`, `doResume`, `doStop`, `doSeek(pos)`, `doSetVolume({level, muted})`, `doGetVolume`, `doGetPosition` and `doGetDuration`. All return promises; the action methods resolve to booleans.
  - Public control methods (`play`, `pause`, `resume`, `stop`, `seek`, `next`, `previous`, `setVolume`) call the `do*` methods and keep senders in sync. Call these from your own UI.
  - The receiver does **not** detect end of playback. When a video ends: `await player.pause(); await player.next()`. If `next()` returns false, call `stop()`.
  - `notifyExternalStateChange(Constants.PLAYER_STATUSES.X)`; the statuses are IDLE -1, PLAYING 1, PAUSED 2, LOADING 3, STOPPED 4.
  - `receiver.getPairingCodeRequestService()` provides `start()`, `stop()`, and the events `response(code)` and `error`. This is "Link with TV code".
  - Its default DataStore (node-persist) writes `.node-persist/` in the current working directory.
- **Twitch** can't be cast directly from the Twitch app. Google Cast requires Google-certified receivers, which a custom device can't be. Use **streamlink** with `--twitch-disable-ads` (it filters out the ad segments Twitch inserts into the stream) and `--player-external-http` (it serves the stream over local HTTP for mpv to play). Default quality is `720p60,720p,480p,best`; 1080p60 is too much for the Pi.
- **iPhone web app:** it can't live on GitHub Pages. That's an HTTPS page, and Safari blocks HTTPS pages from calling the Pi's plain-HTTP address. So the **Pi serves it**: the user opens `http://picast.local:8080` in Safari and taps Share → Add to Home Screen. iOS web apps can't be share targets, so sharing goes through an **iOS Shortcut** called "Send to Pi-Cast": accepts URLs from the share sheet, then "Get contents of URL" with a POST to `/api/play` and the JSON body `{url}`.
- **Wi-Fi:** turn off Wi-Fi power saving (NetworkManager `wifi.powersave = 2`) to avoid stutter and cast-discovery dropouts.

## 3. What exists already (written, never run)

```
package.json            ESM, deps: express ^4.21.2, yt-cast-receiver ^2.1.0, engines node >=22
src/config.js           defaults + optional config.json (PICAST_CONFIG); venv tool paths
src/log.js              tiny leveled logger
src/mpv.js              spawns one idle mpv (--idle --force-window --input-ipc-server),
                        JSON IPC client, observes pause/time-pos/duration/volume/mute/
                        idle-active/media-title, emits property/end-file/start-file/
                        file-loaded/ready, auto-restarts mpv, osd-overlay helpers.
                        load() sets the global 'start' property instead of loadfile options
                        (the loadfile argument order differs between mpv 0.35 and 0.38+).
src/streamlink.js       spawns streamlink, waits for its "127.0.0.1:<port>" line, returns local URL
src/sources.js          classify(url) -> twitch | youtube | generic; extractUrl(text)
src/playback.js         single owner of the screen (owner: 'cast' | 'web' | null);
                        'takeover' and 'ended' events; ignores end-file while switching items
src/castPlayer.js       Player subclass -> Playback; handles queue advance on end
src/web.js              express: /api/status, /api/play, /share, pause/resume/stop/seek/volume
                        (routes through castPlayer while owner==='cast')
src/index.js            wires everything, pairing code, simple text idle overlay, shutdown
docs/design/design-draft.dc.html   source of the approved design (see §4)
```

**Missing:** `deploy/` (mpv.conf, install.sh, systemd units, boot/Plymouth), `public/` (web app), settings, CEC, the real TV visuals, README, and `npm install` (no `node_modules` yet).

Review the existing code before building on it. It hasn't been executed. Things to double-check:
- streamlink's `--player-external-http-interface` flag (needs a recent streamlink; pip installs the latest);
- the mpv `osd-overlay` named-argument command;
- the Playback switching logic when replacing a Twitch stream.

## 4. Approved design

Live draft: https://claude.ai/artifact/V1wqvWCT3k9i24m5k9oQPL (private to the user). The source is copied at `docs/design/design-draft.dc.html`. Read its `<script>` for the exact values.

**Chosen: style Aurora · accent Violet · logo Wordmark · font Sora.**

- **Aurora tokens:**
  - background `#0C0B14`, text `#F5F3FF`, muted `#A9A6C4`
  - surfaces `rgba(255,255,255,0.07)`, lines `rgba(255,255,255,0.10)`, dim `rgba(255,255,255,0.16)`
  - glass pop-ups `rgba(16,14,30,0.72)`, icon background `#15132A`
  - radii 20 (cards), 12 (small), 999 (pills)
- **Aurora glow:** two large soft radial blobs in the accent color, one at the top-left (about 45% alpha) and one at the bottom-right (about 30% alpha), on the `#0C0B14` background.
- **Accent presets (10)** plus a **custom color**:
  - Violet `#A898FF` (default), Sky `#6FA8FF`, Cyan `#3DD6F5`, Mint `#4BE3B0`, Lime `#B6F25A`
  - Amber `#FFC247`, Coral `#FF7A59`, Red `#FF5D5D`, Rose `#FF7EB6`, Ice `#E6ECF2`
  - Text on accent backgrounds is `#0A0C10`.
- **Other styles stay selectable in settings:**
  - Midnight: background `#0A0C10`, text `#F2F4F7`, muted `#98A2B3`, radius 14, no glow.
  - Studio: background `#171614`, text `#EEEBE4`, muted `#A9A59B`, radius 4, no glow.
- **Wordmark:** `pi·cast` in lowercase, with the middle dot in the accent color, set in Sora 600. App icon: `pi·` on the icon background.
- **Fonts:** Sora for UI, JetBrains Mono for codes and times. **Self-host both** (OFL licence) for the web app and install them for mpv/libass via fontconfig, with `osd-font=Sora`. Don't depend on Google Fonts at runtime.
- **Original artwork only.** No YouTube, Twitch or Google Cast logos or icons.

**Screens to implement:**
1. **Boot splash:** wordmark centered, three dots below (middle one in accent), "STARTING UP" small at the bottom, and the **two glow blobs slowly drifting** on 14–18 s loops (moving pre-rendered sprites, no real lighting). The "Animated boot glow" setting freezes them.
2. **Home/idle:**
   - top-left: big clock (24h/12h setting) and date;
   - top-right: Wi-Fi status;
   - center: "Ready to cast" and "Open YouTube on your phone and tap Cast → Pi-Cast";
   - bottom bar: "TV CODE" (pairing code), "REMOTE picast.local:8080", and the small wordmark.
   - Background is the Aurora glow image (static by default; an optional setting can make it drift via a looping hardware-decoded H.264 clip).
3. **Now-playing pop-ups,** fading after about 5 s:
   - "<sender> connected" pill at the top-right, on senderConnect;
   - bottom-left card: thumbnail, "NOW PLAYING" in accent, title, and "YouTube · Ad-free · 1080p";
   - thin accent progress line at the bottom.
4. **Paused:** dimmed video, centered pause icon in an accent ring, and at the bottom the title, channel and source, an accent progress bar, and the elapsed and total times in mono.
5. **iPhone remote** (web app):
   - header with wordmark and a "● <TV name>" status pill;
   - now-playing card with thumbnail, state label, title and channel, progress, back 10 s / play-pause / forward 10 s, and volume;
   - "Play a link" field with a Play button;
   - Recent list.
6. **Home Screen icon:** generated as a PNG (apple-touch-icon, 180×180) in the current accent.
7. **Share sheet:** the "Send to Pi-Cast" Shortcut. Document how to create it in the README.
8. **TV settings panel:** a right-side glass panel over the dimmed home screen with these rows:
   - Accent color (swatch row, focused)
   - Style ‹ › (Aurora / Midnight / Studio)
   - Animated boot (on/off)
   - Skip sponsors (on/off)
   - Clock (24h/12h)
   - Switch TV input (on/off)
   - Footer: "◀ ▶ change · OK select · Back close"
   - Opened with OK on the home screen and navigated with the CEC arrow keys.
9. **iPhone settings:**
   - accent grid (5×2) and a custom color input;
   - Look: style segmented control and an "Animated boot glow" toggle;
   - General: device name, Twitch quality, skip sponsor segments, 24-hour clock;
   - TV remote (HDMI-CEC): "Control with TV remote" and "Switch TV input on cast".

## 5. Architecture additions to build

- **Settings store:** `data/settings.json`, loaded over the config defaults. API `GET /api/settings` and `PUT /api/settings`. Push live updates with **Server-Sent Events** at `/api/events` (status and settings), so the web app doesn't poll. Applying settings:
  - **accent/style:** regenerate the TV assets (glow background, icons, Plymouth images; see below) and redraw the overlays;
  - **device name:** restart the cast receiver;
  - **Twitch quality:** takes effect on the next stream;
  - **SponsorBlock:** mpv can't unload scripts, so restart mpv with or without the script, but only when idle (otherwise apply after playback ends);
  - **clock format:** affects the idle screen;
  - **CEC toggles:** see below.
- **TV renderer** (new module, e.g. `src/tv.js`). It owns everything drawn in mpv:
  - **Background images:** use mpv `overlay-add` with **raw BGRA** files. Generate the Aurora glow at 1920×1080 with ffmpeg (or a small Node rasteriser) whenever the accent or style changes, and cache it in `data/`.
  - **Text and shapes:** use `osd-overlay` with ASS markup (clock, labels, pop-ups, pause screen, settings panel). Set the overlay `res_x`/`res_y` to 1920×1080 so layout matches the design.
  - Keep redraws rare. The clock updates once a minute; the progress bar updates about once a second, and only while the pause screen is visible.
  - Show the now-playing card on `file-loaded`, using `media-title`. YouTube thumbnail: `https://i.ytimg.com/vi/<id>/hqdefault.jpg`, downloaded and converted to BGRA for `overlay-add` (optional; fall back to no thumbnail).
- **CEC** (new module `src/cec.js`). Raspberry Pi OS Bookworm with the KMS driver exposes `/dev/cec0`. Use `cec-ctl` from `v4l-utils`:
  - register as a playback device: `cec-ctl -d /dev/cec0 --playback --osd-name Pi-Cast`;
  - read keys with `cec-ctl -d /dev/cec0 --monitor` and parse the "USER_CONTROL_PRESSED" ui-cmd values (play, pause, select/OK, up/down/left/right, back/exit, stop);
  - **Key mapping:** play/pause goes to Playback, routed through castPlayer when it owns playback. On the home screen, OK opens the settings panel; arrows and Back navigate it.
  - **Switch TV input on cast:** when playback starts, send "image view on" followed by "active source". If `cec-ctl` is missing or the TV doesn't respond, log it and carry on.
  - Arrow-key passthrough on the DYON is **unverified**. Settings must always work from the iPhone.
- **Web app** in `public/`:
  - mobile-first, matching §4, plain HTML/CSS/JS (no build step);
  - meta tags for an iOS standalone web app (`apple-mobile-web-app-capable`, status-bar style `black-translucent`), `apple-touch-icon` served from the generated PNG, and a manifest;
  - iPhone safe areas (`env(safe-area-inset-*)`);
  - uses SSE for live state;
  - the Recent list is stored on the Pi (`data/recent.json`, last 20 items).
- **Boot customization** (applied by `install.sh`):
  - `/boot/firmware/config.txt`: `disable_splash=1`. Keep `dtoverlay=vc4-kms-v3d` and consider `cma-256` if 1080p decoding needs more memory.
  - `/boot/firmware/cmdline.txt`: append `quiet splash loglevel=3 logo.nologo vt.global_cursor_default=0 consoleblank=0 plymouth.ignore-serial-consoles` and move the console to `tty3`.
  - Disable `getty@tty1`. If the default target is graphical, set it to `multi-user.target` (tell the user).
  - **Plymouth script theme** `picast`: wordmark and dots images plus two glow sprite PNGs drifting slowly. Keep the sprites modest in size; Plymouth draws in software, so aim for slow movement rather than a high frame rate.
  - Regenerate the theme images when the accent changes (from a template, with ImageMagick or rsvg-convert), then run `plymouth-set-default-theme -R picast`. The `-R` rebuilds the initramfs, which takes about a minute on a Pi 3, so run it in the background. The change shows on the next boot.
  - Back up every system file before editing it, and make all edits idempotent.
- **mpv.conf** (`deploy/mpv.conf`, included via `--include`):
  - `vo=gpu`, `gpu-context=drm`, `fullscreen=yes`, `ao=alsa`, `keep-open=no`
  - `ytdl-format=bestvideo[vcodec^=avc1][height<=?1080][fps<=?30]+bestaudio[acodec^=mp4a]/best[vcodec^=avc1][height<=?1080]/best[height<=?720]`
  - `ytdl-raw-options-append=js-runtimes=node`
  - cache: `cache=yes`, `demuxer-max-bytes=50MiB`, `demuxer-max-back-bytes=20MiB` (the Pi has 1 GB RAM)
  - cheap scaling: `scale=bilinear`, `dscale=bilinear`, `cscale=bilinear`, `dither=no`, `deband=no`, `correct-downscaling=no`, `linear-downscaling=no`, `sigmoid-upscaling=no`, `hdr-compute-peak=no`
  - `osd-font=Sora`, and OSD colors from the theme
  - hwdec comes from config: default `v4l2m2m-copy`, try `drm` on the device. Don't rely on comma-separated hwdec lists, because Bookworm ships mpv 0.35.
- **SponsorBlock script:** the single-file `sponsorblock_minimal.lua` (codeberg.org/jouni/mpv_sponsorblock_minimal, needs curl), downloaded into `mpv-scripts/` by the installer as a best-effort step.

## 6. install.sh (in `deploy/`; run on the Pi as the normal user with sudo)

1. Check the system: it must be 64-bit (`aarch64`) and Raspberry Pi OS Bookworm or newer. Otherwise stop with a clear message.
2. Install packages: `apt install mpv ffmpeg python3-venv curl ca-certificates v4l-utils plymouth plymouth-themes imagemagick librsvg2-bin fontconfig git`.
3. Node 22: if `node` is missing or older than 22, install it from NodeSource 22.x.
4. Python venv `.venv` with `pip install -U "yt-dlp[default]" streamlink`. Then run `npm ci` (or `npm install --omit=dev`).
5. Install the fonts (Sora, JetBrains Mono) to `/usr/local/share/fonts/picast` and run `fc-cache`. Download the SponsorBlock script.
6. Add the user to the `video`, `render`, `audio` and `input` groups.
7. Create the systemd unit `picast.service`:
   - `User=<user>`, `WorkingDirectory=<repo>`, `ExecStart=/usr/bin/node src/index.js`
   - `Restart=always`, `SupplementaryGroups=video render audio`
   - start after `network-online.target`
8. Create `picast-update.timer`: a daily `pip install -U "yt-dlp[default]" streamlink`, because YouTube breaks old yt-dlp versions regularly.
9. Turn off Wi-Fi power saving with a NetworkManager conf.d drop-in.
10. Apply the boot customization (§5) and install the Plymouth theme.
11. Print the URL for the remote and the next steps.

## 7. README (for the user)

- **Flashing:** use Raspberry Pi Imager to write **Raspberry Pi OS Lite (64-bit)** to the 16 GB card. In the Imager settings, set hostname `picast`, the username and password, the Wi-Fi network and country, and enable SSH.
- **Installing:** SSH in, `git clone` (or copy) the repo, run `./deploy/install.sh`, and reboot.
- **iPhone:** add the web app to the Home Screen and create the "Send to Pi-Cast" Shortcut (step-by-step).
- **TV settings:** set the picture format to "Just Scan" / "1:1" so edges aren't cut off, and turn on CEC.
- **Troubleshooting:** check hardware decoding (watch `journalctl -u picast` and mpv stats), test CEC with `cec-ctl --monitor`, and update yt-dlp.

## 8. Build order

1. Review and fix the existing `src/`, then add `npm install` and a local smoke run of the web server with mpv mocked or absent.
2. `deploy/mpv.conf` and a basic `install.sh` with the systemd unit, so the core can be tested on the Pi early.
3. Settings store, SSE and the web app (`public/`).
4. TV renderer: home screen, pop-ups, pause screen and settings panel, with the generated glow assets.
5. CEC module.
6. Boot customization and the Plymouth theme.
7. README, then the hardware verification checklist for the user.

## 9. Must be verified on the real hardware (tell the user at the end)

- Smooth 1080p30 YouTube playback and CPU load with `hwdec=v4l2m2m-copy` versus `drm`.
- yt-dlp start-up time on the Pi 3: how long from tapping Cast to video showing.
- Whether streamlink starts Twitch reliably and the ad filtering works.
- CEC: play/pause, the arrow/OK/Back keys on the DYON, and switching the TV input.
- How smooth the Plymouth glow animation looks, and how long boot takes.
- Overlay legibility on the TV from the sofa.
