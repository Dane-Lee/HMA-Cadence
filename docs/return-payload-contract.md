# HMA Cadence → Cadence-Admin — Return Payload Contract (v1)

The source of truth for the **return** direction: what an employee's phone sends back to the
practitioner. The counterpart to [plan-payload-contract.md](plan-payload-contract.md), which
covers the outbound plan. If the shape changes, bump `schema_version` and update this file in
the same change.

Implemented by `src/lib/return/` — `returnValidation.js` (the contract) and `returnEnvelope.js`
(composition, extraction, crypto). Both are pure functions with no DOM, so the contract is
testable without a browser: `test/returnEnvelope.test.js`.

---

## 1. Flow

```
Employee taps "done" / reports pain / rates an exercise, offline, all week
        │
        ▼
Phone builds ONE cumulative return payload (this contract), encrypts it,
and opens a pre-addressed email with the payload between two markers
        │  (address was embedded in the client app from the original plan QR)
        ▼
Employee sends the email from their own address
        │
        ▼
EIS selects one email — or fifty — copies, and pastes into Cadence-Admin
        │
        ▼
Cadence-Admin extracts EVERY marked block in the paste, opens each by keyId,
matches the recognition key to a local profile, and files the events
```

**Fallback:** an on-screen QR the EIS scans at the appointment, for employees who never send.

---

## 2. The two properties that shape everything else

### It carries no identifying information

No name, no badge, no plan content — only a recognition key and event data. Cadence-Admin
attaches the person from its own records. **An intercepted report is meaningless without the
practitioner's machine.**

If you find yourself adding a name field to make debugging easier, that is the contract being
broken rather than extended.

### It is cumulative

The phone sends its **entire history** every time, not a delta. Four weeks of completions is
tens of bytes after DEFLATE, so the cost is negligible and the benefit is large: a dropped,
spam-filtered or never-sent email **self-heals on the next one**.

The consequence for the receiver: **duplicate events across sends are the normal case, not an
error.** Validation does not reject a payload for repeating what it already sent, and ingest
dedupes rather than treating a repeat as new data.

---

## 3. Shape

```jsonc
{
  "schema_version": 1,
  "kind": "hma-cadence-return",          // refuses a plan pasted into the return box
  "recognition_key": "a1b2…",            // 32 hex chars — the person, not the plan
  "generated_at": "2026-08-27T12:00:00.000Z",
  "plan_id": "plan-0001",                // which plan these events belong to

  "completions": [ { "e": "s3", "d": "2026-08-24" } ],
  "pain":        [ { "e": "l1", "d": "2026-08-26", "c": "pain_during", "n": "left hip" } ],
  "feedback":    [ { "e": "s3", "d": "2026-08-26", "v": "thumbs_up" } ]
}
```

| field | required | notes |
|---|---|---|
| `kind` | yes | Must be `hma-cadence-return`. |
| `recognition_key` | yes | 32 lowercase hex characters. |
| `generated_at` | no | ISO timestamp. |
| `plan_id` | no | String. |
| `completions` / `pain` / `feedback` | **at least one** | Arrays of events. |
| event `.e` | yes | Exercise id — the public join key (`l1`, `s3`, `co2`…). |
| event `.d` | yes | `YYYY-MM-DD`. |
| `pain[].c` | yes | One of `PAIN_CATEGORIES`. |
| `pain[].n` | no | Free-text note. |
| `feedback[].v` | yes | One of `FEEDBACK_RATINGS` (`thumbs_up` / `thumbs_down`). |

Keys are single letters because the payload is cumulative and resent weekly forever. A return
carrying only a recognition key and an empty week is legitimate — it is what a compliant
employee with an uneventful week sends, and the admin reads it as proof of life.

---

## 4. The recognition key

**It belongs to the person, not the plan.** Minted once, at first plan issue, and carried
forward into every later plan that employee receives.

It cannot be derived from the plan key. A re-assessment mints a fresh plan key, and a return
sent afterwards must still match the profile that already exists — the plan id changes, this
does not. It is its own value.

**Who mints it is currently not what the plan specifies** — the phone does, not the admin,
because there is no field in plan contract v1 to carry it the other way. See §7.

---

## 5. Crypto — reusing the plan envelope unchanged

The wire format is `src/lib/qr/envelope.js` exactly as-is: `AES-GCM` over `DEFLATE`, framed as
`[version | keyId | iv | ciphertext]` and base64url encoded. Those functions are named
`…PlanEnvelope`, but nothing in them is plan-specific; renaming them would be a shared-contract
change across two machines for cosmetic gain.

**The return is encrypted with the plan's own key.** `importPlanKey` grants both `encrypt` and
`decrypt`, and the phone's keystore already holds that key from pairing. So:

- the phone encrypts with what it already has — no second key ceremony, nothing new to print;
- the admin reads `keyId` off the envelope and opens it with the right key directly, instead of
  trial-decrypting against every employee on file.

---

## 6. The email body

```
This is my exercise progress report from HMA Cadence.

Please send this message without editing the block below.

-----BEGIN HMA REPORT-----
<base64url payload, wrapped at 64 columns>
-----END HMA REPORT-----
```

A readable line comes first because the employee sees this before sending, and a screen of
base64 with no explanation is alarming.

### Extraction is deliberately liberal

`extractReturnEnvelopes()` meets real email, which mangles text in three ways:

1. **Line wrapping** — the payload arrives split across many lines.
2. **Quoting** — a forwarded or replied-to report carries `>` or `>>` on every line, markers
   included, and a heavily quoted marker can itself be split at its spaces.
3. **Stray whitespace** from copying out of a rendered message body.

All three are handled the same way: inside a marked block, strip every character outside the
base64url alphabet. Quote marks, spaces, newlines and soft line-break `=` are all outside it,
so one filter covers the lot. Markers are matched with `[\s>]` permitted wherever they contain
a space.

**Being liberal is safe here specifically because the envelope is authenticated.** If extraction
rejoins bytes wrongly, AES-GCM fails to open it and the admin sees an unreadable report. It
cannot silently produce a plausible-but-wrong one. That property is what allows the parser to
be forgiving instead of brittle.

Duplicate blocks are dropped — a reply chain repeats the same block on every hop.

---

## 7. What is built and what is not

| piece | state |
|---|---|
| Contract + validator | **built** — `returnValidation.js` |
| Envelope build / open, keyId lookup | **built** — `returnEnvelope.js` |
| Email composition + batch marker extraction | **built** |
| Recognition key generation and device storage | **built** |
| Phone: collect events, compose, `mailto:` hand-off | **built** — `composeReturn.js` + adapter |
| Phone UI: the prompt after a pain tap, unsent indicator, send action | **built** — `ReturnReportCard.jsx` + `sendReturn.js` |
| Cadence-Admin: paste box, filing to the pain queue and compliance view | not built (Phase 6/7) |
| Appointment-scan QR fallback | not built (Phase 7) |

40 tests across `returnEnvelope`, `composeReturn` and `sendReturn`; the last two run against the
real `localAdapter`, so a completion recorded the way the app records it is the completion that
reaches the payload.

### Sending is a hand-off, not a delivery

`sendReturn()` opens a `mailto:`. The employee still has to press send in their own mail app, and
nothing in Cadence can observe whether they did. Recording the hand-off is what stops the card
nagging someone who has already done their part — **it is not a delivery receipt**, and the admin's
own records are the only proof anything arrived.

This is the second reason the payload is cumulative: if a hand-off never actually leaves, the next
one carries the same events again and the gap closes itself.

### Two gaps that need a decision, not code

**The return address has nowhere to come from.** §4.2 of the pipeline plan has it "embedded in the
client app from the original plan QR", but plan payload contract v1 carries no such field. Adding
one changes a contract the Tracker also builds against, so `composeReturnEmail` takes the address as
a parameter and `DEFAULT_RETURN_ADDRESS` is an empty placeholder.

**The recognition key is minted by the phone, not the admin.** §4.2 has the admin mint it at first
plan issue — which it cannot do for the same reason: no field to carry it. So the phone mints and
persists its own, and the admin learns it from the first return, which it can match because it
already knows which employee it issued that `keyId` to. Every later return matches on the
recognition key directly, which is what makes it survive a re-assessment.

The cost: an employee who reinstalls mints a new key and is re-linked by `keyId` one send later,
rather than recognised immediately. If the plan contract later carries the key, prefer it and this
becomes the fallback.

---

## 8. What email does and does not protect

Encryption protects the **content** of a report. It does not hide the **fact** of one — the
message arrives from the employee's own address. That is no different from an employee emailing
"my shoulder hurts", and is accepted.

Returned compliance data is **self-reported and must never be treated as a verified record**
(invariant 7).
