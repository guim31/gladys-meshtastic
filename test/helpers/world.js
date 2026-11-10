// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Meshtastic node on TCP
// or a fake MQTT broker the test drives, and the integration wired on top
// through registerHandlers — the same wiring as index.js.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { decode, message, uint } from '../../src/protobuf.js';
import { FrameReader, frame } from '../../src/tcp.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/Paris';

export const HOST = 'meshtastic.example';
export const BROKER_URL = 'mqtt://broker.example:1883';
export const CLIENT_ID = 'gladys-meshtastic-0a1b2c3d';
export const T0 = Date.UTC(2026, 10, 10, 17, 0, 0);

/** test/fixtures/tcp-frames.json: real capture + synthetic remote node. */
export const FRAMES = JSON.parse(
  readFileSync(new URL('../fixtures/tcp-frames.json', import.meta.url), 'utf8'),
);
export const SYNTHETIC = Object.fromEntries(
  FRAMES.synthetic.map(({ name, hex }) => [name, Buffer.from(hex, 'hex')]),
);
export const CAPTURE = FRAMES.capture.map((hex) => Buffer.from(hex, 'hex'));
// The nodes of the fixtures.
export const ME = 0x1324b352; // the captured node, "Station Jardin"
export const REMOTE = 0xa1b2c3d4; // "Relais Colline"
export const SENDER_MQTT = 0x26fd8da1; // the gateway of the JSON capture's downlink

/** test/fixtures/mqtt-json.txt: `topic payload` lines published by meshtasticd. */
export const JSON_LINES = readFileSync(
  new URL('../fixtures/mqtt-json.txt', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => {
    const space = line.indexOf(' ');
    return { topic: line.slice(0, space), payload: line.slice(space + 1) };
  });

/** A fake Meshtastic node: net.createConnection() returning a socket the test drives. */
export function createFakeNode() {
  const node = {
    sockets: [],
    connections: [],
    get socket() {
      return node.sockets[node.sockets.length - 1];
    },
    connect(options) {
      const socket = new EventEmitter();
      socket.written = [];
      socket.destroyed = false;
      socket.setNoDelay = () => {};
      socket.setTimeout = () => {};
      socket.write = (data) => socket.written.push(Buffer.from(data));
      socket.end = (data) => {
        if (data) {
          socket.written.push(Buffer.from(data));
        }
        socket.destroyed = true;
      };
      socket.destroy = (err) => {
        socket.destroyed = true;
        if (err) {
          socket.emit('error', err);
        }
        socket.emit('close');
      };
      node.sockets.push(socket);
      node.connections.push(options);
      return socket;
    },
    /** The ToRadio messages the integration wrote, decoded. */
    toRadio() {
      const reader = new FrameReader();
      return node.socket.written.flatMap((chunk) => reader.push(chunk)).map((b) => decode(b));
    },
    /** Accepts the connection and answers want_config with the captured dump. */
    accept() {
      node.socket.emit('connect');
      const nonce = uint(node.toRadio()[0], 3);
      for (const payload of CAPTURE) {
        const fields = decode(payload);
        // The capture answered want_config_id 12345: answer with this nonce.
        const out = uint(fields, 7) === 12345 ? Buffer.from([0x38, ...varint(nonce)]) : payload;
        node.socket.emit('data', frame(out));
      }
    },
    send(payload) {
      node.socket.emit('data', frame(payload));
    },
    drop() {
      node.socket.destroy(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    },
  };
  return node;
}

function varint(value) {
  const out = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest = Math.floor(rest / 128);
    if (rest) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (rest);
  return out;
}

/** A fake broker: mqtt.connect() returning a client the test drives. */
export function createFakeBroker() {
  const broker = {
    clients: [],
    connections: [],
    published: [],
    get client() {
      return broker.clients[broker.clients.length - 1];
    },
    connect(url, options) {
      const client = new EventEmitter();
      client.subscriptions = [];
      client.subscribe = (topics, opts, callback) => {
        const list = [].concat(topics);
        client.subscriptions.push(...list);
        callback?.(
          null,
          list.map((topic) => ({ topic, qos: 0 })),
        );
      };
      client.publish = (topic, payload, opts, callback) => {
        broker.published.push({ topic, payload: String(payload) });
        callback?.();
      };
      client.end = () => {};
      broker.clients.push(client);
      broker.connections.push({ url, options });
      return client;
    },
    accept() {
      broker.client.emit('connect');
    },
    send(topic, payload) {
      broker.client.emit('message', topic, Buffer.from(String(payload)));
    },
    drop() {
      broker.client.emit('close');
      broker.client.emit('offline');
    },
  };
  return broker;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array<object>} [options.devices] devices already created in Gladys
 * @param {Array<object>} [options.houses]
 * @param {() => number} [options.now]
 * @param {object} [options.timings]
 */
export async function createWorld({
  config = { connection: 'tcp', host: HOST },
  devices = [],
  houses = [{ id: 'h', name: 'Maison', selector: 'maison', latitude: 43.6, longitude: 1.44 }],
  now,
  timings,
} = {}) {
  const node = createFakeNode();
  const broker = createFakeBroker();
  const gladys = createFakeGladys({ config, devices, houses });
  const app = registerHandlers(gladys, {
    connectTcp: node.connect,
    connectMqtt: broker.connect,
    loadClientId: async () => ({ clientId: CLIENT_ID, persisted: true }),
    now,
    timings: { discoveryDelayMs: 0, ...timings },
  });
  await gladys.connect();
  await flush();
  return { gladys, node, broker, app, hub: app.hub };
}

/** Let the pending promise callbacks and zero-delay timers run. */
export const flush = async () => {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** Add the discovered device with that external id, as the user would. */
export async function addDiscovered(world, externalId) {
  const device = world.gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  if (!device) {
    throw new Error(`${externalId} was not discovered`);
  }
  await world.gladys.fake.deviceCreated(device);
  await flush();
  return device;
}

/** The last published state of a feature. */
export function lastState(world, featureExternalId) {
  const states = world.gladys.fake.states.filter(
    (s) => s.device_feature_external_id === featureExternalId,
  );
  const last = states[states.length - 1];
  return last === undefined ? undefined : (last.text ?? last.state);
}

/** The MeshPackets the integration sent to the node. */
export function sentPackets(world) {
  return world.node
    .toRadio()
    .map((fields) => message(fields, 1))
    .filter(Boolean);
}
