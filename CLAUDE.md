# CLAUDE.md - AI Assistant Guide

## Project Overview

**Bitbucket Pull-Requests Tree** is a web-based dashboard for visualizing and managing Bitbucket pull requests with integrated Jira issue tracking. It provides a comprehensive view of PR status, related issues, conflicts, and team workflow.

### Key Features
- Multi-project support with dropdown selection
- Pull request visualization ordered by most recently updated
- Jira issue integration with status tracking
- Advanced filtering (text, sprint, fix version, epic, story, participants, work, sync status)
- Real-time conflict detection
- Commit ahead/behind tracking
- Smart reload (auto-updates every 2 minutes when data changes)
- Server-side caching to reduce API load
- Orphaned issue detection (Jira issues in review without PRs)

### Version
Current version: **2.10.1** (as of 2026-09-14)

## Technology Stack

### Backend
- **Runtime**: Node.js with ES Modules (.mjs)
- **Framework**: Express.js (v5.2.1)
- **HTTP Client**: the `fetch` built into Node.js (20.11 or later)
- **Caching**: node-cache (v5.1.2)
- **Authentication**: Basic Auth (Base64 encoded) for Bitbucket and Jira APIs

### Frontend
- **HTML5** with semantic structure
- **Vanilla JavaScript** (ES6 modules)
- **CSS3** with custom properties for theming
- **External Libraries**:
  - Font Awesome 5.15.3 (icons)
  - Marked.js (markdown rendering for help)
- **No framework** - pure JavaScript for performance

## Project Structure

```
pr-tree/
├── index.mjs              # Main Express server & API endpoints
├── cache.mjs              # Server-side caching logic (NodeCache wrapper)
├── conflicts.mjs          # Conflicts decided from the patches of both sides (pure)
├── sync-statuses.mjs      # The SYNC computation of a project (fetch, cache and logs injected: createSyncStatuses)
├── project-data.mjs       # The Bitbucket and Jira fetchers and the /api/pull-requests response (fetch and logs injected: createProjectData)
├── atlassian-fetch.mjs    # The wrapper of every Atlassian request: the pause after a 429, failure messages (fetch and clock injected)
├── sync-cache.mjs         # Conflict results kept in sync-cache.json across restarts
├── config.js              # Configuration file (git-ignored, user-specific)
├── config.js.default      # Configuration template
├── projects.js            # Project definitions & Jira regex patterns
├── package.json           # Dependencies & version metadata
├── .gitignore             # Excludes config.js, node_modules, logs
├── fixtures/              # Fixture mode: generated data served instead of Atlassian (npm run start:fixtures)
│   ├── generate.mjs       # Deterministic generator modelled on the real projects
│   └── index.mjs          # Command-line/env options, config replacement, data source
├── test/                  # node:test unit tests (npm test)
├── README.md              # User-facing documentation
└── public/                # Frontend assets
    ├── index.html         # App shell: banner, filter sidebar, tree pane, help modal
    ├── styles.css         # Application styles (colour tokens, light and dark themes)
    ├── app.js             # Data loading, filter state, URL and history, wiring of the other modules
    ├── app-render.js      # The tree and the orphaned issues as HTML strings (pure), popovers
    ├── app-sync.js        # SYNC statuses: on-demand load, badges, SYNC controls and their state
    ├── app-filter.js      # Filter index, pure evaluation, single-pass tree filtering and counters
    ├── app-url.js         # The project and the filters as URL parameters, pure (projectFromUrl, filtersFromUrl, urlWithFilters)
    ├── app-shell.js       # Banner (theme, help, version badge), sidebar, keyboard shortcuts, tab title
    ├── tree-toggle.js     # Collapse/expand helpers and toggle-state capture/restore
    ├── multi-select.js    # Multi-select dropdown component
    └── counter-utils.js   # Display of a filtered/total counter
```

### Key Files Explained

#### Backend Files

**index.mjs** (246 lines)
- Main Express application server
- API endpoint definitions (`/api/version`, `/api/projects`, `/api/pull-requests/:project`, `/api/sync-statuses/:project`, `/api/cache/stats`)
- The SYNC computation is in `sync-statuses.mjs`: `createSyncStatuses` is called once at startup with `atlassianFetch` as its `fetch`, the workspace and credentials, the error and performance logs and the opened `sync-cache.json`; `/api/sync-statuses/:project` keeps the fixture branch, passes the pull requests of the project data to `computeSyncStatuses`, and adds the rate-limit fields of the response and its TTL
- `atlassianFetch` here is the fixture-mode guard in front of `atlassian.fetch`, the wrapper `createAtlassianFetch` (atlassian-fetch.mjs) built once at startup with the global `fetch` and an `onRateLimit` callback that raises the cache TTLs (`raiseAllCacheTtls`) and writes the "HTTP 429 received" line to error.log; the routes read the pause from `atlassian.rateLimitedUntil()` (the 503 of the pull-requests route, the rate-limit answer of the sync route) and `atlassian.pause()` (the `rateLimited`/`rateLimitedUntil` fields and the TTL of a sync-statuses response)
- The project data is in `project-data.mjs`: `createProjectData` is called once at startup with `atlassianFetch` as its `fetch`, the workspace, the Jira site, both credentials and the three logs; `buildProjectData(projectName)` here keeps the project lookup ("Project not found") and the fixture branch, then delegates to the module with the project's configuration
- Comprehensive logging system (access.log, error.log, performance.log)
- Static file serving for the public directory; `README.md` is served through a dedicated route (the help modal fetches it) and nothing else of the project directory is reachable over HTTP
- A SIGTERM ends the process normally (`process.exit(0)`): the server test stops the fixture server that way, and a process killed by the signal would write no coverage for `npm run test:coverage`

**cache.mjs** (108 lines)
- Abstraction layer over node-cache
- Provides typed caching functions for different data types
- TTL configuration:
  - Project data: 120 seconds (default)
  - Projects list: 300 seconds (5 minutes)
- The per-pull-request conflict results are not in node-cache: they live in `sync-cache.json` (`sync-cache.mjs`), for good (pruned 90 days after they were computed)
- `getCachedSyncStatuses` shares a computation in progress per project (two loads of one project at once compute once; a failure is not cached)
- The sprints are fetched with the project data and cached with it (no separate cache)
- Cache statistics endpoint support

**conflicts.mjs**
- Pure: `parseUnifiedDiff(text)` turns a git unified diff into files keyed by base path (the `a/` path of the `diff --git` header, or the `rename from` path for a renamed file; C-quoted paths are decoded, and a `diff --git` header is split correctly even when a path contains ` b/`) with change regions `{ start, end, lines }` in merge-base line coordinates, `newHash` (the post-image blob of the `index` line) and `linesAdded`/`linesRemoved`; content lines keep their CR and a missing final newline marks the line; it throws on a malformed or truncated patch (a hunk longer or shorter than its header, hunks out of order or overlapping, a foreign line, a file header without a hunk, a file listed twice) rather than let it pass for a clean merge
- `conflictingFiles(sideA, sideB)` applies git's rule, in order: deleted on both sides is clean, deleted on one side conflicts, added on both sides with different modes conflicts (git's add/add, or distinct types for a symlink), the same post-image blob on both sides is clean, a binary whose content changed on both sides conflicts (an added file always counts as changed, even an empty one, so it conflicts against a changed binary), otherwise overlapping or touching regions conflict unless they are the same change (a linear sweep; an added file is an insertion into an empty base)
- `decideFromDiffstat(sourceFiles, destFiles)` decides from the diffstat statuses: removed on both sides is nothing, removed on one side is a conflict, renamed to different paths on both sides is a conflict, two different files ending at one path (rename/add, two renames onto one path) are a conflict, and so is a path that is a file on one side and a directory on the other (file/directory: only an added or renamed file counts, so a file renamed away before its old path became a directory merges cleanly); the other files touched on both sides need the patches
- `conflictRuleVersion` (exported): bumped whenever a change to `parseUnifiedDiff`, `conflictingFiles` or `decideFromDiffstat` here, or to `computeConflicts`, `checkPatch` or the diffstat mapping in sync-statuses.mjs, can change a decision; the server prefixes its cache keys with it, so results computed under an older rule are never reused
- Known approximations: git merges with the histogram diff, so patches made with another diff algorithm can place hunks differently on repetitive files; a directory renamed on one side while the other adds a file in the old directory is not detected; `.gitattributes` merge drivers are ignored (a `merge=binary` driver makes git conflict even on changes that do not touch); a change of file type is reported not checked
- Unit-tested with synthetic patches (`test/conflicts.test.mjs`); when the rule changes, check it against `git merge-file` or `git merge-tree` on generated cases (the fuzzers used while 2.7.0 was written are not in the repository) and bump `conflictRuleVersion`

**project-data.mjs**
- `createProjectData({ fetch, workspace, bbAuth, jiraSiteName, jiraAuth, log: { access, error, performance } })`: the Bitbucket and Jira fetchers of a server and the response of `/api/pull-requests/:project`; nothing here reads config.js or talks to Atlassian by itself; returns `buildProjectData(projectName, projectConfig)` and the fetchers (`fetchPullRequests`, `fetchJiraIssuesDetails`, `fetchJiraSprints`, `fetchSprintIssues`, `fetchInReviewIssuesWithoutPR`, `fetchCommitsDiff`), exposed for the tests
- `buildProjectData` fetches the open pull requests of each repository 50 per page (following `next`), maps them by destination branch (`fillPullRequestsMap`: keyed by branch name across repositories, a known limitation) and to their issue keys (`createJiraIssuesMap`, `extractJiraIssues` with the project regex), then the orphaned issues, the Jira issue details (which fetches and inherits the parents of both), the sprints and the sprint issues, hashes them (`calculateHash`: MD5 of the pull requests, the issue map and details, the sprints, the sprint issues and the orphaned issues) and fetches the commit counts ahead and behind (`fetchCommitsDiff`, two requests per pull request, `null` on a failure) only when the hash differs from the last response built; otherwise the last response is served again with a new `lastRefreshTime` (one last response per server, whatever the project)
- `fetchJiraIssuesDetails(jiraIssues, jiraProjects, moreIssues = [])` fetches, in batches of 50, the linked issues (summary, status, priority, fix versions, assignee, parent, issue type), then `completeParents([...details, ...moreIssues])`: one `key IN` request for the parents named but not present (summary, issue type, fix versions, parent; a non-ok response is logged), then the inheritance pass (an issue without fix versions takes its parent's, in array order: details, `moreIssues`, parents); the parents fetched are appended to the result, `moreIssues` (the orphaned issues, passed by `buildProjectData`, which runs the orphaned search first) are completed in place and not returned; a parent that is itself an orphaned issue is not fetched again nor added to the details (the frontend looks parents up among the orphaned issues too); sub-tasks inherit the fix versions of their parent, and the frontend resolves epics and stories from `parent`
- `fetchJiraSprints` asks the scrum boards of each Jira project then the active sprints of each board (`{ id, name }`, a sprint shared by two boards once; a failure skips the project's sprints); `fetchSprintIssues` reads the keys of each sprint 100 at a time (a failed page ends that sprint's list, the pages read are kept); `fetchInReviewIssuesWithoutPR` lists the issues in review of the Jira projects, 100 at a time, with the fields of the linked issues plus `updated`, and keeps those no pull request links (a failure fails the build, like a failed pull-request page); both go through `searchIssuePages(jql, fields)`, an async generator paged with the `nextPageToken` of the search endpoint until `isLast` (the endpoint returns no `total` and ignores `startAt`; reading a `total` is what truncated sprints to 100 issues, and the orphaned issues to the default page of 50, before 2.7.2)
- The pure helpers `extractJiraIssues`, `createJiraIssuesMap`, `fillPullRequestsMap` and `calculateHash` are exported; tested against a fake Atlassian in `test/project-data.test.mjs` (the URLs, JQL and fields of every request, the response shape, the batches and parents, the inherited fix versions, the orphaned issues, the sprints, the hash and the commit counts, the failures)

**sync-statuses.mjs**
- `createSyncStatuses({ fetch, workspace, bbAuth, log: { error, performance }, syncCache, timeoutMs = 30000, maxConcurrent = 4, now })`: the SYNC computation of a server, one limiter and one cache; nothing here talks to Bitbucket by itself (the server passes `atlassianFetch`, the tests a fake answering by URL); returns `computeConflicts(repoName, spec)` and `computeSyncStatuses(projectName, pullRequests)`
- `computeConflicts` fetches the diffstats of both sides (with their line counts, following `next`), decides what their statuses can (`decideFromDiffstat`), fetches one patch per side restricted to the files left to check (`diff/{side}..{other}?topic=true&path=...`, 20 files per request (`filesPerPatchRequest`), the paths of one file in the same request so a rename is seen whole, both sides in parallel), requires every checked file to be in both patches with the diffstat's line counts (`checkPatch`), then asks `conflictingFiles`; more than 100 files to check (`maxFilesToCheck`) skips the patches
- A failed request or a `checkPatch` mismatch is caught: when the diffstats already proved a conflict, the limit or a later failure gives a partial SYNC (`{ conflicts: true, files, reason }`: the known files, and the reason the rest was not checked) instead of a full failure
- `computeSyncStatuses` is the per-pull-request block of the route: each result is looked up in `sync-cache.json` under `<conflictRuleVersion>:<repo>/<dest>..<source>` before any request, computed otherwise through the limiter, and stored only when complete (never a failure or a partial result); a pull request without a commit hash on a side gets no entry; the cache is saved once at the end (a failed write is logged); the reasons sent to the client are short (`failureReason`: `shortMessage` without the URL, or the fixed sentence of a rate-limit pause, which is not logged as an error); the summary log line counts the pull requests computed, not checked and partly checked
- Tested against a fake Bitbucket in `test/sync-statuses.test.mjs` (real `Response` objects, the real `openSyncCache` on a temporary file): what is fetched, what the client is shown, what reaches the disk

**atlassian-fetch.mjs**
- `createAtlassianFetch({ fetch, now, backoffSeconds = 600, onRateLimit })` returns `fetch(url, options)`, the wrapper every Atlassian request goes through: while a pause is on it throws `RateLimitError` without calling `fetch`; a 429 from either API drains the body (the socket is released), sets the end of the pause to `backoffSeconds` after now, calls `onRateLimit(url, until)` and throws `RateLimitError`; a network failure is rethrown with its cause (`error.cause.message` or `.code`) and the URL in `message`, the same without the URL in `shortMessage`, the original as `cause`; any other response is returned as it is (the callers read `ok`)
- `rateLimitedUntil()` (the end of the last pause in epoch ms, 0 before any 429, kept once past) and `pause()` (`{ rateLimited, rateLimitedUntil: ISO or null, remainingMs }`, what the responses say during a pause) are read by the routes
- `RateLimitError` (thrown while Atlassian requests are paused after an HTTP 429) and `failureReason(error)` (what the user is told when a request failed: the fixed sentence for a `RateLimitError`, `shortMessage` or `message` otherwise)
- Tested in `test/atlassian-fetch.test.mjs` with a fake `fetch` and a clock variable: the pause from either API and its extension by a later 429, the drained 429 body, the failure messages, `failureReason`, the fields and TTL of the responses during a pause

**sync-cache.mjs**
- `openSyncCache(filePath, { maxAgeDays, now, onError })`: `size`, `get(key)`, `set(key, result)`, `save()`; the file is `{ version: 1, entries: { "2:repo-name/destHash..sourceHash": { conflicts, files, computedAt } } }` (the module treats keys as opaque strings; the `2:` prefix is the conflict rule version the server puts in front of `repo/dest..source`), read once at open (a missing file is an empty cache, an unreadable one or another version is reported through `onError` and ignored, entries that are not objects are dropped), written through a temporary file then a rename, pruned of entries older than 90 days at save
- `save()` serializes at call time and queues its write after the writes in flight; it resolves to whether it wrote and only ever rejects (a failed write leaves the entries pending for the next save)
- Only successful results are stored (the route stores nothing for `{ error: true }` or a partial result with a `reason`), so failures are retried at the next load; fixture mode reads the file but never writes it

**projects.js**
- Module.exports object containing project configurations
- Each project has:
  - `repositories`: Array of Bitbucket repository slugs
  - `jiraProjects`: Array of Jira project keys
  - `jiraRegex`: Regex pattern to extract Jira issue keys from PR titles
- Example structure:
  ```javascript
  'PROJECT_NAME': {
      repositories: ['repo1', 'repo2'],
      jiraProjects: ['PROJ1', 'PROJ2'],
      jiraRegex: /(PROJ1-\d+|PROJ2-\d+)/g
  }
  ```

**config.js** (NOT committed)
- Contains sensitive credentials
- Structure (from config.js.default):
  ```javascript
  {
    bitbucket: { username, password, workspace },
    jira: { siteName, username, apiKey },
    projects: require('./projects')
  }
  ```

#### Frontend Files

**public/app.js**
- Main application state management (filters, project, last API result) and the wiring of the other modules (`DOMContentLoaded`)
- Project selection and data loading; `renderEverything(apiResult)` builds the tree with app-render.js, renders the orphaned issues section (`renderOrphanedIssues(orphanedIssues, jiraSiteName)`), feeds `populateFixVersionFilter` with the details plus the orphaned issues, repaints the SYNC badges (app-sync.js), populates the filter controls, restores the filters from the URL and applies them
- URL state persistence (filters saved to query params)
- Periodic refresh logic (2-minute intervals, tab visibility detection)
- Loading state management
- Event handlers for user interactions; `handleSyncLoadEnd()` runs after every SYNC load: the SYNC filter is only meaningful while statuses are loaded, then the filters run again
- `populateIssueFilter(elementId, issues)`: fills an issue multi-select (epics and stories) from the index; the selection is restored from the URL afterwards like every other filter
- `restoreFiltersFromUrl({ preferTypedText })`: the only path from the URL to the state and the controls (each multi-select keeps the values its options offer, SYNC follows the URL only while its statuses are loaded); run after every render once every option list is populated, and on Back/Forward; a switch from the URL (page load, Back/Forward) renders with `preferTypedText: false`: the URL wins over a focused search box unless the box holds the URL's query with extra whitespace (a query typed during a page load keeps its trailing space)
- `selectProject(projectName, { fromUrl })`: project switch; the refresh time is cleared; from the dropdown the filters are reset and the URL pushed once, from the URL (page load, Back/Forward) the URL is left alone and the render restores its filters (`preferTypedText` is `!fromUrl`); after the render the URL is replaced with the validated filters; a late response for a project no longer selected is dropped; without a project ("Select a project", or Back to a URL without one) the filters and the option lists of the multi-selects are cleared (`clearFilterOptions`) whatever the URL says, so the page is back to its initial state
- `handlePopState()`: Back/Forward; switches the project through `selectProject(name, { fromUrl: true })` or restores and applies the filters of the URL, then replaces the URL with the filters kept (a value the options no longer offer since a refresh is dropped from the entry)
- `checkForUpdates()`: the periodic refresh; re-renders when the data hash changed; captures the project before its fetch (`fetchData(project)`) and drops a response arriving after a project switch, like `selectProject`; the `checking` class of the refresh icon marks a running check, and a check started meanwhile is skipped before the `try`, so its `finally` does not stop the icon of the running one
- `availableProjects`: the project names from `/api/projects`, the list the dropdown is built from and `projectFromUrl` validates against
- `updateWorkSelect()`: the Work select is disabled and back to "All work" while no participant is selected; `populateParticipantFilter(participants)` fills the participant multi-select from `filterIndex.participants`

**public/app-render.js**
- `renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName)` (pure): the tree as an HTML string; one `.repository` block per repository, its root branches, the pull requests nested in `.children` containers, most recently updated first; appends the hidden `.tree-no-match` message when there is at least one repository
- `renderOrphanedIssues(issues, jiraSiteName, { now })` (pure): the "Jira issues in review without a pull request" section as a `.repository.orphaned-issues` block (header with the toggle, the title and a `.repo-pr-counter`, so tree-toggle.js applies to it and `captureToggleStates` keys it by its title) with one `.orphaned-issue.status-in-review` row per issue carrying `data-issue-key`: priority icon, key link (`.jira-issue-link` with the popover attributes), summary, assignee avatar (Jira `avatarUrls`, the icon alone without one) or "Unassigned", last update, and a `.warnings` line "No update for N days" when `updated` is 14 days or more before `now` (injected for the tests, `Date.now()` otherwise; Jira's `+0000` offset is normalised before parsing); an empty string without issues; the rows are never `.pull-request`, so the tree pass and the toggles of pull requests do not see them
- `findRootBranches`, `calculateTotalPullRequests`, `calculateDescendants`, `renderParticipant` (pure, exported for the tests; `renderParticipant` is only called by `renderPullRequest`, with one of four statuses); `renderPullRequests`, `renderPullRequest`, `getBranchUrl` are private
- `initializePopovers()`: the pull-request and issue popovers; they read the data attributes `renderPullRequest` writes (`data-rendered-title`, `data-rendered-description`, `data-issue-key`, `data-issue-summary`), so the writer and the reader live together
- Knows nothing about the filter state; the inline `onclick` handlers of the tree call the toggle functions app.js installs on `window`; no DOM access at import time, so the rendering is unit-tested

**public/app-sync.js**
- Owns the SYNC state: `currentSyncStatuses` (the last `/api/sync-statuses` response, null until loaded and again after a project switch), `syncStatusLoading`, `syncLoadFailed`; never imports app.js
- `initializeSyncControls({ getProject, getSyncFilter, onFilterChange, onLoadEnd })`: wires the SYNC select and the load button; the accessors read the selected project and SYNC filter from app.js at call time, `onLoadEnd` runs after every load, successful or not
- `loadSyncStatuses()`: the load button handler, one `/api/sync-statuses/:project` call with spinners on the badges meanwhile; never called automatically; a project switch during the load (`resetSyncStatuses` bumps `syncLoadGeneration`) drops its response and its failure, and the new project can load right away; a failed refresh keeps the previously loaded statuses
- `applySyncStatuses()`: paints the stored statuses onto the `.conflicts-counter` elements as DOM badges: green `OK` (`.conflicts-ok`), red `SYNC` (`.conflicts-count`, tooltip from `conflictsTitle`), grey `?` (`.conflicts-error`, the reason, or "unknown" when the key is absent), grey `!` for an invalid spec; nothing while statuses are not loaded; called after every render (before the filters run) and after every load
- `conflictsTitle(files, reason)` (pure, exported for `test/app-sync.test.mjs`): the SYNC tooltip, the conflicting files one per line, the first five then "and N more"; a missing or malformed list gives "Conflicts found"; with a reason, a last line `Other files not checked: <reason>`
- `updateSyncControls()`: the select (disabled until loaded, options rebuilt, selection put back from `getSyncFilter()`), the load button and the failure/rate-limit warning
- `syncStatusesLoaded()` and `resetSyncStatuses()`: what app.js needs to restore the SYNC filter from the URL and to forget the statuses, a failed load and a load in flight on a project switch

**public/app-filter.js**
- `buildFilterIndex(apiResult)` (pure): one entry per pull request with its linked issues, the `searchText` the text filter searches (title, source branch, issue keys, lower-cased) and the sets of assignees (of the linked issues), reviewers (every participant but the author), pending reviewers (those who have not approved), sprint ids and fix version ids the filters compare against, and the epic keys (`epics`) and story keys (`stories`); it also returns `index.epics` and `index.stories`, the epics and stories to list in the filters, and `index.participants`, the sorted names of the assignees and reviewers the participant filter offers (Rovo Dev excluded); built once per data load by `initializeFilter()`, which returns it; it also returns `orphanedIssuesByKey`, one entry per orphaned issue (`issue`, `searchText`: key and summary, `assignees`: the assignee, `sprints`, `fixVersions`, `epics`, `stories`), whose epics, stories and assignees join the lists; the parent lookup of `epicOf` covers the details and the orphaned issues
- `evaluatePullRequest(entry, filters, rendered)` (pure): visibility and attention of one pull request; with participants selected, the pull request is kept when one of them reviews it or has a linked issue assigned to it (`work` = `all`, the default, from the `reviewers` and `assignees` sets of the entry; `reviews` and `issues` one set only) or when it waits for one of them (`computeAttention`: `reviewer` in review and not approved by them, `assignee` in progress with a linked issue assigned to them), the other `work` values being `ready` (either attention), `reviewers` and `assignees`; the SYNC filter values are `requested` (SYNC badge), `OK` (OK badge) and `unchecked` ("Not checked": neither badge, so the `?` and `!` pull requests)
- `evaluateOrphanedIssue(entry, filters)` (pure): visibility and attention of one orphaned issue; the text, sprint, fix version, epic and story matches are shared with `evaluatePullRequest` (`matchesIssueFilters`); `attention` is "assigned to a selected participant", and with participants selected the issue is kept when it has attention under every `work` value but `reviews` and `reviewers` (`reviewWorkValues`; an unknown value behaves like `all`, as for pull requests); SYNC is ignored
- `filterBranches(filters)`: collects the SYNC and OK badges once, then walks `.repository:not(.orphaned-issues)` (direct children only, each pull request visited once; hides, highlights, sums the counters of repositories, root branches and child counters on the way back up, hides the root branches and repositories left without a visible pull request) and the orphaned issues section apart (`filterOrphanedIssues`): each `.orphaned-issue` row evaluated by its `data-issue-key`, shown or hidden, `needs-attention` toggled, the section's counter refreshed (`updateCounterDisplay` with the noun `issue`) and the section hidden while no row is visible; the `.tree-no-match` message is shown while every repository is hidden, whatever the section does; returns the attention count of the pull requests and orphaned issues left visible
- `issueLevel`, `epicOf`, `storyOf` (pure): the only code that interprets `issuetype` and `parent` (epic > standard issue > sub-task); a sub-task reaches its epic through its parent story, which the server fetches with its own `parent`
- `parseTextQuery`, `matchesText`, `issueOptions`, `computeAttention`, `countActiveFilters` (pure)

**public/app-url.js**
- `projectFromUrl(search, projects)` (pure): the project a query string names when it is one of the given ones (app.js passes `availableProjects`); `null` otherwise, an empty name included
- `filtersFromUrl(search)` (pure): the filters a query string describes, in the shape of `currentFilters()`; `participant` is repeated, `work` is `reviews`, `issues`, `ready`, `reviewers` or `assignees` (anything else reads as `all`); `assignee`, `reviewer`, `readyReviewer`, `readyAssignee` and `ready`, the people parameters before 2.8.0, are never read
- `urlWithFilters(url, { project, filters })` (pure): a copy of the URL with the project and the active filters only (`work` only with participants selected); parameters that are not filters are kept, the people parameters of before 2.8.0 are removed

**public/counter-utils.js**
- `updateCounterDisplay(element, visible, total, noun = 'pull request')`: the `n/total` text and tooltip of a counter (the noun is `issue` for the orphaned issues section, pluralised from the number it follows: "1 filtered issue out of 13 total"); the counts come from the filter pass; tested with a fake element in `test/counter-utils.test.mjs`

**fixtures/generate.mjs** and **fixtures/index.mjs**
- `generateProjectData(projectName, projectConfig, { scale, chainDepth })` returns exactly the `/api/pull-requests/:project` response shape; `generateSyncStatuses(projectData)` the `/api/sync-statuses/:project` one: OK statuses, conflicts (about one in ten of them partial, with a reason), and failures (about 4%, with a reason), each seeded by the pull request's key (repository and commits) so a pull request shared by two projects gets the same status
- Volumes and structure follow the real projects (see the constants at the top of generate.mjs), including the 24-deep stack of `products.secollab` under `feat/ai_investigations` that made the old filtering explode
- Epics per Jira project (`epicSummaries`, keys in numbering block 8): 40% of the standard issues have an epic parent, parents of sub-tasks are standard issues, parent-only entries carry summary, type, fix versions and parent like the server's; the orphaned issues carry type, fix versions, parent and `updated`, one in five is a sub-task of an in-progress story added as a parent-only entry, about a third are in a sprint
- Seeded PRNG: the same repository always yields the same pull requests, so `dataHash` is stable and the smart reload stays quiet
- `parseFixtureOptions()` reads `--fixtures`, `--fixture-scale=N`, `--fixture-chain-depth=N` or the `PR_TREE_FIXTURES*` environment variables; `fixtureConfig()` replaces config.js; `createFixtureSource()` is what index.mjs calls instead of Atlassian

**public/app-shell.js**
- Banner and sidebar chrome, independent of pull-request data; the version badge (`fetchAndDisplayVersion`, from `/api/version`) is filled by `initializeAppShell`
- Sidebar toggle (button, `F` key), stored in `localStorage` under `prTree.sidebarHidden` for the wide layout; below 900px the sidebar is a drawer that always starts closed; `/` shows the sidebar and focuses the search box; Escape is left to a text box that has content (it clears itself)
- Theme toggle, stored under `prTree.theme`; the OS setting is followed until a choice is stored; an inline script in `index.html` applies both before the first paint
- Help modal, active-filter badge, tree toolbar (collapse all / expand all), document title (`(attention) PROJECT · Bitbucket Pull-Requests Tree`)
- No DOM access at import time, so its pure helpers are unit-tested

**public/tree-toggle.js**
- `setRepositoryCollapsed`, `setRootBranchCollapsed`, `setPullRequestCollapsed` are the only code paths that change a collapsed state
- `collapseAll` / `expandAll`, `captureToggleStates` / `restoreToggleStates` used across re-renders

**public/index.html**
- App shell: banner (project selector, refresh status, theme toggle, help, GitHub, version), filter sidebar, tree pane with the collapse/expand toolbar, help modal
- Inline `<head>` script applies the stored theme and sidebar state before the first paint

## API Endpoints

### GET /api/version
Returns application version metadata.

**Response:**
```json
{
  "version": "2.10.1",
  "releaseDate": "2026-09-14",
  "author": "François-Régis Jaunatre",
  "license": "Copyright François-Régis Jaunatre"
}
```

### GET /api/projects
Returns list of configured projects (cached 5 minutes).

**Response:**
```json
["PROJECT1", "PROJECT2"]
```

### GET /api/pull-requests/:project
Main data endpoint. Returns comprehensive project data (cached 2 minutes).

**Parameters:**
- `project`: Project name from projects.js

**Response:**
```json
{
  "lastRefreshTime": "2025-01-22T10:30:00.000Z",
  "pullRequests": [...],          // PR objects with commitsAhead/commitsBehind
  "jiraIssuesMap": {...},         // Map of PR ID to Jira issue keys
  "jiraIssuesDetails": [...],     // Full Jira issue objects
  "pullRequestsByDestination": {...},
  "jiraSiteName": "...",
  "sprints": [...],               // Active sprints
  "sprintIssues": {...},          // Map of sprint ID to issue keys
  "orphanedIssues": [...],        // Issues in review without PRs, with the fields of the linked issues plus updated
  "dataHash": "..."               // MD5 hash for change detection
}
```

**Special behavior:**
- If dataHash unchanged from last response, only updates `lastRefreshTime`
- Only fetches commit counts (ahead/behind) when hash changes
- This prevents Bitbucket API rate limiting (HTTP 429)

### GET /api/sync-statuses/:project
Returns the SYNC (conflicts) status of every open PR of a project in a single response (cached 5 minutes; each pull request's result is read from `sync-cache.json` first, so only the pull requests whose commits moved cost Bitbucket requests). Only called by the frontend when the user clicks the load button next to the SYNC filter, never automatically.

**Response:**
```json
{
  "lastRefreshTime": "2026-08-12T10:30:00.000Z",
  "rateLimited": false,
  "rateLimitedUntil": null,
  "statuses": {
    "repo-name/destHash..sourceHash": { "conflicts": true, "files": ["src/package-lock.json"] },
    "repo-name/otherDest..otherSource": { "conflicts": false },
    "repo-name/thirdDest..thirdSource": { "error": true, "reason": "The operation was aborted due to timeout" },
    "repo-name/fourthDest..fourthSource": { "conflicts": true, "files": ["pom.xml"], "reason": "Request failed with status code 502" }
  }
}
```

A SYNC entry with a `reason` is partial: the listed files conflict for sure, the other files could not be checked; it is not stored and is computed again at the next load.

**Rate-limit behavior (applies to all endpoints):** every Atlassian request goes through `atlassianFetch()` in index.mjs, the fixture-mode guard in front of the wrapper of atlassian-fetch.mjs (`createAtlassianFetch`, which defines `RateLimitError` and `failureReason`). After any HTTP 429 from Bitbucket or Jira, no request is sent to Atlassian until 10 minutes after the last 429; all cache TTLs are raised to cover that window (`raiseAllCacheTtls` in cache.mjs) so cached data keeps being served. Responses built during the pause carry `rateLimited: true` and are cached until the window closes; uncached endpoints return 503 with `rateLimitedUntil`.

### GET /api/cache/stats
Returns cache statistics.

**Response:**
```json
{
  "keys": 5,
  "hits": 120,
  "misses": 15,
  "ksize": 5,
  "vsize": 1024000
}
```

## Architecture Patterns

### Server-Side Caching Strategy
The application implements a sophisticated caching system to minimize API calls:

1. **Two-tier caching**: Server-side (node-cache) + pseudo-client cache (hash comparison)
2. **Hash-based change detection**: MD5 hash of PR/Jira data prevents unnecessary re-fetching
3. **Selective fetching**: Commit counts only fetched when hash changes
4. **TTL-based expiration**: Different TTLs for different data types

### Data Flow
```
Client Request → Express Route → Cache Check →
  Cache Hit: Return cached data
  Cache Miss: → Fetch from APIs → Store in cache → Return data
```

### Logging System
Three separate log streams:
- **access.log**: Request logs with timestamps, method, path, query, IP
- **error.log**: Error messages from failed API calls or server errors
- **performance.log**: Duration metrics for expensive operations

Pattern:
```javascript
log(message, logStream);  // Logs to both console and file
```

### Frontend State Management
State is managed through module-level variables in app.js:
```javascript
let availableProjects = [];    // the project names from /api/projects
let currentProject = null;
let currentText = '';          // text filter
let currentSprints = [];        // sprint ids
let currentFixVersions = [];    // fix version ids
let currentEpics = [];         // epic keys
let currentStories = [];       // story keys
let currentParticipants = [];  // participant names
let currentWork = 'all';       // 'all', 'reviews', 'issues', 'ready', 'reviewers' or 'assignees'
let currentSync = "Show all";
let currentApiResult = null;
```
The SYNC statuses and their loading state live in app-sync.js (`currentSyncStatuses`, `syncStatusLoading`, `syncLoadFailed`, `syncLoadGeneration`); app.js asks `syncStatusesLoaded()` to restore the SYNC filter from the URL and calls `resetSyncStatuses()` on a project switch.

State is synchronized with URL query parameters for deep linking:
```
?project=PROJ&q=banner&sprint=Sprint1&epic=PROJ-100&story=PROJ-200&participant=Jane&work=reviewers&sync=requested
```
(`assignee`, `reviewer`, `readyReviewer`, `readyAssignee` and `ready`, the people parameters before 2.8.0, are ignored and removed from the URL.)

The page follows the URL on Back and Forward: `handlePopState()` restores the filters (`restoreFiltersFromUrl`), applies them and replaces the URL with the filters kept, or switches the project when the `project` parameter changed; nothing in that path pushes a history entry. Each user action is one history entry: a filter change pushes, typing replaces, a manual project switch pushes once (a switch to "Select a project" too: the filters are cleared and the URL is bare), and a page load or a switch from the URL replaces the URL after the render (the address bar catches up with the validated filters).

Every filter pass goes through `applyFilters()` in app.js: it calls `filterBranches(filters)` (app-filter.js), then updates the active-filter badge and the tab title. `renderEverything(apiResult)` receives the data from its caller and applies the filters once every filter control has been populated and restored from the URL. `handleFilterChange()` reads the controls (`readFilterControls()`), applies and pushes the URL; the search box goes through `handleTextFilterInput()`, which replaces the URL instead of pushing it.

### Filtering Architecture
Single pass in app-filter.js:
1. `initializeFilter(apiResult)` builds the index once per data load (Maps and Sets, no array search later)
2. `filterBranches()` collects the SYNC badges once, then walks repositories → root branches → direct child pull requests → their `.children` container, recursively (the `.repository:not(.orphaned-issues)` blocks); every pull request is visited exactly once
3. Children are evaluated first; a filtered-out parent stays displayed while a descendant is visible; a root branch or a repository with no visible pull request is hidden, and the `.tree-no-match` message rendered by `renderRepositories` is shown while every repository is hidden
4. Counters (repository, root branch, child counters shown) are summed on the way back up and written through `updateCounterDisplay`; DOM writes only happen when the value changes
5. The orphaned issues section is walked apart (`filterOrphanedIssues`): its `.orphaned-issue` rows are evaluated by `data-issue-key` with `evaluateOrphanedIssue`, shown or hidden, `needs-attention` toggled; the section counter is written with the noun `issue`, the section hidden while no row is visible, and the attention of its visible rows is added to the count `filterBranches` returns

Never re-select descendants (`querySelectorAll('.pull-request')`) inside the recursion: the previous implementation did, and a pull request at depth *d* was visited 2^d times (16 million visits per filter change on SECOLLAB).

## Development Workflows

### Initial Setup
1. Clone repository
2. Run `npm ci` (not `npm install` - uses package-lock.json exactly)
3. Copy `config.js.default` to `config.js`
4. Fill in Bitbucket credentials:
   - Username: the e-mail of the Atlassian account (the Bitbucket username is rejected with an API token)
   - Password: an API token with scopes (https://id.atlassian.com/manage-profile/security/api-tokens, "Create API token with scopes", app Bitbucket, scopes `read:repository:bitbucket` and `read:pullrequest:bitbucket`); app passwords were removed by Atlassian in July 2026
   - Workspace slug
5. Fill in Jira credentials:
   - Site name (subdomain of atlassian.net)
   - Username (email)
   - API token without scopes, from the same page (a Bitbucket-scoped token is rejected by Jira)
6. Update `projects.js` with your projects
7. Run `npm start`
8. Navigate to http://localhost:3000

### Running Without Atlassian Access (Fixture Mode)
`npm run start:fixtures` (or `node index.mjs --fixtures`) serves both configured projects from generated data and never calls Atlassian; no config.js is needed. `--fixture-scale=3` multiplies the volumes, `--fixture-chain-depth=8` shortens the deepest stack (default 24, the real SECOLLAB value). Use it for UI work and for performance checks: SECOLLAB in fixture mode has the same volumes and tree shape as the real project.

### Adding a New Project
1. Edit `projects.js`
2. Add new entry:
   ```javascript
   'NEW_PROJECT': {
       repositories: ['repo-slug-1', 'repo-slug-2'],
       jiraProjects: ['JIRA1', 'JIRA2'],
       jiraRegex: /(JIRA1-\d+|JIRA2-\d+)/g
   }
   ```
3. Restart server (no code changes needed, just config)
4. New project appears in dropdown automatically

### Modifying API Endpoints
When adding/modifying endpoints:
1. Update route in index.mjs
2. Add caching if appropriate (use cache.mjs functions)
3. Add error handling with logging:
   ```javascript
   try {
     // operation
   } catch (error) {
     log(`Error: ${error.message}`, errorLogStream);
     res.status(500).send('Internal Server Error');
   }
   ```
4. Add performance logging for expensive operations:
   ```javascript
   const startTime = Date.now();
   // operation
   const duration = Date.now() - startTime;
   log(`Operation - Duration: ${duration}ms`, performanceLogStream);
   ```

### Frontend Development
1. Edit files in `public/` directory
2. Refresh browser (Express serves static files)
3. No build step required
4. Use browser DevTools for debugging

### Testing Changes
- **Manual testing**: Use the UI to verify functionality; `npm run start:fixtures` gives realistic data without credentials
- **Unit tests**: `npm test` (node:test, pure logic, the tree rendering, the fixture generator, the SYNC computation against a fake Bitbucket)
- **Coverage**: `npm run test:coverage` runs the same tests and prints the lines, branches and functions reached in each module of the project; a file no test loads is absent from the table, not at 0%
- **API testing**: Use browser DevTools Network tab or curl
- **Cache testing**: Check `/api/cache/stats` endpoint

## Coding Conventions

### JavaScript Style
- **ES6 modules**: Use `import/export`, not `require()` in .mjs files
- **async/await**: Preferred over promises for async operations
- **Arrow functions**: Used for callbacks and short functions
- **Template literals**: Used for string interpolation
- **Const by default**: Use `const` unless reassignment needed

### Naming Conventions
- **Functions**: camelCase (`fetchPullRequests`, `handleFilterChange`)
- **Variables**: camelCase (`currentProject`, `jiraIssuesMap`)
- **Constants**: camelCase (no UPPER_CASE for constants in this codebase)
- **CSS classes**: kebab-case (`pull-request`, `filter-item`)
- **API routes**: kebab-case (`/api/pull-requests`)

### Error Handling
Always use try-catch with logging:
```javascript
try {
    // operation
} catch (error) {
    log(`Error in functionName: ${error.message}`, errorLogStream);
    throw error;  // or handle gracefully
}
```

### API Response Structure
- Always return JSON for API endpoints
- Include error messages in responses
- Use appropriate HTTP status codes:
  - 200: Success
  - 500: Server error
  - Check response.ok before parsing in client

### Comments
- Minimal inline comments (code should be self-documenting)
- JSDoc-style comments in cache.mjs for exported functions
- TODO comments when appropriate

## Common Tasks

### Add New Filter
1. **Backend**: Modify `/api/pull-requests/:project` to include new data
2. **Frontend HTML**: Add filter UI element in index.html
3. **Frontend State**: Add state variable in app.js
4. **URL Sync**: Update `filtersFromUrl()` and `urlWithFilters()` in app-url.js (with a unit test) and `restoreFiltersFromUrl()` in app.js
5. **Filter Logic**: Add the precomputed set to `buildFilterIndex()` and the match to `evaluatePullRequest()` in app-filter.js, with a unit test
6. **Event Handler**: Wire up filter change event

### Add New Jira Field
1. Modify `fetchJiraIssuesDetails()` in project-data.mjs
2. Update `fields` parameter in JQL query URL
3. Update the frontend rendering to display the new field (`renderPullRequest` in app-render.js)
4. Include field in hash calculation if it should trigger refresh

### Debug Performance Issues
1. Check performance.log for slow operations
2. Review cache hit/miss ratio at `/api/cache/stats`
3. Inspect Network tab for redundant API calls
4. Verify hash-based change detection is working
5. Consider increasing cache TTL if appropriate

### Add New Repository to Existing Project
1. Edit `projects.js`
2. Add repository slug to `repositories` array
3. Restart server
4. Cache will refresh automatically after TTL

### Modify Logging
All logging goes through the `log()` function:
```javascript
log(message, logStream);
```
Three streams available:
- `accessLogStream`: General access and info
- `errorLogStream`: Errors and failures
- `performanceLogStream`: Timing and performance metrics

## Important Notes for AI Assistants

### Security Considerations
- **config.js is git-ignored**: Never commit credentials
- **Basic Auth used**: Credentials are Base64 encoded (not encrypted)
- **No HTTPS enforcement**: Should only run on localhost or behind secure proxy
- **CORS not configured**: Frontend and backend must be same-origin
- **No input validation**: Trust that config.js and projects.js are correct
- **Only public/ and README.md are served**: never mount a static middleware on the project directory, it would serve config.js, the logs and the sources (fixed in 2.5.2); `test/server.test.mjs` checks it
- **sync-cache.json** holds commit hashes and file paths only, no content and no credential; it is git-ignored

### Performance Optimization
- **Minimize API calls**: Use existing cached data when possible
- **Batch operations**: Jira issues fetched in batches of 50
- **Hash-based updates**: Commit counts only fetched when other data changes
- **Pagination handled**: Bitbucket PR fetching uses recursive pagination

### Common Pitfalls
1. **Module type mismatch**: Backend uses ES modules (.mjs), config uses CommonJS (module.exports)
2. **Cache staleness**: Remember that data can be up to 2 minutes old
3. **API rate limits**: Bitbucket can return HTTP 429 if too many requests
4. **Filter restoration**: on a page load the SYNC filter is NOT restored from the URL (its statuses are loaded on demand) while every other filter is, including the Work select; on Back/Forward SYNC follows the URL while its statuses are loaded
5. **Regex patterns**: Must match exact Jira issue key format in PR titles
6. **Colours**: never hard-code a colour in styles.css; add a token to both the `:root` and `:root[data-theme="dark"]` blocks
7. **Participants and Work**: attention is computed by `computeAttention()` from the index (`assignees`, `pendingReviewers`), never from rendered styles; `evaluatePullRequest` takes `participants` and `work` (`all`, `reviews` and `issues` keep every pull request of the participants, `ready`, `reviewers` and `assignees` only those waiting for them); without a participant the work value is ignored, and app.js forces it back to `all`
8. **Deep stacks**: SECOLLAB has a 24-deep stack of pull requests; anything recursive over the tree must visit each pull request once (see Filtering Architecture)
9. **`pullRequestsByDestination` is keyed by branch name across repositories**: two repositories sharing a branch name (e.g. `master`) share the entry; known limitation, not handled
10. **Search box and history**: the text filter writes the URL with `replaceState` (one history entry for a whole typing session); every other filter pushes; `restoreFiltersFromUrl` keeps the content of a focused search box on a re-render (the URL holds the trimmed query) but takes the URL on Back/Forward
11. **Jira hierarchy**: only `issueLevel`/`epicOf`/`storyOf` in app-filter.js read `issuetype` and `parent`; parent-only issues (fetched as parents) have no status
12. **Module boundaries**: app-render.js stays free of filter state and of DOM access at import time (its tests import it in node); app-sync.js never imports app.js (it receives accessors), so there is no circular import; anything that needs both the state and a module goes through app.js
13. **Late responses**: `selectProject` and `checkForUpdates` capture the project before their fetch and drop the response when the project changed meanwhile; `loadSyncStatuses` compares the load generation `resetSyncStatuses` bumps (Back/Forward make quick switches easy); any new fetch that paints something must do the same
14. **Conflict computation**: never merge file contents on the event loop again (a 30,000-line lock file ran for five minutes and blocked every request, 2.7.0); conflicts come from the patches of both sides, and `sync-cache.json` makes the results permanent, so a change to `parseUnifiedDiff`, `conflictingFiles`, `decideFromDiffstat`, `computeConflicts`, `checkPatch` or the diffstat mapping (sync-statuses.mjs) that can change a decision must bump `conflictRuleVersion` in conflicts.mjs, which the cache keys start with (`syncCacheVersion` is the file format); no need to delete `sync-cache.json` after a bump, entries computed under the older version are simply never looked up again and age out with the rest after 90 days
15. **Orphaned issues section**: it is a `.repository.orphaned-issues` block so the toggles apply, and the filter walk skips it in the repository loop; its rows are `.orphaned-issue`, never `.pull-request` (the tree pass, the SYNC badge collection and `captureToggleStates` select `.pull-request`); the parents of the orphaned issues are in `jiraIssuesDetails` like the linked issues' parents, except a parent that is an orphaned issue itself, which the index looks up among the orphaned issues

### Testing Approach
- **Unit tests**: `npm test` runs `node:test` over `test/*.test.mjs` for the pure logic (`parseTextQuery`, `matchesText`, `issueLevel`, `epicOf`, `storyOf`, `computeAttention`, `countActiveFilters`, `buildFilterIndex`, `initializeFilter`, `evaluatePullRequest`, `evaluateOrphanedIssue`, `buildDocumentTitle`, `projectFromUrl`, `filtersFromUrl`, `urlWithFilters`, `renderRepositories`, `renderOrphanedIssues`, `findRootBranches`, `calculateTotalPullRequests`, `calculateDescendants`, `renderParticipant`) and the fixture generator (volumes, determinism, deep stack, hierarchy, the participants list), the conflict rule on synthetic patches (`test/conflicts.test.mjs`), the on-disk cache (`test/sync-cache.test.mjs`), one SYNC computation per project at a time, the TTLs raised during a rate-limit pause (with `mock.timers` on `Date`, since node-cache reads `Date.now()`) and the cache statistics (`test/cache.test.mjs`), the SYNC tooltip text (`test/app-sync.test.mjs`), the Atlassian wrapper with a fake `fetch` and a clock variable (`test/atlassian-fetch.test.mjs`: the pause after a 429 from either API, the failure messages with and without the URL, what the routes answer during a pause), the project data against a fake Atlassian (`test/project-data.test.mjs`: pull-request pagination, the Jira batches of 50 and the parents fetched after them, the fix versions inherited, the orphaned issues (their fields, their parents fetched with the linked issues' parents), the sprints of every board, the hash and the commit counts fetched only when it changed, `pullRequestsByDestination` keyed across repositories), the server's SYNC computation against a fake Bitbucket answering diffstats and diffs by URL (`test/sync-statuses.test.mjs`: the requests made, the statuses and reasons sent, what is stored in `sync-cache.json` under the rule-version prefix, the summary log line); no DOM, no extra dependency; `test/server.test.mjs` starts the server in fixture mode on an ephemeral port (`PORT=0`) and checks what it serves (the app, the API, `README.md`, nothing else of the project directory), the documented shape of `/api/pull-requests/:project` and its `dataHash` stable across calls, the five counters of `/api/cache/stats`, and the answers to an unknown project (500 from the pull requests route, whose `buildProjectData` throws "Project not found" and whose route maps every error to 500; 404 from the sync statuses route)
- **Coverage**: `npm run test:coverage` is `npm test` with Node's `--experimental-test-coverage` (no dependency; the include patterns need Node 22.5 or later): after the tests, a table with the line, branch and function coverage of `*.mjs`, `projects.js`, `public/*.js` and `fixtures/*.mjs` and the uncovered line numbers; the files are listed explicitly because a `--require` preload in `NODE_OPTIONS` would otherwise appear from outside the project (`--test-coverage-exclude` cannot express "outside the project", minimatch's `**` does not cross `..`), so a new source directory needs a pattern in the script; `index.mjs` (the routes and the wiring, the fixture-mode guard) is reached through the fixture server the server test spawns, which exits normally on SIGTERM so that V8 writes its coverage, and the test waits for that exit; a file no test loads (`public/app.js`, `public/multi-select.js`) is absent from the table rather than at 0%, so the "all files" line overstates; the DOM modules (`app-shell.js`, `app-sync.js`, `tree-toggle.js`) are low because only their pure helpers are tested; no threshold
- **Performance**: start `npm run start:fixtures`, open SECOLLAB, and time a filter change in the browser console (e.g. `performance.now()` around a checkbox `.click()` of a multi-select); a pass should stay around a millisecond of JavaScript
- **UI**: manual testing in the browser (layout, filters, theme)
- **Regression testing**: Test all filters after making changes
- **API testing**: Use browser DevTools or Postman
- **Error scenarios**: Check error.log for unexpected issues

### Deployment
- **Production**: Not designed for production deployment
- **Target environment**: Developer workstations, localhost only
- **No containerization**: Direct Node.js execution
- **No CI/CD**: Manual deployment

### Version Management
Version information stored in package.json:
- `version`: Semantic version number
- `releaseDate`: Release date in ISO format
- Update both when making releases
- Version displayed in UI footer

## Git Workflow

### Branching Strategy
- Default branch: Not specified in current context
- Feature branches: Use descriptive names with `claude/` prefix
- Example: `claude/claude-md-mhzdq5nie29z6hi0-01HJKAFkKK9KyjvqwJpsnDwQ`

### Ignored Files (.gitignore)
- `config.js`: User-specific credentials
- `node_modules/`: Dependencies
- `*.log`: All log files (access, error, performance)
- `sync/`: Temporary folder
- `Bitbucket-pr-tree*.gif`: Demo/screenshot files
- `sync-cache.json*`: conflict results kept across restarts (and the temporary file of a write)

### Commit Messages
- No specific convention enforced
- Recent commits show format: `verb: description`
  - `bump version number`
  - `fix: use new api after deprecation removal`
  - `feat(server-side caching)`

## External Dependencies

### APIs Used
- **Bitbucket API v2.0**: https://api.bitbucket.org/2.0/
  - Endpoints: repositories, pullrequests, commits, diff
- **Jira API v3**: https://{siteName}.atlassian.net/rest/api/3/
  - Endpoints: search (JQL), issues
- **Jira Agile API v1.0**: https://{siteName}.atlassian.net/rest/agile/1.0/
  - Endpoints: board, sprint

### Authentication
- Bitbucket: Basic Auth with the account e-mail and a scoped API token
- Jira: Basic Auth with email and API token
- Tokens stored in config.js (Base64 encoded in headers)

## Future Considerations

### Potential Improvements
- Add automated tests (Jest for backend, testing-library for frontend)
- Implement WebSocket for real-time updates
- Add user authentication/multi-user support
- Containerize with Docker
- Add TypeScript for type safety
- Implement proper build pipeline
- Add database for persistent caching
- Implement OAuth for API authentication
- Add PR comment integration
- Support for GitHub (not just Bitbucket)

### Known Limitations
- No error recovery for failed API calls
- No retry logic for transient failures
- Limited to Bitbucket and Jira (no GitHub/GitLab support)
- No mobile-responsive design optimization
- Single-user application (no authentication)
- In-memory cache lost on server restart

## Support and Resources

- **Repository**: Check README.md for user documentation
- **Issues**: No issue tracker specified
- **License**: Copyright François-Régis Jaunatre (proprietary)
- **Documentation**: README.md contains changelog and feature list

---

**Last Updated**: 2026-09-14
**For**: AI Assistant usage (Claude, GPT, etc.)
**Maintained by**: Project contributors
