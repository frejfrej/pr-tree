# Collapse the repetition

**Date:** 2026-09-16
**Issue:** #42 (simplification review of 2026-09-10, third block)
**Target version:** 2.11.0 (the API response changes)
**Status:** Decided in an autonomous session, without a review round; the
issue was written against 2.5.x and each item is re-read against 2.10.3 in
section 2

## 1. Goal

The same five multi-select filters are listed by hand in many places, the
fixture generator re-implements the server's post-processing, the filter pass
reads its inputs back from the DOM, every pull request is serialized twice in
the API response, the same request options are repeated at every Atlassian
call, and the tree carries an inline `onclick` per header with three toggle
functions installed on `window`. One pull request, one commit per item, in
the order of the issue; every commit leaves `npm test` green.

## 2. The items, re-read against 2.10.3

1. **Filter registry.** Still true: `app.js` keeps eight state variables
   (`currentText`, `currentSprints`, `currentFixVersions`, `currentEpics`,
   `currentStories`, `currentParticipants`, `currentWork`, `currentSync`),
   spells the five multi-selects out in `multiSelectIds`, `readFilterControls`,
   `restoreFiltersFromUrl` and `renderEverything`; `app-url.js` repeats the
   list in `filtersFromUrl`, `urlWithFilters` and `filterUrlParams`;
   `app-filter.js` in `countActiveFilters` and `matchesIssueFilters`. (The
   assignee, reviewer and ready variables of the issue are gone since 2.8.0.)
2. **Generated multi-select markup.** Still true: `index.html` repeats the
   same 15-line dropdown five times.
3. **The index feeds every option list.** Still true: `buildFilterIndex`
   returns the epics, stories and participants; `populateSprintFilter` and
   `populateFixVersionFilter` in `app.js` recompute the sprints and fix
   versions from the raw data.
4. **Filter inputs read back from the DOM.** Still true: `filterPullRequest`
   reads `status-in-progress` / `status-in-review` from the classes the render
   wrote, `filterBranches` collects the painted SYNC badges, and
   `renderEverything` must paint the badges before the filters run.
5. **`pullRequestsByDestination` in the API response.** Still true, with
   pitfall 9 of CLAUDE.md (two repositories sharing a branch name share the
   entry).
6. **Assembly shared with the fixtures.** Still true: `fixtures/generate.mjs`
   has its own `extractJiraIssues`, issue map, parent lookup, fix-version
   inheritance, destination map and `calculateHash`; the server's are in
   `project-data.mjs` (`createJiraIssuesMap`, `completeParents`,
   `fillPullRequestsMap`, `calculateHash`).
7. **One helper per Atlassian API.** The fetchers moved from `index.mjs` to
   `project-data.mjs` in 2.7.1, and the `{ method, headers }` block is still
   repeated at its seven `fetch` calls; `fetchPullRequests` is still
   recursive.
8. **One delegated click listener.** Still true: `app-render.js` writes
   `onclick="toggleRepository(this)"`, `onclick="toggleRootBranch(this)"`,
   `onclick="toggleChildren(this)"` and `onclick="event.stopPropagation();"`,
   and `app.js` installs the three toggle functions on `window`.

## 3. Decisions

### 3.1 Filter registry (item 1)

- A new pure module `public/filter-registry.js` exports
  `multiSelectFilters`, the five multi-selects in sidebar order, each
  `{ key, elementId, urlParam }`:
  `sprints`/`sprintSelect`/`sprint`, `fixVersions`/`fixVersionSelect`/`fixVersion`,
  `epics`/`epicSelect`/`epic`, `stories`/`storySelect`/`story`,
  `participants`/`participantSelect`/`participant`; and `defaultFilters()`,
  the filters object at its defaults: `text: ''`, `work: 'all'`,
  `sync: 'Show all'` and an empty array per registry key. The `key` is at
  once the property of the filters object, the property of the filter index
  that holds the option list of the filter (item 3), and the set of an index
  entry the evaluation compares (participants excepted, see below).
- `app.js` keeps one `filters` object in that shape instead of the eight
  variables; `currentFilters()` disappears, the object is passed to
  `filterBranches`, `countActiveFilters` and `urlWithFilters` as it is.
  `readFilterControls`, `restoreFiltersFromUrl`, `resetFilterControls`,
  `clearFilterOptions` and `initializeMultiSelects` loop over the registry.
- `app-url.js`: `filterUrlParams` is built from the registry (`q`, the
  registry parameters in order, `work`, `sync`, then the former people
  parameters, still removed when writing); `filtersFromUrl` starts from
  `defaultFilters()` and loops; `urlWithFilters` loops. The parameters keep
  their order in the URL, so every existing URL test passes unchanged.
- `app-filter.js`: `countActiveFilters` counts the text, each registry key
  once, the Work value (only with participants) and SYNC; `matchesIssueFilters`
  loops over the registry keys but `participants` (`issueFilters`, the
  multi-selects compared with a set of the entry; the participants have the
  Work select and their own rule in `evaluatePullRequest`, unchanged).
- The multi-select ids, the URL parameters and the visible behaviour do not
  change. Adding a multi-select filter becomes: one row in the registry, the
  markup element in `index.html`, the option list and the set in
  `buildFilterIndex`.

### 3.2 Generated multi-select markup (item 2)

- `multi-select.js` holds the dropdown markup once (a constant string, no
  interpolation) and the `MultiSelect` constructor writes it into its element
  before querying the parts; the guards on the optional parts go, since they
  always exist now.
- `index.html` keeps the label and the info icon of each filter and an empty
  `<div class="multi-select" id="...">` (the `data-filter` attributes, read by
  nothing, go). The generated DOM is the one the HTML had, so the stylesheet
  and the keyboard behaviour do not change.

### 3.3 The index feeds every option list (item 3)

- `buildFilterIndex` takes `sprints` too and returns, under each registry
  key, the option list of the multi-select as `{ value, label }[]` in display
  order: sprints sorted by name (value: the id as a string), fix versions
  from the linked issues, their parents and the orphaned issues, unique by
  id, sorted by Jira project then name, labelled `Name (PROJECT)`; epics and
  stories through `issueOptions` (newest first per project); participants by
  name. The former `epics`/`stories` Maps and `participants` names are
  replaced by these lists (`issueOptions` stays exported and tested).
- `renderEverything` populates the five multi-selects in one loop over the
  registry (`filterIndex[key]`); `populateSprintFilter`,
  `populateFixVersionFilter`, `populateIssueFilter` and
  `populateParticipantFilter` go. The sort rules move from untested DOM code
  to the tested index; the option lists shown do not change.

### 3.4 Filter inputs from the index and the loaded statuses (item 4)

- A new pure module `public/pull-request-status.js` exports
  `otherReviewers(pullRequest)` (the participants other than the author and
  Rovo Dev, what the render lists and what "all approved" reads) and
  `statusClass(pullRequest, linkedIssues)`: `status-in-progress` when a
  linked issue is in progress, else `status-in-review` or
  `status-in-review-all-approved` (other reviewers present and every one
  approved) when one is in review, else `status-resolved` when every linked
  issue is resolved or closed (which today includes a pull request with no
  linked issue at all, `[].every` being true: kept as it is, no behaviour
  change), else no class. `renderPullRequest` and `buildFilterIndex` both
  call it, so the band painted and the band the filters read are one
  computation.
- Each index entry carries `statusInProgress`, `statusInReview` (from the
  class) and `syncKey` (`repo/destHash..sourceHash`, the key of the statuses
  response, `undefined` spelled out when a hash is missing, as the badge
  painter does). `computeAttention(entry, participants)` reads the two
  booleans from the entry.
- `filterBranches(filters, syncStatuses)` takes the `statuses` object of the
  last SYNC response, or `null` while none is loaded (`app-sync.js` exports
  `loadedSyncStatuses()`; `applyFilters` in `app.js` passes it).
  `evaluatePullRequest(entry, filters, syncStatus)` takes the status of the
  pull request (`syncStatuses[entry.syncKey]`, or `undefined`): `requested`
  matches a status with `conflicts` and no `error`, `OK` a status with
  neither, `unchecked` everything else (no status, a failure, a missing
  hash), which is exactly what the painted badges said (SYNC, OK, neither).
- The `.pull-request .conflicts-count` / `.conflicts-ok` queries and the
  `classList.contains` reads go, with the rule that the badges must be
  painted before the filters run; `applySyncStatuses` keeps painting from
  the data attributes after each render, in any order relative to the
  filters. The tree pass still visits each pull request once.

### 3.5 Drop `pullRequestsByDestination` from the API response (item 5)

- `project-data.mjs` and `fixtures/generate.mjs` stop building and sending
  it; `fillPullRequestsMap` goes with its test. The hash never covered it,
  so `dataHash` does not change for a given data set.
- `renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails,
  jiraSiteName)` groups the pull requests per repository (as it did) and
  builds, per repository, the Map of destination branch to pull requests it
  passes down (`pullRequestsByDestination(pullRequests)`, exported for the
  tests); `calculateTotalPullRequests` and `calculateDescendants` keep
  taking that Map. Two repositories sharing a branch name no longer see each
  other's pull requests under it (pitfall 9 of CLAUDE.md, fixed: it becomes
  a note that the grouping is per repository).
- The response shape in CLAUDE.md, PRD.md 7.3 and the server and
  project-data tests lose the field; the fixture test that measures the deep
  stack groups the pull requests itself. The size of the SECOLLAB fixture
  response before and after is measured with `curl` on the fixture server
  and put in the changelog.

### 3.6 One assembly for the server and the fixtures (item 6)

- A new pure module `project-assembly.mjs` holds what the server and the
  generator both did: `extractJiraIssues(title, jiraRegex)`,
  `createJiraIssuesMap(pullRequests, jiraRegex)` (a Map by pull request id,
  moved from `project-data.mjs`), `missingParentKeys(issues)` (the parent
  keys named by the issues and present in none of them, in first-seen order,
  once each), `inheritFixVersions(issues)` (in place, in array order: an
  issue without fix versions takes its parent's, the parent looked up among
  the issues), `calculateHash(data)` (moved) and
  `assembleProjectData({ pullRequests, jiraIssuesMap, jiraIssuesDetails,
  parents, orphanedIssues, sprints, sprintIssues, jiraSiteName })`, which
  runs the inheritance over the details, the orphaned issues then the
  parents (the order `completeParents` used), appends the parents to the
  details and returns the response without `lastRefreshTime`:
  `pullRequests`, `jiraIssuesMap` (a plain object), `jiraIssuesDetails`,
  `jiraSiteName`, `sprints`, `sprintIssues`, `orphanedIssues`, `dataHash`.
- `buildProjectData` (project-data.mjs) fetches the pull requests, builds
  the map, fetches the orphaned issues, the linked issues
  (`fetchJiraIssuesDetails(keys, jiraProjects)`, the batches only), the
  parents (`fetchParentIssues(keys)`, one `key IN (...)` request with the
  same fields as today, `[]` without keys or when the request fails, the
  failure logged as today), the sprints and the sprint issues, then calls
  `assembleProjectData`; when the hash differs from the last response built
  it fetches the commit counts and puts the counted pull requests in the
  response, otherwise it serves the last response with a new
  `lastRefreshTime`, as today. `completeParents` goes. The `dataHash` of the
  server now covers the issue map as a plain object (it hashed a `Map` as
  `{}` before); the map is derived from the titles, which were hashed
  already, so no refresh behaviour changes.
- `generateProjectData` (fixtures) keeps generating the pull requests, the
  issue details it "fetches" from the issues it knows and the orphaned
  issues, picks the parents with `missingParentKeys` from the issues it
  knows (the same parent-only shape as today: summary, type, fix versions,
  parent), generates the sprints and sprint issues from the same issue set
  as today (details and parents), and calls `assembleProjectData`. Its own
  copies of the five helpers go.
- Tests: `test/project-assembly.test.mjs` takes the pure tests of
  `test/project-data.test.mjs` (`extractJiraIssues`, `createJiraIssuesMap`,
  `calculateHash`) and adds `missingParentKeys`, `inheritFixVersions` (the
  epic → story → sub-task chain when the story comes first, an orphaned
  issue, a parent without versions) and the shape and hash of
  `assembleProjectData`; the project-data tests keep checking the requests
  and the response through the fake Atlassian, adapted to the new fetcher
  signatures; the fixture tests keep checking the response shape.

### 3.7 One helper per Atlassian API (item 7)

- In `createProjectData`, `bitbucketJson(url)` and `jiraJson(url)` send the
  GET with the credentials of their API and the `Accept` header, return the
  parsed body of an `ok` response, and throw `Request failed with status
  code <status>` otherwise (the body drained first, so the socket is
  released; the Jira helper appends the first 200 characters of the body,
  where Jira's `errorMessages` say what was wrong with the JQL, which only
  `fetchJiraIssuesDetails` reported before). Every fetcher goes through
  them; the `{ method, headers }` block appears twice in the file.
- `fetchPullRequests(url)` returns the pull requests of every page in a
  loop over `next`, one performance line per page as today.
- The failure handling of each fetcher keeps its documented rule: a failed
  pull-request page or orphaned-issues page fails the build; a failed batch
  of linked issues is logged and fails the build; a failed parents request
  is logged and gives no parents; a failed commit count is logged and gives
  `null`; a failed boards request skips the project's sprints and a failed
  sprints request of one board skips that board, the other boards kept (what
  the code did, silently: both failures now reach `error.log`, and CLAUDE.md,
  which said "a failure skips the project's sprints", is corrected); a
  failed sprint-issues page ends that sprint's list, the pages read kept.
- `sync-statuses.mjs` keeps its own `fetchBitbucketJson` (it carries the
  timeout signal); not touched.

### 3.8 One delegated click listener (item 8)

- `tree-toggle.js` exports `handleTreeClick(event)`: a click inside a link
  toggles nothing (the root-branch link opens in its tab as before, no
  `stopPropagation` needed); the toggle button under a `.pull-request-header`
  toggles the stacked pull requests; any other click on a
  `.root-branch-header` toggles the branch, on a `.repository-header` the
  repository (the orphaned issues section included). A keyboard activation
  of a header button dispatches a click on the button, inside the header, so
  it reaches the same branch once: the "never a second handler on the
  button" rule of 2.10.1 has nothing left to guard.
- `app.js` installs it once on `#pull-requests` at load and no longer puts
  anything on `window`; `app-render.js` writes no `onclick` attribute
  (`toggleButton(name)` loses its second parameter) and its header comment
  says where the clicks go. The render tests assert the absence of inline
  handlers; a tree-toggle test with fake elements checks the four cases.

### 3.9 Version, order and delivery

- One commit per item, in the issue's order, each leaving `npm test` green;
  version 2.11.0 with one changelog entry listing the visible change (the
  response without `pullRequestsByDestination`, the per-repository grouping,
  the measured size) and the refactors with "no behaviour change".
- The CLAUDE.md sections touched: the file map (`filter-registry.js`,
  `pull-request-status.js`, `project-assembly.mjs`), app.js state,
  app-url.js, app-filter.js, app-render.js, app-sync.js, tree-toggle.js,
  project-data.mjs, fixtures, the API response, the state-management
  snippet, the "Add New Filter" recipe (one row), pitfalls 9, 12 and 13.
  PRD.md 7.1 (components) and 7.3 (response). README: the changelog only
  (the features do not change).

## 4. Out of scope

- The multi-select accessibility (no role, no accessible name: #62 left it
  out on purpose); the generated markup is the same DOM.
- Unifying `sync-statuses.mjs`'s Bitbucket helper with the project-data
  ones.
- Changing which people count as reviewers in the index (`reviewers` and
  `pendingReviewers` keep including Rovo Dev, who can never be selected).
- Any behaviour change beyond the two the changelog lists.

## 5. Verification

`npm test` after every commit. On the fixture server, in the browser:
the five filters populate, select, restore from the URL and write it as
before (the URL of a filter combination is byte-identical to 2.10.3); the
SYNC filter values match the badges after a load and after a re-render
(background refresh forced with `checkForUpdates`); a filter change on
SECOLLAB stays around a millisecond of JavaScript; the toggles of a
repository, a root branch, a stacked pull request and the orphaned issues
section work by mouse and through `button.click()`; the root-branch link
still opens. Payload: `curl -s localhost:3101/api/pull-requests/SECOLLAB | wc -c`
before and after item 5.

## 6. Delivery

Branch `claude/collapse-repetition` from `claude/badge-colour-tokens` (#50),
one pull request stacked on it, eight commits (plus the spec, the plan and
the version bump).
