// -----------------------------------------------------------------------------
// The TCP link to a Meshtastic node (Wi-Fi / Ethernet board or meshtasticd),
// port 4403: the client API stream framing of the firmware (StreamAPI):
//   0x94 0xC3 <length MSB> <length LSB> <protobuf, 512 bytes at most>
// Bytes outside a frame (debug output) are skipped until the next start.
//
// On connection we send want_config_id: the node answers with my_info, its
// node database, channels, config, then config_complete_id, and streams every
// packet it hears afterwards. A heartbeat keeps the connection open; a lost
// connection is retried every RECONNECT_MS.
//
// States reported: connected (config complete), unreachable (refused, timed
// out, closed).
// -----------------------------------------------------------------------------

import net from 'node:net';
import { randomInt } from 'node:crypto';
import {
  decodeFromRadio,
  encodeDisconnect,
  encodeHeartbeat,
  encodeWantConfig,
} from './meshtastic.js';

export const START1 = 0x94;
export const START2 = 0xc3;
export const MAX_FRAME = 512;
export const RECONNECT_MS = 15_000;
export const CONNECT_TIMEOUT_MS = 10_000;
export const HEARTBEAT_MS = 5 * 60_000;
// No config_complete within this delay: the node is busy or not Meshtastic.
export const CONFIG_TIMEOUT_MS = 60_000;

export function frame(payload) {
  const header = Buffer.from([START1, START2, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

/**
 * Accumulates bytes, yields the payloads of complete frames.
 */
export class FrameReader {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /** @returns {Buffer[]} */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames = [];
    for (;;) {
      const start = this.buffer.indexOf(START1);
      if (start < 0) {
        this.buffer = Buffer.alloc(0);
        return frames;
      }
      if (start > 0) {
        this.buffer = this.buffer.subarray(start);
      }
      if (this.buffer.length < 4) {
        return frames;
      }
      const length = (this.buffer[2] << 8) | this.buffer[3];
      if (this.buffer[1] !== START2 || length > MAX_FRAME) {
        this.buffer = this.buffer.subarray(1); // not a frame start: resync
        continue;
      }
      if (this.buffer.length < 4 + length) {
        return frames;
      }
      frames.push(Buffer.from(this.buffer.subarray(4, 4 + length)));
      this.buffer = this.buffer.subarray(4 + length);
    }
  }
}

/**
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {(event: object) => void} options.onEvent
 * @param {(state: string, detail?: string) => void} options.onState
 * @param {Function} [options.connect] test seam: net.createConnection
 */
export function createTcpClient({ host, port, onEvent, onState, connect = net.createConnection }) {
  let state = null;
  let stopped = false;
  let socket = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let configTimer = null;
  let nonce = 0;

  const setState = (next, detail) => {
    if (stopped || state === next) {
      return;
    }
    state = next;
    onState(next, detail);
  };

  const clearTimers = () => {
    clearInterval(heartbeatTimer);
    clearTimeout(configTimer);
    heartbeatTimer = null;
    configTimer = null;
  };

  const write = (payload) => {
    if (!socket || socket.destroyed) {
      throw new Error('not connected to the node');
    }
    socket.write(frame(payload));
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, RECONNECT_MS);
    reconnectTimer.unref?.();
  };

  function open() {
    if (stopped) {
      return;
    }
    const reader = new FrameReader();
    const current = connect({ host, port });
    socket = current;
    current.setNoDelay?.(true);
    current.setTimeout?.(CONNECT_TIMEOUT_MS);

    current.on('connect', () => {
      // Connected: no more idle timeout, the heartbeat takes over.
      current.setTimeout?.(0);
      nonce = randomInt(1, 0x7fffffff);
      current.write(frame(encodeWantConfig(nonce)));
      configTimer = setTimeout(() => {
        current.destroy(new Error('the node did not send its configuration'));
      }, CONFIG_TIMEOUT_MS);
      configTimer.unref?.();
      heartbeatTimer = setInterval(() => {
        try {
          write(encodeHeartbeat());
        } catch {
          // Closed meanwhile: the close handler reconnects.
        }
      }, HEARTBEAT_MS);
      heartbeatTimer.unref?.();
    });

    current.on('data', (chunk) => {
      if (stopped || socket !== current) {
        return;
      }
      for (const payload of reader.push(chunk)) {
        let event;
        try {
          event = decodeFromRadio(payload);
        } catch {
          continue; // a message we cannot decode is skipped, the stream goes on
        }
        if (!event) {
          continue;
        }
        if (event.kind === 'config_complete') {
          if (event.id !== nonce) {
            continue;
          }
          clearTimeout(configTimer);
          configTimer = null;
          onEvent(event);
          setState('connected');
          continue;
        }
        onEvent(event);
      }
    });

    current.on('timeout', () => current.destroy(new Error('connection timed out')));
    current.on('error', (err) => {
      if (socket === current) {
        setState('unreachable', err?.code ?? err?.message);
      }
    });
    current.on('close', () => {
      if (socket !== current) {
        return;
      }
      clearTimers();
      socket = null;
      setState('unreachable', 'connection closed');
      scheduleReconnect();
    });
  }

  open();

  return {
    get state() {
      return state;
    },
    /** Sends an encoded ToRadio message; throws when not connected. */
    send(payload) {
      if (state !== 'connected') {
        throw new Error('not connected to the node');
      }
      write(payload);
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      clearTimers();
      if (socket && !socket.destroyed) {
        // Tells the node to free its single API slot at once, then closes.
        socket.end(frame(encodeDisconnect()));
      }
      socket = null;
    },
  };
}
