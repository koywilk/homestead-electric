# Link Opens: see whether a share link was opened, and how often

**Date:** 2026-10-07 · **Status:** design approved by Koy · **Mockup (approved build target):** https://claude.ai/artifact/VVztH2GiyiiMFLmcRbaaN6

## Why

Koy: *"I mostly want to see if they have even opened it, or how many times they have opened it."*

Today nothing tells the office whether a GC, designer, homeowner or sub ever opened a link. The share pages keep a "last visit" stamp, but only in the visitor's own browser (`he_qseen_<jobId>_<shareId>`). v433 usage tracking skips share pages on purpose. The only signal is activity. Answers, replies and "Ask for more info" notes show the link was opened. Silence could mean either "never opened" or "opened and did nothing".

## What it does

- Every share page counts its own opens.
- Next to each link, the office sees a single line: **"Opened 6× · 2 devices · last today 9:12 am"**. Other states read "Not opened yet", "Not opened · sent 4 days ago" and "No opens since Oct 7". Tapping a line that has opens unfolds first opened, last opened, and one row per device ("iPhone · Safari · 4× · last today 9:12 am").
- Display only. **No pushes, no emails, no roll-up page** (Koy chose "just show it").

## Scope

**Counted (v1):** `?questions=` (named `&s=` links and the base link), `?roughpunch=`, `?finishpunch=`, `?qcpunch=` (named and base), `?homeowner=`, `?homeruns=`, `?loads=`, `?lighting=`, `?lutronshare=`, `?jobnote=`.

**Not counted:** `?lightinghub=1` (no single job), `?appmap=1`, and the GC Portal (`?gcportal=` and `/p/<token>`). The GC Portal is served by its own function, so it gets a separate follow-up.

## How an open is recorded

**One recorder at the router.** `App()` already routes every share link before any of its hooks run ([App.js](../../../src/App.js) `function App()`, the `hoParam` … `jnParam` block). A plain function `recordLinkOpen()` is called once at the top of `App()`, before the first route check. A module-level flag runs it once per page load, so React re-renders and StrictMode double-invokes are harmless. It never throws and never blocks rendering. Failures go to `console.warn` only.

**What it skips:**
1. **Staff devices.** If the device has ever been signed into the app, it's skipped. The check is the raw `he_identity` key, read directly rather than through `getIdentity()`, which deletes an expired identity. A durable `he_staff_device = "1"` flag also counts; `_setUsageUser()` sets it whenever the app shell renders with an identity. Together these cover the office copying or testing a link, crew phones, and an expired PIN. Contractor identities are skipped too.
2. **Preview.** Any URL with `preview=1`, which covers the in-app Preview iframe.
3. **Repeat loads.** If the same device opened the same link less than **30 minutes** ago (localStorage `he_lo_<jobId>_<linkKey>` = last ISO), the load doesn't count. If storage throws, the load counts once per page load.
4. **Unrecognized URLs.** Anything outside the scope list, or one with an empty job id.

Text-message link previews (iMessage, SMS unfurls) never run the page's JavaScript, so they never count.

**Link key:** `<kind>:<shareId>`, where `shareId` is `?s=` or `base` when there's no `?s=`. Kinds: `questions`, `roughpunch`, `finishpunch`, `qcpunch`, `homeowner`, `homeruns`, `loads`, `lighting`, `lutronshare`. Job notes use `jobnote:<noteId>`, parsed from `?jobnote=<jobId>:<noteId>:<token>`. The token is never stored.

**Device id:** a random id kept in localStorage `he_link_device`. If storage throws, a fresh id is made for each page load. The device label is a rough guess from `navigator.userAgent`: `iPhone`, `iPad`, `Android`, `Mac`, `Windows` or `Other`, plus `Safari`, `Chrome`, `Edge`, `Firefox` or `Browser`. Nothing else from the browser is kept. No IP address, location or name.

## Data

New collection **`link_opens/{jobId}`**, one doc per job. Nothing is written to `jobs/{id}`, so the link-safety rule (outside-party data never on the job doc) holds.

```
link_opens/{jobId} = {
  links: {
    "<linkKey>": {
      opens:   <int>,           // increment(1)
      firstAt: "<ISO>",         // written only when absent
      lastAt:  "<ISO>",
      devices: {
        "<deviceId>": { label: "iPhone · Safari", opens: <int>, lastAt: "<ISO>" }
      }
    }
  },
  updated_at: "<ISO>"
}
```

**Write:** one `getDoc` to see whether `firstAt` exists for this key, then one `setDoc(..., { merge: true })` with `increment(1)` on `opens` and on the device's `opens`, plus `lastAt`, the label, `updated_at`, and `firstAt` if it was missing. If two first opens race, one `firstAt` overwrites the other a second apart, which is harmless. The write isn't stamped with the version lock, because this collection is written only by public share pages. Those are out of scope in the Version Lock spec, the same as `homeowner_requests`.

**Rules** (new block in `firestore.rules`):

```
match /link_opens/{jobId} {
  allow read: if true;
  allow create, update: if request.resource.data.keys().hasOnly(['links', 'updated_at'])
                        && request.resource.data.links is map
                        && request.resource.data.updated_at is string;
  allow delete: if false;
}
```

Anyone can bump a counter, the same trust level as the rest of the public share surface. Nobody can delete the doc. Nothing in it is sensitive, and nothing reads it to make decisions.

## Where it shows (matches the mockup)

1. **Share Questions modal → SAVED LINKS.** Each named link's row gets the line under its name and question count. The base link (`?questions=<jobId>`, what **Share all** copies) gets a row labeled "Base link (Share all)" when it has opens or the job still carries a legacy `questionsFilter`. Otherwise it's hidden, so a job nobody shared that way shows no extra row.
2. **Share Punch modal (rough and finish) → SAVED LINKS.** Same line, same place, and the same base-link rule using `roughPunchFilter` / `finishPunchFilter`.
3. **One link per job** gets the line directly under its Share button: Home Runs "Share ↗", Lighting collab "Share ↗", "Share loads", the Plan Changes (Lutron) share, the Homeowner generator page link, and each Job Note's share link.

**Office read:** a hook, `useLinkOpens(jobId)`, opens an `onSnapshot` on `link_opens/{jobId}` only while one of those surfaces is mounted, and closes it on unmount. A missing doc means "no opens".

**Line states** (pure helper `linkOpenState(entry, createdAt, nowMs, sinceIso)`):

| State | When | Dot | Text |
|---|---|---|---|
| on | opens > 0 and lastAt within 3 days | solid green | `Opened N× · D device(s) · last <when>` (`Opened once · <when>` if N = 1) |
| once | opens > 0 and lastAt older than 3 days | solid blue | same text |
| late | no opens, createdAt ≥ tracking start, sent 3+ days ago | solid red | `Not opened · sent N days ago` |
| none | no opens, createdAt ≥ tracking start, sent under 3 days ago | hollow grey | `Not opened yet · sent today` / `· sent N days ago` |
| pre | no opens and (createdAt < tracking start or createdAt unknown) | dashed grey | `No opens since <Mon D>` |

- `sinceIso` is a constant set to ship day (`LINK_OPENS_SINCE`).
- One-per-job links have no `createdAt`, so they show `pre` until their first open.
- `<when>` is "today 9:12 am", "yesterday 6:55 am", a weekday within 6 days ("Fri 4:40 pm"), otherwise "Oct 4, 8:31 pm".
- Colors come from the app's `C` palette: green `#3E7D5A`, blue `#3B5BA5`, red `#B23A3A`, grey `C.muted`. No yellow or amber.
- Lines with opens are buttons and unfold the detail. Lines without opens are plain text.

## Error handling

- **Recorder:** wrapped in try/catch end to end. A refused or offline write is dropped with a `console.warn`. A lost open is acceptable; a broken share page is not. It runs after the route decision and adds no `await` to rendering.
- **Office line:** if the snapshot errors, the line isn't shown at all. It never shows a wrong "Not opened".

## Testing

- `scripts/link-opens-dryrun.js` extracts the pure helpers from `App.js` with the same `extract()` + `vm` pattern as the other dry-runs, and asserts:
  - `linkOpenTarget(search)` across every kind, including named and base shares, `preview=1`, `lightinghub`, the GC Portal, the job-note parse, and an empty id.
  - `shouldRecordOpen(lastIso, nowMs)` at the 30-minute edge.
  - `deviceLabel(ua)` on real iPhone, iPad, Android, Mac Chrome, Mac Safari and Windows Edge strings.
  - `linkOpenState()` for all five states and the 3-day edges.
  - `formatOpenWhen()` for today, yesterday, a weekday and a date.
- `CI=true npm run build` must pass, with no pipe.
- Live check after ship:
  1. Open a real questions link in a private window, then confirm the Saved Links row reads "Opened once".
  2. Reload within 30 minutes and confirm it still reads once.
  3. Open the same link from a signed-in device and confirm the count doesn't change.

## Ship checklist (from deploy hygiene)

- Bump the SW to the next free version. Add a FEATURES.md entry and a `docs/crew-briefs/vN.md`.
- Update the SOP guides in the same ship: `questionlinks.html`, `liveviewlink.html`, `lightinglinks.html`, `generatorlink.html`, plus any punch or job-note guide that shows the share modal.
- Deploy `firestore.rules`. The new block is additive and no existing rule changes.
- Data safety: a new additive collection only. No loader, no `jobs/{id}` field, no existing write path touched.
- Write the vault log and crew brief after shipping.

## Later (not in v1)

- GC Portal opens, recorded by the portal's own function.
- A roll-up of every unopened link across all jobs.
