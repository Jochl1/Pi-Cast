import { EventEmitter } from 'node:events';
import YouTubeCastReceiver from 'yt-cast-receiver';
import CastPlayer from './castPlayer.js';

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
