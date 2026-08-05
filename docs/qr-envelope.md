# QR Envelope — v1

The wire format for the Tracker → Cadence handoff. Both apps implement this
independently; it is the only thing they share. Changing it requires bumping the
version byte and updating both sides.

There is **no network transport**. A plan travels as a QR code printed on the
employee's exercise sheet. A key travels as a QR code shown on the EIS laptop
during in-person pairing. Nothing is transmitted to any host.

---

## 1. Why a URL

Both QRs encode a URL so the phone's **native camera app** opens them — no
in-app scanner, no camera permission, no scanning library on either side.

```
Plan QR     https://<cadence-host>/#p=<base64url>
Pairing QR  https://<cadence-host>/#k=<base64url>
```

The payload lives in the **fragment** (after `#`). Fragments are never included
in an HTTP request, so loading the page does not send the plan or the key to the
host serving Cadence. Cadence reads the fragment in memory and immediately calls
`history.replaceState()` to strip it, so it does not persist in browser history
or sync to a Google/Apple account.

---

## 2. Plan envelope

`#p=` decodes (base64url) to:

| Offset | Bytes | Field                                    |
| ------ | ----- | ---------------------------------------- |
| 0      | 1     | `version` — currently `1`                |
| 1      | 4     | `keyId`                                  |
| 5      | 12    | `iv` — random per plan, never reused     |
| 17     | …     | `ciphertext` (AES-GCM, 16-byte tag last) |

**Plaintext** is the Plan Payload of `plan-payload-contract.md`, minified to
JSON, then compressed with raw DEFLATE (`CompressionStream('deflate-raw')`).

So: `JSON → minify → deflate-raw → AES-GCM → prepend header → base64url`.

- **Cipher:** AES-GCM, 256-bit key, 96-bit IV, 128-bit tag. Native WebCrypto —
  no crypto library on either side.
- **Additional authenticated data:** none. The header is not authenticated; a
  tampered `keyId` or `version` simply fails to find a key or fails to decrypt.

### keyId

`keyId = SHA-256(rawKey)[0..4]`

Four bytes is not a security boundary — it exists so Cadence can tell *"this
plan is not for this device"* apart from *"this data is corrupt"* and show the
right screen. Collisions are harmless: a wrong key fails GCM authentication.

---

## 3. Pairing envelope

`#k=` decodes (base64url) to exactly **32 raw bytes** — the employee's AES key.
No header, no version. Any other length is rejected.

The key is generated on the Tracker with
`crypto.getRandomValues(new Uint8Array(32))`, which draws from the operating
system's CSPRNG. It is not derived from employee data and carries no structure.

On arrival Cadence imports it as a **non-extractable** `CryptoKey` and stores it
in IndexedDB. Non-extractable means no script on that device — including
injected script — can read the raw bytes back out. localStorage cannot offer
this, which is why the key does not live there.

---

## 4. Base64url

RFC 4648 §5: `+` → `-`, `/` → `_`, padding (`=`) stripped. Chosen so the payload
survives a URL fragment without escaping and so QR alphanumeric-mode assumptions
never silently break.

---

## 5. Capacity

QR version 40 at error-correction level M holds ~2,330 bytes in byte mode; at
level H, ~1,270.

**Measured** against the committed vectors (full contract-v1 payloads, exercise
names and all):

| Plan            | Envelope |
| --------------- | -------- |
| 1 exercise      | 484 chars |
| 12 exercises    | 911 chars |

Plus roughly 30 characters of URL prefix. A realistic plan therefore fits inside
a single QR **with room to spare, even at the highest error-correction level** —
which matters on a sheet that will live in a locker and go through a wash cycle.

Payload slimming is therefore **not required for capacity**. It is still worth
doing for a different reason: sending badge number and exercise IDs instead of
names and instructions means the code carries no identifiable health information
at all. That is a privacy argument, not a size one — do not conflate them when
explaining this.

The Tracker **must** still refuse to print rather than emit an oversized,
unscannable code. Headroom is not a guarantee.

---

## 6. States Cadence must handle

| Condition                        | Result                                             |
| -------------------------------- | -------------------------------------------------- |
| Key present, decrypts, valid     | Plan applied                                       |
| No key on this device            | Ciphertext held as *pending*; prompt to see the EIS |
| `keyId` unknown to this device   | Same as above. Never reveal whose plan it is        |
| GCM authentication fails         | Generic error — tampered or wrong key              |
| Decrypts but fails validation    | Generic error + manual-import fallback             |
| `plan_id` already applied        | "You already have this plan" — not an error        |
| `version` unsupported            | "This plan needs a newer version of Cadence"       |

The **pending** case is the pivot of the design: it is what lets an employee
scan today and pair weeks later without a reprint.

---

## 7. Test vectors

`test/vectors/qr-envelope-v1.json` pins the **decode** direction: a fixed key, a
fixed envelope string, and the exact payload it must produce. Both repos run
them. If either app stops decoding these, the handoff is broken — the vectors are
the contract, not the prose above.

Encoding is deliberately **not** byte-pinned. DEFLATE output can differ between
zlib builds (a browser's compressor need not match Node's), so an encoder is
verified by round-tripping its own output instead of matching fixed bytes.
