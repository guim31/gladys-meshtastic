// -----------------------------------------------------------------------------
// The MQTT client: subscribed to the Meshtastic JSON topics; publishes only the JSON downlink of a text.
//
// mqtt.js reconnects by itself; this module reports the link state:
//   - connected   the broker accepted us and the subscriptions;
//   - refused     bad user name or password (CONNACK 4/5, v5 134/135), or
//                 subscriptions refused by the ACL;
//   - unreachable no answer, connection lost, TLS failure.
// The credentials go in the connection options, never in a logged address.
// -----------------------------------------------------------------------------

import mqtt from 'mqtt';

export const RECONNECT_PERIOD_MS = 15 * 1000;
export const CONNECT_TIMEOUT_MS = 10 * 1000;
export const KEEPALIVE_S = 30;

/** A percent-encoded URL part; a malformed one is kept as typed. */
function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Bad credentials, by CONNACK code (v3.1.1: 4, 5; v5: 134, 135) or message. */
export const isRefusal = (err) =>
  [4, 5, 134, 135].includes(err?.code) || /not authori[sz]ed|bad user name/i.test(err?.message);

/**
 * @param {object} options
 * @param {string} options.url broker URL (mqtt://, mqtts://, ws://, wss://)
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string} options.clientId stable, unique per installation
 * @param {boolean} [options.tlsInsecure] accept a self-signed certificate
 * @param {string[]} options.topics
 * @param {(topic: string, payload: Buffer) => void} options.onMessage
 * @param {(state: string, detail?: string) => void} options.onState
 * @param {Function} [options.connect] test seam: mqtt.connect
 */
export function createClient({
  url,
  username = '',
  password = '',
  clientId,
  tlsInsecure = false,
  topics,
  onMessage,
  onState,
  connect = mqtt.connect,
}) {
  let state = null;
  let stopped = false;
  const parsed = new URL(url);
  // Credentials typed in the URL (mqtt://user:pass@host) are honoured, the
  // dedicated fields win.
  const user = username || decode(parsed.username);
  const pass = password || decode(parsed.password);
  parsed.username = '';
  parsed.password = '';

  const client = connect(parsed.toString(), {
    clientId,
    ...(user ? { username: user } : {}),
    ...(pass ? { password: pass } : {}),
    reconnectPeriod: RECONNECT_PERIOD_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
    keepalive: KEEPALIVE_S,
    // mqtt.js stops retrying after a CONNACK error: the user fixing the broker
    // must not have to save the configuration again.
    reconnectOnConnackError: true,
    // Nothing to catch up on: the packets are live.
    clean: true,
    ...(tlsInsecure ? { rejectUnauthorized: false } : {}),
  });

  const setState = (next, detail) => {
    // Closing the client on purpose (new configuration, shutdown) is not an
    // outage.
    if (stopped || state === next) {
      return;
    }
    state = next;
    onState(next, detail);
  };

  client.on('connect', () => {
    client.subscribe(topics, { qos: 0 }, (err, granted) => {
      if (stopped) {
        return;
      }
      if (err) {
        setState('refused', `subscription failed (${err.message})`);
        return;
      }
      // 128 (v3.1.1) and 135 (v5): the broker refuses the subscription.
      if ((granted ?? []).some((grant) => grant.qos >= 128)) {
        setState('refused', 'subscription refused');
        return;
      }
      setState('connected');
    });
  });

  client.on('message', (topic, payload) => {
    if (!stopped) {
      onMessage(topic, payload);
    }
  });

  client.on('error', (err) => {
    setState(isRefusal(err) ? 'refused' : 'unreachable', err?.message);
  });

  client.on('offline', () => {
    // After a refusal mqtt.js goes offline before retrying: still a login
    // problem, until a retry fails otherwise (ECONNREFUSED -> unreachable).
    if (state !== 'refused') {
      setState('unreachable', 'offline');
    }
  });
  client.on('close', () => {
    if (state === 'connected') {
      setState('unreachable', 'connection closed');
    }
  });

  return {
    get state() {
      return state;
    },
    /** @returns {Promise<void>} resolved once handed to the broker (QoS 0) */
    publish(topic, payload) {
      return new Promise((resolve, reject) => {
        if (state !== 'connected') {
          reject(new Error('not connected to the broker'));
          return;
        }
        client.publish(topic, payload, { qos: 0 }, (err) => (err ? reject(err) : resolve()));
      });
    },
    stop() {
      stopped = true;
      client.removeAllListeners('message');
      client.end(true);
    },
  };
}
