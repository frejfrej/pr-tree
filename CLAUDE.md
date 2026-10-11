# CLAUDE.md - AI Assistant Guide

What the code cannot tell: where things are, how to work on them, the conventions, and the mistakes already made once. What each module does is in its header comment; read it before changing the module.

## Project

**Bitbucket Pull-Requests Tree** is a localhost dashboard of the open Bitbucket pull requests of a project, as a tree of stacked pull requests per repository, with their Jira issues, sprints, fix versions, epics and stories, reviewers, commit counts and conflicts (SYNC), the Jira issues in review without a pull request, and filters over all of it. Single user, developer workstation, not meant for production.

- **Backend**: Node.js 20.11 or later (22.5 for `npm run test:coverage`), ES modules (`.mjs`), Express 5, node-cache, the built-in `fetch`; `config.js` and `projects.js` are CommonJS
- **Frontend**: vanilla ES modules in `public/`, no framework, no build step; Font Awesome and Marked.js (the help modal renders README.md) vendored in `public/vendor/`, so the page loads nothing from another origin (server.test.mjs checks it)
- **Tests**: `node:test`, no test dependency, no DOM (fake elements where a DOM write is tested)
- **APIs**: Bitbucket 2.0, Jira REST 3 (`/search/jql`), Jira Agile 1.0 (boards, sprints)

## Where things are

```
index.mjs              Express server: routes, logs, wiring of the modules below, fixture-mode guard
atlassian-fetch.mjs    Wrapper of every Atlassian request: the 10-minute pause after a 429, failure messages
project-data.mjs       Bitbucket and Jira fetchers, the /api/pull-requests/:project response
project-assembly.mjs   Pure post-processing of a project's data, shared with the fixture generator
sync-statuses.mjs      SYNC computation of a project (diffstats, patches, limiter, sync-cache.json)
conflicts.mjs          Pure conflict rule from the patches of both sides; conflictRuleVersion
sync-cache.mjs         Conflict results on disk (sync-cache.json), keyed by rule version
cache.mjs              node-cache wrapper: TTLs, builds in flight shared per key, TTLs raised during a pause
limiter.mjs            Concurrency limit of the Bitbucket request bursts (SYNC computations, commit counts)
config.js.default      Template of config.js (git-ignored, credentials); its comments say which token goes where
projects.js            Projects: repositories, Jira projects, regex of the issue keys in pull-request titles
fixtures/generate.mjs  Deterministic data modelled on the real projects (volumes, the 24-deep SECOLLAB stack)
fixtures/index.mjs     Fixture-mode options, config replacement, data source
public/index.html      App shell: banner, filter sidebar, tree pane, help modal; inline theme script
public/styles.css      Styles and colour tokens, light and dark themes
public/app.js          State, data loading, URL and history, periodic refresh, wiring of the other modules
public/app-render.js   The tree and the orphaned issues as HTML strings (pure), popovers
public/app-filter.js   Filter index, pure evaluation, the single-pass filter walk and counters
public/app-sync.js     SYNC statuses: on-demand load, badges, SYNC controls
public/app-url.js      Project and filters as URL parameters (pure)
public/atlassian-pause.js      The Atlassian pause on the page: 503 of a project load, pause end, banner indicator
public/app-shell.js    Banner, sidebar, theme, help, keyboard shortcuts, tab title
public/filter-registry.js      The five multi-select filters (key, element, URL parameter), defaultFilters()
public/pull-request-status.js  Status band, reviewers and SYNC key of a pull request, for render and index alike
public/tree-toggle.js  Collapse/expand, the tree pane's one click handler, toggle states across re-renders
public/multi-select.js Multi-select dropdown component (builds its own markup)
public/counter-utils.js        filtered/total counter display
public/vendor/         Font Awesome (CSS, woff2 fonts) and Marked (ES module, imported when the help opens), as published on npm, with their licenses
test/                  One *.test.mjs per module; server.test.mjs runs the fixture server
docs/superpowers/      Design record: one spec (specs/) and one plan (plans/) per change, dated
README.md              User documentation and the changelog (served to the help modal)
PRD.md                 Product requirements (F1-F9 features, F4.x filters, NFRs); kept up to date
```

**docs/superpowers is the design record.** Each change is designed in a spec (`specs/YYYY-MM-DD-<topic>-design.md`) and implemented from a plan (`plans/YYYY-MM-DD-<topic>.md`); the decisions and the alternatives turned down are there, not in this file. Read the spec of an area before redesigning it; write one for a new change.

## Workflows

### Setup
`npm ci` (never `npm install`), copy `config.js.default` to `config.js` and fill it in (Bitbucket: the account e-mail and a scoped API token; Jira: the e-mail and an unscoped API token; app passwords are gone), edit `projects.js`, `npm start`, open http://localhost:3000.

### Without Atlassian access
`npm run start:fixtures` (or `node index.mjs --fixtures`) serves both projects from generated data, no config.js needed; `--fixture-scale=3` multiplies the volumes, `--fixture-chain-depth=8` shortens the deepest stack (default 24). SECOLLAB in fixture mode has the volumes and tree shape of the real project: use it for UI work and performance checks.

### Tests
- `npm test`: every `test/*.test.mjs`. The server modules take `fetch`, the clock and the logs as parameters, so they are tested against fakes answering by URL (`project-data`, `sync-statuses`, `atlassian-fetch`); the frontend modules are pure or tested on fake elements; `server.test.mjs` starts the fixture server on `PORT=0` and checks what it serves.
- `npm run test:coverage`: the same with coverage. The include patterns are listed in package.json (a `--require` preload in `NODE_OPTIONS` would show up otherwise), so a new source directory needs a pattern there. A file no test loads (`public/app.js`) is absent from the table, not at 0%. `index.mjs` is covered through the spawned fixture server, which exits normally on SIGTERM so V8 writes its coverage.
- Performance: fixture server, SECOLLAB, time a filter change in the browser console (`performance.now()` around a multi-select checkbox `.click()`); a pass stays around a millisecond.
- UI: manual, in the browser, in both themes; test every filter after a change to the filters.

### Release
Bump `version` and `releaseDate` in package.json (the UI shows them through `/api/version`) and add a changelog entry at the top of README.md's "Changelog" section. PRD.md gets a requirement line for a new feature.

## Common tasks

**Add a project or a repository**: `projects.js` only, then restart.

**Add a multi-select filter**:
1. The data in the `/api/pull-requests/:project` response: project-data.mjs, project-assembly.mjs, and the fixture generator
2. One row `{ key, elementId, urlParam }` in `multiSelectFilters` (filter-registry.js): the state, the URL parameter, the control wiring, the restore from the URL and the active-filter count follow
3. An empty `<div class="multi-select" id="<elementId>">` in index.html with its visible label in an element with the id `<elementId>Label`
4. In `buildFilterIndex` (app-filter.js): the option list under `key` (`{ value, label }[]`, display order) and the set of values under `key` on each pull-request entry and each orphaned-issue entry; `matchesIssueFilters` does the rest
5. Tests in app-filter, app-url and filter-registry (which checks the element ids exist in index.html)

**Add a Jira field**: the `fields` of the request in `fetchJiraIssuesDetails` (project-data.mjs, and `fetchInReviewIssuesWithoutPR` if orphaned issues need it), the fixture generator, the rendering in app-render.js through `escapeHtml`; it reaches the hash through `calculateHash` (project-assembly.mjs) since the details are hashed whole.

**Add or change an endpoint**: route in index.mjs, cache in cache.mjs if it calls Atlassian, `try`/`catch` with `log(message, errorLogStream)` and a 500, a `performanceLogStream` line for anything slow, every Atlassian request through `atlassianFetch`; a test in server.test.mjs; PRD.md section 7.5.

**Update a vendored library**: `npm pack <package>@<version>` (npm checks the tarball against the registry's hash), copy the same files over the ones in `public/vendor/` (the version is in each file's header; Font Awesome: `css/all.min.css` and the three `webfonts/*.woff2`, the only format a current browser fetches), check the help modal and the icons in the browser, then a changelog entry.

**Debug performance**: performance.log, `/api/cache/stats`, the Network tab for repeated calls, whether `dataHash` stays stable (the page re-renders only when it changes; a pull request's commit counts are fetched again only when one of its commits moves).

## Conventions

- `import`/`export` in `.mjs` and `public/`; `async`/`await`; `const` unless reassigned; arrow functions for callbacks; template literals
- camelCase for functions, variables and constants (no UPPER_CASE); kebab-case for CSS classes and API routes
- A module opens with a header comment saying what it is for and what it does not do (index.mjs, cache.mjs and app.js predate the habit and comment per function); few inline comments otherwise; JSDoc on exported functions where the signature is not obvious
- Server modules never read config.js or call `fetch` themselves: `create*({ fetch, ..., log })` factories, wired once in index.mjs, so they are testable against fakes
- Frontend modules touch no DOM at import time, so their pure parts are imported by node tests
- API errors: JSON for API answers, 500 with a log line on failure, 503 with `rateLimitedUntil` during a rate-limit pause; the client checks `response.ok`
- Commit messages `type: description` (`fix:`, `feat:`, `refactor:`, `docs:`, `test:`); branches `claude/<topic>`; stacked pull requests are common (see the user's global notes on retargeting before merging)

## Pitfalls (each one happened)

1. **Security**: only `public/` and `README.md` (its own route) are served; never mount a static middleware on the project directory, it served config.js, the logs and the sources before 2.5.2 (server.test.mjs checks it). `sync-cache.json` and the logs are git-ignored.
2. **Untrusted text**: anyone with Jira write access can put `<script>` in a summary. app-render.js escapes every Bitbucket and Jira text it interpolates (`escapeHtml`), the issue popover uses `textContent`, the main-pane messages are DOM nodes; keep it that way, never put such a text through `innerHTML`. The only HTML shown as HTML is Bitbucket's rendered pull-request title and description in the popover.
3. **Rate limits**: every Atlassian request goes through `atlassianFetch` (index.mjs). After any 429 from Bitbucket or Jira nothing is sent for 10 minutes after the last 429, every cache TTL is raised to cover the pause, responses built meanwhile carry `rateLimited: true`, and an uncached endpoint answers 503. A fetcher that tolerates failures must still rethrow a `RateLimitError` (`rethrowRateLimit` in project-data.mjs), or a response missing its parents, sprints or counts is cached for the whole pause. A tolerated non-429 Jira failure records its part in the build's `gaps` (the response's `incomplete`): cache.mjs then keeps the response 30 seconds, and the page shows "Partial data" and keeps the URL values of the filters a gap feeds (`filtersKeptOverGaps`; 3.0.0, #91).
4. **Jira search paging**: `/rest/api/3/search/jql` has no `total` and ignores `startAt`; page with `nextPageToken` until `isLast` (`searchIssuePages`). Reading `total` truncated sprints to 100 issues and the orphaned issues to 50 before 2.7.2.
5. **Deep stacks**: SECOLLAB has a 24-deep stack of pull requests. Anything recursive over the tree visits each pull request once; never re-select descendants (`querySelectorAll('.pull-request')`) inside a recursion: a pull request at depth d was visited 2^d times, 16 million visits per filter change.
6. **The filter pass reads nothing from the DOM**: the status band, the reviewers and the SYNC key come from pull-request-status.js through the index; attention is `computeAttention` on the index entry, never a rendered style. The render and the index call the same functions so the band painted and the band filtered on cannot diverge.
7. **Conflicts**: never merge file contents on the event loop (a 30,000-line lock file blocked every request for five minutes, 2.7.0); conflicts come from the patches of both sides. Results live in `sync-cache.json` for good, so a change to `parseUnifiedDiff`, `conflictingFiles`, `decideFromDiffstat` (conflicts.mjs) or to `computeConflicts`, `checkPatch`, the diffstat mapping or `maxFilesToCheck` (sync-statuses.mjs) that can change a decision must bump `conflictRuleVersion`; the old entries are then never read and are dropped at the next write. Check a rule change against `git merge-file` or `git merge-tree` on generated cases. Known approximations are listed in the header of conflicts.mjs.
8. **SYNC is on demand only**: `/api/sync-statuses/:project` is called by the load button, never automatically; the response is not cached outside a rate-limit pause (#49); only complete and over-limit results are stored in sync-cache.json (a failure, or a result partial after a failure, is retried at the next load). On a page load the SYNC filter is not restored from the URL (no statuses yet); every other filter is.
9. **Late responses**: `selectProject` and `checkForUpdates` capture the project before their fetch and drop a response for a project no longer selected; `loadSyncStatuses` compares the generation `resetSyncStatuses` bumps. Any new fetch that paints something must do the same (Back/Forward make quick switches easy).
10. **History**: the page follows the URL, never the other way round. A filter change pushes one entry, typing in the search box replaces it, a manual project switch pushes once, a load or Back/Forward replaces the URL after the render with the filters kept; nothing in the Back/Forward path pushes. `restoreFiltersFromUrl` is the only path from the URL to the state and the controls.
11. **Grouping**: the tree groups pull requests per repository, then by destination branch (`pullRequestsByDestination` in app-render.js); the API sends each pull request once. Two repositories sharing a branch name (`master`) used to show each other's pull requests.
12. **Jira hierarchy**: only `issueLevel`, `epicOf` and `storyOf` (app-filter.js) read `issuetype` and `parent`; a sub-task reaches its epic through its parent story. Parent-only issues have no status; a parent that is itself an orphaned issue is looked up among the orphaned issues, not in `jiraIssuesDetails`.
13. **Orphaned issues section**: a `.repository.orphaned-issues` block so the toggles apply, skipped by the repository loop of the filter walk; its rows are `.orphaned-issue`, never `.pull-request`.
14. **Module boundaries**: app-render.js knows no filter state; app-sync.js never imports app.js (it gets accessors), so there is no circular import; nothing is put on `window`, the tree has no inline handler (one listener on the pane, `handleTreeClick`).
15. **Colours**: never hard-code a colour in styles.css; add a token to both the `:root` and `:root[data-theme="dark"]` blocks. Text in `--on-accent-text` needs 4.5:1 with its fill in both themes, and status text or a status icon needs 4.5:1 with the surface: use the strong tokens (`--success-strong`, `--error-strong`, `--attention-strong`, `--warning-strong`, `--neutral-strong`) for both. A border needs 3:1 with the colours on both sides: the plain warning and success colours miss it in the light theme, so the status bands use `--warning-border` and `--success-border` and the warnings box `--error-strong`; two bands should differ in lightness, not only in hue. test/styles.test.mjs checks the token ratios against the white surface, the `background-color` of the rules whose `color` is `--on-accent-text`, the `color` declarations, the `.status-*` borders and the warnings box; a strong token on another background, a `background` shorthand or an inherited text colour is for the review to check. The focus ring is the primary colour: a surface painted in it overrides `outline-color`.
16. **Accessibility**: every filter control is named by its visible label (`<label for>`, or `aria-labelledby` the `<id>Label` element for a multi-select); server.test.mjs checks it.
17. **Line endings**: `.gitignore`, `cache.mjs`, `index.mjs`, `package-lock.json` and `public/multi-select.js` are CRLF; edit them with tools that keep the line endings, and restore CRLF after npm rewrites the lock file.
