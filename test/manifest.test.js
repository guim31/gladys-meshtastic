// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTION } from '../src/app.js';
import { CONNECTIONS, DEFAULT_CONFIG, OFFLINE_AFTER_CHOICES } from '../src/config.js';
import { TRIGGER } from '../src/hub.js';
import { SCENE_ACTION } from '../src/scenes.js';
import { CHANNELS, WIDGET } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...(manifest.contact_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// Manifest fields older Gladys releases reject as unknown, with the first
// release accepting them. The store validator refuses a manifest whose
// `gladys_version` minimum is lower: these tests catch it before a release.
const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action has a registered handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions), Object.values(ACTION));
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  // The store vocabulary itself is checked by the store validator (unknown
  // keys are dropped with a warning there) — what this test pins is the
  // coupling rule: older cores reject any unknown manifest field, so a
  // manifest declaring `categories` must not claim compatibility below the
  // first release that accepts it.
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(
    isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.ok(declared.length > 0, 'the integration declares capability fields');
  assert.ok(
    isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION),
    `${declared.join(', ')} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
  );
});

test('every scene_actions key has an onSceneAction handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions), Object.values(SCENE_ACTION));
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), Object.values(WIDGET));
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  // An undeclared key is a 404 on publishSceneEvent; a declared key nobody
  // fires is a dead card in the scene editor.
  assert.deepEqual(keysOf(manifest.scene_triggers), Object.values(TRIGGER));
});

test('the choices are the ones the code reads', () => {
  const options = (list, key) =>
    list.find((f) => f.key === key).options.map((option) => option.value);
  assert.deepEqual(options(manifest.config_schema, 'connection'), CONNECTIONS);
  assert.deepEqual(options(manifest.config_schema, 'offline_after'), OFFLINE_AFTER_CHOICES);
  const channels = CHANNELS.map(String);
  const action = manifest.scene_actions.find((a) => a.key === SCENE_ACTION.SEND_MESSAGE);
  assert.deepEqual(options(action.fields, 'channel'), channels);
  const trigger = manifest.scene_triggers.find((t) => t.key === TRIGGER.MESSAGE_RECEIVED);
  assert.deepEqual(options(trigger.fields, 'channel'), ['direct', ...channels]);
});

test('the trigger filters are the keys of the event data, its variables too', () => {
  const trigger = manifest.scene_triggers.find((t) => t.key === TRIGGER.MESSAGE_RECEIVED);
  assert.deepEqual(
    trigger.fields.map((f) => [f.key, f.source ?? null, f.required ?? false]),
    [
      ['channel', null, false],
      ['sender', 'devices', false],
    ],
  );
  // The keys fired in src/hub.js (#fireMessage).
  assert.deepEqual(
    trigger.variables.map((v) => v.key),
    ['text', 'sender_name', 'sender_id', 'channel'],
  );
});

test('send_message: text and channel required (an action applies no default), node optional', () => {
  const action = manifest.scene_actions.find((a) => a.key === SCENE_ACTION.SEND_MESSAGE);
  assert.deepEqual(
    action.fields.map((f) => [f.key, f.required ?? false]),
    [
      ['text', true],
      ['channel', true],
      ['node', false],
    ],
  );
  assert.equal(action.fields[2].source, 'devices');
  assert.deepEqual(
    action.outputs.map((o) => o.key),
    ['sent', 'clipped', 'summary'],
  );
});

test('the password is a secret, nothing secret sits in an action form', () => {
  const password = manifest.config_schema.find((field) => field.key === 'password');
  assert.equal(password.type, 'secret');
  for (const action of manifest.actions) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `action ${action.key}: secret field`);
    }
  }
});

test('the manifest names Meshtastic, local transport, categories, location, button forms', () => {
  assert.equal(manifest.name, 'Meshtastic');
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['protocols', 'network', 'notifications']);
  assert.equal(manifest.type, 'device');
  // getHouses() for the distance feature.
  assert.equal(manifest.location, true);
  // The widget's send button opens a form: Gladys 5.2.0 (#3168).
  assert.equal(manifest.gladys_version, '>=5.2.0');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-meshtastic:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-meshtastic/main/cover.png',
  );
});

test('only the connection type is required (the address depends on it), no action has a form', () => {
  assert.deepEqual(
    manifest.config_schema.filter((field) => field.required).map((field) => field.key),
    ['connection'],
  );
  for (const action of manifest.actions) {
    assert.equal(action.fields, undefined, `action ${action.key} has a form`);
  }
});

test('the widget settings hide each optional block', () => {
  const widget = manifest.widgets.find((w) => w.key === WIDGET.MESH);
  assert.deepEqual(
    widget.settings.map((s) => [s.key, s.type, s.default]),
    [
      ['show_message', 'boolean', true],
      ['show_send', 'boolean', true],
      ['hide_offline', 'boolean', false],
    ],
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0, 'the configuration opens with a section block');
  for (const section of sections) {
    // A section stores NO value: declaring `required`, `default` or
    // `placeholder` on it rejects the manifest, and its key must never leak
    // into the config the code manipulates.
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(
      section.placeholder,
      undefined,
      `section "${section.key}" must not have a placeholder`,
    );
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `section "${section.key}" stores no value and must not appear in DEFAULT_CONFIG`,
    );
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0, 'the node pickers are dynamic selects');
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices', 'the only core-defined source in V1 is "devices"');
    assert.equal(
      field.options,
      undefined,
      `field "${field.key}": declaring source and options together rejects the manifest`,
    );
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by
  // hand, and Gladys would offer a version whose image is another one.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  // A store rule (the catalog card is short): a longer text rejects the
  // manifest.
  assert.ok(manifest.description.en, 'the description needs an English text');
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  // Like `label` and `description`: a plain string rejects the manifest.
  const withPlaceholder = allFields.filter((f) => f.placeholder !== undefined);
  assert.ok(withPlaceholder.length > 0, 'the address field has a placeholder');
  for (const field of withPlaceholder) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en, `field "${field.key}": placeholder needs an English text`);
  }
});
