// -----------------------------------------------------------------------------
// Meshtastic messages -> plain events, for both transports.
//
// TCP (client API, port 4403): the FromRadio / ToRadio protobufs of
// meshtastic/protobufs (mesh.proto, telemetry.proto, channel.proto), decoded
// by field number (src/protobuf.js).
// MQTT: the JSON the firmware publishes on `<root>/2/json/<channel>/<gateway>`
// (MeshPacketSerializer.cpp). Encrypted (`/2/e/`) packets are ignored.
//
// Events:
//   { kind: 'my_info', num }
//   { kind: 'channel', index, name, role }            TCP, 0 = disabled
//   { kind: 'config_complete', id }
//   { kind: 'node', num, user?, position?, metrics?, snr?, lastHeard?, hopsAway?, viaMqtt? }
//   { kind: 'packet', from, to, channel, id, rxTime, snr, hopsAway, port, data }
//      port: 'text' (data: string), 'position', 'nodeinfo' (data: user),
//      'telemetry' (data: { device?, environment? })
// Node numbers are uint32; the node id is `!` + 8 hex digits.
// -----------------------------------------------------------------------------

import * as pb from './protobuf.js';

export const BROADCAST = 0xffffffff;
export const PORT = { TEXT: 1, POSITION: 3, NODEINFO: 4, TELEMETRY: 67 };
// Over the air, a text payload stays under the LoRa frame (233 bytes minus
// headers): the apps cap it at 200 bytes.
export const MAX_TEXT_BYTES = 200;

export const nodeId = (num) => `!${(num >>> 0).toString(16).padStart(8, '0')}`;

/** `!a1b2c3d4` (or the decimal number) -> uint32, null when invalid. */
export function nodeNum(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= BROADCAST) {
    return value;
  }
  const text = String(value ?? '').trim();
  if (/^![0-9a-f]{8}$/i.test(text)) {
    return Number.parseInt(text.slice(1), 16);
  }
  if (/^\d{1,10}$/.test(text)) {
    const num = Number(text);
    return num <= BROADCAST ? num : null;
  }
  return null;
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

// --- protobuf ----------------------------------------------------------------

function decodeUser(fields) {
  return {
    id: pb.string(fields, 1),
    longName: pb.string(fields, 2),
    shortName: pb.string(fields, 3),
    hwModel: pb.uint(fields, 5),
    role: pb.uint(fields, 7),
  };
}

function decodePosition(fields) {
  return normalizePosition({
    latitude_i: pb.sfixed32(fields, 1),
    longitude_i: pb.sfixed32(fields, 2),
    altitude: pb.int32(fields, 3),
    time: pb.fixed32(fields, 4),
  });
}

function decodeDeviceMetrics(fields) {
  return normalizeDeviceMetrics({
    battery_level: pb.uint(fields, 1),
    voltage: pb.float(fields, 2),
    channel_utilization: pb.float(fields, 3),
    air_util_tx: pb.float(fields, 4),
    uptime_seconds: pb.uint(fields, 5),
  });
}

function decodeEnvironment(fields) {
  return normalizeEnvironment({
    temperature: pb.float(fields, 1),
    relative_humidity: pb.float(fields, 2),
    barometric_pressure: pb.float(fields, 3),
  });
}

function decodeTelemetry(fields) {
  const device = pb.message(fields, 2);
  const environment = pb.message(fields, 3);
  return {
    ...(device ? { device: decodeDeviceMetrics(device) } : {}),
    ...(environment ? { environment: decodeEnvironment(environment) } : {}),
  };
}

/** hop_start - hop_limit, when the sender's firmware tells hop_start. */
const hopsOf = (hopStart, hopLimit) =>
  hopStart > 0 && hopLimit !== undefined && hopStart >= hopLimit ? hopStart - hopLimit : undefined;

function decodePacket(fields) {
  const decoded = pb.message(fields, 4);
  if (!decoded) {
    return null; // still encrypted: a channel this node has no key for
  }
  const portnum = pb.uint(decoded, 1);
  const payload = pb.bytes(decoded, 2) ?? Buffer.alloc(0);
  const base = {
    kind: 'packet',
    from: pb.fixed32(fields, 1) ?? 0,
    to: pb.fixed32(fields, 2) ?? BROADCAST,
    channel: pb.uint(fields, 3) ?? 0,
    id: pb.fixed32(fields, 6) ?? 0,
    rxTime: pb.fixed32(fields, 7) ?? 0,
    snr: finite(pb.float(fields, 8)),
    // hop_limit 0 (all hops used) is absent on the wire (proto3 default).
    hopsAway: hopsOf(pb.uint(fields, 15) ?? 0, pb.uint(fields, 9) ?? 0),
    viaMqtt: pb.bool(fields, 14) ?? false,
  };
  if (portnum === PORT.TEXT) {
    return { ...base, port: 'text', data: payload.toString('utf8') };
  }
  if (portnum === PORT.POSITION) {
    return { ...base, port: 'position', data: decodePosition(pb.decode(payload)) };
  }
  if (portnum === PORT.NODEINFO) {
    return { ...base, port: 'nodeinfo', data: decodeUser(pb.decode(payload)) };
  }
  if (portnum === PORT.TELEMETRY) {
    return { ...base, port: 'telemetry', data: decodeTelemetry(pb.decode(payload)) };
  }
  return null;
}

/**
 * One FromRadio message -> an event, or null for what the integration ignores
 * (config, module config, log records, queue status...).
 * @param {Uint8Array} buffer
 * @throws on a malformed message
 */
export function decodeFromRadio(buffer) {
  const fields = pb.decode(buffer);
  const packet = pb.message(fields, 2);
  if (packet) {
    return decodePacket(packet);
  }
  const myInfo = pb.message(fields, 3);
  if (myInfo) {
    return { kind: 'my_info', num: pb.uint(myInfo, 1) ?? 0 };
  }
  const nodeInfo = pb.message(fields, 4);
  if (nodeInfo) {
    const user = pb.message(nodeInfo, 2);
    const position = pb.message(nodeInfo, 3);
    const metrics = pb.message(nodeInfo, 6);
    return {
      kind: 'node',
      num: pb.uint(nodeInfo, 1) ?? 0,
      ...(user ? { user: decodeUser(user) } : {}),
      ...(position ? { position: decodePosition(position) } : {}),
      ...(metrics ? { metrics: decodeDeviceMetrics(metrics) } : {}),
      snr: finite(pb.float(nodeInfo, 4)),
      lastHeard: pb.fixed32(nodeInfo, 5) ?? 0,
      hopsAway: pb.uint(nodeInfo, 9),
      viaMqtt: pb.bool(nodeInfo, 8) ?? false,
    };
  }
  const complete = pb.uint(fields, 7);
  if (complete !== undefined) {
    return { kind: 'config_complete', id: complete };
  }
  const channel = pb.message(fields, 10);
  if (channel) {
    const settings = pb.message(channel, 2);
    return {
      kind: 'channel',
      index: pb.int32(channel, 1) ?? 0,
      name: (settings && pb.string(settings, 3)) || '',
      role: pb.uint(channel, 3) ?? 0,
    };
  }
  return null;
}

/** ToRadio { want_config_id }: asks the node for its whole state, then packets. */
export const encodeWantConfig = (nonce) => pb.encode([[3, 'varint', nonce]]);

/** ToRadio { heartbeat {} }: keeps the API connection alive. */
export const encodeHeartbeat = () => pb.encode([[7, 'message', Buffer.alloc(0)]]);

/** ToRadio { disconnect: true } */
export const encodeDisconnect = () => pb.encode([[4, 'bool', true]]);

/**
 * ToRadio { packet: MeshPacket { to, channel, id, want_ack, decoded: Data { TEXT, payload } } }.
 * The node fills `from`; `want_ack` makes it apply its configured hop limit.
 */
export function encodeSendText({ to = BROADCAST, channel = 0, id, text }) {
  const data = pb.encode([
    [1, 'varint', PORT.TEXT],
    [2, 'bytes', Buffer.from(text, 'utf8')],
  ]);
  const packet = pb.encode([
    [2, 'fixed32', to],
    [3, 'varint', channel || undefined],
    [4, 'message', data],
    [6, 'fixed32', id],
    // want_ack, as the official apps do: the firmware then applies its own hop
    // limit (a hop_limit left at 0 without it would never be relayed).
    [10, 'bool', true],
  ]);
  return pb.encode([[1, 'message', packet]]);
}

// --- JSON over MQTT ----------------------------------------------------------

/**
 * Splits a JSON topic: `<prefix>/2/json/<channel>/<gateway>`.
 * @returns {{ prefix: string, channelName: string, gateway: string }|null}
 */
export function parseJsonTopic(topic) {
  const parts = String(topic).split('/');
  for (let i = parts.length - 4; i >= 0; i -= 1) {
    if (parts[i] === '2' && parts[i + 1] === 'json') {
      const channelName = parts[i + 2];
      // `<prefix>/2/json/mqtt/` (no gateway) is the downlink topic: what we
      // (or others) send.
      const gateway = parts[i + 3] ?? '';
      if (!channelName || (channelName === 'mqtt' && gateway === '')) {
        return null;
      }
      return { prefix: parts.slice(0, i).join('/'), channelName, gateway: parts[i + 3] ?? '' };
    }
  }
  return null;
}

/** The topic the firmware listens to for JSON downlink (a channel named "mqtt"). */
export const downlinkTopic = (prefix) => `${prefix}/2/json/mqtt/`;

/**
 * One JSON message -> a packet event, or null.
 * @param {string} topic
 * @param {Buffer|string} payload
 */
export function parseJsonMessage(topic, payload) {
  const where = parseJsonTopic(topic);
  if (!where) {
    return null;
  }
  let json;
  try {
    json = JSON.parse(String(payload));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || nodeNum(json.from) === null) {
    return null;
  }
  const base = {
    kind: 'packet',
    from: nodeNum(json.from),
    to: nodeNum(json.to) ?? BROADCAST,
    channel: Number.isInteger(json.channel) ? json.channel : 0,
    id: Number.isInteger(json.id) ? json.id : 0,
    rxTime: Number.isInteger(json.timestamp) ? json.timestamp : 0,
    snr: finite(json.snr),
    hopsAway: Number.isInteger(json.hops_away) ? json.hops_away : undefined,
    viaMqtt: false,
    gateway: nodeNum(json.sender) ?? nodeNum(where.gateway),
    prefix: where.prefix,
    channelName: where.channelName,
  };
  const data = json.payload && typeof json.payload === 'object' ? json.payload : {};
  switch (json.type) {
    case 'text':
      // A text that parses as JSON is sent parsed by the firmware: told back as text.
      return {
        ...base,
        port: 'text',
        data:
          typeof data.text === 'string' && Object.keys(data).length === 1
            ? data.text
            : JSON.stringify(json.payload ?? ''),
      };
    case 'position':
      return { ...base, port: 'position', data: normalizePosition(data) };
    case 'nodeinfo':
      return {
        ...base,
        port: 'nodeinfo',
        data: {
          id: typeof data.id === 'string' ? data.id : undefined,
          longName: typeof data.longname === 'string' ? data.longname : undefined,
          shortName: typeof data.shortname === 'string' ? data.shortname : undefined,
          hwModel: Number.isInteger(data.hardware) ? data.hardware : undefined,
          role: Number.isInteger(data.role) ? data.role : undefined,
        },
      };
    case 'telemetry': {
      // Device and environment metrics share the `telemetry` type (and the
      // `voltage` key): the device ones carry channel utilization or uptime.
      const isDevice = [
        'battery_level',
        'channel_utilization',
        'air_util_tx',
        'uptime_seconds',
      ].some((key) => key in data);
      const isEnvironment = ['temperature', 'relative_humidity', 'barometric_pressure'].some(
        (key) => key in data,
      );
      if (!isDevice && !isEnvironment) {
        return null;
      }
      return {
        ...base,
        port: 'telemetry',
        data: isDevice
          ? { device: normalizeDeviceMetrics(data) }
          : { environment: normalizeEnvironment(data) },
      };
    }
    default:
      return null;
  }
}

/**
 * The JSON downlink message of a text (firmware MQTT::onReceive, type
 * `sendtext`): `from` is the gateway node, which must have a channel named
 * "mqtt" with downlink enabled.
 */
export function jsonSendText({ gateway, to = BROADCAST, channel = 0, text }) {
  return JSON.stringify({
    from: gateway,
    ...(to === BROADCAST ? {} : { to }),
    channel,
    type: 'sendtext',
    payload: text,
  });
}

// --- shared normalization ----------------------------------------------------

/** Degrees; null without a fix (0/0 is "no position" for the firmware). */
function normalizePosition(raw) {
  const lat = raw.latitude_i;
  const lon = raw.longitude_i;
  if (!Number.isInteger(lat) || !Number.isInteger(lon) || (lat === 0 && lon === 0)) {
    return null;
  }
  const latitude = lat / 1e7;
  const longitude = lon / 1e7;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  return { latitude, longitude, altitude: Number.isInteger(raw.altitude) ? raw.altitude : null };
}

function normalizeDeviceMetrics(raw) {
  const level = Number.isInteger(raw.battery_level) ? raw.battery_level : undefined;
  const voltage = finite(raw.voltage);
  return {
    // 101 is "powered, no battery or charging": shown as full.
    battery: level === undefined || level === 0 ? undefined : Math.min(100, level),
    powered: level === 101,
    // 0 V: no battery measure on this board.
    voltage: voltage && voltage > 0 ? voltage : undefined,
    channelUtilization: finite(raw.channel_utilization),
    uptime: Number.isInteger(raw.uptime_seconds) ? raw.uptime_seconds : undefined,
  };
}

function normalizeEnvironment(raw) {
  const value = (v) => {
    const number = finite(v);
    // An absent sensor reads 0 on older firmware (no presence bit): skipped.
    return number === undefined || number === 0 ? undefined : number;
  };
  return {
    temperature: finite(raw.temperature),
    humidity: value(raw.relative_humidity),
    pressure: value(raw.barometric_pressure),
  };
}

/** UTF-8 safe cut to the radio limit. */
export function clipText(text, maxBytes = MAX_TEXT_BYTES) {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) {
    return { text, clipped: false };
  }
  let end = maxBytes;
  // Back up to the start of a character (not a continuation byte 10xxxxxx).
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return { text: buffer.subarray(0, end).toString('utf8'), clipped: true };
}
