# Stop the other side's diff requests when one side fails — plan

Spec: `docs/superpowers/specs/2026-10-11-stop-other-side-diffs-design.md`.

1. **Test first** (`test/sync-statuses.test.mjs`): 41 files to check (three
   requests per side); one side answers 502 at once while the other has a
   request in flight (aborted, no further request), then while the other's
   first request answers late (no further request). Both report the 502.
   Fails before the change.
2. **Code** (`sync-statuses.mjs`): `fetchPatch` takes a signal, checks it
   before each request and combines it with the timeout through
   `AbortSignal.any`; `computeConflicts` aborts a shared controller when a
   side rejects. `npm test` passes.
3. **Check** that Node's fetch rejects with the abort reason on a body that
   never ends.
4. **Docs**: a 2.12.0 changelog line in README.md.
5. Commit, push, pull request against master closing #52.
