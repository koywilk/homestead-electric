# FCM Web Notification Reliability: diagnosis, design, verification

Branch `claude/fcm-notification-reliability-l9vl8v` · SW v509 · 2026-10-05

FCM stays as the browser push transport. The change: the stored notification is now the record, and push is only the alert on top of it. A missed push no longer means a missed notification, and every send attempt is now recorded where we can see it.

---

## 1. Diagnosis: why delivery was inconsistent

Line references are to the code before this change (commit `c82844f`).

| # | Cause | Where | What the user saw |
|---|---|---|---|
| D1 | **A push that arrived while the app was open showed no system notification on phones, and iOS revoked push permission.** With a visible window, the Firebase service-worker SDK passes the payload to the page and shows nothing itself (`onBackgroundMessage` only runs when no window is visible). The page then called `new Notification(...)`. That constructor throws `Illegal constructor` on Android Chrome and doesn't exist in an iOS Home-Screen app. iOS Safari treats a push that shows nothing as a "silent push" and **revokes the site's push permission** after a few. | `src/App.js` onMessage handler (~L1669–1715); `public/firebase-messaging-sw.js` relied on `onBackgroundMessage` | No notification when the app was open on a phone. iPhones "stop getting them" after a while. |
| D2 | **A second event on the same job silently replaced the first.** The tag was `job-<jobId>-<section>` with `renotify:false`, so foreman-assigned → status-update → lead-assigned (all `section: "Job Info"`) shared one tag. Each one replaced the last with no sound and no banner. | `functions/index.js` `sendFCM` tag (~L232); SW `renotify:false` | "I only got one of them" / "it didn't ring". |
| D3 | **Tapping a notification while the app was open didn't go anywhere for task/view notifications.** Since the SW scope split (v364), the messaging worker doesn't control the page, and `WindowClient.navigate()` rejects for a client the calling worker doesn't control. The fallback `postMessage` only ran when there was a `jobId`, and the page only handled `jobId`. My Day / Huddle / CO pushes just focused the app. The foreground `n.onclick` sent its message to `window` while the listener was on `navigator.serviceWorker`, so that path never fired. | SW `notificationclick`; App.js HE_NOTIF_CLICK listener | Tap opens the app on whatever screen it was on. |
| D4 | **The inbox wasn't saved before the push.** `deliver()` ran the inbox write in parallel with the pushes, and a failed write only logged a warning. | `functions/index.js` `deliver`/`logInboxNotif` (~L148–174) | Rare, but a failed write meant the notification existed only as a push. |
| D5 | **Send failures were swallowed.** `sendFCM` caught every error, logged a warning, and never retried, even on transient FCM errors (`internal-error`, `server-unavailable`, quota). Nothing recorded what happened to a given notification. "FCM accepted it" was never separated from "the phone showed it". | `sendFCM` catch (~L291–305) | Impossible to answer "did they get it?". |
| D6 | **No idempotency.** Firestore triggers are at-least-once, and a re-fired trigger could ping twice. | all triggers | Occasional duplicates. |
| D7 | **Long bodies broke the push.** FCM caps the payload at 4 KB. A long status note or body failed with `messaging/invalid-argument` and the push was lost. | `sendFCM` | Long-text notifications never arrived. |
| D8 | **The unread badge was capped.** The count came from the newest-50 list, so an unread item older than that dropped off the badge, and "Mark all read" only cleared the loaded 50. | App.js inbox (~L63202–63211) | Badge and inbox disagreed. |
| D9 | **Unknown recipient names were dropped silently.** `sendToName` / `sendToNameIfWanted` returned without a log. | `functions/index.js` | Nobody could tell a notification was never sent. |
| D10 | **Stale-token pruning was slow and contended.** It ran one transaction per dead token, all at once, against the same `settings/users` doc. | `removeStaleToken` | Slow, contended prunes (correct, but noisy). |
| D11 | **The Notification Doctor's OS test was wrong on phones.** It used `new Notification()`, so it always failed on Android and iOS even when notifications worked. | `NotifDoctor.testOSNotif` | Misleading diagnosis. |

**Already right before this change (kept):** tokens are stored per device (`fcmTokens[]`, deduped, capped at 10). The keepalive re-syncs on focus and every 30 min and fully resets a dead subscription. The two service workers use separate scopes (v364). Payloads are data-only. `Urgency: high` is set. Stale tokens are pruned. The `android`/`apns` blocks never applied to web tokens; they were harmless and are now trimmed.

---

## 2. Architecture

```text
Domain event (punch assigned, CO approved, task assigned, nudge, …)
  -> deliver(user, notif)                                        functions/index.js
       1. PERSIST (one atomic batch, retried on transient errors)
            notifications/{userKey}/items/{nid}   ← the record (bell reads it)
            pushQueue/{userKey}__{nid}            ← a 3-min lease
          ALREADY_EXISTS → duplicate event, suppressed + logged, no push
          still failing → ERROR log "INBOX WRITE FAILED", push anyway
       2. PUSH   messaging.sendEach([...one data-only message per device token])
       3. RECORD delivery{status, attempts, okCount/tokenCount, per-device
                 result codes (token tags only), sentAt} merged onto the record;
                 dead tokens pruned (one transaction);
                 transient failures → pushQueue gets nextAttemptAt + only those tokens;
                 otherwise the lease is deleted.
                 One "[notify] delivery" log line per attempt (ERROR = no device reached).
  -> pushRetrySweep (every 5 min)  re-sends due pushQueue entries (backoff 1/3/10/30/60 min,
                                   max 5 tries, 12 h window, skipped if already read in-app,
                                   also recovers a lease left by a crashed function)
  -> Service worker push handler   ALWAYS shows the notification (app open or not), tag = he-<nid>
                                   → pushReceipt callable: receipts[] + displayedAt on the record
  -> App                           bell = live query of the records; unread count = read==false query;
                                   tap (push / toast / bell) → exact item + marks the record read
```

**Record shape** (`notifications/{userKey}/items/{nid}`). The fields the bell already used are unchanged. New fields are additive:

```js
{ title, body, jobId, section, view, needId, createdAt, read,          // unchanged
  category, priority: "high"|"normal", link: "/?jobId=…&nid=…",          // new
  delivery: { status, priority, attempts, tokenCount, okCount, failedCount,
              firstAttemptAt, lastAttemptAt, sentAt?, results: [{tk, ok, messageId|code, kind}],
              gaveUpAt?, gaveUpReason? },
  receipts: [{tk, at, shown, visible}], displayedAt }                    // from the device
```

`delivery.status`: `pending` → `sent` | `partial` | `retrying` → `failed` | `expired` | `no_tokens` | `read_before_push`.

**Idempotency.** The record id is `notifDocId()`: for the same recipient, the same content in the same minute gets the same id. A caller can pass an explicit `eventKey` instead, which maps to a stable id with no time component.

**Priority.** `functions/notifyDelivery.js` `LOW_PRIORITY_CATEGORIES` (digests, routine reminders, stale-job, quote converted, `bid`/`quote_request`) get `Urgency: normal`, a 6 h TTL and a quiet notification. Everything else gets `high` and a 24 h TTL. Anything with no category defaults to high.

**Not changed:** the token storage model, the keepalive, the Settings → Notifications mute semantics (muted = no record and no push, now logged), Firestore rules (`pushQueue` is covered by the existing deny-all catch-all), the jobs loader, and job writes.

---

## 3. Patch

| File | Change |
|---|---|
| `functions/notifyDelivery.js` (new) | Pure logic: error classes, priority, ids, payload builder, rollup, backoff |
| `functions/index.js` | New `deliver()` pipeline; `pushRetrySweep` (scheduled); `pushReceipt` (callable); test callables use the shared builder; unknown-name / muted logs; batched stale-token prune; `sendFCM` removed (nothing called it) |
| `public/firebase-messaging-sw.js` | Own `push` listener that always shows a notification; Firebase SDK load wrapped in try; click → `postMessage` or `openWindow`; receipt ping |
| `src/App.js` | Foreground push → toast only; click/toast routing for view/task notifications plus mark-read; `nid` cold-open mark-read; unread via its own query; app icon badge; Doctor delivery history; Doctor OS test via the SW registration |
| `public/service-worker.js` | v508 → v509 (merged over main) |
| `public/sops/myday.html` | Step 3: taps work with the app open, mark read; the bell is the record |
| `FEATURES.md` | v509 entry |
| `scripts/notify-delivery-test.js` (new, prebuild) | Pure helpers + full pipeline against an in-memory Firestore/FCM fake |
| `scripts/sw-push-check.js` (new, `npm run sw-push-check`) | Real Chromium: pushes injected via DevTools protocol |

---

## 4. Test checklist

### Automated (already run on this branch)
- [x] `node scripts/notify-delivery-test.js`. It checks: record committed before the push; outcome recorded; duplicates suppressed; stale token pruned without touching the `settings/users` audit fields; transient error queued and retried to the failed device only; cumulative device count across retries; give-up after 5 tries at ERROR; read-in-app cancels the retry; no-token users still get the record; Firestore outage still pushes and logs ERROR; one failed commit is retried with a fresh batch; a receipt survives a later record write; `pushReceipt` refuses path injection and requires the app key.
- [x] `npm run sw-push-check` and `NO_SDK=1 npm run sw-push-check` (real Chromium, page visible). It checks: a notification is shown; two events on one job give two notifications; a retried record stays at one notification; the low-priority notification is quiet and has the right deep link; the receipt payload is correct; the test push sends no receipt; the Firebase SDK still forwards to the page (toast); the push handler survives the CDN being unreachable. (Local SDK is the 10.14.1 npm copy; production imports 10.12.0 from gstatic.)
- [x] `npm run build`: full prebuild chain (including the no-undef gate) plus the production compile.

### Manual, on real devices (after deploy)
Use the Notification Doctor (Settings) → **Send test push to me**, then a real event (assign yourself a punch item from another account).

| Device | App closed | App open (visible) | Tap → exact item | Bell entry + badge |
|---|---|---|---|---|
| iPhone (Home-Screen app, iOS 16.4+) | ☐ | ☐ notification shows | ☐ | ☐ icon badge |
| Android Chrome (installed + browser tab) | ☐ | ☐ notification shows (used to be nothing) | ☐ | ☐ |
| Desktop Chrome (macOS / Windows) | ☐ | ☐ | ☐ | ☐ |
| Desktop Safari / Edge | ☐ | ☐ | ☐ | ☐ |

Also check:
- [ ] Two events on the **same job** within a minute (e.g. set a status update, then assign a lead) → **two** notifications.
- [ ] A **My Day task** push tapped while the app is open → My Day opens on that task (used to just focus the app).
- [ ] Tap a notification → that bell item shows as read. Same on a cold open (app closed).
- [ ] Notification Doctor → **YOUR LAST 10 NOTIFICATIONS** shows `Pushed · n/n devices · shown on a device …`.
- [ ] Turn notifications off for the site → events still land in the bell; the Doctor shows `No device registered` or `Push failed — in-app only`.
- [ ] iPhone: leave the app **open** and receive 4+ pushes in a row → permission is still "granted" afterwards (the D1 regression check).

---

## 5. Verification procedure

### Local (no production writes)
1. `npm ci && npm run build`. The prebuild runs `notify-delivery-test`.
2. `npm run sw-push-check` (and `NO_SDK=1 …`).
3. Optional emulator run: `firebase emulators:start --only functions,firestore`, then call `reNudge` against the emulator. FCM sends from the emulator still hit real FCM, so use a test token, or expect `failed` with `messaging/invalid-argument`. That still shows the record being written, the outcome recorded and the ERROR log line.

### Production rollout (needs Koy's approval; nothing here has been deployed)
Either deploy order is safe. The old SW handles the new payload (it still reads `title/body/jobId/section/view/needId/tag`). The new SW handles the old payload (it falls back to the old `tag` and `jobId` link). Recommended order:
1. **Functions first:** `firebase deploy --only functions:pushRetrySweep,functions:pushReceipt` (new), then `firebase deploy --only functions`. Every trigger and callable uses `deliver()`, so the whole codebase has to be redeployed for the new path to take effect. The new scheduled function creates a Cloud Scheduler job.
2. **Then the app:** merge to `main` → Vercel builds (SW v509 + new `firebase-messaging-sw.js`). Devices pick up the new worker on next open (`reg.update()` on load, `skipWaiting` + `clients.claim`).
3. **Watch for 24 h:**
   - Logs Explorer: `jsonPayload.message="[notify] delivery"`. Group by `jsonPayload.status`. Expect mostly `sent`. Look at every `failed` (severity ERROR).
   - `[pushRetrySweep] ran` every 5 min with small `due` counts.
   - Firestore: `pushQueue` should stay near-empty (only in-flight leases and retries).
   - Spot-check a few `notifications/{userKey}/items` docs for `delivery.status` and `receipts`.
4. **Rollback:** revert the merge commit and redeploy functions from `main`. The new fields are additive and the old bell ignores them, so no data cleanup is needed. Leftover `pushQueue` docs are inert (function-only collection) and can be deleted.

---

## 6. Firebase Console / Google Cloud settings to verify by hand

1. **Cloud Messaging → Web Push certificates:** the key pair's public key must equal `VAPID_KEY` in `src/App.js`. A mismatch mints tokens that never deliver.
2. **Cloud Messaging → Firebase Cloud Messaging API (V1): Enabled.** Google Cloud Console → APIs & Services → "Firebase Cloud Messaging API" is enabled for project `homestead-electric`. The legacy API is not used.
3. **IAM:** the Cloud Functions runtime service account (`homestead-electric@appspot.gserviceaccount.com` for 1st-gen functions) has **Firebase Cloud Messaging API Admin** (or Editor) and **Cloud Datastore User**.
4. **Cloud Scheduler API enabled.** `pushRetrySweep` creates a job `firebase-schedule-pushRetrySweep-us-central1`. After deploy, confirm the job exists and its last run succeeded.
5. **Functions region is `us-central1`.** The service worker posts receipts to `https://us-central1-homestead-electric.cloudfunctions.net/pushReceipt`. If functions are ever moved to another region, update `RECEIPT_URL` in `public/firebase-messaging-sw.js`.
6. **Log-based alert (recommended):** Cloud Logging → create a log-based metric on `resource.type="cloud_function" AND jsonPayload.message="[notify] delivery" AND severity>=ERROR`, with an alert policy that emails Koy when it's above 0 for 15 min. Add a second metric on `"INBOX WRITE FAILED"`.
7. **Firestore indexes:** none are needed. Both new queries (`pushQueue.nextAttemptAt <=` and `items.read ==`) are single-field, collection-scoped and indexed automatically. Confirm no single-field **exemption** disables indexing on `nextAttemptAt` or `read`.
8. **Firestore rules:** no change. `pushQueue` falls to the deny-all catch-all. Clients can still only flip `read` on inbox items. The server writes `delivery`/`receipts` with the admin SDK.
9. **Hosting headers (Vercel):** `/firebase-messaging-sw.js` must be served as `application/javascript` and not cached long-term. `vercel.json` has no custom headers today, so Vercel's static default (`max-age=0, must-revalidate`) applies, which is correct. Keep it that way: a long `max-age` on that file would delay new push logic reaching devices.
10. **Per device, not a console setting:** iOS needs 16.4+ and the app installed to the Home Screen. Check OS-level notification permission for the browser (macOS System Settings → Notifications → Chrome; Android app notification settings; Windows Focus Assist).
11. **Don't test with the Console "Send test message" composer.** It sends a `notification` payload, which the Firebase SDK auto-displays on top of our handler, so it shows two notifications. That's expected for that tool only. Use the in-app Notification Doctor.
