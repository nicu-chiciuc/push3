// WebSocket link to the local Node bridge (server.mjs), which owns the Push's USB connection.
export class Bridge extends EventTarget {
  constructor() {
    super();
    this.status = { bridge: false, midi: false, display: false };
    this.sent = 0;
    this.connect();
  }

  connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.ws = ws; this.#status({ bridge: true }); };
    ws.onclose = () => {
      this.ws = null;
      this.#status({ bridge: false, midi: false, display: false });
      setTimeout(() => this.connect(), 1000);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.t === 'midi') this.dispatchEvent(new CustomEvent('midi', { detail: msg }));
      else if (msg.t === 'status') this.#status({ midi: msg.midi, display: msg.display });
    };
  }

  #status(patch) {
    const before = { ...this.status };
    Object.assign(this.status, patch);
    this.dispatchEvent(new CustomEvent('status', { detail: { now: this.status, before } }));
  }

  get ready() { return this.ws?.readyState === 1; }

  sendMidi(batch, port = 'user') {
    if (!this.ready || batch.length === 0) return;
    this.sent += batch.length;
    this.ws.send(JSON.stringify({ t: 'midi', batch, port }));
  }

  /** 960×160 RGB565 pixels */
  sendFrame(u16) {
    // Skip a frame rather than queueing if the socket is backed up.
    if (this.ready && this.ws.bufferedAmount < 1_000_000) this.ws.send(u16.buffer);
  }

  reconnectDevice() { if (this.ready) this.ws.send(JSON.stringify({ t: 'reconnect' })); }
}
