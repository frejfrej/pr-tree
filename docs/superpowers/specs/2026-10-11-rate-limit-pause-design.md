# The page tells when Atlassian requests are paused

**Date:** 2026-10-11
**Issue:** #77 (follow-up of #74, 2.11.0)
**Target version:** 2.12.0

## 1. Goal

During the 10-minute pause after an HTTP 429, `/api/pull-requests/:project`
answers 503 `{ error, rateLimitedUntil }` whenever it has to build the data
(cache miss, or a 429 in the middle of a build since 2.11.0). `fetchData`
(public/app.js) turned every non-ok answer into `null`: a project load showed
"Could not load", a refresh kept the old tree with no sign that it was stale.

## 2. Decisions

1. **One module, `public/atlassian-pause.js`**, owns the pause on the page:
   - `readProjectResponse(response)` reads a `/api/pull-requests` response
     into `{ data }` (with `pausedUntil` when the answer carries an end, see
     4), `{ pausedUntil }` (a 503 whose `rateLimitedUntil` is a date, as
     epoch ms) or `{}` (any other failure). A 503 without a readable
     date is an ordinary failure: there is no end to announce.
   - `formatPauseEnd(until)`: HH:MM, 24-hour, **rounded up to the minute**.
     The server's pause ends on an arbitrary second; "until 14:32" read at
     14:32 would still be refused, "until 14:33" never is.
   - The texts of the main-pane message and of the banner tooltip.
   - `showPauseIndicator(until)`: the banner indicator, hidden with 0.
   Pure except the last one, which touches the DOM only when called, so the
   rest is unit-tested.
2. **Project load paused**: the main pane says "Atlassian requests are paused
   until HH:MM after a rate limit (HTTP 429). <Project> will load then." with
   an hourglass icon in the default muted colour of the state messages (no
   status colour: `--warning-strong` is 4.25:1 on `--background-color`, where
   the messages sit). The banner indicator shows too.
3. **Banner indicator** `#atlassianPause`, between the refresh icon and the
   last refresh time: the warning triangle of the SYNC controls and
   "Paused until HH:MM", the tooltip naming the rate limit and saying that the
   page checks again at the end (it shows with a tree or without one). The last
   refresh time stays: it says how old the tree is. The indicator is a
   `role="status"` region. Below 900px the text is visually hidden (clipped,
   not `display: none`, so the status region still reads it) and the icon and
   its tooltip stay; the banner gap goes from 12px to 8px and the project
   select may shrink, so the banner still fits a 400px window with the
   indicator and a long project name. Icon and text
   take a new token `--header-warning`: #FFE380 on the light banner #0052CC
   (5.38:1; `--warning-strong` there is 2.0:1), `var(--warning-strong)` on the
   dark banner (10.57:1). styles.test.mjs checks 4.5:1 against `--header-bg`
   in both themes.
4. **The answer carries the pause**: during a pause the TTLs are raised, so
   most answers are cached data with status 200, not 503 (after a 429 of a
   SYNC load, the likeliest one, every check gets the cached tree). The route
   adds `rateLimitedUntil` (the live `atlassian.pause()`, `null` outside a
   pause) to each 200 answer when it sends it, outside the cached object, so
   `dataHash` and the cache are untouched; `readProjectResponse` returns it
   with the data. The 503 carries the same live value, so a build that ended
   on a `RateLimitError` after the pause was over answers a 503 without an
   end: an ordinary failure, retried at the next check, instead of a pause
   announced as already over. A SYNC answer that reports a pause sets it too
   (`syncPauseEnd`), at once rather than at the next check; it never clears
   one, its own answer may be cached from before the pause. app.js keeps `pausedUntil` (epoch ms, 0 when none) for the
   current project, set from every answer: a 503 or a 200 with an end sets
   it, anything else clears it. A project switch clears it with the refresh
   time, as both belong to the data left.
5. **Checks during the pause**: the periodic check skips its fetch while
   `Date.now() < pausedUntil` (the server would answer 503 or the cached data
   it already sent). Instead, one check is scheduled one second after the end
   of the pause, so the page loads or refreshes at the time it announced,
   not up to two minutes later. The timer lives with the periodic interval:
   `startPeriodicChecking` (re)schedules it, `stopPeriodicChecking` (hidden
   tab, project switch) clears it; a load that ends in a hidden tab starts
   no checks, the tab does when it becomes visible again. The check that
   runs on becoming visible again skips if the pause is still on, and the
   timer is set again. A new 503 at that check (the pause was extended) moves
   both.
6. **Checks and loads do not overlap**: no check is sent while a project load
   is in flight (`projectLoading`; a check on becoming visible during a load
   would build the same data again and could paint over the loading
   message). A load and a check compare `loadGeneration`, bumped by every
   switch, after their fetch: comparing the project missed a check started
   before a switch A → B → A, which painted during A's new load (CLAUDE.md
   pitfall 9).
7. **A deferred first render is the load's render**: when the load got no
   data, the check that later gets some renders it like the load would have
   (`renderProjectLoad`): the URL-or-typed-text choice of that load, and the
   URL replaced after the render with the filters kept (pitfall 10).
8. **Refresh with nothing rendered** (the last load failed or was paused):
   the main-pane message follows the last answer, paused or failed, so a
   pause after a failure, or a failure after a pause, is not left showing the
   previous message.
9. **The SYNC warning** uses `parsePauseEnd` and `formatPauseEnd` too, so both
   say the same time (it showed `toLocaleTimeString`, with seconds).

## 3. Turned down

- **A fixture option forcing the pause** (`--fixture-pause`): the fixture
  source never goes through `atlassianFetch`, so the option would need a path
  of its own in index.mjs for a manual check. The check overrides
  `window.fetch` in the browser console instead (plan, task 4).
- **Replacing the refresh time by the pause**: the age of the tree is what
  the user needs to judge the stale data.
- **Retrying sooner than the pause end**: the server sends nothing to
  Atlassian before it, a request could only return the cache.
- **Keeping the indicator across a project switch** (review of PR #82): the
  pause belongs to the server, not to a project, but the indicator follows
  the answers of the project shown, and a pause kept without a project has no
  check to clear it at its end. Filed as #83, done since: the pause is kept
  across switches and the end timer is the indicator's own
  (`2026-10-11-pause-across-switches-design.md`), which replaces the end of
  decision 4 and the timer of decision 5.
