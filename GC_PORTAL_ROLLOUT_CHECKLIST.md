# GC Portal — Day-One Rollout Checklist (P0-14)

One page, in order. Don't skip steps by feel — this feature emails real contractors and the whole point of Phase 0 was "if it works wrong, it fucks us." Go slow on the first real link.

## 0. Before you deploy anything

- [ ] Confirm `firestore.rules` in this deploy includes the full ruleset (not a partial push) — it now has two new collections (`gc_rate`, `gc_bounces`) that must be function-only from the first deploy, or a client write during the gap window is allowed by the default-deny catch-all only if that catch-all is already live. Verify in the Firebase console that current prod rules match what you're about to push.
- [ ] Bump the service-worker cache version in `public/service-worker.js` so every device pulls the new bundle.

## 1. SendGrid setup (do this BEFORE the first real send, can be done anytime before go-live)

- [ ] Create/confirm a SendGrid account and API key with **Mail Send** permission.
- [ ] Set up **domain authentication** (SPF + DKIM) for the sending domain (`updates@homesteadelectric.net` or whatever `gc_config/mail.from` is set to). Without this, most contractor inboxes will spam-folder or reject the digest outright.
- [ ] In Firestore, set `gc_config/mail` (console, function-only doc — no client UI writes this):
  - `key`: the SendGrid API key
  - `from`: sending address (must match the authenticated domain)
  - `origin`: `https://app.homesteadelectric.net` (or whatever the real prod origin is) — this is what portal links in emails point back to
  - `webhookPublicKey`: leave blank until step 2 is done, then fill in
- [ ] In SendGrid, create an **Event Webhook** pointed at the deployed `gcSendGridWebhook` HTTPS function URL. Enable **Signed Event Webhook** and copy the verification key into `gc_config/mail.webhookPublicKey`. Subscribe to at least: bounce, dropped, spam report, blocked. (Until this key is set, the webhook is a safe no-op — it won't reject SendGrid's calls, it just won't record anything, so bounces are silently un-tracked. Don't go live on a real GC without this wired up.)

## 2. Smoke test BEFORE any real contractor sees a link

- [ ] Create ONE test GC link in Settings → GC Portal (e.g. label it "TEST — delete me"), matched to a real or dummy job so the mirror has content.
- [ ] Use the **"Send test digest to me"** button (P0-3) with your own email. Confirm:
  - [ ] It actually lands in your inbox (not spam) within a minute or two.
  - [ ] Subject line, accent color, and job content look right.
  - [ ] The portal link in the email opens and loads the live board.
- [ ] Open the portal link itself on both a phone and a desktop browser. Confirm the board loads, a job detail opens, and the "Send a message" / "Assign your super" controls work without a login.
- [ ] Add a contact through Settings (P0-1 edit UI), confirm it appears in the portal's "Your team on these jobs" list within a few seconds (mirror rebuild / live snapshot).
- [ ] From the portal (no login, as a contractor would), submit one test message and one test date suggestion. Confirm both show up in Settings → GC requests inbox, and that "Apply"/"Mark handled" work.
- [ ] From that same portal session, confirm the sent item eventually shows the office's response inline (P0-11 — "Homestead has acted on this") after you handle it in the inbox.
- [ ] Revoke the test link. Confirm the portal URL immediately shows "no longer active" (not stuck loading, not a blank page).
- [ ] Delete the test link's data if it was seeded onto a real job (or just leave it revoked — revoked links don't get rebuilt or emailed).

## 3. First REAL contractor — go slow

- [ ] Pick the smallest, lowest-stakes active GC relationship for the very first real link — not your highest-value account.
- [ ] Create their link, add their actual contacts, review which jobs are included/excluded (P0-7/P0-8 — check the "Jobs on this link" list in the edit view matches what you'd want them to see).
- [ ] Send them the link directly (text/email/however you normally reach them) — do NOT rely on the digest to introduce it; let them look at the live board first so the first email isn't their first exposure to the whole idea.
- [ ] Watch the **first 8 PM digest** for that link. Check `gc_bounces` in the Firebase console the next morning — any bounce/dropped/spam event for that contact's address needs a human look before the next send.
- [ ] Ask the contractor directly: did the email look right, did the link work, was anything confusing. Fix issues before adding a second GC.

## 4. Roll forward — one GC at a time

- [ ] Add GCs one at a time over the following weeks, not all at once. Each new GC is a new set of real-world inboxes/spam filters/mobile browsers you haven't tested against yet.
- [ ] Re-check `gc_bounces` periodically (there's no alerting on it yet — it's a passive log, someone has to look).

## 5. What's intentionally NOT in this build (v1.5+, by design — not bugs)

- Texts/SMS to contractors (email only for now — Twilio + A2P 10DLC registration is a separate lead-time item).
- Contractor-side self-service contact/roster changes do NOT apply instantly — by design (P0-6) they always file a request for office review first. This is deliberate, not a missing feature.
- File upload FROM the contractor (they can share a link/message, not attach a file).
- Automatic SimPro contact import (see the SimPro proposal in the full requirements doc) — contacts are added manually today.

## 6. Rollback / kill switch, if something goes wrong

- **Stop all outbound email immediately, keep the portal live:** clear `gc_config/mail.key` in Firestore. `sendGcMail` fails safe and stops sending the moment the key is empty — no redeploy needed, no code change, takes effect on the next function invocation.
- **Cut off one contractor immediately:** hit "Revoke" on their link in Settings. Mirror access is rotated/torn down server-side within the same call — a revoked holder's already-open tab goes to "no longer active" as soon as their live listener next fires.
- **Something's wrong with a specific email render:** you can keep the portal live and disable ONLY the notification engine by clearing `gc_config/mail.key` (see above) while you fix `functions/gcNotify.js`, without touching any GC's access to their live board.
