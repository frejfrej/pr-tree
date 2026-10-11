# Fewer Atlassian requests per project build

**Date:** 2026-10-11
**Issues:** #78 (the commit counts), #84 (concurrent builds of one project)
**Target version:** 2.12.0 (not released yet: these join its changelog)

## 1. Goal

Two independent sources of repeated Atlassian requests while building the
data of `/api/pull-requests/:project`, each raising the risk of the HTTP 429
that pauses everything for 10 minutes:

- **#84**: `getCachedProjectData` (cache.mjs) builds on a miss without
  sharing a build in flight. Two requests for one project during a build
  (two tabs, the SYNC load during a page load, overlapping checks) run two
  full builds.
- **#78**: `buildProjectData` (project-data.mjs) skips the commit counts (two
  Bitbucket requests per pull request, ~400 on SECOLLAB) only when the hash
  of the whole response equals the one of the last response built, a single
  slot for the server. With two projects in use the hash never matches. And
  since the hash covers the Jira details, sprints and orphaned issues, any
  Jira change (one issue moved) refetches every count, though a count
  depends only on the branches of its pull request.

Neither fix covers the other: #84 alone leaves A, B, A alternating the slot;
#78 alone lets two builds of A in flight both fetch what A misses.

## 2. Decisions

1. **One shared-build helper in cache.mjs** (#84). `getOrBuild(key, build)`:
   the cached value, or the value of the build in flight for that key, or a
   new build whose `{ data, ttl }` is cached (the default TTL when `ttl` is
   undefined). A failure, `RateLimitError` included, reaches every caller
   sharing the build and is not cached. `getCachedProjects`,
   `getCachedProjectData` and `getCachedSyncStatuses` all go through it;
   `getOrSetCache` and the sync-only `pendingSyncStatuses` go away. The
   SYNC route's own `getCachedProjectData` call then joins a page load's
   build instead of starting a second one.
2. **Commit counts remembered per pull request** (#78), not per response:
   key `repo/destinationHash..sourceHash`, the key SYNC already uses for
   its results (sync-statuses.mjs), so a count is fetched again only when a
   commit of its pull request moved. The memo is per project (a `Map` by
   project name of `Map`s by key), replaced at the end of each successful
   build by the entries of the pull requests of that build: closed pull
   requests drop out, and a project never evicts another. `lastResponse`
   and the hash comparison go away; each build returns a new response.
   - A pull request without both commit hashes is fetched at every build
     (no key), as SYNC skips it.
   - A count that failed (`null`) is not remembered: the next build retries
     it. A build that fails (a page of pull requests, a rate-limit pause)
     leaves the memo as it was.
   - The requests still name the branches, not the hashes: the counts are
     what they are today, read when the key changes. Bitbucket may move a
     pull request's `destination.commit` only when the pull request is
     updated, so "behind" can lag when only the destination branch moves;
     today it lags the same way when nothing else changes, but any Jira
     change refreshed it incidentally, and that stops.
   - The frontend's change detection is unaffected: the hash (computed
     before the counts are added) covers the pull requests and so the
     commit hashes of the key; a count that changes always comes with a
     hash that changes.
3. **At most 10 commit-count requests at once**. The counts to fetch were
   one `Promise.all` over every pull request, two requests each: ~400
   concurrent Bitbucket requests on SECOLLAB's first build. The limiter of
   sync-statuses.mjs moves to its own module, `limiter.mjs`, used by both.
   The first build of a project spreads its counts over more time (~40
   rounds of 10 on SECOLLAB); later builds fetch only the counts of the
   pull requests that moved. The limit is a `createProjectData` option
   (`maxConcurrentCommitRequests`, default 10).
4. **The sprints run alongside the rest of the build**. The sprint chain
   (boards, active sprints, their issues) depends on nothing else of the
   build; it starts with the build and runs while the pull requests, the
   orphaned issues, the details and the parents are fetched one after the
   other. One `Promise.all` waits for both, so a failure of either fails
   the build as before (a sprint failure is still logged and skipped
   inside the chain). The order inside each chain is unchanged: the
   orphaned issues still precede the details so one parent request serves
   both.

## 3. Turned down

- **Keeping `lastResponse`, one per project** (#78 as filed): the smallest
  change, but any Jira change still refetches all the counts of the project.
- **Requests naming the commit hashes** (`include=<sourceHash>`): the count
  would match its key exactly, but a stale destination hash would then be
  read for good instead of today's live branch tip at each refetch.
- **Sharing the build in project-data.mjs**: the fixture source and the
  SYNC route's nested call would not benefit; the cache is where a key's
  build is decided.

## 4. Tests

- cache.test.mjs: two concurrent project-data calls build once and get the
  same data; a `RateLimitError` reaches both and is not cached; the projects
  list is cached for 300 s.
- project-data.test.mjs: build A, build B, build A unchanged: no commits
  request on the third; a Jira change alone fetches no count; a moved source
  commit refetches only that pull request's counts; a failed count is
  retried at the next build; a pull request without hashes is fetched each
  build; no more than the limit of commit requests in flight; the sprint
  requests start before the pull requests are all fetched.
- limiter.test.mjs: no more than the limit at once, the order of the queue,
  a rejection passed through and the queue going on.
