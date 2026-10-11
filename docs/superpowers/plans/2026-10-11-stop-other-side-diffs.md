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
6. **After the /code-review**: the abort moves to the `catch` of
   `computeConflicts` (no wrapper per side); the late answer of the test is
   triggered by the abort and awaited through its body read instead of
   timers (each half fails without its part of the fix); the spec says what
   the stopped side rejects with and why the Node 20 leaks of
   `AbortSignal.any` do not apply; the changelog line counts the requests
   per side. The load-level signal is turned down in the spec.
