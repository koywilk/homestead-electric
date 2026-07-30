# Org Membership Join — CC side shipped (SW v362)

Response to `CC-SIDE SPEC — Org Membership Join (KC1 stage B prerequisite)`.
Build order **step 1 is done**: the join leg is in, inert against current rules.

---

## What shipped

`src/App.js`, all of it inside the existing field-ink bridge section:

| Piece | What it does |
|---|---|
| `_getOrgKey(opts)` | Single choke point for key resolution. `localStorage.he_fi_orgkey` first, then build env. `{refresh:true}` bypasses cache. Never logs the value. |
| `_joinOrg(user)` | Claim `orgauth/company/meta/security`, swallow the already-claimed denial, write `orgauth/company/members/<uid>`. On a denied join, refresh the key once and retry. |
| `_kickOrgJoin(user)` | Fire-and-forget, memoized **per uid**. Never memoizes a settled FALSE. |
| `_ccDenied(e)` | Self-heal on `permission-denied` — throttled to once / 10s. |
| `ensureFieldinkAuth()` | Now kicks the join after auth resolves. |
| boot `useEffect` | Explicit once-per-session join at page load. |
| `_hsSetOrgKey` / `_hsOrgStatus` | Console provisioning + verification. Neither prints the key. |

**Why `ensureFieldinkAuth` and not the 8 cc\* call sites:** every bridge read and
write already funnels through it — including the three listeners' self-healing
`attach()` retry, so a failed join is retried for free whenever a listener
re-attaches. One insertion point, minimal blast radius.

**The boot `useEffect` is load-bearing, not belt-and-braces.** The only other
early caller is `publishCcJobsIndex`, and its hash gate returns *before* it
authenticates — so on a normal reload with an unchanged job list, nothing would
ever have triggered a join.

---

## ⚠️ Key provisioning — read before doing step 2

The spec offers "copy the value into your app's own config/env" as the simple
path. **That option is worse here than the spec's author could have known:**
this app is a CRA build served publicly at `homestead-electric.vercel.app`, and
CRA *inlines* `REACT_APP_*` env vars into `main.<hash>.js`. Anyone can download
that bundle. Since this is **one company-wide secret**, publishing it from the
CC side would undercut stage B for FieldInk too — FieldInk deliberately keeps it
out of its bundle by reading Drive at runtime with a per-user OAuth token.

Two other paths were considered and rejected:

- **Homestead Firestore `settings/`** — its rules are `allow read: if true` (and
  `write: if true`). Storing the key there is equivalent to publishing it.
- **Drive read like FieldInk's** — this app has no browser-side Google OAuth;
  its Drive access is server-side, via Cloud Functions and a service account.

### Recommended: per-device now, callable later

**Now (zero deploy, key never in the bundle):** on each office device, once —

```js
await _hsSetOrgKey("<the 32-hex value from fieldink.editorkey.json>")
```

It stores to `localStorage`, re-joins immediately, and reports the result.

**Fleet-wide, when you want it (the durable answer):** a small callable —
`getFieldinkOrgKey` — that reads the same `fieldink.editorkey.json` via the
service account this app's Drive functions already use (or a `gc_config`-style
function-only doc, which is already `read/write: if false`), gated by the
existing `_appKey`/identity wrapper. The key then reaches only authenticated app
users and never enters the bundle. Client-side that is a **one-function change** —
`_getOrgKey` is the only place key resolution lives. Say the word and I'll build it.

`REACT_APP_FIELDINK_ORG_KEY` is wired and works if you ever want it, with the
exposure noted above. Not recommended.

---

## Test (spec's procedure)

1. Provision one device (`_hsSetOrgKey` above), reload, then:
   ```js
   await _hsOrgStatus()
   ```
   Expect `keyPresent: true`, `keySource: "localStorage"`, and a
   `memberDocPath` of `orgauth/company/members/<uid>`. Confirm that doc exists
   in the **field-ink** Firebase console.
2. Publish a test job update / CO / question / homerun list → confirm it still
   lands. This runs against stage-A rules, so a failure here means the join leg
   broke something locally, not a rules problem.
3. Tell the FieldInk side. They deploy stage B. Re-run step 2 and confirm it
   still lands.

Until step 1 is done the join is **inert** — no key means zero writes. Verified,
not assumed (see below).

---

## Scope notes

- **`ccjoblinks` is not used by this app** — zero references. That row of the
  spec's table doesn't apply to the CC side.
- `ccquestions` READ and `ccfieldnotes` CREATE stay any-authed per spec. This app
  reads `ccquestions` (fine either way) and **never creates** field notes — it
  only merges answers onto existing ones, which is a gated write.
- No interchange doc shape changed. No new fields on any cc* doc.
- `firestore.rules` in this repo is untouched and correctly out of scope — the
  cc*/orgauth rules live in the **field-ink** project.

## Why it won't lose data

Read-only with respect to every existing path. The join writes **only** the two
`orgauth/*` docs, which are new and write-only by design. No cc* doc shape
changed; the two protective pre-read aborts in `cccos`/`ccquestions` (which stop
a blind republish from wiping the field's markup blocks) are untouched — a
`_ccDenied(e)` call was added *alongside* each, never in place of it. Nothing is
awaited, so no existing write path can be delayed or blocked by the join. With no
key provisioned the code path exits before its first write.

## Verification

- 29-assertion harness driving the **real extracted join block** (verbatim from
  `App.js`) against stubbed Firestore/auth/localStorage — covers the inert-with-
  no-key property, exact doc paths and field shapes, claim-denied-still-joins,
  refresh-once-on-denied, no-infinite-retry, never-memoize-false, per-uid
  idempotency, the 10s self-heal throttle, and key-length hygiene.
- `CI=true npm run build` via the pre-push gate: **build OK, 576.55 kB gzip.**
