# Changelog

## v20260605 (2026-06-05)

### Added
- ci/cd/release pipeline quartett (ci, nightly, release, _build) per hawkynt-standard + changelog generation and GFS nightly-pruning scripts + CI badge in the status row (8880563)
- rich tui (dda4d20)
- parse date and do not count rate limits against retries (a492ec2)
- detect and retry on server errors (b82d587)
- auto-continue sessions when parameterless invocation (b689e18)
- phase progressbar (21e8c10)
- initial commit (1a8b1bd)

### Fixed
- stale circuit breakers cut prevent resuming state (03814ef)
- making sure generating code is actually called (99ca91b)

### Other
- rename to README.md and standardize the badge block to the house style; drop vanity scope numbers (dd26cd1)
- Initial commit (be7d74f)

All notable changes are recorded here. This file is maintained automatically by
`.github/workflows/scripts/update-changelog.mjs`, which bucketises commits by
their prefix (`+` added, `*` changed, `-` removed, `#` fixed).
