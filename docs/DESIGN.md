# Pi-Cast design

What Pi-Cast is, how it looks, how it's built, and the hardware limits behind the decisions. The README covers setup and use; this doc is for working on the code.

## 1. What it is

An ad-free "Chromecast replacement" for a **Raspberry Pi 3 Model B** (1 GB RAM, Wi-Fi, HDMI to a 1080p TV). It:

- shows up as a cast target in the **YouTube app** and plays without ads (yt-dlp fetches the streams directly), skipping sponsor segments with SponsorBlock;
- plays **Twitch** and other links sent from the **iPhone web app** the Pi serves, or from the "Send to Pi-Cast" iOS Shortcut in the share sheet;
- looks like a finished product: an animated boot splash, no Linux text on screen, a home screen, now-playing pop-ups, a pause screen and a settings panel;
- is controlled with the **TV remote over HDMI-CEC**.

Out of scope:
- **DRM services** (Netflix and so on): impossible on this hardware.
- **Casting from the Twitch app:** Google Cast only talks to Google-certified receivers. Twitch links go through the web app or the Shortcut instead.
- **A browsing or search menu on the TV:** dropped. A browser on the Pi is far too heavy anyway.

## 2. Design

The approved mock-ups are in `docs/design/design-draft.dc.html`; its `<script>` has the exact values. The tokens live in `src/shared/theme.js`, which the server and the web app both use.

**Default: style Aurora, accent Violet, logo Wordmark, font Sora.**

### Styles

| | Aurora (default) | Midnight | Studio |
|---|---|---|---|
| Background | `#0C0B14` | `#0A0C10` | `#171614` |
| Text | `#F5F3FF` | `#F2F4F7` | `#EEEBE4` |
| Muted | `#A9A6C4` | `#98A2B3` | `#A9A59B` |
| Radius | 20 cards, 12 small, 999 pills | 14 | 4 |
| Glow | yes | no | no |

Aurora also has surfaces `rgba(255,255,255,0.07)`, lines `rgba(255,255,255,0.10)`, dim `rgba(255,255,255,0.16)`, glass pop-ups `rgba(16,14,30,0.72)` and an icon background of `#15132A`.

**Aurora glow:** two large, soft radial blobs in the accent colour, one at the top left (about 45% alpha) and one at the bottom right (about 30%). The boot splash draws them. The TV home screen can't at the moment (see §4.2).

### Accents

There are 10 presets plus a custom colour: Violet `#A898FF` (default), Sky `#6FA8FF`, Cyan `#3DD6F5`, Mint `#4BE3B0`, Lime `#B6F25A`, Amber `#FFC247`, Coral `#FF7A59`, Red `#FF5D5D`, Rose `#FF7EB6`, Ice `#E6ECF2`. Text on accent backgrounds is `#0A0C10`.

### Brand

- **Wordmark:** `pi·cast` in lowercase, Sora 600, with the middle dot in the accent colour. App icon: `pi·` on the icon background, generated as a PNG in the current accent (`src/icons.js`).
- **Fonts:** Sora for the UI, JetBrains Mono for codes and times. Both are self-hosted (`assets/fonts/`, OFL) for the web app and installed through fontconfig for mpv/libass and rsvg-convert. Nothing loads from Google Fonts at runtime.
- **Original artwork only.** No YouTube, Twitch or Google Cast logos or icons.

### Screens

1. **Boot splash (Plymouth):** the wordmark centred, three dots below it (the middle one in the accent), "STARTING UP" at the bottom, and the two glows drifting slowly on 14–18 s loops. The "Animated boot" setting freezes them.
2. **Home:** a large clock (24h/12h) and the date at the top left, Wi-Fi status at the top right, "Ready to cast" with a one-line hint in the centre, and a bottom bar with the TV code (pairing code), the remote address and a small wordmark.
3. **Loading:** shown while a new item starts, with the title and the sender when they're known.
4. **Now-playing pop-ups** that fade after about 5 s: a "<sender> connected" pill at the top right; a card at the bottom left with the thumbnail, "NOW PLAYING" in the accent, the title, and the source and quality; and a thin accent progress line.
5. **Paused:** dimmed video, a pause icon in an accent ring, and at the bottom the title, channel and source, an accent progress bar, and the elapsed and total times in mono.
6. **TV settings panel:** a glass panel on the right over the dimmed home screen. Rows: accent (a swatch row), style, animated boot, skip sponsors, clock, switch TV input. Footer: "◀ ▶ change · OK select · Back close". OK on the home screen opens it; the arrows and Back navigate it.
7. **Toasts** for short messages, such as "Couldn't play that link".
8. **iPhone web app:** a header with the wordmark and a "● <TV name>" pill; a now-playing card (thumbnail, state, title and channel, progress, back 10 s / play-pause / forward 10 s, volume); a "Play a link" field; and a Recent list. Settings: the accent grid (5×2) and a custom colour; style and animated boot; device name, Twitch quality, SponsorBlock, 24-hour clock; and the CEC toggles ("Control with TV remote", "Switch TV input on cast").

## 3. Architecture

Node 22 (ESM), with `express` and `yt-cast-receiver` as the only dependencies and no build step. One mpv process draws everything on the TV.

### Modules (`src/`)

| Module | Role |
|---|---|
| `index.js` | Wires everything together and handles shutdown and settings side effects. |
| `config.js` | Defaults plus optional `config.json`; tool paths prefer the project `.venv`. |
| `mpv.js` | Spawns one idle mpv, JSON IPC client, property observers, auto-restart with backoff, overlay helpers, error-log forwarding. |
| `playback.js` | Single owner of the screen (see below). |
| `cast.js`, `castPlayer.js` | YouTube cast receiver and its `Player` subclass. |
| `receiverStore.js` | The receiver's data store (replaces node-persist). |
| `streamlink.js` | Runs streamlink for Twitch and returns the local HTTP URL. |
| `sources.js`, `metadata.js` | Link classification; quick title/channel/thumbnail lookup (YouTube oEmbed, Twitch from the URL). |
| `controls.js` | Play/pause/seek/volume for the web app and the TV remote. |
| `settings.js`, `events.js`, `recent.js` | `data/settings.json` with a schema, the SSE hub, `data/recent.json` (last 20). |
| `web.js` | HTTP API and the web app. |
| `tv/` | TV renderer: `tv.js` (state, layers, timers), `screens.js` (pure layout to ASS), `ass.js` (ASS helpers), `thumbnail.js`. |
| `cec.js` | TV remote over `cec-client`. |
| `boot.js`, `render.js`, `icons.js` | Boot splash images, SVG to PNG via `rsvg-convert` (cached by content), app icons. |
| `network.js` | Wi-Fi status via `nmcli`. |

### Playback ownership

`Playback` is the only thing that loads or stops media, so the cast receiver and the web app never fight over mpv. `owner` is `'cast'`, `'web'` or `null`. A new request from the other side emits `takeover`, and the cast session is told it lost the screen. While a new item replaces the old one (`switching`), the old item's `end-file` is ignored. `ended` reports `eof` or `error`.

`controls.js` routes through the cast player while `owner === 'cast'`, so the phone that's casting stays in sync.

### mpv

- Started once with `--idle --force-window` and an IPC socket, and kept running. `deploy/mpv.conf` is included with `--include`; hwdec and the audio device come from `config.json`.
- `load()` sets the global `start` (and `force-media-title`) properties instead of passing loadfile options, because the loadfile argument order changed between mpv 0.35 and 0.38. These options are global, so they're reset on every load.
- Pi-Cast subscribes to mpv's error log (`request_log_messages error`) and writes it to its own log, deduplicated and at most once a minute. "Can't open TTY" is ignored because it's harmless.
- SponsorBlock (`sponsorblock_minimal.lua`, downloaded by the installer) can't be unloaded, so toggling it restarts mpv, but only while idle.

### YouTube

- mpv's ytdl hook with yt-dlp from `.venv` (`yt-dlp[default]`, which includes `yt-dlp-ejs`).
- Format: H.264 (avc1) at 1080p30 or lower, with AAC audio. VP9 and AV1 can't be hardware-decoded on a Pi 3.
- yt-dlp needs a JS runtime for YouTube's challenges: `ytdl-raw-options-append=js-runtimes=node`. Node ≥ 22 from NodeSource only exists for arm64, so the Pi must run the **64-bit** OS.
- A daily `picast-update.timer` upgrades yt-dlp and streamlink, because YouTube breaks old versions regularly.

### Cast receiver (`yt-cast-receiver` 2.x)

- The device name is fixed when the receiver is created, so renaming means stopping it and starting a new one.
- The receiver does **not** detect the end of a video. On `ended`, `castPlayer` calls `pause()` then `next()`, and `stop()` if there's nothing next.
- "Link with TV code" comes from `getPairingCodeRequestService()`. The code is shown on the home screen and in the web app.
- Its default node-persist store wrote before it had initialised and lost data, so `receiverStore.js` replaces it. Writes are serialised, because concurrent writes raced on the temp file.

### Twitch

streamlink with `--player-external-http` on `127.0.0.1`; Pi-Cast waits for its URL line and hands that URL to mpv. streamlink 6+ always filters Twitch's ad segments (the old `--twitch-disable-ads` flag is gone). The quality defaults to `720p60` and is a setting; 1080p60 is too much for the Pi.

### TV renderer

- Text and shapes are ASS `osd-overlay`s at 1920×1080, one per layer: home, pop-up, pause, panel, toast, in that z order.
- The thumbnail is an `overlay-add` raw BGRA bitmap converted with ffmpeg.
- The home and loading screen colour is mpv's `background-color`, not a shape (see §4.2). It's black during playback.
- Redraws only happen when something visible changes: the clock once a minute, the progress once a second, and only while the pause screen or a card is showing. Nothing is drawn while mpv is disconnected, and failed overlay commands are logged.
- Dimming (pause screen, settings panel) is an ASS rectangle, because mpv's video equalizer doesn't apply in overlay mode (§4.1).
- `scripts/tv-scenes.js` holds the sample screens. `scripts/preview-tv.js` renders them to PNG with any libass ffmpeg; `scripts/check-osd.js` draws them in a real mpv on the Pi and fails on OSD errors.

### CEC

- It uses libcec's `cec-client` (package `cec-utils`), not `cec-ctl --monitor`. `cec-client` registers as a playback device and answers the TV's power and menu queries, which many TVs need before they forward remote keys.
- Keys are parsed from its traffic log (`>> 04:44:xx`, USER_CONTROL_PRESSED), and held-key repeats are suppressed for toggles.
- "Switch TV input on cast" sends image-view-on and active-source when playback starts. If the TV doesn't respond, Pi-Cast logs it and carries on.
- Arrow-key passthrough varies by TV, so every TV setting is also in the web app.

### Web app

- Served by the Pi at `http://picast.local:8080`. It can't live on GitHub Pages: Safari blocks an HTTPS page from calling the Pi's plain-HTTP address.
- Plain HTML/CSS/JS in `public/`, mobile-first, with iOS standalone meta tags, safe-area insets, a manifest and generated icons.
- Live state comes over SSE (`/api/events`), with no polling.
- iOS web apps can't be share targets, which is why the Shortcut exists. It POSTs `{url}` to `/api/play`.

### Settings side effects

| Setting | Effect |
|---|---|
| Accent, style | Redraw the overlays, regenerate the icons and the boot splash. |
| Device name | Restart the cast receiver and CEC. |
| Twitch quality | Takes effect on the next stream. |
| SponsorBlock | Restart mpv when idle. |
| Clock | Redraw the home screen. |
| CEC toggles | Start or stop CEC; switch the input on cast. |

### Boot and install

- `deploy/install.sh` is idempotent and backs up every system file to `/var/backups/picast/` before changing it. It refuses to run on undervoltage and checks the boot files on the SD card against the packaged copies.
- **Boot:** `disable_splash=1`, a quiet `cmdline.txt` with the console moved to tty3, no getty on tty1, and the Plymouth script theme `picast`.
- `src/boot.js` renders the splash images (wordmark, dots, glow sprites) from the current theme.
- `/usr/local/sbin/picast-plymouth-update`, allowed through a single sudoers rule, copies them into the theme and rebuilds the initramfs. That takes about a minute on a Pi 3 and runs in the background; the new splash shows from the next boot.
- Plymouth draws in software, so the glows move slowly and the sprites stay small.
- **Wi-Fi power saving is off** (`wifi.powersave = 2`), which avoids stutter and cast-discovery dropouts.

## 4. Hardware facts and limits

Measured on a Pi 3 with Raspberry Pi OS Lite 64-bit (Trixie, mpv 0.40, Mesa 26). Don't re-investigate these.

### 4.1 Video decoding

- **Zero-copy is required for 1080p.** `v4l2m2m-copy` copies every frame back from the decoder and uploads it again: about 7 fps at 1080p H.264, with mpv at 91% CPU.
- Debian's mpv has no GL import for the decoder's SAND frames, so `--hwdec=v4l2m2m` always uses `drmprime-overlay`.
- With the default planes, the vc4 driver rejects every commit (`Failed to commit atomic request: Error number 22`) and the video stays black.
- With the planes **swapped**, it works: video on the primary plane, mpv's drawing on the overlay plane (`drm-draw-plane=overlay`, `drm-drmprime-video-plane=primary`). That gives 24 fps with no drops and mpv at about 19% CPU, and the overlays still draw above the video.
- `mpvHwdec` defaults to `v4l2m2m,v4l2m2m-copy`, so the copy path is the fallback.
- `--hwdec=drm` doesn't work on the Pi 3. It falls back to software decoding at about 350% CPU.
- In overlay mode, mpv's video equalizer (`brightness`, `contrast`) and GL filters don't apply to the video. Dimming has to be an overlay.
- 1080p30 H.264 is the cap; 1080p60 is too much.

### 4.2 OSD texture limit

- The Pi 3 GPU caps textures at **2048×2048**. mpv packs **all** `osd-overlay` ASS bitmaps into one texture. If they don't fit, mpv draws **none** of them and only logs `OSD bitmaps do not fit on a surface with the maximum supported size 2048x2048`.
- **The overflow is sticky.** Once one screen overflows, every later screen fails too, even ones that fit on their own, until mpv restarts. An Aurora home screen with a full-screen rectangle and blurred glows caused exactly this, so no overlay showed at all.
- **Blur is expensive:** libass pads blurred bitmaps heavily. Even one blurred ring per glow didn't fit home plus the settings panel.
- **A shape with `\bord` makes two full-size bitmaps** (fill and border).
- So: no full-screen shapes and no big blurred glows. The home background is mpv's `background-color`.
- Test the worst case (home plus settings panel plus toast) with `scripts/check-osd.js` after any layout change.
- `overlay-add` bitmaps (thumbnails) use a separate texture, but mpv always draws them **above** every ASS overlay. That's why the glow isn't a bitmap background behind the text.
- mpv removes a client's `osd-overlay`s when that IPC client disconnects. Test scripts must keep the socket open while someone looks at the TV.
- Tried without success: the glows as a single ASS event on the normal OSD-text texture (`osd-msg1` with `${osd-ass-cc/0}`). It fit, but nothing showed. The cause is unknown (possibly idle, `osd-level` or the markup).

### 4.3 Power

The Pi 3 throttles from 1200 to 600 MHz on undervoltage (`vcgencmd get_throttled` reports `0x50005`). That roughly halves everything CPU-bound, yt-dlp especially, and writing to the SD card on low voltage corrupts it. Use the official 5.1 V / 2.5 A supply.

## 5. Open work

- **Slow start and a black screen while loading.** Casting takes 30–60 s before the video plays, and the TV is black the whole time.
  - Likely cause of the black screen: `Playback` clears `switching` on `start-file`, which fires before the ytdl hook has resolved the URL. `Tv.screen()` then reports `'playing'`.
  - The slowness isn't measured yet. Suspects: yt-dlp startup on a throttled CPU, the Node JS-challenge solver, a second yt-dlp call for the merged format, and the cache settings before the first frame.
- **Bland home screen.** Without the glows, Aurora is a plain dark colour. Options within §4.2:
  - a pre-rendered background image on the free video plane while idle;
  - finding out why the OSD-text texture route didn't show;
  - small budgeted accents.
- **TV black with a signal** happened once, and power-cycling the TV fixed it. If it comes back, test whether CEC is involved by turning it off in the web app.
