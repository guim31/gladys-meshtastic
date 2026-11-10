// -----------------------------------------------------------------------------
// The hub: the link to the mesh (TCP to a node, or MQTT), the mesh model, and
// everything Gladys sees from them — discovered nodes, states, the
// message_received scene event, connection status — plus sending a text.
//
// States are published when a packet changes a node, and every tickMs for
// what time alone changes (online, last heard), changed values only
// (publishChangedStates, with a heartbeat so a steady value never looks
// stale). After a (re)connection, a node not heard yet is not marked offline
// before the offline delay: a restart must not mark the whole mesh offline.
// -----------------------------------------------------------------------------

import { randomInt } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, safeAddress } from './config.js';
import { MAX_HOPS, buildNodeDevice, featureKeys, nodeIds, nodeNumOf } from './devices.js';
import { createIssueLog } from './issues.js';
import {
  BROADCAST,
  clipText,
  downlinkTopic,
  encodeSendText,
  jsonSendText,
  parseJsonMessage,
} from './meshtastic.js';
import { createClient } from './mqtt.js';
import { Mesh, distanceKm, signalBars } from './nodes.js';
import { createTcpClient } from './tcp.js';
import { CHECK_TEXT, MESSAGES, SEND_TEXT, formatHeard, pick } from './texts.js';

const logger = createLogger({ name: 'meshtastic-hub' });

export const WIDGET_KEY = 'mesh';
export const TRIGGER = {
  MESSAGE_RECEIVED: 'message_received',
};

export const DEFAULT_TIMINGS = {
  tickMs: 30_000,
  // A discovery list that changed is sent again after this quiet time (the
  // node database of a TCP node arrives node by node).
  discoveryDelayMs: 5_000,
  // A steady state is published again after that long.
  heartbeatMs: 6 * 60 * 60_000,
  // A text we sent coming back from the MQTT gateway is not a received one.
  echoMs: 2 * 60_000,
  // A packet already seen (rebroadcast by a relay, published by several
  // gateways or retried) within this window is a duplicate.
  duplicateMs: 10 * 60_000,
};
export const MAX_DISCOVERED = 100;
// The settings that need a new connection when they change.
const LINK_KEYS = [
  'connection',
  'host',
  'port',
  'broker_url',
  'username',
  'password',
  'tls_insecure',
  'topic_root',
];

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

export class Hub {
  /**
   * @param {object} options
   * @param {object} options.gladys
   * @param {() => number} [options.now]
   * @param {Function} [options.connectMqtt] test seam: mqtt.connect
   * @param {Function} [options.connectTcp] test seam: net.createConnection
   * @param {() => Promise<{ clientId: string }>} options.loadClientId
   * @param {object} [options.timings]
   */
  constructor({ gladys, now = () => Date.now(), connectMqtt, connectTcp, loadClientId, timings }) {
    this.gladys = gladys;
    this.now = now;
    this.connectMqtt = connectMqtt;
    this.connectTcp = connectTcp;
    this.loadClientId = loadClientId;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.issues = createIssueLog(logger);
    this.config = null;
    this.link = null;
    this.mesh = new Mesh();
    this.home = null;
    this.discoveryKey = '';
    this.discoveryTimer = null;
    this.tickTimer = null;
    this.generation = 0;
    this.connectedAt = null;
    // MQTT: the topic prefix and the gateway last heard, for sending.
    this.gateway = null;
    this.sent = [];
    /** @type {Map<string, number>} `from:id` -> when first seen */
    this.seen = new Map();
  }

  // --- lifecycle --------------------------------------------------------------

  async configure(config) {
    const generation = ++this.generation;
    const previous = this.config;
    this.config = config;
    const sameLink = previous && LINK_KEYS.every((key) => previous[key] === config[key]);
    if (sameLink && this.link) {
      // Only the language or the offline delay changed.
      this.discoveryKey = '';
      this.scheduleDiscovery();
      await this.tick();
      return;
    }
    this.#stopLink();
    this.mesh = new Mesh();
    this.discoveryKey = '';
    this.connectedAt = null;
    this.gateway = null;
    this.seen.clear();
    if (!isConfigured(config)) {
      await this.#status(false, MESSAGES.notConfigured);
      return;
    }
    const address = safeAddress(config);
    if (config.connection === 'tcp') {
      logger.info(`Connecting to the Meshtastic node ${address}`);
      this.link = createTcpClient({
        host: config.host,
        port: config.port,
        onEvent: (event) => this.onEvent(event),
        onState: (state, detail) => this.onLinkState(state, detail),
        ...(this.connectTcp ? { connect: this.connectTcp } : {}),
      });
    } else {
      const { clientId } = await this.loadClientId();
      if (generation !== this.generation) {
        return;
      }
      logger.info(`Connecting to the MQTT broker ${address}`);
      this.link = createClient({
        url: config.broker_url,
        username: config.username,
        password: config.password,
        clientId,
        tlsInsecure: config.tls_insecure,
        topics: [`${config.topic_root}/#`],
        onMessage: (topic, payload) => this.onMqttMessage(topic, payload),
        onState: (state, detail) => this.onLinkState(state, detail),
        ...(this.connectMqtt ? { connect: this.connectMqtt } : {}),
      });
    }
    this.#startTick();
  }

  stop() {
    this.generation += 1;
    this.#stopLink();
    clearTimeout(this.discoveryTimer);
    this.discoveryTimer = null;
  }

  #stopLink() {
    this.link?.stop();
    this.link = null;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  #startTick() {
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => {
      this.tick().catch((err) => logger.error(`Update failed: ${err.message}`));
    }, this.timings.tickMs);
    this.tickTimer.unref?.();
  }

  async #status(connected, message) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  async onLinkState(state, detail) {
    const address = safeAddress(this.config);
    if (state === 'connected') {
      this.connectedAt = this.now();
      logger.info(`Connected to ${address}`);
      await this.#status(true);
      await this.loadHome();
      this.scheduleDiscovery();
      await this.tick();
      return;
    }
    logger.warn(`${address}: ${state} (${detail ?? 'no detail'})`);
    const message =
      state === 'refused'
        ? MESSAGES.refused
        : this.config.connection === 'tcp'
          ? MESSAGES.nodeUnreachable
          : MESSAGES.unreachable;
    await this.#status(false, message);
  }

  /** The first located Gladys house, for the distance feature. */
  async loadHome() {
    try {
      const houses = await this.gladys.getHouses();
      const located = (houses ?? []).find(
        (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude),
      );
      this.home = located ? { latitude: located.latitude, longitude: located.longitude } : null;
    } catch (err) {
      logger.debug(`Houses not read (${err.message})`);
    }
  }

  // --- incoming ---------------------------------------------------------------

  onMqttMessage(topic, payload) {
    const event = parseJsonMessage(topic, payload);
    if (!event) {
      return;
    }
    if (event.gateway !== null) {
      this.gateway = { num: event.gateway, prefix: event.prefix };
    }
    this.onEvent(event);
  }

  onEvent(event) {
    const now = this.now();
    if (event.kind === 'packet' && this.#isDuplicate(event, now)) {
      return;
    }
    if (event.kind === 'packet' && event.port === 'text' && this.#isEcho(event, now)) {
      return;
    }
    const before = event.kind === 'packet' || event.kind === 'node' ? this.#shape(event) : null;
    const { node, message } = this.mesh.apply(event, now);
    if (event.kind === 'config_complete') {
      // The node we are connected to is alive: heard now.
      const own = this.mesh.nodes.get(this.mesh.myNum);
      if (own) {
        own.lastHeard = now;
      }
    }
    if (!node) {
      return;
    }
    if (before !== this.#shape(event)) {
      this.scheduleDiscovery();
    }
    if (event.kind === 'packet') {
      this.#publishNode(node).catch(() => {});
      if (message) {
        this.#fireMessage(message).catch(() => {});
        this.requestWidgetRefresh();
      }
    }
  }

  /** What the Discovery tab shows of the node of an event: name and features. */
  #shape(event) {
    const num = event.kind === 'node' ? event.num : event.from;
    const node = this.mesh.nodes.get(num);
    return node
      ? `${node.longName}|${node.shortName}|${featureKeys(node, this.home !== null).join(',')}`
      : '';
  }

  #isDuplicate(event, now) {
    if (!event.id) {
      return false;
    }
    if (this.seen.size > 1000) {
      for (const [key, at] of this.seen) {
        if (now - at >= this.timings.duplicateMs) {
          this.seen.delete(key);
        }
      }
    }
    const key = `${event.from}:${event.id}`;
    const at = this.seen.get(key);
    if (at !== undefined && now - at < this.timings.duplicateMs) {
      return true;
    }
    this.seen.set(key, now);
    return false;
  }

  #isEcho(event, now) {
    this.sent = this.sent.filter((entry) => now - entry.at < this.timings.echoMs);
    const index = this.sent.findIndex(
      (entry) => entry.text === event.data && entry.from === event.from,
    );
    if (index < 0) {
      return false;
    }
    this.sent.splice(index, 1);
    return true;
  }

  // --- Gladys devices ---------------------------------------------------------

  /** The node numbers of the node devices added in Gladys, with their device. */
  addedNodes() {
    const list = [];
    for (const device of this.gladys.devices ?? []) {
      const num = nodeNumOf(this.gladys, device.external_id);
      if (num !== null) {
        list.push({ num, device });
      }
    }
    return list;
  }

  discoveredDevices() {
    const language = this.config?.language ?? 'fr';
    const added = new Set(this.addedNodes().map(({ num }) => num));
    return (
      [...this.mesh.nodes.values()]
        // Past the cap, the added nodes first, then the most recently heard.
        .sort(
          (a, b) =>
            Number(added.has(b.num)) - Number(added.has(a.num)) ||
            (b.lastHeard ?? 0) - (a.lastHeard ?? 0),
        )
        .slice(0, MAX_DISCOVERED)
        .sort((a, b) => a.num - b.num)
        .map((node) => buildNodeDevice(this.gladys, node, language, this.home !== null))
    );
  }

  scheduleDiscovery() {
    if (this.discoveryTimer) {
      return;
    }
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = null;
      this.publishDiscovery().catch(() => {});
    }, this.timings.discoveryDelayMs);
    this.discoveryTimer.unref?.();
  }

  /** The discovered nodes; only sent again when the list changed (or forced). */
  async publishDiscovery({ force = false } = {}) {
    if (!this.config) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discoveryKey) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discoveryKey = key;
      this.issues.ok('discovery', 'Gladys accepts the discovered devices again');
    } catch (err) {
      this.issues.fail('discovery', `Publishing the discovered devices failed: ${err.message}`);
    }
  }

  // --- states -----------------------------------------------------------------

  isOnline(node, now = this.now()) {
    if (
      node &&
      node.num === this.mesh.myNum &&
      this.config.connection === 'tcp' &&
      this.link?.state === 'connected'
    ) {
      return true; // the node we are connected to
    }
    return node?.lastHeard !== null && node?.lastHeard !== undefined
      ? now - node.lastHeard < this.config.offline_after_ms
      : false;
  }

  /** The states of one node, for the features it has. */
  statesOf(node, now) {
    const ids = nodeIds(this.gladys, node.num);
    const states = [];
    const put = (key, value) => {
      if (value !== null && value !== undefined) {
        states.push({ device_feature_external_id: ids.feature(key), ...value });
      }
    };
    const online = this.isOnline(node, now);
    // Not heard since we connected: wait for the offline delay before telling.
    const settled =
      online ||
      (this.connectedAt !== null && now - this.connectedAt >= this.config.offline_after_ms);
    if (settled || node.lastHeard !== null) {
      put('online', { state: online ? 1 : 0 });
    }
    if (node.lastHeard !== null) {
      put('last_heard', { text: formatHeard(node.lastHeard, this.config.language) });
    }
    const bars = signalBars(node.snr);
    if (bars !== null) {
      put('signal', { state: bars });
    }
    if (node.hopsAway !== null) {
      put('hops', { state: Math.min(MAX_HOPS, node.hopsAway) });
    }
    if (node.battery !== null) {
      put('battery', { state: node.battery });
    }
    if (node.voltage !== null) {
      put('voltage', { state: round(node.voltage, 2) });
    }
    if (node.position && this.home) {
      put('distance', { state: round(distanceKm(this.home, node.position), 1) });
    }
    if (node.temperature !== null) {
      put('temperature', { state: round(node.temperature, 1) });
    }
    if (node.humidity !== null) {
      put('humidity', { state: round(node.humidity, 1) });
    }
    if (node.pressure !== null) {
      put('pressure', { state: round(node.pressure, 1) });
    }
    return states;
  }

  async #publishNode(node) {
    const added = this.addedNodes().find((entry) => entry.num === node.num);
    if (added) {
      await this.#publish(this.statesOf(node, this.now()));
    }
  }

  /** Every added node: what time changed (online, last heard) and the rest. */
  async tick() {
    if (!isConfigured(this.config) || this.link?.state !== 'connected') {
      return;
    }
    const now = this.now();
    const added = this.addedNodes();
    const states = [];
    for (const { num } of added) {
      const node = this.mesh.nodes.get(num);
      if (node) {
        states.push(...this.statesOf(node, now));
      } else if (
        this.connectedAt !== null &&
        now - this.connectedAt >= this.config.offline_after_ms
      ) {
        // Added in Gladys, never heard since we connected.
        states.push({
          device_feature_external_id: nodeIds(this.gladys, num).feature('online'),
          state: 0,
        });
      }
    }
    await this.#publish(states);
    const keep = new Set(added.map(({ num }) => num));
    this.mesh.prune((num) => keep.has(num));
  }

  async #publish(states) {
    // Features not added in Gladys (a battery that appeared after the node was
    // added...) are filtered out: the core would only drop them.
    const known = new Set(
      (this.gladys.devices ?? []).flatMap((device) =>
        (device.features ?? []).map((feature) => feature.external_id),
      ),
    );
    const kept = states.filter((state) => known.has(state.device_feature_external_id));
    if (kept.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(kept, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('states', `Publishing the states failed: ${err.message}`);
    }
  }

  async #fireMessage(message) {
    const sender = this.addedNodes().find((entry) => entry.num === message.from)?.device;
    const node = this.mesh.nodes.get(message.from);
    try {
      await this.gladys.publishSceneEvent(TRIGGER.MESSAGE_RECEIVED, {
        channel: message.direct ? 'direct' : String(message.channel),
        sender: sender?.external_id ?? '',
        text: message.text,
        sender_name: sender?.name || this.mesh.displayName(message.from),
        sender_id: node?.id ?? '',
      });
      this.issues.ok('scene', 'Gladys accepts the scene events again');
    } catch (err) {
      this.issues.fail('scene', `Firing the scene event failed: ${err.message}`);
    }
  }

  /** Everything again: a device was just added or updated in Gladys. */
  async republish() {
    this.gladys.forgetPublishedStates?.();
    await this.tick();
  }

  requestWidgetRefresh() {
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch {
      // Fire-and-forget: a refresh lost while disconnected is caught up by the TTL.
    }
  }

  // --- sending ----------------------------------------------------------------

  /**
   * Sends a text on a channel, or to one node (direct message).
   * @param {{ text: string, channel: number, to?: number }} message
   * @returns {Promise<{ clipped: boolean }>}
   * @throws {Error} with a message in the configured language
   */
  async sendText({ text, channel, to = BROADCAST }) {
    const words = pick(SEND_TEXT, this.config?.language);
    const clipped = clipText(String(text ?? '').trim());
    if (clipped.text === '') {
      throw new Error(words.empty);
    }
    if (!this.link || this.link.state !== 'connected') {
      throw new Error(words.notConnected);
    }
    if (this.config.connection === 'tcp') {
      this.link.send(
        encodeSendText({ to, channel, id: randomInt(1, 0xffffffff), text: clipped.text }),
      );
    } else {
      // The topic prefix (root and region) is learnt from the traffic; the
      // sending node is the configured gateway, else the last one heard.
      const gateway = this.config.gateway ?? this.gateway?.num;
      if (!this.gateway || gateway === undefined) {
        throw new Error(words.noGateway);
      }
      await this.link.publish(
        downlinkTopic(this.gateway.prefix),
        jsonSendText({ gateway, to, channel, text: clipped.text }),
      );
      // The gateway uplinks what it sends: not a received message.
      this.sent.push({ text: clipped.text, from: gateway, at: this.now() });
    }
    return { clipped: clipped.clipped };
  }

  // --- readers for the action and the widget ----------------------------------

  checkConnection() {
    const text = pick(CHECK_TEXT, this.config?.language);
    if (!isConfigured(this.config)) {
      return text.notConfigured;
    }
    const tcp = this.config.connection === 'tcp';
    const state = this.link?.state ?? null;
    if (state === 'refused') {
      return text.refused;
    }
    if (state === 'unreachable') {
      return tcp ? text.nodeUnreachable : text.unreachable;
    }
    if (state !== 'connected') {
      return text.connecting;
    }
    const address = safeAddress(this.config);
    const nodes = [...this.mesh.nodes.values()];
    if (nodes.length === 0) {
      return text.noNode(address);
    }
    return text.ok(address, nodes.length, nodes.filter((node) => this.isOnline(node)).length);
  }
}
