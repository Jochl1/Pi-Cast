// Synthesizes the UI sounds into assets/sounds/*.wav (48 kHz, 16-bit stereo,
// the format bin/sounds.py plays). Soft bell tones with a short room tail, so
// they sit quietly under the Aurora look. Run: node scripts/render-sounds.js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
const RATE = 48000;

const note = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note → Hz

/**
 * One bell-ish tone into `buf`: a sine with a quieter octave and a faint
 * inharmonic partial, a short attack and an exponential decay.
 * `glide` = frequency factor reached at the end (pitch sweep).
 */
function tone(buf, { at = 0, freq, dur, gain = 1, attack = 0.004, decay = dur / 4, glide = 1, bright = 0.25 }) {
  const start = Math.round(at * RATE);
  const n = Math.round(dur * RATE);
  let phase = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE;
    const f = freq * glide ** (t / dur);
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay) * Math.min(1, (n - i) / (RATE * 0.005));
    const s = Math.sin(phase) + bright * Math.sin(2 * phase) * Math.exp(-t / (decay / 2)) + 0.08 * Math.sin(2.76 * phase) * Math.exp(-t / (decay / 3));
    buf[start + i] += gain * env * s;
  }
}

/** A small room: a few feedback-free echoes, darker and quieter each time. */
function room(buf, amount = 0.18) {
  const out = Float64Array.from(buf);
  const taps = [[0.023, 0.6], [0.041, 0.45], [0.067, 0.3], [0.097, 0.2], [0.131, 0.12]];
  for (const [delay, g] of taps) {
    const d = Math.round(delay * RATE);
    let lp = 0;
    for (let i = d; i < buf.length; i++) {
      lp += 0.35 * (buf[i - d] - lp);
      out[i] += amount * g * lp;
    }
  }
  return out;
}

const SOUNDS = {
  // ▲▼◀▶ in lists: a tiny, high tick.
  move: { dur: 0.12, peak: 0.16, build: (b) => tone(b, { freq: note(88), dur: 0.05, decay: 0.012, bright: 0.1 }) },
  // OK / changing a value: a short pluck, root and fifth.
  select: {
    dur: 0.3,
    peak: 0.3,
    build: (b) => {
      tone(b, { freq: note(81), dur: 0.2, decay: 0.05 });
      tone(b, { freq: note(88), dur: 0.2, decay: 0.04, gain: 0.5 });
    },
  },
  // A panel opens: two notes rising.
  open: {
    dur: 0.5,
    peak: 0.3,
    build: (b) => {
      tone(b, { freq: note(76), dur: 0.25, decay: 0.07, glide: 1.02 });
      tone(b, { at: 0.07, freq: note(83), dur: 0.3, decay: 0.09 });
    },
  },
  // A panel closes / Back: the same, falling.
  close: {
    dur: 0.5,
    peak: 0.26,
    build: (b) => {
      tone(b, { freq: note(83), dur: 0.25, decay: 0.07 });
      tone(b, { at: 0.07, freq: note(76), dur: 0.3, decay: 0.09, glide: 0.99 });
    },
  },
  // Toasts: a gentle two-note chime.
  notify: {
    dur: 0.9,
    peak: 0.32,
    build: (b) => {
      tone(b, { freq: note(84), dur: 0.5, decay: 0.16, bright: 0.35 });
      tone(b, { at: 0.11, freq: note(91), dur: 0.7, decay: 0.22, bright: 0.35, gain: 0.8 });
    },
  },
  // ♥ on Instagram: a quick upward pop with a sparkle.
  like: {
    dur: 0.45,
    peak: 0.32,
    build: (b) => {
      tone(b, { freq: note(70), dur: 0.12, decay: 0.04, glide: 2.2, bright: 0.1 });
      tone(b, { at: 0.06, freq: note(91), dur: 0.3, decay: 0.08, bright: 0.2, gain: 0.5 });
      tone(b, { at: 0.1, freq: note(96), dur: 0.3, decay: 0.07, bright: 0.2, gain: 0.35 });
    },
  },
  // Errors: two soft, low notes falling. Not a buzzer.
  error: {
    dur: 0.7,
    peak: 0.3,
    build: (b) => {
      tone(b, { freq: note(69), dur: 0.25, decay: 0.08, bright: 0.4 });
      tone(b, { at: 0.16, freq: note(65), dur: 0.45, decay: 0.14, bright: 0.4 });
    },
  },
};

function wav(samples) {
  const data = Buffer.alloc(samples.length * 4);
  samples.forEach((s, i) => {
    const v = Math.round(Math.max(-1, Math.min(1, s)) * 32767);
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  });
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(2, 22); // stereo
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, { dur, peak, build }] of Object.entries(SOUNDS)) {
  const dry = new Float64Array(Math.round(dur * RATE));
  build(dry);
  const wet = room(dry);
  const max = wet.reduce((m, s) => Math.max(m, Math.abs(s)), 0) || 1;
  const fade = RATE * 0.03; // the room tail mustn't end in a click
  const out = wet.map((s, i) => (s / max) * peak * Math.min(1, (wet.length - i) / fade));
  fs.writeFileSync(path.join(OUT, `${name}.wav`), wav(out));
  console.log(`${name}.wav  ${(dur * 1000).toFixed(0)} ms`);
}

// The startup sound isn't synthesized: startup.mp3 (or .ogg/.flac/.m4a) is
// converted to the WAV format, without the silence at its end.
const source = ['mp3', 'ogg', 'flac', 'm4a'].map((ext) => path.join(OUT, `startup.${ext}`)).find((f) => fs.existsSync(f));
if (source) {
  const trimEnd = 'areverse,silenceremove=start_periods=1:start_threshold=-55dB,areverse';
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-af', trimEnd,
    '-ar', String(RATE), '-ac', '2', '-c:a', 'pcm_s16le', path.join(OUT, 'startup.wav')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${source}`);
  console.log(`startup.wav  from ${path.basename(source)}`);
}
