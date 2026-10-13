# Product Requirements Document (PRD)
## Bitbucket Pull-Requests Tree

**Version:** 3.0.0
**Last Updated:** 2026-10-11
**Author:** François-Régis Jaunatre
**Status:** Active Development

---

## 1. Product Overview

### 1.1 Product Name
Bitbucket Pull-Requests Tree

### 1.2 Product Vision
A unified dashboard that transforms pull request management by visualizing the complete workflow context—combining Bitbucket PRs with Jira issue tracking, sprint planning, and team collaboration status in a single, auto-refreshing view.

### 1.3 Product Description
Bitbucket Pull-Requests Tree is a web-based dashboard application designed for development teams using Bitbucket for code review and Jira for project management. It provides a comprehensive, hierarchical view of pull requests with integrated Jira issue tracking, enabling teams to understand PR status, dependencies, conflicts, and workflow bottlenecks at a glance.

### 1.4 Product Type
Internal developer tool / Self-hosted web application

---

## 2. Problem Statement

### 2.1 Current Challenges
Development teams using Bitbucket and Jira face several workflow inefficiencies:

1. **Context Switching**: Developers must navigate between Bitbucket, Jira, and sprint boards to understand work status
2. **Lack of Visibility**: No unified view of PR relationships, dependencies, and merge conflicts
3. **Manual Tracking**: Teams manually track which PRs need attention, which are blocked, and which are ready for review
4. **Stale Information**: Static pages require manual refreshing to see updates
5. **Sprint Disconnection**: Difficult to see which PRs are associated with current sprint work
6. **Orphaned Work**: Issues marked "In Review" without corresponding PRs go unnoticed
7. **Review Bottlenecks**: Hard to identify where code reviews are blocked or delayed

### 2.2 Impact
- Reduced team productivity due to information fragmentation
- Delayed code reviews and merge operations
- Increased context-switching overhead
- Missed deadlines due to lack of workflow visibility
- Poor sprint planning due to unclear PR status

---

## 3. Target Users

### 3.1 Primary Users
- **Software Developers**: Need to track their PRs, see review status, and identify conflicts
- **Team Leads**: Monitor team progress, identify bottlenecks, and ensure sprint completion
- **Code Reviewers**: Find PRs requiring review and prioritize work

### 3.2 User Characteristics
- Familiar with Git, Bitbucket, and Jira workflows
- Work in agile/scrum teams with sprint-based planning
- Manage multiple repositories and projects simultaneously
- Need rapid access to PR and issue status throughout the workday

### 3.3 User Environment
- Desktop/laptop browsers (Chrome, Firefox, Edge, Safari)
- Corporate network access to Bitbucket and Jira instances
- Running Node.js application on localhost or internal server

---

## 4. Goals and Objectives

### 4.1 Business Goals
1. **Reduce context-switching time** by 50% through unified view
2. **Accelerate code review cycle** by improving visibility of review-ready PRs
3. **Improve sprint predictability** by tracking PR status against sprint goals
4. **Minimize merge conflicts** through early detection and visualization

### 4.2 User Goals
1. Quickly assess all PRs requiring their attention (as author or reviewer)
2. Understand PR relationships and dependencies
3. Identify and resolve merge conflicts proactively
4. Track sprint progress through associated PRs
5. Avoid redundant API calls and slow page loads

### 4.3 Technical Goals
1. Minimize API load on Bitbucket and Jira through intelligent caching
2. Provide real-time updates without manual page refresh
3. Maintain sub-2-second initial page load time
4. Support multiple projects with independent configurations

---

## 5. Functional Requirements

### 5.1 Core Features

#### F1: Multi-Project Management
**Priority:** P0 (Must Have)
**Description:** Support multiple independent project configurations with easy switching

**Requirements:**
- F1.1: Display project selector dropdown with all configured projects
- F1.2: Load project-specific PRs, repositories, and Jira settings
- F1.3: Persist selected project in URL for deep linking
- F1.4: Support project-specific Jira regex patterns for issue extraction

**Acceptance Criteria:**
- User can select any configured project from dropdown
- Project selection loads correct PRs and issues within 2 seconds
- URL updates to include selected project
- Reloading page preserves project selection

---

#### F2: Pull Request Visualization
**Priority:** P0 (Must Have)
**Description:** Display all pull requests with hierarchical relationships and status

**Requirements:**
- F2.1: List all PRs ordered by most recently updated (descending)
- F2.2: Display PR hierarchy showing branch relationships
- F2.3: Show PR status (open, approved, conflicts, etc.)
- F2.4: Display commit ahead/behind counts relative to destination branch
- F2.5: Show associated Jira issues with status badges
- F2.6: Indicate when PR has conflicts with parent branch
- F2.7: Mark draft pull requests with a "Draft" badge and show the number of open tasks of a pull request
- F2.8: Walk the tree from the keyboard: ↓ / `j` and ↑ / `k` select the next and previous row shown (each root-branch header, the pull requests under it, then orphaned issues), → unfolds the selected branch or stack or selects its first pull request, ← folds it or selects its parent (a root pull request's branch header), `o` opens the selected row, `i` its first Jira issue, Enter or Space fold or unfold the focused row's stack, `x` goes back to the root of the stack and folds it; ignored while typing, in an open filter list or with the help open
- F2.9: One row is selected whenever a row is shown, the one the URL names (`selected`) when it is shown, the first pull request otherwise; a selection by the user (a key, a click, Tab) replaces the URL entry, a refresh or a filter change never writes it; a load and Back/Forward scroll the selected row into view
- F2.10: The folded repositories, root branches and stacked pull requests of a project are kept by the browser (localStorage, per project, never the URL) and restored at the project's first render (page load, reopened tab, project switch); written after each user fold (click, key, Collapse all, Expand all), the pull requests no longer rendered pruned after every render; a selected row a fold hides gives way to the row in sight that folds it

**Acceptance Criteria:**
- PRs appear in chronological order by update time
- Parent-child PR relationships are visually evident
- Green badges show commits ahead, red badges show commits behind
- "SYNC" badge appears on PRs that have conflicts with their parent branch
- Jira issue links are clickable and show status color-coding

---

#### F3: Jira Integration
**Priority:** P0 (Must Have)
**Description:** Extract and display Jira issue information from PR titles and track workflow status

**Requirements:**
- F3.1: Extract Jira issue keys from PR titles using configurable regex
- F3.2: Fetch issue details from Jira API (summary, status, priority)
- F3.3: Display issue status with color-coded badges
- F3.4: Show issue priority icons
- F3.5: Provide direct links to Jira issues
- F3.6: Detect orphaned issues (In Review status without PRs)
- F3.7: Support Jira workflow integration with "In Review" and "In Progress" statuses
- F3.8: Fetch the parent of linked issues, and the summary, type and parent of parent issues, so that sub-tasks reach their story and epic
- F3.9: Fetch the Jira approvers of the orphaned issues and who approved (two custom fields named in config.js, `approversField` and `approvedByField`), show them like the reviewers of a pull request, and keep an orphaned issue for its approvers: reviews without a pull request (documentation, Xray tests)

**Workflow Context:**
The application integrates with a Jira workflow where:
- Issues transition to "In Review" status when ready for code review
- A commit hook automatically transitions issues from "In Review" back to "In Progress" when a reviewer requests changes
- This creates a feedback loop: In Review → Changes Requested → In Progress → Fixed → In Review

**Acceptance Criteria:**
- All Jira issue keys in PR titles are identified and linked
- Issue status badges match Jira workflow states (In Review, In Progress, Resolved, Closed)
- PRs associated with "In Review" issues are visually distinguished
- Clicking issue link opens Jira in new tab
- Orphaned issues appear in separate section with warning styling

---

#### F4: Advanced Filtering
**Priority:** P0 (Must Have)
**Description:** Multi-criteria filtering to focus on relevant PRs

**Requirements:**
- F4.1: Filter by participant: the assignees of the linked and orphaned Jira issues, the reviewers of the pull requests and the Jira approvers of the orphaned issues, one multi-select
- F4.2: Filter by work, with participants selected: "All work" (the default) keeps every pull request they review or have a linked issue assigned to, "All reviews" and "All issues" one kind only; "Ready for participants" only the pull requests waiting for them as reviewers or as assignees, "Ready for reviewers" and "Ready for assignees" one kind only
- F4.3: Filter by sprint (based on associated Jira issues)
- F4.4: Filter by SYNC status (SYNC required / SYNC ok / Not checked), once the statuses are loaded
- F4.5: "Ready for reviewers" shows only PRs where:
  - Associated Jira issue has "In Review" status
  - AND a selected participant reviews the PR and has not yet approved (indicated by red highlighting/action required)
  - AND the PR is not a draft (its author wants no review yet)
  - This identifies PRs awaiting initial review or re-review after changes
- F4.6: Filter by Jira fixVersion
- F4.7: Support simultaneous multiple filters
- F4.8: Maintain filter state in URL parameters
- F4.9: Hierarchical filtering (preserve parent-child relationships)
- F4.10: Filter by text: title, source branch name and linked issue keys must contain every word typed
- F4.11: Filter by epic (the epic above the linked issues, through the parent story for sub-tasks)
- F4.12: Filter by story (the linked issue, or the parent of a linked sub-task)
- F4.13: "Ready for assignees" shows only the pull requests with a linked issue assigned to a selected participant that are In Progress, or In Review with open tasks (the tasks wait for the assignee, usually the author); "Ready for participants" keeps the pull requests needing either attention
- F4.14: Hide the repositories and branches left without a matching pull request; show a message when no pull request matches
- F4.15: Back and Forward restore the filters and the project the URL describes; one history entry per user action
- F4.16: "Hide drafts" hides the draft pull requests, with or without participants selected
- F4.17: The participant and work filters keep an orphaned issue as they keep a pull request, its Jira approvers being its reviewers (whoever approved included) and its assignee its assignee; it waits for its approvers who have not approved, and for its assignee once nobody is pending

**Acceptance Criteria:**
- Each filter shows "Show all" option plus all available values
- Applying filters hides non-matching PRs instantly
- Filtered counters update to show X of Y PRs visible
- URL updates with all filter selections
- Sharing URL restores all filters (except SYNC, whose statuses are loaded on demand)
- PRs highlighted in red when action required from a selected participant
- Parent PRs remain visible if any children match filter
- The "Ready for reviewers" value correctly identifies PRs in "In Review" status needing a selected participant's review

---

#### F5: Smart Auto-Refresh
**Priority:** P1 (Should Have)
**Description:** Automatic data updates without full page reload

**Requirements:**
- F5.1: Check for data updates every 2 minutes
- F5.2: Only re-render UI if data has changed (hash-based detection)
- F5.3: Show loading indicator during update check
- F5.4: Display last refresh timestamp
- F5.5: Pause updates when tab is inactive
- F5.6: Trigger refresh when tab becomes active
- F5.7: Prevent concurrent update checks
- F5.8: A tab running an earlier page than the server serves (the `X-Page-Build` header of the `/api` answers) reads no more answers and offers a reload in the banner

**Acceptance Criteria:**
- Page automatically updates every 2 minutes when active
- No visible UI update if data unchanged
- A refresh never rewrites the URL: a filter value the refreshed data no longer offers leaves the sidebar but stays in the URL, and comes back when a later refresh offers it again, unless a user action (filter change, search, project load, Back/Forward) rewrote the URL meanwhile
- Data a Jira failure left partial (no epics and stories, or missing sprints) is flagged "Partial data" in the banner, is cached 30 seconds only, and a project load or Back/Forward over it keeps the URL values of the filters the gap feeds (Epic, Story, Fix version; Sprint), so the next complete render restores the values it lacked
- Refresh timestamp updates in real-time
- Loading spinner appears during checks
- No updates occur when tab in background
- Selecting tab triggers immediate update check
- After a server upgrade that changed the page, an open tab shows "Reload: dashboard updated" at its next check, project load or SYNC load instead of rendering the new answers; the reload keeps the project and the filters

---

#### F6: Conflict Detection
**Priority:** P1 (Should Have)
**Description:** Identify and display merge conflicts

**Requirements:**
- F6.1: Decide conflicts with the destination branch from Bitbucket's diffs of both sides since the merge base, with git's rule (the same result on both sides merging cleanly, overlapping or adjacent changes with different content, modify/delete, different renames, binaries, a file against a directory at the same path, files added on both sides with different modes); no file content is fetched
- F6.2: Display a badge on each pull request once the statuses are loaded: OK, SYNC (possibly partial: the listed files conflict for sure, others could not be checked, with the reason in the tooltip), or ? with the reason it could not be checked
- F6.3: Keep the results across restarts (`sync-cache.json`); a result never changes for a pair of commits, so only the pull requests whose commits moved are computed again; the file is written durably (synced to the disk before it replaces the previous one), so a crash or a power loss during a save leaves the previous results, never an empty file
- F6.4: Load on demand only (the SYNC load button), never automatically

**Acceptance Criteria:**
- PRs with conflicts show a red SYNC badge, PRs without conflicts a green OK badge
- Hovering the SYNC badge lists the conflicting files; hovering a ? badge shows the reason
- A load of the largest project (about 110 pull requests) stays under Bitbucket's hourly request limit and never blocks the server

---

#### F7: Preview Popovers
**Priority:** P2 (Nice to Have)
**Description:** Show PR and issue details on hover

**Requirements:**
- F7.1: Display PR title and description in popover on hover
- F7.2: Display Jira issue summary and description on hover
- F7.3: Format markdown content appropriately
- F7.4: Show popovers with minimal delay (<500ms)

**Acceptance Criteria:**
- Hovering PR title shows popover with description
- Hovering issue key shows popover with issue details
- Popover appears within 500ms of hover
- Popover disappears when mouse leaves

---

#### F8: Sprint Integration
**Priority:** P1 (Should Have)
**Description:** Associate PRs with active sprints

**Requirements:**
- F8.1: Fetch all active sprints from Jira boards
- F8.2: Identify issues assigned to each sprint
- F8.3: Associate PRs with sprints via linked issues
- F8.4: Provide sprint filter dropdown
- F8.5: Sprints are fetched and cached with the project data (no separate cache)

**Acceptance Criteria:**
- Sprint filter populated with all active sprints
- Selecting sprint shows only PRs with issues in that sprint
- Sprint data refreshes every 10 minutes
- PRs without sprint association hidden when sprint filter active

---

#### F9: Online Help
**Priority:** P2 (Nice to Have)
**Description:** In-app documentation

**Requirements:**
- F9.1: Display README.md content in modal overlay
- F9.2: Render markdown with proper formatting
- F9.3: Provide help button in header
- F9.4: Close help with X button or outside click

**Acceptance Criteria:**
- Clicking "?" icon opens help modal
- Help content matches README.md
- Modal scrollable for long content
- Clicking outside modal closes it

---

### 5.2 Feature Priority Matrix

| Feature | Priority | Release |
|---------|----------|---------|
| Multi-Project Management | P0 | v1.1 |
| Pull Request Visualization | P0 | v1.0 |
| Jira Integration | P0 | v1.0 |
| Author/Reviewer Filtering | P0 | v1.0 |
| Smart Auto-Refresh | P1 | v1.3 |
| Sprint Integration | P1 | v1.6 |
| Conflict Detection | P1 | v1.5 |
| Sync Status Indicator | P1 | v1.7 |
| fixVersion Filtering | P1 | v1.12 |
| URL Filter Persistence | P1 | v1.6.2 |
| Preview Popovers | P2 | v1.6 |
| Online Help | P2 | v1.6 |
| Orphaned Issues Detection | P1 | v1.10 |
| Server-Side Caching | P0 | v1.11 |

---

## 6. Non-Functional Requirements

### 6.1 Performance
- **NFR-P1**: Initial page load must complete within 2 seconds on standard developer workstation
- **NFR-P2**: Filter operations must complete within 200ms
- **NFR-P3**: Auto-refresh checks must complete within 1 second when data unchanged
- **NFR-P4**: Server-side cache must reduce API call frequency by 80%
- **NFR-P5**: Support up to 500 concurrent pull requests without performance degradation

### 6.2 Reliability
- **NFR-R1**: Application must handle API failures gracefully with error messages
- **NFR-R2**: Cache must persist for configured TTL without premature expiration
- **NFR-R3**: Application must not crash on malformed API responses
- **NFR-R4**: Logs must capture all errors for debugging

### 6.3 Usability
- **NFR-U1**: User must be able to apply any filter within 2 clicks
- **NFR-U2**: Visual feedback required for all user actions within 100ms
- **NFR-U3**: Color-coding must be consistent across all status indicators
- **NFR-U4**: UI must remain responsive during background data fetching
- **NFR-U5**: Everything works from the keyboard with a visible focus: every control keeps the 2px `:focus-visible` outline (3:1 or more against what surrounds it, in the banner too); the help is a modal dialog that takes the focus and gives it back; a multi-select opens with ArrowDown, walks its search box and checkboxes with the arrows, closes on Escape from any of its controls and when the focus leaves it; every button and link showing only an icon is named (`aria-label`), its icons hidden from screen readers

### 6.4 Scalability
- **NFR-S1**: Support up to 50 repositories per project
- **NFR-S2**: Support up to 10 concurrent users on single server instance
- **NFR-S3**: Cache must handle up to 10,000 cached entries efficiently

### 6.5 Security
- **NFR-SEC1**: API credentials must never be exposed to client browser
- **NFR-SEC2**: Configuration file with credentials must be git-ignored
- **NFR-SEC3**: Application must use HTTPS when deployed outside localhost
- **NFR-SEC4**: No sensitive data logged to access/error logs
- **NFR-SEC5**: Only the `public/` directory and `README.md` are served over HTTP; no other file of the project directory (configuration, logs, sources) is reachable
- **NFR-SEC6**: The server listens on the loopback addresses (127.0.0.1 and ::1) unless `PR_TREE_HOST` opens another one; it answers only requests whose `Host` is one of its own names (loopback names, the bound address, `PR_TREE_ALLOWED_HOSTS`), and refuses the `/api` requests a browser marks as sent by another site or by another port of the same host (`Sec-Fetch-Site: cross-site` or `same-site`)
- **NFR-SEC7**: Every Bitbucket and Jira text, and every project name, reaches the page as text: through `escapeHtml` (`public/escape-html.js`, the one escape of the tree and of the filter options), `textContent` or DOM nodes. Only README.md and Bitbucket's rendered pull-request title and description are shown as HTML. The page loads no script, stylesheet or font from another origin (the libraries are vendored in `public/vendor/`); images do come from other origins: avatars and priority icons from Atlassian, and whatever a pull-request description shows
- **NFR-SEC8**: Every answer of the app carries a Content-Security-Policy that allows scripts, stylesheets, fonts and requests from the dashboard itself only (no inline script, no `<style>` element, no eval; `style=` attributes are allowed, for the tables of Bitbucket's rendered descriptions), images from itself, `https:` and `data:`, and no plugin, `<base>`, form or framing; plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`; no `X-Powered-By`. Express's own error pages keep its stricter `default-src 'none'`

### 6.6 Maintainability
- **NFR-M1**: Code must follow consistent naming conventions (camelCase)
- **NFR-M2**: All API endpoints must have error handling with logging
- **NFR-M3**: Configuration must be externalized from code
- **NFR-M4**: Adding new project must not require code changes

### 6.7 Compatibility
- **NFR-C1**: Support Chrome, Firefox, Edge, Safari (latest 2 versions)
- **NFR-C2**: Require Node.js 20.11+ for server runtime (22.5+ for the coverage report)
- **NFR-C3**: Compatible with Bitbucket API v2.0
- **NFR-C4**: Compatible with Jira API v3 and Agile API v1.0

---

## 7. Technical Requirements

### 7.1 Architecture
**Pattern:** Client-server with RESTful API

**Components:**
1. **Express Server** (index.mjs)
   - API endpoint routing
   - Bitbucket/Jira API integration (the fetchers in project-data.mjs, the pure post-processing in project-assembly.mjs, shared with the fixtures; the SYNC computation in sync-statuses.mjs, the conflict rule in conflicts.mjs)
   - Every Atlassian request through one wrapper (atlassian-fetch.mjs): a 429 from either API pauses all requests for 10 minutes
   - Server-side caching layer
   - Static file serving
   - Logging infrastructure

2. **Cache Layer** (cache.mjs)
   - In-memory caching with node-cache
   - Configurable TTL per data type, raised to cover a rate-limit pause
   - Conflict results on disk (sync-cache.mjs, `sync-cache.json`)
   - Cache statistics endpoint

3. **Frontend** (public/)
   - Single-page application (vanilla JS)
   - State management and wiring in app.js
   - Tree rendering in app-render.js (pure HTML strings, unit-tested)
   - SYNC status loading and controls in app-sync.js
   - URL parameters in app-url.js, banner, sidebar, theme, help and shortcuts in app-shell.js, the multi-select component in multi-select.js
   - Filtering logic in app-filter.js (index built per data load, single pass over the tree, nothing read back from the rendered tree)
   - Filter registry in filter-registry.js (the multi-selects and the single-value filters: state key, element, URL parameter, default), the status band of a pull request in pull-request-status.js
   - Tree toggles and the pane's click handler in tree-toggle.js, the tree keys in tree-keyboard.js
   - Counter display in counter-utils.js

4. **Fixtures** (fixtures/)
   - Generated data modelled on the real projects, served by `node index.mjs --fixtures` without Atlassian access
   - Used for UI work and performance checks

### 7.2 Technology Stack

#### Backend
- **Runtime:** Node.js 20.11 or later (ES Modules)
- **Framework:** Express.js v5.2.1
- **HTTP Client:** the `fetch` built into Node.js 20.11 or later
- **Caching:** node-cache v5.1.2
- **Tests:** node:test (no test dependency)

#### Frontend
- **Core:** HTML5, CSS3, Vanilla JavaScript (ES6)
- **Icons:** Font Awesome Free (vendored in `public/vendor/`)
- **Markdown:** Marked.js (vendored in `public/vendor/`, loaded when the help modal opens)

#### External APIs
- Bitbucket API v2.0 (REST)
- Jira API v3 (REST)
- Jira Agile API v1.0 (REST)

### 7.3 Data Model

#### Project Configuration
```javascript
{
  projectName: {
    repositories: ['repo-slug-1', 'repo-slug-2'],
    jiraProjects: ['PROJ1', 'PROJ2'],
    jiraRegex: /(PROJ1-\d+|PROJ2-\d+)/g
  }
}
```

#### API Response Structure
```javascript
{
  lastRefreshTime: "ISO-8601 timestamp",
  pullRequests: [/* PR objects */],
  jiraIssuesMap: {/* "repository/PR ID" -> Issue Keys (ids are numbered per repository) */},
  jiraIssuesDetails: [/* Full issue objects, the parents fetched appended */],
  jiraSiteName: "string",
  sprints: [/* Active sprint objects */],
  sprintIssues: {/* Sprint ID -> Issue Keys */},
  orphanedIssues: [/* Issues without PRs, fields.approvers and fields.approvedBy renamed from the configured custom fields */],
  dataHash: "MD5 hash"
}
```

### 7.4 Caching Strategy

**Cache TTLs:**
- Project data: 120 seconds
- Projects list: 300 seconds
- Conflicts: kept on disk (`sync-cache.json`) across restarts; a result older than 90 days, or computed under another version of the conflict rule, is dropped the next time the file is written
- SYNC statuses: the response is kept only when built during a rate-limit pause, until the pause ends; otherwise each load computes again (a load asked for while one runs shares it), each pull request's result read from `sync-cache.json` first
- `sync-cache.json` keeps the complete results and the ones with too many files to check (they depend on the commits alone); a failure, or a result partial after a failure, is computed again at the next load
- Everything else is in memory and lost on restart

**Shared Builds:**
- Concurrent requests for an entry being built (project data, SYNC statuses, projects list) share the build in flight; a failure is not cached

**Hash-Based Change Detection:**
- Compute MD5 hash of PR (with their commit counts) + Jira data; the page re-renders only when it changes
- The commit counts of a pull request are fetched only when its source or destination commit moves (remembered per project from its last build), at most 10 requests at once
- Prevents Bitbucket API rate limiting (HTTP 429)

**Rate-Limit Pause:**
- After an HTTP 429 from Bitbucket or Jira, no request is sent to Atlassian until 10 minutes after the last 429
- Every cache TTL is raised to cover the pause, so cached data keeps being served; responses built during the pause carry `rateLimited: true`
- The page shows the pause: a project load refused with a 503 says until when instead of a generic failure, the banner shows "Paused until HH:MM" while the tree is the data cached before the pause, the periodic checks send nothing until the end of the pause and one check runs just after it

### 7.5 API Endpoints

| Endpoint | Method | Cache TTL | Description |
|----------|--------|-----------|-------------|
| `/api/version` | GET | None | Application version metadata |
| `/api/projects` | GET | 300s | List of configured projects |
| `/api/pull-requests/:project` | GET | 120s (30s with `incomplete`) | Comprehensive project data; `incomplete` names the parts a tolerated Jira failure left out (`parents`, `sprints`) |
| `/api/sync-statuses/:project` | GET | none (until the end of a rate-limit pause) | SYNC (conflict) status of every open pull request, loaded on demand; `stopped` is the reason the load was stopped after Bitbucket failed for 8 pull requests in a row (timeouts, network failures, unreadable answers, 5xx, 401, 403), `null` otherwise |
| `/api/cache/stats` | GET | None | Cache performance statistics |

During a rate-limit pause, `/api/pull-requests/:project` answers 503 with `rateLimitedUntil` when nothing is cached (`null` when the pause ended while the build waited), and its cached data with `rateLimitedUntil` otherwise (`null` outside a pause), and `/api/sync-statuses/:project` answers with `rateLimited: true` and `rateLimitedUntil`. An unknown project gets a 404 with `{ error: 'Project not found' }` from both.

Every `/api` answer carries `X-Page-Build`: a hash of the files of `public/` computed at start-up, so a tab running an earlier page knows it must be reloaded (F5.8).

Every route answers 403 with `{ error }` to a `Host` that is not a name of the server, and every `/api` route to a request with `Sec-Fetch-Site: cross-site` or `same-site` (NFR-SEC6).

### 7.6 Logging Infrastructure

**Log Files:**
- `access.log`: Request logs (timestamp, method, path, IP) of the API and the requests no file answers (the files of `public/` are not logged), startup and shutdown
- `error.log`: Error messages (failed API calls, HTTP 429 received, refused requests)
- `performance.log`: Operation duration metrics

**Rotation and failures:** each line is appended to its file at once (nothing lost when the server stops); each file is rotated at 10 MB (`access.log.1` to `.3` kept, the oldest dropped); a file that cannot be written is reported on the console and tried again a minute later, it never stops the server

**Log Format:**
```
YYYY-MM-DDTHH:mm:ss.sssZ - Message
```

---

## 8. User Interface Requirements

### 8.1 Layout Structure
```
+------------------------------------------------------------------+
| Banner: ☰ | App name | Project ▾ | Last refresh | ☾ | ? | GitHub | v |
+----------------+-------------------------------------------------+
| Filters  Clear | [Collapse all] [Expand all]                     |
|  Search        |                                                 |
|  Sprint        | Repository 1                          [X / Y]   |
|  Fix version   |   Branch A                            [X / Y]   |
|  Epic          |                                                 |
|  Story         |                                                 |
|  Participants  |     PR #1 [SYNC] [Ahead:3] [Behind:1]           |
|  Work          |                                                 |
|                |       JIRA-123 [In Progress]                    |
|                |     PR #2                                       |
|  SYNC + Load   |   Branch B                            [X / Y]   |
|                |     PR #3 [Ahead:2]                             |
| (does not      | Orphaned Issues                                 |
|  scroll)       |   JIRA-456 [In Review] - Issue Summary          |
+----------------+-------------------------------------------------+
```

### 8.2 Visual Design Requirements

#### Color Coding
- **Green**: Commits ahead, positive status, SYNC OK
- **Red**: Commits behind, action required, conflicts, blocking issues, SYNC required
- **Blue**: Informational badges, the in-review status band
- **Purple**: The resolved status band (every linked issue resolved or closed; a pull request without a linked issue has no band)
- **Yellow**: Priority indicators
- **Gray**: Neutral/inactive state, SYNC not checked
- Status text, status icons and the fills under white (dark-theme: dark) text, such as the OK, SYNC and `?`/`!` badges and the active-filter count, use "strong" status colours whose contrast with the surface and with that text is at least 4.5:1 (WCAG AA) in both themes; the plain status colours are kept for borders
- The status border of a card (in progress, in review, all approved, resolved) and the border of its warnings box reach 3:1 (WCAG 1.4.11) against the colours on both sides in both themes; the in-progress and all-approved bands, and the in-review and resolved bands, also differ in lightness, not only in hue; resolved is purple, in review blue

#### Status Badges
- Rounded corners with 4px radius
- Consistent padding (4px horizontal, 2px vertical)
- Font size: 12px
- Badges clustered on same line

#### Hierarchy Indicators
- Indentation: 20px per level
- Connection lines for parent-child relationships
- Collapsible sections for repositories/branches

### 8.3 Responsive Behavior
- Desktop-first: the banner and the filter sidebar stay fixed while the pull-request pane scrolls
- The sidebar can be hidden (button or `F` key); the state is remembered per browser
- Below 900px the sidebar becomes a drawer over the pane and the banner hides its text labels
- Repository and branch headers stick to the top of the pane while scrolling
- Modal dialog for help content (focus moved in and back, page behind inert, Escape closes)
- Light and dark themes, following the OS setting until the toggle picks the other theme; picking the OS's theme again follows the OS again

### 8.4 Interactive Elements

**Filter Dropdowns:**
- Show all options alphabetically
- "Show all" as first option
- Highlight selected value
- Auto-close on selection

**Hover States:**
- Underline on links
- Brightness increase on buttons
- Popover preview on PR/issue titles (500ms delay)

**Loading States:**
- Spinner icon during refresh checks
- Disabled filter dropdowns during initial load
- Skeleton placeholders for PR list

---

## 9. Success Metrics

### 9.1 Adoption Metrics
- **Daily Active Users**: Target 80% of development team
- **Session Duration**: Average 30+ minutes per session
- **Return Rate**: 90% of users return within 24 hours

### 9.2 Performance Metrics
- **Page Load Time**: 95th percentile < 2 seconds
- **Cache Hit Rate**: > 70% of API requests served from cache
- **Auto-Refresh Efficiency**: < 1 second for no-change checks
- **Filter Response Time**: < 200ms for all filter operations

### 9.3 Usage Metrics
- **Filters Used per Session**: Average 2-3 filters applied
- **URL Shares**: 20% of sessions initiated from shared URLs
- **Help Access**: < 10% of sessions require help (indicates good usability)

### 9.4 Business Impact Metrics
- **Code Review Cycle Time**: Reduce by 30% (measured via Bitbucket data)
- **Context Switching**: Reduce Jira/Bitbucket tab switches by 50%
- **PR Merge Time**: Reduce time from creation to merge by 20%
- **Conflict Resolution**: Detect conflicts 50% earlier (before review complete)

---

## 10. Future Roadmap

### 10.1 Planned Features (Next 6 Months)

#### Phase 1: Enhanced Notifications
- Browser notifications for PRs requiring action
- Email digest of daily PR status
- Slack integration for team updates

#### Phase 2: Advanced Analytics
- PR velocity charts (time to merge trends)
- Reviewer workload distribution
- Sprint burndown with PR completion tracking
- Team performance dashboards

#### Phase 3: GitHub Support
- Dual Bitbucket/GitHub support
- Unified view across both platforms
- GitHub Actions integration

#### Phase 4: Collaboration Features
- PR comment integration
- Direct actions (approve, merge) from dashboard
- @mention notifications
- Team chat integration

### 10.2 Technical Improvements

#### Short Term
- Automated testing suite (Jest + testing-library)
- TypeScript migration for type safety
- WebSocket for real-time updates
- Database persistence (PostgreSQL/MongoDB)

#### Medium Term
- Docker containerization
- OAuth authentication (replace Basic Auth)
- Multi-user support with personalized views
- Mobile-responsive design
- Progressive Web App (PWA) capabilities

#### Long Term
- GitLab support
- Azure DevOps integration
- Self-service configuration UI (replace config files)
- API for third-party integrations
- Plugin architecture for extensibility

### 10.3 Potential Enhancements
- AI-powered PR recommendations
- Automated conflict resolution suggestions
- Code review assignment optimization
- Merge risk prediction
- Technical debt tracking integration

---

## 11. Dependencies and Constraints

### 11.1 External Dependencies

**Critical:**
- Bitbucket Cloud/Server instance (API v2.0)
- Jira Cloud/Server instance (API v3)
- Network connectivity to both services

No CDN: Font Awesome and Marked.js are vendored in `public/vendor/`.

### 11.2 Technical Constraints
- **Single-User Application**: No multi-user authentication/authorization
- **In-Memory Cache**: Lost on server restart, except the conflict results (`sync-cache.json`)
- **Localhost Deployment**: Not designed for production internet deployment
- **No HTTPS**: Security concerns for remote deployment
- **API Rate Limits**: Bitbucket/Jira rate limiting affects refresh frequency
- **Synchronous Processing**: No background job queue for long operations

### 11.3 Organizational Constraints
- **Internal Use Only**: Not licensed for external distribution
- **Developer Workstation Target**: Corporate network access required
- **Manual Installation**: No automated deployment pipeline
- **Self-Service Support**: No dedicated support team

### 11.4 Data Constraints
- **No Historical Data**: Only current state, no time-series storage
- **No Data Export**: Cannot export reports or analytics
- **Cache Limitations**: Max cache size determined by available memory

---

## 12. Out of Scope

The following are explicitly **not** part of current requirements:

### 12.1 Features
- Mobile application (native iOS/Android)
- Public SaaS offering
- User authentication system
- Role-based access control
- PR merge/approve actions directly from dashboard
- Inline code review
- Build/CI pipeline integration
- Automated PR assignment
- Machine learning recommendations

### 12.2 Platforms
- GitHub (not currently supported)
- GitLab (not currently supported)
- Azure DevOps (not currently supported)
- Other issue trackers (Asana, Monday, etc.)

### 12.3 Technical
- Automated testing framework
- Continuous integration/deployment
- Database persistence
- Load balancing/horizontal scaling
- API for external integrations
- Webhooks for event-driven updates

### 12.4 Deployment
- Cloud hosting (AWS, Azure, GCP)
- Container orchestration (Kubernetes)
- Production monitoring/alerting
- Disaster recovery/backup
- Multi-region deployment

---

## 13. Risks and Mitigation

### 13.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Bitbucket API rate limiting | High | Medium | Implement aggressive caching, hash-based change detection |
| Jira API performance degradation | Medium | Low | Cache sprint data with the project data (2 minutes), batch issue fetches |
| Memory leak in long-running server | High | Low | Monitor memory usage, implement cache size limits |
| Breaking API changes from Atlassian | High | Low | Version pin APIs, monitor deprecation notices |
| Large PR volume causing timeout | Medium | Medium | Implement pagination, lazy loading |

### 13.2 Operational Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Credential exposure | High | Low | Git-ignore config.js, use environment variables |
| Server downtime affecting team | Medium | Low | Document manual Bitbucket/Jira workflow fallback |
| Configuration errors breaking app | Medium | Medium | Provide config.js.default template, validation on startup |

### 13.3 User Experience Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Slow load times frustrating users | High | Medium | Performance budget enforcement, caching strategy |
| Filter complexity overwhelming new users | Medium | Medium | Provide online help, smart defaults, tooltips |
| Stale data misleading users | Medium | Low | Show last refresh time prominently, manual refresh button |

---

## 14. Compliance and Security

### 14.1 Data Privacy
- **No PII Storage**: Application does not store personal data
- **Credentials**: Stored locally in config.js (git-ignored)
- **API Tokens**: Never transmitted to client browser
- **Logging**: No sensitive data in logs (credentials, tokens, personal info)

### 14.2 Security Considerations
- **Authentication**: Basic Auth over HTTPS required for production
- **Authorization**: Inherits Bitbucket/Jira permissions of configured user
- **Input Validation**: Minimal (assumes trusted configuration)
- **XSS Protection**: Escaping, not sanitization (NFR-SEC7): anyone with Jira write access can put `<script>` in a summary, so every such text is escaped. Nothing is sanitized; two sources are shown as HTML as they come: README.md in the help modal (`marked.parse`), a file of this repository, and the popover's pull-request title and description, Bitbucket's rendering of Markdown that anyone who can open a pull request writes. The second is safe only as long as Bitbucket's renderer drops raw HTML and script links: an assumption about a third party, not checked by this application; the Content-Security-Policy (NFR-SEC8) contains a failure of it: a script, an inline event handler or a `javascript:` link in that HTML does not run
- **CSRF**: The `/api` requests a browser marks as sent by another site, or by another port of the same host, are refused (NFR-SEC6). They change no data of Bitbucket or Jira, but they do change the server's: a project load or a SYNC load spends the Atlassian quota (a 429 pauses every Atlassian request of the dashboard for 10 minutes), and a SYNC load writes `sync-cache.json`

### 14.3 Licensing
- **Copyright**: François-Régis Jaunatre
- **License Type**: Proprietary (not open source)
- **Usage Rights**: Internal use only
- **Dependencies**: All npm packages use permissive licenses (MIT/ISC)

---

## 15. Open Questions

### 15.1 Product Questions
- Should we support custom status workflows beyond standard Jira states?
- What is maximum acceptable auto-refresh interval?
- Should we persist user preferences (filter defaults, UI layout)?

### 15.2 Technical Questions
- Is WebSocket worth complexity for real-time updates?
- Should we implement database persistence for analytics?
- What is acceptable memory footprint for cache?

### 15.3 Deployment Questions
- Should we support Docker deployment out of the box?
- Is multi-user authentication a future requirement?
- Should we plan for cloud deployment?

---

## 16. Appendix

### 16.1 Glossary
- **PR**: Pull Request
- **Jira Issue**: Work item in Jira (story, bug, task, etc.)
- **Sprint**: Time-boxed iteration in agile methodology
- **fixVersion**: Jira field indicating target release version
- **In Review**: Jira issue status indicating code is ready for review
- **In Progress**: Jira issue status indicating active development work
- **Orphaned Issue**: Jira issue marked "In Review" without associated PR
- **Participant**: a person appearing as the assignee of a linked or orphaned Jira issue, as a reviewer of a pull request, or as a Jira approver of an orphaned issue
- **Ready for Reviewers**: PR with associated issue in "In Review" status that a selected participant has not approved yet, or orphaned issue a selected participant is a Jira approver of and has not approved yet
- **Ready for Assignees**: PR with an associated issue assigned to a selected participant, the issue "In Progress", or "In Review" with open tasks on the PR; or orphaned issue assigned to a selected participant whose Jira approvers, if any, have all approved
- **SYNC**: Indicator that PR branch has conflicts with its parent branch
- **Commit Ahead**: Number of commits in PR branch not in destination
- **Commit Behind**: Number of commits in destination not in PR branch

### 16.2 References
- Bitbucket API Documentation: https://developer.atlassian.com/cloud/bitbucket/rest/
- Jira REST API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- Jira Agile API: https://developer.atlassian.com/cloud/jira/software/rest/
- Node.js Documentation: https://nodejs.org/docs/
- Express.js Guide: https://expressjs.com/

### 16.3 Version History
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-18 | François-Régis Jaunatre | Initial PRD creation |
| 2.11.1 | 2026-10-10 | François-Régis Jaunatre | Header on the product version; architecture, stack, caching, endpoints and logs checked against the code |

---

**Document Status:** Maintained: the pull request that changes a requirement updates this document
