// -----------------------------------------------------------------------------
// A minimal protobuf wire codec: just what the Meshtastic client API needs.
//
// The official generated code (@meshtastic/protobufs, @meshtastic/core) is
// GPL-3.0; this integration is Apache-2.0 and ships as an image. Only the
// field numbers of the public .proto interface are used here (see
// src/meshtastic.js), decoded and encoded by hand.
//
// decode() keeps every occurrence of a field; the readers below take the last
// one, as protobuf does for a non-repeated field.
// -----------------------------------------------------------------------------

const WIRE = { VARINT: 0, I64: 1, LEN: 2, I32: 5 };

/**
 * @param {Uint8Array} buffer
 * @returns {Map<number, Array<{ wire: number, value: bigint|Buffer }>>}
 * @throws on a truncated or malformed message
 */
export function decode(buffer) {
  const bytes = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const fields = new Map();
  let pos = 0;

  const varint = () => {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i += 1) {
      if (pos >= bytes.length) {
        throw new Error('truncated varint');
      }
      const byte = bytes[pos];
      pos += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7n;
    }
    throw new Error('varint too long');
  };
  const take = (length) => {
    if (length < 0 || pos + length > bytes.length) {
      throw new Error('truncated field');
    }
    const slice = bytes.subarray(pos, pos + length);
    pos += length;
    return slice;
  };

  while (pos < bytes.length) {
    const key = varint();
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) {
      throw new Error('field number 0');
    }
    let value;
    if (wire === WIRE.VARINT) {
      value = varint();
    } else if (wire === WIRE.I64) {
      value = take(8);
    } else if (wire === WIRE.LEN) {
      value = take(Number(varint()));
    } else if (wire === WIRE.I32) {
      value = take(4);
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
    if (!fields.has(field)) {
      fields.set(field, []);
    }
    fields.get(field).push({ wire, value });
  }
  return fields;
}

const last = (fields, field, wire) => {
  const list = (fields.get(field) ?? []).filter((entry) => entry.wire === wire);
  return list.length === 0 ? undefined : list[list.length - 1].value;
};

/** uint32 / uint64 / enum / bool (as a number) */
export function uint(fields, field) {
  const value = last(fields, field, WIRE.VARINT);
  return value === undefined ? undefined : Number(BigInt.asUintN(64, value));
}

/** int32 (sign-extended to 64 bits on the wire) */
export function int32(fields, field) {
  const value = last(fields, field, WIRE.VARINT);
  return value === undefined ? undefined : Number(BigInt.asIntN(32, value));
}

export function bool(fields, field) {
  const value = last(fields, field, WIRE.VARINT);
  return value === undefined ? undefined : value !== 0n;
}

export function fixed32(fields, field) {
  const value = last(fields, field, WIRE.I32);
  return value === undefined ? undefined : value.readUInt32LE(0);
}

export function sfixed32(fields, field) {
  const value = last(fields, field, WIRE.I32);
  return value === undefined ? undefined : value.readInt32LE(0);
}

export function float(fields, field) {
  const value = last(fields, field, WIRE.I32);
  return value === undefined ? undefined : value.readFloatLE(0);
}

export function bytes(fields, field) {
  return last(fields, field, WIRE.LEN);
}

export function string(fields, field) {
  const value = last(fields, field, WIRE.LEN);
  return value === undefined ? undefined : value.toString('utf8');
}

/** An embedded message, decoded; undefined when absent. */
export function message(fields, field) {
  const value = last(fields, field, WIRE.LEN);
  return value === undefined ? undefined : decode(value);
}

// --- encoding ----------------------------------------------------------------

function encodeVarint(value) {
  let rest = BigInt.asUintN(64, BigInt(value));
  const out = [];
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest !== 0n) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (rest !== 0n);
  return Buffer.from(out);
}

const key = (field, wire) => encodeVarint((field << 3) | wire);

/**
 * Builds a message from [field, kind, value] entries; undefined values are
 * skipped. kind: 'varint' | 'bool' | 'fixed32' | 'bytes' | 'string' | 'message'
 * ('message' takes the Buffer of an encoded message).
 * @param {Array<[number, string, any]>} entries
 * @returns {Buffer}
 */
export function encode(entries) {
  const parts = [];
  for (const [field, kind, value] of entries) {
    if (value === undefined || value === null) {
      continue;
    }
    if (kind === 'varint' || kind === 'bool') {
      parts.push(key(field, WIRE.VARINT), encodeVarint(kind === 'bool' ? Number(value) : value));
    } else if (kind === 'fixed32') {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32LE(value >>> 0, 0);
      parts.push(key(field, WIRE.I32), buffer);
    } else {
      const buffer = kind === 'string' ? Buffer.from(String(value), 'utf8') : Buffer.from(value);
      parts.push(key(field, WIRE.LEN), encodeVarint(buffer.length), buffer);
    }
  }
  return Buffer.concat(parts);
}
