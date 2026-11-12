// -----------------------------------------------------------------------------
// What the integration knows of the mesh: its nodes, the channels of the node
// it is connected to (TCP), the last text messages. Fed with the events of
// src/meshtastic.js, whatever the transport; never touches Gladys.
// -----------------------------------------------------------------------------

import { BROADCAST, nodeId } from './meshtastic.js';

export const MAX_NODES = 500;
export const MAX_MESSAGES = 20;
// A node clock ahead of ours by more than this is not believed.
const CLOCK_SKEW_MS = 5 * 60_000;

export class Mesh {
  constructor() {
    /** @type {Map<number, object>} */
    this.nodes = new Map();
    /** @type {Map<number, { name: string, role: number }>} */
    this.channels = new Map();
    this.messages = [];
    this.myNum = null;
  }

  #node(num) {
    let node = this.nodes.get(num);
    if (!node) {
      node = {
        num,
        id: nodeId(num),
        longName: '',
        shortName: '',
        hwModel: null,
        lastHeard: null,
        snr: null,
        hopsAway: null,
        battery: null,
        powered: false,
        voltage: null,
        position: null,
        temperature: null,
        humidity: null,
        pressure: null,
      };
      this.nodes.set(num, node);
    }
    return node;
  }

  #user(node, user) {
    if (!user) {
      return;
    }
    if (user.longName) {
      node.longName = user.longName;
    }
    if (user.shortName) {
      node.shortName = user.shortName;
    }
    if (user.hwModel !== undefined) {
      node.hwModel = user.hwModel;
    }
  }

  #metrics(node, metrics) {
    if (!metrics) {
      return;
    }
    if (metrics.battery !== undefined) {
      node.battery = metrics.battery;
      node.powered = metrics.powered;
    }
    if (metrics.voltage !== undefined) {
      node.voltage = metrics.voltage;
    }
  }

  #environment(node, environment) {
    for (const key of ['temperature', 'humidity', 'pressure']) {
      if (environment?.[key] !== undefined) {
        node[key] = environment[key];
      }
    }
  }

  /**
   * @param {object} event from src/meshtastic.js
   * @param {number} now ms
   * @returns {{ node?: object, isNew?: boolean, message?: object }}
   */
  apply(event, now) {
    switch (event.kind) {
      case 'my_info':
        this.myNum = event.num;
        return {};
      case 'channel':
        this.channels.set(event.index, { name: event.name, role: event.role });
        return {};
      case 'node': {
        const isNew = !this.nodes.has(event.num);
        const node = this.#node(event.num);
        this.#user(node, event.user);
        this.#metrics(node, event.metrics);
        if (event.position) {
          node.position = event.position;
        }
        if (event.hopsAway !== undefined) {
          node.hopsAway = event.hopsAway;
        }
        if (event.snr !== undefined && event.snr !== 0 && (event.hopsAway ?? 0) === 0) {
          node.snr = event.snr;
        }
        const heard = event.lastHeard * 1000;
        if (heard > 0 && heard <= now + CLOCK_SKEW_MS) {
          node.lastHeard = Math.max(node.lastHeard ?? 0, Math.min(heard, now));
        }
        return { node, isNew };
      }
      case 'packet':
        return this.#packet(event, now);
      default:
        return {};
    }
  }

  #packet(event, now) {
    if (event.from === 0 || event.from === BROADCAST) {
      return {};
    }
    const isNew = !this.nodes.has(event.from);
    const node = this.#node(event.from);
    node.lastHeard = now;
    if (event.hopsAway !== undefined) {
      node.hopsAway = event.hopsAway;
    }
    // The SNR is the one of the last hop: only a direct reception tells the
    // link to this node.
    if (event.snr !== undefined && event.hopsAway === 0 && !event.viaMqtt) {
      node.snr = event.snr;
    }
    let message;
    switch (event.port) {
      case 'nodeinfo':
        this.#user(node, event.data);
        break;
      case 'position':
        if (event.data) {
          node.position = event.data;
        }
        break;
      case 'telemetry':
        this.#metrics(node, event.data.device);
        this.#environment(node, event.data.environment);
        break;
      case 'text':
        if (event.data.trim() !== '') {
          message = {
            from: event.from,
            to: event.to,
            channel: event.channel,
            direct: event.to !== BROADCAST,
            text: event.data,
            at: now,
          };
          this.messages.push(message);
          this.messages.splice(0, Math.max(0, this.messages.length - MAX_MESSAGES));
        }
        break;
      default:
        break;
    }
    return { node, isNew, message };
  }

  /**
   * Forgets the nodes heard least recently past MAX_NODES (a public broker or
   * a big mesh), never a kept one.
   * @param {(num: number) => boolean} keep
   */
  prune(keep) {
    if (this.nodes.size <= MAX_NODES) {
      return;
    }
    const removable = [...this.nodes.values()]
      .filter((node) => !keep(node.num) && node.num !== this.myNum)
      .sort((a, b) => (a.lastHeard ?? 0) - (b.lastHeard ?? 0));
    for (const node of removable.slice(0, this.nodes.size - MAX_NODES)) {
      this.nodes.delete(node.num);
    }
  }

  displayName(num) {
    const node = this.nodes.get(num);
    return node?.longName || node?.shortName || nodeId(num);
  }
}

/** LoRa SNR (dB) -> the 0..5 scale of the Gladys signal feature. */
export function signalBars(snr) {
  if (snr === null || snr === undefined) {
    return null;
  }
  if (snr >= 5) {
    return 5;
  }
  if (snr >= 0) {
    return 4;
  }
  if (snr >= -5) {
    return 3;
  }
  if (snr >= -10) {
    return 2;
  }
  return 1;
}

/** Great-circle distance, km. */
export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
