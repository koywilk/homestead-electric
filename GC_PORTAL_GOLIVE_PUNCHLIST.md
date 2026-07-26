# GC Portal — Go-Live Punch List (what's left, pre-filled)

Status as of 2026-07-21 evening. Checklist step 0 + the no-email half of step 2 are
DONE and verified. **Provider is now Resend, not SendGrid** — see the note below.
Everything remaining is either the DNS records (blocked only on the right Squarespace
login) or your admin PIN — pre-filled here so each item is a short task.

## Provider swap: SendGrid → Resend (2026-07-21)

We tried SendGrid first. Its new signups now route through **Twilio One**, whose
email product is a different API and pushes you toward a card/upgrade flow — not
worth it. Swapped the whole email path to **Resend** (2-min signup, no card,
3k emails/month free, cleaner API). Code is done + deployed:
- `sendGcMail` now posts to `https://api.resend.com/emails` (Bearer key), with
  600ms send-pacing for Resend's 2 req/s free-tier limit.
- The bounce webhook (`gcSendGridWebhook` — name kept so the URL is stable) now
  verifies **Resend's Svix signature** (HMAC-SHA256, constant-time, ±5-min replay
  window; pure verifier + 7 unit tests in `gcNotify.js`, all passing).
- Config field renamed `webhookPublicKey` → **`webhookSecret`**; added optional
  **`replyTo`**.
- Deployed 4 functions (gcSendGridWebhook, gcPortalSendTestMail,
  gcPortalDailyDigest, gcPortalDrainQueue). NOT yet committed to git — one-paste
  is at the bottom of this file.

## Verified done today (no action needed)

- **Step 0 complete.** All three Phase 0 deploys live + verified (rules byte-match,
  `gc_rate`/`gc_bounces` function-only, all gc functions present, prod serves SW v351).
- **Portal smoke test (no-email half of step 2) passed** on the Robison test link:
  board loads (desktop + 375px mobile), co-brand lockup, counters, contact chips,
  job detail (QC walk 8/8, COs, https-only Matterport), date suggestion → "✓ Date
  sent", message → "✓ Sent to Homestead". Both landed in `gc_requests` (correct
  type/jobId/gcKey/status=new).
- **Resend account created** (koy@homesteadelectric.net) and `homesteadelectric.net`
  added to Resend (status: Not Started — waiting on the 3 DNS records in step B).
- Seeded Robison contacts' `email: true` booleans are **harmless** — addresses come
  from a separate `emailAddr` field, regex-validated before any send.

## ⚠️ Where the DNS lives (the one real gotcha)

The domain's nameservers are `ns-cloud-*.googledomains.com`, BUT a full scan of your
Google Cloud projects (via Cloud Shell) found **no DNS zone there** — so the records
are NOT managed in Google Cloud. When Google Domains shut down, this domain migrated
to **Squarespace**, which now hosts its DNS (the ns-cloud nameservers just kept
pointing at Google's infra). So the records go in **Squarespace's DNS panel** — but
under the Squarespace account the domain actually migrated into, which is almost
certainly **"Continue with Google → koywilkinson@gmail.com"** (NOT the Squarespace
login we tried earlier that showed "no domains").

## A. Your 5-minute inbox check (admin PIN — do anytime)

Two live test requests are sitting in **Settings → Contractor Portal → Requests**
(both on Pieroth, from "Claude — rollout checklist test"):
1. **Apply** the date suggestion, **Mark handled** the message (or dismiss both).
2. Then reopen the portal link and confirm the item shows the office response
   inline (P0-11 readback):
   `https://homestead-electric.vercel.app/?gcportal=gcp_test_token_robison`

## B. Resend DNS + config (the remaining go-live work)

**B1. Add these 3 DNS records** in Squarespace's DNS panel for `homesteadelectric.net`
(log in via Continue with Google → koywilkinson@gmail.com — see the gotcha note above).
All are on subdomains — they can't touch your Gmail, website, or anything existing.

| Type | Host / Name | Value | Priority |
|------|-------------|-------|----------|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC+D9jXraFcDjsJMJ6hPNHSPi97B/P2yq3BV6VeynlSy3Y5UKuDpbxRyafJVD/fP06rrlenJP+yH5yD5QtZLPSmylnsgetGXS8tTgMILuj0enSwQphHKpvw5VjfNVkh0OClRyGRskf/OpfXufiAdCTHkKy58ns3ParGRUUidsNpqwIDAQAB` | — |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

Then in Resend → Domains → homesteadelectric.net → **Verify DNS Records** (goes green
in a few minutes on Google-backed DNS). Do NOT add Resend's optional "Enable
Receiving" MX — that would reroute your incoming Gmail. Sending only.

**B2. Create the Resend API key**: Resend → API Keys → Create → **Sending access**,
domain `homesteadelectric.net`. Copy the `re_...` key.

**B3. EDIT the existing config doc** — `gc_config/mail` already exists (created
2026-07-21; key/from/origin/soakTo set). Firebase console → Firestore →
`gc_config` → `mail`. Current → target field diff:
   - `key` = ✅ already set (Resend `re_...`)
   - `from` = `onboarding@resend.dev` today → **flip to `updates@homesteadelectric.net`
     ONLY after the domain verifies in Resend** (flipping early makes every send 403)
   - `origin` = ✅ already `https://homestead-electric.vercel.app`
   - `replyTo` = **ADD NOW** = `koy@homesteadelectric.net` (required before soak ends —
     without it a contractor who hits Reply on a digest dead-ends into a no-reply void)
   - `webhookSecret` = add in B4
   - `soakTo` = `koywilkinson@gmail.com` today (SOAK MODE — every outbound GC email
     reroutes here; nothing reaches contractors while set). **Removing it is step B7,
     never earlier.**

**B4. Bounce webhook**: Resend → Webhooks → Add Endpoint →
   `https://us-central1-homestead-electric.cloudfunctions.net/gcSendGridWebhook`
   Subscribe to at least: **email.bounced, email.complained, email.failed**.
   Copy the endpoint's **Signing Secret** (`whsec_...`) into
   `gc_config/mail.webhookSecret`. (Until it's set, bounces are silently untracked —
   don't put a real GC on a digest before this is done.)

**B5. Test digest**: Settings → Contractor Portal → the test link → **Send test
   digest to me** with your own email. Check: lands in inbox (not spam),
   subject/accent/jobs look right, portal link opens.

**B6. Revoke drill**: do it on a throwaway "TEST — delete me" link you create fresh —
   NOT the Robison link (revoke rotates its URL; it's the standing demo link).
   Create → open its portal URL → revoke → confirm the tab flips to "no longer active".

**B7. END THE SOAK — strict order, state-gated (NOT date-gated).** Two silent failure
modes exist and both are invisible in the app, so the order matters:
   1. Resend → Domains → homesteadelectric.net shows **Verified** (green) — B1 done
   2. `from` flipped to `updates@homesteadelectric.net` (B3)
   3. `replyTo` set (B3) and `webhookSecret` set (B4)
   4. "Send test digest to me" arrives at an EXTERNAL address (proves real-domain
      sending works — during soak the test reroutes to the soak inbox, so do this
      check right after clearing soakTo, see 5)
   5. **THEN delete the `soakTo` field** — mid-morning, when `gc_notify_queue` is
      empty (queued instants burn their 5 retry tries in ~25 min; don't strand them)
   6. Send one more test digest to yourself + confirm the 8 PM digest that night
   ⚠️ NEVER clear `soakTo` while `from` is still `onboarding@resend.dev` — every
   contractor send would 403 silently: no delivery, no bounce record, no app signal.
   ⚠️ The reverse trap: finishing B1-B6 but forgetting this step means everything
   looks green while every "contractor" email still lands only in your gmail.

## C. First real GC (checklist step 3 — go slow)

Unchanged from the checklist: smallest low-stakes GC first, hand them the link
personally before any digest, watch the first 8 PM digest, ask them directly how
it looked. **Morning-after check (corrected by the review pass):** `gc_bounces`
alone is a FALSE all-clear — API-level failures (403s, bad key) never generate
bounce events at all. The real checks: (a) Resend dashboard → Emails shows the
digest as Delivered, (b) Cloud Function logs have no `[gcMail] send failed`
entries. Check `gc_bounces` too, but only AFTER those two.

## Kill switches

- **Safest hold: set `gc_config/mail.soakTo` to your own email** — everything keeps
  flowing, but only to you. (Clearing `mail.key` also stops sends, but queued
  instants still burn their 5 retry tries against the missing key and get dropped
  after ~25 min — use `soakTo` when you might turn things back on.)
- Stop all email hard: clear `gc_config/mail.key` (takes effect next invocation;
  accepts losing whatever is in the queue).
- Cut one contractor: Revoke their link in the Contractors tab (portalId rotates
  server-side; their open tab goes to "no longer active").

## Commit the Resend swap (not yet in git)

The functions are deployed but the source change isn't committed. One-paste:

```bash
cd ~/Desktop/homestead-electric && git add functions/index.js functions/gcNotify.js scripts/gcnotify-test.js GC_PORTAL_GOLIVE_PUNCHLIST.md && git commit -m "GC Portal email: swap SendGrid → Resend (Svix-verified bounce webhook, send-pacing, tests)" && git push
```

Why it won't lose data: functions-only change, no Firestore reads/writes altered,
no rules touched, no client bundle change (no SW bump needed). `sendGcMail` still
fails safe when `gc_config/mail.key` is unset, so nothing sends until you finish B.
