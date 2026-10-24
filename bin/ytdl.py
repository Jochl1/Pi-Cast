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
"""
import json
import os
import sys


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
    audio = next((f for f in formats if f is not video and f.get('acodec') not in (None, 'none')), None)
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
        worker(args[0])
    else:
        import yt_dlp
        sys.argv = ['yt-dlp', *args]
        sys.exit(yt_dlp.main())
