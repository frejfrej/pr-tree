# CLAUDE.md - AI Assistant Guide

## Project Overview

**Bitbucket Pull-Requests Tree** is a web-based dashboard for visualizing and managing Bitbucket pull requests with integrated Jira issue tracking. It provides a comprehensive view of PR status, related issues, conflicts, and team workflow.

### Key Features
- Multi-project support with dropdown selection
- Pull request visualization ordered by most recently updated
- Jira issue integration with status tracking
- Advanced filtering (author, reviewer, sprint, sync status)
- Real-time conflict detection
- Commit ahead/behind tracking
- Smart reload (auto-updates every 2 minutes when data changes)
- Server-side caching to reduce API load
- Orphaned issue detection (Jira issues in review without PRs)

### Version
Current version: **2.3.0** (as of 2026-09-05)

## Technology Stack

### Backend
- **Runtime**: Node.js with ES Modules (.mjs)
- **Framework**: Express.js (v4.19.2)
- **HTTP Client**: node-fetch (v3.3.2)
- **Caching**: node-cache (v5.1.2)
- **Configuration**: dotenv (v16.4.5)
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
├── config.js              # Configuration file (git-ignored, user-specific)
├── config.js.default      # Configuration template
├── projects.js            # Project definitions & Jira regex patterns
├── package.json           # Dependencies & version metadata
├── .gitignore             # Excludes config.js, node_modules, logs
├── start.bat              # Windows startup script
├── fixtures/              # Fixture mode: generated data served instead of Atlassian (npm run start:fixtures)
│   ├── generate.mjs       # Deterministic generator modelled on the real projects
│   └── index.mjs          # Command-line/env options, config replacement, data source
├── test/                  # node:test unit tests (npm test)
├── README.md              # User-facing documentation
└── public/                # Frontend assets
    ├── index.html         # App shell: banner, filter sidebar, tree pane, help modal
    ├── styles.css         # Application styles (colour tokens, light and dark themes)
    ├── app.js             # Data loading, rendering, filter state
    ├── app-filter.js      # Filter index, pure evaluation, single-pass tree filtering and counters
    ├── app-shell.js       # Banner, sidebar, theme, keyboard shortcuts, help modal, tab title
    ├── tree-toggle.js     # Collapse/expand helpers and toggle-state capture/restore
    ├── multi-select.js    # Multi-select dropdown component
    └── counter-utils.js   # Display of a filtered/total counter
```

### Key Files Explained

#### Backend Files

**index.mjs** (506 lines)
- Main Express application server
- API endpoint definitions (`/api/projects`, `/api/pull-requests/:project`, `/api/pull-request-conflicts/:repoName/:spec`)
- Bitbucket API integration (fetch PRs, commit diffs)
- Jira API integration (fetch issues, sprints, orphaned issues)
- Response hashing for change detection
- Comprehensive logging system (access.log, error.log, performance.log)
- Static file serving for public directory

**cache.mjs** (98 lines)
- Abstraction layer over node-cache
- Provides typed caching functions for different data types
- TTL configuration:
  - Project data: 120 seconds (default)
  - Projects list: 300 seconds (5 minutes)
  - Conflicts: 300 seconds (5 minutes)
  - Sprints: 600 seconds (10 minutes)
- Cache statistics endpoint support

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
- Main application state management
- Project selection and data loading
- URL state persistence (filters saved to query params)
- Periodic refresh logic (2-minute intervals, tab visibility detection)
- Loading state management
- Event handlers for user interactions

**public/app-filter.js**
- `buildFilterIndex(apiResult)` (pure): one entry per pull request with its linked issues and the sets of assignees, reviewers, sprint ids and fix version ids the filters compare against; built once per data load by `initializeFilter()`
- `evaluatePullRequest(entry, filters, rendered)` (pure): visibility and attention of one pull request
- `filterBranches(...)`: one walk of the rendered tree, direct children only, each pull request visited once; hides, highlights, sums the counters of repositories, root branches and child counters on the way back up, returns the attention count
- `computeAttention`, `countActiveFilters` (pure)

**public/counter-utils.js**
- `updateCounterDisplay(element, visible, total)`: the `n/total` text and tooltip of a counter; the counts come from the filter pass

**fixtures/generate.mjs** and **fixtures/index.mjs**
- `generateProjectData(projectName, projectConfig, { scale, chainDepth })` returns exactly the `/api/pull-requests/:project` response shape; `generateSyncStatuses(projectData)` the `/api/sync-statuses/:project` one
- Volumes and structure follow the real projects (see the constants at the top of generate.mjs), including the 24-deep stack of `products.secollab` under `feat/ai_investigations` that made the old filtering explode
- Seeded PRNG: the same repository always yields the same pull requests, so `dataHash` is stable and the smart reload stays quiet
- `parseFixtureOptions()` reads `--fixtures`, `--fixture-scale=N`, `--fixture-chain-depth=N` or the `PR_TREE_FIXTURES*` environment variables; `fixtureConfig()` replaces config.js; `createFixtureSource()` is what index.mjs calls instead of Atlassian

**public/app-shell.js**
- Banner and sidebar chrome, independent of pull-request data
- Sidebar toggle (button, `F` key), stored in `localStorage` under `prTree.sidebarHidden` for the wide layout; below 900px the sidebar is a drawer that always starts closed
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

### GET /api/pull-request-conflicts/:repoName/:spec
Checks for merge conflicts in a PR (cached 5 minutes).

**Parameters:**
- `repoName`: Repository slug
- `spec`: Bitbucket diff spec (e.g., "sourceBranch..destBranch")

**Response:**
```json
{
  "conflicts": true
}
```

### GET /api/sync-statuses/:project
Returns the SYNC (conflicts) status of every open PR of a project in a single response (cached 5 minutes). Only called by the frontend when the user clicks the load button next to the SYNC filter — never automatically.

**Response:**
```json
{
  "lastRefreshTime": "2026-08-12T10:30:00.000Z",
  "rateLimited": false,
  "rateLimitedUntil": null,
  "statuses": {
    "repo-name/destHash..sourceHash": { "conflicts": true },
    "repo-name/otherDest..otherSource": { "error": true }
  }
}
```

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
let currentProject = null;
let currentSprints = [];        // sprint ids
let currentFixVersions = [];    // fix version ids
let currentAssignees = [];
let currentReviewers = [];
let currentSync = "Show all";
let currentReadyForReviewer = false;
let currentApiResult = null;
let currentSyncStatuses = null; // last /api/sync-statuses response, re-applied on re-render
```

State is synchronized with URL query parameters for deep linking:
```
?project=PROJ&author=John&reviewer=Jane&sprint=Sprint1&sync=requested&ready=true
```

Every filter pass goes through `applyFilters()` in app.js: it calls `filterBranches()` (app-filter.js), then updates the active-filter badge and the tab title. `renderEverything(apiResult)` receives the data from its caller and applies the filters once every filter control has been populated and restored from the URL.

### Filtering Architecture
Single pass in app-filter.js:
1. `initializeFilter(apiResult)` builds the index once per data load (Maps and Sets, no array search later)
2. `filterBranches()` collects the SYNC badges once, then walks repositories → root branches → direct child pull requests → their `.children` container, recursively; every pull request is visited exactly once
3. Children are evaluated first; a filtered-out parent stays displayed while a descendant is visible
4. Counters (repository, root branch, child counters shown) are summed on the way back up and written through `updateCounterDisplay`; DOM writes only happen when the value changes

Never re-select descendants (`querySelectorAll('.pull-request')`) inside the recursion: the previous implementation did, and a pull request at depth *d* was visited 2^d times (16 million visits per filter change on SECOLLAB).

## Development Workflows

### Initial Setup
1. Clone repository
2. Run `npm ci` (not `npm install` - uses package-lock.json exactly)
3. Copy `config.js.default` to `config.js`
4. Fill in Bitbucket credentials:
   - Username (e.g., `username_workspace`)
   - App Password (create at https://bitbucket.org/account/settings/app-passwords/)
   - Workspace slug
5. Fill in Jira credentials:
   - Site name (subdomain of atlassian.net)
   - Username (email)
   - API token (create at https://id.atlassian.com/manage-profile/security/api-tokens)
6. Update `projects.js` with your projects
7. Run `node index.mjs`
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
- **Unit tests**: `npm test` (node:test, pure logic and the fixture generator)
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
4. **URL Sync**: Update `updateUrlWithFilters()` and `restoreFiltersFromUrl()`
5. **Filter Logic**: Add the precomputed set to `buildFilterIndex()` and the match to `evaluatePullRequest()` in app-filter.js, with a unit test
6. **Event Handler**: Wire up filter change event

### Add New Jira Field
1. Modify `fetchJiraIssuesDetails()` in index.mjs
2. Update `fields` parameter in JQL query URL
3. Update frontend rendering to display new field
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

### Performance Optimization
- **Minimize API calls**: Use existing cached data when possible
- **Batch operations**: Jira issues fetched in batches of 50
- **Hash-based updates**: Commit counts only fetched when other data changes
- **Pagination handled**: Bitbucket PR fetching uses recursive pagination

### Common Pitfalls
1. **Module type mismatch**: Backend uses ES modules (.mjs), config uses CommonJS (module.exports)
2. **Cache staleness**: Remember that data can be up to 2 minutes old
3. **API rate limits**: Bitbucket can return HTTP 429 if too many requests
4. **Filter restoration**: SYNC and "ready for reviewer" filters NOT restored from URL (calculated async)
5. **Regex patterns**: Must match exact Jira issue key format in PR titles
6. **Colours**: never hard-code a colour in styles.css; add a token to both the `:root` and `:root[data-theme="dark"]` blocks
7. **Ready for reviewer**: computed by `computeAttention()` from the data, never from rendered styles
8. **Deep stacks**: SECOLLAB has a 24-deep stack of pull requests; anything recursive over the tree must visit each pull request once (see Filtering Architecture)
9. **`pullRequestsByDestination` is keyed by branch name across repositories**: two repositories sharing a branch name (e.g. `master`) share the entry; known limitation, not handled

### Testing Approach
- **Unit tests**: `npm test` runs `node:test` over `test/*.test.mjs` for the pure logic (`computeAttention`, `countActiveFilters`, `buildFilterIndex`, `evaluatePullRequest`, `buildDocumentTitle`) and the fixture generator (volumes, determinism, deep stack); no DOM, no extra dependency
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
- Bitbucket: Basic Auth with username and app password
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

**Last Updated**: 2025-11-14
**For**: AI Assistant usage (Claude, GPT, etc.)
**Maintained by**: Project contributors
