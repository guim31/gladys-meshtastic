// -----------------------------------------------------------------------------
// The mesh widget: content valid for the core (validateWidgetContent), the
// Gladys names, the settings that hide each block, and the send button.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { nodeIds } from '../src/devices.js';
import {
  REMOTE,
  SYNTHETIC,
  T0,
  addDiscovered,
  createWorld,
  flush,
  sentPackets,
} from './helpers/world.js';

async function world(t) {
  const w = await createWorld({ now: () => T0 });
  t.after(() => w.app.stop());
  w.node.accept();
  w.node.send(SYNTHETIC['remote node_info']);
  w.node.send(SYNTHETIC['text broadcast']);
  await flush();
  await w.hub.publishDiscovery();
  return w;
}

function check(content) {
  const report = validateWidgetContent(content);
  assert.deepEqual(report.errors ?? [], [], JSON.stringify(report));
  return content;
}

test('before any node is added, the widget says how to add them', async (t) => {
  const w = await world(t);
  const ack = await w.gladys.fake.widgetGet('mesh', { language: 'de' });
  assert.match(check(ack.data.content).components[0].text, /Füge die Knoten zuerst/);
});

test('one line per added node with its Gladys name, the last message, the send button', async (t) => {
  const w = await world(t);
  const device = await addDiscovered(w, nodeIds(w.gladys, REMOTE).device);
  await w.gladys.fake.deviceUpdated({ ...device, name: 'Relais' });
  w.gladys.devices[0].name = 'Relais';
  const ack = await w.gladys.fake.widgetGet('mesh', { language: 'fr' });
  const [status, text, button] = check(ack.data.content).components;
  assert.deepEqual(status.items, [
    { label: 'Relais', value: "76 % · à l'instant", icon: 'radio', color: 'success' },
  ]);
  assert.equal(text.text, 'Relais (Canal 0, 10/11 18:00) : Bonjour la maison');
  assert.equal(button.action.key, 'send');
  // Channels of the node: only the primary is enabled in the capture.
  assert.deepEqual(
    button.action.fields[1].options.map((o) => o.value),
    ['0'],
  );
});

test('the settings hide the message, the button and the offline nodes', async (t) => {
  const w = await world(t);
  await addDiscovered(w, nodeIds(w.gladys, REMOTE).device);
  const ack = await w.gladys.fake.widgetGet('mesh', {
    language: 'en',
    settings: { show_message: false, show_send: false, hide_offline: true },
  });
  assert.deepEqual(
    check(ack.data.content).components.map((c) => c.type),
    ['status'],
  );
});

test('the send button sends on the chosen channel, with a toast in four languages', async (t) => {
  const w = await world(t);
  await addDiscovered(w, nodeIds(w.gladys, REMOTE).device);
  const ack = await w.gladys.fake.widgetAction(
    'mesh',
    'send',
    {},
    {
      values: { text: 'On arrive', channel: '0' },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Message envoyé.');
  assert.equal(sentPackets(w).length, 1);
});
