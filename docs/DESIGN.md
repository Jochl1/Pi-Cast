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

**Style Aurora, accent Violet by default, logo Wordmark, font Sora.**

### Style

Aurora is the only style; the draft's Midnight and Studio were dropped (the user wanted the colourful one).

- Background `#0C0B14`, text `#F5F3FF`, muted `#A9A6C4`.
- Surfaces `rgba(255,255,255,0.07)`, lines `rgba(255,255,255,0.10)`, dim `rgba(255,255,255,0.16)`, glass pop-ups `rgba(16,14,30,0.72)`, icon background `#15132A`.
- Radius 20 for cards, 12 small, 999 pills.

**Aurora glow:** large, soft radial lights in the accent colour. The boot splash draws two (top left about 45% alpha, bottom right about 30%).

**Home backdrop** (`src/tv/background.js`): the accent (more saturated) at the top left, a neighbouring hue (+55°) at the bottom right and a faint third light (−35°) at the top right, on a base that's slightly lighter at the top, with a vignette and a frosted glass card behind "Ready to cast". With "Animations" on, the lights drift slowly on a 30 s loop.

### Accents

There are 10 presets plus a custom colour: Violet `#A898FF` (default), Sky `#6FA8FF`, Cyan `#3DD6F5`, Mint `#4BE3B0`, Lime `#B6F25A`, Amber `#FFC247`, Coral `#FF7A59`, Red `#FF5D5D`, Rose `#FF7EB6`, Ice `#E6ECF2`. Text on accent backgrounds is `#0A0C10`.

### Brand

- **Wordmark:** `pi·cast` in lowercase, Sora 600, with the middle dot in the accent colour. App icon: `pi·` on the icon background, generated as a PNG in the current accent (`src/icons.js`).
- **Fonts:** Sora for the UI, JetBrains Mono for codes and times. Both are self-hosted (`assets/fonts/`, OFL) for the web app and installed through fontconfig for mpv/libass and rsvg-convert. Nothing loads from Google Fonts at runtime.
- **Original artwork only.** No YouTube, Twitch or Google Cast logos or icons.

### Screens

1. **Boot splash (Plymouth):** the wordmark centred, three dots below it (the middle one in the accent), "STARTING UP" at the bottom, and the two glows drifting slowly on 14–18 s loops. The "Animated boot" setting freezes them.
2. **Home:** the backdrop above, a large clock (24h/12h) and the date at the top left, Wi-Fi status at the top right, "Ready to cast" with a one-line hint in the centre, and a bottom bar with the TV code (pairing code), the remote address, a QR code for it ("Scan with your phone camera") and a small wordmark.
3. **Loading:** shown while a new item starts. "LOADING" in the accent, the title, and channel · source · "from <sender>" in the glass card in the middle, with three dots below it that pulse one after another (the middle one in the accent).
   - From home it sits on the backdrop's card. When casting over a playing video, the old video freezes, dimmed, under a glass card of the same size.
   - The same card says "BUFFERING" when a video stalls for more than a second.
4. **Now-playing pop-ups** that fade after about 5 s: a "<sender> connected" pill at the top right; a card at the bottom left with the thumbnail, "NOW PLAYING" in the accent, the title, and the source and quality; and a thin accent progress line.
5. **Paused:** dimmed video, a pause icon in an accent ring, and at the bottom the title, channel and source, an accent progress bar, and the elapsed and total times in mono.
6. **TV settings panel:** a glass panel on the right over the dimmed home screen. Rows: accent (a swatch row), language, animations, skip sponsors, clock, switch TV input. Footer: "◀ ▶ change · OK select · Back close". OK on the home screen opens it; the arrows and Back navigate it.
7. **Toasts** for short messages, such as "Couldn't play that link", or "● Trymacs" (with the key's colour) when a colour key starts a favourite.
8. **iPhone web app:** a header with the wordmark and a "● <TV name>" pill; a now-playing card (thumbnail, state, title and channel, progress, back 10 s / play-pause / forward 10 s, volume); a "Play a link" field; and a Recent list. Settings: the accent grid (5×2) and a custom colour; animations; device name, language, Twitch quality, SponsorBlock, 24-hour clock; colour-key favourites (name and link per colour); and the CEC toggles ("Control with TV remote", "Switch TV input on cast").

## 3. Architecture

Node 22 (ESM), with `express`, `yt-cast-receiver` and `qrcode` as the only dependencies and no build step. One mpv process draws everything on the TV.

### Modules (`src/`)

| Module | Role |
|---|---|
| `index.js` | Wires everything together and handles shutdown and settings side effects. |
| `config.js` | Defaults plus optional `config.json`; tool paths prefer the project `.venv`. |
| `mpv.js` | Spawns one idle mpv, JSON IPC client, property observers, auto-restart with backoff, overlay helpers, error-log forwarding. |
| `playback.js` | Single owner of the screen (see below). |
| `cast.js`, `castPlayer.js` | YouTube cast receiver and its `Player` subclass. |
| `receiverStore.js` | The receiver's data store (replaces node-persist). |
| `ytdl.js` | yt-dlp worker that stays running: YouTube link to direct stream URLs. |
| `streamlink.js` | Runs streamlink for Twitch and returns the local HTTP URL. |
| `sources.js`, `metadata.js` | Link classification; quick title/channel/thumbnail lookup (YouTube oEmbed, Twitch from the URL). |
| `controls.js` | Play/pause/seek/volume for the web app and the TV remote. |
| `shared/i18n.js` | Every TV and web app text in English and German; `translator(lang)` gives `tr(key, vars)` and the date locale. Served to the web app as `/shared/i18n.js`. |
| `settings.js`, `events.js`, `recent.js` | `data/settings.json` with a schema, the SSE hub, `data/recent.json` (last 20). |
| `web.js` | HTTP API and the web app. |
| `tv/` | TV renderer: `tv.js` (state, layers, timers), `screens.js` (pure layout to ASS), `ass.js` (ASS helpers), `thumbnail.js`. |
| `cec.js` | TV remote over `cec-client`. |
| `boot.js`, `render.js`, `icons.js` | Boot splash images, SVG to PNG via `rsvg-convert` (cached by content), app icons. |
| `tv/background.js` | Paints the home backdrop (PNG) and finds its loop clip. |
| `network.js` | Wi-Fi status via `nmcli`. |
| `sounds.js` | UI sounds and the startup sound, through `bin/sounds.py` (see below). |

### Playback ownership

`Playback` is the only thing that loads or stops media, so the cast receiver and the web app never fight over mpv. `owner` is `'cast'`, `'web'` or `null`. A new request from the other side emits `takeover`, and the cast session is told it lost the screen. While a new item replaces the old one (`switching`), the old item's `end-file` is ignored. `ended` reports `eof` or `error`.

`controls.js` routes through the cast player while `owner === 'cast'`, so the phone that's casting stays in sync.

**The backdrop is an mpv "file".** While nothing plays, `Playback` keeps the home backdrop loaded (`loop-file=inf`, `image-display-duration=inf`), so mpv is never really idle:
- It's put back after every stop, `ended`, failed play and mpv restart (`#toIdle`). Switching from one YouTube video to the next loads it too, so the loading screen sits on the backdrop instead of the old video.
- It's recognised by its playlist entry id. Its `start-file`/`file-loaded`/`playback-restart`/`end-file` events are ignored: they don't clear `switching` or `loading`, emit `ended`, or add to Recent (Recent listens to Playback's own `loaded`).
- mpv sends events after the reply that's awaiting them (`setImmediate` in `mpv.js`), so the id from `loadfile` is known before that file's `start-file` arrives.
- To the rest of the app it's idle: `status()` reports `idle` with no position, `Tv.screen()` is `'home'` without a source, and the controls ignore pause/seek without one. The SponsorBlock restart waits for "no source" instead of `idle-active`.
- If it fails to open, it's not retried; mpv's `background-color` stays as the fallback.

**While a new item loads, the picture holds still:** `play()` pauses whatever is showing (the old video or the backdrop clip), and the next `loadfile` unpauses. `status()` doesn't report that as paused. Going back to the backdrop resumes it.

### mpv

- Started once with `--idle --force-window` and an IPC socket, and kept running. `deploy/mpv.conf` is included with `--include`; hwdec and the audio device come from `config.json`.
- `load()` sets the global `start` (and `force-media-title`) properties instead of passing loadfile options, because the loadfile argument order changed between mpv 0.35 and 0.38. These options are global, so they're reset on every load.
- Pi-Cast subscribes to mpv's error log (`request_log_messages error`) and writes it to its own log, deduplicated and at most once a minute. "Can't open TTY" is ignored because it's harmless.
- SponsorBlock (`sponsorblock_minimal.lua`, downloaded by the installer) can't be unloaded, so toggling it restarts mpv, but only while idle.

### YouTube

- yt-dlp comes from `.venv` (`yt-dlp[default]`, which includes `yt-dlp-ejs`).
- Format (`ytdlFormat` in `config.js`, also passed to mpv): H.264 (avc1) at 1080p30 or lower, with AAC audio. VP9 and AV1 can't be hardware-decoded on a Pi 3.
- yt-dlp needs a JS runtime for YouTube's challenges: `js-runtimes=node`. Node ≥ 22 from NodeSource only exists for arm64, so the Pi must run the **64-bit** OS.
- **The yt-dlp worker** (`src/ytdl.js` and `bin/ytdl.py worker`) is a Python process that stays running and resolves YouTube links to direct stream URLs.
  - Playback stops the old video, asks the worker, and loads an `edl://` that joins the video and audio streams, with yt-dlp's HTTP headers.
  - The `Referer` header carries the `watch?v=` link, which is how the SponsorBlock script finds the video ID.
  - Results are cached for 20 minutes, so casting the same video again starts in about 1 s.
  - If the worker fails, mpv's own ytdl hook resolves the link instead. The hook also handles every non-YouTube site, through `bin/yt-dlp`.
- **Why it's fast now:** for every video, yt-dlp hands YouTube's ~4 MB player script to Node to solve the JS challenge. Parsing it took about 20 s on a throttled Pi 3, and starting Python and yt-dlp took about 6 s more.
  - `bin/ytdl.py` turns on yt-dlp's preprocessed-player cache, which yt-dlp keeps off by default because it never deletes old players. So `bin/ytdl.py` keeps only the newest two.
  - With the cache, solving takes 2–4 s. The worker saves the start-up.
  - Measured at 600 MHz: request to first frame went from about 31 s to about 7 s. The first video after YouTube ships a new player script still pays the full parse once.
  - Tried and rejected: clients that need no JS challenge (`android_vr`, `ios`). They need a PO token and only give 360p. Smaller player variants only saved a few seconds.
- A daily `picast-update.timer` upgrades yt-dlp and streamlink, because YouTube breaks old versions regularly.

### Cast receiver (`yt-cast-receiver` 2.x)

- The device name is fixed when the receiver is created, so renaming means stopping it and starting a new one.
- The receiver does **not** detect the end of a video. On `ended`, `castPlayer` calls `pause()` then `next()`, and `stop()` if there's nothing next.
- "Link with TV code" comes from `getPairingCodeRequestService()`. The code is shown on the home screen and in the web app.
- Its default node-persist store wrote before it had initialised and lost data, so `receiverStore.js` replaces it. Writes are serialised, because concurrent writes raced on the temp file.

### Twitch

streamlink with `--player-external-http` on `127.0.0.1`; Pi-Cast waits for its URL line and hands that URL to mpv. streamlink 6+ always filters Twitch's ad segments (the old `--twitch-disable-ads` flag is gone). The quality defaults to `720p60` and is a setting; 1080p60 is too much for the Pi.

### TV renderer

- Text and shapes are ASS `osd-overlay`s at 1920×1080, one per layer: home, loading (over video), dots, pop-up, pause, panel, toast, in that z order.
- The loading dots are the only animation: their own small layer, redrawn 4 times a second while the screen is loading or buffering, and nothing else is redrawn for them.
- The thumbnail is an `overlay-add` raw BGRA bitmap converted with ffmpeg.
- **The home backdrop** is shown by mpv on its video plane (see Playback ownership), so it costs no OSD texture.
  - The still version is painted in floating point by `background.js` in a worker thread (about 10 s on a throttled Pi, cached by content in `data/background/`) and dithered by about one level. Rounding the dark, soft gradients straight to 8 bits banded badly on the TV.
  - The animated version is a looping H.264 clip (1080p, 10 fps, 30 s, CRF 10 with `-tune grain`, about 48 MB). Painting 300 frames takes far too long on a Pi 3 and its hardware encoder bands, so `scripts/render-backdrops.js` renders one per accent preset **on a PC**; they're copied to the Pi's `data/backdrops/` (not in git). A custom accent, or a missing clip, falls back to the still image. Plays hardware-decoded at about 9% CPU.
  - mpv's `background-color` (the style's background on home and loading, black during playback) is the fallback while the image is painted.
- Redraws only happen when something visible changes: the clock once a minute, the progress once a second, and only while the pause screen or a card is showing. Nothing is drawn while mpv is disconnected, and failed overlay commands are logged.
- The QR code for the web remote (`http://<hostname>.local:<port>`) is one ASS shape: each row's runs of dark modules are one rectangle, on whole pixels, on a light rounded tile. It can't be part of the backdrop, because the loop clips are rendered on a PC.
- Dimming (pause screen, settings panel) is an ASS rectangle, because mpv's video equalizer doesn't apply in overlay mode (§4.1).
- `scripts/tv-scenes.js` holds the sample screens. `scripts/preview-tv.js` renders them to PNG with any libass ffmpeg; `scripts/check-osd.js` draws them in a real mpv on the Pi and fails on OSD errors.

### CEC

- It uses libcec's `cec-client` (package `cec-utils`), not `cec-ctl --monitor`. `cec-client` registers as a playback device and answers the TV's power and menu queries, which many TVs need before they forward remote keys.
- Keys are parsed from its traffic log (`>> 04:44:xx`, USER_CONTROL_PRESSED), and held-key repeats are suppressed for toggles.
- "Switch TV input on cast" sends image-view-on and active-source when playback starts. If the TV doesn't respond, Pi-Cast logs it and carries on.
- Arrow-key passthrough varies by TV, so every TV setting is also in the web app.
- **Standby with the TV** ("Sleep when the TV is off", `cecStandby`): the DYON sends no STANDBY (`0x36`) when it turns off, so Pi-Cast sends `pow 0` every 10 s (3 s while the TV is off). It reads both the TV's real REPORT_POWER_STATUS (`>> 04:90:xx`) and cec-client's `power status:` answer.
  - That answer usually comes from libcec's cache, which only asks the TV about every 30 s, so noticing "off" takes up to ~30 s. The cache flips to on as soon as the TV reappears on the bus (`0f:84`, `0f:86`), so waking is seen within the 3 s poll. Reading only the real replies made waking take ~20 s.
  - TV off: playback stops and the home backdrop stays loaded but paused (`Playback.setStandby`), so the picture is there the instant the TV is back. TV on: the backdrop moves again and the startup sound plays, unless the TV was woken by a cast.
  - The HDMI connector stays `connected` while the TV is off, so hotplug can't be used.
  - The Pi can't power itself off and on (a Pi 3 only boots again on power), so this is the closest to "off with the TV".
- **Colour keys** (F1–F4: `0x71` blue, `0x72` red, `0x73` green, `0x74` yellow on the DYON) play the favourite in the `shortcuts` setting, on any screen, through `Playback.play` with owner `'web'` (so a cast session gets the usual takeover). An empty key shows a toast.
- **Number keys aren't forwarded by the DYON TV**, tested both as a playback device (`-t p`) and as a recorder (`-t r`) with Pi-Cast as the active source. Only OK came through. That's why favourites are on the colour keys and not on digit codes.
- **CH+/CH− aren't forwarded either** (CEC `0x30`/`0x31`), tested as a playback device (`-t p`) and as a tuner (`-t t`). Only OK came through.

### Web app

- Served by the Pi at `http://picast.local:8080`. It can't live on GitHub Pages: Safari blocks an HTTPS page from calling the Pi's plain-HTTP address.
- Plain HTML/CSS/JS in `public/`, mobile-first, with iOS standalone meta tags, safe-area insets, a manifest and generated icons.
- Live state comes over SSE (`/api/events`), with no polling.
- iOS web apps can't be share targets, which is why the Shortcut exists. It POSTs `{url}` to `/api/play`.

### Sounds

- Seven UI sounds (move, select, open, close, notify, like, error) are synthesized by `scripts/render-sounds.js` into `assets/sounds/*.wav` (48 kHz, 16-bit stereo). The same script converts `assets/sounds/startup.mp3` to `startup.wav` and trims its trailing silence. The startup sound is not in git: its licence wasn't checked for redistribution.
- `bin/sounds.py` plays them through libasound (ctypes, standard library only), on mpv's ALSA device behind `plug:`. While it holds the device it writes silence between sounds (10 ms writes, 60 ms latency), so the TV keeps its audio input awake and short sounds aren't swallowed.
- The device takes one program at a time (§4.5), so the helper holds it only while nothing plays and mpv's `current-ao` is unset. `mpv.load()` awaits `beforeLoad` for anything but the backdrop: the helper lets go first, after letting a sound that's still playing finish (at most 1 s). After a stop, mpv closes its audio output once the backdrop (which has no audio) shows, and the helper takes the device back.
- So there are no UI sounds during a video or over a paused one.
- Triggers: the settings panel (open, move, select, close) and toasts (notify; error for "Couldn't play" and unset colour keys). The startup sound plays the first time the helper gets the device if the app started within 5 minutes of boot, and when the TV comes back on (see CEC). It's dropped once something plays.

### Settings side effects

| Setting | Effect |
|---|---|
| Accent | Redraw the overlays, switch the home backdrop, regenerate the icons and the boot splash. |
| Animations | Boot splash glows on/off; home backdrop clip or still image. |
| Device name | Restart the cast receiver and CEC. |
| Twitch quality | Takes effect on the next stream. |
| SponsorBlock | Restart mpv when idle. |
| Clock | Redraw the home screen. |
| Sounds | UI sounds and the startup sound on/off (checked when a sound would play). |
| Language | Redraw the overlays, re-label the web app, regenerate the boot splash ("STARTING UP" / "WIRD GESTARTET"). |
| CEC toggles | Start or stop CEC; switch the input on cast; standby with the TV (turning it off wakes up). |

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
- So: no full-screen shapes and no big blurred glows in the overlays. The home backdrop is a picture on the video plane instead (§3, TV renderer).
- Test the worst case (home plus settings panel plus toast) with `scripts/check-osd.js` after any layout change.
- `overlay-add` bitmaps (thumbnails) use a separate texture, but mpv always draws them **above** every ASS overlay. That's why the glow isn't a bitmap background behind the text.
- mpv removes a client's `osd-overlay`s when that IPC client disconnects. Test scripts must keep the socket open while someone looks at the TV.
- Tried without success: the glows as a single ASS event on the normal OSD-text texture (`osd-msg1` with `${osd-ass-cc/0}`). It fit, but nothing showed. The cause is unknown (possibly idle, `osd-level` or the markup).

### 4.3 Home backdrop

- A PNG loaded into mpv (`image-display-duration=inf`) is drawn through GL onto the draw plane, under the OSD overlays. A hardware-decoded H.264 clip goes on the video plane. Both work with the overlays on top and no flicker.
- Dark, soft 8-bit gradients band visibly on this TV. A dither of about one level fixes it. Film grain via an SVG `feTurbulence` filter was far too strong, because rsvg runs filters in linear RGB.
- The dither has to survive encoding: CRF 16 x264 banded again, CRF 10 with `-tune grain` doesn't. Half resolution (540p, scaled up by the display) looked blotchy.
- The Pi 3's hardware encoder (`h264_v4l2m2m`) ignored the bitrate and came out blocky. x264 manages about 3 fps at 1080p on a throttled Pi, and painting a frame in JS took about 0.7 s even after optimising, so the clips are rendered on a PC.

- **Looping flashed the whole screen black:** `loop-file` seeks back to 0, and mpv restarts the v4l2m2m decoder on every seek (`Decoder format` in the verbose log), even from the demuxer cache. The clip is loaded as an EDL of 120 copies instead (`seamless()` in `playback.js`): mpv switches timeline segments without touching the decoder, so only the hourly wrap-around restarts it. More `hwdec-extra-frames` (16) didn't help, and CMA is tight anyway (~32 MB free of 256 MB with the backdrop playing).
- **The settings panel over the moving clip flashed black** on opening and on the first few row changes. So while the panel is open the clip crawls at 1% speed (`Playback.holdBackground('panel')`), and it speeds up again 400 ms after the panel is gone. Pausing instead flashed the same way on resume. Pause/resume or a speed change on their own don't flash; only the first one after the overlays changed does. That one flash on closing the panel is still there. `hvs_underrun` in debugfs stays 0, so it's not an HVS underrun. The cause is unknown.
- Redrawing overlays over **moving** video is expensive on the Pi 3: a full-screen dim over playing video cost mpv about 15–20% more CPU, and the dots another 15–20%, which slowed yt-dlp's resolving. Over a paused frame it's cheap. While the backdrop clip played, the dots' redraws also made the screen **flicker black** every few frames. Pausing whatever is on screen during loading fixed both.

### 4.4 Power

The Pi 3 throttles from 1200 to 600 MHz on undervoltage (`vcgencmd get_throttled` reports `0x50005`). That roughly halves everything CPU-bound, yt-dlp especially, and writing to the SD card on low voltage corrupts it. Use the official 5.1 V / 2.5 A supply.

### 4.5 Audio

- HDMI audio is card `vc4hdmi`, with a single subdevice. The `hdmi:` device is an `iec958` plugin over `hw`, so `dmix` can't sit under it (it would mix IEC958 subframes). A second program gets `EBUSY` while mpv has it open.
- mpv closes its audio output when the next file has no audio (the backdrop), and keeps it open while a video is paused.
- The sounds helper takes about 0% CPU while it writes silence.

## 5. Open work

- **Faster YouTube start.** What's left of the ~7 s is mostly network (~1.5 s) and Node solving the challenge (2–4 s).
  - Options: a Node solver that stays running instead of one Node per video; resolving the next queued video ahead of time.
  - A proper power supply is likely the biggest single win.
- **TV black with a signal** happened once, and power-cycling the TV fixed it. If it comes back, test whether CEC is involved by turning it off in the web app.

### Ideas for later (from the user, not designed yet)

- **Instagram on the TV:** Reels/feed scrolled with the remote's arrow keys, a like button (OK), and login by scanning a QR code on the TV with the phone.
- **Party games with the phone as controller:** Pong, Connect 4, tic-tac-toe and other simple games. The TV shows the game; phones join through the web app (QR code) and send input over the same HTTP/SSE channel.
- **Spotify:** pi-cast as a Spotify Connect speaker (librespot, e.g. via raspotify; needs Premium), with the cover, title and progress on the TV. librespot needs the HDMI audio device, which mpv and the sounds helper also want (§4.5). It could hand its audio to mpv through a pipe, or take the device the way the sounds helper does.
- **Colour key legend:** show what the four colour keys do, e.g. a small row of coloured dots with the favourites' names on the home screen (and in the settings panel). For Twitch favourites it could show who's live right now.
- **Profiles:** a "Who's watching?" picker at startup, like Netflix, chosen with the arrow keys. Each profile has its own colour keys, accent, Recent list, language and, later, Instagram account.
- **Weather forecast on the home screen:** today's and the next days' weather next to the clock, from Open-Meteo (free, no key). The location could come from the web app's settings.
- **AirPlay screen mirroring** from the iPhone, with UxPlay (open-source AirPlay server; GStreamer, hardware H.264 through v4l2). It's an experiment on a Pi 3:
  - **The display:** UxPlay draws through its own GStreamer sink and needs the display, which mpv holds. So mpv would have to step aside while mirroring (be stopped and started again afterwards, with a black flash), or UxPlay's H.264 would have to be fed to mpv.
  - **Audio:** it needs the HDMI audio device too (§4.5).
  - **Limits:** about 0.5 s of delay (fine for photos and web pages, not for games), and Netflix and other DRM apps show black.
  - Test UxPlay on its own first, at the throttled 600 MHz.
