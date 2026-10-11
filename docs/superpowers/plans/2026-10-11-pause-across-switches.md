# The pause indicator stays across project switches — plan

Spec: `docs/superpowers/specs/2026-10-11-pause-across-switches-design.md`.

1. **Test first** (`test/atlassian-pause.test.mjs`): `pauseEndAfter` keeps
   the end on a failure, takes the end of a paused answer (503 or cached
   data), clears it on data without an end. Fails before the change.
2. **Code**: `pauseEndAfter` in atlassian-pause.js; in app.js, `setPause`
   drops a past end and owns the end timer (`schedulePauseEnd`, `endPause`),
   `selectProject` no longer clears the pause, the load and the check update
   it through `pauseEndAfter`, `showNoDataState(until)` replaces
   `renderEverything(null)`, the periodic start and stop no longer touch the
   end timer. `npm test` passes.
3. **Manual check**, fixture mode, `window.fetch` overridden in the page: a
   503 with an end a minute ahead, then the empty project entry (indicator
   stays), then a 500 on another project ("Could not load", indicator
   stays), then the end (indicator hidden, no check without a project).
4. **Docs**: a 2.12.0 changelog line in README.md; the #77 spec's decision
   4 and 5 point to this spec.
5. Commit, push, pull request against master closing #83.
6. **After the /code-review**: `takeAnswer` shared by the load and the
   check; a failure during a pause names the next check's time; a 503 whose
   pause is already over is a failure and the load checks at once; the
   tooltip no longer promises a check without a project. Turned down: clock
   skew, the hidden tab's message, the SYNC pause (spec, section 3).
