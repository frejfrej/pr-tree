# The SYNC load button computes again

**Date:** 2026-10-11
**Issue:** #49 (follow-up of #47, #46)
**Target version:** 2.12.0 (unreleased, no version bump)

The user asked for the implementation of the issue; the choice between its
two proposals is below.

## 1. Problem

`/api/sync-statuses/:project` keeps its response 5 minutes per project. After
a push, the next refresh of the tree shows the pull request with its new
commits and its badge turns `?` ("SYNC status unknown - use the SYNC load
button to refresh"); a click on the load button within 5 minutes of the
previous load gets the cached response, and the `?` stays. A pull request
"not checked" after a failure cannot be checked again for 5 minutes either,
although such results are never stored so that the next load retries them.

The cache predates 2.7.0. Since then every complete result is kept in
`sync-cache.json` per pair of commits: a load computes only the pull requests
whose commits moved (two to four Bitbucket requests each) and the ones not
checked before; a load where nothing moved sends no request.

## 2. Design

**No response cache outside a rate-limit pause.** The route's build returns
`keep: false` where it returned `ttl: 300`, in fixture mode too. Only the load
button calls the endpoint (never automatically, F6.4), so every call is an
explicit load: a `refresh` query parameter would add a second path that
nothing takes.

Kept as they are:

- **One computation per project at a time**: `getOrBuild` (cache.mjs) shares
  the build in flight with the calls made meanwhile (two tabs, two clicks),
  `keep: false` included.
- **The rate-limit pause**: a response built during a pause is kept until the
  pause closes, so the clicks made meanwhile send nothing and get the same
  answer; the TTL raise of a new 429 (`raiseAllCacheTtls`) still applies.
- **A stopped load** (#93): already not kept.

The tooltip of the `?` badge is unchanged: it is now true.

### Turned down

- **A `refresh` parameter sent by the load button**, the response cache kept
  for other callers: there are none.
- **A shorter TTL** (30 seconds): the same bug in a smaller window.

## 3. Tests

- server.test.mjs (fixture server): two loads in a row are both computed (their
  `lastRefreshTime` differs).
- cache.test.mjs already checks that `keep: false` shares the build in flight
  and caches nothing.

## 4. Documentation

README changelog (2.12.0), PRD 7.4 and 7.5 (the TTL of the endpoint).

## 5. After the /code-review of #97

- **Over-limit results are stored.** Without the response cache, a pull
  request with more files to check than `maxFilesToCheck` sent its diffstat
  requests and logged its error line again at every click (2 of 104 pull
  requests on SECOLLAB, 2026-09-12). That result depends on the two commits
  alone, so it is stored in sync-cache.json like a complete one; a change of
  `maxFilesToCheck` now bumps `conflictRuleVersion`. Failures and results
  partial after a failure are still computed again. No version bump: no
  stored entry changes meaning.
- **The keep decision is tested.** `syncStatusesKeep(pause)` (cache.mjs)
  returns `{ ttl }` during a pause, `{ keep: false }` otherwise; both
  branches of the route use it, and cache.test.mjs checks it with
  `getCachedSyncStatuses`. The route itself still runs only in fixture mode
  in the tests, where no pause can happen.
- **Docs**: a click during a running load gets that load's answer; "a few"
  requests per moved pull request instead of "two to four" (patches go 20
  files per request).
- **Not changed**: the project data the SYNC build reads can be newer than
  the page (its cache expired between the page's refresh and the click); the
  statuses are then keyed on the newer commits and the `?` stays until the
  next refresh, which finds them. This race predates #49. The page and the
  build read the same project-data cache, so the build is never older than
  the page.
