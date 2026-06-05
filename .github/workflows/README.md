# CI/CD Pipeline — CloudForge

> Everything in this folder is the automated pipeline for this repository.
> Workflows live here, their helper scripts live in `scripts/`.
>
> This is the Hawkynt-standard quartett (see the `hawkynt-standard` repo),
> instantiated for a plain Node.js CLI tool.

## What this does

Three workflows, one shared build block, three helper scripts:

| File                            | Trigger                             | Purpose                                   |
|---------------------------------|-------------------------------------|-------------------------------------------|
| `ci.yml`                        | push + PR + `workflow_call`         | Syntax check + `node --test` suite on ubuntu + windows |
| `release.yml`                   | **manual dispatch**                 | Package + publish, then tag `vyyyyMMdd`   |
| `nightly.yml`                   | successful CI run on `main`/`master`| Publish `nightly-yyyyMMdd` prerelease     |
| `_build.yml`                    | `workflow_call` (internal)          | Zips the tool into `CloudForge.zip`       |
| `scripts/version.pl`            | invoked by the workflows            | Stamp package manifests (no-op: no manifest here yet) |
| `scripts/update-changelog.mjs`  | invoked by the workflows            | Bucketise commits into CHANGELOG.md       |
| `scripts/prune-nightlies.mjs`   | invoked by the workflows            | 3-gen (GFS) retention of nightlies        |

## How it works

```
                push / PR
                    │
                    ▼
            ┌───────────────┐
            │    ci.yml     │──► node --check + node --test
            └───┬───────┬───┘    on ubuntu + windows
                │       │
   dispatch ────┤       │  on success on main/master
                ▼       ▼
        ┌──────────┐  ┌─────────────┐
        │ release  │  │  nightly    │
        │  .yml    │  │   .yml      │
        └────┬─────┘  └─────┬───────┘
             │              │
             ▼              ▼
        (both call _build.yml → CloudForge.zip)
             │              │
             ▼              ▼
  publish + tag vyyyyMMdd  nightly-yyyyMMdd (prerelease)
                                │
                                ▼
                       scripts/prune-nightlies.mjs
                       (GFS: 7 daily + 4 weekly + 3 monthly)
```

## Test tiers

CloudForge's suite is pure `node:test` unit tests with no external-tool
dependencies, so there is a single **required** tier (`node --test`). If an
advisory tier (external CLIs, OS integration, timing-sensitive tests) is ever
added, give it its own step with `continue-on-error: true` so it reports but
never blocks a merge — the required step must keep excluding it.

## What it's for

- Every PR is built and tested on ubuntu + windows before it can merge.
- Every merge to `main`/`master` produces a **tested** nightly prerelease.
- A **manual dispatch** cuts a stable release from artifacts built by `_build.yml`, then tags the dated `vyyyyMMdd` Release at that commit.
- Old nightlies are auto-pruned on a **Grandfather-Father-Son** schedule.

## Why it's built this way

- **No cron triggers.** Event-driven only — CI fires on PRs, nightlies fire when CI passes on main, stable releases fire on manual dispatch.
- **Files drive versions, never tags.** CloudForge carries no package manifest, so there is no version to stamp; the repo-level Release/tag is the date marker `vyyyyMMdd`. The moment a `package.json` is added, `version.pl --stamp` picks it up automatically.
- **Release calls CI via `workflow_call`.** Calling ci.yml explicitly keeps tests and releases in lockstep with zero copy-paste.
- **Nightly builds from the `workflow_run` payload's SHA**, not branch tip — so a nightly is always a build of code CI actually validated.
- **`_build.yml` is the single packaging block**, shared by release and nightly so they never diverge.
- **3-generation (GFS) retention**, not "keep last N". GFS guarantees at least one build per week for a month and one per month for a quarter.

## Scripts

### `version.pl`

The one versioner, identical in every repo. It scans for **package manifests**
across ecosystems and stamps each independently — `*.csproj`/`*.fsproj`/`*.vbproj`
(`<Version>`), `package.json` & `composer.json` (`"version"`), and `*.pm` that
declare `$VERSION`. For each, BUILD = commits touching **that manifest's parent
folder**. CloudForge currently has no manifest, so `--stamp` is a no-op.

```
perl .github/workflows/scripts/version.pl --stamp  # rewrite the version in every manifest
perl .github/workflows/scripts/version.pl --build  # print the repo-wide build number (commit count)
perl .github/workflows/scripts/version.pl --list   # "<manifest>\t<composed-version>" per package
```

> There is no single repo version. Stable releases are tagged with a **date
> marker** `vyyyyMMdd`, not a version.

### `update-changelog.mjs`

Prepends a new section to `CHANGELOG.md`. Commit-subject convention: `+` Added, `*` Changed, `#` Fixed, `-` Removed, `!` TODO, anything else → Other.

### `prune-nightlies.mjs`

GFS retention with `DAILY_KEEP=7`, `WEEKLY_KEEP=4`, `MONTHLY_KEEP=3`. Dry-run with `--dry-run`.

## Who maintains this

This folder is an instance of the shared Hawkynt pipeline template. When
changing it, prototype in the `hawkynt-standard` template and mirror the change
here (and in the other consuming repos).

## Release artifacts

| Artifact                                 | Produced by          |
|------------------------------------------|----------------------|
| `app-artifacts` (`CloudForge.zip`)       | release + nightly    |
