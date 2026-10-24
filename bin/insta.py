"""Instagram Reels for Pi-Cast, through instagrapi (Instagram's private app API).

  insta.py <session file>

Stays running: one JSON request per line on stdin, {"id", "op", ...}, one JSON
reply per line on stdout, {"id", "ok", ...} or {"id", "ok": false, "error",
"message"}. Lines without an id are events: {"ready", "user"}, and
{"event": "code", "method"} while a login waits for a security code.

  status                       {"user"}: the logged-in username or null
  login {username, password}   waits for a "code" request if Instagram asks
  login {sessionid}            the sessionid cookie of instagram.com in a browser
  code {code}                  answers the waiting login (null cancels it)
  logout
  reels {fresh}                the next page of the Reels tab; fresh = from the top
  like {media, on}

The session (cookies and device, never the password) is kept in the session
file. Calls run one at a time on a single thread, so Instagram sees one
client making one request after another, with instagrapi's random delays.
"""
import json
import os
import queue
import sys
import threading
import time
from urllib.parse import unquote

CODE_WAIT_S = 300
CAPTION_CHARS = 400
# Reels are shown upright on a 1080p screen: the smallest version at least this tall.
WANT_HEIGHT = 1080

out = sys.stdout
sys.stdout = sys.stderr  # nothing but replies on the real stdout
write_lock = threading.Lock()


def send(msg):
    with write_lock:
        out.write(json.dumps(msg) + '\n')
        out.flush()


class Failure(Exception):
    """An error with a code the app translates (badPassword, loggedOut, ...)."""

    def __init__(self, code, message=''):
        super().__init__(message or code)
        self.code = code


class Session:
    def __init__(self, path):
        self.path = path
        self.client = None
        self.user = None
        self.cursor = ''
        self.codes = queue.Queue()
        try:
            with open(path, encoding='utf-8') as f:
                saved = json.load(f)
            self.client = self.new_client(saved['settings'])
            self.user = saved['username']
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f'instagram session unreadable: {e}', file=sys.stderr, flush=True)

    def new_client(self, settings=None):
        from instagrapi import Client
        cl = Client(settings or {})
        cl.delay_range = [1, 3]
        cl.challenge_code_handler = lambda username, choice: self.wait_code(getattr(choice, 'name', str(choice)).lower())
        cl.change_password_handler = lambda username: self.fail('challenge')
        if not settings:
            cl.set_locale('de_DE')
            cl.set_country('DE')
            cl.set_timezone_offset(-time.timezone)
        return cl

    def fail(self, code):
        raise Failure(code)

    def wait_code(self, method):
        while not self.codes.empty():
            self.codes.get_nowait()
        send({'event': 'code', 'method': method})
        try:
            code = self.codes.get(timeout=CODE_WAIT_S)
        except queue.Empty:
            code = None
        send({'event': 'code', 'method': None})
        if not code:
            raise Failure('cancelled')
        return code

    def save(self):
        tmp = f'{self.path}.tmp'
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump({'username': self.user, 'settings': self.client.get_settings()}, f)
        os.replace(tmp, self.path)

    def forget(self):
        self.client = None
        self.user = None
        self.cursor = ''
        try:
            os.remove(self.path)
        except FileNotFoundError:
            pass

    # --- requests ---

    def status(self, req):
        return {'user': self.user}

    def login(self, req):
        from instagrapi.exceptions import TwoFactorRequired
        cl = self.new_client()
        if req.get('sessionid'):
            # Instagram's password login often fails for instagrapi ("your app is
            # out of date"); a browser's session skips it.
            sessionid = unquote(req['sessionid']).strip().strip('"')
            try:
                cl.login_by_sessionid(sessionid)
            except AssertionError:
                raise Failure('badSession')
            username = cl.username
        else:
            username = req['username'].strip().lstrip('@')
            try:
                cl.login(username, req['password'])
            except TwoFactorRequired:
                cl.login(username, req['password'], verification_code=self.wait_code('2fa'))
        self.client = cl
        self.user = cl.username or username
        self.cursor = ''
        self.save()
        return {'user': self.user}

    def logout(self, req):
        if self.client:
            try:
                self.client.logout()
            except Exception:
                pass  # the session is dropped either way
        self.forget()
        return {'user': None}

    def reels(self, req):
        if not self.client:
            raise Failure('loggedOut')
        if req.get('fresh'):
            self.cursor = ''
        result = self.client.private_request('clips/discover/', data=' ', params={'max_id': self.cursor})
        paging = result.get('paging_info') or {}
        self.cursor = (paging.get('max_id') or '') if paging.get('more_available') else ''
        self.save()  # instagrapi refreshes cookies and headers as it goes
        items = result.get('items') or result.get('items_with_ads') or []
        reels = [r for r in (reel(i.get('media')) for i in items) if r]
        return {'reels': reels, 'more': bool(self.cursor)}

    def like(self, req):
        if not self.client:
            raise Failure('loggedOut')
        if req.get('on', True):
            self.client.media_like(req['media'])
        else:
            self.client.media_unlike(req['media'])
        return {}


def reel(media):
    """What the TV needs from a feed item; None for ads and anything that isn't a video."""
    if not media or media.get('media_type') != 2 or not media.get('video_versions'):
        return None
    if media.get('ad_id') or media.get('is_paid_partnership_ad'):
        return None
    versions = sorted(media['video_versions'], key=lambda v: v.get('height', 0))
    video = next((v for v in versions if v.get('height', 0) >= WANT_HEIGHT), versions[-1])
    caption = (media.get('caption') or {}).get('text') or ''
    images = (media.get('image_versions2') or {}).get('candidates') or []
    return {
        'id': media['id'],
        'code': media.get('code'),
        'url': video['url'],
        'width': video.get('width'),
        'height': video.get('height'),
        'duration': media.get('video_duration'),
        'user': (media.get('user') or {}).get('username'),
        'caption': caption[:CAPTION_CHARS],
        'likes': media.get('like_count'),
        'liked': bool(media.get('has_liked')),
        'thumbnail': images[0]['url'] if images else None,
    }


def error_code(e):
    from instagrapi import exceptions as x
    kinds = [
        ('badPassword', (x.BadPassword, x.UserNotFound)),
        ('upgrade', (x.ClientNeedsUpgradeError,)),
        ('loggedOut', (x.LoginRequired,)),
        ('wait', (x.PleaseWaitFewMinutes, x.RateLimitError, x.ClientThrottledError)),
        ('challenge', (x.ChallengeError, x.ChallengeRequired, x.TwoFactorRequired)),
    ]
    for code, types in kinds:
        if isinstance(e, types):
            return code
    return 'error'


def run(session, jobs):
    while (req := jobs.get()) is not None:
        try:
            reply = {'id': req['id'], 'ok': True, **getattr(session, req['op'])(req)}
        except Failure as e:
            reply = {'id': req['id'], 'ok': False, 'error': e.code, 'message': str(e)}
        except Exception as e:  # instagrapi raises many kinds; report them all
            code = error_code(e)
            if code == 'loggedOut':
                session.forget()
            reply = {'id': req['id'], 'ok': False, 'error': code, 'message': f'{type(e).__name__}: {e}'}
        send(reply)


def main(path):
    session = Session(path)
    jobs = queue.Queue()
    thread = threading.Thread(target=run, args=(session, jobs), daemon=True)
    thread.start()
    send({'ready': True, 'user': session.user})
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        # A code answers the login that's waiting on the other thread.
        if req.get('op') == 'code':
            session.codes.put(str(req.get('code') or '').strip() or None)
            send({'id': req['id'], 'ok': True})
        else:
            jobs.put(req)
    jobs.put(None)  # stdin closed: finish what's queued
    thread.join()


if __name__ == '__main__':
    main(sys.argv[1])
