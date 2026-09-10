# Remove what nothing uses

**Date:** 2026-09-10
**Issue:** #41
**Target version:** 2.6.0
**Status:** Decided in an autonomous session, without a review round (the user asked for the brainstorm to be done alone); every removal below was verified twice by searching the repository (the review of 2026-09-10, then an independent search by a subagent); section 2 lists the decisions to revisit

## 1. Goal

Delete the code, dependencies and files that have no caller and no reader,
and make the documentation follow. Nothing observable changes for the user of
the dashboard, except that an endpoint the frontend never called disappears.

## 2. Decisions

1. **Three dependencies go.** `fetch` (1.1.0) is never imported. `node-fetch`
   is replaced by the `fetch` built into Node: the server only uses
   `response.ok`, `status`, `statusText`, `json()`, `text()`, `arrayBuffer()`
   and the request options `method`, `headers` and `signal`
   (`AbortSignal.timeout`), all identical on the built-in one. `dotenv` only
   ever loaded a `.env` file that nothing documents, for the single `PORT`
   variable, which `PORT=3100 node index.mjs` sets without it. The README
   states the requirement that replaces them: Node.js 20.11 or later (the
   server test already uses `import.meta.dirname`). No `engines` field: the
   README sentence is enough for a tool run from a checkout.
2. **The per-pull-request conflicts endpoint goes.** `GET
   /api/pull-request-conflicts/:repoName/:spec` has had no caller since the
   SYNC load moved to `/api/sync-statuses/:project` (2.1.0). The route and its
   documentation are removed; `getCachedConflicts`, `conflictsLimiter` and
   `computeConflicts` stay, the sync-statuses endpoint uses them per pull
   request. The server test checks the route answers 404 and the sync-statuses
   one still answers.
3. **The sprint cache is deleted, not wired.** `getCachedSprints` was imported
   and never called: the sprints have always been fetched with the project
   data, every build, and they are part of `dataHash`. Wiring a separate
   10-minute cache would save two or three Jira calls per build and delay a
   new sprint by up to ten minutes; the calls that matter for the rate limit
   are the commit counts (two per pull request), so the simpler option wins:
   the function, its key and the documented TTL go. `clearCache` and
   `clearAllCache` go with them (no caller).
4. **Frontend leftovers.** `MultiSelect.getOptions` and `setDisabled` have no
   caller; with `setDisabled` gone nothing ever adds the `disabled` class, so
   the guard in `toggle()` and the `.multi-select.disabled` rule in the
   stylesheet go too. In `app-render.js`, `resolvedIssuesAlert` is always the
   empty string (removed with its slot in the warnings block) and
   `getBranchUrl` loses the first parameter it never read.
5. **Repository files.** `config.js.default` loses `bitbucket.repoName` and
   `jira.issuesRegex` (unread since the project definitions moved to
   `projects.js`); `start.bat` (`node index.mjs`) goes, `npm start` does the
   same on every platform. `fetchJiraSprints` loses the `jiraAuth` it
   recomputed identically to the module-level one.
6. **Version 2.6.0:** a public endpoint is removed, so a minor bump rather than
   a patch; no feature.

## 3. Out of scope

- `getCachedSyncStatuses`, a second copy of `getOrSetCache` for a dynamic
  TTL: it has a caller, and folding it is a redesign of the cache API.
- The other small duplications noted by the review (`handleTextFilterInput`
  next to `handleFilterChange`, the initial `reloadInterval = 100`): they are
  used code, not unused code; #42 or a later pass.
- The sprint-issue pagination bug and the per-project `lastResponse`
  (reported separately, not filed yet).

## 4. Behaviour

- `GET /api/pull-request-conflicts/:repoName/:spec`: 404 (was 200/503/500).
- `npm ci` installs `express`, `node-cache`, `node-diff3` and their
  dependencies only.
- Everything else, including the SYNC load, the multi-selects and the tree,
  behaves as before.

## 5. Code structure

| File | Change |
|---|---|
| `package.json`, `package-lock.json` (CRLF) | `fetch`, `node-fetch`, `dotenv` removed (`npm uninstall`), version 2.6.0 |
| `index.mjs` (CRLF) | the two imports and `dotenv.config()`, the conflicts route, the `getCachedSprints` import, the local `jiraAuth` |
| `cache.mjs` (CRLF) | `CACHE_KEYS.SPRINTS`, `getCachedSprints`, `clearCache`, `clearAllCache` |
| `public/multi-select.js` (CRLF) | `getOptions`, `setDisabled`, the `disabled` guard of `toggle` |
| `public/styles.css` | the `.multi-select.disabled .multi-select-trigger` rule |
| `public/app-render.js` | `resolvedIssuesAlert`, `getBranchUrl(branchName, pullRequest)` |
| `config.js.default` | `repoName`, `issuesRegex` |
| `start.bat` | deleted |
| `test/server.test.mjs` | the conflicts route answers 404, the sync-statuses route answers |
| `README.md`, `CLAUDE.md`, `PRD.md` | Node requirement, changelog, stack, endpoints, cache TTLs, project structure, F8.5 |

## 6. Verification

`npm test` (77 tests). `npm ls --depth=0` lists three dependencies. On the
fixture server (`PORT=3101 node index.mjs --fixtures`): the conflicts route
answers 404, `/api/sync-statuses/OSLC` answers 200, the page loads and the
multi-selects open. One real request through the built-in `fetch`: a second
instance started with the real `config.js` on a spare port answers
`/api/pull-requests/OSLC` (the smaller project, the same calls the dashboard
makes at every refresh), then is stopped; `error.log` shows no new line.

## 7. Delivery

Branch `claude/remove-unused` from `claude/serve-readme-route`, pull request
stacked on #40's, closes #41.
