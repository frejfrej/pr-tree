# Split public/app.js: the tree rendering and the SYNC loading in their own modules

**Date:** 2026-09-10
**Target version:** 2.5.0 (unchanged: nothing observable changes)
**Status:** Implemented at the user's request (#33); the decisions the issue left open are listed in section 2
**Issue:** #33

## 1. Goal

`public/app.js` (1206 lines) mixed four concerns: the filter state and its URL
sync, the rendering of the tree as HTML strings, the SYNC loading with its
controls, and the popovers and version badge. Issue #33 asks to move the
rendering into `public/app-render.js` and the SYNC code into
`public/app-sync.js`, with no behaviour change, the way `app-filter.js`,
`app-shell.js` and `tree-toggle.js` were split out before.

## 2. Decisions

1. **Code motion, not rewriting.** The moved functions are the originals,
   byte for byte, apart from `export` keywords and the SYNC module's access to
   the app.js state (decision 3). Checked by rendering the fixture data of both
   projects with the old and the new code and comparing the HTML strings:
   identical over six data sets (both projects, scale 2, chain depth 8).
2. **The popovers go with the rendering.** `initializePopovers` reads the data
   attributes `renderPullRequest` writes (`data-rendered-title`,
   `data-rendered-description`, `data-issue-key`, `data-issue-summary`): the
   writer and the reader live in `app-render.js`. The issue named the popovers
   as a mixed-in concern without giving them a destination.
3. **The SYNC module never imports app.js.** It needs the selected project
   (the fetch URL, the load button) and the selected SYNC filter (put back on
   the select when its options are rebuilt after a load). Both stay in app.js
   and are read through accessors given once to
   `initializeSyncControls({ getProject, getSyncFilter, onFilterChange, onLoadEnd })`,
   the way `initializeAppShell({ onClearFilters })` and
   `createMultiSelect(id, { onChange })` receive callbacks. The values are read
   when needed, not captured when a load starts: a Back or Forward during a
   load can change the SYNC filter before the load ends.
4. **The one line of app.js state the SYNC code wrote** (`currentSync =
   "Show all"` after a failed load with no statuses) becomes
   `handleSyncLoadEnd` in app.js: `if (!syncStatusesLoaded()) currentSync =
   'Show all'; applyFilters();`. Same effect, stated as the invariant it
   protects: the SYNC filter is only meaningful while statuses are loaded.
5. **`initializeSyncControls` moves too.** The issue listed
   `loadSyncStatuses`, `applySyncStatuses`, `updateSyncControls` and the state;
   the initialisation is where the module receives its accessors and wires its
   own controls, like `initializeAppShell` does.
6. **The version badge goes to the app shell.** `fetchAndDisplayVersion` is
   banner chrome; `initializeAppShell` calls it. The `/api/version` fetch now
   starts a few statements earlier in the `DOMContentLoaded` sequence (before
   the projects fetch instead of after), which is not observable.
7. **Unit tests for the now-pure rendering.** `test/app-render.test.mjs`
   covers `findRootBranches`, `calculateTotalPullRequests`,
   `calculateDescendants`, `renderRepositories` (structure and counters,
   nesting and order, status classes, issues, participants, commit badges and
   alerts, the data attributes the popovers and the SYNC badges read, the two
   fixture projects) and `renderOrphanedIssues`. The SYNC module is DOM code
   and stays without unit tests, like the filter pass.
8. **No version bump, no changelog entry.** Nothing changes for the user.

## 3. Out of scope

- Moving `currentSync`, the SYNC filter value, into the SYNC module: it is a
  filter like the others, read by `currentFilters()`.
- The inline `onclick` handlers of the tree: they still call the toggle
  functions app.js installs on `window`.
- The review follow-ups of #37.

## 4. Result

| File | Lines | Content |
|---|---|---|
| `public/app.js` | 627 | state, filters, URL and history, project loading, render orchestration, periodic refresh, filter controls, wiring |
| `public/app-render.js` | 457 | `renderRepositories` and its helpers, `renderOrphanedIssues`, `initializePopovers` |
| `public/app-sync.js` | 174 | the SYNC state, `initializeSyncControls`, `loadSyncStatuses`, `applySyncStatuses`, `updateSyncControls`, `syncStatusesLoaded`, `resetSyncStatuses` |
| `public/app-shell.js` | +21 | `fetchAndDisplayVersion`, called by `initializeAppShell` |

## 5. Verification

`npm test`: 68 tests, 10 of them new. Old/new HTML comparison on the fixture
data (one-off script, not committed). In the browser on the fixture server
(port 3101): SECOLLAB renders 112 pull requests in 3 repositories with 13
orphaned issues; the version badge and its tooltip; the SYNC load paints the
badges, the SYNC filter restricts the tree and reaches the URL; a failed
refresh keeps the previous statuses and the selection and shows the warning; a
project switch resets the SYNC controls; a failed first load leaves the filter
at Show all with the other warning; Back restores SECOLLAB with the SYNC filter
back to Show all (its statuses are gone); the popovers on pull-request and
issue links; the text filter and the no-match message.
