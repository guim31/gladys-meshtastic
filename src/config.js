// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with blanks, strings or `undefined`.
// -----------------------------------------------------------------------------

import { nodeNum } from './meshtastic.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const CONNECTIONS = ['tcp', 'mqtt'];
// Minutes without hearing a node before it is shown offline. Meshtastic
// sends device telemetry every 30 min and node info every 3 h by default.
export const OFFLINE_AFTER_CHOICES = ['30', '60', '120', '180', '360'];

export const DEFAULT_CONFIG = {
  connection: 'tcp',
  host: '',
  port: 4403,
  broker_url: '',
  username: '',
  password: '',
  tls_insecure: false,
  topic_root: 'msh',
  gateway: '',
  offline_after: '120',
  language: 'fr',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const bool = (value, fallback) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : fallback;

/**
 * The broker address, with its scheme: users type `192.0.2.10`,
 * `192.0.2.10:1883` or a full `mqtt://` / `mqtts://` URL.
 * @returns {string} '' when absent or not a broker URL
 */
export function normalizeBrokerUrl(value) {
  const raw = text(value);
  if (raw === '') {
    return '';
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `mqtt://${raw}`;
  try {
    const url = new URL(withScheme);
    return ['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(url.protocol) && url.hostname
      ? withScheme
      : '';
  } catch {
    return '';
  }
}

/**
 * The node address: a host name or an IP, without scheme; `host:port` is
 * accepted and splits.
 * @returns {{ host: string, port: number|null }}
 */
export function normalizeHost(value) {
  let raw = text(value)
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '');
  let port = null;
  const withPort = raw.match(/^(\[[^\]]+\]|[^:]+):(\d{1,5})$/);
  if (withPort) {
    raw = withPort[1];
    port = Number(withPort[2]);
  }
  raw = raw.replace(/^\[|\]$/g, '');
  return /^[\w.:-]+$/.test(raw) ? { host: raw, port } : { host: '', port: null };
}

const validPort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
};

/**
 * The root topic of the Meshtastic MQTT module (`msh` by default, the region
 * is appended by the firmware): no wildcard, no leading or trailing slash.
 */
export function normalizeRoot(value) {
  const raw = text(value).replace(/^\/+|\/+$/g, '');
  return raw === '' || /[#+]/.test(raw) ? DEFAULT_CONFIG.topic_root : raw;
}

/**
 * @param {object} [raw] the values received from Gladys
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  const { host, port: hostPort } = normalizeHost(source.host);
  return {
    connection: CONNECTIONS.includes(source.connection) ? source.connection : 'tcp',
    host,
    port: hostPort ?? validPort(source.port) ?? DEFAULT_CONFIG.port,
    broker_url: normalizeBrokerUrl(source.broker_url),
    username: text(source.username),
    // A password may legitimately start or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    tls_insecure: bool(source.tls_insecure, false),
    topic_root: normalizeRoot(source.topic_root),
    // The node that sends our texts over MQTT (`!a1b2c3d4`); null: the last gateway heard.
    gateway: text(source.gateway) === '' ? null : nodeNum(text(source.gateway)),
    // Milliseconds.
    offline_after_ms:
      Number(
        OFFLINE_AFTER_CHOICES.includes(String(source.offline_after ?? '').trim())
          ? String(source.offline_after).trim()
          : DEFAULT_CONFIG.offline_after,
      ) * 60_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

export const isConfigured = (config) =>
  Boolean(config) &&
  (config.connection === 'mqtt' ? Boolean(config.broker_url) : Boolean(config.host));

/** The address shown in logs and messages: never a user name or a password. */
export function safeAddress(config) {
  if (config.connection === 'tcp') {
    return `${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
  }
  try {
    const url = new URL(config.broker_url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '(invalid address)';
  }
}
