// Renders the TV screens with sample data to PNGs, to check layouts without a Pi.
// Needs an ffmpeg build with libass:  node scripts/preview-tv.js <out-dir> [ffmpeg]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { themeFor, ACCENTS } from '../src/shared/theme.js';
import * as screens from '../src/tv/screens.js';

const [outDir = 'preview', ffmpeg = 'ffmpeg'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const base = { accent: 'violet', customAccent: '#A898FF', style: 'aurora', clock24: true, bootAnimation: true, sponsorBlock: true, cecSwitchInput: true };
const now = new Date(2026, 9, 24, 21, 34);
const homeState = {
  now, clock24: true, net: { kind: 'wifi', ssid: 'Home', signal: 70 },
  pairingCode: '123 456 789 012', remote: 'picast.local:8080', deviceName: 'Pi-Cast',
};
const video = {
  title: 'Building a tiny cast receiver out of a Raspberry Pi', channel: 'Some Channel', kind: 'youtube',
  position: 724, duration: 1907, live: false,
};
const swatches = Object.entries(ACCENTS).map(([id, a]) => ({ id, hex: a.hex, selected: id === 'violet' }));

const scenes = {
  home: { settings: base, layers: (t) => [screens.background(t), screens.home(t, homeState)] },
  'home-12h-midnight': {
    settings: { ...base, style: 'midnight', accent: 'amber' },
    layers: (t) => [screens.background(t), screens.home(t, { ...homeState, clock24: false })],
  },
  loading: {
    settings: base,
    layers: (t) => [screens.background(t), screens.home(t, { ...homeState, loading: { ...video, sender: 'iPhone' } })],
  },
  playing: {
    settings: base, video: true,
    layers: (t) => [screens.nowPlaying(t, { ...video, quality: '1080p', withThumb: true }), screens.senderPill(t, 'iPhone')],
  },
  paused: { settings: base, video: true, layers: (t) => [screens.paused(t, video)] },
  settings: {
    settings: base,
    layers: (t) => [screens.background(t), screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: base, focus: 0, swatches })],
  },
  'settings-studio': {
    settings: { ...base, style: 'studio' },
    layers: (t) => [screens.background(t), screens.home(t, { ...homeState, panelOpen: true }),
      screens.settingsPanel(t, { settings: { ...base, style: 'studio' }, focus: 2, swatches })],
  },
  toast: { settings: base, video: true, layers: (t) => [screens.toast(t, "Couldn't play that link")] },
};

const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Sora,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

// ffmpeg's filter syntax trips over drive letters, so work with relative paths in outDir.
fs.cpSync('assets/fonts', path.join(outDir, 'fonts'), { recursive: true });
for (const [name, scene] of Object.entries(scenes)) {
  const t = themeFor(scene.settings);
  const events = scene.layers(t).flatMap((layer, i) => layer.map((e) => `Dialogue: ${i},0:00:00.00,0:00:05.00,Default,,0,0,0,,${e}`));
  fs.writeFileSync(path.join(outDir, `${name}.ass`), header + events.join('\n') + '\n');
  const bg = scene.video ? '0x2A3140' : 'black';
  execFileSync(path.resolve(ffmpeg), [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${bg}:s=1920x1080:d=1`,
    '-vf', `ass=${name}.ass:fontsdir=fonts`, '-frames:v', '1', `${name}.png`,
  ], { stdio: 'inherit', cwd: outDir });
  console.log('rendered', name);
}
