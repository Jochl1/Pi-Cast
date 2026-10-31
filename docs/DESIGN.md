# Pi-Cast design

What Pi-Cast is, how it looks, how it's built, and the hardware limits behind the decisions. The README covers setup and use; this doc is for working on the code.

## 1. What it is

An ad-free "Chromecast replacement" for a **Raspberry Pi 3 Model B** (1 GB RAM, Wi-Fi, HDMI to a 1080p TV). It:

- shows up as a cast target in the **YouTube app** and plays without ads (yt-dlp fetches the streams directly), skipping sponsor segments with SponsorBlock;
- plays **Twitch** and other links sent from the **iPhone web app** the Pi serves, or from the "Send to Pi-Cast" iOS Shortcut in the share sheet;
- shows **Instagram Reels**, scrolled with the remote's arrow keys;
- is an **AirPlay speaker** for music from the iPhone (Spotify, Apple Music, …), with the cover on the TV;
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

**Home backdrop** (`src/tv/background.js`): the accent (more saturated) at the top left, a neighbouring hue (+55°) at the bottom right and a faint third light (−35°) at the top right, on a base that's slightly lighter at the top, with a vignette. The glass card behind "Ready to cast" is an overlay (`screens.js`: a faint white fill and edge), so the home and AirPlay screens share one backdrop and switching between them doesn't load another clip (that took a moment and stuttered). With "Animations" on, the lights drift slowly on a 30 s loop.

### Accents

There are 10 presets plus a custom colour: Violet `#A898FF` (default), Sky `#6FA8FF`, Cyan `#3DD6F5`, Mint `#4BE3B0`, Lime `#B6F25A`, Amber `#FFC247`, Coral `#FF7A59`, Red `#FF5D5D`, Rose `#FF7EB6`, Ice `#E6ECF2`. Text on accent backgrounds is `#0A0C10`.

### Brand

- **Wordmark:** `pi·cast` in lowercase, Sora 600, with the middle dot in the accent colour. App icon: `pi·` on the icon background, generated as a PNG in the current accent (`src/icons.js`).
- **Fonts:** Sora for the UI, JetBrains Mono for codes and times. Both are self-hosted (`assets/fonts/`, OFL) for the web app and installed through fontconfig for mpv/libass and rsvg-convert. Nothing loads from Google Fonts at runtime.
- **Original artwork only.** No YouTube, Twitch or Google Cast logos or icons.

### Screens

1. **Boot splash (Plymouth):** the plain background colour, the wordmark centred, three dots below it that pulse one after another like the loading dots (the middle one in the accent), and "STARTING UP" at the bottom. The "Animations" setting freezes the dots. The two drifting glows it used to have were dropped: they looked off.
   - The splash stays until Pi-Cast is about to draw. Plymouth used to quit when boot finished, ~25 s before mpv drew anything (Node alone takes ~19 s to load on the throttled Pi), and the TV was black in between; `--retain-splash` doesn't help, since the console takes over once Plymouth lets go of DRM. So `picast.service` is `Type=notify`, ordered before `plymouth-quit`, and `index.js` sends READY (`systemd-notify`) right before it starts mpv, which takes the display at once (`force-window`). The yt-dlp and Instagram workers start after the home screen is up, so mpv gets the CPU. The log says "home screen up N s after the splash".
2. **Home:** the backdrop above, a large clock (24h/12h) and the date at the top left, and "Ready to cast" with a one-line hint in the centre.
   - **Weather** at the top right, opposite the clock (when a place is set): the icon and temperature, the condition with today's high/low, and the next three days in columns (day, icon, high and muted low). It ends well above the glass card. The icons are ASS shapes (`tv/weatherIcons.js`): sun and moon in the accent, clouds in the text colour.
   - **Key hints** above a thin divider: the colour keys' favourites as coloured dots with names on the left, and on the right "▲ Instagram" (while logged in) and "▼ Spiele". A Twitch favourite that's live, or a YouTube live stream that's on air, gets a red "LIVE" pill after its name, and its name turns from muted to the text colour. Names are measured in the font (`tv/measure.js` reads Sora's advance widths), because the character-count estimate put the pill on top of names like "Trymacs".
   - **Below the divider:** the web remote's QR code (no caption), the TV code (pairing code) and the network (WLAN + network name with the Wi-Fi icon) on the left, and a large wordmark on the right. The user dropped the remote's address and the "Scan with your phone camera" text for a calmer look.
3. **Loading:** shown while a new item starts. "LOADING" in the accent, the title, and channel · source · "from <sender>" in the glass card in the middle, with three dots below it that pulse one after another (the middle one in the accent).
   - From home it sits in the home screen's card. When casting over a playing video, the old video freezes, dimmed, under a glass card of the same size.
   - The same card says "BUFFERING" when a video stalls for more than a second.
4. **Now-playing pop-ups** that fade after about 5 s: a "<sender> connected" pill at the top right; a card at the bottom left with the thumbnail, "NOW PLAYING" in the accent, the title, and the source and quality; and a thin accent progress line.
5. **Paused:** dimmed video, a pause icon in an accent ring, and at the bottom the title, channel and source, an accent progress bar, and the elapsed and total times in mono.
   - **Timeline** (▲ while a video plays, or ◀ ▶ seeking): the same title, channel, source, progress bar and times in a glass card at the bottom (like the now-playing card, full width), over the running video without pausing or dimming. It fades after about 5 s; ▲ again starts the 5 s over. It replaces the now-playing card, redraws with the progress once a second, and moves toasts to the top while it shows. Chosen over the pause bar as it is on a dark fade (weak on bright video) and a one-line strip. A YouTube live stream shows "LIVE" instead of times, like Twitch.
6. **TV settings panel:** a glass panel on the right over the dimmed home screen, which hides its glass card. Rows: accent (a swatch row), language, animations, sounds, skip sponsors, clock, switch TV input, and **Power off**: OK shows "OK again" in the accent, and a second OK within 4 s shows a "Powering off" toast and runs `systemctl poweroff` (sudoers rule from install.sh). Back, moving away or waiting cancels it. Footer: "◀ ▶ change · OK select · Back close". OK on the home screen opens it; the arrows and Back navigate it.
7. **Instagram Reels:** ▲ on the home screen opens them. The Reel plays upright in the middle (mpv's `background-color` fills the sides). Left: "INSTAGRAM" in the accent above "Reels", and the keys at the bottom. Right, bottom-aligned: @user, up to four caption lines (muted) and the like count with a ♥, filled in the accent once liked. OK likes with a big ♥ that fades out over the Reel. Pause shows the accent pause ring. Between Reels only the dots show in the middle, no loading card.
8. **AirPlay**, like a poster: the clock and date at the top left as on the home screen, the cover (620 px, rounded) on the right, and at the bottom left "● AIRPLAY" (with "· PAUSED" when paused), the title (96 px, 72 px if long), artist — album, and an accent progress bar with times. It sits on the same backdrop as home, without the glass card. (A Spotify screen in this style was approved first; see AirPlay below for why it's AirPlay.)
9. **Game night** (approved design "C", on the home backdrop): ▼ on the home screen or the web app's games button opens it.
   - **Lobby:** "SPIELEABEND" and "Wer spielt mit?", a QR code that opens the web app's `#games`, the players as round avatars (initial on their colour; pi·cast dark with an accent ring and "COMPUTER · <level>"; the host marked "HOST") and a "+" seat, and the games as tiles along the bottom with the selected one framed in the accent. ◀ ▶ pick, OK start, Back quit.
   - **Two-player boards** (Vier gewinnt, Tic-Tac-Toe): the board in the middle, a player on each side with an accent ring and "IST DRAN" pill on their turn ("denkt nach …" for pi·cast), their piece and their wins. Vier gewinnt shows the disc over the column the player has tapped on their phone, a dot on the last disc, and rings on the winning four. A round's end shows "<name> gewinnt!" or "Unentschieden" in a banner; OK plays again (who starts alternates), Back goes to the lobby. During a game Back asks first ("Nochmal Zurück zum Beenden"). Toasts sit at the top on this screen, since the boards fill the bottom.
   - **Eins!** (2–6 players; Uno's rules with the user's house rules, but its own name and card look, since Uno is a trademark): the players across the top (the one whose turn it is framed, card counts, a red "EINS!" badge after a call), the draw pile and the pile's top two cards (each turned a little, by card id), the colour as a dot, an open +2/+4 stack as a big red "+n", "Richtung →/←", and a line saying what just happened and whose turn it is. Cards are the colour with a big white value (⊘ and ⇄ come from DejaVu Sans), wilds dark with the four colours as dots.
     - House rules: +2 and +4 stack in any combination (a +2 on a +4 must match the chosen colour) and whoever can't add one draws the whole stack and is done; +4 can always be played; drawing is one card and ends the turn; with two players a reverse is a skip. "EINS!" has to be pressed before playing the second-to-last card, or that player draws 2. Whoever runs out of cards takes the next place and the round goes on until one player is left; their pill shows "Platz n", and the round ends with the standings (first place in the accent) instead of the banner. First place counts as the win.
   - **Schach** (chess.js for the rules, Stockfish as pi·cast): the board in the middle, white always at the bottom, in two colours from the accent (the light squares one rectangle, the dark ones one shape, so 64 squares cost two bitmaps); pieces are DejaVu Sans glyphs (♚♛♜♝♞♟, white filled white with a dark outline, black dark with a light outline); coordinates in the corner squares; the last move amber, a king in check red. What a player taps on their phone stays on the phone (the user didn't want the TV to give a move away). Left: black's player at the top and white's at the bottom (avatar, name, colour, the pieces they took grouped by kind in the other colour with "+n" for the material lead, "IST DRAN" or "denkt nach …", "● bietet Remis an", wins), a red "SCHACH" pill between them. Right: "ERÖFFNUNG" with the opening (variant "A", chosen over one line above the board, which cut long names): the family ("Italian Game") and the variation in up to two muted lines; the names are lichess's chess-openings (CC0, English only), looked up by position (`games/openings.json`, built by `scripts/build-openings.js`), so transpositions count and the last named one stays after the book ends. Below it "ZÜGE" in German notation (K D T L S, `shared/chessNotation.js`) in JetBrains Mono, numbered in pairs, the newest in the accent. Top right "pi·cast · Stufe n von 5" against the computer, else the round. The end is a solid banner over the board: "<name> gewinnt!" or "Remis", with the reason (Schachmatt, Patt, Dreifache Wiederholung, 50-Züge-Regel, Zu wenig Material, "<name> hat aufgegeben", Remis vereinbart). Who plays white alternates by round.
     - Levels: below 5, pi·cast picks from Stockfish's best 8 moves (MultiPV) at a shallow depth, weighted e^(−Δcp/T), so mistakes scale with the level and shallow depth misses deeper tactics: 1 depth 4 / T 120, 2 depth 6 / T 70, 3 depth 8 / T 40, 4 depth 10 / T 20; 5 is Stockfish's best move at depth 14 / 1 s. Roughly 800, 1100, 1400, 1800 and 2400+ Elo (guesses). Tried and dropped: uniform random moves (the user found them off) and Stockfish's Skill Level (its random term let skill 7 give a rook away for nothing). pi·cast accepts a draw offer when it is 1.5 pawns behind, or even after move 30. On the Pi the first move takes ~4 s (the engine loads its network), then 0.1–1 s.
   - **Phones:** join with a name and a colour; the host adds computer players (level 1–5), picks the game and starts it; Vier gewinnt is tap a column (it shows on the TV), then "Einwerfen"; Tic-Tac-Toe is tap a square; Eins! shows the others' card counts, the top card and colour, and your hand (cards you can't play dimmed): tap a card (a wild asks for the colour), then "<card> legen", or "Ziehen" ("6 ziehen" on a stack), and "EINS!" when two cards are left; Schach shows the board (flipped for black): tap a piece, then a target (a pawn on the last rank asks for the piece), "Remis anbieten" and "Aufgeben" (tap twice), an offer to answer with "Remis annehmen" / "Ablehnen", and the last three moves. The pieces come from a 1.7 KB DejaVu Sans subset (`public/fonts/dejavu-sans-chess.woff2`): iOS has no DejaVu and draws ♟ as an emoji.
10. **Toasts** for short messages, such as "Couldn't play that link", or "● Trymacs" (with the key's colour) when a colour key starts a favourite.
    - They sit at the bottom centre, except where the bottom is full: at the top on the home screen (between the clock and the weather, at most 840 px wide, wrapped onto two lines if longer; at the bottom while the settings panel is open, whose title is at the top), on game night and while the timeline shows.
11. **iPhone web app:** a header with the wordmark and a "● <TV name>" pill; a now-playing card (thumbnail, state, title and channel, progress, back 10 s / play-pause / forward 10 s, volume); a "Play a link" field; and a Recent list. Settings: the accent grid (5×2) and a custom colour; animations; device name, language, Twitch quality, SponsorBlock, 24-hour clock; colour-key favourites (name and link per colour); the CEC toggles ("Control with TV remote", "Switch TV input on cast"); and the Instagram login (username and password, a box for the security code, or a browser's session ID under "Login not working?"), which shows the account and a logout button once logged in. `#instagram` opens that section.

## 3. Architecture

Node 22 (ESM), with `express`, `yt-cast-receiver`, `qrcode` and `chess.js` as the only dependencies and no build step. One mpv process draws everything on the TV.

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
| `weather.js` | Weather for the home screen from Open-Meteo (free, no key), refreshed every 30 min and when the TV wakes up; place lookup by name. |
| `network.js` | Wi-Fi status via `nmcli`. |
| `sounds.js` | UI sounds and the startup sound, through `bin/sounds.py` (see below). |
| `instagram.js` | Instagram worker (`bin/insta.py`) and the login state. |
| `reels.js` | Reels on the TV: the list, scrolling, likes, keys. |
| `airplay.js` | AirPlay state and metadata from shairport-sync's pipe; ends a session. |
| `youtubeLive.js` | Which YouTube favourites are live streams on air, for the same pill: a video link (`/live/<id>`, `watch?v=`, `youtu.be`) is one POST to YouTube's web player API (`youtubei/v1/player`, no key, ~5 KB back; `videoDetails.isLive` is there even when it wants a PO token for the streams), a channel's `/live` link (`@name/live`, …) one fetch of that page (~220 KB compressed) for `"isLiveNow":true`. Same schedule as Twitch; about 1 s for one favourite on the Pi. A failed check keeps the last state. |
| `radio.js` | Radio on ◀ from the home screen: the station grid (keys, focus), playing and switching stations, the station search for the web app (radio-browser.info, free, no key). The saved stations are the `radioStations` setting (up to 24). A station plays as mpv's file with the backdrop clip as its picture (`external-files`, 480 repeats = 4 h, then the last frame stays), so the colours keep drifting behind the radio screen; the song comes from the stream's ICY metadata (`metadata/by-key/icy-title`). Starts in about 1.5–2 s. |
| `ytComments.js` | YouTube comments on ▼ over a video: two POSTs to YouTube's web `youtubei/v1/next` (no key): the watch page's data has a continuation token for the comment section, the second request returns the top 20 (`commentEntityPayload`). About 1.5 s from a PC, 3 s on the Pi, so they're fetched 8 s after the first frame, ahead of ▼. |
| `twitchLive.js` | Which Twitch favourites are live: one GQL query (Twitch's public web client ID, as streamlink uses) for all of them every 3 min and when the TV wakes up, skipped in standby. |
| `games/party.js` | Game night: players (a secret token per phone), host, computer players, seats, turns, wins, the TV remote's keys; `view()` for the TV, `viewFor(token)` per phone. |
| `games/connect4.js`, `games/tictactoe.js`, `games/eins.js` | Rules modules: `create`, `turn`, `move` (throws on an illegal move), `bot` (negamax with alpha-beta / full minimax / Eins! heuristics; lower levels make random mistakes, `games/levels.js`). Eins! also has `public` (counts, top cards) and `private` (a player's hand and playable cards), so hands never leave the server except to their phone. |
| `games/chess.js`, `games/stockfish.js` | Schach: the moves as UCI strings, replayed with chess.js (so repetitions count); `public` adds the material and the opening (`openings.json`, read on first use); `anyTime` lets resigning and draw offers skip the turn check; `close` stops the engine when game night closes. Stockfish (Debian's package, in `/usr/games`) runs as one UCI process while needed; without it a two-ply material search plays. |
| `tv/games.js` | Game night's TV screens (lobby and boards). |
| `tv/measure.js` | Text widths from the Sora font files (`head`, `hhea`, `hmtx`, `cmap` format 4), for placing things after text. |

### Playback ownership

`Playback` is the only thing that loads or stops media, so the cast receiver and the web app never fight over mpv. `owner` is `'cast'`, `'web'`, `'instagram'` or `null`. A new request from the other side emits `takeover`, and the cast session is told it lost the screen. While a new item replaces the old one (`switching`), the old item's `end-file` is ignored. `ended` reports `eof` or `error`.

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
  - YouTube live streams only have separate video and audio, and the audio's codec isn't reported (yt-dlp shows "unknown"; it's AAC), so the last choice takes any audio with the H.264 video (the AAC-only choices failed with "Requested format is not available"). `ytdl.py` takes the audio as whichever requested format isn't the video; filtering on a set `acodec` dropped it.
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
- **The warm challenge solver** (`bin/jsc.js`): even the preprocessed player is 4.3 MB of JS, and yt-dlp's fresh Node compiled it again for every video (4–5 s at 600 MHz).
  - The worker patches yt-dlp's Node provider (`_construct_stdin`/`_run_js_runtime`) to send challenges to one Node that stays running. It gets yt-dlp's verified lib and core scripts once and keeps each player's compiled `n`/`sig` functions (the newest two), keyed by a hash of the player. Python sends the player only the first time.
  - Same sandbox flags as yt-dlp's Node (`--permission`). If it fails or times out, that challenge goes through yt-dlp's normal path. If `_real_bulk_solve` no longer passes `_construct_stdin`'s result straight to `_run_js_runtime`, the patch isn't applied.
  - Measured at 600 MHz over five videos: resolving went from about 9.0 s to about 4.8 s per video. jsc.js uses about 65 MB.
  - **Warm-up:** once the worker is ready, a background thread starts jsc.js and has it compile the newest player in yt-dlp's cache, as the first video would (about 4 s after "worker ready", logged as "warmed up the challenge solver"). A request that comes in meanwhile waits only for yt-dlp's side to be set up (the extractor, the solver scripts) and does its network requests while Node compiles; the solver lock makes its challenge wait for the compile. Without a cached player it does nothing. The worker starts after the home screen, so boot isn't slower. First cast after a restart, at 600 MHz: resolving went from 7.8–9.6 s to 6.1 s, about what later videos take.
  - Some videos (e.g. VEVO ones) get HTTP 403 on their streams with or without it; that's YouTube refusing this client, not the solver.
  - Tried and rejected: clients that need no JS challenge (`android_vr`, `ios`). They need a PO token and only give 360p. Smaller player variants only saved a few seconds.
- A daily `picast-update.timer` upgrades yt-dlp and streamlink, because YouTube breaks old versions regularly.

### Cast receiver (`yt-cast-receiver` 2.x)

- The device name is fixed when the receiver is created, so renaming means stopping it and starting a new one.
- The receiver does **not** detect the end of a video. On `ended`, `castPlayer` calls `pause()` then `next()`, and `stop()` if there's nothing next.
- "Link with TV code" comes from `getPairingCodeRequestService()`. The code is shown on the home screen and in the web app.
- Its default node-persist store wrote before it had initialised and lost data, so `receiverStore.js` replaces it. Writes are serialised, because concurrent writes raced on the temp file.

### Instagram

- `bin/insta.py` (instagrapi, in `.venv`) stays running like the yt-dlp worker: JSON lines over stdin/stdout with `status`, `login`, `code`, `logout`, `reels` and `like`. Calls run one at a time on one thread, with instagrapi's 1–3 s random delays. A login waits on that thread for a `code` request (security code by email/SMS, or 2FA), which the main thread passes on.
- The session (cookies and device, never the password) is in `data/instagram.json` (mode 600). When Instagram says the login is gone, the file is deleted and the TV says "log in again in the web app".
- **Password login is broken in instagrapi** (since September 2026: "your version of Instagram is out of date", [#2807](https://github.com/subzeroid/instagrapi/issues/2807)). Logging in with a browser's `sessionid` cookie (`login_by_sessionid`) works.
- **The feed is `clips/discover/`**, the Reels tab. `clips/connected/` only has Reels from followed accounts, and the account follows nobody. instagrapi's `reels()` always restarts at the first page, so the worker pages the endpoint itself and keeps the cursor. A page has only about 4 Reels; ads are dropped. The next page is fetched while 3 or fewer are ahead, and a failed fetch isn't retried for a minute.
- **Video:** the smallest `video_versions` entry at least 1080 tall, else the largest. So far all were H.264 High, 720×1280 or 540×960, 30 fps: hardware-decoded.
- **Playback:** `Playback.play(url, { owner: 'instagram', info, loop: true })`. `info` (kind, title, @user, thumbnail, duration) replaces the metadata lookup, and the URL is loaded as an EDL of 60 copies of itself, like the backdrop clip, so it loops without a black flash. `status()` reports the position within one round. Reels don't go into Recent and get no now-playing card.
- `Reels` ends when anyone else plays something, or when playback stops (web app, standby). A Reel that fails is skipped; three in a row close Reels.
- Remote keys go through `remoteKey()` in `index.js`: colour keys, then Reels, then the settings panel, then ▲ on home (opens Reels), then the playback keys. `/api/tv/key` uses the same path.
- The like sound isn't played: mpv holds the HDMI audio device while a Reel plays (§4.5).

### AirPlay

- **Spotify Connect doesn't work** for this account: go-librespot 0.10.5 (and librespot, the same method) got "failed retrieving aes key with code 1" for every track. Spotify refuses the decryption keys to unofficial clients for some Premium accounts since early 2026 ([go-librespot #279](https://github.com/devgianlu/go-librespot/issues/279)); no workaround is known. So music comes over AirPlay instead.
- **shairport-sync** (Debian's 4.3.7, AirPlay 1) plays on its own as "pi-cast", straight to `hdmi:CARD=vc4hdmi,DEV=0`. It uses about 8% CPU on the throttled Pi. Skip and pause take 1–2 s: AirPlay 1 keeps a 2 s buffer at the receiver.
- `airplay.js` reads its metadata pipe (`/tmp/shairport-sync-metadata`, XML items with base64 data): `abeg`/`aend` (session), `pbeg`/`prsm` and `pend`/`pfls` (playing), `minm`/`asar`/`asal` between `mdst` and `mden` (title, artist, album), `prgr` (RTP start/current/end at 44.1 kHz) and `PICT` (the cover, saved to `data/airplay/`). It's opened read-write and non-blocking and read through a `net.Socket`: a FIFO read with `fs.createReadStream` blocks a libuv thread-pool thread, and Node then hung on exit until systemd killed it after 90 s (every restart). Opened read-write, it also never sees EOF when shairport-sync closes its end.
- **A session that was on before Pi-Cast (re)started** has no `abeg` to read, and shairport-sync can't be asked for the current track. So on start an established connection on its port 5000 (`ss`) counts as a session, and so does any `mden` or `prgr`. The title and cover come with the next track.
- **Sharing the audio device** (§4.5): the sounds helper keeps off it while a session is on. A video takes over: `mpv.beforeLoad` ends the session first by restarting shairport-sync (it has no command for that; a sudoers rule allows exactly `systemctl restart shairport-sync`). A session starting stops whatever plays. Back or Stop on the AirPlay screen ends it too.
- The TV shows the AirPlay screen while a session is on and nothing else plays. The cover is an `overlay-add` bitmap (premultiplied BGRA with rounded corners in its alpha, `coverBgra()`), so "paused" goes into the label: anything drawn over the cover would be hidden under it (§4.2). The progress is redrawn once a second.

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
  - TV off: playback stops and the home backdrop stays loaded but paused (`Playback.setStandby`), so the picture is there the instant the TV is back. TV on: the backdrop moves again, the weather and LIVE tags are fetched again, and the startup sound plays, unless the TV was woken by a cast.
  - The HDMI connector stays `connected` while the TV is off, so hotplug can't be used.
  - The Pi can't power itself off and on (a Pi 3 only boots again on power), so this is the closest to "off with the TV". After Power off in the settings panel it stays off until its power is reconnected; the TV can't wake it over CEC.
- **Colour keys** (F1–F4: `0x71` blue, `0x72` red, `0x73` green, `0x74` yellow on the DYON) play the favourite in the `shortcuts` setting, on any screen, through `Playback.play` with owner `'web'` (so a cast session gets the usual takeover). An empty key shows a toast.
- **Number keys aren't forwarded by the DYON TV**, tested both as a playback device (`-t p`) and as a recorder (`-t r`) with Pi-Cast as the active source. Only OK came through. That's why favourites are on the colour keys and not on digit codes.
- **CH+/CH− aren't forwarded either** (CEC `0x30`/`0x31`), tested as a playback device (`-t p`) and as a tuner (`-t t`). Only OK came through.

### Web app

- Served by the Pi at `http://picast.local:8080`. It can't live on GitHub Pages: Safari blocks an HTTPS page from calling the Pi's plain-HTTP address.
- Plain HTML/CSS/JS in `public/`, mobile-first, with iOS standalone meta tags, safe-area insets, a manifest and generated icons.
- Live state comes over SSE (`/api/events`), with no polling.
- iOS web apps can't be share targets, which is why the Shortcut exists. It POSTs `{url}` to `/api/play`.
- Lumen (the owner's iPhone app) casts with `POST /api/play {url, start}`: `start` is the position in seconds the phone was at (0 or more; live streams ignore it). It then drives playback with `/api/toggle`, `/api/seek`, `/api/stop` and reads `/api/status`.

### Sounds

- Seven UI sounds (move, select, open, close, notify, like, error) are synthesized by `scripts/render-sounds.js` into `assets/sounds/*.wav` (48 kHz, 16-bit stereo). The same script converts `assets/sounds/startup.mp3` to `startup.wav` and trims its trailing silence. The startup sound is not in git: its licence wasn't checked for redistribution.
- `bin/sounds.py` plays them through libasound (ctypes, standard library only), on mpv's ALSA device behind `plug:`. While it holds the device it writes silence between sounds (10 ms writes, 60 ms latency), so the TV keeps its audio input awake and short sounds aren't swallowed.
- The device takes one program at a time (§4.5), so the helper holds it only while nothing plays and mpv's `current-ao` is unset. `mpv.load()` awaits `beforeLoad` for anything but the backdrop: the helper lets go first, after letting a sound that's still playing finish (at most 1 s). After a stop, mpv closes its audio output once the backdrop (which has no audio) shows, and the helper takes the device back.
- So there are no UI sounds during a video or over a paused one.
- Triggers: the settings panel (open, move, select, close) and toasts (notify; error for "Couldn't play" and unset colour keys). The startup sound plays when the home backdrop's first frame is on screen, if that's within 5 minutes of boot (so boot goes splash → sound with the home screen), and when the TV comes back on (see CEC). It's dropped once something plays.

### Settings side effects

| Setting | Effect |
|---|---|
| Accent | Redraw the overlays, switch the home backdrop, regenerate the icons and the boot splash. |
| Animations | Boot splash glows on/off; home backdrop clip or still image. |
| Device name | Restart the cast receiver and CEC. |
| Twitch quality | Takes effect on the next stream. |
| SponsorBlock | Restart mpv when idle. |
| Clock | Redraw the home screen. |
| Weather place | Fetch the weather for it (or hide it). Set in the web app by name, looked up with Open-Meteo's geocoder. |
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
- **No 90° rotation in overlay mode.** `video-rotate=90` makes every frame fail (`drmprime-overlay: Failed to create framebuffer on layer 0: Invalid argument`), and the picture breaks. The vc4 planes only flip (0°/180°). Rotating would need the copy path (GL) or re-encoding.

### 4.2 OSD texture limit

- The Pi 3 GPU caps textures at **2048×2048**. mpv packs **all** `osd-overlay` ASS bitmaps into one texture. If they don't fit, mpv draws **none** of them and only logs `OSD bitmaps do not fit on a surface with the maximum supported size 2048x2048`.
- **The overflow is sticky.** Once one screen overflows, every later screen fails too, even ones that fit on their own, until mpv restarts. pi-cast watches mpv's log for it: it logs the screen and every layer on it (`Tv.layerSummary()`) and restarts mpv as soon as nothing plays. It happened once on 2026-10-25 during a Twitch stream while the Wi-Fi was dropping out; every scene in `tv-scenes.js` fits on its own, so the cause is still open. The journal lives in RAM on Raspberry Pi OS (`Storage=volatile`) and that one was lost in a reboot, so each overflow also writes a snapshot to `data/osd-overflow/` (the newest 10): the screen, what was playing, every layer's ASS and the last 30 layer changes. `node scripts/check-osd.js <snapshot>` replays its layers. An Aurora home screen with a full-screen rectangle and blurred glows caused exactly this, so no overlay showed at all.
- **Blur is expensive:** libass pads blurred bitmaps heavily. Even one blurred ring per glow didn't fit home plus the settings panel.
- **A shape with `\bord` makes two full-size bitmaps** (fill and border).
- So: no full-screen shapes and no big blurred glows in the overlays. The home backdrop is a picture on the video plane instead (§3, TV renderer).
- Test the worst case (home plus settings panel plus toast) with `scripts/check-osd.js` after any layout change. It runs every scene in one mpv (about 25 s on the Pi) and only gives each scene its own mpv from the first failure on, since an overflow is sticky; arguments filter by scene name (`check-osd.js games`, about 8 s).
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
- **The AirPlay screen flickered black every few seconds** for the same reason: its progress redraws once a second over the moving clip. Its backdrop crawls at 1% too (`holdBackground('airplay')`) while the screen is up.
- Redrawing overlays over **moving** video is expensive on the Pi 3: a full-screen dim over playing video cost mpv about 15–20% more CPU, and the dots another 15–20%, which slowed yt-dlp's resolving. Over a paused frame it's cheap. While the backdrop clip played, the dots' redraws also made the screen **flicker black** every few frames. Pausing whatever is on screen during loading fixed both.

### 4.4 Power

The Pi 3 throttles from 1200 to 600 MHz on undervoltage (`vcgencmd get_throttled` reports `0x50005`). That roughly halves everything CPU-bound, yt-dlp especially, and writing to the SD card on low voltage corrupts it. Use the official 5.1 V / 2.5 A supply. On 2026-10-24 the Pi also rebooted by itself (nobody unplugged it) while copying files over Wi-Fi, still on the 18 W brick.

### 4.5 Audio

- HDMI audio is card `vc4hdmi`, with a single subdevice. The `hdmi:` device is an `iec958` plugin over `hw`, so `dmix` can't sit under it (it would mix IEC958 subframes). A second program gets `EBUSY` while mpv has it open.
- mpv closes its audio output when the next file has no audio (the backdrop), and keeps it open while a video is paused.
- The sounds helper takes about 0% CPU while it writes silence.
- **No picture, no sound:** with mpv stopped, nothing drives the HDMI output and audio written to the device is silent. mpv must keep showing something (the backdrop) for AirPlay to be heard.
- The sounds helper grabs the device in any gap (it holds it whenever nothing plays), even between two AirPlay songs, so it has to know about other programs (see AirPlay).
- shairport-sync's default volume curve turns a third of the phone's volume into −43 dB, which is nearly silent on a TV.

### 4.6 Overlays over 60 fps video

Measured on 2026-10-25 during a 720p60 Twitch stream, with the Pi throttled (600 MHz ARM, 250 MHz core), for a Twitch chat column (dropped, see §5). mpv draws its overlays on the draw plane again for **every video frame**, so what an overlay costs is paid 60 times a second. Without an overlay mpv takes about 30% CPU and drops nothing.

- **ASS overlays cost per frame, roughly by area and by the number of text events.** A 540×972 glass rectangle alone: +50% CPU, a few drops. Twelve chat lines (no glass): +70%, 1–2% of frames dropped. Both together (the chat column, design A): mpv at 120% CPU and **324 of 900 frames dropped** (≈38 fps). Six short lines in a 466 px tall glass: still 2% dropped. The timeline card (§3) drops about 1% too, and the now-playing card a few frames.
- At **30 fps** (480p30) the full chat column dropped nothing. The user wants at least 720p, and many Twitch channels only have 720p60 above 480p30.
- **Moving the video aside** (`video-margin-ratio-right`/`-bottom`, e.g. 0 left and 520 px right for a 1400 px wide video at the top left) works in overlay mode: mpv moves the video plane and it costs nothing.
- **One static `overlay-add` bitmap costs almost nothing**: 440×972 or 440×972 plus 1400×292, 0 drops, +5–10% CPU.
- **Updating a bitmap stalls the video.** Each `overlay-add` of a new 1.7 MB BGRA file costs about 30 ms in mpv; 16 updates dropped 5 frames. Drawing the chat with Pillow (`bin/bitmap.py`, on the experiment branch) took 525 ms per frame on the throttled Pi. In the app, the chat bitmap updated every 1.2 s dropped 34–53 frames in 20 s, every 4 s still 28, and even with no updates at all 23 (unexplained: the same static bitmaps from a test script dropped none).
- Conclusion: nothing that changes every second or two can sit on screen during 60 fps video on this Pi as it is. A proper power supply (1.2 GHz, 400 MHz core) might change that; measure again before trying.
- Measuring: mpv's `frame-drop-count` before and after a fixed time, and mpv's CPU from `/proc/<pid>/stat` (utime + stime).

## 5. Open work

- **Faster YouTube start.** With the warm solver, resolving is mostly YouTube's network requests (webpage, player APIs, m3u8: 2–4 s).
  - Options: resolving the next queued video ahead of time.
  - A proper power supply is likely the biggest single win.
- **TV black with a signal** happened once, and power-cycling the TV fixed it. If it comes back, test whether CEC is involved by turning it off in the web app.

- **Instagram:** fetching the next Reel's video ahead (key to first frame is now a fresh HTTP open). A QR code on the TV that opens the web app's `#instagram` when nobody is logged in. Feed posts and Stories besides Reels.

- **Twitch chat (dropped on 2026-10-25).** Anonymous read-only chat over `wss://irc-ws.chat.twitch.tv` (`NICK justinfan<number>`, `CAP REQ :twitch.tv/tags` for names and colours) works with no account. Designs: A, a glass column over the video (cost: §4.6, far too much); B, the video moved to the top left with the chat beside it and the channel under it, chosen by the user, as overlay-add bitmaps: still 1–4% of frames dropped at 720p60. The code is on the local branch `experiment/twitch-chat` (`src/twitchChat.js`, `src/tv/bitmaps.js`, `bin/bitmap.py`, design B layout in `screens.js`). Try again after the power supply is fixed. Note: Sora has no ▲▼◀▶; Pillow can't fall back to another font, so the bitmap draws the arrow as a shape.
- **The living-room lamp.** The user's smart bulb (label "SAMSON 3000k OP3731", no packaging, nothing found online) isn't on the Wi-Fi (no Tuya broadcasts on 6666/6667/7000, no WiZ reply on 38899, no setup network). The user thinks it may still be looking for an old Wi-Fi network. A Bluetooth scan from the Pi found "MELK-OA10   43" (`BE:69:08:34:5F:01`, a common ELK-BLEDOM-type controller), which vanished when the lamp was switched off but didn't come back when it was on again; gatttool couldn't connect. A second watch saw neither it nor "Sunset lights" (`FF:10:10:A3:63:90`, a neighbour's?) change with the lamp. Next: reset the bulb (off/on about 5 times until it blinks) and look for its setup network or a new BLE name. Bluetooth on the Pi is soft-blocked by default (`/sys/class/rfkill/rfkill0/soft`); scanning shares the radio with Wi-Fi, so only while nothing plays. Stop `hcitool lescan` with SIGINT (`timeout -s INT`), or the next scan fails.

### Ideas for later (from the user, not designed yet)

- **Party games with the phone as controller:** Pong, Connect 4, tic-tac-toe and other simple games. The TV shows the game; phones join through the web app (QR code) and send input over the same HTTP/SSE channel.
- **More game night games:** rock paper scissors (everyone picks on their phone, the TV reveals) and a slot machine (spin on the phone, the reels run on the TV).
- **Profiles:** a "Who's watching?" picker at startup, like Netflix, chosen with the arrow keys. Each profile has its own colour keys, accent, Recent list, language and, later, Instagram account.
- **AirPlay screen mirroring** from the iPhone, with UxPlay (open-source AirPlay server; GStreamer, hardware H.264 through v4l2). It's an experiment on a Pi 3:
  - **The display:** UxPlay draws through its own GStreamer sink and needs the display, which mpv holds. So mpv would have to step aside while mirroring (be stopped and started again afterwards, with a black flash), or UxPlay's H.264 would have to be fed to mpv.
  - **Audio:** it needs the HDMI audio device too (§4.5).
  - **Limits:** about 0.5 s of delay (fine for photos and web pages, not for games), and Netflix and other DRM apps show black.
  - Test UxPlay on its own first, at the throttled 600 MHz.
