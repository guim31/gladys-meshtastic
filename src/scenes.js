// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`).
//
// `send_message` — sends a text on a channel of the mesh, or as a direct
// message to one node when a node device is picked. Errors (empty text, not
// connected, unknown node) fail the action with a message in the language of
// the configuration (a scene action does not receive the user's). A text over
// 200 bytes is cut, as the Meshtastic apps do, and said in `clipped`.
// -----------------------------------------------------------------------------

import { nodeNumOf } from './devices.js';
import { BROADCAST } from './meshtastic.js';
import { pick, SEND_TEXT } from './texts.js';
import { CHANNELS } from './widgets.js';

export const SCENE_ACTION = {
  SEND_MESSAGE: 'send_message',
};

/**
 * @param {import('./hub.js').Hub} hub
 * @param {{ text?: string, channel?: string, node?: string }} fields
 */
export async function sendMessage(hub, fields = {}) {
  const text = pick(SEND_TEXT, hub.config?.language ?? 'fr');
  const asked = Number(fields.channel ?? 0);
  const channel = CHANNELS.includes(asked) ? asked : 0;
  let to = BROADCAST;
  if (fields.node) {
    to = nodeNumOf(hub.gladys, fields.node);
    if (to === null) {
      throw new Error(text.unknownNode);
    }
  }
  const { clipped } = await hub.sendText({
    text: fields.text,
    channel,
    to,
  });
  const device = (hub.gladys.devices ?? []).find((d) => d.external_id === fields.node);
  const summary =
    to === BROADCAST
      ? text.sentChannel(channel)
      : text.sentNode(device?.name || hub.mesh.displayName(to));
  return { sent: true, clipped, summary };
}
