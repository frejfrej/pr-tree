# Collapse the Repetition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hand-maintained repetition listed in issue #42: one filter registry, generated multi-select markup, option lists from the index, a filter pass that reads no DOM state, a smaller API response, one assembly module shared by the server and the fixtures, one request helper per Atlassian API, one delegated click listener. Version 2.11.0.

**Architecture:** Three new pure modules: `public/filter-registry.js` (the five multi-selects, the default filters), `public/pull-request-status.js` (the status band a pull request gets, computed once for the render and the filter index), `project-assembly.mjs` (the pure post-processing the server and the fixture generator both did). `app.js` keeps one `filters` object; `app-url.js` and `app-filter.js` loop over the registry; `renderRepositories` groups per repository; `project-data.mjs` fetches and calls the assembly; `fixtures/generate.mjs` generates and calls the same assembly. Eight commits, one per item of the issue, in its order.

**Tech Stack:** Vanilla ES modules in `public/`, Node ES modules on the server, `node:test`. No dependency change.

**Spec:** `docs/superpowers/specs/2026-09-16-collapse-repetition-design.md` (read section 3 before each task).

**Branch:** `claude/collapse-repetition`, created from `claude/badge-colour-tokens` (already checked out). Never `git add` `config.js`, `config.js.test`, `.claude/`, `sync-cache.json*` or `*.log`; add files by name. `index.mjs` is a CRLF file: keep its line endings (`grep -c $'\r' index.mjs` must equal `wc -l < index.mjs` after an edit); every other file touched here is LF. Commit messages end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

**Running the unit tests:** `npm test`, expected to end with `ℹ fail 0` (198 tests before Task 1; each task adds some). `node --test test/<file>.test.mjs` runs one file.

**Running the app for manual checks:** `PORT=3101 node index.mjs --fixtures` (port 3000 is the user's real server), then http://localhost:3101/?project=SECOLLAB. The browser checks are done by the controller after the last task; implementers run the unit tests only.

**Conventions (CLAUDE.md):** 4-space indent, single quotes in JavaScript, `const` by default, comments say why, JSDoc on exported functions, every Bitbucket or Jira text rendered goes through `escapeHtml`, `app-render.js` and `app-filter.js` touch no DOM at import time, `app-sync.js` never imports `app.js`.

---

### Task 1: One filter registry, one filters object (item 1)

**Files:**
- Create: `public/filter-registry.js`
- Create: `test/filter-registry.test.mjs`
- Modify: `public/app-url.js` (imports, `filterUrlParams`, `filtersFromUrl`, `urlWithFilters`)
- Modify: `public/app-filter.js` (imports, `countActiveFilters`, `matchesIssueFilters`)
- Modify: `public/app.js` (the state, and every function that reads or writes it)

- [ ] **Step 1: Write the failing registry test**

Create `test/filter-registry.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { multiSelectFilters, defaultFilters } from '../public/filter-registry.js';

test('the registry lists the five multi-selects in sidebar order, with unique keys, elements and URL parameters', () => {
    assert.deepEqual(multiSelectFilters.map(filter => filter.key), ['sprints', 'fixVersions', 'epics', 'stories', 'participants']);
    for (const property of ['key', 'elementId', 'urlParam']) {
        const values = multiSelectFilters.map(filter => filter[property]);
        assert.equal(new Set(values).size, values.length, `${property} values are unique`);
    }
});

test('every element of the registry is a multi-select of index.html', () => {
    const html = readFileSync(path.resolve(import.meta.dirname, '../public/index.html'), 'utf8');
    for (const { elementId } of multiSelectFilters) {
        assert.ok(html.includes(`class="multi-select" id="${elementId}"`), elementId);
    }
});

test('defaultFilters has the three scalar defaults and an empty, fresh selection per multi-select', () => {
    const filters = defaultFilters();
    assert.deepEqual(filters, { text: '', work: 'all', sync: 'Show all', sprints: [], fixVersions: [], epics: [], stories: [], participants: [] });
    assert.notEqual(defaultFilters().sprints, filters.sprints); // a new array each call
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/filter-registry.test.mjs`
Expected: fails with `Cannot find module '.../public/filter-registry.js'`.

- [ ] **Step 3: Create the registry**

Create `public/filter-registry.js`:

```js
/**
 * The multi-select filters of the sidebar, in sidebar order. `key` names the
 * filter in the filters object app.js keeps and in the filter index, where
 * the option list of the filter lives (app-filter.js); `elementId` is the
 * element of index.html; `urlParam` the URL parameter, repeated for several
 * values (?sprint=1&sprint=2). app.js, app-url.js and app-filter.js loop over
 * this list: a new multi-select filter is one row here, its element in
 * index.html, and its option list and the set of each index entry in
 * buildFilterIndex. Pure: nothing here reads the page.
 */
export const multiSelectFilters = [
    { key: 'sprints', elementId: 'sprintSelect', urlParam: 'sprint' },
    { key: 'fixVersions', elementId: 'fixVersionSelect', urlParam: 'fixVersion' },
    { key: 'epics', elementId: 'epicSelect', urlParam: 'epic' },
    { key: 'stories', elementId: 'storySelect', urlParam: 'story' },
    { key: 'participants', elementId: 'participantSelect', urlParam: 'participant' }
];

/**
 * The filters at their defaults, the shape every filters object has: the
 * text, the Work value ('all', 'reviews', 'issues', 'ready', 'reviewers' or
 * 'assignees'), the SYNC value and an empty selection per multi-select.
 * @returns {{ text: string, work: string, sync: string, sprints: string[], fixVersions: string[], epics: string[], stories: string[], participants: string[] }}
 */
export function defaultFilters() {
    const filters = { text: '', work: 'all', sync: 'Show all' };
    for (const { key } of multiSelectFilters) filters[key] = [];
    return filters;
}
```

- [ ] **Step 4: Run the registry test**

Run: `node --test test/filter-registry.test.mjs`
Expected: 3 pass.

- [ ] **Step 5: Loop in app-url.js**

Replace the top of `public/app-url.js` down to the end of `filtersFromUrl` with:

```js
/**
 * The project and the filters as URL parameters: what the address bar shows,
 * what a shared link carries and what Back and Forward put back. Pure: nothing
 * here reads the page. Multi-selects use repeated parameters (?participant=A&participant=B).
 */

import { multiSelectFilters, defaultFilters } from './filter-registry.js';

// Parameters written by the filters, and the former ones: assignee, reviewer,
// readyReviewer, readyAssignee and ready were the people filters before 2.8.0,
// never read any more, only ever removed when writing.
export const filterUrlParams = ['q', ...multiSelectFilters.map(filter => filter.urlParam), 'work', 'sync', 'assignee', 'reviewer', 'readyReviewer', 'readyAssignee', 'ready'];

// The values of the Work select besides 'all', its default
const workValues = ['reviews', 'issues', 'ready', 'reviewers', 'assignees'];

/**
 * The filters a query string describes, in the shape of defaultFilters().
 * @param {string} search - window.location.search, with or without the leading "?"
 * @returns {{ text: string, participants: string[], work: string, sprints: string[], fixVersions: string[], epics: string[], stories: string[], sync: string }} work is 'all', 'reviews', 'issues', 'ready', 'reviewers' or 'assignees'
 */
export function filtersFromUrl(search) {
    const params = new URLSearchParams(search);
    const filters = defaultFilters();
    filters.text = params.get('q') || '';
    const work = params.get('work');
    filters.work = workValues.includes(work) ? work : 'all';
    filters.sync = params.get('sync') || 'Show all';
    for (const { key, urlParam } of multiSelectFilters) filters[key] = params.getAll(urlParam);
    return filters;
}
```

In `urlWithFilters`, replace the five `filters.<key>.forEach(value => params.append('<param>', value));` lines with:

```js
    for (const { key, urlParam } of multiSelectFilters) filters[key].forEach(value => params.append(urlParam, value));
```

The order of the parameters written (q, sprint, fixVersion, epic, story, participant, work, sync) is the registry order, so `test/app-url.test.mjs` passes unchanged.

- [ ] **Step 6: Loop in app-filter.js**

In `public/app-filter.js`, add after the `counter-utils.js` import:

```js
import { multiSelectFilters } from './filter-registry.js';

// The multi-selects compared with the set of the index entry named like the
// filter; the participants have the Work select and their own rule
const issueFilters = multiSelectFilters.filter(filter => filter.key !== 'participants');
```

Replace `countActiveFilters` with:

```js
/**
 * Counts the filters that are not at their default value.
 * A multi-select with several values counts once.
 */
export function countActiveFilters(filters) {
    const { text = '', participants = [], work = 'all', sync } = filters;
    return [
        parseTextQuery(text).length > 0,
        ...multiSelectFilters.map(({ key }) => (filters[key] || []).length > 0),
        participants.length > 0 && work !== 'all',
        sync !== 'Show all'
    ].filter(Boolean).length;
}
```

Replace `matchesIssueFilters` with:

```js
// The filters an indexed pull request and an indexed orphaned issue share:
// the text, and any selected value of each multi-select but the participants
// (an empty selection matches everything)
function matchesIssueFilters(entry, filters) {
    if (!matchesText(entry.searchText, parseTextQuery(filters.text || ''))) return false;
    return issueFilters.every(({ key }) => {
        const selected = filters[key] || [];
        return selected.length === 0 || selected.some(value => entry[key].has(String(value)));
    });
}
```

- [ ] **Step 7: One filters object in app.js**

In `public/app.js`:

Add the import `import { multiSelectFilters, defaultFilters } from './filter-registry.js';` after the `app-url.js` import.

Replace the state block (from `let currentProject = null;` down to `const multiSelectIds = [...]` and the `currentFilters()` function, inclusive) with:

```js
let currentProject = null;
// The filters, in the shape of defaultFilters(): what the controls show, what
// the URL carries and what the filter pass applies
let filters = defaultFilters();
let currentApiResult = null;
let reloadInterval = 100;
```

Replace `applyFilters` with:

```js
// Runs the filter pass and refreshes everything that depends on it: the
// counters (inside filterBranches), the active-filter badge, the clear button
// and the attention count in the tab title.
function applyFilters() {
    const attentionCount = filterBranches(filters);
    updateActiveFilterBadge(countActiveFilters(filters));
    updateDocumentTitle({ project: currentProject, attentionCount });
}
```

In `resetFilterControls`, replace the `multiSelectIds.forEach(...)` block with:

```js
    for (const { elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        if (multiSelect) multiSelect.clearAll(false);
    }
```

Replace `clearFilterOptions` with:

```js
// Empties the option lists of the multi-selects, and their selections
// (setOptions keeps them), as before the first load
function clearFilterOptions() {
    for (const { elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        if (!multiSelect) continue;
        multiSelect.setOptions([]);
        multiSelect.clearAll(false);
    }
}
```

In `updateUrlWithFilters`, replace `filters: currentFilters()` with `filters`.

Replace `restoreFiltersFromUrl` (keep its comment) with:

```js
function restoreFiltersFromUrl({ preferTypedText = true } = {}) {
    const restored = filtersFromUrl(window.location.search);
    for (const { key, elementId } of multiSelectFilters) restored[key] = restoreMultiSelect(elementId, restored[key]);

    const syncSelect = document.getElementById('syncSelect');
    const syncOffered = syncSelect && Array.from(syncSelect.options).some(option => option.value === restored.sync);
    restored.sync = (syncStatusesLoaded() && syncOffered) ? restored.sync : 'Show all';
    if (syncSelect) syncSelect.value = restored.sync;

    const textFilter = document.getElementById('textFilter');
    const typing = textFilter && document.activeElement === textFilter;
    if (typing && (preferTypedText || textFilter.value.trim() === restored.text)) {
        restored.text = textFilter.value;
    } else if (textFilter) {
        textFilter.value = restored.text;
    }

    filters = restored;
    updateWorkSelect();
    updateTextFilterClearButton();
}
```

Replace `updateWorkSelect` with:

```js
// The Work select depends on the participants: while none is selected the
// state is back to "All work" (so a work=ready without a participant in
// the URL is dropped) and the select is disabled; otherwise it shows the state
function updateWorkSelect() {
    if (filters.participants.length === 0) filters.work = 'all';
    const workSelect = document.getElementById('workSelect');
    if (workSelect) {
        workSelect.disabled = filters.participants.length === 0;
        workSelect.value = filters.work;
    }
}
```

Replace `readFilterControls` with:

```js
// Copies the filter controls into the filters object and refreshes the
// controls that depend on them (the Work select, the clear button)
function readFilterControls() {
    const read = defaultFilters();
    const textFilter = document.getElementById('textFilter');
    read.text = textFilter ? textFilter.value : '';
    for (const { key, elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        read[key] = multiSelect ? multiSelect.getSelectedValues() : [];
    }
    // The Work and SYNC values come from regular select elements
    const workSelect = document.getElementById('workSelect');
    const syncSelect = document.getElementById('syncSelect');
    read.work = workSelect ? workSelect.value : 'all';
    read.sync = syncSelect ? syncSelect.value : 'Show all';
    filters = read;
    updateWorkSelect();
    updateTextFilterClearButton();
}
```

In `handleSyncLoadEnd`, replace `currentSync = 'Show all';` with `filters.sync = 'Show all';`. In `updateTextFilterClearButton`, replace `currentText === ''` with `filters.text === ''`. Replace `initializeMultiSelects` with:

```js
// Initialize multi-select components
function initializeMultiSelects() {
    for (const { elementId } of multiSelectFilters) createMultiSelect(elementId, { onChange: handleFilterChange });
}
```

In the `DOMContentLoaded` handler, replace `getSyncFilter: () => currentSync,` with `getSyncFilter: () => filters.sync,`.

Then search the file for `current(Text|Sprints|FixVersions|Epics|Stories|Participants|Work|Sync)\b` and `currentFilters` and `multiSelectIds`: nothing must be left. The `populate*` functions and their calls in `renderEverything` stay as they are for this task (Task 3 replaces them).

- [ ] **Step 8: Run every test**

Run: `npm test`
Expected: `ℹ fail 0`, 201 tests (198 + 3).

- [ ] **Step 9: Commit**

```bash
git add public/filter-registry.js test/filter-registry.test.mjs public/app-url.js public/app-filter.js public/app.js
git commit -m "refactor: one filter registry and one filters object instead of eight state variables (#42)" -m "..." 
```

Body of the message: the five multi-selects were listed by hand in app.js (state, read, restore, reset), app-url.js (parameters, read, write) and app-filter.js (count, match); filter-registry.js lists them once with their key, element and URL parameter, and app.js keeps one filters object in the shape of defaultFilters(). No behaviour change, the URLs written are byte-identical. End with the Co-Authored-By trailer.

---

### Task 2: Generated multi-select markup (item 2)

**Files:**
- Modify: `public/multi-select.js` (a markup constant, the constructor, the guards)
- Modify: `public/index.html` (the five `.multi-select` elements)

- [ ] **Step 1: The markup in multi-select.js**

In `public/multi-select.js`, add after the `htmlEscapes` constant:

```js
// The dropdown of every multi-select; the element in index.html is an empty
// <div class="multi-select" id="..."> and gets this markup at construction
const dropdownMarkup = `
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
    </div>`;
```

In the constructor, insert `this.element.innerHTML = dropdownMarkup;` right before `this.trigger = this.element.querySelector('.multi-select-trigger');`.

Every part always exists now: remove the guards. In `init()`, replace the `if (this.searchInput) { ... }`, `if (this.clearBtn) { ... }` and `if (this.selectAllBtn) { ... }` blocks with their bodies:

```js
        // Search functionality
        this.searchInput.addEventListener('input', (e) => {
            this.searchText = e.target.value.toLowerCase();
            this.renderOptions();
        });

        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });

        // Clear all button
        this.clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearAll();
        });

        // Select all button
        this.selectAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectAll();
        });
```

In `open()`, replace `if (this.searchInput) { this.searchInput.focus(); }` with `this.searchInput.focus();`. In `close()`, replace the `if (this.searchInput) { ... }` block with its body (`this.searchInput.value = '';`, `this.searchText = '';`, `this.renderOptions();`). Remove `if (!this.optionsContainer) return;` from `renderOptions()` and `if (!this.display) return;` from `updateDisplay()`.

Update the header comment of the class:

```js
/**
 * Multi-Select Component
 * A reusable multi-select dropdown component with checkbox-based selection.
 * The markup of the dropdown is generated: the page only declares an empty
 * element with the class and the id.
 */
```

- [ ] **Step 2: Empty elements in index.html**

In `public/index.html`, replace each of the five `<div class="multi-select" id="..." data-filter="...">...</div>` blocks (the whole element, from the opening tag to the `</div>` that closes it, keeping the surrounding `.filter-item` and `.filter-label`) with the empty element:

```html
    <div class="multi-select" id="sprintSelect"></div>
```

and likewise `fixVersionSelect`, `epicSelect`, `storySelect`, `participantSelect`. The `data-filter` attributes go (nothing reads them: `grep -rn 'data-filter\|dataset.filter' public/ test/` finds only these). Check with `grep -c 'multi-select-trigger' public/index.html`: 0.

- [ ] **Step 3: Run every test**

Run: `npm test`
Expected: `ℹ fail 0` (the registry test checks the five ids are still there; the server test serves the page).

- [ ] **Step 4: Commit**

```bash
git add public/multi-select.js public/index.html
git commit -m "refactor: the multi-select builds its dropdown markup (#42)" -m "index.html repeated the same 15-line dropdown five times; the MultiSelect constructor writes it into an empty element, and the guards on parts that always exist go. Same DOM, no behaviour change." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The index feeds every option list (item 3)

**Files:**
- Modify: `public/app-filter.js` (`buildFilterIndex`: the `sprints` input, two option builders, the returned lists)
- Modify: `public/app.js` (`renderEverything`, the four `populate*` functions go, the `issueOptions` import goes)
- Modify: `test/app-filter.test.mjs`, `test/fixtures.test.mjs` (the lists are option lists now)

- [ ] **Step 1: Write the failing tests**

In `test/app-filter.test.mjs`, add after the test `buildFilterIndex tolerates an empty result`:

```js
test('buildFilterIndex returns the option lists of the multi-selects under the registry keys, in display order', () => {
    const index = buildFilterIndex({
        ...sampleApiResult,
        sprints: [{ id: 5241, name: 'Sprint 143' }, { id: 5240, name: 'Sprint 142' }, { id: 100, name: 'Foundation 12' }],
        jiraIssuesDetails: [
            { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' }, fixVersions: [{ id: 100, name: '2.0' }, { id: 101, name: '1.0' }] } },
            { key: 'PROJ-2', fields: { assignee: null, fixVersions: [{ id: 100, name: '2.0' }] } }, // the same version once
            { key: 'ALPHA-7', fields: { fixVersions: [{ id: 300, name: '9.0' }] } } // a parent-only issue counts, sorted by project first
        ],
        orphanedIssues: [{ key: 'PROJ-9', fields: { summary: 'Nine', assignee: null, fixVersions: [{ id: 200, name: '3.0' }] } }]
    });
    assert.deepEqual(index.sprints, [{ value: '100', label: 'Foundation 12' }, { value: '5240', label: 'Sprint 142' }, { value: '5241', label: 'Sprint 143' }]);
    assert.deepEqual(index.fixVersions, [
        { value: '300', label: '9.0 (ALPHA)' },
        { value: '101', label: '1.0 (PROJ)' },
        { value: '100', label: '2.0 (PROJ)' },
        { value: '200', label: '3.0 (PROJ)' } // the orphaned issues bring theirs
    ]);
    assert.deepEqual(index.participants, [{ value: 'Bob', label: 'Bob' }, { value: 'Jane', label: 'Jane' }]);
    assert.deepEqual(index.epics, []);
    assert.deepEqual(buildFilterIndex({}).sprints, []);
    assert.deepEqual(buildFilterIndex({}).fixVersions, []);
});
```

Then adapt the assertions that read the former shapes (`index.participants` was a list of names, `index.epics` and `index.stories` Maps of `{ key, summary }`; they are `{ value, label }` lists now, epics and stories sorted by project then issue number descending like `issueOptions`):

- `buildFilterIndex lists the participants...`: `assert.deepEqual(buildFilterIndex(sampleApiResult).participants.map(option => option.value), ['Bob', 'Jane']);` and `assert.deepEqual(index.participants.map(option => option.value), ['Émile', 'Zoé']);`
- `buildFilterIndex tolerates an empty result`: unchanged (`[]`).
- `buildFilterIndex indexes the orphaned issues...`: `assert.deepEqual(index.epics.map(option => option.value), ['PROJ-500', 'PROJ-24']);`, `assert.deepEqual(index.stories.map(option => option.value).sort(), [...])`, `assert.deepEqual(index.participants.map(option => option.value), ['Bob', 'Jane']);`
- `buildFilterIndex resolves a parent that is itself an orphaned issue`: `assert.deepEqual(index.epics.map(option => option.value), ['PROJ-600']);`
- `buildFilterIndex collects the epics of every pull request and the list of epics`: `assert.deepEqual(epics, [{ value: 'PROJ-101', label: 'PROJ-101 UX' }, { value: 'PROJ-100', label: 'PROJ-100 Assistive AI' }]);` (newest first) and `assert.equal(buildFilterIndex({}).epics.length, 0);`
- `buildFilterIndex collects the stories ...`: `assert.deepEqual(stories.map(option => option.value), ['PROJ-203', 'PROJ-201', 'PROJ-200']);` and `.length`.

In `test/fixtures.test.mjs`: `epics.size` becomes `epics.length`, `stories.size` becomes `stories.length`, and in the participants test (`the filter index of the SECOLLAB fixture lists the fictional team as participants`) read the names with `participants.map(option => option.value)` wherever the test compares names (read the test, keep its intent).

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/app-filter.test.mjs`
Expected: the new test and the adapted ones fail (`index.sprints` is undefined, `map is not a function` on the Maps).

- [ ] **Step 3: The option lists in buildFilterIndex**

In `public/app-filter.js`, add before `buildFilterIndex` (after the `excludedParticipant` constant):

```js
// The sprint options: sorted by name, valued by id
function sprintOptions(sprints) {
    return [...sprints]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(sprint => ({ value: String(sprint.id), label: sprint.name }));
}

// The fix version options of the given issues: unique by id, sorted by Jira
// project (the prefix of the issue key) then by name, labelled "Name (PROJECT)"
function fixVersionOptions(issues) {
    const versions = new Map();
    for (const issue of issues) {
        const project = issue.key.split('-')[0];
        for (const version of issue.fields.fixVersions || []) {
            if (!versions.has(version.id)) versions.set(version.id, { id: version.id, name: version.name, project });
        }
    }
    return [...versions.values()]
        .sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name))
        .map(version => ({ value: String(version.id), label: `${version.name} (${version.project})` }));
}
```

Change the signature to `export function buildFilterIndex({ pullRequests = [], jiraIssuesMap = {}, jiraIssuesDetails = [], sprints = [], sprintIssues = {}, orphanedIssues = [] })`, its JSDoc `@returns` to `{{ pullRequestsById: Map<number, object>, orphanedIssuesByKey: Map<string, object>, sprints: { value, label }[], fixVersions: { value, label }[], epics: { value, label }[], stories: { value, label }[], participants: { value, label }[] }}` with the sentence "and, under the keys of the filter registry, the option list of each multi-select in display order", and the `return` at its end to:

```js
    return {
        pullRequestsById,
        orphanedIssuesByKey,
        // The option lists of the multi-selects, under the registry keys, in display order
        sprints: sprintOptions(sprints),
        fixVersions: fixVersionOptions([...jiraIssuesDetails, ...orphanedIssues]),
        epics: issueOptions(epics.values()),
        stories: issueOptions(stories.values()),
        participants: [...participants].sort((a, b) => a.localeCompare(b)).map(name => ({ value: name, label: name }))
    };
```

- [ ] **Step 4: One loop in renderEverything**

In `public/app.js`, replace the five lines `populateSprintFilter(...)` to `populateParticipantFilter(...)` in `renderEverything` with:

```js
    // The option lists come from the index, under the registry keys
    for (const { key, elementId } of multiSelectFilters) {
        const multiSelect = getMultiSelect(elementId);
        if (multiSelect) multiSelect.setOptions(filterIndex[key]);
    }
```

Delete `populateParticipantFilter`, `populateSprintFilter`, `populateFixVersionFilter` and `populateIssueFilter`, and remove `issueOptions` from the `app-filter.js` import.

- [ ] **Step 5: Run every test**

Run: `npm test`
Expected: `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add public/app-filter.js public/app.js test/app-filter.test.mjs test/fixtures.test.mjs
git commit -m "refactor: the filter index returns the option list of every multi-select (#42)" -m "The sprint and fix version lists were computed from the raw data by DOM code of app.js; buildFilterIndex returns, under each registry key, the sorted options of the multi-select, and renderEverything populates the five controls in one loop. The lists shown do not change; their sort rules are tested now." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Filter inputs from the index and the loaded statuses (item 4)

**Files:**
- Create: `public/pull-request-status.js`
- Create: `test/pull-request-status.test.mjs`
- Modify: `public/app-render.js` (`renderPullRequest`: the status band and the reviewers through the module)
- Modify: `public/app-filter.js` (`computeAttention`, the entry, `evaluatePullRequest`, `filterBranches`, `filterPullRequest`)
- Modify: `public/app-sync.js` (`loadedSyncStatuses`, header comment)
- Modify: `public/app.js` (`applyFilters`, the comment in `renderEverything`)
- Modify: `test/app-filter.test.mjs`, `test/fixtures.test.mjs`

- [ ] **Step 1: Write the failing status test**

Create `test/pull-request-status.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otherReviewers, statusClass } from '../public/pull-request-status.js';

const author = { uuid: 'author-uuid', display_name: 'Author' };
const jane = { uuid: 'jane-uuid', display_name: 'Jane' };
const rovoDev = { uuid: 'rovo-uuid', display_name: 'Rovo Dev' };
const pullRequest = (participants, approved = false) => ({
    author,
    participants: [{ user: author, approved: false }, ...participants.map(user => ({ user, approved }))]
});
const issue = status => ({ fields: { status: { name: status } } });

test('otherReviewers leaves out the author and Rovo Dev', () => {
    assert.deepEqual(otherReviewers(pullRequest([jane, rovoDev])).map(participant => participant.user.display_name), ['Jane']);
    assert.deepEqual(otherReviewers(pullRequest([])), []);
});

test('statusClass: in progress wins, then in review (all approved or not), then resolved', () => {
    assert.equal(statusClass(pullRequest([jane]), [issue('In Review'), issue('In Progress')]), 'status-in-progress');
    assert.equal(statusClass(pullRequest([jane]), [issue('In Review'), issue('Resolved')]), 'status-in-review');
    assert.equal(statusClass(pullRequest([jane], true), [issue('In Review')]), 'status-in-review-all-approved');
    assert.equal(statusClass(pullRequest([rovoDev], true), [issue('In Review')]), 'status-in-review'); // Rovo Dev is not a reviewer: nobody approved
    assert.equal(statusClass(pullRequest([]), [issue('In Review')]), 'status-in-review'); // no reviewer at all
    assert.equal(statusClass(pullRequest([jane]), [issue('Resolved'), issue('Closed')]), 'status-resolved');
    assert.equal(statusClass(pullRequest([jane]), [issue('Ready')]), '');
    assert.equal(statusClass(pullRequest([jane]), [{ fields: {} }]), ''); // an issue without a status
});

test('statusClass: no linked issues is resolved (every status of none), no issue list is no band', () => {
    assert.equal(statusClass(pullRequest([jane]), []), 'status-resolved');
    assert.equal(statusClass(pullRequest([jane]), null), '');
    assert.equal(statusClass(pullRequest([jane]), undefined), '');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/pull-request-status.test.mjs`
Expected: fails, module not found.

- [ ] **Step 3: Create the module**

Create `public/pull-request-status.js`:

```js
/**
 * The status band of a pull request: the class the tree paints on it, from
 * the statuses of its linked issues and the state of its reviews. The render
 * (app-render.js) and the filter index (app-filter.js) both call it, so the
 * band painted and the band the attention rule reads are one computation.
 * Pure: no DOM.
 */

// The Atlassian agent reviews pull requests too: never a reviewer to count
const excludedReviewer = 'Rovo Dev';

/** The participants other than the author and Rovo Dev: the reviewers the tree shows */
export function otherReviewers(pullRequest) {
    return pullRequest.participants.filter(participant =>
        participant.user.uuid !== pullRequest.author.uuid &&
        participant.user.display_name !== excludedReviewer);
}

/**
 * The class of the band: status-in-progress when a linked issue is in
 * progress; else, when one is in review, status-in-review-all-approved if
 * there are reviewers and every one approved, status-in-review otherwise;
 * else status-resolved when every linked issue is resolved or closed (a pull
 * request without any linked issue included, as it always was); an empty
 * string otherwise, and for a pull request the issue map does not know
 * (no list at all).
 * @param {object} pullRequest - a Bitbucket pull request
 * @param {object[] | null | undefined} linkedIssues - the Jira issues it links, with their status
 * @returns {string}
 */
export function statusClass(pullRequest, linkedIssues) {
    if (!linkedIssues) return '';
    const statuses = linkedIssues.map(issue => issue.fields.status && issue.fields.status.name);
    if (statuses.includes('In Progress')) return 'status-in-progress';
    if (statuses.includes('In Review')) {
        const reviewers = otherReviewers(pullRequest);
        const allApproved = reviewers.length > 0 && reviewers.every(participant => participant.approved);
        return allApproved ? 'status-in-review-all-approved' : 'status-in-review';
    }
    if (statuses.every(status => status === 'Resolved' || status === 'Closed')) return 'status-resolved';
    return '';
}
```

- [ ] **Step 4: Run the status test**

Run: `node --test test/pull-request-status.test.mjs`
Expected: 3 pass.

- [ ] **Step 5: The render uses the module**

In `public/app-render.js`, add at the top (after the header comment, before `escapeHtml`): `import { otherReviewers, statusClass } from './pull-request-status.js';`

In `renderPullRequest`, replace everything from `let approvedDetails = "";` down to the closing brace of `if (jiraIssues) { ... }` (the block that ends with the `alertsHtml` assignment) with:

```js
    let approvedDetails = "";
    let requestedChangesDetails = "";
    let notYetDecidedDetails = "";

    // The reviewers: every participant but the author and Rovo Dev
    const reviewers = otherReviewers(pullRequest);
    for (const participant of reviewers) {
        if (participant.approved) {
            approvedDetails += renderParticipant(participant.user, "approved");
        } else if (participant.state === "changes_requested") {
            requestedChangesDetails += renderParticipant(participant.user, "requestedChanges");
        } else {
            notYetDecidedDetails += renderParticipant(participant.user, "toReview");
        }
    }

    let noOtherParticipantsAlert = reviewers.length === 0 ?
        `<li><i class="fas fa-exclamation-triangle red" title="Pull request has no other participants"></i> Pull request has no other participants</li>` : '';

    // The linked issues, in the order of the map; null for a pull request the map does not know
    const jiraIssues = jiraIssuesMap["" + pullRequest.id];
    const linkedIssues = jiraIssues
        ? jiraIssues.map(issue => jiraIssuesDetails.find(details => details.key === issue)).filter(issueDetails => issueDetails)
        : null;
    // The band: one computation with the filter index (pull-request-status.js)
    const bandClass = statusClass(pullRequest, linkedIssues);

    let alertsHtml = "";
    let jiraIssuesHtml = "";
    if (linkedIssues) {
        const uniqueJiraIssuesStatuses = new Set(linkedIssues.map(issueDetails => issueDetails.fields.status.name));
        let sameStatusIcon = uniqueJiraIssuesStatuses.size > 1 ?
            `<li><i class="fas fa-exclamation-triangle red" title="JIRA issues have different statuses"></i> JIRA issues have different statuses</li>` : '';

        jiraIssuesHtml = linkedIssues.map(issueDetails => {
            return `<li>${renderPriority(issueDetails.fields.priority)}<a href="${issueUrl(jiraSiteName, issueDetails.key)}" target="_blank"
                       data-issue-key="${escapeHtml(issueDetails.key)}"
                       data-issue-summary="${escapeHtml(issueDetails.fields.summary)}"
                       class="jira-issue-link">
                       ${escapeHtml(issueDetails.key)} (${escapeHtml(issueDetails.fields.status.name)})
                    </a></li>`;
        }).join('');

        if (sameStatusIcon || noOtherParticipantsAlert) {
            alertsHtml = `
                <div class="warnings">
                    <ul>
                        ${sameStatusIcon}
                        ${noOtherParticipantsAlert}
                    </ul>
                </div>
            `;
        }
    }
```

and, further down in the same function, replace `<div class="pull-request ${statusClass}${isRootPullRequest ? ' pull-request-root' : ''}"` with `<div class="pull-request ${bandClass}${isRootPullRequest ? ' pull-request-root' : ''}"`. Run `node --test test/app-render.test.mjs`: every test passes (same output).

- [ ] **Step 6: Write the failing filter tests**

In `test/app-filter.test.mjs`:

The attention tests at the top use `computeAttention(entry, { ...inReview, participants })`; the booleans live in the entry now and the second argument is the participants. Replace the `entry` helper and the two constants with:

```js
// An index entry as buildFilterIndex makes it: the assignees of the linked
// issues, the reviewers who have not approved, and the status band
function entry({ assignees = [], pendingReviewers = [], statusInProgress = false, statusInReview = false } = {}) {
    return { assignees: new Set(assignees), pendingReviewers: new Set(pendingReviewers), statusInProgress, statusInReview };
}

const inReview = { statusInReview: true };
const inProgress = { statusInProgress: true };
```

and each call: `computeAttention(entry({ pendingReviewers: ['Jane'], ...inReview }), ['Jane'])` (the status spread into the entry, the participants as the second argument); the "no attention without a selected participant" test passes `[]`.

Give the sample issues a status so the index computes the band: in `sampleApiResult.jiraIssuesDetails`, `PROJ-1` gets `status: { name: 'In Review' }` and `PROJ-2` gets `status: { name: 'In Review' }`. Replace `const rendered = {...}` with a helper that indexes the sample with the linked issues in a given status:

```js
// The entry of pull request 10 with its linked issues in the given status (its reviewers: Jane pending, Bob approved)
function entryInStatus(status) {
    const details = sampleApiResult.jiraIssuesDetails.map(issue => ({ ...issue, fields: { ...issue.fields, status: { name: status } } }));
    return buildFilterIndex({ ...sampleApiResult, jiraIssuesDetails: details }).pullRequestsById.get(10);
}
```

Then, in every test that passed `rendered`, `inProgress` (`{ ...rendered, statusInProgress: true, statusInReview: false }`) or `neither` as the third argument of `evaluatePullRequest`: drop the third argument, and take the entry from `entryInStatus('In Review')`, `entryInStatus('In Progress')` or `entryInStatus('Ready')` instead of `pullRequestsById.get(10)`. Pull request 11 (no linked issue) keeps coming from `buildFilterIndex(sampleApiResult).pullRequestsById.get(11)`. Add to `buildFilterIndex links issues...`:

```js
    assert.equal(entry.statusInReview, true); // PROJ-1 and PROJ-2 are in review, Jane has not approved
    assert.equal(entry.statusInProgress, false);
    assert.equal(entry.syncKey, 'undefined/undefined..undefined'); // no repository nor commits in the sample: never a status
    assert.equal(bare.statusInReview, false);
```

and a test of the key on a full pull request:

```js
test('buildFilterIndex keys each pull request like the SYNC statuses response: repo/destHash..sourceHash', () => {
    const { pullRequestsById } = buildFilterIndex({
        pullRequests: [{ id: 13, title: 'x', author, participants: [], source: { branch: { name: 'f' }, commit: { hash: 'abc' }, repository: { name: 'repo-one' } }, destination: { branch: { name: 'main' }, commit: { hash: 'def' } } }],
        jiraIssuesMap: {}, jiraIssuesDetails: [], sprintIssues: {}
    });
    assert.equal(pullRequestsById.get(13).syncKey, 'repo-one/def..abc');
});
```

Replace the SYNC test with:

```js
test('evaluatePullRequest SYNC filter reads the loaded status: SYNC for conflicts, OK for none, unchecked for a failure or no status', () => {
    const entry = entryInStatus('In Review');
    const conflicts = { conflicts: true, files: ['a.txt'] };
    const partial = { conflicts: true, files: ['a.txt'], reason: 'timeout' }; // still a SYNC badge
    const clean = { conflicts: false };
    const failed = { error: true, reason: 'timeout' };
    const evaluate = (sync, status) => evaluatePullRequest(entry, { ...noFilter, sync }, status).visible;
    assert.deepEqual([conflicts, partial, clean, failed, undefined].map(status => evaluate('requested', status)), [true, true, false, false, false]);
    assert.deepEqual([conflicts, partial, clean, failed, undefined].map(status => evaluate('OK', status)), [false, false, true, false, false]);
    assert.deepEqual([conflicts, partial, clean, failed, undefined].map(status => evaluate('unchecked', status)), [false, false, false, true, true]);
    assert.deepEqual([conflicts, clean, failed, undefined].map(status => evaluate('Show all', status)), [true, true, true, true]);
});
```

In `test/fixtures.test.mjs`, the test `the chain depth option shortens the deepest stack` calls `evaluatePullRequest(entry, noFilter, rendered)`: remove the `rendered` constant and the third argument.

- [ ] **Step 7: Run them to see them fail**

Run: `node --test test/app-filter.test.mjs`
Expected: the attention tests fail (`participants.some is not a function`), the SYNC test fails.

- [ ] **Step 8: The index and the evaluation read the entry and the statuses**

In `public/app-filter.js`:

Add `import { statusClass } from './pull-request-status.js';` after the registry import.

Replace `computeAttention` (keep its JSDoc, update the parameters: `@param {{ assignees: Set<string>, pendingReviewers: Set<string>, statusInProgress: boolean, statusInReview: boolean }} entry` and `@param {string[]} participants - the selected participants`) with:

```js
export function computeAttention({ assignees, pendingReviewers, statusInProgress, statusInReview }, participants) {
    const assignee = statusInProgress === true && participants.some(name => assignees.has(name));
    const reviewer = statusInReview === true && participants.some(name => pendingReviewers.has(name));
    return { assignee, reviewer, any: assignee || reviewer };
}
```

In `buildFilterIndex`, after `const otherParticipants = ...`, add:

```js
        // The band the tree paints (pull-request-status.js): what the attention rule reads
        const band = statusClass(pullRequest, linkedIssues);
```

and in the `entry` object, after `linkedIssues,`:

```js
            statusInProgress: band === 'status-in-progress',
            statusInReview: band === 'status-in-review',
            // The key of this pull request in a SYNC statuses response (app-sync.js
            // paints from the same key; a missing hash gives one no response holds)
            syncKey: `${pullRequest.source?.repository?.name}/${pullRequest.destination?.commit?.hash}..${pullRequest.source?.commit?.hash}`,
```

Replace `evaluatePullRequest` with:

```js
/**
 * Applies the filters to one indexed pull request. Pure.
 * @param {object} entry - an entry of buildFilterIndex().pullRequestsById
 * @param {object} filters - { text, participants, work, sprints, fixVersions, epics, stories, sync };
 *   work is 'all', 'reviews', 'issues', 'ready', 'reviewers' or 'assignees' and only matters with participants selected
 * @param {object} [syncStatus] - the SYNC status of the pull request from the last load
 *   ({ conflicts, files?, reason? } or { error, reason }); undefined while none is loaded or known
 * @returns {{ visible: boolean, attention: { assignee, reviewer, any } }}
 */
export function evaluatePullRequest(entry, filters, syncStatus) {
    const { participants = [], work = 'all', sync } = filters;
    const attention = computeAttention(entry, participants);

    // Participants: without a selection, everybody's pull requests; with one, every
    // pull request a selected participant reviews ("All reviews"), has a linked
    // issue assigned to ("All issues") or either ("All work"), or only those
    // waiting for one of them as a reviewer, as an assignee, or either ("Ready
    // for participants")
    const reviews = () => participants.some(name => entry.reviewers.has(name));
    const issues = () => participants.some(name => entry.assignees.has(name));
    const participantMatch = participants.length === 0 ||
        (work === 'reviewers' ? attention.reviewer :
            work === 'assignees' ? attention.assignee :
                work === 'ready' ? attention.any :
                    work === 'reviews' ? reviews() :
                        work === 'issues' ? issues() :
                            reviews() || issues());
    // What the badges show: SYNC for a result with conflicts, OK for one without,
    // neither ("unchecked") for no result or a failure
    const checked = Boolean(syncStatus) && !syncStatus.error;
    const syncMatch = sync === 'Show all' ||
        (sync === 'requested' && checked && Boolean(syncStatus.conflicts)) ||
        (sync === 'OK' && checked && !syncStatus.conflicts) ||
        (sync === 'unchecked' && !checked);

    return {
        visible: matchesIssueFilters(entry, filters) && participantMatch && syncMatch,
        attention
    };
}
```

Replace the start of `filterBranches` (the JSDoc and the `pass` object) with:

```js
/**
 * Applies the filters to the rendered tree and refreshes the counters. A root
 * branch or a repository left without a visible pull request is hidden; while
 * every repository is hidden, the "nothing matches" message is shown instead.
 * The orphaned issues section, rendered as a repository block, is walked
 * apart: its rows are evaluated by issue key, its counter refreshed, and it
 * is hidden while no row is left; the attention of its visible rows is
 * counted. Everything a decision needs comes from the index and the loaded
 * SYNC statuses, nothing from what the tree shows.
 * @param {object} filters - { text, participants, work, sprints, fixVersions, epics, stories, sync }
 * @param {Record<string, object> | null} [syncStatuses] - the statuses of the last SYNC load by "repo/destHash..sourceHash", null while none is loaded
 * @returns {number} how many pull requests and orphaned issues are left shown and need attention
 */
export function filterBranches(filters, syncStatuses = null) {
    const pass = {
        filters,
        syncStatuses,
        index: filterIndex || buildFilterIndex({}),
        shownAttention: 0
    };
```

In `filterPullRequest`, replace the `if (entry) { ... }` block with:

```js
    if (entry) {
        // Attention and the SYNC match come from the index and the loaded statuses,
        // never from what a previous pass painted
        const syncStatus = pass.syncStatuses ? pass.syncStatuses[entry.syncKey] : undefined;
        const { visible, attention } = evaluatePullRequest(entry, pass.filters, syncStatus);
        isVisible = visible;
        pullRequestElement.classList.toggle('needs-attention', attention.any);
        if (visible && attention.any) {
            pass.shownAttention++;
        }
    }
```

Update the module header comment: the sentence about the DOM stays true; add "The SYNC statuses come from app-sync.js through app.js (filterBranches takes them), the status band from the index: the pass reads nothing back from the rendered tree."

In `public/app-sync.js`, add after `syncStatusesLoaded`:

```js
/** The statuses of the last load, by "repo/destHash..sourceHash"; null while none is loaded */
export function loadedSyncStatuses() {
    return currentSyncStatuses ? currentSyncStatuses.statuses : null;
}
```

and in its header comment replace "The SYNC filter (app-filter.js) relies on the painted badges." with "The SYNC filter (app-filter.js) reads the loaded statuses, which app.js passes to the filter pass (loadedSyncStatuses)."

In `public/app.js`: import `loadedSyncStatuses` from `./app-sync.js`; in `applyFilters`, `const attentionCount = filterBranches(filters, loadedSyncStatuses());`; in `renderEverything`, replace the comment above `applySyncStatuses();` with `// Re-paint the last loaded SYNC statuses (without fetching them again); the filters read the statuses themselves, so the order does not matter`.

- [ ] **Step 9: Run every test**

Run: `npm test`
Expected: `ℹ fail 0`.

- [ ] **Step 10: Commit**

```bash
git add public/pull-request-status.js test/pull-request-status.test.mjs public/app-render.js public/app-filter.js public/app-sync.js public/app.js test/app-filter.test.mjs test/fixtures.test.mjs
git commit -m "refactor: the filter pass reads the status band and the SYNC result from the data, not the DOM (#42)" -m "filterPullRequest read status-in-progress / status-in-review from the classes the render wrote and filterBranches collected the painted SYNC badges, so the badges had to be painted before the filters ran. pull-request-status.js computes the band once for the render and the index, each entry carries the two booleans and its key in the statuses response, and filterBranches takes the loaded statuses from app-sync.js. No behaviour change." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Drop `pullRequestsByDestination` from the API response (item 5)

**Files:**
- Modify: `project-data.mjs` (`fillPullRequestsMap` goes, the field goes)
- Modify: `fixtures/generate.mjs` (the map goes)
- Modify: `public/app-render.js` (`pullRequestsByDestination` helper, `renderRepositories` groups per repository)
- Modify: `public/app.js` (`renderEverything`)
- Modify: `test/app-render.test.mjs`, `test/project-data.test.mjs`, `test/fixtures.test.mjs`, `test/server.test.mjs`

- [ ] **Step 1: Write the failing render tests**

In `test/app-render.test.mjs`: import `pullRequestsByDestination` from `../public/app-render.js` too. Change `renderSample()` to `renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, 'site')`, the empty call to `renderRepositories([], {}, [], 'site')`, the review-states call to `renderRepositories([reviewed, resolved], issuesMap, details, 'site')` (delete its `byDest`), the hostile call to `renderRepositories([pullRequest(8, { repo: 'r"><b>', source: 'x', destination: 'y"z' })], {}, [], 'site')`. In the fixture test (`renderRepositories renders every pull request of the fixture projects once, deep stack included`), drop `byDest`, call `renderRepositories(data.pullRequests, data.jiraIssuesMap, data.jiraIssuesDetails, data.jiraSiteName)`, and count the children containers per repository: `assert.equal(count(html, '<div class="children">'), data.pullRequests.filter(pr => data.pullRequests.some(other => other.source.repository.name === pr.source.repository.name && other.destination.branch.name === pr.source.branch.name)).length, name);`. Add:

```js
test('pullRequestsByDestination groups by destination branch name, in order', () => {
    const map = pullRequestsByDestination(pullRequests);
    assert.deepEqual([...map.keys()], ['main', 'feat-a', 'develop']);
    assert.deepEqual(map.get('develop'), [approved, recent]);
    assert.equal(pullRequestsByDestination([]).size, 0);
});

test('renderRepositories groups per repository: two repositories sharing a branch name do not show each other\'s pull requests', () => {
    // repo-one: main <- develop (PR 7); repo-two: develop <- feat-x (PR 8). Before 2.11.0 PR 8 was rendered under PR 7 too.
    const trunk = pullRequest(7, { repo: 'repo-one', source: 'develop', destination: 'main' });
    const feature = pullRequest(8, { repo: 'repo-two', source: 'feat-x', destination: 'develop' });
    const html = renderRepositories([trunk, feature], {}, [], 'site');
    assert.equal(count(html, 'class="pull-request '), 2);
    assert.equal(count(html, '<div class="children">'), 0);
    assert.equal(count(html, 'title="0 descendant pull requests"'), 2);
    assert.equal(count(html, 'title="1 total pull request (including all descendants)"'), 2);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/app-render.test.mjs`
Expected: failures (`pullRequestsByDestination` is not exported; the four-argument calls render nothing sensible).

- [ ] **Step 3: The render groups per repository**

In `public/app-render.js`, add before `renderRepositories`:

```js
/**
 * The pull requests by destination branch name: the stacked pull requests of
 * a pull request are those whose destination is its source branch. Built per
 * repository, so two repositories sharing a branch name do not see each
 * other's pull requests.
 * @returns {Map<string, object[]>}
 */
export function pullRequestsByDestination(pullRequests) {
    const byDestination = new Map();
    for (const pullRequest of pullRequests) {
        const destination = pullRequest.destination.branch.name;
        if (!byDestination.has(destination)) byDestination.set(destination, []);
        byDestination.get(destination).push(pullRequest);
    }
    return byDestination;
}
```

Change the signature to `export function renderRepositories(pullRequests, jiraIssuesMap, jiraIssuesDetails, jiraSiteName)` and, in its loop, add `const byDestination = pullRequestsByDestination(repoPullRequests);` as the first statement and pass `byDestination` to `renderPullRequests(...)` where `pullRequestsByDestination` was passed. The parameter named `pullRequestsByDestination` of `renderPullRequests`, `renderPullRequest`, `calculateTotalPullRequests` and `calculateDescendants` now shadows the exported function: rename that parameter `byDestination` in those four functions (and their internal uses), leaving the exported names and behaviour as they are. Update the module header: "the tree is rendered per repository, the stacked pull requests found through the destination map of that repository".

In `public/app.js`, `renderEverything` calls `renderRepositories(currentApiResult.pullRequests, currentApiResult.jiraIssuesMap, currentApiResult.jiraIssuesDetails, currentApiResult.jiraSiteName)`.

- [ ] **Step 4: The server and the fixtures stop sending it**

In `project-data.mjs`: delete `fillPullRequestsMap` (the export) and, in `buildProjectData`, `let pullRequestsByDestination = new Map();`, the `fillPullRequestsMap(...)` call and the `pullRequestsByDestination: Object.fromEntries(...)` field. Update the module header comment (the destination map is no longer part of the response).

In `fixtures/generate.mjs`: delete the `pullRequestsByDestination` loop and the field of `data`.

In `test/project-data.test.mjs`: drop `fillPullRequestsMap` from the import and delete its test; in the calculateHash test keep the `lastRefreshTime: 'later'` extra and drop `pullRequestsByDestination: {}`; in the documented-shape test, remove `'pullRequestsByDestination'` from the sorted keys and delete the `Object.keys(data.pullRequestsByDestination)` assertion. In `test/server.test.mjs`, remove `'pullRequestsByDestination'` from the sorted keys and the `data.pullRequestsByDestination[...]` assertion of the loop. In `test/fixtures.test.mjs`, `deepestStack` builds its own map:

```js
function deepestStack(data) {
    const byDestination = new Map();
    for (const pr of data.pullRequests) {
        if (!byDestination.has(pr.destination.branch.name)) byDestination.set(pr.destination.branch.name, []);
        byDestination.get(pr.destination.branch.name).push(pr);
    }
    const depth = pr => {
        const children = byDestination.get(pr.source.branch.name);
        return children ? 1 + Math.max(...children.map(depth)) : 1;
    };
    const roots = data.pullRequests.filter(pr => !data.pullRequests.some(other => other.source.branch.name === pr.destination.branch.name));
    return Math.max(...roots.map(depth));
}
```

and the deep-stack test checks `assert.equal(data.pullRequests.filter(pr => pr.destination.branch.name === 'feat/ai_investigations').length, 1);` instead of reading the map.

- [ ] **Step 5: Run every test**

Run: `npm test`
Expected: `ℹ fail 0`.

- [ ] **Step 6: Commit**

```bash
git add project-data.mjs fixtures/generate.mjs public/app-render.js public/app.js test/app-render.test.mjs test/project-data.test.mjs test/fixtures.test.mjs test/server.test.mjs
git commit -m "feat: the project response no longer carries pullRequestsByDestination (#42)" -m "Every pull request was serialized twice, once in pullRequests and once under its destination branch, and the map was keyed by branch name across repositories, so two repositories sharing a branch name showed each other's pull requests under it. The tree groups per repository itself. Measured on the fixture server: SECOLLAB 1.62 MB to 0.91 MB, OSLC 0.35 MB to 0.20 MB." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: One assembly for the server and the fixtures (item 6)

**Files:**
- Create: `project-assembly.mjs`
- Create: `test/project-assembly.test.mjs`
- Modify: `project-data.mjs` (imports, `fetchJiraIssuesDetails`, `fetchParentIssues` replaces `completeParents`, `buildProjectData`)
- Modify: `fixtures/generate.mjs` (imports, `generateProjectData`, the five copies go)
- Modify: `test/project-data.test.mjs` (the pure tests move, the inheritance test goes through `buildProjectData`)

- [ ] **Step 1: Write the failing assembly tests**

Create `test/project-assembly.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJiraIssues, createJiraIssuesMap, missingParentKeys, inheritFixVersions, calculateHash, assembleProjectData } from '../project-assembly.mjs';

const jiraRegex = /(PROJ-\d+|OTHER-\d+)/g;
function pullRequest(id, title = `PROJ-${id} change ${id}`) {
    return { id, title, source: { branch: { name: `feat-${id}` }, commit: { hash: `s${id}` }, repository: { name: 'repo-a' } }, destination: { branch: { name: 'master' }, commit: { hash: `d${id}` } } };
}
function issue(key, { parent = null, fixVersions = [] } = {}) {
    const fields = { summary: `Summary of ${key}`, fixVersions };
    if (parent) fields.parent = { key: parent };
    return { key, fields };
}
const version = name => ({ id: name, name });

test('extractJiraIssues finds the keys of the project regex in a title, in order, repeats included', () => {
    assert.deepEqual(extractJiraIssues('PROJ-12 and OTHER-3 but not FOO-4 or proj-5', jiraRegex), ['PROJ-12', 'OTHER-3']);
    assert.deepEqual(extractJiraIssues('no key', jiraRegex), []);
    const map = createJiraIssuesMap([pullRequest(1, 'PROJ-1 PROJ-1 twice'), pullRequest(2, 'nothing')], jiraRegex);
    assert.deepEqual([...map], [[1, ['PROJ-1', 'PROJ-1']], [2, []]]);
});

test('missingParentKeys lists the parents named but absent, once each, in first-seen order', () => {
    const issues = [issue('A-1', { parent: 'A-500' }), issue('A-2', { parent: 'A-500' }), issue('A-3', { parent: 'A-4' }), issue('A-4'), issue('A-5', { parent: 'A-501' })];
    assert.deepEqual(missingParentKeys(issues), ['A-500', 'A-501']);
    assert.deepEqual(missingParentKeys([]), []);
});

test('inheritFixVersions gives an issue without versions its parent\'s, in array order: epic to story to sub-task when the story comes first', () => {
    const epic = issue('A-1', { fixVersions: [version('2.0')] });
    const story = issue('A-10', { parent: 'A-1' });
    const subTask = issue('A-11', { parent: 'A-10' });
    const own = issue('A-12', { parent: 'A-10', fixVersions: [version('3.0')] });
    const orphanParent = issue('A-13', { parent: 'A-14' });
    const bare = issue('A-14');
    inheritFixVersions([story, subTask, own, orphanParent, bare, epic]); // the epic last, as a parent fetched after the issues
    const versions = Object.fromEntries([epic, story, subTask, own, orphanParent, bare].map(i => [i.key, i.fields.fixVersions.map(v => v.name)]));
    assert.deepEqual(versions, { 'A-1': ['2.0'], 'A-10': ['2.0'], 'A-11': ['2.0'], 'A-12': ['3.0'], 'A-13': [], 'A-14': [] });
    // The sub-task before its story gets nothing: the story has no version yet when the sub-task is visited
    const late = issue('B-11', { parent: 'B-10' }), lateStory = issue('B-10', { parent: 'B-1' }), lateEpic = issue('B-1', { fixVersions: [version('1.0')] });
    inheritFixVersions([late, lateStory, lateEpic]);
    assert.deepEqual([late, lateStory].map(i => i.fields.fixVersions.length), [0, 1]);
});

test('calculateHash is stable for the same data and changes when a commit moves or an orphaned issue appears', () => {
    const data = () => ({
        pullRequests: [pullRequest(1)], jiraIssuesMap: { 1: ['PROJ-1'] }, jiraIssuesDetails: [issue('PROJ-1')],
        sprints: [{ id: 1, name: 'S1' }], sprintIssues: { 1: ['PROJ-1'] }, orphanedIssues: []
    });
    const hash = calculateHash(data());
    assert.match(hash, /^[0-9a-f]{32}$/);
    assert.equal(calculateHash(data()), hash);
    assert.equal(calculateHash({ ...data(), lastRefreshTime: 'later', jiraSiteName: 'elsewhere' }), hash); // not part of the hash
    const moved = data();
    moved.pullRequests[0].source.commit.hash = 's1-moved';
    assert.notEqual(calculateHash(moved), hash);
    const orphan = data();
    orphan.orphanedIssues.push(issue('PROJ-9'));
    assert.notEqual(calculateHash(orphan), hash);
});

test('assembleProjectData inherits the versions over the details, the orphaned issues then the parents, appends the parents and hashes the result', () => {
    const pullRequests = [pullRequest(1), pullRequest(2)];
    const jiraIssuesMap = createJiraIssuesMap(pullRequests, jiraRegex);
    const linked = issue('PROJ-1', { parent: 'PROJ-100' });
    const orphaned = issue('PROJ-9', { parent: 'PROJ-100' });
    const parent = issue('PROJ-100', { fixVersions: [version('2.0')] });
    const sprints = [{ id: 5, name: 'S5' }];
    const sprintIssues = { 5: ['PROJ-1'] };
    const data = assembleProjectData({ pullRequests, jiraIssuesMap, jiraIssuesDetails: [linked], parents: [parent], orphanedIssues: [orphaned], sprints, sprintIssues, jiraSiteName: 'site' });
    assert.deepEqual(Object.keys(data).sort(), ['dataHash', 'jiraIssuesDetails', 'jiraIssuesMap', 'jiraSiteName', 'orphanedIssues', 'pullRequests', 'sprintIssues', 'sprints']);
    assert.equal(data.pullRequests, pullRequests);
    assert.deepEqual(data.jiraIssuesMap, { 1: ['PROJ-1'], 2: ['PROJ-2'] }); // a plain object
    assert.deepEqual(data.jiraIssuesDetails.map(i => i.key), ['PROJ-1', 'PROJ-100']);
    assert.deepEqual(data.jiraIssuesDetails[0].fields.fixVersions.map(v => v.name), ['2.0']);
    assert.deepEqual(data.orphanedIssues[0].fields.fixVersions.map(v => v.name), ['2.0']); // in place
    assert.deepEqual([data.jiraSiteName, data.sprints, data.sprintIssues], ['site', sprints, sprintIssues]);
    assert.equal(data.dataHash, calculateHash(data));
    // Without parents, orphaned issues, sprints
    const bare = assembleProjectData({ pullRequests: [], jiraIssuesMap: new Map(), jiraIssuesDetails: [], jiraSiteName: 'site' });
    assert.deepEqual([bare.jiraIssuesDetails, bare.orphanedIssues, bare.sprints, bare.sprintIssues], [[], [], [], {}]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/project-assembly.test.mjs`
Expected: module not found.

- [ ] **Step 3: Create the module**

Create `project-assembly.mjs`:

```js
import crypto from 'crypto';

/**
 * The pure part of a project's data: what the server (project-data.mjs)
 * computes once the Atlassian responses are in, and what the fixture
 * generator (fixtures/generate.mjs) computes on the data it makes up, so the
 * two responses have one shape and one hash. Nothing here fetches anything.
 */

/** The issue keys of the project regex found in a title, in order, repeats included */
export function extractJiraIssues(title, jiraRegex) {
    return title.match(jiraRegex) || [];
}

/**
 * The issue keys of every pull request, by pull request id.
 * @returns {Map<number, string[]>}
 */
export function createJiraIssuesMap(pullRequests, jiraRegex) {
    const jiraIssuesMap = new Map();
    for (const pullRequest of pullRequests) {
        jiraIssuesMap.set(pullRequest.id, extractJiraIssues(pullRequest.title, jiraRegex));
    }
    return jiraIssuesMap;
}

/** The parent keys the issues name that are in none of them, in first-seen order, once each: what has to be fetched */
export function missingParentKeys(issues) {
    const known = new Set(issues.map(issue => issue.key));
    const missing = [];
    for (const issue of issues) {
        const parentKey = issue.fields.parent && issue.fields.parent.key;
        if (parentKey && !known.has(parentKey) && !missing.includes(parentKey)) missing.push(parentKey);
    }
    return missing;
}

/**
 * Lets an issue without fix versions take its parent's, in place, in array
 * order (a version travels epic -> story -> sub-task when the story comes
 * before the sub-task); the parent is looked up among the issues given.
 */
export function inheritFixVersions(issues) {
    const byKey = new Map(issues.map(issue => [issue.key, issue]));
    for (const issue of issues) {
        if (issue.fields.parent && (!issue.fields.fixVersions || issue.fields.fixVersions.length === 0)) {
            const parent = byKey.get(issue.fields.parent.key);
            if (parent && parent.fields.fixVersions && parent.fields.fixVersions.length > 0) {
                issue.fields.fixVersions = parent.fields.fixVersions;
            }
        }
    }
}

/** The MD5 of what the frontend compares to know whether anything changed */
export function calculateHash(data) {
    const hash = crypto.createHash('md5');
    hash.update(JSON.stringify({
        pullRequests: data.pullRequests,
        jiraIssuesMap: data.jiraIssuesMap,
        jiraIssuesDetails: data.jiraIssuesDetails,
        sprints: data.sprints,
        sprintIssues: data.sprintIssues,
        orphanedIssues: data.orphanedIssues
    }));
    return hash.digest('hex');
}

/**
 * The response of /api/pull-requests/:project without its lastRefreshTime:
 * the fix versions inherited over the linked issues, the orphaned issues then
 * the parents (in place), the parents appended to the details, the hash.
 * @param {object} parts
 * @param {object[]} parts.pullRequests
 * @param {Map<number, string[]>} parts.jiraIssuesMap - by pull request id (createJiraIssuesMap)
 * @param {object[]} parts.jiraIssuesDetails - the linked issues
 * @param {object[]} [parts.parents] - the parents fetched for them and for the orphaned issues
 * @param {object[]} [parts.orphanedIssues]
 * @param {{ id: number, name: string }[]} [parts.sprints]
 * @param {Record<string, string[]>} [parts.sprintIssues]
 * @param {string} parts.jiraSiteName
 */
export function assembleProjectData({ pullRequests, jiraIssuesMap, jiraIssuesDetails, parents = [], orphanedIssues = [], sprints = [], sprintIssues = {}, jiraSiteName }) {
    inheritFixVersions([...jiraIssuesDetails, ...orphanedIssues, ...parents]);
    const data = {
        pullRequests,
        jiraIssuesMap: Object.fromEntries(jiraIssuesMap),
        jiraIssuesDetails: [...jiraIssuesDetails, ...parents],
        jiraSiteName,
        sprints,
        sprintIssues,
        orphanedIssues
    };
    return { ...data, dataHash: calculateHash(data) };
}
```

- [ ] **Step 4: Run the assembly tests**

Run: `node --test test/project-assembly.test.mjs`
Expected: 5 pass.

- [ ] **Step 5: The server fetches, then assembles**

In `project-data.mjs`:

Replace `import crypto from 'crypto';` and the four exported functions (`extractJiraIssues`, `createJiraIssuesMap`, `fillPullRequestsMap` if still there, `calculateHash`) with `import { createJiraIssuesMap, missingParentKeys, assembleProjectData } from './project-assembly.mjs';`. Update the header comment: "the pure post-processing (the issue map, the parents to fetch, the inheritance, the hash, the response shape) is project-assembly.mjs, shared with the fixture generator".

`fetchJiraIssuesDetails(jiraIssues, jiraProjects)`: drop the `moreIssues` parameter and the line `jiraIssuesDetails.push(...await completeParents([...jiraIssuesDetails, ...moreIssues]));`; it returns the batches only. Its comment: "The linked issues in batches of 50 (their parents are fetchParentIssues' job)".

Replace `completeParents` with:

```js
    // The parents of the linked and orphaned issues (summary, type, fix versions
    // and parent: what the epic and story filters and the inheritance need), in
    // one request; a failure is logged and gives no parents, the build goes on
    async function fetchParentIssues(keys) {
        if (keys.length === 0) return [];
        const jql = `key IN (${keys.join(',')})`;
        const url = `https://${jiraSiteName}.atlassian.net/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key,summary,issuetype,fixVersions,parent`;
        try {
            const startTime = Date.now();
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${jiraAuth}`,
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                log.error(`Error fetching parent issues: Request failed with status code ${response.status}`);
                return [];
            }
            const data = await response.json();
            log.performance(`fetchJiraIssuesDetails - Parent issues fetch (${keys.length}) - Duration: ${Date.now() - startTime}ms`);
            return data.issues;
        } catch (error) {
            log.error(`Error fetching parent issues: ${error.message}`);
            return [];
        }
    }
```

Replace `buildProjectData` with:

```js
    /**
     * The response of /api/pull-requests/:project for a project of projects.js;
     * the commit counts of the pull requests are fetched only when the hash of
     * the rest changed since the last response built
     * @param {string} projectName
     * @param {{ repositories: string[], jiraProjects: string[], jiraRegex: RegExp }} projectConfig
     */
    async function buildProjectData(projectName, projectConfig) {
        log.access(`Processing pull requests for project: ${projectName}`);

        const allPullRequests = [];
        for (const repoName of projectConfig.repositories) {
            const baseUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/pullrequests?fields=%2Bvalues.*,%2Bvalues.properties*,%2Bvalues.rendered.*,-values.description,-values.summary&pagelen=50`;
            const pullRequests = [];
            await fetchPullRequests(baseUrl, pullRequests);
            allPullRequests.push(...pullRequests);
            log.access(`Retrieved ${pullRequests.length} pull requests for repository: ${repoName}`);
        }

        const jiraIssuesMap = createJiraIssuesMap(allPullRequests, projectConfig.jiraRegex);
        const allJiraIssues = Array.from(jiraIssuesMap.values()).flat();
        log.access(`Total JIRA issues found: ${allJiraIssues.length}`);

        // The issues in review no pull request links, before the details so that
        // one request fetches their parents with the parents of the linked issues
        const orphanedIssues = await fetchInReviewIssuesWithoutPR(projectConfig.jiraProjects, allJiraIssues);
        const jiraIssuesDetails = await fetchJiraIssuesDetails(allJiraIssues, projectConfig.jiraProjects);
        const parents = await fetchParentIssues(missingParentKeys([...jiraIssuesDetails, ...orphanedIssues]));

        const sprints = await fetchJiraSprints(projectConfig.jiraProjects);
        log.access(`Retrieved ${sprints.length} sprints for project: ${projectName}`);
        const sprintIssues = await fetchSprintIssues(sprints, projectConfig.jiraProjects);
        log.access(`Retrieved issues for ${Object.keys(sprintIssues).length} sprints`);

        const assembled = assembleProjectData({ pullRequests: allPullRequests, jiraIssuesMap, jiraIssuesDetails, parents, orphanedIssues, sprints, sprintIssues, jiraSiteName });

        // Nothing changed since the last response built: serve it again with a new time,
        // without the two commit requests per pull request
        if (lastResponse?.dataHash === assembled.dataHash) {
            lastResponse.lastRefreshTime = new Date().toISOString();
            return lastResponse;
        }
        const pullRequestsWithCommits = await Promise.all(allPullRequests.map(async (pr) => {
            const commitsAhead = await fetchCommitsDiff(pr.source.repository.name, pr.source.branch.name, pr.destination.branch.name);
            const commitsBehind = await fetchCommitsDiff(pr.source.repository.name, pr.destination.branch.name, pr.source.branch.name);
            return { ...pr, commitsAhead, commitsBehind };
        }));
        lastResponse = { lastRefreshTime: new Date().toISOString(), ...assembled, pullRequests: pullRequestsWithCommits };
        return lastResponse;
    }
```

In the returned object, replace `fetchJiraIssuesDetails,` with `fetchJiraIssuesDetails, fetchParentIssues,`.

In `test/project-data.test.mjs`: the import becomes `import { createProjectData } from '../project-data.mjs';`; delete the tests `extractJiraIssues finds the keys...` and `calculateHash is stable...` (moved to the assembly test). Rewrite the test `an issue without fix versions inherits the fix versions of its parent, epic to story to sub-task` to go through the build:

```js
test('an issue without fix versions inherits the fix versions of its parent, epic to story to sub-task', async () => {
    const v2 = version('2.0');
    const issues = [
        issue('PROJ-10', { type: 'Story', parent: 'PROJ-1', fixVersions: [] }), // the story, before its sub-task
        issue('PROJ-11', { type: 'Sub-task', parent: 'PROJ-10', fixVersions: [] }),
        issue('PROJ-12', { type: 'Sub-task', parent: 'PROJ-10', fixVersions: [version('3.0')] }), // keeps its own
        issue('PROJ-13', { type: 'Sub-task', parent: 'PROJ-14', fixVersions: [] }) // its parent has none either
    ];
    const parents = [issue('PROJ-1', { type: 'Epic', fixVersions: [v2] }), issue('PROJ-14', { type: 'Story', fixVersions: [] })];
    const pullRequests = [10, 11, 12, 13].map(n => pullRequest(n, { title: `PROJ-${n} change` }));
    const { buildProjectData } = setUp(fakeAtlassian({ pullRequests: { 'repo-a': [pullRequests] }, issues, parents }));
    const data = await buildProjectData('P', project);
    const versions = Object.fromEntries(data.jiraIssuesDetails.map(i => [i.key, i.fields.fixVersions.map(v => v.name)]));
    assert.deepEqual(versions, { 'PROJ-10': ['2.0'], 'PROJ-11': ['2.0'], 'PROJ-12': ['3.0'], 'PROJ-13': [], 'PROJ-1': ['2.0'], 'PROJ-14': [] });
});
```

Every other project-data test goes through `buildProjectData` and keeps passing: the requests, their order and the log lines do not change.

- [ ] **Step 6: The generator assembles the same way**

In `fixtures/generate.mjs`:

Add `import { createJiraIssuesMap, missingParentKeys, assembleProjectData } from '../project-assembly.mjs';` after the `crypto` import. Delete the private `extractJiraIssues` and `calculateHash` functions.

In `generateProjectData`, replace the block from `// Same regex-based extraction as the server` to the end of the `const allJiraIssues = ...` line with:

```js
    // Same extraction as the server: only keys matching the project regex count
    const jiraIssuesMap = createJiraIssuesMap(pullRequests, projectConfig.jiraRegex);
    const allJiraIssues = [...jiraIssuesMap.values()].flat();
```

Replace the block from `// Parents (stories of sub-tasks, epics of standard issues) are fetched by the` to the end of the inheritance loop (`// Sub-tasks inherit the fix versions of their parent (the orphaned issues too)` ... `}`) with:

```js
    // The parents the server fetches for the linked and orphaned issues (summary,
    // type, fix versions, parent), taken from the issues known here
    const parents = missingParentKeys([...jiraIssuesDetails, ...orphanedIssues])
        .filter(key => knownIssues.has(key))
        .map(key => {
            const parent = knownIssues.get(key);
            return {
                id: parent.id,
                key: parent.key,
                self: parent.self,
                fields: {
                    summary: parent.fields.summary,
                    issuetype: parent.fields.issuetype,
                    fixVersions: parent.fields.fixVersions,
                    ...(parent.fields.parent ? { parent: parent.fields.parent } : {})
                }
            };
        });
```

In the sprints block, `const linkedKeys = [...jiraIssuesDetails, ...parents].map(issue => issue.key).filter(key => key.split('-')[0] !== 'WEBOSLC');` (the same issue set as before: the details had the parents appended by then, so the random draws and the volumes do not change).

Replace the end of the function (from `const data = {` to the closing `}` of the function) with:

```js
    return {
        lastRefreshTime: new Date().toISOString(),
        ...assembleProjectData({ pullRequests, jiraIssuesMap, jiraIssuesDetails, parents, orphanedIssues, sprints, sprintIssues, jiraSiteName })
    };
}
```

Update the JSDoc of `generateProjectData`: "in the exact shape produced by buildProjectData() in project-data.mjs, through the same assembleProjectData". Update the header comment of the file where it mentions the server's hash.

- [ ] **Step 7: Run every test**

Run: `npm test`
Expected: `ℹ fail 0`; the fixture volume tests (112 pull requests, 13 orphaned issues, `sprintIssues['5240'].length === 100`) still pass, which proves the generated data did not move.

- [ ] **Step 8: Commit**

```bash
git add project-assembly.mjs test/project-assembly.test.mjs project-data.mjs fixtures/generate.mjs test/project-data.test.mjs
git commit -m "refactor: one assembly of a project's data for the server and the fixtures (#42)" -m "fixtures/generate.mjs re-implemented the server's post-processing: the issue map, the parents to fetch, the fix-version inheritance and the hash. project-assembly.mjs holds them, pure and tested; project-data.mjs fetches (the parents through fetchParentIssues, in the same single request) and calls assembleProjectData, the generator generates and calls it too. The responses have one shape and one hash function; the fixture data does not move." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: One request helper per Atlassian API (item 7)

**Files:**
- Modify: `project-data.mjs` (two helpers, every fetcher through them, `fetchPullRequests` as a loop)
- Modify: `test/project-data.test.mjs` (the messages that change, a new failure case)

- [ ] **Step 1: Write the failing tests**

In `test/project-data.test.mjs`:

In the test `a failed commits request leaves the count null and is logged; ...`, replace the `logs.error.some(line => line.startsWith('Failed to fetch commits ahead for feat-1 compared to master in repo-a (HTTP 500'))` assertion with:

```js
    assert.deepEqual(logs.error, ['Error fetching commits ahead for feat-1 compared to master in repo-a: Request failed with status code 500']);
```

In the test `a commits request that throws gives a null count; a failed Jira batch fails the build with the body; ...`, the thrown case expects `['Error fetching commits ahead for master compared to feat-1 in repo-a: socket hang up']`, and the batch case expects the message `'Request failed with status code 400: {"errorMessages":["bad jql"]}'` both from `assert.rejects` and in `batch.logs.error` as `'Error in fetchJiraIssuesDetails: Request failed with status code 400: {"errorMessages":["bad jql"]}'`.

Add a test:

```js
test('a failed sprints request of one board skips that board only and is logged; a long Jira error body is cut at 200 characters', async () => {
    const skipped = setUp(fakeAtlassian({
        pullRequests: { 'repo-a': [[pullRequest(1)]] },
        boards: { PROJ: [{ id: 1, name: 'Board 1' }, { id: 2, name: 'Board 2' }], OTHER: [{ id: 3, name: 'Board 3' }] },
        sprints: { 1: [{ id: 7, name: 'Sprint 7' }], 2: [{ id: 8, name: 'Sprint 8' }], 3: [{ id: 9, name: 'Sprint 9' }] },
        intercept: url => (url.includes('/board/2/sprint') ? new Response('', { status: 502 }) : undefined)
    }));
    const data = await skipped.buildProjectData('P', project);
    assert.deepEqual(data.sprints, [{ id: 7, name: 'Sprint 7' }, { id: 9, name: 'Sprint 9' }]); // the other boards keep their sprints
    assert.deepEqual(skipped.logs.error, ['Error fetching the sprints of board Board 2 (project PROJ): Request failed with status code 502']);

    const long = setUp(fakeAtlassian({ intercept: url => (url.includes('In%20Review') ? new Response('x'.repeat(500), { status: 500 }) : undefined) }));
    await assert.rejects(long.buildProjectData('P', project), { message: `Request failed with status code 500: ${'x'.repeat(200)}` });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/project-data.test.mjs`
Expected: the three adapted assertions and the new test fail on the current messages.

- [ ] **Step 3: The helpers**

In `project-data.mjs`, inside `createProjectData`, after `let lastResponse = null;`, add:

```js
    // One GET per API, with its credentials: the parsed body of an ok response,
    // otherwise an error with the status, the body drained first so the socket
    // is released. Jira's body says what was wrong with the JQL, so its first
    // 200 characters follow the status; Bitbucket's is an HTML page, left out.
    async function getJson(url, auth, keepBody) {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        });
        if (response.ok) return response.json();
        const body = await response.text().catch(() => '');
        throw new Error(`Request failed with status code ${response.status}${keepBody && body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    const bitbucketJson = url => getJson(url, bbAuth, false);
    const jiraJson = url => getJson(url, jiraAuth, true);
```

Then every fetcher:

`searchIssuePages`: replace the `fetch` call, the `if (!response.ok) throw ...` and `const data = await response.json();` with `const data = await jiraJson(url);`.

`fetchInReviewIssuesWithoutPR`: unchanged (it uses `searchIssuePages`).

`fetchCommitsDiff`:

```js
    // The number of commits of `sourceBranch` that `destinationBranch` does not have
    // (up to 100); null when the request fails, which is logged
    async function fetchCommitsDiff(repoName, sourceBranch, destinationBranch) {
        const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoName}/commits?include=${sourceBranch}&exclude=${destinationBranch}&pagelen=100`;
        try {
            const data = await bitbucketJson(url);
            return data.values.length;
        } catch (error) {
            log.error(`Error fetching commits ahead for ${sourceBranch} compared to ${destinationBranch} in ${repoName}: ${error.message}`);
            return null;
        }
    }
```

`fetchPullRequests`, a loop over `next`; the signature `(url, pullRequests)` stays (the caller passes the array to fill):

```js
    // Every page of the open pull requests of a repository, following `next`; a
    // failed page fails the build (logged)
    async function fetchPullRequests(url, pullRequests) {
        let next = url;
        while (next) {
            const startTime = Date.now();
            try {
                const data = await bitbucketJson(next);
                if (data.values) pullRequests.push(...data.values);
                next = data.next || null;
            } catch (error) {
                log.error(`Error in fetchPullRequests: ${error.message}`);
                throw error;
            } finally {
                log.performance(`fetchPullRequests - URL: ${next === null ? url : next} - Duration: ${Date.now() - startTime}ms`);
            }
        }
    }
```

Careful with the performance line: it must log the URL of the page just fetched. Write it with a local: at the top of the loop body `const pageUrl = next;`, log `pageUrl` in `finally`, and assign `next = data.next || null;` after the fetch. (Rewrite the block that way; the version above is the intent, the `pageUrl` local is the correct form.)

`fetchJiraIssuesDetails`: in the batch loop, replace the `fetch` call and the `if (response.ok) {...} else {...}` with:

```js
                const data = await jiraJson(url);
                jiraIssuesDetails.push(...data.issues);
```

(the `catch` keeps logging `Error in fetchJiraIssuesDetails: ${error.message}` and rethrowing).

`fetchParentIssues`: replace the `fetch` call and the `if (!response.ok) {...}` / `const data = await response.json();` with `const data = await jiraJson(url);` (a failed request now throws into the `catch`, which logs `Error fetching parent issues: ${error.message}` and returns `[]`; the message of a 502 with an empty body is `Request failed with status code 502`, what the existing test expects).

`fetchJiraSprints`:

```js
    // The active sprints of every scrum board of each Jira project, { id, name },
    // a sprint shared by two boards once. A failed boards request skips the
    // project's sprints, a failed sprints request skips that board; both logged
    async function fetchJiraSprints(jiraProjects) {
        const sprints = new Set();
        for (const project of jiraProjects) {
            let boards;
            try {
                const boardsData = await jiraJson(`https://${jiraSiteName}.atlassian.net/rest/agile/1.0/board?projectKeyOrId=${project}&type=scrum`);
                log.performance(`Fetched ${boardsData.total} boards for project ${project}`);
                boards = boardsData.values;
            } catch (error) {
                log.error(`Error fetching sprints for project ${project}: ${error.message}`);
                continue;
            }
            for (const board of boards) {
                try {
                    const sprintsData = await jiraJson(`https://${jiraSiteName}.atlassian.net/rest/agile/1.0/board/${board.id}/sprint?state=active`);
                    log.performance(`Fetched ${sprintsData.total} active sprints for board ${board.name}`);
                    for (const sprint of sprintsData.values) {
                        sprints.add(JSON.stringify({ id: sprint.id, name: sprint.name }));
                    }
                } catch (error) {
                    log.error(`Error fetching the sprints of board ${board.name} (project ${project}): ${error.message}`);
                }
            }
        }
        return Array.from(sprints).map(JSON.parse);
    }
```

After this, `grep -c "headers: {" project-data.mjs` is 1 (the helper) and `grep -c "'Authorization'" project-data.mjs` is 1.

- [ ] **Step 4: Run every test**

Run: `npm test`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add project-data.mjs test/project-data.test.mjs
git commit -m "refactor: one request helper per Atlassian API in project-data.mjs (#42)" -m "The same request options were written at seven fetch calls. bitbucketJson and jiraJson send the GET with the credentials of their API and throw on a failed response with the status (Jira's error body, which says what was wrong with the JQL, after it); fetchPullRequests loops over next instead of recursing. The failure rules keep: a failed boards request skips the project's sprints and a failed sprints request that board, both logged now (they were silent)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: One delegated click listener (item 8)

**Files:**
- Modify: `public/tree-toggle.js` (`handleTreeClick`)
- Modify: `public/app.js` (the listener, no `window` exports)
- Modify: `public/app-render.js` (no `onclick`, `toggleButton(name)`, header comment)
- Modify: `test/tree-toggle.test.mjs`, `test/app-render.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `test/tree-toggle.test.mjs`, import `handleTreeClick` too, give the fake element a `closest` option (`function element({ classes = [], children = {}, next = null, closest = {} } = {})` and, in the returned object, `closest: selector => closest[selector] ?? null,`), and add:

```js
test('handleTreeClick toggles the block the click lands on, and nothing inside a link', () => {
    const repository = element({ classes: ['repository'] });
    const repositoryHeader = element({ closest: { '.repository': repository } });
    const repositoryButton = element({ closest: { '.repository-header': repositoryHeader, '.repository': repository } });
    // A click on the header, and one on its button (what a keyboard activation dispatches): one toggle each
    handleTreeClick({ target: element({ closest: { '.repository-header': repositoryHeader } }) });
    assert.ok(repository.classList.contains('collapsed'));
    handleTreeClick({ target: repositoryButton });
    assert.ok(!repository.classList.contains('collapsed'));

    const rootBranch = element({ classes: ['root-branch'] });
    const rootBranchHeader = element({ closest: { '.root-branch': rootBranch } });
    handleTreeClick({ target: element({ closest: { '.root-branch-header': rootBranchHeader } }) });
    assert.ok(rootBranch.classList.contains('collapsed'));
    // The root-branch link, inside the header: the link does its job, the branch stays
    handleTreeClick({ target: element({ closest: { 'a': element(), '.root-branch-header': rootBranchHeader } }) });
    assert.ok(rootBranch.classList.contains('collapsed'));

    const children = element({ classes: ['children'] });
    const pullRequest = element({ classes: ['pull-request'], next: children });
    const pullRequestButton = element();
    pullRequestButton.closest = selector => ({ '.pull-request-header .toggle-button': pullRequestButton, '.pull-request': pullRequest })[selector] ?? null; // the button is its own match
    handleTreeClick({ target: pullRequestButton });
    assert.ok(pullRequest.classList.contains('collapsed'));
    assert.equal(children.hidden, true);

    // A click on the content of a pull request toggles nothing
    handleTreeClick({ target: element() });
    assert.ok(pullRequest.classList.contains('collapsed'));
});
```

In `test/app-render.test.mjs`: in `renderRepositories nests a stacked pull request...`, replace `assert.equal(count(html, 'onclick="toggleChildren(this)"'), 1);` with `assert.equal(count(html, 'onclick='), 0);`; in `renderOrphanedIssues renders nothing without issues, ...`, replace `assert.ok(html.includes('onclick="toggleRepository(this)"'));` with `assert.equal(count(html, 'onclick='), 0);`; in `renderRepositories gives every collapsible block a named toggle button...`, the stacked button string becomes `'<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle the stacked pull requests">'`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/tree-toggle.test.mjs test/app-render.test.mjs`
Expected: `handleTreeClick` is not exported; the `onclick=` counts are not 0.

- [ ] **Step 3: The handler, the listener, the markup**

In `public/tree-toggle.js`, add after `toggleChildren`:

```js
/**
 * The click handler of the tree pane, installed once by app.js on the
 * container in place of an inline handler per header. A click inside a link
 * (the root-branch link) toggles nothing; the toggle button of a pull
 * request toggles its stacked pull requests; anywhere else on a root-branch
 * or a repository header toggles the branch or the repository, the button
 * inside the header included (a keyboard activation dispatches a click on
 * it, which lands here once).
 */
export function handleTreeClick(event) {
    const target = event.target;
    if (target.closest('a')) return;
    const pullRequestButton = target.closest('.pull-request-header .toggle-button');
    if (pullRequestButton) {
        toggleChildren(pullRequestButton);
        return;
    }
    const rootBranchHeader = target.closest('.root-branch-header');
    if (rootBranchHeader) {
        toggleRootBranch(rootBranchHeader);
        return;
    }
    const repositoryHeader = target.closest('.repository-header');
    if (repositoryHeader) toggleRepository(repositoryHeader);
}
```

and in the header comment: "app.js installs handleTreeClick on the tree pane; the rendered tree carries no inline handler."

In `public/app.js`: import `handleTreeClick` from `./tree-toggle.js` instead of `toggleChildren, toggleRootBranch, toggleRepository` (keep `captureToggleStates, restoreToggleStates`); in the `DOMContentLoaded` handler, after `initializePopovers();`, add `document.getElementById('pull-requests').addEventListener('click', handleTreeClick);`; delete the three `window.toggle... = ...` lines and their comment at the end of the file.

In `public/app-render.js`: `toggleButton(name)` renders `<button type="button" class="toggle-button" aria-expanded="true" aria-label="Toggle ${name}">` (no `onclick` parameter); remove ` onclick="toggleRepository(this)"` from the two `.repository-header` divs, ` onclick="toggleRootBranch(this)"` from `.root-branch-header`, ` onclick="event.stopPropagation();"` from the root-branch link, and call `toggleButton('the stacked pull requests')` for the pull request. Rewrite the header comment's sentences about the handlers: "The tree carries no inline handler: app.js installs one click listener on the pane (handleTreeClick in tree-toggle.js), which toggles the block a click lands on and leaves the links alone; toggleButton renders every chevron button, a real button with a name and aria-expanded, and tree-toggle.js keeps aria-expanded in step."

- [ ] **Step 4: Run every test**

Run: `npm test`
Expected: `ℹ fail 0`; `grep -c onclick public/app-render.js` is 0; `grep -c "window\." public/app.js` is 0 except `window.location`, `window.history`, `window.addEventListener`, `window.matchMedia` (check with `grep -n "window\.toggle" public/app.js`: nothing).

- [ ] **Step 5: Commit**

```bash
git add public/tree-toggle.js public/app.js public/app-render.js test/tree-toggle.test.mjs test/app-render.test.mjs
git commit -m "refactor: one click listener on the tree instead of inline handlers on window (#42)" -m "The rendered tree carried an onclick per header and app.js installed three toggle functions on window; handleTreeClick, installed once on the pane, toggles the block a click lands on and leaves the links alone. Same behaviour by mouse and keyboard." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Version 2.11.0 and the documentation (controller)

Done by the controller after the eight commits and the browser checks: `package.json` (version 2.11.0, releaseDate 2026-09-16), the README changelog entry, CLAUDE.md (file map, app.js state snippet, app-url.js, app-filter.js, app-render.js, app-sync.js, tree-toggle.js, project-data.mjs, fixtures, the API response, "Add New Filter", pitfalls 9, 12, 13, the test list), PRD.md 7.1 and 7.3. One commit.
