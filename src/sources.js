const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'music.youtube.com'];

/** Decides how a URL gets played: 'twitch' via streamlink, everything else via mpv + yt-dlp. */
export function classify(url) {
  const host = new URL(url).hostname.replace(/^(www|m)\./, '');
  if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) return 'twitch';
  if (YOUTUBE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'youtube';
  return 'generic';
}

/** Pulls the first http(s) URL out of shared text like "Check this out https://...". */
export function extractUrl(text) {
  const match = String(text ?? '').match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}
