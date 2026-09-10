# Back and Forward Re-apply the Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Back and Forward put the filters, and the project, back as the URL describes (issue #32), with one history entry per user action.

**Architecture:** The mapping between the filters and the URL parameters moves to a pure module, `public/app-url.js` (`filtersFromUrl`, `urlWithFilters`), unit-tested. In `public/app.js`, `restoreFiltersFromUrl()` becomes the only path from the URL to the state and the controls (all six multi-selects, SYNC, ready checkboxes, search box), run after every render once every option list is populated and on Back/Forward; the populate functions only populate. `selectProject(name, { fromUrl })` replaces `handleProjectChange`: from the dropdown it resets the filters and pushes one entry, from the URL (page load, Back/Forward) it leaves the URL alone; after the render the URL is replaced with the validated filters. A `popstate` listener switches the project or restores and applies the filters, and never writes the URL.

**Tech Stack:** Vanilla ES modules, `node:test`. No server change.

**Spec:** `docs/superpowers/specs/2026-09-10-back-forward-filters-design.md` (issue #32)

**Branch:** `claude/back-forward-filters`, created from `claude/hide-empty-repositories` (already checked out, spec and plan committed). One pull request stacked on the hide-empty-repositories one. Do not `git add` `config.js`, `config.js.test` or `.claude/`; add files by name. Commit messages end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TcMUwKXicKzfDozyREWQdD
```

**Running the unit tests:** `npm test`, expected to end with `ℹ fail 0` (49 tests before this plan; 57 after Task 1).

**Running the app for manual checks:** `PORT=3101 node index.mjs --fixtures` (port 3000 runs another instance, port 3100 an unrelated application), http://localhost:3101/?project=SECOLLAB.

---

### Task 1: The filters as URL parameters (pure module)

**Files:**
- Create: `public/app-url.js`
- Create: `test/app-url.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/app-url.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterUrlParams, filtersFromUrl, urlWithFilters } from '../public/app-url.js';

const noFilters = { text: '', assignees: [], reviewers: [], sprints: [], fixVersions: [], epics: [], stories: [], sync: 'Show all', readyReviewer: false, readyAssignee: false };

test('filtersFromUrl reads every filter, repeated parameters included', () => {
    const filters = filtersFromUrl('?project=PROJ&q=banner&assignee=John&assignee=Jane&reviewer=Bob&sprint=1&sprint=2&fixVersion=10&epic=PROJ-1&story=PROJ-2&sync=requested&readyReviewer=true&readyAssignee=true');
    assert.deepEqual(filters, {
        text: 'banner',
        assignees: ['John', 'Jane'],
        reviewers: ['Bob'],
        sprints: ['1', '2'],
        fixVersions: ['10'],
        epics: ['PROJ-1'],
        stories: ['PROJ-2'],
        sync: 'requested',
        readyReviewer: true,
        readyAssignee: true
    });
});

test('filtersFromUrl defaults every filter without parameters', () => {
    assert.deepEqual(filtersFromUrl(''), noFilters);
    assert.deepEqual(filtersFromUrl('?project=PROJ&foo=1'), noFilters);
});

test('filtersFromUrl reads the former ready parameter as readyReviewer', () => {
    assert.equal(filtersFromUrl('?ready=true').readyReviewer, true);
    assert.equal(filtersFromUrl('?ready=true').readyAssignee, false);
    assert.equal(filtersFromUrl('?readyReviewer=false').readyReviewer, false);
});

test('urlWithFilters writes the project and the active filters only, and keeps the other parameters', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?foo=1&assignee=Old&ready=true&sync=OK'), {
        project: 'PROJ',
        filters: { ...noFilters, text: '  banner ', assignees: ['John'], readyReviewer: true }
    });
    assert.equal(url.search, '?foo=1&project=PROJ&q=banner&assignee=John&readyReviewer=true');
});

test('urlWithFilters without a project drops the project parameter', () => {
    const url = urlWithFilters(new URL('http://localhost:3000/?project=PROJ&q=x'), { project: null, filters: noFilters });
    assert.equal(url.search, '');
});

test('urlWithFilters leaves the URL it is given untouched', () => {
    const original = new URL('http://localhost:3000/?project=PROJ');
    urlWithFilters(original, { project: 'OTHER', filters: noFilters });
    assert.equal(original.search, '?project=PROJ');
});

test('the filters survive a round trip through the URL', () => {
    const filters = { text: 'a b', assignees: ['J'], reviewers: ['B', 'C'], sprints: ['1'], fixVersions: ['2'], epics: ['P-1'], stories: ['P-2'], sync: 'requested', readyReviewer: true, readyAssignee: true };
    const url = urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters });
    assert.deepEqual(filtersFromUrl(url.search), filters);
});

test('filterUrlParams covers every parameter urlWithFilters writes, plus the former ready', () => {
    const filters = { text: 't', assignees: ['a'], reviewers: ['r'], sprints: ['1'], fixVersions: ['2'], epics: ['e'], stories: ['s'], sync: 'OK', readyReviewer: true, readyAssignee: true };
    const written = [...urlWithFilters(new URL('http://localhost:3000/'), { project: 'P', filters }).searchParams.keys()].filter(key => key !== 'project');
    assert.deepEqual(new Set([...written, 'ready']), new Set(filterUrlParams));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: the new file fails to load (`Cannot find module '.../public/app-url.js'`), `ℹ fail` greater than 0.

- [ ] **Step 3: Write the module**

Create `public/app-url.js`:

```js
/**
 * The filters as URL parameters: what the address bar shows, what a shared
 * link carries and what Back and Forward put back. Pure: nothing here reads
 * the page. Multi-selects use repeated parameters (?assignee=A&assignee=B).
 */

// Parameters written by the filters. 'ready' is the former name of
// readyReviewer: still read from old links, only ever removed when writing.
export const filterUrlParams = ['q', 'sprint', 'fixVersion', 'epic', 'story', 'assignee', 'reviewer', 'sync', 'readyReviewer', 'readyAssignee', 'ready'];

/**
 * The filters a query string describes, in the shape of currentFilters().
 * @param {string} search - window.location.search, with or without the leading "?"
 */
export function filtersFromUrl(search) {
    const params = new URLSearchParams(search);
    return {
        text: params.get('q') || '',
        assignees: params.getAll('assignee'),
        reviewers: params.getAll('reviewer'),
        sprints: params.getAll('sprint'),
        fixVersions: params.getAll('fixVersion'),
        epics: params.getAll('epic'),
        stories: params.getAll('story'),
        sync: params.get('sync') || 'Show all',
        readyReviewer: params.get('readyReviewer') === 'true' || params.get('ready') === 'true',
        readyAssignee: params.get('readyAssignee') === 'true'
    };
}

/**
 * A copy of a URL carrying the project and the active filters, and none of
 * the previous ones; parameters that are not filters are kept.
 * @param {URL} url - left untouched
 * @param {{ project: string | null, filters: object }} state - filters in the shape of currentFilters()
 * @returns {URL}
 */
export function urlWithFilters(url, { project, filters }) {
    const result = new URL(url);
    const params = result.searchParams;
    filterUrlParams.forEach(param => params.delete(param));
    if (project) {
        params.set('project', project);
    } else {
        params.delete('project');
    }
    const text = filters.text.trim();
    if (text !== '') params.set('q', text);
    filters.assignees.forEach(value => params.append('assignee', value));
    filters.reviewers.forEach(value => params.append('reviewer', value));
    filters.sprints.forEach(value => params.append('sprint', value));
    filters.fixVersions.forEach(value => params.append('fixVersion', value));
    filters.epics.forEach(value => params.append('epic', value));
    filters.stories.forEach(value => params.append('story', value));
    if (filters.sync !== 'Show all') params.set('sync', filters.sync);
    if (filters.readyReviewer) params.set('readyReviewer', 'true');
    if (filters.readyAssignee) params.set('readyAssignee', 'true');
    return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ fail 0`, 57 tests.

- [ ] **Step 5: Commit**

```bash
git add public/app-url.js test/app-url.test.mjs
git commit -m "feat: the filters as URL parameters in a pure module, app-url.js"
```

---

### Task 2: The page follows the URL

**Files:**
- Modify: `public/app.js`

Every edit below names the exact current text; each snippet occurs once in the file.

- [ ] **Step 1: Import the module and drop the moved constant**

After the line

```js
import { initializeAppShell, updateDocumentTitle, closeSidebarDrawer, updateActiveFilterBadge, setToolbarVisible } from './app-shell.js';
```

add:

```js
import { filtersFromUrl, urlWithFilters } from './app-url.js';
```

Delete these two lines (the constant now lives in app-url.js and app.js no longer needs it):

```js
// URL parameters written by the filters ('ready', the former name of readyReviewer, is only ever removed)
const filterUrlParams = ['q', 'sprint', 'fixVersion', 'epic', 'story', 'assignee', 'reviewer', 'sync', 'readyReviewer', 'readyAssignee', 'ready'];
```

- [ ] **Step 2: Write the URL through the module**

Replace the whole `updateUrlWithFilters` function, from its leading comment `// Writes the filters to the URL. \`replace\` swaps the current history entry` down to its closing `}`, with:

```js
// Writes the project and the filters to the URL. `replace` swaps the current
// history entry instead of pushing one: while typing in the search box, and
// when the address bar catches up after a load.
function updateUrlWithFilters({ replace = false } = {}) {
    const url = urlWithFilters(new URL(window.location), { project: currentProject, filters: currentFilters() });

    // Update URL without reloading the page. Safari throws past 100 updates
    // per 30 seconds: the URL then catches up on the next change
    try {
        if (replace) {
            window.history.replaceState({}, '', url);
        } else {
            window.history.pushState({}, '', url);
        }
    } catch (error) {
        // The filters are already applied; only the address bar lags
    }
}
```

- [ ] **Step 3: One path from the URL to the state and the controls**

Replace the whole `restoreFiltersFromUrl` function, from its leading comment `// Update filter restoration from URL` down to its closing `}` (the one after `updateTextFilterClearButton();`), with:

```js
// Copies the filters the URL describes into the state and the controls. Runs
// after every render, once every option list is populated, and on Back and
// Forward. Each multi-select keeps only the values its options offer, so a
// stale name in a shared link or an ended sprint is dropped (and cannot leave
// a ready checkbox enabled over an empty selection). SYNC follows the URL only
// while its statuses are loaded: they are fetched on demand, so a reload starts
// at "Show all". The URL holds the trimmed query: while the user is typing the
// box keeps its own content (a re-render must not eat a trailing space); on
// Back and Forward (`preferTypedText: false`) the URL wins.
function restoreFiltersFromUrl({ preferTypedText = true } = {}) {
    const filters = filtersFromUrl(window.location.search);

    const restoreMultiSelect = (id, values) => {
        const multiSelect = getMultiSelect(id);
        if (!multiSelect) return values;
        multiSelect.setSelectedValues(values);
        return multiSelect.getSelectedValues();
    };
    currentSprints = restoreMultiSelect('sprintSelect', filters.sprints);
    currentFixVersions = restoreMultiSelect('fixVersionSelect', filters.fixVersions);
    currentEpics = restoreMultiSelect('epicSelect', filters.epics);
    currentStories = restoreMultiSelect('storySelect', filters.stories);
    currentAssignees = restoreMultiSelect('assigneeSelect', filters.assignees);
    currentReviewers = restoreMultiSelect('reviewerSelect', filters.reviewers);

    const syncSelect = document.getElementById('syncSelect');
    const syncOffered = syncSelect && Array.from(syncSelect.options).some(option => option.value === filters.sync);
    currentSync = (currentSyncStatuses && syncOffered) ? filters.sync : 'Show all';
    if (syncSelect) syncSelect.value = currentSync;

    currentReadyForReviewer = filters.readyReviewer;
    currentReadyForAssignee = filters.readyAssignee;
    updateReadyCheckboxes();

    currentText = filters.text;
    const textFilter = document.getElementById('textFilter');
    if (textFilter && preferTypedText && document.activeElement === textFilter) {
        currentText = textFilter.value;
    } else if (textFilter) {
        textFilter.value = currentText;
    }
    updateTextFilterClearButton();
}
```

- [ ] **Step 4: Open the project the URL names**

In `loadProjects`, replace

```js
        projectSelect.addEventListener('change', handleProjectChange);

        // Check for project query parameter
        const urlParams = new URLSearchParams(window.location.search);
        const projectParam = urlParams.get('project');
        if (projectParam) {
            const projectOption = projectSelect.querySelector(`option[value="${projectParam}"]`);
            if (projectOption) {
                projectSelect.value = projectParam;
                // Pass true to indicate this is initial page load, not a manual switch
                await handleProjectChange({ target: { value: projectParam } }, true);
            }
        }
```

with:

```js
        projectSelect.addEventListener('change', event => selectProject(event.target.value));

        // Open the project the URL names, with the filters it carries
        const projectName = projectFromUrl();
        if (projectName) {
            projectSelect.value = projectName;
            await selectProject(projectName, { fromUrl: true });
        }
```

- [ ] **Step 5: `selectProject`, `projectFromUrl` and `handlePopState`**

Replace the whole `handleProjectChange` function, from `async function handleProjectChange(event, isInitialLoad = false) {` down to its closing `}` (the line after `stopPeriodicChecking();` and `    }`), with:

```js
// The project the URL names, when the dropdown offers it; '' otherwise
function projectFromUrl() {
    const projectName = new URLSearchParams(window.location.search).get('project') || '';
    const options = Array.from(document.getElementById('projectSelect').options);
    return options.some(option => option.value === projectName) ? projectName : '';
}

// Switches to a project, or to none with an empty name. From the dropdown the
// filters start empty and the switch gets one history entry. From the URL
// (page load, Back and Forward) the URL already describes the state to reach
// and is left alone: the render restores the filters it carries.
async function selectProject(projectName, { fromUrl = false } = {}) {
    // The SYNC statuses belong to the project being left
    currentSyncStatuses = null;
    syncLoadFailed = false;
    currentProject = projectName || null;
    updateSyncControls();
    updateDocumentTitle({ project: currentProject, attentionCount: 0 });
    closeSidebarDrawer();

    if (!currentProject) {
        if (!fromUrl) updateUrlWithFilters();
        setToolbarVisible(false);
        applyFilters(); // no tree to filter: refreshes the badge and the tab title
        showEmptyState();
        stopPeriodicChecking();
        return;
    }

    if (!fromUrl) {
        resetFilterControls();
        readFilterControls();
        updateUrlWithFilters();
    }
    showLoadingState();
    const apiResult = await fetchData();
    // Back and Forward make quick switches easy: a late response for a project no longer selected is dropped
    if (currentProject !== projectName) return;
    renderEverything(apiResult);
    // The address bar catches up with the filters the render validated, without a new entry
    if (apiResult) updateUrlWithFilters({ replace: true });
    startPeriodicChecking();
}

// Back and Forward: the page follows the URL, never the other way round.
// Another project: switch to it, the render restores the filters of that URL.
// Same project: the filters are restored from the URL and applied. Nothing
// here writes the URL. Browsers no longer fire popstate on page load.
function handlePopState() {
    const projectName = projectFromUrl();
    if (projectName !== (currentProject || '')) {
        document.getElementById('projectSelect').value = projectName;
        selectProject(projectName, { fromUrl: true });
        return;
    }
    // Nothing rendered (loading, or the last load failed): the next render restores from the URL
    if (!currentApiResult) return;
    restoreFiltersFromUrl({ preferTypedText: false });
    applyFilters();
}
```

- [ ] **Step 6: The populate functions only populate**

a. In `populateFilters`, delete the two last lines of the body:

```js

    // Restore filter values; renderEverything applies them once every filter is populated
    restoreFiltersFromUrl();
```

b. In `populateSprintFilter`, delete from the blank line before `// Restore sprint values from URL after populating options` down to the closing `}` of that `if (currentSprints.length > 0) {` block (the function then ends right after `sprintMultiSelect.setOptions(sprintOptions);`).

c. In `populateFixVersionFilter`, delete from the blank line before `// Restore fixVersion values from URL after populating options` down to the closing `}` of that `if (currentFixVersions.length > 0) {` block (the function then ends right after `fixVersionMultiSelect.setOptions(fixVersionOptions);`).

d. Replace the whole `populateIssueFilter` function (and the comment lines directly above it, if any) with:

```js
// Fills an issue multi-select (epics or stories) from the index; the selection
// is restored from the URL afterwards, like every other filter
function populateIssueFilter(elementId, issues) {
    const multiSelect = getMultiSelect(elementId);
    if (multiSelect) multiSelect.setOptions(issueOptions(issues.values()));
}
```

- [ ] **Step 7: Restore once every option list is populated**

In `renderEverything`, replace

```js
    currentEpics = populateIssueFilter('epicSelect', filterIndex.epics, currentEpics);
    currentStories = populateIssueFilter('storySelect', filterIndex.stories, currentStories);

    // Every filter is populated and restored from the URL: apply them once
    applyFilters();
```

with:

```js
    populateIssueFilter('epicSelect', filterIndex.epics);
    populateIssueFilter('storySelect', filterIndex.stories);

    // Every option list is populated: restore the filters from the URL and apply them once
    restoreFiltersFromUrl();
    applyFilters();
```

- [ ] **Step 8: Listen to popstate**

In the `DOMContentLoaded` listener, after the line `initializeSyncControls();`, add:

```js
    window.addEventListener('popstate', handlePopState);
```

- [ ] **Step 9: Check**

Run: `node --check public/app.js && grep -n "handleProjectChange\|filterUrlParams\|isInitialLoad\|projectParam\|selectedKeys" public/app.js; npm test`
Expected: no syntax error, the grep prints nothing, `ℹ fail 0`, 57 tests.

- [ ] **Step 10: Commit**

```bash
git add public/app.js
git commit -m "feat: Back and Forward re-apply the filters and the project from the URL (#32)"
```

---

### Task 3: Browser check (controller)

Run: `PORT=3101 node index.mjs --fixtures`, open http://localhost:3101/?project=SECOLLAB.

- Page load adds no history entry: `history.length` does not grow after the render, and the URL stays `?project=SECOLLAB`.
- Select an assignee, then a sprint: Back restores the assignee alone (control, badge, tree, title), Forward the sprint again.
- Type in the search box, select a reviewer, Back: the reviewer is dropped, the text kept; Back again: the text is gone (typing replaced the entry).
- With the focus in the search box, Back: the box takes the URL's text.
- Switch to OSLC from the dropdown: one entry; Back returns to SECOLLAB with its filters, the dropdown follows; Forward returns to OSLC.
- Load SYNC (fixture statuses answer instantly), pick "SYNC required", Back: "Show all" again; Forward: "SYNC required" again.
- Open `?project=SECOLLAB&assignee=Nobody&ready=true`: after the render the URL is `?project=SECOLLAB` and Back leaves the page.

Stop the server (kill the process) when done.

---

### Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `PRD.md`

- [ ] **Step 1: README**

a. In "Features", after the line `    * Enables direct linking to specific filtered views`, add:

```
    * Back and Forward put the filters, and the project, back as the URL describes
```

b. In the changelog, at the end of the `* Version 2.5.0` block (after its last `    * ...` line, before `* Version 2.4.0`), add:

```
    * Back and Forward re-apply the filters and switch the project as the URL describes (#32); a project switch is one history entry and a page load adds none
    * SYNC follows the URL through Back and Forward while its statuses are loaded
```

- [ ] **Step 2: CLAUDE.md**

a. In the project structure tree, after the line `    ├── app-filter.js      # Filter index, pure evaluation, single-pass tree filtering and counters`, add:

```
    ├── app-url.js         # The filters as URL parameters, pure (filtersFromUrl, urlWithFilters)
```

b. After the `**public/app-filter.js**` block (its last bullet starts with `- \`parseTextQuery\`, \`matchesText\``), add:

```
**public/app-url.js**
- `filtersFromUrl(search)` (pure): the filters a query string describes, in the shape of `currentFilters()`; `ready`, the former name, is read as `readyReviewer`
- `urlWithFilters(url, { project, filters })` (pure): a copy of the URL with the project and the active filters only; parameters that are not filters are kept
```

c. In the `**public/app.js**` block, replace the bullet starting with `- \`populateIssueFilter(elementId, issues, selectedKeys)\`` with:

```
- `populateIssueFilter(elementId, issues)`: fills an issue multi-select (epics and stories) from the index; the selection is restored from the URL afterwards like every other filter
- `restoreFiltersFromUrl({ preferTypedText })`: the only path from the URL to the state and the controls (each multi-select keeps the values its options offer, SYNC follows the URL only while its statuses are loaded); run after every render once every option list is populated, and on Back/Forward with `preferTypedText: false` so the URL wins over the search box
- `selectProject(projectName, { fromUrl })`: project switch; from the dropdown the filters are reset and the URL pushed once, from the URL (page load, Back/Forward) the URL is left alone and the render restores its filters; after the render the URL is replaced with the validated filters; a late response for a project no longer selected is dropped
- `handlePopState()`: Back/Forward; switches the project through `selectProject(name, { fromUrl: true })` or restores and applies the filters of the URL
```

d. In "Frontend State Management", after the line `(\`ready\`, the former name of \`readyReviewer\`, is still read from old links but never written.)`, add a paragraph:

```

The page follows the URL on Back and Forward: `handlePopState()` restores the filters (`restoreFiltersFromUrl`) and applies them, or switches the project when the `project` parameter changed; nothing in that path writes the URL. Each user action is one history entry: a filter change pushes, typing replaces, a manual project switch pushes once, and a page load or a switch from the URL replaces the URL after the render (the address bar catches up with the validated filters).
```

e. In "Common Pitfalls", replace item 4 with:

```
4. **Filter restoration**: on a page load the SYNC filter is NOT restored from the URL (its statuses are loaded on demand) while every other filter is, including the two ready checkboxes; on Back/Forward SYNC follows the URL while its statuses are loaded
```

and item 10 with:

```
10. **Search box and history**: the text filter writes the URL with `replaceState` (one history entry for a whole typing session); every other filter pushes; `restoreFiltersFromUrl` keeps the content of a focused search box on a re-render (the URL holds the trimmed query) but takes the URL on Back/Forward
```

f. In "Testing Approach", in the "Unit tests" bullet, replace `\`buildDocumentTitle\`)` with `\`buildDocumentTitle\`, \`filtersFromUrl\`, \`urlWithFilters\`)`.

g. In "Common Tasks" > "Add New Filter", replace `4. **URL Sync**: Update \`updateUrlWithFilters()\` and \`restoreFiltersFromUrl()\`` with:

```
4. **URL Sync**: Update `filtersFromUrl()` and `urlWithFilters()` in app-url.js (with a unit test) and `restoreFiltersFromUrl()` in app.js
```

- [ ] **Step 3: PRD.md**

After the `- F4.14: ...` line, add:

```
- F4.15: Back and Forward restore the filters and the project the URL describes; one history entry per user action
```

- [ ] **Step 4: Check and commit**

Run: `npm test` (expected `ℹ fail 0`).

```bash
git add README.md CLAUDE.md PRD.md
git commit -m "docs: Back and Forward follow the URL (#32)"
```

The controller pushes the branch and opens the pull request (base `claude/hide-empty-repositories`, `Closes #32`).

---

## Plan self-review

- **Spec coverage:** decision 1 (Task 2 steps 5, 8), decision 2 (step 5: push once from the dropdown, replace after the render; no push on load), decision 3 (steps 3, 6, 7), decision 4 (step 3, SYNC from the URL while loaded), decision 5 (step 3, `preferTypedText`; step 5 passes false on popstate), decision 6 (step 5, late response dropped), decision 7 (Task 1), docs (Task 4), verification (Task 3).
- **Placeholders:** none.
- **Type consistency:** `filtersFromUrl` returns the shape of `currentFilters()` (text, assignees, reviewers, sprints, fixVersions, epics, stories, sync, readyReviewer, readyAssignee) and `urlWithFilters` reads that shape; `selectProject(projectName, { fromUrl })` is called in steps 4, 5; `projectFromUrl()` in steps 4, 5; `restoreFiltersFromUrl({ preferTypedText })` in steps 3, 5, 7; `populateIssueFilter(elementId, issues)` in steps 6d and 7.
