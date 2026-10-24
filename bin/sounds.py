#!/usr/bin/env python3
"""Plays Pi-Cast's UI sounds on the HDMI audio device.

The Pi's HDMI device can only be opened by one program, and mpv needs it for
every video. So Pi-Cast tells this helper when it may hold the device (only
while nothing with sound plays) and when to let go. While it holds it, it
writes silence between sounds: the TV then keeps its audio input awake and
doesn't swallow the start of short sounds.

Talks to the server over stdin/stdout, one line per message:
  in:  open | close | play <file.wav> | quit
  out: opened | busy | closed | error <text> (replies to open/close),
       warn <text> (a sound that couldn't be played)
WAV files must be 48 kHz, 16-bit, stereo (scripts/render-sounds.js makes them).
Uses libasound through ctypes, so it needs nothing outside the standard library.
"""

import ctypes
import sys
import threading
import wave

RATE = 48000
CHANNELS = 2
FRAME_BYTES = 4
PERIOD = RATE // 100  # 10 ms per write
LATENCY_US = 60000
SND_PCM_STREAM_PLAYBACK = 0
SND_PCM_FORMAT_S16_LE = 2
SND_PCM_ACCESS_RW_INTERLEAVED = 3
EBUSY = 16

asound = ctypes.CDLL('libasound.so.2')
asound.snd_pcm_open.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
asound.snd_pcm_set_params.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_int, ctypes.c_uint]
asound.snd_pcm_writei.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_ulong]
asound.snd_pcm_writei.restype = ctypes.c_long
asound.snd_pcm_recover.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
asound.snd_pcm_drop.argtypes = [ctypes.c_void_p]
asound.snd_pcm_close.argtypes = [ctypes.c_void_p]
asound.snd_strerror.argtypes = [ctypes.c_int]
asound.snd_strerror.restype = ctypes.c_char_p

SILENCE = bytes(PERIOD * FRAME_BYTES)
out_lock = threading.Lock()


def say(line):
    with out_lock:
        sys.stdout.write(line + '\n')
        sys.stdout.flush()


def load(path):
    with wave.open(path, 'rb') as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (RATE, CHANNELS, 2):
            raise ValueError(f'{path}: needs 48 kHz 16-bit stereo')
        return w.readframes(w.getnframes())


class Player:
    def __init__(self, device):
        self.device = device.encode()
        self.lock = threading.Lock()
        self.pcm = None
        self.thread = None
        self.running = False
        self.sound = b''  # what's left of the sound playing now
        self.cache = {}

    def open(self):
        if self.pcm:
            say('opened')
            return
        pcm = ctypes.c_void_p()
        err = asound.snd_pcm_open(ctypes.byref(pcm), self.device, SND_PCM_STREAM_PLAYBACK, 0)
        if err == -EBUSY:
            say('busy')
            return
        if err >= 0:
            err = asound.snd_pcm_set_params(pcm, SND_PCM_FORMAT_S16_LE, SND_PCM_ACCESS_RW_INTERLEAVED,
                                            CHANNELS, RATE, 1, LATENCY_US)
            if err < 0:
                asound.snd_pcm_close(pcm)
        if err < 0:
            say('error ' + asound.snd_strerror(err).decode())
            return
        self.pcm = pcm
        self.running = True
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()
        say('opened')

    def close(self):
        if self.pcm:
            self.running = False
            self.thread.join()
            asound.snd_pcm_drop(self.pcm)
            asound.snd_pcm_close(self.pcm)
            self.pcm = None
            self.sound = b''
        say('closed')

    def play(self, path):
        if not self.pcm:
            return
        try:
            data = self.cache.get(path) or self.cache.setdefault(path, load(path))
        except (OSError, ValueError, wave.Error) as e:
            say(f'warn {e}')
            return
        with self.lock:
            self.sound = data  # a new sound cuts off the previous one

    def loop(self):
        size = PERIOD * FRAME_BYTES
        while self.running:
            with self.lock:
                chunk, self.sound = self.sound[:size], self.sound[size:]
            if len(chunk) < size:
                chunk += SILENCE[len(chunk):]
            # Blocks until there's room, so the device's clock paces the loop.
            n = asound.snd_pcm_writei(self.pcm, chunk, PERIOD)
            if n < 0:
                asound.snd_pcm_recover(self.pcm, n, 1)


def main():
    player = Player(sys.argv[1] if len(sys.argv) > 1 else 'default')
    for line in sys.stdin:
        cmd, _, arg = line.strip().partition(' ')
        if cmd == 'open':
            player.open()
        elif cmd == 'close':
            player.close()
        elif cmd == 'play':
            player.play(arg)
        elif cmd == 'quit':
            break
    player.close()


if __name__ == '__main__':
    main()
