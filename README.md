# pi·cast

An ad-free "Chromecast" for a Raspberry Pi 3. It shows up as a cast target in the YouTube app, plays Twitch and other links you send from your iPhone, and is controlled with the TV remote over HDMI-CEC.

- **YouTube:** cast from the YouTube app. Videos are fetched directly with yt-dlp, so YouTube ads never play. Sponsor segments are skipped with SponsorBlock.
- **Twitch and other links:** paste them into the web app, or use Share → **Send to Pi-Cast**. streamlink filters out Twitch's ad breaks.
- **TV:** animated boot splash, a home screen with a clock, now-playing pop-ups, a pause screen and a settings panel. Soft menu sounds and an optional startup sound. No Linux text on screen.

What it can't do: Netflix or other DRM services, and casting from the Twitch app (Google only allows certified Cast devices).

## 1. Flash the SD card

1. Install [Raspberry Pi Imager](https://www.raspberrypi.com/software/) and choose **Raspberry Pi 3** → **Raspberry Pi OS Lite (64-bit)**. It has to be the 64-bit Lite version.
2. Open the settings (the gear, or "Edit settings") and set:
   - hostname: `picast`
   - a username and password
   - your Wi-Fi network, password and country
   - **Services → Enable SSH**
3. Write the card, put it in the Pi, connect HDMI and power, and give it a few minutes for the first boot.

## 2. Install Pi-Cast

From your computer:

```sh
ssh <your-user>@picast.local
sudo apt-get install -y git
git clone https://github.com/Jochl1/Pi-Cast.git
cd Pi-Cast
./deploy/install.sh
sudo reboot
```

The installer takes 10–20 minutes on a Pi 3. You can run it again at any time, for example after a `git pull`. It skips what's already done, and it backs up every system file it changes to `/var/backups/picast/`.

What it sets up: mpv, ffmpeg, Node.js 22, yt-dlp and streamlink (in `.venv/`), the fonts, the SponsorBlock script, a `picast` service that starts at boot, a daily yt-dlp/streamlink update (YouTube breaks old versions regularly), Wi-Fi power saving turned off, and the boot splash.

**Optional: the drifting home background.** The Pi paints a still background itself. The animated one is a set of video loops, one per accent color, too slow to make on a Pi 3. Render them on a computer with Node.js and ffmpeg (about 20 s and 50 MB each), then copy them over:

```sh
node scripts/render-backdrops.js
scp data/backdrops/*.mp4 <your-user>@picast.local:Pi-Cast/data/backdrops/
```

Pi-Cast picks them up the next time it starts or the accent changes, while "Animations" is on.

## 3. iPhone

### Remote (web app)

1. Open **http://picast.local:8080** in Safari, or scan the QR code on the TV's home screen with the camera.
2. Tap **Share → Add to Home Screen**.

You get the remote (play/pause, ±10 s, volume, "Play a link", Recent) and all settings (accent color, animations, sounds, language (English/German), device name, Twitch quality, SponsorBlock, clock, TV remote options).

### "Send to Pi-Cast" in the share sheet

Web apps can't appear in the iOS share sheet, so this uses a Shortcut:

1. Open the **Shortcuts** app → **+** → name it **Send to Pi-Cast**.
2. Tap the **ⓘ** (details) → turn on **Show in Share Sheet**. Under *Receive*, keep **URLs** and **Text** (and **Safari web pages**).
3. Add the action **Get Contents of URL**:
   - URL: `http://picast.local:8080/api/play`
   - Method: **POST**
   - Request Body: **JSON** → add a **Text** field with the key `url` and the value **Shortcut Input**
4. Optional: add **Show Notification** with "Sent to the TV".
5. The first time you run it, allow access to devices on your local network.

Now in the YouTube or Twitch app: **Share → Send to Pi-Cast**.

### Casting from YouTube

Tap **Cast** in the YouTube app and pick **Pi-Cast** (or the name you set). If it doesn't show up, pair it once with the code shown on the TV: in the YouTube app go to **Settings → Watch on TV → Enter TV code**. The code is also in the web app under Settings → Pairing.

## 4. TV settings (DYON)

- **Picture format:** set it to **Just Scan**, **1:1** or **Full** so the edges aren't cut off.
- **HDMI-CEC:** turn it on. The menu may call it *CEC* or *HDMI control*.

TV remote keys:

| Key | Home screen | Settings panel | During playback |
|---|---|---|---|
| OK | open settings | change value | play / pause |
| ◀ ▶ | | change value | −10 s / +10 s |
| ▲ ▼ | | move between rows | |
| Back | | close | stop |
| Play, Pause, Stop, ⏪ ⏩ | | | what they say |
| Red, green, yellow, blue | play that key's favourite | play that key's favourite | switch to that key's favourite |

The colour-key favourites are set in the web app under Settings → Colour keys (red is Trymacs and green is BigSpin by default). Number keys would have been nicer, but the DYON TV doesn't send them over CEC.

Some TVs don't pass arrow keys over CEC. Everything in the TV's settings panel is also available in the web app.

## Configuration

Settings from the web app are stored in `data/settings.json`. Lower-level options go in `config.json` in the repo folder (create it if needed), followed by `sudo systemctl restart picast`:

```json
{
  "logLevel": "debug"
}
```

| Option | Default | What it does |
|---|---|---|
| `mpvHwdec` | `v4l2m2m,v4l2m2m-copy` | Hardware decoder: zero-copy `v4l2m2m`, falling back to `v4l2m2m-copy` (much slower at 1080p). `drm` doesn't work on a Pi 3. |
| `mpvAudioDevice` | `alsa/hdmi:CARD=vc4hdmi,DEV=0` | ALSA device for HDMI audio. List them with `mpv --audio-device=help`. |
| `webPort` | `8080` | Port of the web app. |
| `dialPort` | `3000` | Port for YouTube cast discovery. |
| `logLevel` | `info` | `debug` logs mpv, streamlink and CEC output. |
| `mpvExtraArgs` | `[]` | Extra mpv arguments, e.g. `["--vf=..."]`. |

## Troubleshooting

- **Power supply:** use the official Raspberry Pi 5.1 V / 2.5 A supply. Weaker ones cause undervoltage, which halves the CPU speed (slow video starts) and corrupts SD card writes. `vcgencmd get_throttled` should print `throttled=0x0`; anything else means the Pi has been short on power since boot.
- **Installer stops with "undervoltage":** see above. `PICAST_IGNORE_POWER=1 ./deploy/install.sh` skips the check.
- **Videos take a while to start:** a YouTube video takes about 5–10 s on a Pi 3, and longer on low power. After YouTube updates its player (every few days), the first video takes about 30 s once.
- **Pi doesn't boot, green LED blinks 7 times:** the kernel on the SD card is damaged. The installer checks this before you reboot. If it happens anyway, the SD card is usually faulty.
- **TV black but showing a signal:** turn the TV off and on once.
- **Logs:** `journalctl -u picast -f`. Use `"logLevel": "debug"` for mpv/streamlink/CEC details.
- **Stuttering video:** check the CPU with `htop` while a video plays. With zero-copy decoding, mpv sits around 20 % at 1080p. If it's near 100 % or more, mpv fell back to `v4l2m2m-copy` or software decoding. Check `journalctl -u picast` for mpv errors, and check the power supply. Videos are capped at 1080p30 H.264. 1080p60 is too much for a Pi 3.
- **YouTube stopped working:** update yt-dlp now instead of waiting for the daily timer: `sudo systemctl start picast-update`.
- **No sound:** check `mpvAudioDevice` against `mpv --audio-device=help`.
- **TV remote does nothing:** `cec-client -l` should list an adapter. Stop Pi-Cast (`sudo systemctl stop picast`) and run `cec-client -t p -d 8`, then press keys: lines with `>> 04:44:xx` mean the TV sends them. `cec-ctl -d /dev/cec0 --playback && cec-ctl -d /dev/cec0 --monitor` is another view.
- **Pi-Cast not in the Cast menu:** phone and Pi must be on the same Wi-Fi network, and some routers block discovery between devices ("client isolation"). Pair with the TV code instead (see above).
- **Startup sound:** put an mp3 at `assets/sounds/startup.mp3`, run `node scripts/render-sounds.js` (needs ffmpeg) and copy `assets/sounds/startup.wav` to the Pi. It plays once when the home screen first appears after boot. The menu sounds are made by the same script.
- **Boot splash:** it updates after a look change, but only shows from the next boot. To rebuild it by hand: `node scripts/boot-splash.js && sudo /usr/local/sbin/picast-plymouth-update`.

## Development

No build step. `npm run check` syntax-checks all JavaScript. `npm start` runs the server; without mpv it keeps retrying in the background, so the web app and API can be tried on any machine. `node scripts/preview-tv.js <dir> <ffmpeg>` renders every TV screen to PNG, using an ffmpeg build that has libass. On the Pi, `sudo systemctl stop picast && node scripts/check-osd.js` draws every TV screen in a real mpv and fails if they don't fit the Pi 3's overlay limit; run it after any change to the TV screens.

How it's built, the design, and the hardware limits behind the decisions: [docs/DESIGN.md](docs/DESIGN.md).

Layout: `src/` is the server (`index.js` wires everything together, `tv/` draws the TV screens, `cast.js` is the YouTube receiver, `cec.js` handles the TV remote), `public/` is the web app, `deploy/` has the installer, mpv config and boot splash, and `assets/fonts/` holds Sora and JetBrains Mono (SIL Open Font License).
