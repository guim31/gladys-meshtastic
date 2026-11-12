# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- `/data` holds only the MQTT client id. The configuration (node address,
  broker address, user name and password) is kept by Gladys; the password is
  never written in the logs, nor any address with credentials.
- Received text messages are kept in memory only (the last 20, for the
  widget), never on disk.
- Network: TCP to the configured node (port 4403 by default), or MQTT to the
  configured broker (TLS with `mqtts://`). Nothing else, no cloud service.
  The Meshtastic client API has no authentication: anyone on the network who
  reaches the node can do what the integration does, keep it on a trusted
  network.
- The integration only sends text messages on the mesh; it never changes the
  configuration of the radio.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Meshtastic firmware, and the brokers and devices the integration talks to.
