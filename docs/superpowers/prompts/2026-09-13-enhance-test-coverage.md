# Enhance the test coverage of pr-tree

## Goal

Raise what `npm test` proves about the server, without a new dependency and without a DOM. Coverage is the measure, not the goal: no test that only executes lines. Every test states a behaviour the documentation promises (README.md, CLAUDE.md) or a decision that would be costly to get wrong: what is stored in `sync-cache.json` for 90 days, what the client is shown.

## Where things stand (master at 3e12198, 2026-09-13)

`npm run test:coverage` (Node's built-in coverage, PR #53) prints the table below after the 124 tests. Run it again first; these numbers are the baseline, not the current state.

| Module | Lines | Branches | Functions | Uncovered |
|---|---|---|---|---|
| all files | 66.9% | 93.6% | 66.4% | |
| index.mjs | 24.8% | 52.0% | 27.9% | everything the fixture mode bypasses (detailed below) |
| cache.mjs | 89.0% | 100% | 60.0% | 52-53, 94-101 (`raiseAllCacheTtls`), 108-109 (`getCacheStats`) |
| conflicts.mjs | 99.3% | 92.8% | 100% | 72-73, 76 (escape sequences of a C-quoted path, a malformed one) |
| sync-cache.mjs | 100% | 100% | 84.6% | |
| fixtures/generate.mjs | 99.9% | 90.5% | 100% | 191 (weighted pick fallback) |
| public/app-filter.js | 72.2% | 100% | 89.1% | 18-20 (`initializeFilter`), 282-396 (`filterBranches`, the DOM walk) |
| public/app-render.js | 82.8% | 96.9% | 96.2% | 323-324 (unknown participant status), 386-464 (`initializePopovers`, DOM) |
| public/app-sync.js | 35.8% | 100% | 9.1% | everything but `conflictsTitle` |
| public/app-shell.js | 28.1% | 100% | 3.6% | everything but `buildDocumentTitle` |
| public/tree-toggle.js, counter-utils.js | 26%, 38% | 100% | 0% | DOM |
| public/app-url.js, projects.js, fixtures/index.mjs | 100% | 100% | 100% | |

Absent from the table because no test loads them: `public/app.js`, `public/multi-select.js`.

In `index.mjs` (839 lines, CRLF), the server test reaches only the fixture-mode branches of the routes. Not covered, with the line of each function: `atlassianFetch` (113: fixture-mode guard, the pause after a 429, the network failure message with the cause and the URL, `shortMessage` without the URL) and `failureReason` (145); the Atlassian fetchers `fetchInReviewIssuesWithoutPR` (151), `fetchCommitsDiff` (192), `fetchPullRequests` (216, pagination), `fetchJiraIssuesDetails` (260, batches of 50, then the parents), `fetchJiraSprints` (373), `fetchSprintIssues` (418); the pure helpers `extractJiraIssues` (247), `createJiraIssuesMap` (251), `fillPullRequestsMap` (349), `calculateHash` (360); the assembly `buildProjectData` (483); the bodies of `/api/pull-requests/:project` (575, called by no test, even in fixture mode) and `/api/cache/stats` (464); the non-fixture block of `/api/sync-statuses/:project` (612-653: the `sync-cache.json` lookup under the `conflictRuleVersion` prefix, the rule that only complete results are stored); the SYNC computation `fetchBitbucketJson` (681), `createLimiter` (699), `fetchDiffstatFiles` (718), `fetchPatch` (740), `checkPatch` (765), `computeConflicts` (785).

Tests to imitate: `test/sync-cache.test.mjs` (a module that takes `now` and `onError`), `test/cache.test.mjs`, `test/conflicts.test.mjs` (synthetic patches), `test/server.test.mjs` (the fixture server on `PORT=0`). The 17 fake-Bitbucket scenarios that reviewed #47 were never committed (issue #48); rebuild them as tests.

## Constraints (CLAUDE.md, all binding)

- `node:test` only, no dependency, no DOM emulation (no jsdom, no happy-dom). A plain object standing in for an element is acceptable only where the function just sets properties on it (`updateCounterDisplay`); never fake `querySelectorAll`, `classList` or events.
- `index.mjs` exports nothing, needs `config.js` and starts listening when imported: never import it from a test. Move code out of it into modules at the project root (like `conflicts.mjs` and `sync-cache.mjs`) that receive `fetch`, `log`, the workspace and credentials, a clock and the timeouts as parameters; the routes keep the wiring. Root modules match the coverage script's `*.mjs` pattern; a new directory needs a pattern in `package.json`.
- `index.mjs` uses CRLF endings on every line. After each edit, `grep -c $'\r' index.mjs` equals `wc -l < index.mjs` and `git diff --stat index.mjs` shows only the lines you meant. New files use LF.
- A pure move of `computeConflicts`, `checkPatch` or the diffstat mapping must not change a decision, so `conflictRuleVersion` stays; if a test shows a decision that has to change, bump it and say so in the pull request.
- A partial result (`reason`) or a failed one (`error: true`) is never stored in `sync-cache.json`; lookups stay under `<conflictRuleVersion>:<repo>/<dest>..<source>`.
- The tests never reach Atlassian and never need `config.js`; `npm test` stays fast (a quarter of a second today) and quiet. Fake `fetch` answers with real `Response` objects (`new Response(JSON.stringify(body), { status })`) so `.json()`, `.text()`, `.arrayBuffer()` and `.ok` behave; a timeout is a parameter so no test waits 30 seconds.
- Never `git add` `config.js`, `config.js.test` or `.claude/`; add files by name.

## Work, in order (one pull request per stage, stacked on the previous one)

1. **The SYNC computation, issue #48.** Move `computeConflicts`, `fetchPatch`, `checkPatch`, `fetchDiffstatFiles`, `fetchBitbucketJson`, `createLimiter` and the per-pull-request block of `/api/sync-statuses/:project` into `sync-statuses.mjs`, taking `fetch` (the server passes `atlassianFetch`), the workspace, `log` and the opened cache. `test/sync-statuses.test.mjs` with a fake `fetch` answering diffstats and diffs by URL, covering at least: no overlap (two requests, nothing else fetched); a conflict in the diffs; a line count differing from the diffstat; a file missing from a diff; more than 100 files to check, with and without conflicts already known from the diffstats (an error, or a partial SYNC); a failed and a timed-out diff request; a rate-limit pause in the middle of the requests; a rename at the 20-file boundary kept in one request; a result stored under the rule-version prefix and found again without a request; partial and failed results not stored; short reasons without the URL; the log line counting computed, unchecked and partly checked pull requests.
2. **The routes in fixture mode**, in `test/server.test.mjs`: `/api/pull-requests/:project` answers the documented shape (`lastRefreshTime`, `pullRequests`, `jiraIssuesMap`, `jiraIssuesDetails`, `pullRequestsByDestination`, `sprints`, `sprintIssues`, `orphanedIssues`, `dataHash`) and the same `dataHash` on a second call; `/api/cache/stats` answers the five counters; an unknown project (find out what the route answers today; `/api/sync-statuses` answers 404). Cheap, and it makes the route bodies appear in the table.
3. **The small gaps.** `cache.mjs`: `raiseAllCacheTtls` raises the entries expiring before the given delay and leaves the later ones and the never-expiring ones alone; `getCacheStats`. `conflicts.mjs` 72-76: a C-quoted path with `\t`, `\"` and an octal escape decoded, a malformed escape giving null. `app-render.js` 323-324: an unknown participant status. `app-filter.js`: `initializeFilter` returns the index it keeps.
4. **`atlassianFetch` and the rate limit.** Extract it into `atlassian-fetch.mjs` with `fetch`, a clock and an `onRateLimit` callback (the server passes `raiseAllCacheTtls` and the error log) injected; the fixture-mode guard stays in `index.mjs`. Tests: after a 429 from either API, every request throws `RateLimitError` until 10 minutes after the last 429 and the 429 body is drained; a network failure carries the cause and the URL in `message` and neither URL in `shortMessage`; `failureReason` gives the fixed sentence for a `RateLimitError` and `shortMessage` otherwise; the pull-requests route answers 503 with `rateLimitedUntil` during a pause (a server test can only reach this through the extracted module, so test the route's mapping with the module, not the server).
5. **The project data.** Extract the Jira and Bitbucket fetchers and `buildProjectData` into a module with `fetch` injected, and test the documented rules: pull-request pagination; Jira issues in batches of 50, then the parents that were not linked themselves (summary, type, fix versions, parent); sub-tasks inheriting the fix versions of their parent; orphaned issues are the ones in review without a pull request; `calculateHash` stable for the same data and changed when a commit moves; `pullRequestsByDestination` keyed by branch name across repositories (a known limitation to pin, not to fix); `extractJiraIssues` with a project regex; the commit counts fetched only when the hash changed.

Stages 1 to 3 are the priority; stop after any stage when asked.

## What not to do

- No tests for `filterBranches`, `initializePopovers`, `app-shell.js`, `tree-toggle.js`, `counter-utils.js` (beyond a plain-object stub), `app-sync.js` beyond its pure and state functions, `app.js`, `multi-select.js`: they need a DOM. Their check stays the fixture server in the browser (`npm run start:fixtures`, SECOLLAB, a filter change around a millisecond).
- No coverage threshold in the script, no `c8`, no lcov unless asked.
- No behaviour change hidden in a refactor: same requests in the same order, same log lines, same responses. Compare a SYNC load on OSLC before and after on a second instance (`PORT=3101 node index.mjs`; port 3000 is the instance in use; never a SECOLLAB load on the old code).

## Definition of done

- `npm test` green; `npm run test:coverage`: the new modules at 90% of lines or more, `index.mjs` left with the routes and the wiring, "all files" above the 66.9% baseline; the before and after table in each pull request description.
- `CLAUDE.md`: the new modules in Project Structure and Key Files, the "Unit tests" and "Coverage" bullets of Testing Approach, the `index.mjs` line count. `README.md` changelog: 2.7.1 for a refactor without behaviour change.
- Spec and plan under `docs/superpowers/specs` and `docs/superpowers/plans` as usual; one `claude/` branch per stage, stacked; pull requests to `master`, not merged. When merging a stack, retarget the next pull request to `master` before the current one's branch is deleted.
