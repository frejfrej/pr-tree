# Enhance Test Coverage Implementation Plan

**Goal:** Test the server's SYNC computation (#48), the routes in fixture mode and the small gaps of the coverage table, without a new dependency and without a DOM, as a refactor without behaviour change (2.7.1).

**Spec:** `docs/superpowers/specs/2026-09-13-enhance-test-coverage-design.md`

**Branches:** one per stage, stacked: `claude/sync-statuses-module` (from `master`), `claude/fixture-route-tests`, `claude/small-coverage-gaps`, `claude/atlassian-fetch-module`, `claude/project-data-module`. Never `git add` `config.js`, `config.js.test` or `.claude/`; add files by name.

**CRLF:** `index.mjs` and `cache.mjs` use CRLF endings on every line; after each edit `grep -c $'\r' index.mjs` equals `wc -l < index.mjs` and `git diff --stat` shows only the lines meant. New files use LF.

**Checks:** `npm test` green and quiet; `npm run test:coverage` before and after each stage, the table in the pull request.

---

### Stage 1: `sync-statuses.mjs` (#48)

- [x] `atlassian-fetch.mjs`: `RateLimitError`, `failureReason` (moved from `index.mjs`)
- [x] `sync-statuses.mjs`: `createSyncStatuses({ fetch, workspace, bbAuth, log, syncCache, timeoutMs, maxConcurrent })` returning `computeConflicts` and `computeSyncStatuses`; `fetchBitbucketJson`, `createLimiter`, `fetchDiffstatFiles`, `fetchPatch`, `checkPatch` moved as they are
- [x] `index.mjs`: the route calls `computeSyncStatuses`, keeps the fixture branch, the rate-limit fields and the TTL
- [x] `test/sync-statuses.test.mjs`: the scenarios of section 4 of the spec, with a fake Bitbucket answering by URL
- [x] `CLAUDE.md`, `README.md` (2.7.1), `package.json` (2.7.1, 2026-09-13)

### Stage 2: the routes in fixture mode

- [x] `test/server.test.mjs`: `/api/pull-requests/:project` shape and stable `dataHash`, `/api/cache/stats` counters, an unknown project on both routes
- [x] `CLAUDE.md`

### Stage 3: the small gaps

- [x] `test/cache.test.mjs`: `raiseAllCacheTtls` (raised, later, never expiring), `getCacheStats`
- [x] `test/conflicts.test.mjs`: an unknown escape and an unclosed quote in a C-quoted header
- [x] `test/app-render.test.mjs`: `renderParticipant` with an unknown status (exported, `console.log` stubbed)
- [x] `test/app-filter.test.mjs`: `initializeFilter` returns the index it keeps
- [x] `CLAUDE.md`

### Stage 4: `atlassianFetch` in `atlassian-fetch.mjs`

- [x] `atlassian-fetch.mjs`: `createAtlassianFetch({ fetch, now, backoffSeconds, onRateLimit })` returning `fetch`, `rateLimitedUntil()`, `pause()`; the wrapper moved as it is
- [x] `index.mjs`: the fixture-mode guard stays as `atlassianFetch`; the callback raises the TTLs and logs; the routes read `atlassian.rateLimitedUntil()` and `atlassian.pause()`
- [x] `test/atlassian-fetch.test.mjs`: the pause from either API until 10 minutes after the last 429, the drained body, the failure messages, `failureReason`, the 503 and sync-statuses fields during a pause
- [x] `CLAUDE.md`, `README.md`

### Stage 5: the project data in `project-data.mjs`

- [x] `project-data.mjs`: `createProjectData({ fetch, workspace, bbAuth, jiraSiteName, jiraAuth, log })` returning `buildProjectData(projectName, projectConfig)` and the fetchers; the pure helpers exported; generated from the text of `index.mjs`
- [x] `index.mjs`: `buildProjectData(projectName)` keeps the lookup and the fixture branch and delegates; `crypto` no longer imported
- [x] `test/project-data.test.mjs`: the rules of the prompt and the documented failures, against a fake Atlassian
- [x] `CLAUDE.md`, `README.md`
