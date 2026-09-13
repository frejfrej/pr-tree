# Conflicts from Bitbucket's patches, kept for good

**Date:** 2026-09-11
**Issue:** #46
**Target version:** 2.7.0
**Status:** Approach approved by the user in conversation on 2026-09-11 (patch-based check, persistent cache, explicit feedback, SECOLLAB in scope); this spec is submitted for their review before the plan

## 1. Goal

A SYNC load must finish in seconds, never freeze the server, report every
pull request it computed with an explicit badge, and cost few enough
Bitbucket requests to be run on SECOLLAB (112 open pull requests).

Today `computeConflicts` fetches the three versions of every overlapping
file and merges them with `node-diff3`, synchronously. The library's LCS
degrades on files with many identical lines: the `package-lock.json` of one
`products.web.oslc` pull request (about 30,000 lines a side) ran for 301 s on
the event loop, during which nothing else was served and the 30-second
timeouts of the three other computations in flight could not fire; they all
fired at the millisecond the merge ended and produced `?` badges. At about
ten requests per pull request, a SECOLLAB load would also exhaust Bitbucket's
hourly limit.

## 2. Decisions

1. **Conflicts are decided from the two patches, not from file contents.**
   For a pull request `dest..source`, Bitbucket's
   `diff/{side}..{other}?topic=true` returns the changes of one side since
   the merge base as a unified diff, so the hunks of both sides are in the
   line coordinates of the same merge-base version. Git's rule is then
   decidable from the two patches: two changes of the same file conflict
   when their base ranges overlap or touch (end of one equals start of the
   other, an insertion being an empty range) unless they replace the same
   range with the same lines; a file deleted on one side and changed on the
   other conflicts; a file added on both sides conflicts unless the added
   content is identical; a binary file changed on both sides conflicts.
   Validated on three OSLC pull requests on 2026-09-11: the patch line
   counts equal the diffstat counts on both sides (`topic=false` differs, so
   the parameter is honoured), `path` can be repeated, and the rule agreed
   with `diff3Merge` on every file the merge could handle (four files, two
   conflicts, two clean). The three-way merge, the merge-base call, the file
   fetches and the `node-diff3` dependency go. No worker thread: parsing a
   patch is linear.
2. **Requests per pull request: two without overlap, four with (up to 20
   overlapping files).** The two diffstats stay (they
   are paginated, 500 entries a page) and give the overlapping files keyed by
   their base path. No overlap: no conflict, done. Decisions that need no
   content are taken from the diffstat statuses (removed on both sides:
   nothing; removed on one side only: conflict). For the other overlapping
   files, one diff request per side restricted to those files with repeated
   `path` parameters, old and new paths included, in chunks of 20 files per
   request so the URL stays short. More than 100 overlapping files: the pull
   request is reported not checked (`too many overlapping files`) rather than
   half checked as today.
3. **Results are kept for good.** A result depends only on the two commit
   hashes, so it never changes: `sync-cache.json` in the project directory
   (git-ignored) holds `{ "version": 1, "entries": { "repo/dest..source":
   { "conflicts": bool, "files": [...], "computedAt": iso } } }`. It is read
   once at startup (missing or unreadable: empty, logged), consulted before
   any request, written after each sync-statuses computation that added
   entries (temporary file then rename, so a crash never leaves a truncated
   file), and pruned of entries older than 90 days when written (hashes of
   merged pull requests accumulate). Only successful computations are
   stored; a failure is retried at the next load, as today. In fixture mode the
   file is never written (the route answers from the fixtures). It replaces the
   5-minute `getCachedConflicts` entry of node-cache; the per-project
   sync-statuses response keeps its own 5-minute cache.
4. **Explicit feedback once statuses are loaded.** `{ conflicts: false }`
   paints a green `OK` badge ("No conflict with the destination branch");
   `{ conflicts: true, files }` the red `SYNC` badge with the conflicting
   files in the tooltip (the first five, then "and N more"); `{ error: true,
   reason }` a grey `?` with "Could not check: reason" (request timeout, an
   HTTP status, too many overlapping files); a pull request absent from the
   response keeps the grey `?` "SYNC status unknown, use the load button"
   (its commits moved since the load). While statuses are not loaded, nothing
   is painted, as today. The SYNC filter gets a third value, "Not checked",
   for the `?` badges; "SYNC ok" now means computed without conflict.
5. **The response shape gains two fields.** `statuses` entries are
   `{ conflicts: true, files: [...] }`, `{ conflicts: false }` or
   `{ error: true, reason }`; `lastRefreshTime`, `rateLimited`,
   `rateLimitedUntil` unchanged. The fixtures produce the same shapes (a
   few conflicting files, a few reasons).
6. **Timeouts and concurrency unchanged.** The 4-slot limiter and the
   30-second `AbortSignal.timeout` per request stay; with the event loop free
   they now work as intended.
7. **Version 2.7.0:** a fix and a visible feature (badges, persistence),
   after #41's 2.6.0.

## 3. Out of scope

- A request budget or a smarter circuit breaker for Bitbucket's limit; the
  10-minute pause on HTTP 429 stays as it is.
- Bitbucket's own `pullrequests/{id}/conflicts` endpoint (needs OAuth).
- Moving the SYNC-badge reads of the filter pass from the DOM to the index:
  #42 does that; here the OK badges are collected from the DOM like the SYNC
  ones.
- The `?` a pull request gets when its commits moved between the render and
  the load (existing behaviour).

## 4. Behaviour

- OSLC load: seconds instead of minutes; the server answers other requests
  meanwhile; the badges read OK, SYNC or `?` with a reason on every pull
  request of the response.
- SECOLLAB first load: about 2 requests per pull request without overlap, 4
  with, roughly 300 in total; a reload computes only the pull requests whose
  hashes changed; a restart keeps the results.
- `npm ci` no longer installs `node-diff3`.
- Filter: "SYNC required" keeps the SYNC badges, "SYNC ok" the OK badges,
  "Not checked" the `?` badges.

## 5. Code structure

| File | Change |
|---|---|
| `conflicts.mjs` (new, pure) | `parseUnifiedDiff(text)` (files keyed by base path: added, deleted, binary, change regions `{ start, end, lines }` in base coordinates), `conflictingFiles(sideA, sideB)`, `decideFromDiffstat(sourceFiles, destFiles)` |
| `sync-cache.mjs` (new) | `openSyncCache(filePath)`: `get(key)`, `set(key, result)`, `save()` (atomic, prunes), the load at construction |
| `index.mjs` (CRLF) | `computeConflicts` rewritten on `fetchDiffstatFiles` (kept) and a new `fetchPatch(repo, side, other, paths)`; the sync-statuses route consults the persistent cache and saves it; `fetchFileAtCommit`, the `diff3Merge` import and `maxConflictCandidates` removed |
| `cache.mjs` (CRLF) | `getCachedConflicts` and `CACHE_KEYS.CONFLICTS` removed |
| `package.json`, `package-lock.json` (CRLF) | `node-diff3` removed, version 2.7.0 |
| `.gitignore` (CRLF) | `sync-cache.json` |
| `public/app-sync.js` | the three badges and their tooltips, the "Not checked" option |
| `public/app-filter.js` | the OK badges collected like the SYNC ones, `sync` values `requested`, `OK`, `unchecked` |
| `public/styles.css` | `.conflicts-ok` on the existing success tokens |
| `fixtures/generate.mjs` | `files` and `reason` in `generateSyncStatuses` |
| `test/conflicts.test.mjs`, `test/sync-cache.test.mjs` (new), `test/app-filter.test.mjs`, `test/server.test.mjs`, `test/fixtures.test.mjs` | synthetic patches for every rule, cache round trip and pruning, the filter values, the response shape |
| `README.md`, `CLAUDE.md`, `PRD.md` | the SYNC badges, the cache file, the conflict computation, 2.7.0 |

## 6. Verification

`npm test`. A real OSLC load on a second instance (spare port): completes in
well under a minute with OK, SYNC and reasoned `?` badges only, the server
answers `/api/version` during the load; a second load computes nothing (no
`computeConflicts` line in performance.log); a restart followed by a load
computes nothing either. The SECOLLAB load is left to the user.

## 7. Delivery

Branch `claude/conflicts-from-patches` from `master` (#45 is merged), pull
request to `master`, closes #46.
