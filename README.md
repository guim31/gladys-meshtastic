# Meshtastic for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the
[Meshtastic](https://meshtastic.org) LoRa mesh: the nodes of your mesh as Gladys
devices, a scene trigger on every text message received, and a scene action to
send one.

> **Developed without LoRa hardware: feedback welcome.** It was tested against
> the official `meshtasticd` firmware in simulated-radio mode, over TCP and over
> MQTT (JSON), not against a real radio.

## Features

- **One device per node** you pick in the Discovery tab: online, last heard,
  signal (from the SNR of a direct reception), hops away, battery, battery
  voltage, distance from your Gladys house, temperature, humidity, pressure (the
  last ones when the node reports them).
- **Scene trigger "Message received"**, filtered by channel (or direct message)
  and sender node, with the text, the sender and the channel as variables. A
  message heard several times (relays, several gateways) fires once.
- **Scene action "Send a message"** on a channel or to one node (cut to 200
  bytes, the radio limit).
- **Widget "Meshtastic mesh"**: your nodes, the last message and a **Send a
  message** button with a form (Gladys 5.2.0).
- Never changes the configuration of the radio.

## Requirements

- Gladys Assistant 5.2.0 or later.
- **TCP**: a node on Wi-Fi or Ethernet (or `meshtasticd`), network API on port 4403. A node accepts one TCP client at a time.
- or **MQTT**: a local broker the MQTT module of a node publishes to, with JSON
  output on (not available on nRF52 boards). Sending needs a channel named
  `mqtt` with downlink on, on the gateway.
- USB serial and Bluetooth are not supported (the integration runs in a
  container).

## Installation

In Gladys: **Integrations → Install from GitHub**, then
`https://github.com/guim31/gladys-meshtastic`. Fill in the connection, press
**Check the connection**, and add your nodes from the **Discovery** tab. The full
documentation is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## Limitations

- Developed without LoRa hardware (see above).
- Over MQTT, only what a gateway publishes in JSON is seen; encrypted packets
  are ignored. Do not use the public broker.
- Waypoints, traceroutes, neighbor info and the other modules are not shown.

## Development

Node.js 22+, ESM, no build step. Runtime dependencies:
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and [`mqtt`](https://github.com/mqttjs/MQTT.js) (MIT). The Meshtastic protobufs
are decoded by a small hand-written codec (`src/protobuf.js`), from the field
numbers of the public `.proto` interface: the official generated libraries are
GPL-3.0.

```bash
npm install
npm test              # node --test, on the SDK's fake Gladys, a fake node and a fake broker
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js            SDK wiring (src/app.js registers the handlers)
src/app.js          handlers: discovery, action, scene action, widget, configuration
src/hub.js          link to the mesh, discovery, states, message trigger, sending
src/tcp.js          TCP client API: stream framing, want_config, heartbeat, reconnection
src/mqtt.js         MQTT client: link states (credentials never logged), downlink
src/meshtastic.js   FromRadio/ToRadio and MQTT JSON -> events, text encoding
src/protobuf.js     minimal protobuf wire codec
src/nodes.js        the mesh model: nodes, channels, last messages
src/devices.js      node devices and their features
src/scenes.js       "Send a message" scene action
src/widgets.js      "Meshtastic mesh" widget
src/texts.js        every text, in en/fr/de/es
test/fixtures/      frames captured from meshtasticd, its MQTT JSON
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core. Releases are made by the
**Release** workflow (Actions → Release); never edit the versions by hand. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [meshtastic/protobufs](https://github.com/meshtastic/protobufs) and the
  [firmware](https://github.com/meshtastic/firmware) (GPL-3.0) by the Meshtastic
  contributors: the field numbers and the JSON format were read from them; none
  of their code is included.
- `test/fixtures/`: captures from the official `meshtasticd` image in
  simulated-radio mode (invented MAC addresses), and test messages built with
  `@meshtastic/protobufs` (not shipped).
- Cover: the community "Meshtastic Powered" logo
  ([meshtastic/design](https://github.com/meshtastic/design/tree/master/Meshtastic%20Powered%20Logo),
  GPL-3.0), which the
  [trademark guidelines](https://meshtastic.org/docs/legal/licensing-and-trademark/)
  allow without a grant; it implies no endorsement by the Meshtastic project.
- [MQTT.js](https://github.com/mqttjs/MQTT.js) (MIT).

## Disclaimer

Meshtastic® is a registered trademark of Meshtastic LLC. This project is not
affiliated with, endorsed or sponsored by Meshtastic LLC.

## License

[Apache-2.0](LICENSE)
