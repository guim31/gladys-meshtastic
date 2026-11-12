// -----------------------------------------------------------------------------
// The hand-written codec against the reference: frames captured from
// meshtasticd and messages built with the official @meshtastic/protobufs
// encoder (test/fixtures/tcp-frames.json), the stream framing, the JSON of the
// MQTT module, and the radio limit of a text.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipText,
  decodeFromRadio,
  nodeNum,
  parseJsonMessage,
  parseJsonTopic,
} from '../src/meshtastic.js';
import { FrameReader, frame } from '../src/tcp.js';
import { CAPTURE, SYNTHETIC } from './helpers/world.js';

test('the captured configuration dump decodes: my_info, own node, channels, completion', () => {
  const events = CAPTURE.map((payload) => decodeFromRadio(payload)).filter(Boolean);
  assert.deepEqual(events[0], { kind: 'my_info', num: 0x1324b352 });
  // JSON round trip: the absent fields are undefined keys.
  assert.deepEqual(JSON.parse(JSON.stringify(events[1])), {
    kind: 'node',
    num: 0x1324b352,
    user: { id: '!1324b352', longName: 'Station Jardin', shortName: 'JARD', hwModel: 37 },
    position: { latitude: 43.6045, longitude: 1.4442, altitude: 150 },
    metrics: { battery: 100, powered: true, channelUtilization: 0, uptime: 75 },
    lastHeard: 0,
    viaMqtt: false,
  });
  assert.equal(events.filter((e) => e.kind === 'channel').length, 8);
  assert.deepEqual(
    events.find((e) => e.kind === 'config_complete'),
    { kind: 'config_complete', id: 12345 },
  );
  // Routing and simulator packets are skipped, the own telemetry kept.
  assert.equal(events.at(-1).port, 'telemetry');
});

test('the packets of a remote node decode like the official encoder wrote them', () => {
  assert.deepEqual(decodeFromRadio(SYNTHETIC['text direct']), {
    kind: 'packet',
    from: 0xa1b2c3d4,
    to: 0x1324b352,
    channel: 0,
    id: 2002,
    rxTime: 1700000000,
    snr: 6.5,
    hopsAway: 2,
    viaMqtt: false,
    port: 'text',
    data: 'Message privé ✓',
  });
  const env = decodeFromRadio(SYNTHETIC['environment telemetry']).data.environment;
  assert.equal(env.temperature.toFixed(1), '12.4');
  assert.equal(env.humidity, 81.5);
  assert.equal(env.pressure.toFixed(1), '1009.8');
  assert.equal(decodeFromRadio(SYNTHETIC.nodeinfo).data.longName, 'Relais Colline');
});

test('a packet that used all its hops (hop_limit 0, absent on the wire) tells them', async () => {
  const { encode } = await import('../src/protobuf.js');
  const data = encode([
    [1, 'varint', 1],
    [2, 'bytes', Buffer.from('loin')],
  ]);
  const packet = encode([
    [1, 'fixed32', 5],
    [4, 'message', data],
    [15, 'varint', 3],
  ]);
  assert.equal(decodeFromRadio(encode([[2, 'message', packet]])).hopsAway, 3);
});

test('a malformed message throws, the stream reader resyncs on garbage', () => {
  assert.throws(() => decodeFromRadio(Buffer.from([0x12, 0x05, 0x01])));
  const reader = new FrameReader();
  const good = frame(SYNTHETIC['text broadcast']);
  const out = [
    ...reader.push(Buffer.from('debug line\n')),
    ...reader.push(Buffer.from([0x94, 0x00, 0x94])), // a false start
    ...reader.push(good.subarray(0, 5)),
    ...reader.push(Buffer.concat([good.subarray(5), good])),
  ];
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], SYNTHETIC['text broadcast']);
});

test('the JSON topic is split, the downlink topic and encrypted packets are ignored', () => {
  assert.deepEqual(parseJsonTopic('msh/EU_868/2/json/LongFast/!a1b2c3d4'), {
    prefix: 'msh/EU_868',
    channelName: 'LongFast',
    gateway: '!a1b2c3d4',
  });
  assert.equal(parseJsonTopic('msh/2/json/mqtt/'), null);
  assert.equal(parseJsonTopic('msh/2/e/LongFast/!a1b2c3d4'), null);
  assert.equal(parseJsonMessage('msh/2/json/LongFast/!a', 'not json'), null);
});

test('JSON telemetry: device and environment metrics told apart', () => {
  const at = (payload) =>
    parseJsonMessage(
      'msh/2/json/LongFast/!a1b2c3d4',
      JSON.stringify({ from: 1, id: 2, type: 'telemetry', payload }),
    ).data;
  // Field names of the firmware serializer (MeshPacketSerializer.cpp).
  assert.deepEqual(
    at({ battery_level: 101, voltage: 4.2, channel_utilization: 1, uptime_seconds: 5 }),
    {
      device: { battery: 100, powered: true, voltage: 4.2, channelUtilization: 1, uptime: 5 },
    },
  );
  assert.deepEqual(
    at({ temperature: 0, relative_humidity: 40, barometric_pressure: 1000, voltage: 3 }),
    {
      environment: { temperature: 0, humidity: 40, pressure: 1000 },
    },
  );
});

test('node ids, and a text cut to 200 bytes on a character boundary', () => {
  assert.equal(nodeNum('!a1b2c3d4'), 0xa1b2c3d4);
  assert.equal(nodeNum('2712847316'), 0xa1b2c3d4);
  assert.equal(nodeNum('!zz'), null);
  assert.deepEqual(clipText('court'), { text: 'court', clipped: false });
  const cut = clipText('€'.repeat(100)); // 3 bytes each
  assert.equal(cut.clipped, true);
  assert.equal(Buffer.byteLength(cut.text), 198);
  assert.equal(cut.text, '€'.repeat(66));
});
