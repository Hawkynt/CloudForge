# Agent guide — CloudForge

Working agreement for **all** coding agents (Claude Code, Codex, Copilot, …)
and human contributors working in this repository. These rules are not
optional. The full house spec lives in the `Hawkynt/project-template` repo
(`STANDARD.md`); this file is the per-repo distillation.

## What this is

A **Node.js orchestrator** (`forge.js` + `lib/`) that drives an AI coding
agent through 18 structured engineering phases. Prompts live in `prompts/`,
tests in `tests/`. No transpilation — plain Node, runs from checkout.

## Commits

- **Group changes semantically/logically** — one phase/concern per commit.
- **Every subject line starts with a prefix**: `+` added · `-` removed ·
  `*` changed · `#` bug fixed · `!` critical todo.
- Never start a subject with "fix"/"bugfix"/"changed"/"modified".
- **No AI traces anywhere**: no `Co-Authored-By` AI lines, no "Generated
  with" footers, no agent mentions in messages, comments, or authorship.

## The loop (always, in this order)

1. **Before committing**: run the test suite locally (`node --test tests/`
   or the runner CI uses — keep them identical) and `node --check` every
   touched script. Update README sections (phases, features, workflow
   customization) when behavior changes; `CHANGELOG.md` is generated —
   never edit it by hand.
2. **Commit** (rules above) and **push**.
3. **Wait for CI**; on `main` a green CI triggers the nightly (prerelease +
   GFS prune). Fix and loop until everything is green.

Stable releases are **manual** (`gh workflow run release.yml`) — never cut
one unless explicitly asked.

## Code conventions

- Modern Node idioms (ES modules where the codebase uses them, async/await,
  destructuring); two-space indentation; guard clauses over deep nesting.
- The orchestrator passes `--dangerously-skip-permissions` to its agent —
  treat anything that widens filesystem/command reach as a security-relevant
  change and call it out in the commit body.
- State under `.cloudforge/` may contain sensitive task descriptions — never
  log or commit it.

## README & repo conventions

- Standard frame: title → badges → one-line `>` blockquote; fixed emoji
  mapping for the standard sections (`## ✨ Features`, `## 🛠️ …Building…`,
  `## ❤️ Support`, `## 📜 License`); repo-specific sections keep plain or
  consistent topical headers.
- License is LGPL-3.0-or-later; the `## ❤️ Support` section and
  `.github/FUNDING.yml` stay intact.
