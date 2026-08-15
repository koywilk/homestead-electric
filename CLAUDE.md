# CLAUDE.md — Homestead Electric app repo

## The brain: read the Obsidian vault first (source of truth)

The brain is the **Command Center vault** at `~/Desktop/Command Center/` (its own
folder, OUTSIDE this repo — moved there 2026-07-09; it used to live gitignored at
`Homestead-Electric-Brain/` inside this repo). Before writing code or giving advice
about this app, READ THE VAULT FIRST: `~/Desktop/Command Center/Home.md`, then the
section relevant to the task (`02-Features`, `03-Roadmap`, `05-Decisions`,
`01-Architecture`, `04-Incidents`, `08-Specs`, ...). The vault is the **single
source of truth** for this app's brain — features, decisions, data-shape gotchas,
deploy workflow, org, and specs all live there. Follow the vault's own operating
rules in `~/Desktop/Command Center/_CLAUDE.md`.

The vault also holds the brain for Koy's second app, FieldInk / TraceVault
(`~/Desktop/homestead-pdf-markup`), under `10-FieldInk/`, and the cross-app map at
`00-Maps/Connections - Homestead x FieldInk.md`. The two apps are separate repos —
never apply one's code rules to the other.

The packaged `homestead-electric-app` skill is still used and still auto-loads as
a fast quick-reference — keep using it. Treat it as a summary that should match
the vault: **when the skill and the vault disagree, the vault wins** (it is the
freshest, writable copy). Always record new decisions, features, incidents, and
conventions **in the vault** (the writable brain); the packaged skill is a
read-only cache. To keep the two from drifting, the weekly `homestead-skill-refresh`
task can be pointed at the vault so the skill is regenerated from it.

## Log every ship to the vault — automatically, without being asked

**Standing instruction (Koy, 2026-07-11): "I shouldn't have to ask you to do that
every single time."** After any deploy/ship or substantive work session on this
app, WRITE THE DAILY VAULT LOG as the closing step of shipping — do NOT wait to be
prompted. Convention: `~/Desktop/Command Center/Logs/YYYY-MM-DD - Homestead
Electric.md`, `type: log` frontmatter matching the existing logs, with `[[wikilinks]]`
to the incidents/features the work touched; also update any incident/decision notes
the work involved. Treat it as part of the deploy-hygiene close-out, alongside the
one-paste. This is the deliberate standing **exception** to the Hard boundary below
— logging-after-ship IS expected vault-touching. FieldInk gets the same treatment in
its own `~/Desktop/Command Center/Logs/YYYY-MM-DD - FieldInk.md`.

## Vault commands (/obsidian-*, /research, /youtube, etc.)

The 44 `obsidian-second-brain` slash commands and their supporting skills live in
`.claude/commands/` and `.claude/skills/` at THIS repo root (alongside the app's own
`/deck-refresh`, `/ship-report`, `/morning-brief`), so all of them are available in one
Claude Code session — no need to `cd` into the vault separately.

**When running any `/obsidian-*` (or `/research`, `/youtube`, `/podcast`, etc.) command,
treat `~/Desktop/Command Center/` as the vault root.** That's where `_CLAUDE.md`, the
folder map (`00-Maps`, `02-Features`, `03-Roadmap`, etc.), and all vault notes actually
live. Those commands look for "`_CLAUDE.md` in the vault root" — resolve that to
`~/Desktop/Command Center/_CLAUDE.md`, not this file, and read/write vault notes under
`~/Desktop/Command Center/`, not the repo root.

## Code structure: the Graphify knowledge graph

`graphify-out/GRAPH_REPORT.md` at this repo root is an auto-generated map of the CODE
(2,268 symbol-level nodes — including ~1,200 inside `src/App.js` — organized into named
communities with god-node hubs). For code-structure questions ("what calls X", "where
does Y live", "what breaks if I change Z"), read GRAPH_REPORT.md or run
`~/.local/bin/graphify query "<question>"` / `path` / `explain` / `affected` BEFORE
grepping App.js blindly. Check the report's "Built from commit" line against
`git rev-parse HEAD`; if stale, refresh with `~/.local/bin/graphify update .` (local
AST only, no API cost — the daily sync task also does this each morning).

Precedence: the graph is DERIVED code knowledge and never outranks the vault. Decisions,
data-shape gotchas, incidents, and conventions still come from `~/Desktop/Command Center/`
first. The FieldInk repo has its own separate graph — never mix the two.

## Hard boundary

Never edit app code (`src/App.js`, `functions/`, `firestore.rules`,
`public/service-worker.js`) as a side effect of a vault/`/obsidian-*` command, and never
run git or deploy as part of vault work. The reverse also applies: app-code work should
not write into `~/Desktop/Command Center/` unless the task is explicitly about the vault.

## In-app SOP guides must track the app (standing rule, Koy 2026-08-12)

`public/sops/*.html` are the crew trainings behind the in-app "?" buttons
(SOP_MAP / HelpDot, SW v380). Koy: the guides must "always [be] accurate to the
current version of the app." So: **any ship that changes how a feature works
must update that feature's guide in the same ship** — check it as part of
deploy hygiene, alongside the FEATURES.md entry. Renaming a tab moves its
guide's filename too (filename = tab label lowercased, symbols stripped;
`sharelinks.html` is spot-mounted, not tab-bound). The recording checklist +
status lives in the vault: `11-Trainings/In-App SOP Recordings - Checklist.md`.
