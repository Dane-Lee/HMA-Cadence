import { describe, it, expect, beforeEach } from 'vitest';
import {
  ROUTE_FOR,
  parseQrPayload,
  setQrPayload,
  readQrFragment,
  clearQrFragment,
} from '../src/lib/qr/fragment.js';

beforeEach(() => {
  clearQrFragment();
});

describe('parseQrPayload', () => {
  // The camera path hands us a bare fragment; the in-app scanner hands us the
  // whole URL the QR encodes. Both have to land in the same place.
  it('reads a bare fragment', () => {
    expect(parseQrPayload('#p=AbC_123-xyz')).toEqual({ kind: 'p', data: 'AbC_123-xyz' });
    expect(parseQrPayload('#k=deadbeef')).toEqual({ kind: 'k', data: 'deadbeef' });
  });

  it('reads the full URL a printed QR actually contains', () => {
    expect(parseQrPayload('https://cadence.example.com/#p=AbC_123')).toEqual({
      kind: 'p',
      data: 'AbC_123',
    });
    expect(parseQrPayload('https://host.taile5ae01.ts.net/#k=Zm9v')).toEqual({
      kind: 'k',
      data: 'Zm9v',
    });
  });

  it('accepts a code from a different host, because the envelope is what authenticates', () => {
    // Rejecting on host would break the day the deployment moves, and buys
    // nothing: a plan is sealed to a device key and simply will not open.
    expect(parseQrPayload('https://somewhere-else.test/#p=AAAA')).toEqual({
      kind: 'p',
      data: 'AAAA',
    });
  });

  it('tolerates surrounding whitespace from a decoder', () => {
    expect(parseQrPayload('  https://x.test/#p=AAAA \n')).toEqual({ kind: 'p', data: 'AAAA' });
  });

  it('returns null for anything that is not one of our codes', () => {
    for (const junk of [
      '',
      null,
      undefined,
      'https://example.com',
      'https://example.com/#q=AAAA',   // wrong kind
      '#p=',                           // no payload
      '#p=has spaces',
      '#p=not+base64url',              // + and / are not in the base64url alphabet
      'just some text',
    ]) {
      expect(parseQrPayload(junk), String(junk)).toBeNull();
    }
  });

  it('does not match a payload followed by trailing content', () => {
    // Anchored at the end so a code carrying extra data is refused outright
    // rather than silently truncated to something that looks valid.
    expect(parseQrPayload('https://x.test/#p=AAAA&extra=1')).toBeNull();
  });
});

describe('setQrPayload', () => {
  it('makes a scanned payload readable by the handling route', () => {
    setQrPayload({ kind: 'p', data: 'AAAA' });
    expect(readQrFragment('p')).toBe('AAAA');
  });

  it('does not hand a plan to the pairing route, or the reverse', () => {
    setQrPayload({ kind: 'k', data: 'KEY' });
    expect(readQrFragment('p')).toBeNull();
    expect(readQrFragment('k')).toBe('KEY');
  });

  it('is non-consuming, so a StrictMode remount still sees it', () => {
    setQrPayload({ kind: 'p', data: 'AAAA' });
    expect(readQrFragment('p')).toBe('AAAA');
    expect(readQrFragment('p')).toBe('AAAA');
  });

  it('is cleared on demand', () => {
    setQrPayload({ kind: 'p', data: 'AAAA' });
    clearQrFragment();
    expect(readQrFragment('p')).toBeNull();
  });
});

describe('ROUTE_FOR', () => {
  it('sends each kind to the page that handles it', () => {
    expect(ROUTE_FOR.k).toBe('/pair');
    expect(ROUTE_FOR.p).toBe('/plan');
  });
});
