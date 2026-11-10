// -----------------------------------------------------------------------------
// Meshtastic node -> Gladys device, one per node the user adds, keyed on the
// node number (the `!xxxxxxxx` id without its `!`), which the firmware derives
// from the radio's MAC address and keeps for the node's life.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
//   online       input/binary, heard within the offline delay;
//   last_heard   text/text, date and time it was last heard;
//   signal       signal/integer 0..5, from the SNR of the last direct reception;
//   hops         counter-sensor/integer, hops away from the receiving node;
//   battery      battery/integer % (a powered node without battery reads 100);
//   voltage      energy-sensor/voltage, V;
//   distance     distance-sensor/decimal, km from the Gladys house;
//   temperature, humidity, pressure: environment telemetry.
// Signal, hops and the last six only when the node has reported them (and the house is
// located, for the distance) when it is discovered; Gladys offers "Update" in
// the Discovery tab when one appears later.
// Pushed, never polled. Feature keys are forever: never renamed.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { FEATURE_NAMES, pick } from './texts.js';

export const NODE_TYPE = 'node';
export const MAX_DISTANCE_KM = 20_040; // half the Earth's circumference
export const MAX_HOPS = 7;

const hex = (num) => (num >>> 0).toString(16).padStart(8, '0');

export const nodeIds = (gladys, num) => gladys.externalIds(NODE_TYPE, hex(num));

/** The node number of a node device external id, null for anything else. */
export function nodeNumOf(gladys, externalId) {
  const prefix = gladys.externalIds(NODE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const rest = externalId.slice(prefix.length);
  return /^[0-9a-f]{8}$/.test(rest) ? Number.parseInt(rest, 16) : null;
}

/** The feature key of a feature external id (`...:node:a1b2c3d4:battery` -> `battery`). */
export const featureKeyOf = (externalId) => externalId.slice(externalId.lastIndexOf(':') + 1);

/**
 * The feature keys a node gets, in order.
 * @param {object} node from src/nodes.js
 * @param {boolean} hasHome a located Gladys house
 */
export function featureKeys(node, hasHome) {
  return [
    'online',
    'last_heard',
    // Not for a node never heard directly (or the TCP node itself).
    ...(node.snr !== null ? ['signal'] : []),
    ...(node.hopsAway !== null ? ['hops'] : []),
    ...(node.battery !== null ? ['battery'] : []),
    ...(node.voltage !== null ? ['voltage'] : []),
    ...(node.position && hasHome ? ['distance'] : []),
    ...(node.temperature !== null ? ['temperature'] : []),
    ...(node.humidity !== null ? ['humidity'] : []),
    ...(node.pressure !== null ? ['pressure'] : []),
  ];
}

const FEATURES = {
  online: { category: CAT.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
  last_heard: { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
  signal: { category: CAT.SIGNAL, type: TYPE.SIGNAL.QUALITY, min: 0, max: 5 },
  hops: { category: CAT.COUNTER_SENSOR, type: TYPE.SENSOR.INTEGER, min: 0, max: MAX_HOPS },
  battery: {
    category: CAT.BATTERY,
    type: TYPE.BATTERY.INTEGER,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  voltage: {
    category: CAT.ENERGY_SENSOR,
    type: TYPE.ENERGY_SENSOR.VOLTAGE,
    unit: UNIT.VOLT,
    min: 0,
    max: 30,
  },
  distance: {
    category: CAT.DISTANCE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.KM,
    min: 0,
    max: MAX_DISTANCE_KM,
  },
  temperature: {
    category: CAT.TEMPERATURE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.CELSIUS,
    min: -60,
    max: 100,
  },
  humidity: {
    category: CAT.HUMIDITY_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  pressure: {
    category: CAT.PRESSURE_SENSOR,
    type: TYPE.SENSOR.DECIMAL,
    unit: UNIT.HECTO_PASCAL,
    min: 300,
    max: 1100,
  },
};

export const ALL_FEATURE_KEYS = Object.keys(FEATURES);

/**
 * @param {object} gladys
 * @param {object} node from src/nodes.js
 * @param {string} language
 * @param {boolean} hasHome
 */
export function buildNodeDevice(gladys, node, language, hasHome) {
  const ids = nodeIds(gladys, node.num);
  const names = pick(FEATURE_NAMES, language);
  return {
    name: node.longName || node.shortName || node.id,
    external_id: ids.device,
    selector: ids.device,
    model: 'Meshtastic',
    should_poll: false,
    params: [{ name: 'node_id', value: node.id }],
    features: featureKeys(node, hasHome).map((key) => ({
      name: names[key],
      external_id: ids.feature(key),
      selector: ids.feature(key),
      read_only: true,
      has_feedback: false,
      ...FEATURES[key],
    })),
  };
}
