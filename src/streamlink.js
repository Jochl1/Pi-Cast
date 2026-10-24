import { spawn } from 'node:child_process';

/**
 * Wraps streamlink, used for Twitch. streamlink filters Twitch's ad segments
 * out of the stream (always on since streamlink 6) and serves the result over
 * local HTTP, which mpv then plays.
 */
export default class Streamlink {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.proc = null;
  }

  /** Starts streamlink for `url` and resolves with the local URL mpv should open. */
  async open(url, quality = this.config.twitchQuality) {
    await this.close();
    const { streamlinkPath } = this.config;
    // No --player-external-http-port: a random free port avoids clashing with
    // a previous instance that hasn't released its socket yet.
    const args = [
      '--player-external-http',
      '--player-external-http-interface', '127.0.0.1',
      '--stream-segment-threads', '2',
      url,
      quality,
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
        const m = output.match(/https?:\/\/127\.0\.0\.1:\d+\/?/);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('error', (e) => {
        clearTimeout(timer);
        if (this.proc === proc) this.proc = null;
        reject(e);
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (this.proc === proc) this.proc = null;
        // No-op if we already resolved.
        const reason = output.split('\n').reverse().find((l) => /error/i.test(l)) || `exit code ${code}`;
        reject(new Error(`streamlink: ${reason.trim()}`));
      });
    });
  }

  /** Stops the running streamlink, if any, and resolves once it has exited. */
  close() {
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const kill = setTimeout(() => proc.kill('SIGKILL'), 3000);
      proc.once('exit', () => { clearTimeout(kill); resolve(); });
      proc.kill();
    });
  }
}
