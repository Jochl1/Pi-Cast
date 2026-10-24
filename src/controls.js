/**
 * Playback controls used by the web app and the TV remote. While a YouTube-app
 * cast session owns playback, they go through the cast player so the phone
 * that's casting stays in sync.
 */
export default function createControls({ playback, cast, mpv }) {
  const castPlayer = () => (playback.owner === 'cast' ? cast.player : null);
  // With nothing playing, mpv shows the home backdrop; leave it alone.
  const idle = () => (playback.source ? null : Promise.resolve());

  const controls = {
    pause: () => idle() ?? castPlayer()?.pause() ?? mpv.pause(),
    resume: () => idle() ?? castPlayer()?.resume() ?? mpv.resume(),
    toggle: () => (mpv.props.pause ? controls.resume() : controls.pause()),
    stop: () => castPlayer()?.stop() ?? playback.stop(),

    seek: (position) => {
      const target = Math.max(0, position);
      return idle() ?? castPlayer()?.seek(target) ?? mpv.seek(target);
    },
    seekBy: (offset) => controls.seek((mpv.props['time-pos'] ?? 0) + offset),

    setVolume: ({ level, muted }) => {
      const volume = {
        level: typeof level === 'number' ? Math.max(0, Math.min(100, Math.round(level))) : Math.round(mpv.props.volume ?? 100),
        muted: typeof muted === 'boolean' ? muted : !!mpv.props.mute,
      };
      return castPlayer()?.setVolume(volume)
        ?? Promise.all([mpv.setVolume(volume.level), mpv.setMute(volume.muted)]);
    },
  };
  return controls;
}
