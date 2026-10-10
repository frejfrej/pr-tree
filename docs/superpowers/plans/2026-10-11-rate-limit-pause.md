# Rate-limit pause on the page: plan

Spec: `docs/superpowers/specs/2026-10-11-rate-limit-pause-design.md` (#77).

1. **`public/atlassian-pause.js`** with `readProjectResponse`,
   `formatPauseEnd`, `pausedStateText`, `pauseIndicatorTitle`,
   `showPauseIndicator`; `test/atlassian-pause.test.mjs` first (200, 503 with
   and without a date, 500, a body that is not JSON; rounding up to the
   minute, an exact minute kept, midnight).
2. **Banner**: `#atlassianPause` in index.html, `.atlassian-pause` rules and
   the `--header-warning` token in both theme blocks of styles.css, hidden
   text below 900px; a contrast test in styles.test.mjs.
3. **app.js**: `fetchData` returns the result of `readProjectResponse`;
   `pausedUntil` and the pause-end timer; `selectProject`, `checkForUpdates`,
   `renderEverything` (paused state message), `startPeriodicChecking` and
   `stopPeriodicChecking` as in the spec; app-sync.js uses `formatPauseEnd`.
4. **Manual check**, fixture server, both themes: in the console, override
   `window.fetch` so `/api/pull-requests/` answers
   `new Response(JSON.stringify({ error: 'paused', rateLimitedUntil }), { status: 503 })`
   with an end two minutes ahead; switch project (paused message and
   indicator), then a refresh with a tree (tree kept, indicator), restore
   `fetch` and wait for the end (tree loads, indicator gone).
5. **Release**: package.json 2.12.0, README changelog and features list, PRD
   (rate-limit pause and 7.5), CLAUDE.md file list.
