# Homestead Electric — Security Audit

**Date:** 2026-06-10
**Scope:** `firestore.rules`, `functions/index.js`, `src/App.js`, `public/service-worker.js`, `public/firebase-messaging-sw.js`, hosting config
**Method:** static source review (no live testing against prod)

---

## The one thing to understand first

The entire app has **no real authentication**. Identity is a name picked from a list plus a PIN, checked in the browser and cached in `localStorage`. Firestore security rules are deliberately open (`allow read, write: if true` on almost everything) so share links work without a login.

That is a deliberate design choice for an internal crew tool, and most of the time it's fine — nobody knows the URL, nobody's looking. But it means the **only thing standing between the public internet and your entire database is that nobody has bothered to look.** The Firebase project ID and API key are in the public site bundle (this is normal for Firebase). Anyone who views-source on `homestead-electric.vercel.app`, pulls those two strings, and points the Firebase SDK at them can read and write your data directly — completely bypassing the app, the PIN screen, and every `can()` permission check.

So the findings below split into two buckets:

- **Bucket A — consequences of the no-auth model.** Tightening these means adding *some* server-side gate (Firebase App Check is the lightest). Until then, security rests on obscurity.
- **Bucket B — real bugs** that are dangerous *on top of* the open model, where a fix is cheap and worth doing now regardless.

The single highest-value move is **#2 (sanitize HTML) + #6 (turn on App Check)**. Those two together close the door on the scariest attack (a stranger silently planting code that runs on every crew phone) without rebuilding how anyone logs in.

---

## CRITICAL

### 1. Employee PINs are stored in plain text in a world-readable document
**Where:** `settings/users` doc (rule `firestore.rules` settings block, `allow read: if true`); client compare at `src/App.js:2965` (`if (entered === chosen.pin)`); seed list `src/App.js:2843` shows `{ id:"koy", … pin:"" }`.

**What it means:** every user's PIN sits in cleartext in a document anyone on the internet can read with two lines of code. They can then "log in" as anyone — including admins. Koy's seed PIN is an **empty string**, so an attacker who reads the users doc and finds an admin with a blank PIN is in as admin with zero guessing.

**Worse:** the PIN is almost decorative anyway — see #4. Even without reading it, identity can be forged outright.

**Fix:**
- Stop storing raw PINs. Store a salted hash (e.g. PBKDF2/bcrypt) and move the *comparison* into a Cloud Function callable that takes a name + PIN and returns a short-lived signed token. The open users doc then never contains a secret.
- Immediately: set a non-empty PIN on every admin account, and remove PINs from any console/debug logging.
- This only becomes a true wall once paired with App Check (#6) — otherwise an attacker skips the PIN entirely (#4).

### 2. Stored XSS: a stranger can run code on every crew device
**Where:** ~10 `dangerouslySetInnerHTML` sites in `src/App.js` (e.g. ~`4023`, `4517`, `28940`, `28965`, and the Up Next rule summaries) render job fields — punch text, CO descriptions/materials, question answers, notes, scope — as **raw HTML with no sanitization**. There is no DOMPurify or equivalent in `package.json`. These same fields are world-writable because of the open `jobs` write rule.

**What it means:** an attacker writes a punch item like `<img src=x onerror="…steal localStorage, FCM token, identity…">` straight into a job document via the Firebase API. The next crew member who opens that job runs the attacker's JavaScript on their phone. Because notifications deep-link to a specific job (`?jobId=`), the attacker can even *push* a notification that lures someone into opening the poisoned job. This is full compromise of the field app on every device that views it.

**Fix (this is the headline fix):**
- Add `dompurify` and wrap every `dangerouslySetInnerHTML` value in `DOMPurify.sanitize(html, { ALLOWED_TAGS:['b','i','u','br','p','span','ul','ol','li'], ALLOWED_ATTR:['style'] })`. One shared helper, applied at every render site, including the Up Next `rule.summary()` output.
- Then add a Content Security Policy (#7) as a second layer so even a missed spot can't phone home.
- Note: the new notification **inbox renders title/body as React text (escaped) — that part is safe.** The risk is the rich-text job fields.

---

## HIGH

### 3. Anyone can spam / phish the whole team through open callables
**Where:** `reNudge` (`functions/index.js:232`), `sendTestPush` (`:168`), `sendTestHuddleNotification` (`:950`). All are `https.onCall` with no caller verification. `reNudge` takes attacker-controlled `title` and `body` and writes them into another user's notification inbox + fires a push.

**What it means:** a stranger who found the project ID can blast every crew member with arbitrary push notifications and inbox entries — "URGENT: tap here to re-verify your account," etc. Convincing internal phishing, plus the ability to bury real nudges in noise.

**Fix:** gate the sensitive callables behind App Check (#6), and/or require a short signed token derived from the server-side PIN check in #1. Add length caps on `title`/`body` (e.g. 200 chars) and strip control characters. Low effort, high payoff.

### 4. Identity is forgeable — the PIN can be skipped entirely
**Where:** `getIdentity()`/`saveIdentity()` (`src/App.js:2929`, `:2943`) read/write `he_identity` in `localStorage`; nothing server-side ever re-validates it.

**What it means:** a user can open dev tools and write `localStorage.he_identity = JSON.stringify({name:"Koy Wilkinson", role:"admin", pinVerifiedAt:Date.now()})` and the app treats them as admin. No PIN needed. Combined with the open rules, every `can()` check is cosmetic.

**Fix:** same path as #1 — a server-issued signed token (verified by a callable, refreshed periodically) is the only thing that makes identity non-forgeable. Until then, treat all UI gating as convenience, not security.

### 5. Secrets committed in source: Simpro API token + Drive API key
**Where:** `functions/index.js:1369-1371` — `SIMPRO_TOKEN = "402222…"`, `DRIVE_KEY = "AIza…"` hardcoded.

**What it means:** these live in your git history and in the deployed function bundle. **Correction to a common worry:** Cloud Function source is *not* served to website visitors, so this is not "readable by anyone on the internet" the way the Firestore data is. The real exposure is (a) anyone with repo/git access (laptops, any fork, any backup) gets full Simpro read/write and Drive access, and (b) the token is long-lived and never rotated. The Simpro token can read customer data, jobs, quotes, and financials.

**Fix:** move both into Firebase Secret Manager (you already do this for `ANTHROPIC_API_KEY` — same pattern), reference via `process.env` + `.runWith({secrets:[…]})`, delete the literals, and **rotate the Simpro token** since it's been in git. Scrub it from history if feasible.

### 6. No App Check — nothing proves a request came from your real app
**Where:** project-wide; no App Check enforcement on Firestore or callable functions.

**What it means:** this is the root enabler for #1–#4. App Check (with reCAPTCHA/Play Integrity/DeviceCheck) makes Firebase reject requests that don't originate from your genuine app, which shuts down the "point the SDK at the public config" attack for the vast majority of would-be abusers.

**Fix:** enable App Check in the Firebase console, add the client SDK init, and set Firestore + Functions to *enforce* it. This is the closest thing to a "turn the whole problem down by 90%" switch that doesn't require building real auth. Roll out in monitor mode first so you don't lock out live devices.

### 7. No Content Security Policy
**Where:** no CSP header in hosting config, no `<meta>` CSP in `public/index.html`.

**What it means:** when (not if) an XSS payload like #2 slips through, there's nothing to stop it from exfiltrating data to an attacker's server or loading external scripts. CSP is the safety net under the sanitization work.

**Fix:** add a CSP via your host's headers config (or a `<meta http-equiv>` as a quick start) allowing only `self` + the Google/Firebase origins you actually use, and disallowing arbitrary `connect-src`. Tighten over time.

---

## MEDIUM

### 8. Open write + open delete on jobs (and manualTasks, quoteWalks, needs)
**Where:** `firestore.rules` jobs block — `allow delete: if true`, and the write rule only checks that `data` is a map and `updated_at` is a string.

**What it means:** beyond XSS (#2), an attacker can wipe or corrupt every job document. The validation stops literally nothing meaningful. Data-destruction blast radius is the whole jobs collection.

**Fix:** the durable fix is App Check (#6) so only your app can write. Independently, keep a scheduled export/backup of the `jobs` collection so a malicious or accidental mass-delete is recoverable (the `__HE_RESTORE` path implies backups exist — confirm they run automatically and are off-site).

### 9. Notifications inbox is world-readable
**Where:** new `notifications/{userKey}/items` rules block — `allow read: if true`.

**What it means:** anyone can read anyone's notifications (which jobs, which customers, what's going on) and enumerate the list of `userKey`s (your employee roster). Lower stakes than the jobs data, but it's needless exposure that ships with a brand-new feature.

**Fix:** once App Check / token auth exists, scope reads to the owning user. Short term, avoid putting anything sensitive in notification bodies (they already deep-link rather than embed detail — keep it that way).

### 10. Unbounded paid-API and DB-scan abuse via open callables
**Where:** Claude callables `draftDailyUpdate`/`appHelp`/`cleanVoiceNote` accept unbounded input; several functions do full `db.collection("jobs").get()` scans; callable Simpro paths can be triggered repeatedly.

**What it means:** an anonymous caller in a loop can burn Anthropic credits (large prompts × many calls) and rack up Firestore read costs / Simpro load. A cost-DoS, not a data breach.

**Fix:** App Check (#6) again; plus hard input length caps on the Claude callables (truncate context/transcript/docs to sane maxima) and a simple per-caller throttle counter doc. Set a billing budget alert as a backstop.

### 11. Deep-link params should be allowlisted in the service worker
**Where:** `public/firebase-messaging-sw.js` builds the click URL from push `data` (`view`/`jobId`/`section`). Values are `encodeURIComponent`-escaped and the app validates `view` against `huddle`/`cos` on arrival (`src/App.js:50274`), so this is currently contained.

**What it means:** it's safe today, but it relies on the receiving code staying careful. Worth hardening proactively.

**Fix:** in the SW, validate `view` against an explicit allowlist and `jobId` against a doc-id regex before constructing the URL; ignore anything else.

---

## LOW

### 12. `uid()` is a sequential counter
**Where:** `src/App.js:1208` — `const uid = () => String(++_uid)`.

**What it means:** IDs used in share URLs and as record keys are guessable/enumerable rather than random. Anyone can walk `?…=1,2,3…`. Given reads are open anyway (#8/#9), this mostly matters if you ever tighten rules to "knows the share token" — at which point guessable tokens defeat the point.

**Fix:** when you add share-token gating, generate tokens with `crypto.getRandomValues` (no `Math.random` fallback), not the counter.

### 13. FCM config / VAPID key in the client
**Where:** `public/firebase-messaging-sw.js:9-16`.

**What it means:** expected and fine — these are public by design. Listed only so it's not flagged as a finding later. The VAPID public key and Firebase config are not secrets.

---

## Recommended order

1. **This week — cheap, high impact, no auth rebuild:**
   - #2 add DOMPurify + sanitize every `dangerouslySetInnerHTML` (incl. Up Next summaries). Bump SW version, ship.
   - #5 move Simpro token + Drive key to Secret Manager and **rotate the Simpro token**.
   - #1 set non-empty admin PINs now; remove any PIN logging.
   - Input caps on `reNudge`/Claude callables (#3, #10); billing alert.
2. **Next — the real lever:**
   - #6 enable App Check in monitor mode, then enforce on Firestore + Functions. This quietly defuses #1, #3, #4, #8, #9, #10 for anyone who isn't determined.
   - #7 add a Content Security Policy.
   - Confirm automatic, off-site `jobs` backups (#8).
3. **Later — if you want a true wall:**
   - #1/#4 server-side PIN verification returning a signed token; verify it in rules. This is the only thing that makes identity non-forgeable and lets you scope reads/writes per user (#9). It's real work but it's the graduation from "secure by obscurity" to "secure."

---

## Honest bottom line

Nothing here means you've been breached — it means the app's safety currently depends on staying unnoticed. For an internal tool that's a legitimate posture, but two facts make it worth acting: the database is one view-source away from being fully open, and the HTML-injection path (#2) lets a stranger run code on your crew's phones, not just read data. Do the sanitization and App Check and you've removed the genuinely scary outcomes. The PIN/identity hardening is the follow-on if you want the model to actually hold up to someone trying.
