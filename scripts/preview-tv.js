// Renders the TV screens with sample data to PNGs, to check layouts without a Pi.
// Needs an ffmpeg build with libass:  node scripts/preview-tv.js <out-dir> [ffmpeg]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { themeFor } from '../src/shared/theme.js';
import { scenes } from './tv-scenes.js';

const [outDir = 'preview', ffmpeg = 'ffmpeg'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

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
  const bg = scene.video ? '0x2A3140' : t.bg.replace('#', '0x');
  execFileSync(path.resolve(ffmpeg), [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${bg}:s=1920x1080:d=1`,
    '-vf', `ass=${name}.ass:fontsdir=fonts`, '-frames:v', '1', `${name}.png`,
  ], { stdio: 'inherit', cwd: outDir });
  console.log('rendered', name);
}
