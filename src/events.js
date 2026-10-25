/**
 * Server-Sent Events hub for /api/events. The web app gets live status and
 * settings without polling. A game night player connects with
 * ?player=<token>, so each phone can get its own view (sendEach).
 */
export default class Events {
  constructor() {
    this.clients = new Map(); // res -> player token or null
    this.snapshot = () => ({});
    // Keeps idle connections open through proxies and lets dead ones error out.
    setInterval(() => this.#write(':\n\n'), 25000).unref();
  }

  /** `fn(player)` returns { eventName: data } sent to a client when it connects. */
  setSnapshot(fn) {
    this.snapshot = fn;
  }

  handler() {
    return (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      const player = typeof req.query.player === 'string' ? req.query.player : null;
      for (const [event, data] of Object.entries(this.snapshot(player))) {
        res.write(format(event, data));
      }
      this.clients.set(res, player);
      req.on('close', () => this.clients.delete(res));
    };
  }

  send(event, data) {
    this.#write(format(event, data));
  }

  /** Sends each client its own data: `fn(player)` with the client's player token. */
  sendEach(event, fn) {
    for (const [res, player] of this.clients) res.write(format(event, fn(player)));
  }

  #write(chunk) {
    for (const res of this.clients.keys()) res.write(chunk);
  }
}

const format = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
