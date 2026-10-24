/**
 * Server-Sent Events hub for /api/events. The web app gets live status and
 * settings without polling.
 */
export default class Events {
  constructor() {
    this.clients = new Set();
    this.snapshot = () => ({});
    // Keeps idle connections open through proxies and lets dead ones error out.
    setInterval(() => this.#write(':\n\n'), 25000).unref();
  }

  /** `fn` returns { eventName: data } sent to every client when it connects. */
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
      for (const [event, data] of Object.entries(this.snapshot())) {
        res.write(format(event, data));
      }
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
    };
  }

  send(event, data) {
    this.#write(format(event, data));
  }

  #write(chunk) {
    for (const res of this.clients) res.write(chunk);
  }
}

const format = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
