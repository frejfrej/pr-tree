# Text, Epic and Story Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free-text filter, an Epic filter and a Story filter to the sidebar, each delivered as its own stacked pull request.

**Architecture:** The three filters plug into the existing single-pass filter machinery: `buildFilterIndex` precomputes per pull request the searchable text and the sets of epic and story keys, `evaluatePullRequest` compares them with the selected values, `app.js` keeps the state, the URL and the controls in sync. The Jira hierarchy (epic → standard issue → sub-task) is interpreted in one place, `app-filter.js` (`issueLevel`, `epicOf`, `storyOf`), from the `issuetype` and inline `parent` fields the server already returns; one server change makes the parent fetch return the summary, type and parent of parent issues so that sub-tasks reach their epic. The fixture generator gains epics so everything is testable offline.

**Tech Stack:** Vanilla ES modules, CSS custom properties, Font Awesome 5.15.3, `node:test` (Node 24). Express server (`index.mjs`) for the one-line Jira fields change.

**Spec:** `docs/superpowers/specs/2026-09-09-text-epic-story-filters-design.md`

**Base branch:** `claude/filters` (spec and this plan, PR against `master`).

---

## File structure

| File | Responsibility in this work |
|---|---|
| `public/app-filter.js` | Pure filter logic: `parseTextQuery`, `matchesText`, `issueLevel`, `epicOf`, `storyOf`; `searchText`, `epics`, `stories` in the index; matches in `evaluatePullRequest`; `filterBranches(filters)`; `initializeFilter` returns the index. |
| `public/app.js` | Filter state (`currentText`, `currentEpics`, `currentStories`), URL parameters (`q`, `epic`, `story`), control wiring, option population from the index. |
| `public/app-shell.js` | `/` shortcut, `showSidebar()`, Escape left to a filled text box. |
| `public/index.html` | Search box under the sidebar header; Epic and Story multi-selects after Fix version. |
| `public/styles.css` | `.text-filter` rules (section 3, sidebar). |
| `public/multi-select.js` | Tooltip with the full label on options. |
| `index.mjs` | Parent fetch asks for `key,summary,issuetype,fixVersions,parent`. |
| `fixtures/generate.mjs` | Epics per Jira project, `hierarchyLevel`, Jira-shaped inline parents, parent-only entries with hierarchy. |
| `test/app-filter.test.mjs`, `test/fixtures.test.mjs` | Unit tests for every pure function and for the fixture hierarchy. |
| `package.json`, `README.md`, `CLAUDE.md`, `PRD.md` | Version 2.4.0 and documentation, updated by each pull request for its own filter. |

Untouched: `cache.mjs`, `public/tree-toggle.js`, `public/counter-utils.js`.

**Running the unit tests:** `npm test`. Expected output ends with `ℹ fail 0`.

**Running the app for manual checks:** `PORT=3101 node index.mjs --fixtures` from the repository root (port 3100 is used by another application on this machine; port 3000 is the user's real server), then open http://localhost:3101 and pick SECOLLAB. Stop it with Ctrl+C. No `config.js` is needed in fixture mode.

**Never `git add` `config.js`, `config.js.test` or `.claude/`:** they are untracked on purpose (`config.js.test` holds real credentials). Always add files by name.

---

## Workflow: one stacked pull request per filter

| Task | Branch | PR base |
|---|---|---|
| (docs) spec and plan | `claude/filters` | `master` |
| 1 | `claude/filters-1-text` | `claude/filters` |
| 2 | `claude/filters-2-epic` | `claude/filters-1-text` |
| 3 | `claude/filters-3-story` | `claude/filters-2-epic` |

For each task:

1. `git checkout -b <branch> <PR base branch>`
2. Follow the steps and commit as written in the task. Commit messages end with:

   ```
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01AuGDyDk4Av2U5A1oVXhAMF
   ```
3. `git push -u origin <branch>`
4. Open the PR against the base branch from the table:

```bash
gh pr create --base <PR base branch> --title "<commit title>" --body "$(cat <<'BODY'
<what and why, one or two paragraphs; what was verified>

Stacked on #<previous PR number>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01AuGDyDk4Av2U5A1oVXhAMF
BODY
)"
```

**Merging the stack (repository owner):** merge bottom-up. Before merging each PR, retarget the next PR onto `master` (`gh pr edit <next PR> --base master`), then merge the current one and confirm `git log origin/master` advanced. GitHub does not reliably retarget a stacked PR when its base branch is deleted, and a PR that slipped into the closed state cannot be retargeted any more.

---

### Task 1: Text filter

A search box at the top of the sidebar that keeps the pull requests whose title, source branch name or linked issue keys contain every word typed. Also the `/` shortcut, version 2.4.0 and the documentation.

**Files:**
- Modify: `public/app-filter.js`
- Modify: `test/app-filter.test.mjs`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `public/app-shell.js`
- Modify: `package.json`, `README.md`, `CLAUDE.md`, `PRD.md`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b claude/filters-1-text claude/filters
```

- [ ] **Step 2: Write the failing tests**

In `test/app-filter.test.mjs`, replace the `sampleApiResult` constant (the two sample pull requests get a title and a source branch) with:

```js
const sampleApiResult = {
    pullRequests: [
        {
            id: 10, title: 'fix(PROJ-1): restore the banner', source: { branch: { name: 'JD_260901_PROJ-1_Banner' } },
            author, participants: [{ user: author, approved: false }, { user: jane, approved: false }, { user: bob, approved: true }]
        },
        {
            id: 11, title: 'chore: bump dependencies', source: { branch: { name: 'chore/bump-deps' } },
            author, participants: [{ user: author, approved: false }]
        }
    ],
    jiraIssuesMap: { 10: ['PROJ-1', 'PROJ-2', 'PROJ-404'], 11: [] },
    jiraIssuesDetails: [
        { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' }, fixVersions: [{ id: 100, name: '1.0' }] } },
        { key: 'PROJ-2', fields: { assignee: null, fixVersions: [] } }
    ],
    sprintIssues: { 5240: ['PROJ-2', 'PROJ-9'], 5241: ['PROJ-9'] }
};
```

Extend the existing `countActiveFilters` test by adding these two assertions at its end:

```js
    assert.equal(countActiveFilters({ ...defaults, text: '   ' }), 0);
    assert.equal(countActiveFilters({ ...defaults, text: 'banner' }), 1);
```

Append at the end of the file:

```js
// ------------------------------------------------------------------ text filter

import { parseTextQuery, matchesText } from '../public/app-filter.js';

test('parseTextQuery lower-cases, trims and splits on whitespace', () => {
    assert.deepEqual(parseTextQuery('  Fix  PROJ-12\tbanner '), ['fix', 'proj-12', 'banner']);
    assert.deepEqual(parseTextQuery(''), []);
    assert.deepEqual(parseTextQuery('   '), []);
    assert.deepEqual(parseTextQuery(undefined), []);
});

test('matchesText requires every term as a substring', () => {
    const searchText = 'fix(proj-12): restore banner feature/proj-12-banner proj-12';
    assert.equal(matchesText(searchText, []), true);
    assert.equal(matchesText(searchText, ['banner']), true);
    assert.equal(matchesText(searchText, ['proj-12', 'restore']), true);
    assert.equal(matchesText(searchText, ['banner', 'footer']), false);
    assert.equal(matchesText(searchText, ['ann']), true); // substring, not whole word
});

test('buildFilterIndex searches the title, the source branch and the issue keys only', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    assert.equal(pullRequestsById.get(10).searchText, 'fix(proj-1): restore the banner jd_260901_proj-1_banner proj-1 proj-2 proj-404');
    assert.equal(pullRequestsById.get(11).searchText, 'chore: bump dependencies chore/bump-deps');
});

test('evaluatePullRequest text filter is case-insensitive and needs every word', () => {
    const { pullRequestsById } = buildFilterIndex(sampleApiResult);
    const evaluate = text => evaluatePullRequest(pullRequestsById.get(10), { ...noFilter, text }, rendered).visible;
    assert.equal(evaluate(''), true);
    assert.equal(evaluate('BANNER'), true);
    assert.equal(evaluate('proj-404'), true); // an issue key of the title, even without details
    assert.equal(evaluate('jd_260901'), true); // the source branch
    assert.equal(evaluate('restore banner'), true);
    assert.equal(evaluate('banner footer'), false);
    assert.equal(evaluate('Author'), false); // people are not searched
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: failures mentioning `parseTextQuery` is not exported / `searchText` is undefined; the summary shows `ℹ fail` greater than 0.

- [ ] **Step 4: Implement the text filter in app-filter.js**

Replace the whole of `public/app-filter.js` with:

```js
import { updateCounterDisplay } from './counter-utils.js';

/**
 * Filtering of the rendered pull-request tree.
 *
 * The data needed by the filters is indexed once per data load
 * (buildFilterIndex), and every filter pass is a single walk of the rendered
 * tree: each pull request is visited exactly once, its visibility and
 * attention are decided from the index, and the counters of its ancestors are
 * summed on the way back up. Nothing here searches arrays or the DOM per
 * pull request, so a pass costs the same on a flat list and on a deep stack.
 */

let filterIndex = null;

/** Builds the filter index for a data load and returns it. */
export function initializeFilter(apiResult) {
    filterIndex = buildFilterIndex(apiResult);
    return filterIndex;
}

/**
 * Counts the filters that are not at their default value.
 * A multi-select with several values counts once.
 */
export function countActiveFilters({ text = '', assignees, reviewers, sprints, fixVersions, sync, ready }) {
    return [
        parseTextQuery(text).length > 0,
        assignees.length > 0,
        reviewers.length > 0,
        sprints.length > 0,
        fixVersions.length > 0,
        ready === true,
        sync !== 'Show all'
    ].filter(Boolean).length;
}

// ------------------------------------------------------------- text filter

/**
 * Splits a text query into lower-cased terms. Pure.
 * @returns {string[]} no term for a blank query
 */
export function parseTextQuery(text) {
    return String(text || '').toLowerCase().split(/\s+/).filter(term => term !== '');
}

/** True when every term is a substring of the searchable text. Pure. */
export function matchesText(searchText, terms) {
    return terms.every(term => searchText.includes(term));
}

// --------------------------------------------------------------- attention

/**
 * Decides whether a pull request needs the attention of the people selected
 * in the assignee and reviewer filters. Pure: everything it needs is passed in.
 *
 * - assignee: the PR is in progress and a linked issue is assigned to a selected assignee
 * - reviewer: the PR is in review and a selected reviewer (never the author) has not approved
 *
 * The title of a PR with attention is highlighted; the "Ready for reviewer"
 * filter keeps the PRs with reviewer attention.
 */
export function computeAttention(pullRequestData, { statusInProgress, statusInReview, linkedIssues, assignees, reviewers }) {
    const assignee = assignees.length > 0 && statusInProgress &&
        linkedIssues.some(issue => issue.fields.assignee && assignees.includes(issue.fields.assignee.displayName));
    const reviewer = reviewers.length > 0 && statusInReview &&
        pullRequestData.participants.some(participant =>
            participant.user.uuid !== pullRequestData.author.uuid &&
            reviewers.includes(participant.user.display_name) &&
            !participant.approved
        );
    return { assignee, reviewer, any: assignee || reviewer };
}

// ------------------------------------------------------------------- index

/**
 * Indexes the API result for the filters: one entry per pull request with its
 * linked issues, the text the text filter searches and the sets the other
 * filters compare against. Pure.
 * @returns {{ pullRequestsById: Map<number, object> }}
 */
export function buildFilterIndex({ pullRequests = [], jiraIssuesMap = {}, jiraIssuesDetails = [], sprintIssues = {} }) {
    const issuesByKey = new Map(jiraIssuesDetails.map(issue => [issue.key, issue]));

    const sprintsByIssueKey = new Map();
    for (const [sprintId, issueKeys] of Object.entries(sprintIssues)) {
        for (const issueKey of issueKeys) {
            if (!sprintsByIssueKey.has(issueKey)) {
                sprintsByIssueKey.set(issueKey, new Set());
            }
            sprintsByIssueKey.get(issueKey).add(String(sprintId));
        }
    }

    const pullRequestsById = new Map();
    for (const pullRequest of pullRequests) {
        const issueKeys = jiraIssuesMap[pullRequest.id] || [];
        const linkedIssues = issueKeys.map(key => issuesByKey.get(key)).filter(issue => issue);
        const entry = {
            pullRequest,
            linkedIssues,
            // What the text filter searches: title, source branch and issue keys
            searchText: [pullRequest.title, pullRequest.source?.branch?.name, ...issueKeys]
                .filter(Boolean).join(' ').toLowerCase(),
            assignees: new Set(linkedIssues
                .filter(issue => issue.fields.assignee && issue.fields.assignee.displayName)
                .map(issue => issue.fields.assignee.displayName)),
            reviewers: new Set(pullRequest.participants
                .filter(participant => participant.user.uuid !== pullRequest.author.uuid)
                .map(participant => participant.user.display_name)),
            sprints: new Set(issueKeys.flatMap(key => [...(sprintsByIssueKey.get(key) || [])])),
            fixVersions: new Set(linkedIssues
                .flatMap(issue => issue.fields.fixVersions || [])
                .map(version => String(version.id)))
        };
        pullRequestsById.set(pullRequest.id, entry);
    }

    return { pullRequestsById };
}

// -------------------------------------------------------------- evaluation

/**
 * Applies the filters to one indexed pull request. Pure.
 * @param {object} entry - an entry of buildFilterIndex().pullRequestsById
 * @param {object} filters - { text, assignees, reviewers, sprints, fixVersions, sync, ready }
 * @param {object} rendered - what the tree shows for this pull request:
 *   statusInProgress, statusInReview (from the Jira statuses) and hasSyncLabel
 * @returns {{ visible: boolean, attention: { assignee, reviewer, any } }}
 */
export function evaluatePullRequest(entry, { text = '', assignees, reviewers, sprints, fixVersions, sync, ready }, { statusInProgress, statusInReview, hasSyncLabel }) {
    const attention = computeAttention(entry.pullRequest, {
        statusInProgress,
        statusInReview,
        linkedIssues: entry.linkedIssues,
        assignees,
        reviewers
    });

    const textMatch = matchesText(entry.searchText, parseTextQuery(text));
    // Empty selection = show all; otherwise match ANY selected value
    const assigneeMatch = assignees.length === 0 || assignees.some(name => entry.assignees.has(name));
    const reviewerMatch = reviewers.length === 0 || reviewers.some(name => entry.reviewers.has(name));
    const sprintMatch = sprints.length === 0 || sprints.some(sprintId => entry.sprints.has(String(sprintId)));
    const fixVersionMatch = fixVersions.length === 0 || fixVersions.some(versionId => entry.fixVersions.has(String(versionId)));
    const syncMatch = sync === 'Show all' ||
        (sync === 'requested' && hasSyncLabel) ||
        (sync === 'OK' && !hasSyncLabel);
    // Ready for reviewer: in review, and a selected reviewer has not approved yet
    const readyMatch = !ready || attention.reviewer;

    return {
        visible: textMatch && assigneeMatch && reviewerMatch && sprintMatch && fixVersionMatch && syncMatch && readyMatch,
        attention
    };
}

// ---------------------------------------------------------------- tree pass

/**
 * Applies the filters to the rendered tree and refreshes the counters.
 * @param {object} filters - { text, assignees, reviewers, sprints, fixVersions, sync, ready }
 * @returns {number} how many pull requests are left shown and need attention
 */
export function filterBranches(filters) {
    const pass = {
        filters,
        index: filterIndex || buildFilterIndex({}),
        // The SYNC filter relies on the rendered badges: collect them once
        pullRequestsWithSyncLabel: new Set(
            Array.from(document.querySelectorAll('.pull-request .conflicts-count'))
                .map(badge => badge.closest('.pull-request'))
                .filter(pullRequest => pullRequest)
                .map(pullRequest => pullRequest.dataset.id)
        ),
        shownAttention: 0
    };

    for (const repository of document.querySelectorAll('.repository')) {
        let repositoryTotal = 0;
        let repositoryVisible = 0;
        for (const rootBranch of repository.querySelectorAll('.root-branch')) {
            const content = rootBranch.querySelector('.root-branch-content');
            const counts = content ? filterChildren(content, pass) : { total: 0, visible: 0 };
            repositoryTotal += counts.total;
            repositoryVisible += counts.visible;

            // Hide branch if no visible pull requests
            setDisplay(rootBranch, counts.visible > 0 ? '' : 'none');
            const counter = rootBranch.querySelector('.branch-pr-counter');
            if (counter) updateCounterDisplay(counter, counts.visible, counts.total);
        }
        const counter = repository.querySelector('.repo-pr-counter');
        if (counter) updateCounterDisplay(counter, repositoryVisible, repositoryTotal);
    }

    return pass.shownAttention;
}

// Filters the pull requests that are direct children of a container (a root
// branch content or a .children element), recursing into their own children.
// Returns the counts of the whole subtree.
function filterChildren(container, pass) {
    let total = 0;
    let visible = 0;
    for (let child = container.firstElementChild; child; child = child.nextElementSibling) {
        if (!child.classList.contains('pull-request')) {
            continue;
        }
        const counts = filterPullRequest(child, pass);
        total += counts.total;
        visible += counts.visible;
    }
    return { total, visible };
}

function filterPullRequest(pullRequestElement, pass) {
    // Children first, so the visibility of a filtered-out parent can depend on them
    const childrenContainer = pullRequestElement.nextElementSibling;
    const hasChildren = childrenContainer && childrenContainer.classList.contains('children');
    const children = hasChildren ? filterChildren(childrenContainer, pass) : { total: 0, visible: 0 };

    const entry = pass.index.pullRequestsById.get(Number(pullRequestElement.dataset.id));
    let isVisible = false;
    if (entry) {
        // Attention is computed from data before visibility, so the ready filter never
        // depends on what a previous pass rendered
        const { visible, attention } = evaluatePullRequest(entry, pass.filters, {
            statusInProgress: pullRequestElement.classList.contains('status-in-progress'),
            statusInReview: pullRequestElement.classList.contains('status-in-review'),
            hasSyncLabel: pass.pullRequestsWithSyncLabel.has(pullRequestElement.dataset.id)
        });
        isVisible = visible;
        pullRequestElement.classList.toggle('needs-attention', attention.any);
        if (visible && attention.any) {
            pass.shownAttention++;
        }
    }

    // Update visibility state: a filtered-out pull request stays displayed
    // while one of its descendants is visible
    pullRequestElement.classList.toggle('filtered', !isVisible);
    setDisplay(pullRequestElement, (!isVisible && children.visible === 0) ? 'none' : '');

    // The child counter is refreshed only while it is shown (root pull
    // requests permanently, others while collapsed), like before
    if (hasChildren) {
        const childCounter = pullRequestElement.querySelector('.child-counter');
        if (childCounter && childCounter.classList.contains('visible')) {
            updateCounterDisplay(childCounter, children.visible, children.total);
        }
    }

    return { total: children.total + 1, visible: children.visible + (isVisible ? 1 : 0) };
}

// Only touches the style when it changes, to keep style invalidation minimal
function setDisplay(element, value) {
    if (element.style.display !== value) {
        element.style.display = value;
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ fail 0` (the fixture tests still pass: their `noFilter` objects have no `text`, which defaults to `''`).

- [ ] **Step 6: Commit**

```bash
git add public/app-filter.js test/app-filter.test.mjs
git commit -m "feat: text filter logic (searchText index, parseTextQuery, matchesText)"
```

- [ ] **Step 7: Add the search box to the sidebar**

In `public/index.html`, insert this block right after the `</div>` that closes `<div class="sidebar-header">` (before the Sprint `filter-item`):

```html
  <div class="text-filter">
    <i class="fas fa-search text-filter-icon" aria-hidden="true"></i>
    <input type="search" id="textFilter" class="text-filter-input" placeholder="Title, branch or issue key"
           aria-label="Search pull requests" autocomplete="off" spellcheck="false">
    <button type="button" id="textFilterClear" class="text-filter-clear" aria-label="Clear search" hidden>
      <i class="fas fa-times"></i>
    </button>
  </div>
```

- [ ] **Step 8: Style the search box**

In `public/styles.css`, section 3 (App shell), insert after the `.filter-row { ... }` rule and before `.sidebar-backdrop`:

```css
.text-filter {
    position: relative;
    display: flex;
    align-items: center;
}

.text-filter-icon {
    position: absolute;
    left: 11px;
    color: var(--text-muted);
    font-size: 13px;
    pointer-events: none;
}

.text-filter-input {
    width: 100%;
    padding: 8px 32px 8px 32px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    color: var(--text-color);
    font-family: inherit;
    font-size: 14px;
    line-height: inherit;
    appearance: none;
    -webkit-appearance: none;
    transition: border-color 0.2s ease;
}

/* The native cancel button is replaced by .text-filter-clear */
.text-filter-input::-webkit-search-cancel-button,
.text-filter-input::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
}

.text-filter-input::placeholder {
    color: var(--text-muted);
}

.text-filter-input:hover {
    border-color: var(--primary-color);
}

.text-filter-input:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px var(--focus-ring);
}

.text-filter-clear {
    position: absolute;
    right: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    font-size: 12px;
    cursor: pointer;
}

.text-filter-clear:hover {
    background-color: var(--surface-muted);
    color: var(--text-color);
}
```

- [ ] **Step 9: Wire the state, the URL and the controls in app.js**

In `public/app.js`:

a. Add the state variable after `let currentProject = null;`:

```js
let currentText = '';
```

b. Replace `currentFilters()` with:

```js
function currentFilters() {
    return {
        text: currentText,
        assignees: currentAssignees,
        reviewers: currentReviewers,
        sprints: currentSprints,
        fixVersions: currentFixVersions,
        sync: currentSync,
        ready: currentReadyForReviewer
    };
}
```

c. Replace `applyFilters()` with:

```js
// Runs the filter pass and refreshes everything that depends on it: the
// counters (inside filterBranches), the active-filter badge, the clear button
// and the attention count in the tab title.
function applyFilters() {
    const filters = currentFilters();
    const attentionCount = filterBranches(filters);
    updateActiveFilterBadge(countActiveFilters(filters));
    updateDocumentTitle({ project: currentProject, attentionCount });
}
```

d. Replace `clearAllFilters()` with:

```js
// Resets every filter control to its default and applies the result once.
// The project and the loaded SYNC statuses are kept.
function clearAllFilters() {
    const textFilter = document.getElementById('textFilter');
    if (textFilter) textFilter.value = '';
    ['sprintSelect', 'fixVersionSelect', 'assigneeSelect', 'reviewerSelect'].forEach(id => {
        const multiSelect = getMultiSelect(id);
        if (multiSelect) multiSelect.clearAll(false);
    });
    const readyCheck = document.getElementById('readyForReviewerCheck');
    if (readyCheck) readyCheck.checked = false;
    const syncSelect = document.getElementById('syncSelect');
    if (syncSelect) syncSelect.value = 'Show all';
    handleFilterChange();
}
```

e. Replace `updateUrlWithFilters()` with:

```js
// Writes the filters to the URL. `replace` swaps the current history entry
// instead of pushing one (used while typing in the search box).
function updateUrlWithFilters({ replace = false } = {}) {
    const url = new URL(window.location);

    // Clear existing multi-select params first
    url.searchParams.delete('assignee');
    url.searchParams.delete('reviewer');
    url.searchParams.delete('sprint');
    url.searchParams.delete('fixVersion');

    // Set project
    if (currentProject) {
        url.searchParams.set('project', currentProject);
    } else {
        url.searchParams.delete('project');
    }

    // Set the text filter
    const text = currentText.trim();
    if (text !== '') {
        url.searchParams.set('q', text);
    } else {
        url.searchParams.delete('q');
    }

    // Set multi-select params (use repeated params format)
    currentAssignees.forEach(v => url.searchParams.append('assignee', v));
    currentReviewers.forEach(v => url.searchParams.append('reviewer', v));
    currentSprints.forEach(v => url.searchParams.append('sprint', v));
    currentFixVersions.forEach(v => url.searchParams.append('fixVersion', v));

    // Set other params
    if (currentSync !== "Show all") {
        url.searchParams.set('sync', currentSync);
    } else {
        url.searchParams.delete('sync');
    }

    if (currentReadyForReviewer) {
        url.searchParams.set('ready', 'true');
    } else {
        url.searchParams.delete('ready');
    }

    // Update URL without reloading the page
    if (replace) {
        window.history.replaceState({}, '', url);
    } else {
        window.history.pushState({}, '', url);
    }
}
```

f. In `restoreFiltersFromUrl()`, add after `currentFixVersions = urlParams.getAll('fixVersion');`:

```js
    currentText = urlParams.get('q') || '';
```

and add at the very end of the function (after the `if (readyCheck) { ... }` block):

```js
    const textFilter = document.getElementById('textFilter');
    if (textFilter) textFilter.value = currentText;
    updateTextFilterClearButton();
```

g. In `handleProjectChange()`, inside `if (!isInitialLoad) {`: add `url.searchParams.delete('q');` next to the other `url.searchParams.delete(...)` calls, add `currentText = '';` next to `currentAssignees = [];`, and add after the four `clearAll(false)` calls:

```js
            const textFilter = document.getElementById('textFilter');
            if (textFilter) textFilter.value = '';
            updateTextFilterClearButton();
```

h. Replace `handleFilterChange()` (and the blank lines after it) with:

```js
// Copies the filter controls into the state variables
function readFilterControls() {
    const textFilter = document.getElementById('textFilter');
    const assigneeMultiSelect = getMultiSelect('assigneeSelect');
    const reviewerMultiSelect = getMultiSelect('reviewerSelect');
    const sprintMultiSelect = getMultiSelect('sprintSelect');
    const fixVersionMultiSelect = getMultiSelect('fixVersionSelect');

    currentText = textFilter ? textFilter.value : '';
    currentAssignees = assigneeMultiSelect ? assigneeMultiSelect.getSelectedValues() : [];
    currentReviewers = reviewerMultiSelect ? reviewerMultiSelect.getSelectedValues() : [];
    currentSprints = sprintMultiSelect ? sprintMultiSelect.getSelectedValues() : [];
    currentFixVersions = fixVersionMultiSelect ? fixVersionMultiSelect.getSelectedValues() : [];

    // Get sync and ready values from regular form elements
    const syncSelect = document.getElementById("syncSelect");
    const readyCheck = document.getElementById("readyForReviewerCheck");

    currentSync = syncSelect ? syncSelect.value : "Show all";
    currentReadyForReviewer = readyCheck ? readyCheck.checked : false;

    // Enable/disable checkbox based on reviewer selection (disabled when no reviewers selected)
    if (readyCheck) {
        readyCheck.disabled = currentReviewers.length === 0;
        if (currentReviewers.length === 0) {
            readyCheck.checked = false;
            currentReadyForReviewer = false;
        }
    }

    updateTextFilterClearButton();
}

function handleFilterChange() {
    readFilterControls();
    applyFilters();
    updateUrlWithFilters();
}

// Typing in the search box: same path, but the URL entry is replaced so the
// history does not gain an entry per keystroke
function handleTextFilterInput() {
    readFilterControls();
    applyFilters();
    updateUrlWithFilters({ replace: true });
}

function updateTextFilterClearButton() {
    const clearButton = document.getElementById('textFilterClear');
    if (clearButton) clearButton.hidden = currentText === '';
}

function initializeTextFilter() {
    const textFilter = document.getElementById('textFilter');
    const clearButton = document.getElementById('textFilterClear');
    if (!textFilter) return;
    textFilter.addEventListener('input', handleTextFilterInput);
    textFilter.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (textFilter.value !== '') {
            // Clear on Escape; the app shell leaves Escape to a filled text box
            event.preventDefault();
            textFilter.value = '';
            handleTextFilterInput();
        } else {
            textFilter.blur();
        }
    });
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            textFilter.value = '';
            handleTextFilterInput();
            textFilter.focus();
        });
    }
}
```

i. In the `DOMContentLoaded` listener, add `initializeTextFilter();` right after `initializeMultiSelects();`.

- [ ] **Step 10: Add the `/` shortcut and the Escape rule to app-shell.js**

In `public/app-shell.js`:

a. Add after `closeSidebarDrawer()`:

```js
/** Shows the sidebar if it is hidden: remembered in the wide layout, the drawer just opens. */
export function showSidebar() {
    if (isSidebarHidden()) {
        setSidebarHidden(false);
    }
}
```

b. Replace the keyboard section (from `function isTypingTarget` to the end of `handleKeydown`) with:

```js
function isTypingTarget(target) {
    return target instanceof Element &&
        (target.matches('input, select, textarea') || target.isContentEditable);
}

// A text box with content keeps Escape for itself: it clears the box
function isFilledTextBox(target) {
    return target instanceof HTMLInputElement &&
        (target.type === 'search' || target.type === 'text') &&
        target.value !== '';
}

function isHelpOpen() {
    const modal = document.getElementById('helpModal');
    return Boolean(modal) && !modal.hidden;
}

function focusTextFilter() {
    const input = document.getElementById('textFilter');
    if (!input) {
        return;
    }
    showSidebar();
    input.focus();
    input.select();
}

// Registered in the capture phase: an open multi-select is still open here and
// handles Escape itself, so the shell stays out of its way.
function handleKeydown(event) {
    if (document.querySelector('.multi-select.open')) {
        return;
    }

    if (event.key === 'Escape') {
        if (isFilledTextBox(event.target)) {
            return;
        }
        if (isHelpOpen()) {
            closeHelp();
        } else {
            closeSidebarDrawer();
        }
        return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target) || isHelpOpen()) {
        return;
    }
    if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleSidebar();
    } else if (event.key === '/') {
        event.preventDefault();
        focusTextFilter();
    }
}
```

- [ ] **Step 11: Check the app in the browser**

Run: `PORT=3101 node index.mjs --fixtures`, open http://localhost:3101/?project=SECOLLAB.

- Type `ai-mcp` in the search box: the tree narrows to the deep stack, counters show `n/total`, the badge on the sidebar button shows 1, "Clear filters" appears, the × button appears.
- Press Escape in the box: it empties and the tree comes back. Type again, click ×: same.
- Press `/` with the focus on the page: the box is focused (also after hiding the sidebar with `F`).
- Reload with `?project=SECOLLAB&q=mcp`: the box holds `mcp` and the tree is filtered; the browser back button after typing several characters goes back to the page before, not one character at a time.
- Toggle the theme: icon, input, placeholder and clear button are readable in both.

Stop the server with Ctrl+C.

- [ ] **Step 12: Run the tests and commit**

Run: `npm test`
Expected: `ℹ fail 0`

```bash
git add public/index.html public/styles.css public/app.js public/app-shell.js
git commit -m "feat: text filter in the sidebar, / shortcut, q URL parameter"
```

- [ ] **Step 13: Version 2.4.0 and documentation**

a. `package.json`: set `"version": "2.4.0"` and `"releaseDate": "2026-09-09"`.

b. `README.md`:

- In "Features", replace the line starting with `    * The sidebar can be hidden with the banner button or the` with:

```
    * The sidebar can be hidden with the banner button or the `F` key; the choice is remembered by the browser; `/` focuses the search box
```

- Insert before `* Provides an assignee filter`:

```
* Provides a text filter
    * Keeps the pull requests whose title, source branch name or linked issue keys contain every word typed (case-insensitive)
    * `/` focuses the search box, Escape clears it
```

- Replace `    * All filter selections (project, sprint, fixVersion, assignee, reviewer) are saved in the URL` with:

```
    * All filter selections (project, text, sprint, fixVersion, assignee, reviewer) are saved in the URL
```

- In "Changelog:", insert before `* Version 2.3.0`:

```
* Version 2.4.0
    * Text filter at the top of the sidebar: matches the pull-request title, the source branch name and the linked issue keys, every word typed must match
        * `/` focuses it, Escape clears it, restored from the URL (`q`), the URL is replaced while typing so the history stays clean
```

c. `CLAUDE.md`:

- Replace `- Advanced filtering (author, reviewer, sprint, sync status)` with `- Advanced filtering (text, sprint, fix version, assignee, reviewer, sync status)`.
- Replace `Current version: **2.3.0** (as of 2026-09-05)` with `Current version: **2.4.0** (as of 2026-09-09)`.
- In the `**public/app-filter.js**` block, replace the `buildFilterIndex` bullet with:

```
- `buildFilterIndex(apiResult)` (pure): one entry per pull request with its linked issues, the `searchText` the text filter searches (title, source branch, issue keys, lower-cased) and the sets of assignees, reviewers, sprint ids and fix version ids the filters compare against; built once per data load by `initializeFilter()`, which returns it
```

  and replace the `filterBranches(...)` bullet with:

```
- `filterBranches(filters)`: one walk of the rendered tree, direct children only, each pull request visited once; hides, highlights, sums the counters of repositories, root branches and child counters on the way back up, returns the attention count
- `parseTextQuery`, `matchesText`, `computeAttention`, `countActiveFilters` (pure)
```

- In the `**public/app-shell.js**` block, replace the sidebar toggle bullet with:

```
- Sidebar toggle (button, `F` key), stored in `localStorage` under `prTree.sidebarHidden` for the wide layout; below 900px the sidebar is a drawer that always starts closed; `/` shows the sidebar and focuses the search box; Escape is left to a text box that has content (it clears itself)
```

- In "Frontend State Management", add `let currentText = '';          // text filter` after `let currentProject = null;`, and replace the URL example with:

```
?project=PROJ&q=banner&author=John&reviewer=Jane&sprint=Sprint1&sync=requested&ready=true
```

- Replace the paragraph starting with `Every filter pass goes through` with:

```
Every filter pass goes through `applyFilters()` in app.js: it calls `filterBranches(filters)` (app-filter.js), then updates the active-filter badge and the tab title. `renderEverything(apiResult)` receives the data from its caller and applies the filters once every filter control has been populated and restored from the URL. `handleFilterChange()` reads the controls (`readFilterControls()`), applies and pushes the URL; the search box goes through `handleTextFilterInput()`, which replaces the URL instead of pushing it.
```

- In "Common Pitfalls", add:

```
10. **Search box and history**: the text filter writes the URL with `replaceState` (one history entry for a whole typing session); every other filter pushes
```

- In "Testing Approach", add `parseTextQuery`, `matchesText` to the list of pure functions covered by `npm test`.

d. `PRD.md`: in F4 requirements, add after F4.9:

```
- F4.10: Filter by text: title, source branch name and linked issue keys must contain every word typed
```

and in the 8.1 layout diagram, insert a line `|  Search        |                                                 |` right after the `| Filters  Clear |` line.

- [ ] **Step 14: Commit and open the pull request**

```bash
git add package.json README.md CLAUDE.md PRD.md
git commit -m "docs: version 2.4.0 and the text filter"
git push -u origin claude/filters-1-text
gh pr create --base claude/filters --title "feat: text filter (title, branch, issue keys)" --body "..."
```

PR body: what the filter matches, the `/` and Escape behaviour, the `q` parameter written with `replaceState`, the `filterBranches(filters)` signature change, what was verified (tests, browser checks of step 11). End with `Stacked on #<docs PR>` and the generated-with footer.

**Review follow-up (fourth commit, after the code-quality review):** `app.js` gained two module-level lists, `multiSelectIds` (the multi-select ids in sidebar order) and `filterUrlParams` (every URL parameter the filters write), and a `resetFilterControls()` that puts every control back to its default; `clearAllFilters()` is now reset + `handleFilterChange()`, `handleProjectChange()` deletes `filterUrlParams` then calls `resetFilterControls()` and `readFilterControls()`, `initializeMultiSelects()` creates one multi-select per id, and `updateUrlWithFilters()` deletes every parameter of the list before setting the active ones. `restoreFiltersFromUrl()` leaves the search box alone while it has the focus (the URL holds the trimmed query and the function runs on every render). The history update is wrapped in try/catch (Safari caps it at 100 per 30 s). The search box carries `role="search"` and a title with the `/` shortcut. Tasks 2 and 3 below are written against that code.

---

### Task 2: Epic filter

A multi-select of the epics found above the linked issues. The Jira hierarchy is interpreted in `app-filter.js` (`issueLevel`, `epicOf`); the server's parent fetch gains the fields that let a sub-task reach the epic of its parent story; the fixture generator gains epics.

**Files:**
- Modify: `public/app-filter.js`
- Modify: `test/app-filter.test.mjs`
- Modify: `index.mjs` (the parent fetch in `fetchJiraIssuesDetails`)
- Modify: `fixtures/generate.mjs`
- Modify: `test/fixtures.test.mjs`
- Modify: `public/index.html`
- Modify: `public/multi-select.js`
- Modify: `public/app.js`
- Modify: `README.md`, `CLAUDE.md`, `PRD.md`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b claude/filters-2-epic claude/filters-1-text
```

- [ ] **Step 2: Write the failing tests for the hierarchy and the epic match**

Extend the existing `countActiveFilters` test in `test/app-filter.test.mjs` with:

```js
    assert.equal(countActiveFilters({ ...defaults, epics: ['PROJ-100', 'PROJ-101'] }), 1);
```

Append at the end of the file:

```js
// ------------------------------------------------------------------ epic filter

import { issueLevel, epicOf } from '../public/app-filter.js';

const epicType = { name: 'Epic', subtask: false, hierarchyLevel: 1 };
const storyType = { name: 'Story', subtask: false, hierarchyLevel: 0 };
const bugType = { name: 'Bug', subtask: false, hierarchyLevel: 0 };
const subtaskType = { name: 'Sub-task', subtask: true, hierarchyLevel: -1 };

// Jira returns the parent with a few inline fields (summary, status, priority, issuetype)
const inlineEpicAi = { id: '1', key: 'PROJ-100', fields: { summary: 'Assistive AI', status: {}, priority: {}, issuetype: epicType } };
const inlineStoryChat = { id: '2', key: 'PROJ-200', fields: { summary: 'Chat panel', status: {}, priority: {}, issuetype: storyType } };

const epicAi = { key: 'PROJ-100', fields: { summary: 'Assistive AI', issuetype: epicType } };
const storyInEpic = { key: 'PROJ-200', fields: { summary: 'Chat panel', issuetype: storyType, parent: inlineEpicAi } };
const bugWithoutEpic = { key: 'PROJ-201', fields: { summary: 'Crash on save', issuetype: bugType } };
const subtaskOfStory = { key: 'PROJ-300', fields: { summary: 'Chat panel: API', issuetype: subtaskType, parent: inlineStoryChat } };
const subtaskOfUnknown = { key: 'PROJ-301', fields: { summary: 'Orphan work', issuetype: subtaskType, parent: { key: 'PROJ-999', fields: { summary: 'Unknown story', issuetype: storyType } } } };
const parentOnlyStory = { key: 'PROJ-202', fields: { fixVersions: [] } }; // fetched with fix versions only (older server)

test('issueLevel classifies epics, standard issues and sub-tasks, and defaults to standard', () => {
    assert.equal(issueLevel(epicAi), 'epic');
    assert.equal(issueLevel({ key: 'X-1', fields: { issuetype: { name: 'Epic' } } }), 'epic'); // no hierarchyLevel
    assert.equal(issueLevel(storyInEpic), 'standard');
    assert.equal(issueLevel(bugWithoutEpic), 'standard');
    assert.equal(issueLevel(subtaskOfStory), 'subtask');
    assert.equal(issueLevel({ key: 'X-2', fields: { issuetype: { name: 'Sub-task', subtask: true } } }), 'subtask');
    assert.equal(issueLevel(parentOnlyStory), 'standard');
});

test('epicOf resolves the epic itself, a direct epic parent and the epic of a sub-task parent', () => {
    const issuesByKey = new Map([epicAi, storyInEpic, bugWithoutEpic, subtaskOfStory, subtaskOfUnknown].map(issue => [issue.key, issue]));
    assert.deepEqual(epicOf(epicAi, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.deepEqual(epicOf(storyInEpic, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.deepEqual(epicOf(subtaskOfStory, issuesByKey), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.equal(epicOf(bugWithoutEpic, issuesByKey), null);
    assert.equal(epicOf(subtaskOfUnknown, issuesByKey), null); // the parent is not in the details
    assert.equal(epicOf(parentOnlyStory, issuesByKey), null);
});

test('epicOf needs the parent of the parent story, which the server now fetches for parent-only stories', () => {
    const parentOnlyWithEpic = { key: 'PROJ-202', fields: { summary: 'Search page', issuetype: storyType, fixVersions: [], parent: inlineEpicAi } };
    const subtask = { key: 'PROJ-302', fields: { summary: 'Search page: index', issuetype: subtaskType, parent: { key: 'PROJ-202', fields: { summary: 'Search page', issuetype: storyType } } } };
    assert.deepEqual(epicOf(subtask, new Map([[parentOnlyWithEpic.key, parentOnlyWithEpic]])), { key: 'PROJ-100', summary: 'Assistive AI' });
    assert.equal(epicOf(subtask, new Map([[parentOnlyStory.key, parentOnlyStory]])), null); // older server: no parent on the story
});

const hierarchyApiResult = {
    pullRequests: [
        { id: 20, title: 'PROJ-200 chat panel', source: { branch: { name: 'feature/PROJ-200' } }, author, participants: [] },
        { id: 21, title: 'PROJ-300 chat panel api', source: { branch: { name: 'feature/PROJ-300' } }, author, participants: [] },
        { id: 22, title: 'PROJ-201 crash on save', source: { branch: { name: 'bugfix/PROJ-201' } }, author, participants: [] },
        { id: 23, title: 'PROJ-100 epic branch', source: { branch: { name: 'feature/PROJ-100' } }, author, participants: [] }
    ],
    jiraIssuesMap: { 20: ['PROJ-200'], 21: ['PROJ-300'], 22: ['PROJ-201'], 23: ['PROJ-100'] },
    jiraIssuesDetails: [epicAi, storyInEpic, bugWithoutEpic, subtaskOfStory],
    sprintIssues: {}
};

test('buildFilterIndex collects the epics of every pull request and the list of epics', () => {
    const { pullRequestsById, epics } = buildFilterIndex(hierarchyApiResult);
    assert.deepEqual([...pullRequestsById.get(20).epics], ['PROJ-100']);
    assert.deepEqual([...pullRequestsById.get(21).epics], ['PROJ-100']); // through the parent story
    assert.deepEqual([...pullRequestsById.get(22).epics], []);
    assert.deepEqual([...pullRequestsById.get(23).epics], ['PROJ-100']); // linked to the epic itself
    assert.deepEqual([...epics.values()], [{ key: 'PROJ-100', summary: 'Assistive AI' }]);
    assert.equal(buildFilterIndex({}).epics.size, 0);
});

test('evaluatePullRequest epic filter matches any selected epic', () => {
    const { pullRequestsById } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, epics) => evaluatePullRequest(pullRequestsById.get(id), { ...noFilter, epics }, rendered).visible;
    assert.equal(evaluate(20, ['PROJ-100']), true);
    assert.equal(evaluate(21, ['PROJ-100']), true);
    assert.equal(evaluate(22, ['PROJ-100']), false);
    assert.equal(evaluate(22, []), true);
    assert.equal(evaluate(20, ['PROJ-999', 'PROJ-100']), true);
    assert.equal(evaluate(20, ['PROJ-999']), false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: failures on `issueLevel` / `epicOf` not exported and `epics` undefined; `ℹ fail` greater than 0.

- [ ] **Step 4: Implement the hierarchy and the epic match in app-filter.js**

In `public/app-filter.js`:

a. Replace `countActiveFilters` with:

```js
/**
 * Counts the filters that are not at their default value.
 * A multi-select with several values counts once.
 */
export function countActiveFilters({ text = '', assignees, reviewers, sprints, fixVersions, epics = [], sync, ready }) {
    return [
        parseTextQuery(text).length > 0,
        assignees.length > 0,
        reviewers.length > 0,
        sprints.length > 0,
        fixVersions.length > 0,
        epics.length > 0,
        ready === true,
        sync !== 'Show all'
    ].filter(Boolean).length;
}
```

b. Insert a new section between the text filter section and the attention section:

```js
// ---------------------------------------------------------- Jira hierarchy
// Jira Cloud: epic (hierarchyLevel 1) > standard issue (0) > sub-task (-1).
// Every issue carries fields.issuetype and, when it has one, fields.parent with
// the parent's key and inline fields (summary, status, priority, issuetype).
// This is the only place that interprets these fields.

/**
 * Level of an issue in the Jira hierarchy: 'epic', 'standard' or 'subtask'.
 * Issues without a type (parents fetched with fix versions only by an older
 * server) count as standard. Pure.
 */
export function issueLevel(issue) {
    const type = issue.fields && issue.fields.issuetype;
    if (!type) return 'standard';
    if (type.hierarchyLevel > 0 || type.name === 'Epic') return 'epic';
    if (type.subtask === true || type.hierarchyLevel < 0) return 'subtask';
    return 'standard';
}

// Key and summary of an issue or of an inline parent, as listed in the filters
function issueReference(issue) {
    return { key: issue.key, summary: (issue.fields && issue.fields.summary) || '' };
}

/**
 * The epic above an issue: the issue itself when it is an epic, its parent when
 * the parent is an epic, or the epic of its parent story when the issue is a
 * sub-task (the story is looked up in issuesByKey, where the server puts the
 * parents it fetched). Pure.
 * @returns {{ key: string, summary: string } | null}
 */
export function epicOf(issue, issuesByKey) {
    const level = issueLevel(issue);
    if (level === 'epic') return issueReference(issue);
    const parent = issue.fields && issue.fields.parent;
    if (!parent) return null;
    if (issueLevel(parent) === 'epic') return issueReference(parent);
    if (level === 'subtask') {
        const story = issuesByKey.get(parent.key);
        const grandParent = story && story.fields && story.fields.parent;
        if (grandParent && issueLevel(grandParent) === 'epic') return issueReference(grandParent);
    }
    return null;
}
```

c. In `buildFilterIndex`, update the JSDoc `@returns` to `{{ pullRequestsById: Map<number, object>, epics: Map<string, { key, summary }> }}`, then replace the loop and the return with:

```js
    const pullRequestsById = new Map();
    const epics = new Map();
    for (const pullRequest of pullRequests) {
        const issueKeys = jiraIssuesMap[pullRequest.id] || [];
        const linkedIssues = issueKeys.map(key => issuesByKey.get(key)).filter(issue => issue);
        const pullRequestEpics = linkedIssues.map(issue => epicOf(issue, issuesByKey)).filter(epic => epic);
        for (const epic of pullRequestEpics) {
            epics.set(epic.key, epic);
        }
        const entry = {
            pullRequest,
            linkedIssues,
            // What the text filter searches: title, source branch and issue keys
            searchText: [pullRequest.title, pullRequest.source?.branch?.name, ...issueKeys]
                .filter(Boolean).join(' ').toLowerCase(),
            assignees: new Set(linkedIssues
                .filter(issue => issue.fields.assignee && issue.fields.assignee.displayName)
                .map(issue => issue.fields.assignee.displayName)),
            reviewers: new Set(pullRequest.participants
                .filter(participant => participant.user.uuid !== pullRequest.author.uuid)
                .map(participant => participant.user.display_name)),
            sprints: new Set(issueKeys.flatMap(key => [...(sprintsByIssueKey.get(key) || [])])),
            fixVersions: new Set(linkedIssues
                .flatMap(issue => issue.fields.fixVersions || [])
                .map(version => String(version.id))),
            epics: new Set(pullRequestEpics.map(epic => epic.key))
        };
        pullRequestsById.set(pullRequest.id, entry);
    }

    return { pullRequestsById, epics };
```

d. In `evaluatePullRequest`, change the JSDoc filters line to `{ text, assignees, reviewers, sprints, fixVersions, epics, sync, ready }`, the signature to:

```js
export function evaluatePullRequest(entry, { text = '', assignees, reviewers, sprints, fixVersions, epics = [], sync, ready }, { statusInProgress, statusInReview, hasSyncLabel }) {
```

add after `fixVersionMatch`:

```js
    const epicMatch = epics.length === 0 || epics.some(key => entry.epics.has(key));
```

and include it in the result: `visible: textMatch && assigneeMatch && reviewerMatch && sprintMatch && fixVersionMatch && epicMatch && syncMatch && readyMatch,`.

e. In the `filterBranches` JSDoc, list the filters as `{ text, assignees, reviewers, sprints, fixVersions, epics, sync, ready }`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ fail 0`

- [ ] **Step 6: Commit**

```bash
git add public/app-filter.js test/app-filter.test.mjs
git commit -m "feat: epic filter logic (issueLevel, epicOf, epics in the index)"
```

- [ ] **Step 7: Fetch the hierarchy of parent issues on the server**

In `index.mjs`, function `fetchJiraIssuesDetails`, replace:

```js
    // Fetch missing parent issues to get their fix versions
    if (missingParentKeys.length > 0) {
        const parentJql = `key IN (${missingParentKeys.join(',')})`;
        const parentUrl = `${jiraBaseUrl}?jql=${encodeURIComponent(parentJql)}&fields=key,fixVersions`;
```

with:

```js
    // Fetch missing parent issues: their fix versions (inherited by sub-tasks)
    // and their summary, type and parent (epic and story filters)
    if (missingParentKeys.length > 0) {
        const parentJql = `key IN (${missingParentKeys.join(',')})`;
        const parentUrl = `${jiraBaseUrl}?jql=${encodeURIComponent(parentJql)}&fields=key,summary,issuetype,fixVersions,parent`;
```

Run: `node --check index.mjs` (no output means the file parses).

```bash
git add index.mjs
git commit -m "feat: fetch summary, type and parent of parent issues"
```

- [ ] **Step 8: Write the failing fixture test**

Append to `test/fixtures.test.mjs`:

```js
test('the SECOLLAB fixture carries epics and parent-only issues with their hierarchy', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const underAnEpic = data.jiraIssuesDetails.filter(issue => issue.fields.parent?.fields?.issuetype?.name === 'Epic');
    assert.ok(underAnEpic.length > 20, `${underAnEpic.length} issues under an epic`);
    for (const issue of data.jiraIssuesDetails) {
        if (issue.fields.issuetype) assert.equal(typeof issue.fields.issuetype.hierarchyLevel, 'number');
    }
    // Parent-only entries (no status: fetched as parents) carry summary, type, fix versions and parent
    const parentOnly = data.jiraIssuesDetails.filter(issue => !issue.fields.status);
    assert.ok(parentOnly.length > 0);
    for (const issue of parentOnly) {
        assert.equal(typeof issue.fields.summary, 'string');
        assert.ok(issue.fields.issuetype.name);
        assert.ok(Array.isArray(issue.fields.fixVersions));
    }
    assert.ok(parentOnly.some(issue => issue.fields.issuetype.name === 'Epic'), 'epics are fetched as parents');
    assert.ok(parentOnly.some(issue => issue.fields.parent), 'a parent-only story carries its epic');
    const { pullRequestsById, epics } = buildFilterIndex(data);
    assert.ok(epics.size >= 3, `${epics.size} epics`);
    const linkedToSubtask = [...pullRequestsById.values()].filter(entry => entry.linkedIssues.some(issue => issue.fields.issuetype.subtask));
    assert.ok(linkedToSubtask.length > 0);
    assert.ok(linkedToSubtask.some(entry => entry.epics.size > 0), 'a pull request linked to a sub-task reaches its epic');
});
```

Run: `npm test`
Expected: this test fails (`underAnEpic.length` is 0); everything else passes.

- [ ] **Step 9: Add epics to the fixture generator**

In `fixtures/generate.mjs`:

a. Insert right after the `createIssueNumbering` function (before `createIssue`):

```js
// Epics per Jira project; about 40% of the standard issues belong to one.
// Their keys use block 8 of the numbering, which no other generation uses.
const epicSummaries = {
    SECOLLAB: [
        'SECollab AI: assistive capability layer', 'Review workflow overhaul', 'DOORS synchronisation 2.0',
        'End-to-end tests since 2.7.0', 'Accessibility compliance'
    ],
    PRDOSLC: ['OSLC Connect for Windchill 1.5', 'Configuration management support', 'TRS provider'],
    WEBCMN: ['Design tokens migration', 'Session handling']
};

function createEpic(project, number, summary) {
    const key = `${project}-${number}`;
    return {
        id: String(10000 + number),
        key,
        self: `https://${jiraSiteName}.atlassian.net/rest/api/3/issue/${key}`,
        fields: {
            summary,
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            priority: { name: 'Medium', iconUrl: priorityIconUrl('#e97f33'), id: '3' },
            fixVersions: [],
            issuetype: { name: 'Epic', subtask: false, hierarchyLevel: 1 }
        }
    };
}

const epicIssues = Object.fromEntries(Object.entries(epicSummaries).map(([project, summaries]) =>
    [project, summaries.map((summary, index) => createEpic(project, (issueNumberBase[project] || 100) + 8000 + index + 1, summary))]
));

// The parent field as Jira returns it: the key and a few inline fields
function inlineParent(issue) {
    return {
        id: issue.id,
        key: issue.key,
        self: issue.self,
        fields: {
            summary: issue.fields.summary,
            status: issue.fields.status,
            priority: issue.fields.priority,
            issuetype: issue.fields.issuetype
        }
    };
}
```

b. Replace `createIssue` with:

```js
function createIssue(random, nextIssueNumber, project, { status, assignee, parent, type } = {}) {
    const key = `${project}-${nextIssueNumber(project)}`;
    const issueType = type || pickWeighted(random, issueTypes);
    const [priorityName, priorityColour] = pickWeighted(random, priorities.map(p => [[p[0], p[1]], p[2]]));
    const versions = fixVersionsByProject[project] || [];
    // Sub-tasks mostly inherit their fix version from the parent (the server does that too)
    const fixVersions = issueType === 'Sub-task' || random() < 0.25 ? [] : [pick(random, versions)];
    const assigneePerson = assignee === null ? null : (assignee || (random() < 0.85 ? pick(random, team) : null));
    // Sub-tasks get the parent they were given; standard issues belong to an epic 40% of the time
    const epics = epicIssues[project] || [];
    const parentIssue = parent || (issueType !== 'Sub-task' && random() < 0.4 && epics.length > 0 ? pick(random, epics) : null);
    return {
        id: String(10000 + Number(key.split('-')[1])),
        key,
        self: `https://${jiraSiteName}.atlassian.net/rest/api/3/issue/${key}`,
        fields: {
            summary: issueSummary(random, project),
            status: { name: status || pickWeighted(random, statuses), statusCategory: { key: 'indeterminate' } },
            priority: { name: priorityName, iconUrl: priorityIconUrl(priorityColour), id: String(priorities.findIndex(p => p[0] === priorityName) + 1) },
            fixVersions,
            assignee: assigneePerson ? assigneePerson.jira : null,
            issuetype: { name: issueType, subtask: issueType === 'Sub-task', hierarchyLevel: issueType === 'Sub-task' ? -1 : 0 },
            ...(parentIssue ? { parent: inlineParent(parentIssue) } : {})
        }
    };
}
```

c. In `generateRepository`, replace the sub-task parent choice:

```js
            if (type === 'Sub-task') {
                // Half of the parents are only known through the sub-task (fetched separately by the server)
                parent = random() < 0.5 && issues.length > 0 ? pick(random, issues) : createIssue(random, nextIssueNumber, project, { type: 'Story', status: 'In Progress' });
                if (!issues.includes(parent)) parentIssues.push(parent);
            }
```

with (a sub-task's parent is always a standard issue):

```js
            if (type === 'Sub-task') {
                // Half of the parents are only known through the sub-task (fetched separately by the server)
                const standardIssues = issues.filter(candidate => !candidate.fields.issuetype.subtask);
                parent = random() < 0.5 && standardIssues.length > 0 ? pick(random, standardIssues) : createIssue(random, nextIssueNumber, project, { type: 'Story', status: 'In Progress' });
                if (!issues.includes(parent)) parentIssues.push(parent);
            }
```

d. In `generateProjectData`, make the epics known so they are pushed as parent-only entries like the server does. Replace:

```js
    const knownIssues = new Map();
    for (const repoName of projectConfig.repositories) {
```

with:

```js
    const knownIssues = new Map();
    for (const epic of Object.values(epicIssues).flat()) {
        knownIssues.set(epic.key, epic);
    }
    for (const repoName of projectConfig.repositories) {
```

and replace the parent-only loop:

```js
    // Parents of sub-tasks are fetched by the server with their fix versions only
    for (const issue of [...jiraIssuesDetails]) {
        const parentKey = issue.fields.parent?.key;
        if (parentKey && !seen.has(parentKey) && knownIssues.has(parentKey)) {
            seen.add(parentKey);
            const parent = knownIssues.get(parentKey);
            jiraIssuesDetails.push({ id: parent.id, key: parent.key, self: parent.self, fields: { fixVersions: parent.fields.fixVersions } });
        }
    }
```

with:

```js
    // Parents (stories of sub-tasks, epics of standard issues) are fetched by the
    // server with their summary, type, fix versions and parent
    for (const issue of [...jiraIssuesDetails]) {
        const parentKey = issue.fields.parent?.key;
        if (parentKey && !seen.has(parentKey) && knownIssues.has(parentKey)) {
            seen.add(parentKey);
            const parent = knownIssues.get(parentKey);
            jiraIssuesDetails.push({
                id: parent.id,
                key: parent.key,
                self: parent.self,
                fields: {
                    summary: parent.fields.summary,
                    issuetype: parent.fields.issuetype,
                    fixVersions: parent.fields.fixVersions,
                    ...(parent.fields.parent ? { parent: parent.fields.parent } : {})
                }
            });
        }
    }
```

Also update the file header comment: after the sentence about sprints and fix versions, add `Standard issues belong to epics and sub-tasks to stories, as in Jira Cloud.`

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ fail 0`. The volume tests still pass (the counts do not depend on the random sequence). If `a parent-only story carries its epic` or `reaches its epic` fails with the fixed seed, raise the epic share in `createIssue` from `0.4` to `0.5` and run again.

- [ ] **Step 11: Commit**

```bash
git add fixtures/generate.mjs test/fixtures.test.mjs
git commit -m "feat: epics and issue hierarchy in the fixture data"
```

- [ ] **Step 12: Add the Epic multi-select and the option tooltip**

In `public/index.html`, insert after the Fix version `filter-item` block (the `</div>` that closes `<div class="filter-item">` containing `fixVersionSelect`) and before the Assignee block:

```html
  <div class="filter-item">
    <span class="filter-label">Epic
      <i class="fas fa-info-circle info-icon"
         title="Epic of the linked issues; for a sub-task, the epic of its parent story"></i>
    </span>
    <div class="multi-select" id="epicSelect" data-filter="epic">
      <div class="multi-select-trigger" tabindex="0">
        <span class="multi-select-display">Show all</span>
        <i class="fas fa-chevron-down multi-select-arrow"></i>
      </div>
      <div class="multi-select-dropdown">
        <div class="multi-select-search">
          <input type="text" placeholder="Search..." class="multi-select-search-input">
        </div>
        <div class="multi-select-options"></div>
        <div class="multi-select-actions">
          <button type="button" class="multi-select-clear">Clear all</button>
          <button type="button" class="multi-select-select-all">Select all</button>
        </div>
      </div>
    </div>
  </div>
```

In `public/multi-select.js`, `renderOptions()`, give the option label its full text as tooltip (labels are ellipsised): replace

```js
                    <span class="multi-select-option-label">${this.escapeHtml(opt.label)}</span>
```

with

```js
                    <span class="multi-select-option-label" title="${this.escapeHtml(opt.label)}">${this.escapeHtml(opt.label)}</span>
```

- [ ] **Step 13: Wire the epic filter in app.js**

In `public/app.js`:

a. Add `let currentEpics = [];` after `let currentFixVersions = [];`.

b. In `currentFilters()`, add `epics: currentEpics,` after the `fixVersions` line.

c. Add `'epicSelect'` to `multiSelectIds` (after `'fixVersionSelect'`) and `'epic'` to `filterUrlParams` (after `'fixVersion'`): this covers the multi-select creation, "Clear filters" and the project switch.

d. In `updateUrlWithFilters()`, add `currentEpics.forEach(v => url.searchParams.append('epic', v));` after the `fixVersion` append.

e. In `restoreFiltersFromUrl()`, add `currentEpics = urlParams.getAll('epic');` after the `fixVersion` line, and after the `fixVersionMultiSelect` restore block:

```js
    const epicMultiSelect = getMultiSelect('epicSelect');
    if (epicMultiSelect) {
        epicMultiSelect.setSelectedValues(currentEpics);
    }
```

f. Nothing to change in `handleProjectChange()`: it clears the URL through `filterUrlParams` and the controls through `resetFilterControls()` and `readFilterControls()`.

g. In `readFilterControls()`, add `const epicMultiSelect = getMultiSelect('epicSelect');` with the other lookups and `currentEpics = epicMultiSelect ? epicMultiSelect.getSelectedValues() : [];` after `currentFixVersions = ...`.

h. In `renderEverything()`, replace `initializeFilter(currentApiResult);` with `const filterIndex = initializeFilter(currentApiResult);` and add `populateEpicFilter(filterIndex.epics);` right after `populateFixVersionFilter(currentApiResult.jiraIssuesDetails);`.

i. Add after `populateFixVersionFilter`:

```js
// Options of an issue filter: "KEY Summary", newest issue first within each Jira project
function issueOptions(issues) {
    return [...issues.values()]
        .sort((a, b) => compareIssueKeys(a.key, b.key))
        .map(issue => ({ value: issue.key, label: `${issue.key} ${issue.summary}` }));
}

// Jira project alphabetically, then issue number descending
function compareIssueKeys(a, b) {
    const [projectA, numberA] = splitIssueKey(a);
    const [projectB, numberB] = splitIssueKey(b);
    return projectA.localeCompare(projectB) || numberB - numberA;
}

function splitIssueKey(key) {
    const dash = key.lastIndexOf('-');
    return [key.slice(0, dash), Number(key.slice(dash + 1))];
}

function populateEpicFilter(epics) {
    const epicMultiSelect = getMultiSelect('epicSelect');
    if (!epicMultiSelect) return;

    const options = issueOptions(epics);
    epicMultiSelect.setOptions(options);

    // Keep only the epics that exist in the options (the URL may carry unknown keys)
    const known = new Set(options.map(option => option.value));
    currentEpics = currentEpics.filter(key => known.has(key));
    epicMultiSelect.setSelectedValues(currentEpics);
}
```

j. Nothing to change in `initializeMultiSelects()`: it creates a multi-select for every id of `multiSelectIds`.

- [ ] **Step 14: Check the app in the browser**

Run: `PORT=3101 node index.mjs --fixtures`, open http://localhost:3101/?project=SECOLLAB.

- The Epic dropdown lists `SECOLLAB-128xx <summary>` options (and WEBCMN ones), newest first; hovering an option shows the full label.
- Select one epic: only its pull requests remain, including pull requests whose title links a sub-task (branch names contain the sub-task key); counters show `n/total`; the badge counts the epic filter; the URL has `epic=SECOLLAB-128xx`.
- Reload: the selection is restored. "Clear filters" empties it. Switching to OSLC clears it and lists the PRDOSLC/WEBCMN epics.
- Both themes.

Stop the server with Ctrl+C.

- [ ] **Step 15: Run the tests and commit**

Run: `npm test`
Expected: `ℹ fail 0`

```bash
git add public/index.html public/multi-select.js public/app.js
git commit -m "feat: epic filter in the sidebar, epic URL parameter"
```

- [ ] **Step 16: Documentation**

a. `README.md`:

- In "Features", insert after the text filter bullet block (before `* Provides an assignee filter`):

```
* Provides an epic filter
    * Keeps the pull requests whose linked issues belong to the selected epics; a pull request linked to a sub-task follows the epic of its parent story
```

- Replace `    * All filter selections (project, text, sprint, fixVersion, assignee, reviewer) are saved in the URL` with `    * All filter selections (project, text, sprint, fixVersion, epic, assignee, reviewer) are saved in the URL`.
- In the "Version 2.4.0" changelog block, add after the text filter lines:

```
    * Epic filter: pull requests of the selected epics, resolved through the parent story when the pull request is linked to a sub-task
        * The server now fetches the summary, type and parent of parent issues (previously their fix versions only)
        * Fixture data carries epics
```

b. `CLAUDE.md`:

- Replace `- Advanced filtering (text, sprint, fix version, assignee, reviewer, sync status)` with `- Advanced filtering (text, sprint, fix version, epic, assignee, reviewer, sync status)`.
- In the `**index.mjs**` block of "Key Files Explained", add a bullet:

```
- `fetchJiraIssuesDetails()` fetches the linked issues (summary, status, priority, fix versions, assignee, parent, issue type), then the parents that were not linked themselves (summary, issue type, fix versions, parent): sub-tasks inherit the fix versions of their parent, and the frontend resolves epics and stories from `parent`
```

- In the `**public/app-filter.js**` block, extend the `buildFilterIndex` bullet: after `fix version ids the filters compare against` insert `and the epic keys (`epics`), plus `index.epics`, the epics to list in the filter`; and replace the pure-function bullet with:

```
- `issueLevel`, `epicOf` (pure): the only code that interprets `issuetype` and `parent` (epic > standard issue > sub-task); a sub-task reaches its epic through its parent story, which the server fetches with its own `parent`
- `parseTextQuery`, `matchesText`, `computeAttention`, `countActiveFilters` (pure)
```

- In the `**fixtures/generate.mjs**` block, add a bullet: `- Epics per Jira project (`epicSummaries`, keys in numbering block 8): 40% of the standard issues have an epic parent, parents of sub-tasks are standard issues, parent-only entries carry summary, type, fix versions and parent like the server's`.
- In "Frontend State Management", add `let currentEpics = [];         // epic keys` after `currentFixVersions`, and add `&epic=PROJ-100` to the URL example after `&sprint=Sprint1`.
- In "Common Pitfalls", add: `11. **Jira hierarchy**: only `issueLevel`/`epicOf` in app-filter.js read `issuetype` and `parent`; parent-only issues (fetched as parents) have no status`.
- In "Testing Approach", add `issueLevel`, `epicOf` to the pure functions and `hierarchy` to the fixture generator coverage.

c. `PRD.md`:

- F3 requirements, add after F3.7: `- F3.8: Fetch the parent of linked issues, and the summary, type and parent of parent issues, so that sub-tasks reach their story and epic`.
- F4 requirements, add after F4.10: `- F4.11: Filter by epic (the epic above the linked issues, through the parent story for sub-tasks)`.
- 8.1 diagram: insert `|  Epic          |                                                 |` after the `|  Fix version   |` line.

- [ ] **Step 17: Commit and open the pull request**

```bash
git add README.md CLAUDE.md PRD.md
git commit -m "docs: epic filter"
git push -u origin claude/filters-2-epic
gh pr create --base claude/filters-1-text --title "feat: epic filter, resolved through sub-tasks" --body "..."
```

PR body: the resolution rules (epic itself, epic parent, epic of the parent story), the server fields change and why, the fixture epics, the option tooltip, what was verified (tests, browser checks of step 14). End with `Stacked on #<text PR>` and the generated-with footer.

- [ ] **Step 18 (orchestrator, optional): check the server change against real data**

With the user's `config.js` in place: `PORT=3002 node index.mjs`, then `curl -s http://localhost:3002/api/pull-requests/SECOLLAB > /private/tmp/claude-501/-Users-frej-Sites-pr-tree/fa03c818-2340-4f3b-8fb1-aecd87e2c6a0/scratchpad/secollab-after.json`; stop the server. Parent-only issues (`!fields.status`) now carry `summary`, `issuetype` and, for stories under an epic, `parent`; `buildFilterIndex` on that file yields more entries with a non-empty `epics` set than the 40 counted on 2026-09-09 (up to 56). One request per project only: the real server on port 3000 already polls Atlassian every two minutes.

---

### Task 3: Story filter

A multi-select of the stories delivered by the pull requests: the linked issue itself, or the parent of a linked sub-task. Same wiring as the epic filter.

**Files:**
- Modify: `public/app-filter.js`
- Modify: `test/app-filter.test.mjs`
- Modify: `test/fixtures.test.mjs`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `README.md`, `CLAUDE.md`, `PRD.md`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b claude/filters-3-story claude/filters-2-epic
```

- [ ] **Step 2: Write the failing tests**

Extend the existing `countActiveFilters` test in `test/app-filter.test.mjs` with:

```js
    assert.equal(countActiveFilters({ ...defaults, stories: ['PROJ-200'] }), 1);
```

Append at the end of `test/app-filter.test.mjs` (it reuses the issues and `hierarchyApiResult` of the epic section):

```js
// ----------------------------------------------------------------- story filter

import { storyOf } from '../public/app-filter.js';

test('storyOf is the issue itself, the parent of a sub-task, and nothing for an epic', () => {
    assert.deepEqual(storyOf(storyInEpic), { key: 'PROJ-200', summary: 'Chat panel' });
    assert.deepEqual(storyOf(bugWithoutEpic), { key: 'PROJ-201', summary: 'Crash on save' });
    assert.deepEqual(storyOf(subtaskOfStory), { key: 'PROJ-200', summary: 'Chat panel' });
    assert.deepEqual(storyOf(subtaskOfUnknown), { key: 'PROJ-999', summary: 'Unknown story' }); // the inline parent is enough
    assert.equal(storyOf(epicAi), null);
    assert.equal(storyOf({ key: 'PROJ-303', fields: { issuetype: subtaskType } }), null); // sub-task without parent
});

test('buildFilterIndex collects the stories of every pull request and the list of stories', () => {
    const { pullRequestsById, stories } = buildFilterIndex(hierarchyApiResult);
    assert.deepEqual([...pullRequestsById.get(20).stories], ['PROJ-200']);
    assert.deepEqual([...pullRequestsById.get(21).stories], ['PROJ-200']); // the parent of the sub-task
    assert.deepEqual([...pullRequestsById.get(22).stories], ['PROJ-201']);
    assert.deepEqual([...pullRequestsById.get(23).stories], []); // an epic is not a story
    assert.deepEqual([...stories.keys()], ['PROJ-200', 'PROJ-201']);
    assert.equal(buildFilterIndex({}).stories.size, 0);
});

test('evaluatePullRequest story filter matches any selected story', () => {
    const { pullRequestsById } = buildFilterIndex(hierarchyApiResult);
    const evaluate = (id, stories) => evaluatePullRequest(pullRequestsById.get(id), { ...noFilter, stories }, rendered).visible;
    assert.equal(evaluate(20, ['PROJ-200']), true);
    assert.equal(evaluate(21, ['PROJ-200']), true);
    assert.equal(evaluate(22, ['PROJ-200']), false);
    assert.equal(evaluate(22, ['PROJ-200', 'PROJ-201']), true);
    assert.equal(evaluate(23, ['PROJ-200']), false);
    assert.equal(evaluate(23, []), true);
});
```

Append to `test/fixtures.test.mjs`:

```js
test('the filter index resolves a story for every pull request linked to an issue', () => {
    const data = generateProjectData('SECOLLAB', projects.SECOLLAB);
    const { pullRequestsById, stories } = buildFilterIndex(data);
    const linked = [...pullRequestsById.values()].filter(entry => entry.linkedIssues.length > 0);
    assert.ok(linked.every(entry => entry.stories.size > 0));
    assert.ok(stories.size > 50, `${stories.size} stories`);
    const withSubtask = linked.find(entry => entry.linkedIssues.some(issue => issue.fields.issuetype.subtask));
    const subtask = withSubtask.linkedIssues.find(issue => issue.fields.issuetype.subtask);
    assert.ok(withSubtask.stories.has(subtask.fields.parent.key), 'the story of a sub-task is its parent');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: failures on `storyOf` not exported and `stories` undefined; `ℹ fail` greater than 0.

- [ ] **Step 4: Implement the story resolution and match in app-filter.js**

In `public/app-filter.js`:

a. In `countActiveFilters`, add `stories = []` to the destructured parameters (after `epics = []`) and `stories.length > 0,` after `epics.length > 0,`.

b. Insert after `epicOf`:

```js
/**
 * The story an issue belongs to: the issue itself when it is a standard issue,
 * its parent when it is a sub-task (the inline parent carries the key and the
 * summary), nothing for an epic. Pure.
 * @returns {{ key: string, summary: string } | null}
 */
export function storyOf(issue) {
    const level = issueLevel(issue);
    if (level === 'standard') return issueReference(issue);
    if (level === 'subtask' && issue.fields.parent) return issueReference(issue.fields.parent);
    return null;
}
```

c. In `buildFilterIndex`: JSDoc `@returns` becomes `{{ pullRequestsById: Map<number, object>, epics: Map<string, { key, summary }>, stories: Map<string, { key, summary }> }}`; add `const stories = new Map();` after `const epics = new Map();`; inside the loop, after the `pullRequestEpics` loop, add:

```js
        const pullRequestStories = linkedIssues.map(issue => storyOf(issue)).filter(story => story);
        for (const story of pullRequestStories) {
            stories.set(story.key, story);
        }
```

add `stories: new Set(pullRequestStories.map(story => story.key))` to the entry after `epics`, and return `{ pullRequestsById, epics, stories }`.

d. In `evaluatePullRequest`: JSDoc filters `{ text, assignees, reviewers, sprints, fixVersions, epics, stories, sync, ready }`; add `stories = []` after `epics = []` in the signature; add after `epicMatch`:

```js
    const storyMatch = stories.length === 0 || stories.some(key => entry.stories.has(key));
```

and include `storyMatch` in `visible` after `epicMatch`.

e. `filterBranches` JSDoc: add `stories` to the filters list.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ fail 0`

- [ ] **Step 6: Commit**

```bash
git add public/app-filter.js test/app-filter.test.mjs test/fixtures.test.mjs
git commit -m "feat: story filter logic (storyOf, stories in the index)"
```

- [ ] **Step 7: Add the Story multi-select**

In `public/index.html`, insert after the Epic `filter-item` block and before the Assignee block:

```html
  <div class="filter-item">
    <span class="filter-label">Story
      <i class="fas fa-info-circle info-icon"
         title="Issue delivered by the pull request: the linked issue, or the parent of a linked sub-task"></i>
    </span>
    <div class="multi-select" id="storySelect" data-filter="story">
      <div class="multi-select-trigger" tabindex="0">
        <span class="multi-select-display">Show all</span>
        <i class="fas fa-chevron-down multi-select-arrow"></i>
      </div>
      <div class="multi-select-dropdown">
        <div class="multi-select-search">
          <input type="text" placeholder="Search..." class="multi-select-search-input">
        </div>
        <div class="multi-select-options"></div>
        <div class="multi-select-actions">
          <button type="button" class="multi-select-clear">Clear all</button>
          <button type="button" class="multi-select-select-all">Select all</button>
        </div>
      </div>
    </div>
  </div>
```

- [ ] **Step 8: Wire the story filter in app.js**

In `public/app.js`, mirror the epic wiring:

a. Add `let currentStories = [];` after `let currentEpics = [];`.

b. In `currentFilters()`, add `stories: currentStories,` after `epics`.

c. Add `'storySelect'` to `multiSelectIds` (after `'epicSelect'`) and `'story'` to `filterUrlParams` (after `'epic'`).

d. In `updateUrlWithFilters()`, add `currentStories.forEach(v => url.searchParams.append('story', v));` after the `epic` append.

e. In `restoreFiltersFromUrl()`, add `currentStories = urlParams.getAll('story');` after the `epic` line, and after the `epicMultiSelect` restore block:

```js
    const storyMultiSelect = getMultiSelect('storySelect');
    if (storyMultiSelect) {
        storyMultiSelect.setSelectedValues(currentStories);
    }
```

f. Nothing to change in `handleProjectChange()`.

g. In `readFilterControls()`, add `const storyMultiSelect = getMultiSelect('storySelect');` and `currentStories = storyMultiSelect ? storyMultiSelect.getSelectedValues() : [];` after the epic lines.

h. In `renderEverything()`, add `populateStoryFilter(filterIndex.stories);` right after `populateEpicFilter(filterIndex.epics);`.

i. Add after `populateEpicFilter`:

```js
function populateStoryFilter(stories) {
    const storyMultiSelect = getMultiSelect('storySelect');
    if (!storyMultiSelect) return;

    const options = issueOptions(stories);
    storyMultiSelect.setOptions(options);

    // Keep only the stories that exist in the options (the URL may carry unknown keys)
    const known = new Set(options.map(option => option.value));
    currentStories = currentStories.filter(key => known.has(key));
    storyMultiSelect.setSelectedValues(currentStories);
}
```

j. Nothing to change in `initializeMultiSelects()`.

- [ ] **Step 9: Check the app in the browser**

Run: `PORT=3101 node index.mjs --fixtures`, open http://localhost:3101/?project=SECOLLAB.

- The Story dropdown lists `KEY Summary` options (tens of them), newest first, searchable by key or word.
- Select a story: its pull requests remain; a pull request whose branch carries a sub-task key appears under the parent story when that story is selected; the URL has `story=KEY`; reload restores it; "Clear filters" empties it; switching projects clears it.
- Epic and Story together narrow further (AND). Text, sprint, assignee and reviewer still work with them.
- Both themes.

Stop the server with Ctrl+C.

- [ ] **Step 10: Run the tests and commit**

Run: `npm test`
Expected: `ℹ fail 0`

```bash
git add public/index.html public/app.js
git commit -m "feat: story filter in the sidebar, story URL parameter"
```

- [ ] **Step 11: Documentation**

a. `README.md`:

- In "Features", insert after the epic filter bullet block:

```
* Provides a story filter
    * Keeps the pull requests delivering the selected issues: the linked issue itself, or the parent of a linked sub-task
```

- Replace `    * All filter selections (project, text, sprint, fixVersion, epic, assignee, reviewer) are saved in the URL` with `    * All filter selections (project, text, sprint, fixVersion, epic, story, assignee, reviewer) are saved in the URL`.
- In the "Version 2.4.0" changelog block, add after the epic lines:

```
    * Story filter: pull requests of the selected issues, the linked issue itself or the parent of a linked sub-task
```

b. `CLAUDE.md`:

- Replace `- Advanced filtering (text, sprint, fix version, epic, assignee, reviewer, sync status)` with `- Advanced filtering (text, sprint, fix version, epic, story, assignee, reviewer, sync status)`.
- In the `**public/app-filter.js**` block: in the `buildFilterIndex` bullet, replace `the epic keys (`epics`), plus `index.epics`, the epics to list in the filter` with `the epic and story keys (`epics`, `stories`), plus `index.epics` and `index.stories`, the values to list in the two filters`; replace `- `issueLevel`, `epicOf` (pure)` with `- `issueLevel`, `epicOf`, `storyOf` (pure)`.
- In "Frontend State Management", add `let currentStories = [];       // story keys` after `currentEpics`, and `&story=PROJ-200` after `&epic=PROJ-100` in the URL example.
- In "Common Pitfalls" item 11, replace `only `issueLevel`/`epicOf`` with `only `issueLevel`/`epicOf`/`storyOf``.
- In "Testing Approach", add `storyOf` to the pure functions.

c. `PRD.md`:

- F4 requirements, add after F4.11: `- F4.12: Filter by story (the linked issue, or the parent of a linked sub-task)`.
- 8.1 diagram: insert `|  Story         |                                                 |` after the `|  Epic          |` line.

- [ ] **Step 12: Commit and open the pull request**

```bash
git add README.md CLAUDE.md PRD.md
git commit -m "docs: story filter"
git push -u origin claude/filters-3-story
gh pr create --base claude/filters-2-epic --title "feat: story filter (linked issue or parent of a sub-task)" --body "..."
```

PR body: the resolution rule, the shared option helpers, what was verified (tests, browser checks of step 9). End with `Stacked on #<epic PR>` and the generated-with footer.

---

## Plan self-review

- **Spec coverage.** Section 5 (sidebar order): Task 1 step 7, Task 2 step 12, Task 3 step 7. Section 6 (text filter: control, matching, state and URL, plumbing): Task 1 steps 2 to 10. Section 7.1 (server): Task 2 step 7. Section 7.2 (client): Task 2 steps 2 to 6 and 12 to 13. Section 7.3 (fixtures): Task 2 steps 8 to 11. Section 8 (story): Task 3. Section 9 (code structure) and 10 (tests): each task's test steps. Section 11 (verification): steps 11, 14, 18 and 9. Section 12 (delivery): the workflow table and the PR steps.
- **Placeholders.** None: every code step carries its code; the PR bodies are described by content because their numbers are only known at execution time.
- **Type consistency.** `filterBranches(filters)` from Task 1 is what `applyFilters()` calls in every task. `initializeFilter` returns `{ pullRequestsById, epics }` after Task 2 and `{ pullRequestsById, epics, stories }` after Task 3; `renderEverything` reads `filterIndex.epics` / `filterIndex.stories`. `issueReference` is a private helper shared by `epicOf` and `storyOf`. `issueOptions`, `compareIssueKeys`, `splitIssueKey` are defined in Task 2 and reused in Task 3. The test constants of the epic section (`epicAi`, `storyInEpic`, `bugWithoutEpic`, `subtaskOfStory`, `subtaskOfUnknown`, `subtaskType`, `hierarchyApiResult`, `noFilter`, `rendered`) are the ones the story section reuses.
