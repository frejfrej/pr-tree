# The URL follows a refresh that drops a filter value — plan

Spec: `docs/superpowers/specs/2026-10-11-refresh-url-design.md`.

1. **Fix** (`public/app.js`): `updateUrlWithFilters({ replace: true })` after
   `renderEverything(newData)` in `checkForUpdates()`.
2. **Docs**: a 2.12.0 changelog line in README.md, an F5 acceptance criterion
   in PRD.md.
3. **Browser**: fixture server, SECOLLAB, select a participant and "Ready for
   reviewers"; override `window.fetch` so the next check answers the same
   data with another `dataHash` and without that participant; run the check
   (the refresh icon): the URL drops `participant` and `work`, and
   `history.length` is unchanged. A check with the same `dataHash` leaves
   the URL alone. `npm test` passes.
4. Commit, push, pull request against master.
