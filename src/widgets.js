// -----------------------------------------------------------------------------
// The "Meshtastic mesh" dashboard widget:
//   - one status line per node added in Gladys (its Gladys name): battery and
//     how long ago it was heard, red when offline (10 lines at most, online
//     nodes first);
//   - the last text message received (body text), hidden by a setting;
//   - a "Send a message" button opening a form (text, channel), hidden by a
//     setting. Button forms need Gladys 5.2.0 (#3168).
// Pre-localized from the viewer's `language` (the core caches the content per
// settings, language and units).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { isConfigured } from './config.js';
import { WIDGET_KEY } from './hub.js';
import { formatAgo, formatHeard, pick } from './texts.js';

export const WIDGET = {
  MESH: WIDGET_KEY,
};
export const WIDGET_ACTION = {
  SEND: 'send',
};

export const CONTENT_TTL_SECONDS = 60;
export const MAX_LINES = 10;
export const CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7];

export const TEXT = {
  en: {
    notConfigured:
      'Enter the address of a Meshtastic node or of the MQTT broker in the configuration.',
    noNode: 'Add the nodes to Gladys first (Discovery tab of the integration).',
    offline: 'Offline',
    never: 'Not heard yet',
    lastMessage: (name, channel, time, text) => `${name} (${channel}, ${time}): ${text}`,
    direct: 'direct',
    channel: (index, name) => (name ? `Channel ${index} · ${name}` : `Channel ${index}`),
    send: 'Send a message',
    text: 'Message',
    channelField: 'Channel',
    sent: 'Message sent.',
    clipped: 'Message cut to 200 bytes and sent.',
  },
  fr: {
    notConfigured:
      "Saisissez l'adresse d'un nœud Meshtastic ou du broker MQTT dans la configuration.",
    noNode: "Ajoutez d'abord les nœuds à Gladys (onglet Découverte de l'intégration).",
    offline: 'Hors ligne',
    never: 'Pas encore entendu',
    lastMessage: (name, channel, time, text) => `${name} (${channel}, ${time}) : ${text}`,
    direct: 'direct',
    channel: (index, name) => (name ? `Canal ${index} · ${name}` : `Canal ${index}`),
    send: 'Envoyer un message',
    text: 'Message',
    channelField: 'Canal',
    sent: 'Message envoyé.',
    clipped: 'Message coupé à 200 octets et envoyé.',
  },
  de: {
    notConfigured:
      'Gib die Adresse eines Meshtastic-Knotens oder des MQTT-Brokers in der Konfiguration ein.',
    noNode: 'Füge die Knoten zuerst zu Gladys hinzu (Tab „Erkennung“ der Integration).',
    offline: 'Offline',
    never: 'Noch nicht gehört',
    lastMessage: (name, channel, time, text) => `${name} (${channel}, ${time}): ${text}`,
    direct: 'direkt',
    channel: (index, name) => (name ? `Kanal ${index} · ${name}` : `Kanal ${index}`),
    send: 'Nachricht senden',
    text: 'Nachricht',
    channelField: 'Kanal',
    sent: 'Nachricht gesendet.',
    clipped: 'Nachricht auf 200 Bytes gekürzt und gesendet.',
  },
  es: {
    notConfigured:
      'Introduzca la dirección de un nodo Meshtastic o del broker MQTT en la configuración.',
    noNode: 'Añada primero los nodos a Gladys (pestaña Descubrimiento de la integración).',
    offline: 'Fuera de línea',
    never: 'Aún no oído',
    lastMessage: (name, channel, time, text) => `${name} (${channel}, ${time}): ${text}`,
    direct: 'directo',
    channel: (index, name) => (name ? `Canal ${index} · ${name}` : `Canal ${index}`),
    send: 'Enviar un mensaje',
    text: 'Mensaje',
    channelField: 'Canal',
    sent: 'Mensaje enviado.',
    clipped: 'Mensaje cortado a 200 bytes y enviado.',
  },
};

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const localized = (text) => ({ en: text, fr: text, de: text, es: text });
const bool = (value, fallback) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : fallback;

const textContent = (text) => ({
  ttl_seconds: CONTENT_TTL_SECONDS,
  components: [{ type: 'text', variant: 'body', text: clip(text, 300) }],
});

/**
 * The channels offered by the send form: the enabled ones of a TCP node
 * (with their names), all eight over MQTT (the gateway's are unknown).
 * @param {Map<number, { name: string, role: number }>} channels
 */
export function channelOptions(channels, language) {
  const text = pick(TEXT, language);
  const known = [...channels.entries()].filter(([, channel]) => channel.role !== 0);
  const list =
    known.length > 0
      ? known.map(([index, channel]) => [index, channel.name])
      : CHANNELS.map((index) => [index, '']);
  return list
    .sort((a, b) => a[0] - b[0])
    .map(([index, name]) => ({
      value: String(index),
      label: localized(clip(text.channel(index, name), 40)),
    }));
}

/**
 * Pure builder of the widget content.
 * @param {object} input
 * @param {{ name: string, online: boolean, battery: number|null, agoMs: number|null }[]} input.nodes
 * @param {{ name: string, direct: boolean, channel: number, at: number, text: string }|null} input.message
 * @param {Array<{ value: string, label: object }>} input.channels
 * @param {{ showMessage: boolean, showSend: boolean, hideOffline: boolean }} input.options
 * @param {string} input.language
 */
export function buildMeshContent({ nodes, message, channels, options, language }) {
  const text = pick(TEXT, language);
  const components = [];
  const lines = [...nodes]
    .filter((node) => !options.hideOffline || node.online)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, language))
    .slice(0, MAX_LINES)
    .map((node) => {
      const heard = node.agoMs === null ? text.never : formatAgo(node.agoMs, language);
      const value = node.online
        ? [node.battery === null ? null : `${node.battery} %`, heard].filter(Boolean).join(' · ')
        : `${text.offline} · ${heard}`;
      return {
        label: clip(node.name, 40),
        value: clip(value, 40),
        icon: node.online ? 'radio' : 'wifi-off',
        color: node.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
      };
    });
  if (lines.length > 0) {
    components.push({ type: 'status', items: lines });
  }
  if (options.showMessage && message) {
    const where = message.direct ? text.direct : text.channel(message.channel, '');
    components.push({
      type: 'text',
      variant: 'body',
      text: clip(
        text.lastMessage(message.name, where, formatHeard(message.at, language), message.text),
        300,
      ),
    });
  }
  if (options.showSend) {
    components.push({
      type: 'button',
      label: text.send,
      icon: 'send',
      style: 'secondary',
      action: {
        key: WIDGET_ACTION.SEND,
        fields: [
          { key: 'text', type: 'string', required: true, label: localized(text.text) },
          {
            key: 'channel',
            type: 'select',
            required: true,
            default: channels[0]?.value ?? '0',
            label: localized(text.channelField),
            options: channels,
          },
        ],
      },
    });
  }
  return { ttl_seconds: CONTENT_TTL_SECONDS, components };
}

/**
 * The onWidgetGet handler of the mesh widget.
 * @param {import('./hub.js').Hub} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function getMeshWidget(hub, { settings = {}, language = 'en' } = {}) {
  const text = pick(TEXT, language);
  if (!isConfigured(hub.config)) {
    return textContent(text.notConfigured);
  }
  const added = hub.addedNodes();
  if (added.length === 0) {
    return textContent(text.noNode);
  }
  const now = hub.now();
  const nodes = added.map(({ num, device }) => {
    const node = hub.mesh.nodes.get(num);
    return {
      name: device.name || node?.longName || '?',
      online: hub.isOnline(node, now),
      battery: node?.battery ?? null,
      agoMs: node?.lastHeard == null ? null : now - node.lastHeard,
    };
  });
  const last = hub.mesh.messages[hub.mesh.messages.length - 1] ?? null;
  const sender = last ? added.find((entry) => entry.num === last.from)?.device : null;
  const message = last ? { ...last, name: sender?.name || hub.mesh.displayName(last.from) } : null;
  return buildMeshContent({
    nodes,
    message,
    channels: channelOptions(hub.mesh.channels, language),
    options: {
      showMessage: bool(settings.show_message, true),
      showSend: bool(settings.show_send, true),
      hideOffline: bool(settings.hide_offline, false),
    },
    language,
  });
}

/**
 * The send button of the widget.
 * @returns {Promise<object>} the toast, in the four languages (the viewer's is not passed)
 */
export async function onMeshAction(hub, actionKey, params, { values = {} } = {}) {
  if (actionKey !== WIDGET_ACTION.SEND) {
    throw new Error(`Unknown widget action ${actionKey}`);
  }
  const channel = Number(values.channel ?? 0);
  const { clipped } = await hub.sendText({
    text: values.text,
    channel: CHANNELS.includes(channel) ? channel : 0,
  });
  return Object.fromEntries(
    Object.entries(TEXT).map(([lang, text]) => [lang, clipped ? text.clipped : text.sent]),
  );
}
