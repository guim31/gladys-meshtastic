# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-12

### Added

- The nodes of a Meshtastic LoRa mesh as Gladys devices, over TCP (a node on
  Wi-Fi or Ethernet, or `meshtasticd`, port 4403) or over MQTT (the JSON of a
  node's MQTT module): online, last heard, signal, hops away, battery, battery
  voltage, distance from home, temperature, humidity, pressure.
- Scene trigger "Message received", filtered by channel (or direct message) and
  sender node, with the text, the sender and the channel as variables; a message
  heard several times fires once.
- Scene action "Send a message", on a channel or directly to a node (cut to 200
  bytes).
- Widget "Meshtastic mesh": nodes with battery and last heard, the last message,
  and a "Send a message" button with a form; each block can be hidden.
- "Check the connection" action, documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-meshtastic/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-meshtastic/releases/tag/v1.0.0
