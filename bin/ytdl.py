"""yt-dlp for Pi-Cast, with yt-dlp's preprocessed-player cache turned on.

For every video, yt-dlp hands YouTube's whole player script (~4 MB) to Node
to solve its JS challenge. Parsing it takes ~20 s on a Pi 3; with the cache,
the parsed player is reused and solving takes ~1 s. yt-dlp keeps this cache
off because it never deletes old players, so only the newest two are kept.
If yt-dlp changes its internals, this quietly runs plain yt-dlp.

  ytdl.py cli [yt-dlp args]   yt-dlp's command line (for mpv's ytdl hook)
  ytdl.py worker <format>     stays running and resolves URLs: one JSON
                              request per line on stdin, {"id", "url"}, one
                              JSON reply per line on stdout. Saves Python's
                              start-up (~6 s on a Pi 3) on every video.
                              It also keeps one Node running for the JS
                              challenges (bin/jsc.js), which saves 4-5 s more.
"""
import hashlib
import inspect
import json
import os
import select
import subprocess
import sys

JSC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jsc.js')
# Parsing a new raw player takes ~20 s at 600 MHz.
SOLVE_TIMEOUT = 90


def enable_player_cache():
    try:
        from yt_dlp.extractor.youtube.jsc._builtin import ejs
        if not hasattr(ejs.EJSBaseJCP, '_ENABLE_PREPROCESSED_PLAYER_CACHE'):
            return
        ejs.EJSBaseJCP._ENABLE_PREPROCESSED_PLAYER_CACHE = True
        # yt-dlp's default cache dir (we never pass --cache-dir).
        base = os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache')
        d = os.path.join(base, 'yt-dlp', ejs.EJSBaseJCP._CACHE_SECTION)
        players = sorted((e for e in os.scandir(d) if e.name.startswith('player')),
                         key=lambda e: e.stat().st_mtime, reverse=True)
        for e in players[2:]:
            os.remove(e.path)
    except Exception:
        pass


class WarmSolver:
    """bin/jsc.js, started on the first challenge and kept for the worker's life."""

    def __init__(self):
        self.proc = None
        self.keys = set()  # players this jsc.js has

    def solve(self, jcp, player, preprocessed, requests):
        if not self.proc or self.proc.poll() is not None:
            self.start(jcp)
        key = hashlib.sha1(player.encode()).hexdigest()
        msg = {'key': key, 'requests': requests}
        if key not in self.keys:
            msg.update(player=player, preprocessed=preprocessed)
        self.proc.stdin.write(json.dumps(msg) + '\n')
        self.proc.stdin.flush()
        if not select.select([self.proc.stdout], [], [], SOLVE_TIMEOUT)[0]:
            raise TimeoutError('timed out')
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError('exited')
        reply = json.loads(line)
        if reply['type'] == 'error':
            raise RuntimeError(reply['error'])
        self.keys.add(key)
        return line

    def start(self, jcp):
        self.stop()
        node = jcp.runtime_info
        # The same sandbox as yt-dlp's own Node (flag renamed in 23.5).
        flags = (['--experimental-permission', '--no-warnings=ExperimentalWarning']
                 if node.version_tuple < (23, 5, 0) else ['--permission'])
        self.proc = subprocess.Popen([node.path, *flags, JSC], text=True,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        setup = f'{jcp._lib_script.code}\nObject.assign(globalThis, lib);\n{jcp._core_script.code}'
        self.proc.stdin.write(json.dumps({'setup': setup}) + '\n')
        self.proc.stdin.flush()

    def stop(self):
        if self.proc:
            self.proc.kill()
            self.proc = None


def enable_warm_solver():
    """Routes yt-dlp's Node challenges through WarmSolver, if yt-dlp's internals still match."""
    try:
        from yt_dlp.extractor.youtube.jsc._builtin import ejs
        from yt_dlp.extractor.youtube.jsc._builtin.node import NodeJCP
        bulk = inspect.getsource(ejs.EJSBaseJCP._real_bulk_solve)
        if 'stdin = self._construct_stdin(' not in bulk or 'self._run_js_runtime(stdin)' not in bulk:
            return
        construct, run = NodeJCP._construct_stdin, NodeJCP._run_js_runtime
    except Exception:
        return
    solver = WarmSolver()

    def warm_construct(self, player, preprocessed, requests):
        return player, preprocessed, requests

    def warm_run(self, stdin):
        player, preprocessed, requests = stdin
        try:
            return solver.solve(self, player, preprocessed, [
                {'type': r.type.value, 'challenges': r.input.challenges} for r in requests])
        except Exception as e:
            self.logger.warning(f'Warm challenge solver failed ({e}), using a fresh node')
            solver.stop()
            return run(self, construct(self, player, preprocessed, requests))

    NodeJCP._construct_stdin = warm_construct
    NodeJCP._run_js_runtime = warm_run


class StderrLogger:
    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        print(msg, file=sys.stderr, flush=True)

    def error(self, msg):
        print(msg, file=sys.stderr, flush=True)


def stream(fmt):
    return {'url': fmt['url'], 'headers': fmt.get('http_headers') or {}}


def resolve(ydl, url):
    info = ydl.extract_info(url, download=False)
    if info.get('_type') == 'playlist':
        raise ValueError('playlists are not supported')
    formats = info.get('requested_formats') or [info]
    video = next((f for f in formats if f.get('vcodec') not in (None, 'none')), formats[0])
    # Not `acodec` set: live streams' audio has none (yt-dlp's "unknown").
    audio = next((f for f in formats if f is not video and f.get('acodec') != 'none'), None)
    return {
        'title': info.get('title'),
        'duration': info.get('duration'),
        'live': bool(info.get('is_live')),
        'height': video.get('height'),
        'video': stream(video),
        'audio': stream(audio) if audio else None,
    }


def worker(fmt):
    from yt_dlp import YoutubeDL
    out = sys.stdout
    sys.stdout = sys.stderr  # nothing but replies on the real stdout
    ydl = YoutubeDL({
        'format': fmt,
        'noplaylist': True,
        'js_runtimes': {'node': {}},
        'logger': StderrLogger(),
        'quiet': True,
        'no_warnings': False,
        'noprogress': True,
    })
    out.write(json.dumps({'ready': True}) + '\n')
    out.flush()
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            reply = {'id': req['id'], 'ok': True, **resolve(ydl, req['url'])}
        except Exception as e:  # yt-dlp raises many kinds; report them all
            reply = {'id': req['id'], 'ok': False, 'error': str(e)}
        out.write(json.dumps(reply) + '\n')
        out.flush()


if __name__ == '__main__':
    mode, args = sys.argv[1], sys.argv[2:]
    enable_player_cache()
    if mode == 'worker':
        enable_warm_solver()
        worker(args[0])
    else:
        import yt_dlp
        sys.argv = ['yt-dlp', *args]
        sys.exit(yt_dlp.main())
