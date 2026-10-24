import { spawn } from 'node:child_process';

/**
 * Wraps streamlink, used for Twitch. streamlink filters Twitch's ad segments
 * out of the stream (--twitch-disable-ads) and serves the result over local
 * HTTP, which mpv then plays.
 */
export default class Streamlink {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.proc = null;
  }

  /** Starts streamlink for `url` and resolves with the local URL mpv should open. */
  open(url) {
    this.close();
    const { streamlinkPath, streamlinkPort, twitchQuality } = this.config;
    const args = [
      '--player-external-http',
      '--player-external-http-interface', '127.0.0.1',
      '--player-external-http-port', String(streamlinkPort),
      '--twitch-disable-ads',
      '--stream-segment-threads', '2',
      url,
      twitchQuality,
    ];
    this.log.info('starting streamlink for', url);
    const proc = spawn(streamlinkPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;

    return new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => {
        reject(new Error('streamlink did not start in time'));
        this.close();
      }, 20000);
      const onData = (d) => {
        const text = d.toString();
        output += text;
        this.log.debug('[streamlink]', text.trim());
        if (/https?:\/\/127\.0\.0\.1:\d+/.test(output)) {
          clearTimeout(timer);
          resolve(`http://127.0.0.1:${streamlinkPort}/`);
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', (e) => { clearTimeout(timer); reject(e); });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (this.proc === proc) this.proc = null;
        // No-op if we already resolved.
        const reason = output.split('\n').reverse().find((l) => /error/i.test(l)) || `exit code ${code}`;
        reject(new Error(`streamlink: ${reason.trim()}`));
      });
    });
  }

  close() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
