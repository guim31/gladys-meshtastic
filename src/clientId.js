// -----------------------------------------------------------------------------
// The MQTT client id: unique per installation and stable across restarts, so
// the broker logs and ACL `pattern` rules always see the same client. Drawn
// once, kept in /data (the one writable volume). A /data that cannot be
// written falls back to an id for this run only.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CLIENT_ID_PREFIX = 'gladys-meshtastic-';
const VALID = /^gladys-meshtastic-[0-9a-f]{8}$/;

export const newClientId = () => `${CLIENT_ID_PREFIX}${randomBytes(4).toString('hex')}`;

/**
 * @param {string} [dir] the data directory
 * @returns {Promise<{ clientId: string, persisted: boolean }>}
 */
export async function loadClientId(dir = process.env.DATA_DIR || '/data') {
  const file = join(dir, 'client-id');
  try {
    const stored = (await readFile(file, 'utf8')).trim();
    if (VALID.test(stored)) {
      return { clientId: stored, persisted: true };
    }
  } catch {
    // First start: drawn below.
  }
  const clientId = newClientId();
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, `${clientId}\n`, 'utf8');
    return { clientId, persisted: true };
  } catch {
    return { clientId, persisted: false };
  }
}
