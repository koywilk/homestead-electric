---
name: crew-brief
description: Write the plain-language "what changed" note Koy forwards to the crew after every Homestead Electric app deploy (or when he asks "what went in", "what's new", "explain the update for the guys", "release notes", "changelog for the crew"). Runs as the LAST step of every ship, unprompted (Koy 2026-09-30: "make that little brief a skill"), right after the one-paste and the vault log. Produces a paste-ready text block plus a shareable page, written for electricians on their phones, not for developers.
---

# Crew brief

The note Koy sends the guys after a deploy so they know what to look for and can send back what they want changed. It is part of shipping, like the SW bump and the FEATURES.md entry: write it every time, without being asked.

## Where the facts come from

1. `FEATURES.md` at the repo root: every entry tagged with the SW versions that went out in this push (everything since the version the crew was last told about). The header line says the current version.
2. The commit messages on `main` since the last brief (`git log --oneline <last>..HEAD`) catch ships from parallel sessions whose FEATURES entries you did not write.
3. When the push was a merge of two lines of work, cover BOTH; the crew does not care which session built it.

## Who reads it

Electricians and the office, on a phone, in a group text. They know the app's screens by their tab names (Job Board, My Day, Home Runs, Job Info, Panelized Lighting, Job Start, Gear & Submittals). They do not know component names, field names, Firestore, functions, hats, routes, caps or versions other than the number in Settings.

## Rules for the writing

- Lead with the version and one line: pull down to refresh, check Settings shows vNNN.
- Group by who it touches, in this order: **Everyone (resi and commercial)**, **Fixes**, **Commercial only** (or **Residential only** when a ship is resi-only), **Removed or changed**.
- One item = a bold name in the crew's words, one or two plain sentences on what it does and where it is, and for anything new a **Try:** line that says exactly what to tap. Skip Try on fixes.
- Name the person whose request it was when there is one ("Justin's request"). Crews like knowing they were heard.
- Say what was removed or moved, even when it was on purpose, so nobody hunts for a tab that is gone.
- Never: code names, field names, "three-way merge", "additive field", "hat", "route", "callable", "SW", function names, or why it won't lose data. That belongs in FEATURES.md, not here.
- Plain sentences, no emojis, no marketing tone. Under about 400 words unless the push was a big batch.
- End with one line: send what you find to Koy, which screen, which job, what you expected, screenshots help.

## Deliverables

1. **Paste-ready text** in the reply, exactly as Koy will forward it (headings in caps, dashes for items). This is the one that matters; a group text cannot open a link that is not shared.
2. **A shareable page** of the same note as an Artifact (load the `artifact-design` skill first; one narrow column, sections in the order above, a tag per item for Both / Commercial / Fix). Title it `App Update vNNN`. Say in the reply that it is private until Koy shares it from its Share menu.
3. Save the text as `docs/crew-briefs/vNNN.md` in the repo so the next brief knows where the last one stopped, and commit it with the ship.

## Example item

**Completed tab on every job.** Last tab on the job card. Every need or task finished on that job, who did it, when, who asked, photos. Voided ones show crossed out with the reason.
Try: open any job, swipe to the last tab. If something you finished last week isn't there, tell Koy which one.

## Same skill, other app

FieldInk / TraceVault has a copy of this skill in its own repo. Its facts come from the version comments at the top of `public/sw.js` and `src/version.js`, and its crews know the app by its tools (pins, live links, Panel Builder, Loads, Questions on the plan). Never mix the two apps in one brief.
