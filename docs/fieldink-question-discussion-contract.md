# Questions ⇄ FieldInk — discussion on the pin + field replies (CC side shipped SW v466, 2026-09-29)

Koy: "when there's a reply or discussion on a question and then I pin it on FieldInk it
doesn't show the discussion part" + "FieldInk needs option to reply back to the discussion."
The Command Center (CC) half is live; this file is the contract the FieldInk side builds to.
FieldInk lives in its own repo (`~/Desktop/homestead-pdf-markup`); nothing here changes it.

## 1. What CC now publishes (read this on the pin)

`ccquestions/<ccJobId>` (field-ink project) — unchanged shape, plus one additive array per
question:

```json
{
  "questions": [
    {
      "id": "q_abc", "n": 3, "text": "Coach light heights?", "answer": "", "who": "Travis",
      "askedOf": "Travis · Rough Main", "status": "sent", "at": 1758900000000, "source": "office",
      "thread": [
        { "id": "m1", "by": "Koy Wilkinson", "role": "crew",   "text": "Any update?",        "at": 1758901000000, "photos": [] },
        { "id": "m2", "by": "Travis",        "role": "client", "text": "Checking with owner", "at": 1758902000000, "photos": ["https://firebasestorage.googleapis.com/..."] },
        { "id": "m3", "by": "Gage Lund",     "role": "field",  "text": "Owner says 78 in.",   "at": 1758903000000, "photos": [], "fiId": "fi_9k2" }
      ],
      "fieldink": { "...the field-owned block CC never writes, preserved on every republish..." }
    }
  ],
  "updatedAt": "<serverTimestamp>", "updatedBy": "office"
}
```

- `thread` is oldest → newest, at most the last 40 messages, text only (HTML stripped, ≤ 1000
  chars), `at` in epoch ms, `photos` = https download URLs (≤ 6). Absent on a question with no
  discussion (pre-v466 mirrors have no key at all — treat missing as `[]`).
- `role`: `crew` = Homestead (office or crew), `field` = a reply that came from FieldInk
  (see §2; `fiId` is the id FieldInk gave it), anything else = the GC / designer / client side
  of the question link.
- CC republishes the doc when a message is added on either side (office thread, the public
  question-link page, or an adopted FieldInk reply), hash-gated. Expect a 1.5 s debounce.

Render it under the question on the pin card, in this order, with `by · time` per line.

## 2. Replying from FieldInk (write this; CC adopts it)

Append to the question's **field-owned** block — the same `fieldink` object FieldInk already
writes `answer` / `answeredAtMs` / `shareId` into — never to `thread`:

```json
"fieldink": {
  "...existing keys...",
  "replies": [
    { "id": "fi_9k2", "by": "Gage Lund", "text": "Owner says 78 in.", "at": 1758903000000 }
  ]
}
```

- `id`: any string unique per reply (≤ 40 chars; a uid is fine). It is the dedupe key: CC
  adopts each `id` exactly once, even if two office devices are watching the job.
- `by`: the crew tag name (≤ 60). `text`: plain text (≤ 2000, CC strips nothing but truncates).
  `at`: epoch ms.
- Write it with the same read-merge FieldInk uses for the rest of the block (arrayUnion on
  `questions[i].fieldink.replies` is not possible on a nested array inside an array element —
  keep doing what the block does today: read the doc, replace that question's `fieldink`,
  write the questions array back with CC's fields untouched).
- **Show the reply immediately on the pin from `fieldink.replies`** (optimistic), and hide a
  local reply once the same `fiId` shows up in `thread` — that is the round trip completing.
  Round trip: an office device with the job open sees the reply (ccquestions listener), appends
  it to CC's discussion side doc as `role:"field"` with `fiId`, and that write triggers the
  republish. If no office device has the job open, the reply waits in `fieldink.replies` until
  one does; nothing is lost.
- Never trim `replies` yourself once adopted; CC ignores ids it already has, so the array can
  simply grow (cap it at, say, 100 if you want — anything CC has adopted already lives in the
  thread).

## 3. Not in scope (yet)

Photos on a field reply (CC adopts text only), editing or deleting a field reply, and a field
reply on a question CC cannot locate (a question deleted on CC after the pin) — that reply is
ignored, not adopted.
