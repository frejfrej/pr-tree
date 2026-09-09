# Ready for Assignee Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Ready for assignee" checkbox under the Assignee filter, the twin of "Ready for reviewer", and restore both "Ready" filters from the URL.

**Architecture:** The rule already exists: `computeAttention().assignee` (in progress, linked issue assigned to a selected assignee) drives the highlight. The filter reuses it in `evaluatePullRequest`, where `ready` is renamed `readyReviewer` and `readyAssignee` is added, both defaulting to false; when both are checked the match is an OR. In `app.js` one `updateReadyCheckboxes()` helper owns the disabled/checked state of the two checkboxes; the URL gains `readyReviewer` / `readyAssignee`, both restored on load (the old `ready` is read as `readyReviewer` and never written again).

**Tech Stack:** Vanilla ES modules, `node:test`. No server change.

**Spec:** `docs/superpowers/specs/2026-09-10-ready-for-assignee-design.md` (issue #31)

**Branch:** `claude/filters-4-ready-assignee`, created from `claude/filters-3-story` (already created, spec and plan committed). One pull request stacked on #30. Do not `git add` `config.js`, `config.js.test` or `.claude/`; add files by name. Commit messages end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AuGDyDk4Av2U5A1oVXhAMF
```

**Running the unit tests:** `npm test`, expected to end with `ℹ fail 0` (47 tests before this task).

**Running the app for manual checks:** `PORT=3101 node index.mjs --fixtures` (port 3100 is used by another application on this machine), http://localhost:3101, pick SECOLLAB.

---

### Task 1: Ready for assignee filter

**Files:**
- Modify: `public/app-filter.js`
- Modify: `test/app-filter.test.mjs`, `test/fixtures.test.mjs`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `README.md`, `CLAUDE.md`, `PRD.md`

- [ ] **Step 1: Rename `ready` in the existing tests and write the failing tests**

In `test/app-filter.test.mjs`:

- In the `countActiveFilters` test, replace `ready: false` with `readyReviewer: false, readyAssignee: false` in `defaults`, replace the two `ready: true` with `readyReviewer: true` (the expected counts stay 2 and 6), and add:

```js
    assert.equal(countActiveFilters({ ...defaults, assignees: ['A'], readyAssignee: true }), 2);
    assert.equal(countActiveFilters({ ...defaults, assignees: ['A'], reviewers: ['J'], readyAssignee: true, readyReviewer: true }), 4);
```

- Replace the `noFilter` constant of the "index and evaluation" section with `const noFilter = { assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', readyReviewer: false, readyAssignee: false };`.
- In the test `evaluatePullRequest ready filter keeps pull requests with reviewer attention only`, replace both `ready: true` with `readyReviewer: true`.
- In the last test of the story section (`epic and story filters combine as AND...`), replace `ready: false` with `readyReviewer: false, readyAssignee: false`.
- Append after the `evaluatePullRequest ready filter...` test:

```js
test('evaluatePullRequest ready-for-assignee filter keeps pull requests with assignee attention only', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10); // PROJ-1 is assigned to Jane
    const inProgress = { statusInProgress: true, statusInReview: false, hasSyncLabel: false };
    const jane = evaluatePullRequest(entry, { ...noFilter, assignees: ['Jane'], readyAssignee: true }, inProgress);
    assert.equal(jane.visible, true);
    assert.equal(jane.attention.assignee, true);
    const bob = evaluatePullRequest(entry, { ...noFilter, assignees: ['Bob'], readyAssignee: true }, inProgress);
    assert.equal(bob.visible, false); // no linked issue assigned to Bob
    const inReview = evaluatePullRequest(entry, { ...noFilter, assignees: ['Jane'], readyAssignee: true }, rendered);
    assert.equal(inReview.visible, false); // in review: no assignee attention
    assert.equal(inReview.attention.assignee, false);
});

test('both ready filters checked keep the pull requests needing either attention', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const entry = pullRequestsById.get(10);
    const both = { ...noFilter, assignees: ['Jane'], reviewers: ['Jane'], readyAssignee: true, readyReviewer: true };
    assert.equal(evaluatePullRequest(entry, both, { statusInProgress: true, statusInReview: false, hasSyncLabel: false }).visible, true); // assignee attention
    assert.equal(evaluatePullRequest(entry, both, rendered).visible, true); // reviewer attention: Jane has not approved
    assert.equal(evaluatePullRequest(entry, both, { statusInProgress: false, statusInReview: false, hasSyncLabel: false }).visible, false); // neither
});
```

In `test/fixtures.test.mjs`, replace `ready: false` in the `noFilter` constant with `readyReviewer: false, readyAssignee: false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: the two new tests fail (`readyAssignee` is ignored, so `bob`/`inReview` visibility assertions fail) and the `countActiveFilters` test fails on the new assertions; `ℹ fail` greater than 0.

- [ ] **Step 3: Implement the match in app-filter.js**

In `public/app-filter.js`:

a. Replace `countActiveFilters` with:

```js
/**
 * Counts the filters that are not at their default value.
 * A multi-select with several values counts once.
 */
export function countActiveFilters({ text = '', assignees, reviewers, sprints, fixVersions, epics = [], stories = [], sync, readyReviewer = false, readyAssignee = false }) {
    return [
        parseTextQuery(text).length > 0,
        assignees.length > 0,
        reviewers.length > 0,
        sprints.length > 0,
        fixVersions.length > 0,
        epics.length > 0,
        stories.length > 0,
        readyReviewer === true,
        readyAssignee === true,
        sync !== 'Show all'
    ].filter(Boolean).length;
}
```

b. In `evaluatePullRequest`: the JSDoc `@param {object} filters` line lists `{ text, assignees, reviewers, sprints, fixVersions, epics, stories, sync, readyReviewer, readyAssignee }`; the signature becomes:

```js
export function evaluatePullRequest(entry, { text = '', assignees, reviewers, sprints, fixVersions, epics = [], stories = [], sync, readyReviewer = false, readyAssignee = false }, { statusInProgress, statusInReview, hasSyncLabel }) {
```

and the two `readyMatch` lines are replaced with:

```js
    // Ready filters: with one or both checked, keep the pull requests that need the
    // attention of the selected reviewers or assignees. A pull request is never in
    // review and in progress at once, so the two boxes combine as OR
    const readyMatch = (!readyReviewer && !readyAssignee) ||
        (readyReviewer && attention.reviewer) ||
        (readyAssignee && attention.assignee);
```

c. The `filterBranches` JSDoc lists the same filters; in `filterPullRequest`, the comment `so the ready filter never` becomes `so the ready filters never`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ fail 0`, 49 tests.

- [ ] **Step 5: Commit**

```bash
git add public/app-filter.js test/app-filter.test.mjs test/fixtures.test.mjs
git commit -m "feat: ready-for-assignee match, ready filters renamed readyReviewer/readyAssignee"
```

- [ ] **Step 6: The checkbox rows in index.html**

In `public/index.html`:

a. Insert right after the Assignee `filter-item` block (the `</div>` closing the block that contains `assigneeSelect`) and before the Reviewer block:

```html
  <div class="filter-item filter-item-checkbox">
    <input type="checkbox" id="readyForAssigneeCheck" disabled>
    <label for="readyForAssigneeCheck">Ready for assignee</label>
    <i class="fas fa-info-circle info-icon"
       title="Pull requests in progress with a linked issue assigned to a selected assignee"></i>
  </div>
```

b. In the existing "Ready for reviewer" row, replace the info icon line with:

```html
    <i class="fas fa-info-circle info-icon"
       title="Pull requests in review that a selected reviewer has not approved yet"></i>
```

- [ ] **Step 7: State, URL and controls in app.js**

In `public/app.js`:

a. Add `let currentReadyForAssignee = false;` right after `let currentReadyForReviewer = false;`.

b. Replace the `filterUrlParams` constant and its comment with:

```js
// URL parameters written by the filters ('ready', the former name of readyReviewer, is only ever removed)
const filterUrlParams = ['q', 'sprint', 'fixVersion', 'epic', 'story', 'assignee', 'reviewer', 'sync', 'readyReviewer', 'readyAssignee', 'ready'];
```

c. In `currentFilters()`, replace `ready: currentReadyForReviewer` with:

```js
        readyReviewer: currentReadyForReviewer,
        readyAssignee: currentReadyForAssignee
```

d. In `resetFilterControls()`, replace the two `readyCheck` lines with:

```js
    ['readyForAssigneeCheck', 'readyForReviewerCheck'].forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.checked = false;
    });
```

and in the comment above the function replace `the ready checkbox` with `the ready checkboxes`.

e. In `updateUrlWithFilters()`, replace `if (currentReadyForReviewer) url.searchParams.set('ready', 'true');` with:

```js
    if (currentReadyForReviewer) url.searchParams.set('readyReviewer', 'true');
    if (currentReadyForAssignee) url.searchParams.set('readyAssignee', 'true');
```

f. In `restoreFiltersFromUrl()`, replace the line `currentReadyForReviewer = false; // Not restored because it requires a fully displayed and updated pr tree` with:

```js
    // Restored like the other filters; 'ready' is the former name of readyReviewer
    currentReadyForReviewer = urlParams.get('readyReviewer') === 'true' || urlParams.get('ready') === 'true';
    currentReadyForAssignee = urlParams.get('readyAssignee') === 'true';
```

and replace the block from `// Update sync select and ready checkbox` down to the closing `}` of `if (readyCheck) { ... }` with:

```js
    // Update the sync select and the ready checkboxes
    const syncSelect = document.getElementById('syncSelect');
    if (syncSelect) syncSelect.value = currentSync;
    updateReadyCheckboxes();
```

g. Replace `initializeReadyForReviewerFilter()` with:

```js
function initializeReadyFilters() {
    ['readyForAssigneeCheck', 'readyForReviewerCheck'].forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.addEventListener('change', handleFilterChange);
    });
    updateReadyCheckboxes();
}

// The ready checkboxes depend on their multi-select: disabled and unchecked
// while no assignee (or reviewer) is selected, otherwise they show the state
function updateReadyCheckboxes() {
    if (currentAssignees.length === 0) currentReadyForAssignee = false;
    if (currentReviewers.length === 0) currentReadyForReviewer = false;
    const assigneeCheck = document.getElementById('readyForAssigneeCheck');
    if (assigneeCheck) {
        assigneeCheck.disabled = currentAssignees.length === 0;
        assigneeCheck.checked = currentReadyForAssignee;
    }
    const reviewerCheck = document.getElementById('readyForReviewerCheck');
    if (reviewerCheck) {
        reviewerCheck.disabled = currentReviewers.length === 0;
        reviewerCheck.checked = currentReadyForReviewer;
    }
}
```

and in the `DOMContentLoaded` listener replace `initializeReadyForReviewerFilter();` with `initializeReadyFilters();`.

h. In `readFilterControls()`, replace everything from `// Get sync and ready values from regular form elements` down to the closing `}` of the `if (readyCheck) { ... }` enable/disable block with:

```js
    // Get sync and ready values from regular form elements
    const syncSelect = document.getElementById("syncSelect");
    const assigneeCheck = document.getElementById('readyForAssigneeCheck');
    const reviewerCheck = document.getElementById('readyForReviewerCheck');

    currentSync = syncSelect ? syncSelect.value : "Show all";
    currentReadyForAssignee = assigneeCheck ? assigneeCheck.checked : false;
    currentReadyForReviewer = reviewerCheck ? reviewerCheck.checked : false;
    updateReadyCheckboxes();
```

and in the comment above the function replace `(ready checkbox, clear button)` with `(ready checkboxes, clear button)`.

i. In `populateFilters()`, delete the line `const readyCheck = document.getElementById('readyForReviewerCheck');` and the block:

```js
    // Update checkbox state
    if (readyCheck) {
        readyCheck.disabled = currentReviewers.length === 0;
        readyCheck.checked = currentReadyForReviewer;
    }
```

(`restoreFiltersFromUrl()`, called right after, sets both checkboxes through `updateReadyCheckboxes()`).

Run: `node --check public/app.js` and `grep -n "readyForReviewerCheck\|currentReadyForReviewer\|'ready'" public/app.js` — every remaining occurrence must be one of: the `let`, `filterUrlParams`, `currentFilters()`, `resetFilterControls`, `updateUrlWithFilters`, `restoreFiltersFromUrl`, `initializeReadyFilters`, `updateReadyCheckboxes`, `readFilterControls`.

- [ ] **Step 8: Check the app in the browser**

Run: `PORT=3101 node index.mjs --fixtures`, open http://localhost:3101/?project=SECOLLAB.

- "Ready for assignee" is disabled; select an assignee: it enables; check it: only the in-progress pull requests of that assignee remain (the highlighted ones), the badge counts it, the URL has `readyAssignee=true`.
- Reload: the box is still checked and the tree still filtered. Same with `readyReviewer=true` after selecting a reviewer and checking "Ready for reviewer".
- Clear the assignee selection: the box unchecks and disables, the URL loses `readyAssignee`.
- Select yourself as assignee and reviewer, check both boxes: the tree shows the union of both attentions.
- "Clear filters" and a project switch uncheck both.

Stop the server with Ctrl+C.

- [ ] **Step 9: Run the tests and commit**

Run: `npm test`
Expected: `ℹ fail 0`

```bash
git add public/index.html public/app.js
git commit -m "feat: ready-for-assignee checkbox, both ready filters restored from the URL"
```

- [ ] **Step 10: Documentation**

a. `README.md`:

- In "Features", insert after the "Provides a ready for reviewer filter" block:

```
* Provides a ready for assignee filter
    * Filters In Progress pull requests with a linked issue assigned to the selected assignee
    * With both ready filters checked, pull requests needing either attention are kept
```

- Replace `    * All filter selections (project, text, sprint, fixVersion, epic, story, assignee, reviewer) are saved in the URL` with `    * All filter selections (project, text, sprint, fixVersion, epic, story, assignee, reviewer, ready for assignee, ready for reviewer) are saved in the URL`.
- In the "Version 2.4.0" changelog block, add after the story filter line:

```
    * Ready for assignee filter: In Progress pull requests with a linked issue assigned to the selected assignee, the counterpart of Ready for reviewer
    * Both ready filters are now restored from the URL (`readyAssignee`, `readyReviewer`); only the SYNC filter is still reset on reload
```

b. `CLAUDE.md`:

- In "Frontend State Management", add `let currentReadyForAssignee = false;` after `let currentReadyForReviewer = false;`, and in the URL example replace `&ready=true` with `&readyReviewer=true&readyAssignee=true`.
- In the `**public/app.js**` block of "Key Files Explained", add a bullet: `- `updateReadyCheckboxes()`: the two ready checkboxes are disabled and unchecked while their multi-select is empty; both checked keeps pull requests needing either attention`.
- In "Common Pitfalls", replace item 4 with `4. **Filter restoration**: the SYNC filter is NOT restored from the URL (its statuses are loaded on demand); every other filter is, including the two ready checkboxes` and item 7 with `7. **Ready for reviewer / assignee**: computed by `computeAttention()` from the data, never from rendered styles; `evaluatePullRequest` takes `readyReviewer` and `readyAssignee``.

c. `PRD.md`:

- Add after the F4.12 line: `- F4.13: Filter by "ready for assignee" status: In Progress pull requests with a linked issue assigned to a selected assignee; with both ready filters checked, pull requests needing either attention are kept`.
- Replace `- Sharing URL restores all filters (except SYNC and ready-for-reviewer, which require async calculation)` with `- Sharing URL restores all filters (except SYNC, whose statuses are loaded on demand)`.
- In the 8.1 diagram, insert `|  Ready assignee|                                                 |` right after the `|  Assignee      |` line and replace `|  Ready         |` with `|  Ready reviewer|`.
- In the glossary (16.1), add after the "Ready for Reviewer" line: `- **Ready for Assignee**: PR with associated issue in "In Progress" status assigned to the selected assignee`.

- [ ] **Step 11: Commit**

```bash
git add README.md CLAUDE.md PRD.md
git commit -m "docs: ready for assignee filter"
```

The controller pushes the branch and opens the pull request (base `claude/filters-3-story`, `Closes #31`, `Stacked on #30`).

---

## Plan self-review

- **Spec coverage:** rule and OR (Step 3), placement and info icons (Step 6), URL parameters with the `ready` alias and restoration (Step 7 e–f), disabled/unchecked coupling (Step 7 g–h), reset paths (Step 7 d, `resetFilterControls` covers "Clear filters" and the project switch), tests (Step 1), docs (Step 10), verification (Step 8).
- **Placeholders:** none.
- **Type consistency:** `readyReviewer` / `readyAssignee` are the names in `currentFilters()`, `countActiveFilters`, `evaluatePullRequest`, the tests and the URL; `updateReadyCheckboxes` is defined in Step 7 g and called in 7 f, g, h.
