/**
 * QR envelope v1 — format and crypto.
 *
 * The committed vectors are the interop contract with the Tracker: if either app
 * stops decoding them, the handoff is broken. They pin the DECODE direction
 * only — DEFLATE output can differ between zlib builds, so encoding is verified
 * by round-trip instead of byte equality.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ENVELOPE_VERSION,
  EnvelopeError,
  IV_BYTES,
  KEY_BYTES,
  decryptPlanEnvelope,
  encodePlanEnvelope,
  fromBase64Url,
  generatePlanKey,
  importPlanKey,
  keyIdFor,
  keyIdToHex,
  parsePlanEnvelope,
  toBase64Url,
} from '../src/lib/qr/envelope.js';

const VECTORS = JSON.parse(readFileSync(new URL('./vectors/qr-envelope-v1.json', import.meta.url)));
const hex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));

async function freshKey({ extractable = true } = {}) {
  const raw = generatePlanKey();
  return { raw, key: await importPlanKey(raw, { extractable }), keyId: await keyIdFor(raw) };
}

describe('base64url', () => {
  it('round-trips arbitrary bytes without padding or unsafe characters', () => {
    for (const len of [1, 2, 3, 31, 32, 257]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      const encoded = toBase64Url(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes));
    }
  });

  it('rejects anything that is not base64url', () => {
    expect(() => fromBase64Url('has spaces')).toThrow(EnvelopeError);
    expect(() => fromBase64Url('plus+slash/')).toThrow(EnvelopeError);
  });
});

describe('committed vectors', () => {
  it('agree with keyIdFor on the pinned key', async () => {
    expect(keyIdToHex(await keyIdFor(hex(VECTORS.raw_key_hex)))).toBe(VECTORS.key_id_hex);
  });

  for (const [name, vec] of Object.entries(VECTORS.vectors)) {
    it(`decodes "${name}" to the exact payload`, async () => {
      const key = await importPlanKey(hex(VECTORS.raw_key_hex), { extractable: false });
      const parsed = parsePlanEnvelope(vec.envelope);
      expect(parsed.version).toBe(ENVELOPE_VERSION);
      expect(keyIdToHex(parsed.keyId)).toBe(VECTORS.key_id_hex);
      expect(await decryptPlanEnvelope(parsed, key)).toEqual(vec.payload);
    });
  }

  it('keeps a 12-exercise plan inside single-QR capacity', () => {
    // Byte mode caps at 2,331 bytes (v40-M). Leave room for the URL prefix.
    expect(VECTORS.vectors.twelve_exercises.envelope.length).toBeLessThan(2000);
  });
});

describe('round-trip', () => {
  it('recovers the payload it was given', async () => {
    const { key, keyId } = await freshKey();
    const payload = VECTORS.vectors.minimal.payload;
    const parsed = parsePlanEnvelope(await encodePlanEnvelope(payload, { key, keyId }));
    expect(await decryptPlanEnvelope(parsed, key)).toEqual(payload);
  });

  it('uses a fresh IV per plan, so identical payloads produce different envelopes', async () => {
    const { key, keyId } = await freshKey();
    const payload = VECTORS.vectors.minimal.payload;
    const a = await encodePlanEnvelope(payload, { key, keyId });
    const b = await encodePlanEnvelope(payload, { key, keyId });
    expect(a).not.toBe(b);
    expect(parsePlanEnvelope(a).iv).not.toEqual(parsePlanEnvelope(b).iv);
  });

  it('writes the documented header layout', async () => {
    const { key, keyId } = await freshKey();
    const bytes = fromBase64Url(await encodePlanEnvelope({ a: 1 }, { key, keyId }));
    expect(bytes[0]).toBe(ENVELOPE_VERSION);
    expect(Array.from(bytes.slice(1, 5))).toEqual(Array.from(keyId));
    expect(bytes.length).toBeGreaterThan(1 + 4 + IV_BYTES);
  });
});

describe('rejections', () => {
  it('refuses a key that is not 32 bytes', async () => {
    await expect(importPlanKey(new Uint8Array(KEY_BYTES - 1))).rejects.toThrow(EnvelopeError);
  });

  it('flags an unsupported envelope version', async () => {
    const { key, keyId } = await freshKey();
    const bytes = fromBase64Url(await encodePlanEnvelope({ a: 1 }, { key, keyId }));
    bytes[0] = 99;
    expect(() => parsePlanEnvelope(toBase64Url(bytes))).toThrow(
      expect.objectContaining({ code: 'unsupported_version' }),
    );
  });

  it('rejects an envelope with no room for a body', () => {
    expect(() => parsePlanEnvelope(toBase64Url(new Uint8Array(17)))).toThrow(
      expect.objectContaining({ code: 'malformed' }),
    );
  });

  it('fails to decrypt under a different key', async () => {
    const mine = await freshKey();
    const theirs = await freshKey();
    const parsed = parsePlanEnvelope(
      await encodePlanEnvelope({ a: 1 }, { key: mine.key, keyId: mine.keyId }),
    );
    await expect(decryptPlanEnvelope(parsed, theirs.key)).rejects.toThrow(
      expect.objectContaining({ code: 'decrypt_failed' }),
    );
  });

  it('fails to decrypt tampered ciphertext', async () => {
    const { key, keyId } = await freshKey();
    const bytes = fromBase64Url(await encodePlanEnvelope({ a: 1 }, { key, keyId }));
    bytes[bytes.length - 1] ^= 0xff; // flip a bit in the GCM tag
    await expect(decryptPlanEnvelope(parsePlanEnvelope(toBase64Url(bytes)), key)).rejects.toThrow(
      expect.objectContaining({ code: 'decrypt_failed' }),
    );
  });

  it('fails to decrypt when the IV is altered', async () => {
    const { key, keyId } = await freshKey();
    const bytes = fromBase64Url(await encodePlanEnvelope({ a: 1 }, { key, keyId }));
    bytes[6] ^= 0x01;
    await expect(decryptPlanEnvelope(parsePlanEnvelope(toBase64Url(bytes)), key)).rejects.toThrow(
      expect.objectContaining({ code: 'decrypt_failed' }),
    );
  });
});

describe('key generation', () => {
  it('produces 32 distinct random bytes each call', () => {
    const a = generatePlanKey();
    const b = generatePlanKey();
    expect(a.length).toBe(KEY_BYTES);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('derives a stable 4-byte keyId', async () => {
    const raw = hex(VECTORS.raw_key_hex);
    expect(keyIdToHex(await keyIdFor(raw))).toBe(keyIdToHex(await keyIdFor(raw)));
    expect(VECTORS.key_id_hex).toHaveLength(8);
  });
});
