// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys: a fake node on
// TCP answering with the frames captured from meshtasticd (plus a remote node
// built with the official encoder), and a fake broker replaying the JSON
// meshtasticd published.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeIds } from '../src/devices.js';
import { bytes, fixed32, message, uint } from '../src/protobuf.js';
import {
  BROKER_URL,
  JSON_LINES,
  ME,
  REMOTE,
  SENDER_MQTT,
  SYNTHETIC,
  T0,
  addDiscovered,
  createWorld,
  flush,
  lastState,
  sentPackets,
} from './helpers/world.js';

const MINUTE = 60_000;

function clock(start = T0) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

async function tcpWorld(t, options = {}) {
  const time = clock();
  const world = await createWorld({ now: time.now, ...options });
  t.after(() => world.app.stop());
  world.node.accept();
  await flush();
  return { world, time };
}

async function withRemote(t, options) {
  const { world, time } = await tcpWorld(t, options);
  world.node.send(SYNTHETIC['remote node_info']);
  await flush();
  await world.hub.publishDiscovery();
  return { world, time };
}

test('TCP: asks the node for its configuration and is connected once it is complete', async (t) => {
  const { world } = await tcpWorld(t);
  assert.deepEqual(world.node.connections, [{ host: 'meshtastic.example', port: 4403 }]);
  const wantConfig = uint(world.node.toRadio()[0], 3);
  assert.ok(wantConfig > 0, 'want_config_id sent first');
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
  assert.equal(world.hub.mesh.myNum, ME);
  assert.equal(world.hub.mesh.channels.get(0).role, 1);
});

test('TCP: every node of the node database is offered, named as on the mesh', async (t) => {
  const { world } = await withRemote(t);
  const names = world.gladys.fake.discoveredDevices.map((d) => [d.name, d.params[0].value]);
  assert.deepEqual(names, [
    ['Station Jardin', '!1324b352'],
    ['Relais Colline', '!a1b2c3d4'],
  ]);
  const own = world.gladys.fake.discoveredDevices[0];
  // Battery (powered: 100), position (house located): distance.
  assert.deepEqual(
    own.features.map((f) => f.external_id.split(':').pop()),
    // Never heard directly (it is the TCP node itself): no signal, no hops.
    ['online', 'last_heard', 'battery', 'distance'],
  );
});

test('TCP: an added node gets its states at once, then on every packet', async (t) => {
  const { world } = await withRemote(t);
  const ids = nodeIds(world.gladys, REMOTE);
  await addDiscovered(world, ids.device);
  // The node database says it was last heard in 2023: offline.
  assert.equal(lastState(world, ids.feature('online')), 0);
  assert.equal(lastState(world, ids.feature('last_heard')), '14/11 22:56');
  assert.equal(lastState(world, ids.feature('battery')), 76);
  assert.equal(lastState(world, ids.feature('voltage')), 3.92);
  assert.equal(lastState(world, ids.feature('signal')), 5); // SNR 7.25 dB, direct
  assert.equal(lastState(world, ids.feature('hops')), 0);

  world.node.send(SYNTHETIC['device telemetry']);
  await flush();
  assert.equal(lastState(world, ids.feature('battery')), 74);
  assert.equal(lastState(world, ids.feature('voltage')), 3.9);
  // Heard now (the packet), by our clock: 10/11 18:00 in Paris.
  assert.equal(lastState(world, ids.feature('last_heard')), '10/11 18:00');
  assert.equal(lastState(world, ids.feature('online')), 1);
});

test('TCP: environment telemetry and a position add features, offered as an update', async (t) => {
  const { world } = await withRemote(t);
  world.node.send(SYNTHETIC['environment telemetry']);
  world.node.send(SYNTHETIC.position);
  await flush();
  await world.hub.publishDiscovery();
  const remote = world.gladys.fake.discoveredDevices.find((d) => d.name === 'Relais Colline');
  assert.deepEqual(
    remote.features.map((f) => f.external_id.split(':').pop()),
    [
      'online',
      'last_heard',
      'signal',
      'hops',
      'battery',
      'voltage',
      'distance',
      'temperature',
      'humidity',
      'pressure',
    ],
  );
  await addDiscovered(world, remote.external_id);
  const ids = nodeIds(world.gladys, REMOTE);
  assert.equal(lastState(world, ids.feature('temperature')), 12.4);
  assert.equal(lastState(world, ids.feature('humidity')), 81.5);
  assert.equal(lastState(world, ids.feature('pressure')), 1009.8);
  assert.equal(lastState(world, ids.feature('distance')), 0.6);
});

test('TCP: a text message fires message_received, with the channel or "direct"', async (t) => {
  const { world } = await withRemote(t);
  const ids = nodeIds(world.gladys, REMOTE);
  await addDiscovered(world, ids.device);
  world.node.send(SYNTHETIC['text broadcast']);
  world.node.send(SYNTHETIC['text direct']);
  await flush();
  assert.deepEqual(world.gladys.fake.sceneEvents, [
    {
      key: 'message_received',
      data: {
        channel: '0',
        sender: ids.device,
        text: 'Bonjour la maison',
        sender_name: 'Relais Colline',
        sender_id: '!a1b2c3d4',
      },
    },
    {
      key: 'message_received',
      data: {
        channel: 'direct',
        sender: ids.device,
        text: 'Message privé ✓',
        sender_name: 'Relais Colline',
        sender_id: '!a1b2c3d4',
      },
    },
  ]);
  // The direct one came over two hops: told by the hops feature.
  assert.equal(lastState(world, ids.feature('hops')), 2);
  assert.ok(world.gladys.fake.widgetRefreshes.includes('mesh'));
});

test('TCP: the same packet heard twice fires once', async (t) => {
  const { world } = await withRemote(t);
  world.node.send(SYNTHETIC['text broadcast']);
  world.node.send(SYNTHETIC['text broadcast']);
  await flush();
  assert.equal(world.gladys.fake.sceneEvents.length, 1);
  // A sender not added in Gladys: no device, its mesh name.
  assert.equal(world.gladys.fake.sceneEvents[0].data.sender, '');
  assert.equal(world.gladys.fake.sceneEvents[0].data.sender_name, 'Relais Colline');
});

test('TCP: send_message writes a text packet, on a channel or to a node', async (t) => {
  const { world } = await withRemote(t);
  const ids = nodeIds(world.gladys, REMOTE);
  await addDiscovered(world, ids.device);
  const broadcast = await world.gladys.fake.sceneAction('send_message', {
    text: 'Portail ouvert',
    channel: '2',
  });
  assert.equal(broadcast.success, true, broadcast.error);
  assert.deepEqual(broadcast.data.outputs ?? broadcast.data, {
    sent: true,
    clipped: false,
    summary: 'Message envoyé sur le canal 2.',
  });
  const direct = await world.gladys.fake.sceneAction('send_message', {
    text: 'é'.repeat(150),
    channel: '0',
    node: ids.device,
  });
  assert.equal((direct.data.outputs ?? direct.data).clipped, true);
  const [first, second] = sentPackets(world);
  assert.equal(fixed32(first, 2), 0xffffffff);
  assert.equal(uint(first, 3), 2);
  assert.equal(uint(first, 10), 1, 'want_ack, for the hop limit');
  assert.equal(bytes(message(first, 4), 2).toString(), 'Portail ouvert');
  assert.equal(uint(message(first, 4), 1), 1, 'TEXT_MESSAGE_APP');
  assert.equal(fixed32(second, 2), REMOTE);
  assert.equal(bytes(message(second, 4), 2).length, 200, '100 two-byte characters');
});

test('send_message fails clearly: empty text, unknown node, not connected', async (t) => {
  const { world } = await withRemote(t);
  const empty = await world.gladys.fake.sceneAction('send_message', { text: '  ', channel: '0' });
  assert.equal(empty.success, false);
  assert.equal(empty.error, 'Le message est vide.');
  const unknown = await world.gladys.fake.sceneAction('send_message', {
    text: 'a',
    channel: '0',
    node: 'meshtastic:other:1',
  });
  assert.equal(unknown.error, "Cet appareil n'est pas un nœud Meshtastic de l'intégration.");
  world.node.drop();
  await flush();
  const offline = await world.gladys.fake.sceneAction('send_message', { text: 'a', channel: '0' });
  assert.equal(offline.error, "Pas de connexion au maillage : le message n'est pas parti.");
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.fr, /ne répond pas en TCP/);
});

test('a node not heard for the offline delay goes offline, without polling', async (t) => {
  const { world, time } = await withRemote(t, { timings: { tickMs: 1_000_000_000 } });
  const ids = nodeIds(world.gladys, REMOTE);
  await addDiscovered(world, ids.device);
  world.node.send(SYNTHETIC['device telemetry']);
  await flush();
  assert.equal(lastState(world, ids.feature('online')), 1);
  time.advance(119 * MINUTE);
  await world.hub.tick();
  assert.equal(lastState(world, ids.feature('online')), 1);
  time.advance(2 * MINUTE);
  await world.hub.tick();
  assert.equal(lastState(world, ids.feature('online')), 0);
  // The node we are connected to stays online while the link is up.
  const own = nodeIds(world.gladys, ME);
  await addDiscovered(world, own.device);
  assert.equal(lastState(world, own.feature('online')), 1);
});

test('the tick timer publishes by itself (no onPoll needed)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const time = clock();
  const world = await createWorld({ now: time.now, timings: { tickMs: 30_000 } });
  t.after(() => world.app.stop());
  world.node.accept();
  world.node.send(SYNTHETIC['remote node_info']);
  t.mock.timers.tick(0);
  await flush();
  const ids = nodeIds(world.gladys, REMOTE);
  await addDiscovered(world, ids.device);
  time.advance(3 * 60 * MINUTE);
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(lastState(world, ids.feature('online')), 0);
});

test('a lost TCP link is retried, and the node answers again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const world = await createWorld({ now: () => T0 });
  t.after(() => world.app.stop());
  world.node.accept();
  await flush();
  world.node.drop();
  await flush();
  assert.equal(world.node.sockets.length, 1);
  t.mock.timers.tick(15_000);
  assert.equal(world.node.sockets.length, 2);
  world.node.accept();
  await flush();
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

// --- MQTT ----------------------------------------------------------------------

async function mqttWorld(t, config = {}) {
  const time = clock();
  const world = await createWorld({
    config: { connection: 'mqtt', broker_url: BROKER_URL, ...config },
    now: time.now,
  });
  t.after(() => world.app.stop());
  world.broker.accept();
  await flush();
  return { world, time };
}

test('MQTT: subscribes under the root, reads the JSON of meshtasticd', async (t) => {
  const { world } = await mqttWorld(t);
  assert.deepEqual(world.broker.client.subscriptions, ['msh/#']);
  for (const { topic, payload } of JSON_LINES) {
    world.broker.send(topic, payload);
  }
  // Encrypted packets and other topics are ignored.
  world.broker.send('msh/2/e/LongFast/!1324b352', Buffer.from([1, 2, 3]));
  world.broker.send('msh/2/stat/!1324b352', 'online');
  await flush();
  await world.hub.publishDiscovery();
  const ids = world.gladys.fake.discoveredDevices.map((d) => d.params[0].value);
  assert.deepEqual(ids, ['!1324b352', '!26fd8da1']);
  const node = world.hub.mesh.nodes.get(ME);
  assert.deepEqual(node.position, { latitude: 43.5945472, longitude: 1.441792, altitude: 150 });
  // Two texts from the station (one JSON, told back as text), one from the gateway.
  assert.deepEqual(
    world.gladys.fake.sceneEvents.map((e) => e.data.text),
    ['Bonjour la maison', '{"t":21.5}', 'Test descendant'],
  );
});

test('MQTT: a packet published twice (relays, several gateways) fires once', async (t) => {
  const { world } = await mqttWorld(t);
  const text = JSON_LINES.find((line) => line.payload.includes('Bonjour'));
  world.broker.send(text.topic, text.payload);
  world.broker.send(text.topic.replace('!1324b352', '!26fd8da1'), text.payload);
  await flush();
  assert.equal(world.gladys.fake.sceneEvents.length, 1);
});

test('MQTT: send_message publishes the JSON downlink the firmware accepts, its echo is ignored', async (t) => {
  const { world } = await mqttWorld(t);
  const noGateway = await world.gladys.fake.sceneAction('send_message', {
    text: 'Test descendant',
    channel: '0',
  });
  assert.equal(noGateway.success, false);
  assert.match(noGateway.error, /Aucune passerelle/);

  const line = JSON_LINES.find((l) => l.topic.endsWith('!26fd8da1'));
  world.broker.send(
    'msh/2/json/LongFast/!26fd8da1',
    line.payload.replace('Test descendant', 'x').replace('1148755535', '1'),
  );
  await flush();
  const sent = await world.gladys.fake.sceneAction('send_message', {
    text: 'Test descendant',
    channel: '0',
  });
  assert.equal(sent.success, true, sent.error);
  // Exactly the downlink of the capture, which meshtasticd sent on the air.
  const downlink = JSON_LINES.find((l) => l.topic.includes('/json/mqtt/'));
  assert.deepEqual(world.broker.published, [{ topic: downlink.topic, payload: downlink.payload }]);
  const events = world.gladys.fake.sceneEvents.length;
  world.broker.send(line.topic, line.payload); // the gateway uplinks what it sent
  await flush();
  assert.equal(world.gladys.fake.sceneEvents.length, events);
});

test('MQTT: the configured sending node sends, under the prefix it publishes on', async (t) => {
  const { world } = await mqttWorld(t, { gateway: '!26fd8da1' });
  const gateway = JSON_LINES.find((l) => l.topic.endsWith('!26fd8da1'));
  const station = JSON_LINES.find((line) => line.payload.includes('Bonjour'));
  world.broker.send(gateway.topic.replace('msh/', 'msh/EU_868/'), gateway.payload);
  // Another gateway, in another region, heard last.
  world.broker.send(station.topic.replace('msh/', 'msh/EU_433/'), station.payload);
  await flush();
  await world.gladys.fake.sceneAction('send_message', { text: 'Salut', channel: '1' });
  assert.equal(world.broker.published[0].topic, 'msh/EU_868/2/json/mqtt/');
  assert.deepEqual(JSON.parse(world.broker.published[0].payload), {
    from: SENDER_MQTT,
    channel: 1,
    type: 'sendtext',
    payload: 'Salut',
  });
});

test('MQTT: the echo of a JSON text sent from Gladys is recognized, reformatted', async (t) => {
  const { world } = await mqttWorld(t);
  const gateway = JSON_LINES.find((l) => l.topic.endsWith('!26fd8da1'));
  world.broker.send(gateway.topic, gateway.payload);
  await flush();
  const before = world.gladys.fake.sceneEvents.length;
  await world.gladys.fake.sceneAction('send_message', { text: '{"a": 1}', channel: '0' });
  // The firmware publishes it parsed: {"a":1}.
  world.broker.send(
    gateway.topic,
    gateway.payload.replace('{"text":"Test descendant"}', '{"a":1}').replace('1148755535', '7'),
  );
  await flush();
  assert.equal(world.gladys.fake.sceneEvents.length, before);
});

test('a lost link: the TCP node goes offline at once, the others after the delay', async (t) => {
  const { world, time } = await withRemote(t);
  const own = nodeIds(world.gladys, ME);
  const remote = nodeIds(world.gladys, REMOTE);
  await addDiscovered(world, own.device);
  await addDiscovered(world, remote.device);
  world.node.send(SYNTHETIC['device telemetry']);
  await flush();
  world.node.drop();
  await flush();
  await world.hub.tick();
  assert.equal(lastState(world, own.feature('online')), 0);
  assert.equal(lastState(world, remote.feature('online')), 1);
  time.advance(121 * MINUTE);
  await world.hub.tick();
  assert.equal(lastState(world, remote.feature('online')), 0);
});

test('check_connection tells the state of the link', async (t) => {
  const { world } = await withRemote(t);
  const ack = await world.gladys.fake.action('check_connection');
  // The remote node was last heard long ago (node database): offline.
  assert.equal(
    ack.data.message,
    'Connecté à meshtastic.example:4403 : 2 nœud(s) connu(s), 1 en ligne.',
  );
});
