# Enhance the test coverage: the SYNC computation, the routes, the small gaps

**Date:** 2026-09-13
**Issue:** #48 (the SYNC computation); the routes and the small gaps have no issue
**Target version:** 2.7.1 (a refactor without behaviour change)
**Prompt:** `docs/superpowers/prompts/2026-09-13-enhance-test-coverage.md`, stages 1 to 3
**Status:** Decided in an interactive session; section 2 lists the decisions taken without a review round

## 1. Goal

Raise what `npm test` proves about the server without a new dependency and
without a DOM. `index.mjs` exports nothing, needs `config.js` and starts
listening when imported, so its 24.8% of covered lines are the fixture-mode
branches of the routes: the conflict computation that decides what
`sync-cache.json` keeps for 90 days has no committed test (the 17 fake-Bitbucket
scenarios that reviewed #47 were never committed). Coverage is the measure,
not the goal: every test states a behaviour the documentation promises or a
decision that would be costly to get wrong.

## 2. Decisions

1. **`sync-statuses.mjs` holds the SYNC computation.** `createSyncStatuses`
   receives `fetch` (the server passes `atlassianFetch`), the workspace and
   the Bitbucket authorization, an error and a performance logger, the opened
   `sync-cache.mjs`, the request timeout and the concurrency, and returns
   `computeConflicts(repoName, spec)` and `computeSyncStatuses(projectName,
   pullRequests)`, the per-pull-request block of `/api/sync-statuses/:project`
   (the lookup under the `conflictRuleVersion` prefix, the rule that only
   complete results are stored, the save, the summary log line). The route
   keeps the fixture branch, the project data, the rate-limit fields of the
   response and its TTL. A pure move: the same requests in the same order,
   the same log lines, the same results, so `conflictRuleVersion` stays at 2.
2. **`atlassian-fetch.mjs` starts with `RateLimitError` and `failureReason`.**
   The computation needs both (a rate-limit failure is reported with a fixed
   sentence and not logged), and so does the pull-requests route. Stage 4 of
   the prompt moves `atlassianFetch` into this module; starting the module
   now avoids a temporary home for the class. The fixture-mode guard and the
   pause stay in `index.mjs` until then.
3. **The fake `fetch` stands for `atlassianFetch`.** It answers diffstats and
   diffs by URL with real `Response` objects, and throws what `atlassianFetch`
   throws: a `RateLimitError`, or an error whose `message` holds the URL and
   whose `shortMessage` does not. A timeout is what the `signal` the module
   passes reports (`AbortSignal.timeout(timeoutMs)`, with `timeoutMs` a few
   milliseconds in the test).
4. **The cache in the tests is the real `openSyncCache` on a temporary file**,
   so the tests prove what reaches the disk, not what a fake recorded.
5. **`renderParticipant` is exported for the tests.** Its unknown-status
   branch is unreachable through `renderPullRequest`, which passes one of
   four statuses; the test stubs `console.log` so `npm test` stays quiet.
6. **`raiseAllCacheTtls` is tested with `mock.timers`** (`node:test`, the
   `Date` API only): node-cache reads `Date.now()` for its expiries, so the
   clock is advanced instead of waited for, and the three cases (raised,
   left alone because later, left alone because never expiring) are told
   apart by whether an entry is still served after the clock moved.
7. **An unknown project on `/api/pull-requests/:project` answers 500 today**
   (`buildProjectData` throws "Project not found", the route maps every
   error to 500) while `/api/sync-statuses/:project` answers 404. The test
   pins the 500; changing it is a behaviour change, out of a 2.7.1.

## 3. Out of scope

- Stages 4 and 5 of the prompt (`atlassianFetch`, the project data fetchers).
- Tests needing a DOM (`filterBranches`, `initializePopovers`, the shell,
  the toggles, `app.js`, `multi-select.js`).
- A coverage threshold, `c8`, an lcov report.

## 4. Behaviour (unchanged)

The server behaves as in 2.7.0. What the tests now state:

- `test/sync-statuses.test.mjs`: no overlap costs two requests (one when the
  source side changed nothing); a conflict found in the diffs, or not; a
  line count that differs from the diffstat, or a file missing from a diff,
  reports the pull request not checked, never clean; more than 100 files to
  check is an error, or a partial SYNC when the diffstats already proved a
  conflict; a failed or timed-out diff request likewise; a rate-limit pause
  gives the fixed reason and no error log line; a renamed file at the
  20-file boundary goes with its paths in one request; a result is stored
  under `<conflictRuleVersion>:<repo>/<dest>..<source>`, found again without
  a request, and a result under another version is not reused; partial and
  failed results are not stored; the reasons sent to the client are the
  short messages, the log keeps the URL; at most four computations run at
  once; the summary log line counts computed, not checked and partly checked.
- `test/server.test.mjs`: the documented shape of `/api/pull-requests/:project`
  and a stable `dataHash`; the five counters of `/api/cache/stats`; the
  answers to an unknown project.
- `test/cache.test.mjs`, `test/conflicts.test.mjs`, `test/app-render.test.mjs`,
  `test/app-filter.test.mjs`: the small gaps of section 2.

## 5. Delivery

Three pull requests stacked on `master`, one per stage, from
`claude/sync-statuses-module`, `claude/fixture-route-tests` and
`claude/small-coverage-gaps`; each carries its before and after coverage
table; none is merged by the session. When merging, retarget the next pull
request to `master` before the current one's branch is deleted.
