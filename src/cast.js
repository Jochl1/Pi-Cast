import { EventEmitter } from 'node:events';
import YouTubeCastReceiver, { RESET_PLAYER_ON_DISCONNECT_POLICIES } from 'yt-cast-receiver';
import Innertube from 'youtubei.js'; // yt-cast-receiver's own copy (only user)
import CastPlayer from './castPlayer.js';

// yt-cast-receiver creates a fresh Innertube session whenever a phone connects
// after a disconnect, and by default that downloads and parses YouTube's ~4 MB
// player script, which takes ~25 s on the Pi and delays every cast. The
// receiver only uses Innertube for /next and /player requests (titles, autoplay,
// watch history), never for deciphering streams (yt-dlp does that), so skip it.
const createInnertube = Innertube.create.bind(Innertube);
Innertube.create = (config = {}) => createInnertube({ retrieve_player: false, ...config });

/**
 * Owns the YouTube cast receiver. The device name is fixed when the receiver
 * is created, so renaming means stopping it and starting a new one.
 *
 * Events: 'senderConnect' (name), 'senderDisconnect' (name), 'pairingCode' (code), 'change'
 */
export default class Cast extends EventEmitter {
  constructor({ playback, mpv, log, dataStore, dialPort, logLevel }) {
    super();
    Object.assign(this, { playback, mpv, log, dataStore, dialPort, logLevel });
    this.receiver = null;
    this.player = null;
    this.pairing = null;
    this.pairingCode = null;
  }

  async start(name) {
    const player = new CastPlayer(this.playback, this.mpv, this.log);
    const receiver = new YouTubeCastReceiver(player, {
      device: { name, screenName: name, brand: 'pi-cast', model: 'Raspberry Pi' },
      dial: { port: this.dialPort },
      dataStore: this.dataStore,
      logLevel: this.logLevel,
    });
    // A phone that locks or backgrounds the YouTube app (e.g. after pausing)
    // drops off "implicitly"; keep the video then, like a real TV does, and
    // only stop when the phone disconnects on purpose.
    receiver.setResetPlayerOnDisconnectPolicy(RESET_PLAYER_ON_DISCONNECT_POLICIES.ALL_EXPLICITLY_DISCONNECTED);
    receiver.on('senderConnect', (s) => {
      this.log.info(`cast: ${s.name} connected`);
      this.emit('senderConnect', s.name);
      this.emit('change');
    });
    receiver.on('senderDisconnect', (s) => {
      this.log.info(`cast: ${s.name} disconnected`);
      this.emit('senderDisconnect', s.name);
      this.emit('change');
    });
    receiver.on('error', (e) => this.log.error('cast receiver error:', e.message));
    receiver.on('terminate', (e) => {
      this.log.error('cast receiver terminated:', e.message);
      process.exit(1); // systemd restarts us
    });

    // "Link with TV code" pairing, shown on the idle screen and in the web app.
    const pairing = receiver.getPairingCodeRequestService();
    pairing.on('response', (code) => {
      this.pairingCode = code.replace(/(\d{3})(?=\d)/g, '$1 ');
      this.emit('pairingCode', this.pairingCode);
      this.emit('change');
    });
    pairing.on('error', (e) => this.log.warn('pairing code request failed:', e.message));

    await receiver.start();
    pairing.start();
    Object.assign(this, { receiver, player, pairing });
    this.log.info(`cast receiver "${name}" started`);
  }

  async stop() {
    const { receiver, player, pairing } = this;
    if (!receiver) return;
    this.receiver = this.player = this.pairing = null;
    pairing.stop();
    player.dispose();
    await receiver.stop().catch((e) => this.log.warn('cast receiver stop:', e.message));
  }

  async restart(name) {
    // A rename while casting would orphan the session; let the phone reconnect.
    if (this.playback.owner === 'cast') await this.playback.stop().catch(() => {});
    await this.stop();
    this.pairingCode = null;
    this.emit('change');
    await this.start(name);
  }

  senders() {
    return this.receiver?.getConnectedSenders().map((s) => s.name) ?? [];
  }
}
