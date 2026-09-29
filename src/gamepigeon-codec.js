/**
 * Minimal GamePigeon URL codec for the OpenPigeon wire protocol.
 * Adapted from @imsg-sdk/sdk 0.2.23 under Apache-2.0.
 * See NOTICE.md for source and license details.
 */

const A = 0x5deece66dn;
const C = 0xbn;
const MASK = (1n << 48n) - 1n;
const TWO_48 = Number(1n << 48n);
const SEED_MULTIPLIER = 239;

export const CURRENT_VERSION = 52;

class Rand48 {
  constructor(seed) {
    this.state = ((BigInt(seed) << 16n) | 0x330en) & MASK;
  }

  next() {
    this.state = (A * this.state + C) & MASK;
    return Number(this.state) / TWO_48;
  }
}

function popOrder(length) {
  const random = new Rand48(length * SEED_MULTIPLIER);
  const remaining = Array.from({ length }, (_, index) => index);
  const order = [];
  for (let index = 0; index < length; index += 1) {
    const selected = Math.floor(random.next() * remaining.length);
    order.push(remaining.splice(selected, 1)[0]);
  }
  return order;
}

export function encrypt(plaintext) {
  const random = new Rand48(plaintext.length * SEED_MULTIPLIER);
  const source = Array.from(plaintext);
  const result = [];
  for (let index = 0; index < plaintext.length; index += 1) {
    const selected = Math.floor(random.next() * source.length);
    result.push(source.splice(selected, 1)[0]);
  }
  return result.join("");
}

export function decrypt(ciphertext) {
  const order = popOrder(ciphertext.length);
  const result = new Array(ciphertext.length);
  for (let index = 0; index < ciphertext.length; index += 1) {
    result[order[index]] = ciphertext[index];
  }
  return result.join("");
}

function dataEncode(value) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("&", "%26")
    .replaceAll("=", "%3D")
    .replaceAll("?", "%3F")
    .replaceAll("#", "%23")
    .replaceAll(" ", "%20");
}

function dataDecode(value) {
  return value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function replayEncode(value) {
  return value.replaceAll("&", "%26").replaceAll("#", "%23").replaceAll("|", "%7C");
}

function replayDecode(value) {
  return value.replaceAll("%26", "&").replaceAll("%23", "#").replaceAll("%7C", "|");
}

function splitEnvelope(url) {
  if (typeof url !== "string" || url.length > 16_384) {
    throw new Error("invalid GamePigeon URL");
  }

  let query;
  if (url.startsWith("data:?")) {
    query = url.slice("data:?".length);
  } else if (url.startsWith("https://gamepigeonapp.com/?")) {
    query = url.slice("https://gamepigeonapp.com/?".length);
  } else {
    throw new Error("unsupported GamePigeon URL");
  }

  let version = CURRENT_VERSION;
  let data = null;
  for (const item of query.split("&")) {
    if (item.startsWith("ver=")) version = Number.parseInt(item.slice(4), 10);
    if (item.startsWith("data=")) data = item.slice(5);
  }
  if (!Number.isInteger(version) || version < 1 || data === null) {
    throw new Error("malformed GamePigeon URL");
  }
  return { version, data };
}

export function parseGameUrl(url) {
  const { version, data } = splitEnvelope(url);
  let plaintext = decrypt(dataDecode(data));
  if (plaintext.startsWith("?")) plaintext = plaintext.slice(1);

  const fields = new Map();
  for (const item of plaintext.split("&")) {
    const equals = item.indexOf("=");
    if (equals < 0) continue;
    const key = item.slice(0, equals);
    const value = item.slice(equals + 1);
    fields.set(key, key === "replay" ? replayDecode(value) : value);
  }
  return { version, fields };
}

export function toGameUrl(fields, version = CURRENT_VERSION) {
  const parts = [];
  for (const [key, rawValue] of fields) {
    const value = key === "replay" ? replayEncode(rawValue) : rawValue;
    parts.push(`${key}=${value}`);
  }
  const data = dataEncode(encrypt(`?${parts.join("&")}`));
  return `data:?ver=${version}&data=${data}`;
}
