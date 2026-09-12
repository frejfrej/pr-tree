# CLAUDE.md - AI Assistant Guide

## Project Overview

**Bitbucket Pull-Requests Tree** is a web-based dashboard for visualizing and managing Bitbucket pull requests with integrated Jira issue tracking. It provides a comprehensive view of PR status, related issues, conflicts, and team workflow.

### Key Features
- Multi-project support with dropdown selection
- Pull request visualization ordered by most recently updated
- Jira issue integration with status tracking
- Advanced filtering (text, sprint, fix version, epic, story, assignee, reviewer, sync status)
- Real-time conflict detection
- Commit ahead/behind tracking
- Smart reload (auto-updates every 2 minutes when data changes)
- Server-side caching to reduce API load
- Orphaned issue detection (Jira issues in review without PRs)

### Version
Current version: **2.7.0** (as of 2026-09-12)

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

**index.mjs** (506 lines)
- Main Express application server
- API endpoint definitions (`/api/version`, `/api/projects`, `/api/pull-requests/:project`, `/api/sync-statuses/:project`, `/api/cache/stats`)
- The per-pull-request conflict computation survives only as an internal of `/api/sync-statuses/:project`: `computeConflicts` fetches the diffstats of both sides (with their line counts), decides what their statuses can (`decideFromDiffstat`), fetches one patch per side restricted to the files left to check (`diff/{side}..{other}?topic=true&path=...`, 20 files per request, the paths of one file in the same request so a rename is seen whole), requires every checked file to be in both patches with the diffstat's line counts (`checkPatch`), then asks `conflictingFiles`; more than 100 files to check (`maxFilesToCheck`) skips the patches, and a failed request or a `checkPatch` mismatch is caught, so when the diffstats already proved a conflict the limit or a later failure gives a partial SYNC (`{ conflicts: true, files, reason }`: the known files, and the reason the rest was not checked) instead of a full failure, and a partial result is never stored; results are looked up in and added to `sync-cache.json` (`sync-cache.mjs`) under `<conflictRuleVersion>:<repo>/<dest>..<source>` before any request; the reasons sent to the client are short (`atlassianFetch`'s `shortMessage`, without the URL; the full message goes to error.log); each load logs how many pull requests it computed, could not check, and could only partly check
- Bitbucket API integration (fetch PRs, commit diffs)
- Jira API integration (fetch issues, sprints, orphaned issues)
- `fetchJiraIssuesDetails()` fetches the linked issues (summary, status, priority, fix versions, assignee, parent, issue type), then the parents that were not linked themselves (summary, issue type, fix versions, parent): sub-tasks inherit the fix versions of their parent, and the frontend resolves epics and stories from `parent`
- Response hashing for change detection
- Comprehensive logging system (access.log, error.log, performance.log)
- Static file serving for the public directory; `README.md` is served through a dedicated route (the help modal fetches it) and nothing else of the project directory is reachable over HTTP

**cache.mjs** (98 lines)
- Abstraction layer over node-cache
- Provides typed caching functions for different data types
- TTL configuration:
  - Project data: 120 seconds (default)
  - Projects list: 300 seconds (5 minutes)
- The per-pull-request conflict results are not in node-cache: they live in `sync-cache.json` (`sync-cache.mjs`), for good
- `getCachedSyncStatuses` shares a computation in progress per project (two loads of one project at once compute once; a failure is not cached)
- The sprints are fetched with the project data and cached with it (no separate cache)
- Cache statistics endpoint support

**conflicts.mjs**
- Pure: `parseUnifiedDiff(text)` turns a git unified diff into files keyed by base path (the `a/` path of the `diff --git` header, or the `rename from` path for a renamed file; C-quoted paths are decoded, and a `diff --git` header is split correctly even when a path contains ` b/`) with change regions `{ start, end, lines }` in merge-base line coordinates, `newHash` (the post-image blob of the `index` line) and `linesAdded`/`linesRemoved`; content lines keep their CR and a missing final newline marks the line; it throws on a malformed or truncated patch (a hunk longer or shorter than its header, hunks out of order or overlapping, a foreign line, a file header without a hunk, a file listed twice) rather than let it pass for a clean merge
- `conflictingFiles(sideA, sideB)` applies git's rule: deleted on both sides is clean, deleted on one side conflicts, the same post-image blob on both sides is clean, a binary whose content changed on both sides conflicts, otherwise overlapping or touching regions conflict unless they are the same change (a linear sweep; an added file is an insertion into an empty base)
- `decideFromDiffstat(sourceFiles, destFiles)` decides from the diffstat statuses: removed on both sides is nothing, removed on one side is a conflict, renamed to different paths on both sides is a conflict, two different files ending at one path (rename/add, two renames onto one path) are a conflict, and so is a path that is a file on one side and a directory on the other (file/directory: only an added or renamed file counts, so a file renamed away before its old path became a directory merges cleanly); the other files touched on both sides need the patches
- `conflictRuleVersion` (exported): bumped whenever a change to `parseUnifiedDiff`, `conflictingFiles` or `decideFromDiffstat` can change a decision; the server prefixes its cache keys with it, so results computed under an older rule are never reused
- Known approximations: git merges with the histogram diff, so patches made with another diff algorithm can place hunks differently on repetitive files; a directory renamed on one side while the other adds a file in the old directory is not detected; `.gitattributes` merge drivers are ignored (a `merge=binary` driver makes git conflict even on changes that do not touch); a change of file type is reported not checked
- Unit-tested with synthetic patches (`test/conflicts.test.mjs`); when the rule changes, check it against `git merge-file` or `git merge-tree` on generated cases (the fuzzers used while 2.7.0 was written are not in the repository) and bump `conflictRuleVersion`

**sync-cache.mjs**
- `openSyncCache(filePath, { maxAgeDays, now, onError })`: `size`, `get(key)`, `set(key, result)`, `save()`; the file is `{ version: 1, entries: { "repo/dest..source": { conflicts, files, computedAt } } }`, read once at open (a missing file is an empty cache, an unreadable one or another version is reported through `onError` and ignored, entries that are not objects are dropped), written through a temporary file then a rename, pruned of entries older than 90 days at save
- `save()` serializes at call time and queues its write after the writes in flight; it resolves to whether it wrote and only ever rejects (a failed write leaves the entries pending for the next save)
- Only successful results are stored (the route stores nothing for `{ error: true }`), so failures are retried at the next load; fixture mode reads the file but never writes it

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
- Project selection and data loading; `renderEverything(apiResult)` builds the tree with app-render.js, repaints the SYNC badges (app-sync.js), populates the filter controls, restores the filters from the URL and applies them
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
- `updateReadyCheckboxes()`: the two ready checkboxes are disabled and unchecked while their multi-select is empty; both checked keeps pull requests needing either attention

**public/app-render.js**
- `renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, pullRequestsByDestination, jiraSiteName)` (pure): the tree as an HTML string; one `.repository` block per repository, its root branches, the pull requests nested in `.children` containers, most recently updated first; appends the hidden `.tree-no-match` message when there is at least one repository
- `renderOrphanedIssues(issues)` (pure): the "JIRA Issues In Review without Pull Requests" section, an empty string without issues
- `findRootBranches`, `calculateTotalPullRequests`, `calculateDescendants` (pure, exported for the tests); `renderPullRequests`, `renderPullRequest`, `renderParticipant`, `getBranchUrl` are private
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
- `buildFilterIndex(apiResult)` (pure): one entry per pull request with its linked issues, the `searchText` the text filter searches (title, source branch, issue keys, lower-cased) and the sets of assignees, reviewers, sprint ids and fix version ids the filters compare against, and the epic keys (`epics`) and story keys (`stories`); it also returns `index.epics` and `index.stories`, the epics and stories to list in the filters; built once per data load by `initializeFilter()`, which returns it
- `evaluatePullRequest(entry, filters, rendered)` (pure): visibility and attention of one pull request; the SYNC filter values are `requested` (SYNC badge), `OK` (OK badge) and `unchecked` ("Not checked": neither badge, so the `?` and `!` pull requests)
- `filterBranches(filters)`: collects the SYNC and OK badges once, then one walk of the rendered tree, direct children only, each pull request visited once; hides, highlights, sums the counters of repositories, root branches and child counters on the way back up, hides the root branches and repositories left without a visible pull request, shows the `.tree-no-match` message while every repository is hidden, returns the attention count
- `issueLevel`, `epicOf`, `storyOf` (pure): the only code that interprets `issuetype` and `parent` (epic > standard issue > sub-task); a sub-task reaches its epic through its parent story, which the server fetches with its own `parent`
- `parseTextQuery`, `matchesText`, `issueOptions`, `computeAttention`, `countActiveFilters` (pure)

**public/app-url.js**
- `projectFromUrl(search, projects)` (pure): the project a query string names when it is one of the given ones (app.js passes `availableProjects`); `null` otherwise, an empty name included
- `filtersFromUrl(search)` (pure): the filters a query string describes, in the shape of `currentFilters()`; `ready`, the former name, is read as `readyReviewer`
- `urlWithFilters(url, { project, filters })` (pure): a copy of the URL with the project and the active filters only; parameters that are not filters are kept

**public/counter-utils.js**
- `updateCounterDisplay(element, visible, total)`: the `n/total` text and tooltip of a counter; the counts come from the filter pass

**fixtures/generate.mjs** and **fixtures/index.mjs**
- `generateProjectData(projectName, projectConfig, { scale, chainDepth })` returns exactly the `/api/pull-requests/:project` response shape; `generateSyncStatuses(projectData)` the `/api/sync-statuses/:project` one
- Volumes and structure follow the real projects (see the constants at the top of generate.mjs), including the 24-deep stack of `products.secollab` under `feat/ai_investigations` that made the old filtering explode
- Epics per Jira project (`epicSummaries`, keys in numbering block 8): 40% of the standard issues have an epic parent, parents of sub-tasks are standard issues, parent-only entries carry summary, type, fix versions and parent like the server's
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
  "version": "1.11.1",
  "releaseDate": "2025-01-22",
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
  "orphanedIssues": [...],        // Issues in review without PRs
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
    "repo-name/thirdDest..thirdSource": { "error": true, "reason": "The operation was aborted due to timeout (https://...)" },
    "repo-name/fourthDest..fourthSource": { "conflicts": true, "files": ["pom.xml"], "reason": "Request failed with status code 502" }
  }
}
```

A SYNC entry with a `reason` is partial: the listed files conflict for sure, the other files could not be checked; it is not stored and is computed again at the next load.

**Rate-limit behavior (applies to all endpoints):** every Atlassian request goes through `atlassianFetch()` in index.mjs. After any HTTP 429 from Bitbucket or Jira, no request is sent to Atlassian until 10 minutes after the last 429; all cache TTLs are raised to cover that window (`raiseAllCacheTtls` in cache.mjs) so cached data keeps being served. Responses built during the pause carry `rateLimited: true` and are cached until the window closes; uncached endpoints return 503 with `rateLimitedUntil`.

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
let currentAssignees = [];
let currentReviewers = [];
let currentSync = "Show all";
let currentReadyForReviewer = false;
let currentReadyForAssignee = false;
let currentApiResult = null;
```
The SYNC statuses and their loading state live in app-sync.js (`currentSyncStatuses`, `syncStatusLoading`, `syncLoadFailed`, `syncLoadGeneration`); app.js asks `syncStatusesLoaded()` to restore the SYNC filter from the URL and calls `resetSyncStatuses()` on a project switch.

State is synchronized with URL query parameters for deep linking:
```
?project=PROJ&q=banner&assignee=John&reviewer=Jane&sprint=Sprint1&epic=PROJ-100&story=PROJ-200&sync=requested&readyReviewer=true&readyAssignee=true
```
(`ready`, the former name of `readyReviewer`, is still read from old links but never written.)

The page follows the URL on Back and Forward: `handlePopState()` restores the filters (`restoreFiltersFromUrl`), applies them and replaces the URL with the filters kept, or switches the project when the `project` parameter changed; nothing in that path pushes a history entry. Each user action is one history entry: a filter change pushes, typing replaces, a manual project switch pushes once (a switch to "Select a project" too: the filters are cleared and the URL is bare), and a page load or a switch from the URL replaces the URL after the render (the address bar catches up with the validated filters).

Every filter pass goes through `applyFilters()` in app.js: it calls `filterBranches(filters)` (app-filter.js), then updates the active-filter badge and the tab title. `renderEverything(apiResult)` receives the data from its caller and applies the filters once every filter control has been populated and restored from the URL. `handleFilterChange()` reads the controls (`readFilterControls()`), applies and pushes the URL; the search box goes through `handleTextFilterInput()`, which replaces the URL instead of pushing it.

### Filtering Architecture
Single pass in app-filter.js:
1. `initializeFilter(apiResult)` builds the index once per data load (Maps and Sets, no array search later)
2. `filterBranches()` collects the SYNC badges once, then walks repositories → root branches → direct child pull requests → their `.children` container, recursively; every pull request is visited exactly once
3. Children are evaluated first; a filtered-out parent stays displayed while a descendant is visible; a root branch or a repository with no visible pull request is hidden, and the `.tree-no-match` message rendered by `renderRepositories` is shown while every repository is hidden
4. Counters (repository, root branch, child counters shown) are summed on the way back up and written through `updateCounterDisplay`; DOM writes only happen when the value changes

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
- **Unit tests**: `npm test` (node:test, pure logic, the tree rendering and the fixture generator)
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
1. Modify `fetchJiraIssuesDetails()` in index.mjs
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
4. **Filter restoration**: on a page load the SYNC filter is NOT restored from the URL (its statuses are loaded on demand) while every other filter is, including the two ready checkboxes; on Back/Forward SYNC follows the URL while its statuses are loaded
5. **Regex patterns**: Must match exact Jira issue key format in PR titles
6. **Colours**: never hard-code a colour in styles.css; add a token to both the `:root` and `:root[data-theme="dark"]` blocks
7. **Ready for reviewer / assignee**: computed by `computeAttention()` from the data, never from rendered styles; `evaluatePullRequest` takes `readyReviewer` and `readyAssignee`
8. **Deep stacks**: SECOLLAB has a 24-deep stack of pull requests; anything recursive over the tree must visit each pull request once (see Filtering Architecture)
9. **`pullRequestsByDestination` is keyed by branch name across repositories**: two repositories sharing a branch name (e.g. `master`) share the entry; known limitation, not handled
10. **Search box and history**: the text filter writes the URL with `replaceState` (one history entry for a whole typing session); every other filter pushes; `restoreFiltersFromUrl` keeps the content of a focused search box on a re-render (the URL holds the trimmed query) but takes the URL on Back/Forward
11. **Jira hierarchy**: only `issueLevel`/`epicOf`/`storyOf` in app-filter.js read `issuetype` and `parent`; parent-only issues (fetched as parents) have no status
12. **Module boundaries**: app-render.js stays free of filter state and of DOM access at import time (its tests import it in node); app-sync.js never imports app.js (it receives accessors), so there is no circular import; anything that needs both the state and a module goes through app.js
13. **Late responses**: `selectProject` and `checkForUpdates` capture the project before their fetch and drop the response when the project changed meanwhile; `loadSyncStatuses` compares the load generation `resetSyncStatuses` bumps (Back/Forward make quick switches easy); any new fetch that paints something must do the same
14. **Conflict computation**: never merge file contents on the event loop again (a 30,000-line lock file ran for five minutes and blocked every request, 2.7.0); conflicts come from the patches of both sides, and `sync-cache.json` makes the results permanent, so a change of the rule must bump `conflictRuleVersion` in conflicts.mjs, which the cache keys start with (`syncCacheVersion` is the file format), otherwise results computed under the old rule stay for 90 days

### Testing Approach
- **Unit tests**: `npm test` runs `node:test` over `test/*.test.mjs` for the pure logic (`parseTextQuery`, `matchesText`, `issueLevel`, `epicOf`, `storyOf`, `computeAttention`, `countActiveFilters`, `buildFilterIndex`, `evaluatePullRequest`, `buildDocumentTitle`, `projectFromUrl`, `filtersFromUrl`, `urlWithFilters`, `renderRepositories`, `renderOrphanedIssues`, `findRootBranches`, `calculateTotalPullRequests`, `calculateDescendants`) and the fixture generator (volumes, determinism, deep stack, hierarchy), the conflict rule on synthetic patches (`test/conflicts.test.mjs`), the on-disk cache (`test/sync-cache.test.mjs`), one SYNC computation per project at a time (`test/cache.test.mjs`), the SYNC tooltip text (`test/app-sync.test.mjs`); no DOM, no extra dependency; `test/server.test.mjs` starts the server in fixture mode on an ephemeral port (`PORT=0`) and checks what it serves (the app, the API, `README.md`, nothing else of the project directory)
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

**Last Updated**: 2026-09-12
**For**: AI Assistant usage (Claude, GPT, etc.)
**Maintained by**: Project contributors
