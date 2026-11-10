// -----------------------------------------------------------------------------
// Quiet logs: nothing at info level for a normal cycle (packets, telemetry,
// messages), one line when a failure starts and one when it ends, never a
// password.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeIds } from '../src/devices.js';
import {
  BROKER_URL,
  JSON_LINES,
  REMOTE,
  SYNTHETIC,
  addDiscovered,
  createWorld,
  flush,
} from './helpers/world.js';

/** Capture every log line at the given level and above. */
function captureLogs(t, level = 'debug') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.mock.method(console, 'warn', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('a normal cycle writes nothing at info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.node.accept();
  world.node.send(SYNTHETIC['remote node_info']);
  await flush();
  await world.hub.publishDiscovery();
  await addDiscovered(world, nodeIds(world.gladys, REMOTE).device);
  const lines = captureLogs(t, 'info');
  for (const name of ['device telemetry', 'environment telemetry', 'position', 'text broadcast']) {
    world.node.send(SYNTHETIC[name]);
  }
  await flush();
  await world.hub.tick();
  assert.deepEqual(lines, []);
});

test('a broker outage is told once, its end once, without the password', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const world = await createWorld({
    config: { connection: 'mqtt', broker_url: 'mqtt://alice:hunter2@broker.example:1883' },
  });
  t.after(() => world.app.stop());
  world.broker.accept();
  await flush();
  const lines = captureLogs(t, 'info');
  for (let i = 0; i < 5; i += 1) {
    world.broker.drop();
    world.broker.client.emit('error', new Error('connect ECONNREFUSED'));
    t.mock.timers.tick(15_000);
    await flush();
  }
  world.broker.accept();
  await flush();
  for (const { topic, payload } of JSON_LINES) {
    world.broker.send(topic, payload);
  }
  await flush();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /unreachable/);
  assert.match(lines[1], /Connected to mqtt:\/\/broker\.example:1883/);
  assert.doesNotMatch(lines.join('\n'), /hunter2|alice:/);
  assert.equal(BROKER_URL, 'mqtt://broker.example:1883');
});
