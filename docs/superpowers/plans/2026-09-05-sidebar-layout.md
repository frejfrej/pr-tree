# Sidebar Layout, Banner and Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single centered page into an app shell (fixed banner, left filter sidebar, independently scrolling tree pane) with a dark theme, and fix the colour-based "Ready for reviewer" filter along the way.

**Architecture:** The page becomes a CSS grid (`body`) with three regions; the main pane is the only scroll container. Two new browser modules keep `app.js` from growing: `tree-toggle.js` (collapse helpers, moved out of `app.js`) and `app-shell.js` (banner, sidebar, theme, shortcuts, help modal, badge, tab title). Filter logic in `app-filter.js` gains a pure `computeAttention` function used by both the highlighting and the ready filter. Pure functions get `node:test` unit tests; layout is verified manually in the browser.

**Tech Stack:** Vanilla ES modules, CSS custom properties, Font Awesome 5.15.3, `node:test` (Node 24, no extra dependency). No server change.

**Spec:** `docs/superpowers/specs/2026-09-05-sidebar-layout-design.md`

**Branch:** `claude/sidebar-layout` (already created, spec committed).

---

## File structure

| File | Responsibility |
|---|---|
| `public/index.html` | App shell markup: banner, sidebar with stacked filters, main pane with toolbar, help modal. Inline `<head>` script applies theme and sidebar state before paint. |
| `public/styles.css` | Rewritten in sections: tokens (light and dark), base, app shell, controls, multi-select, tree, orphaned issues, popovers, modal and help, state messages, responsive. |
| `public/app-shell.js` (new) | Banner and sidebar chrome: toggle + persistence + drawer, theme, keyboard shortcuts, help modal, active-filter badge, document title, tree toolbar. No DOM access at import time. |
| `public/tree-toggle.js` (new) | Collapse/expand helpers for repositories, root branches and pull requests; collapse all / expand all; capture/restore of toggle states. Moved out of `app.js`. |
| `public/app.js` | Data loading, rendering, filter state. Gains `applyFilters()`, `clearAllFilters()`, state messages; loses the code moved to the two new modules. |
| `public/app-filter.js` | `computeAttention`, `countActiveFilters`, `needs-attention` class, attention count returned by `filterBranches`. |
| `test/app-filter.test.mjs` (new) | Unit tests for `computeAttention` and `countActiveFilters`. |
| `test/app-shell.test.mjs` (new) | Unit tests for `buildDocumentTitle`. |
| `package.json` | Version 2.2.0, release date, real `npm test`. |
| `README.md`, `CLAUDE.md`, `PRD.md` | Documentation of the new layout. |

Untouched: `public/multi-select.js`, `public/counter-utils.js`, `index.mjs`, `cache.mjs`.

**Running the app for manual checks:** `node index.mjs` from the repository root, then open http://localhost:3000. It needs the existing `config.js` with valid Atlassian credentials. Stop it with Ctrl+C.

**Running the unit tests:** `npm test` (after Task 1 adds the script). Expected output ends with `ℹ fail 0`.

---

## Workflow: one issue and one stacked PR per task

Every task below is tracked by a GitHub issue and delivered as its own pull request, stacked on the previous task's branch. The spec and this plan form the base of the stack.

| Task | Issue | Branch | PR base |
|---|---|---|---|
| (docs) spec and plan | #16 (tracking) | `claude/sidebar-layout` | `master` |
| 1 | #9 | `claude/sidebar-layout-1-attention` | `claude/sidebar-layout` |
| 2 | #10 | `claude/sidebar-layout-2-tree-toggle` | `claude/sidebar-layout-1-attention` |
| 3 | #11 | `claude/sidebar-layout-3-css-tokens` | `claude/sidebar-layout-2-tree-toggle` |
| 4 | #12 | `claude/sidebar-layout-4-app-shell` | `claude/sidebar-layout-3-css-tokens` |
| 5 | #13 | `claude/sidebar-layout-5-filter-chrome` | `claude/sidebar-layout-4-app-shell` |
| 6 | #14 | `claude/sidebar-layout-6-dark-theme` | `claude/sidebar-layout-5-filter-chrome` |
| 7 | #15 | `claude/sidebar-layout-7-docs` | `claude/sidebar-layout-6-dark-theme` |

For each task:

1. `git checkout -b <branch> <PR base branch>`
2. Follow the steps and commit as written in the task.
3. `git push -u origin <branch>`
4. Open the PR against the base branch from the table, with `Closes #<issue number>` in the body:

```bash
gh pr create --base <PR base branch> --title "<commit title>" --body "$(cat <<'BODY'
<one paragraph: what and why>

Closes #<issue number>
Part of #16
Stacked on #<previous PR number>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01EZCANUDoVq6pd6b9i8vGbg
BODY
)"
```

**Merging the stack (repository owner):** merge bottom-up. Before merging each PR, retarget the next PR onto `master` (`gh pr edit <next PR> --base master`), then merge the current one and confirm `git log origin/master` advanced. GitHub does not reliably retarget a stacked PR when its base branch is deleted, and a PR that slipped into the closed state cannot be retargeted any more.

---

### Task 1: Data-driven "needs attention" and the Ready for reviewer filter

The filter currently reads the computed colour of the title link. Replace it with a pure function, add the `needs-attention` class, return the attention count from `filterBranches`, and add the first unit tests.

**Files:**
- Modify: `public/app-filter.js`
- Modify: `public/styles.css` (token rename and one rule; the file is rewritten in Task 4)
- Modify: `package.json` (test script only)
- Create: `test/app-filter.test.mjs`

- [ ] **Step 1: Add the test script to package.json**

In `package.json`, replace the `scripts` block:

```json
  "scripts": {
    "test": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test"
  },
```

The flag silences Node's warning about `.js` files that are detected as ES modules because `package.json` has no `"type"` field (adding `"type": "module"` is not an option: `config.js` and `projects.js` are CommonJS).

- [ ] **Step 2: Write the failing tests**

Create `test/app-filter.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAttention, countActiveFilters } from '../public/app-filter.js';

const author = { uuid: 'author-uuid', display_name: 'Author' };
const jane = { uuid: 'jane-uuid', display_name: 'Jane' };
const bob = { uuid: 'bob-uuid', display_name: 'Bob' };

function pullRequest(participants) {
    return { id: 1, author, participants };
}

const issueAssignedToJane = { key: 'PROJ-1', fields: { assignee: { displayName: 'Jane' } } };
const issueUnassigned = { key: 'PROJ-2', fields: { assignee: null } };

const noFilters = { linkedIssues: [], assignees: [], reviewers: [] };

test('reviewer attention when a selected reviewer has not approved an in-review PR', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane'] });
    assert.deepEqual(attention, { assignee: false, reviewer: true, any: true });
});

test('no reviewer attention once the selected reviewer approved', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: true }, { user: bob, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane'] });
    assert.equal(attention.reviewer, false);
    assert.equal(attention.any, false);
});

test('reviewer attention matches any of several selected reviewers', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: true }, { user: bob, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Jane', 'Bob'] });
    assert.equal(attention.reviewer, true);
});

test('the author never counts as a reviewer', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: false, statusInReview: true, reviewers: ['Author'] });
    assert.equal(attention.reviewer, false);
});

test('reviewer attention only applies to PRs in review', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: true, statusInReview: false, reviewers: ['Jane'] });
    assert.equal(attention.reviewer, false);
});

test('assignee attention when a selected assignee owns an issue of an in-progress PR', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, {
        statusInProgress: true, statusInReview: false,
        linkedIssues: [issueUnassigned, issueAssignedToJane], assignees: ['Jane'], reviewers: []
    });
    assert.deepEqual(attention, { assignee: true, reviewer: false, any: true });
});

test('assignee attention only applies to PRs in progress', () => {
    const pr = pullRequest([{ user: author, approved: false }]);
    const attention = computeAttention(pr, {
        statusInProgress: false, statusInReview: true,
        linkedIssues: [issueAssignedToJane], assignees: ['Jane'], reviewers: []
    });
    assert.equal(attention.assignee, false);
});

test('no attention without assignee or reviewer filters', () => {
    const pr = pullRequest([{ user: author, approved: false }, { user: jane, approved: false }]);
    const attention = computeAttention(pr, { ...noFilters, statusInProgress: true, statusInReview: true, linkedIssues: [issueAssignedToJane] });
    assert.deepEqual(attention, { assignee: false, reviewer: false, any: false });
});

test('countActiveFilters counts filters, not selected values', () => {
    const defaults = { assignees: [], reviewers: [], sprints: [], fixVersions: [], sync: 'Show all', ready: false };
    assert.equal(countActiveFilters(defaults), 0);
    assert.equal(countActiveFilters({ ...defaults, reviewers: ['Jane', 'Bob'], ready: true }), 2);
    assert.equal(countActiveFilters({ ...defaults, sync: 'requested' }), 1);
    assert.equal(countActiveFilters({ assignees: ['A'], reviewers: ['J'], sprints: ['1'], fixVersions: ['2'], sync: 'OK', ready: true }), 6);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: the run fails while loading the file with `SyntaxError: The requested module '../public/app-filter.js' does not provide an export named 'computeAttention'` (and `ℹ fail 1`).

- [ ] **Step 4: Implement the filter changes**

Replace the whole of `public/app-filter.js` with:

```js
import { updateAllCounters } from './counter-utils.js';

let currentApiResult = null;

export function initializeFilter(apiResult) {
    currentApiResult = apiResult;
}

/**
 * Counts the filters that are not at their default value.
 * A multi-select with several values counts once.
 */
export function countActiveFilters({ assignees, reviewers, sprints, fixVersions, sync, ready }) {
    return [
        assignees.length > 0,
        reviewers.length > 0,
        sprints.length > 0,
        fixVersions.length > 0,
        ready === true,
        sync !== 'Show all'
    ].filter(Boolean).length;
}

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

function getLinkedIssues(pullRequestData) {
    const keys = currentApiResult.jiraIssuesMap[pullRequestData.id] || [];
    return keys
        .map(key => currentApiResult.jiraIssuesDetails.find(issue => issue.key === key))
        .filter(issue => issue);
}

/**
 * Applies the filters to the rendered tree and refreshes the counters.
 * @returns {number} how many pull requests are left shown and need attention
 */
export function filterBranches(assignees, reviewers, sprints, fixVersions, sync, ready) {
    // Start filtering from the root branches
    let rootBranches = document.getElementsByClassName("root-branch");
    Array.from(rootBranches).forEach(rootBranch => {
        filterBranch(rootBranch, assignees, reviewers, sprints, fixVersions, sync, ready);
    });

    // Update all counters after filtering
    // Pass first selected values for backwards compatibility with counter-utils
    const assignee = assignees.length > 0 ? assignees[0] : "Show all";
    const reviewer = reviewers.length > 0 ? reviewers[0] : "Show all";
    const sprint = sprints.length > 0 ? sprints[0] : "Show all";
    updateAllCounters(assignee, reviewer, sprint, sync);

    return countShownAttention();
}

function countShownAttention() {
    return Array.from(document.querySelectorAll('.pull-request.needs-attention'))
        .filter(pr => pr.style.display !== 'none' && !pr.classList.contains('filtered'))
        .length;
}

function filterBranch(branch, assignees, reviewers, sprints, fixVersions, sync, ready) {
    let pullRequests = branch.querySelectorAll(".pull-request");
    let visiblePullRequests = 0;

    // Filter pull requests from bottom to top
    visiblePullRequests += filterPullRequests(pullRequests, assignees, reviewers, sprints, fixVersions, sync, ready);

    // Hide branch if no visible pull requests
    branch.style.display = visiblePullRequests > 0 ? "" : "none";

    return visiblePullRequests;
}

function filterPullRequests(pullRequests, assignees, reviewers, sprints, fixVersions, sync, ready) {
    let visiblePullRequests = 0;
    for (let i = 0; i < pullRequests.length; i++) {
        let pr = pullRequests[i];
        let prId = pr.dataset.id;
        let pullRequestData = currentApiResult.pullRequests.find(p => p.id === parseInt(prId));

        let visibleChildren = 0;

        // Check if this pull request has children
        let childrenContainer = pr.nextElementSibling;
        if (childrenContainer && childrenContainer.classList.contains('children')) {
            // If it has children, check if any of them are visible
            let childrenPullRequests = childrenContainer.querySelectorAll(".pull-request");
            visibleChildren += filterPullRequests(childrenPullRequests, assignees, reviewers, sprints, fixVersions, sync, ready);
            visiblePullRequests += visibleChildren;
        }

        // Attention is computed from data before visibility, so the ready filter never
        // depends on what a previous pass rendered
        const attention = computeAttention(pullRequestData, {
            statusInProgress: pr.classList.contains('status-in-progress'),
            statusInReview: pr.classList.contains('status-in-review'),
            linkedIssues: getLinkedIssues(pullRequestData),
            assignees,
            reviewers
        });
        pr.classList.toggle('needs-attention', attention.any);

        // Check if this pull request should be visible
        let isVisible = isPullRequestVisible(pr, pullRequestData, assignees, reviewers, sprints, fixVersions, sync, ready, attention);

        // Update visibility state
        pr.classList.toggle("filtered", !isVisible);
        pr.style.display = (!isVisible && visibleChildren === 0) ? "none" : "";

        if (isVisible) {
            visiblePullRequests++;
        }
    }

    return visiblePullRequests;
}

function isPullRequestVisible(prElement, pullRequestData, assignees, reviewers, sprints, fixVersions, sync, ready, attention) {
    // Assignee filter - check Jira issue assignees
    // Empty array = show all (no filtering)
    // Non-empty = match ANY selected value
    const assigneeMatch = assignees.length === 0 || (() => {
        const jiraIssueKeys = currentApiResult.jiraIssuesMap[pullRequestData.id] || [];
        return jiraIssueKeys.some(issueKey => {
            const issue = currentApiResult.jiraIssuesDetails.find(i => i.key === issueKey);
            return issue && issue.fields.assignee && assignees.includes(issue.fields.assignee.displayName);
        });
    })();

    // Reviewer filter - match ANY selected reviewer
    const reviewerMatch = reviewers.length === 0 || pullRequestData.participants.some(p =>
        p.user.uuid !== pullRequestData.author.uuid && reviewers.includes(p.user.display_name)
    );

    // Sprint filter - match if ANY linked issue is in ANY selected sprint
    const sprintMatch = sprints.length === 0 || (
        currentApiResult.jiraIssuesMap[pullRequestData.id] &&
        currentApiResult.jiraIssuesMap[pullRequestData.id].some(issueKey =>
            sprints.some(sprintId =>
                currentApiResult.sprintIssues[sprintId] && currentApiResult.sprintIssues[sprintId].includes(issueKey)
            )
        )
    );

    // Fix Version filter - match if ANY linked issue has ANY selected fix version
    const fixVersionMatch = fixVersions.length === 0 || (
        currentApiResult.jiraIssuesMap[pullRequestData.id] &&
        currentApiResult.jiraIssuesMap[pullRequestData.id].some(issueKey => {
            const issueDetails = currentApiResult.jiraIssuesDetails.find(issue => issue.key === issueKey);
            return issueDetails && issueDetails.fields.fixVersions &&
                issueDetails.fields.fixVersions.some(version => fixVersions.includes(String(version.id)));
        })
    );

    // Sync filter
    const syncCounter = prElement.querySelector('.conflicts-counter');
    const syncCountElement = syncCounter ? syncCounter.querySelector('.conflicts-count') : null;
    const hasSyncLabel = syncCountElement !== null;
    const syncMatch = sync === "Show all" ||
        (sync === "requested" && hasSyncLabel) ||
        (sync === "OK" && !hasSyncLabel);

    // Ready for reviewer filter: in review, and a selected reviewer has not approved yet
    const readyMatch = !ready || attention.reviewer;

    return assigneeMatch && reviewerMatch && sprintMatch && fixVersionMatch && syncMatch && readyMatch;
}
```

Note what disappeared: `updatePullRequestStyle` and the inline `style.color` on the title. The highlight now comes from CSS.

- [ ] **Step 5: Rename the token and add the highlight rule in the current stylesheet**

In `public/styles.css`, change the token line in `:root`:

```css
    --attention-color: #FF5630;
```

(replacing `--secondary-color: #FF5630;`), and add right after the `.pull-request a:hover` rule:

```css
.pull-request.needs-attention .pull-request-link {
    color: var(--attention-color);
}
```

Then check nothing else references the old name:

Run: `grep -rn "secondary-color" public/`
Expected: no output.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 7: Manual check in the browser**

Start `node index.mjs`, open http://localhost:3000, pick a project, select a reviewer: PRs in review not yet approved by that reviewer have an orange title, exactly as before. Tick "Ready for reviewer": only those PRs stay. Untick, change the reviewer: highlights follow the new selection immediately. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add package.json public/app-filter.js public/styles.css test/app-filter.test.mjs
git commit -m "fix: derive ready-for-reviewer from data instead of the title colour

Adds computeAttention and countActiveFilters in app-filter.js with node:test
unit tests, and highlights titles through a needs-attention class.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EZCANUDoVq6pd6b9i8vGbg"
```

---

### Task 2: Move collapse helpers to `tree-toggle.js` and add collapse all / expand all

`app.js` holds three toggle functions plus capture/restore of toggle states, each changing the DOM in its own way. The repository toggle swaps icon classes in JavaScript, which loses the chevron after an automatic refresh restores a collapsed repository. Move everything to a module built around three `set*Collapsed` helpers, and add `collapseAll` / `expandAll` on top (the toolbar buttons that call them arrive in Task 5). Headings in the rendered tree get class names so the helpers no longer depend on heading tags.

**Files:**
- Create: `public/tree-toggle.js`
- Modify: `public/app.js` (imports, removed functions, rendered markup, window exports)
- Modify: `public/styles.css` (heading selectors; rewritten in Task 3)

- [ ] **Step 1: Create the module**

Create `public/tree-toggle.js`:

```js
/**
 * Collapse and expand helpers for the pull-request tree.
 *
 * Repositories, root branches and pull requests with children can be
 * collapsed. Every code path that changes a collapsed state goes through the
 * set*Collapsed helpers, so the collapsed class, the children container and
 * the child counter always change together. The chevrons are pure CSS, driven
 * by the "collapsed" class.
 */

export function setRepositoryCollapsed(repository, collapsed) {
    repository.classList.toggle('collapsed', collapsed);
}

export function setRootBranchCollapsed(rootBranch, collapsed) {
    rootBranch.classList.toggle('collapsed', collapsed);
}

export function setPullRequestCollapsed(pullRequest, collapsed) {
    const children = pullRequest.nextElementSibling;
    if (!children || !children.classList.contains('children')) {
        return;
    }
    pullRequest.classList.toggle('collapsed', collapsed);
    children.hidden = collapsed;
    // The child counter is shown on root pull requests permanently, and on
    // other pull requests only while they are collapsed. counter-utils only
    // refreshes counters carrying the "visible" class.
    const childCounter = pullRequest.querySelector('.child-counter');
    if (childCounter) {
        const isRoot = pullRequest.classList.contains('pull-request-root');
        childCounter.classList.toggle('visible', collapsed || isRoot);
    }
}

export function toggleRepository(button) {
    const repository = button.closest('.repository');
    setRepositoryCollapsed(repository, !repository.classList.contains('collapsed'));
}

export function toggleRootBranch(button) {
    const rootBranch = button.closest('.root-branch');
    setRootBranchCollapsed(rootBranch, !rootBranch.classList.contains('collapsed'));
}

export function toggleChildren(button) {
    const pullRequest = button.closest('.pull-request');
    setPullRequestCollapsed(pullRequest, !pullRequest.classList.contains('collapsed'));
}

function setAllCollapsed(collapsed) {
    document.querySelectorAll('.repository').forEach(repository => setRepositoryCollapsed(repository, collapsed));
    document.querySelectorAll('.root-branch').forEach(rootBranch => setRootBranchCollapsed(rootBranch, collapsed));
    document.querySelectorAll('.pull-request').forEach(pullRequest => setPullRequestCollapsed(pullRequest, collapsed));
}

export function collapseAll() {
    setAllCollapsed(true);
}

export function expandAll() {
    setAllCollapsed(false);
}

/**
 * Snapshot of what is collapsed, keyed by repository name, root branch name
 * and pull request id, so a re-render can put the tree back as the user left it.
 */
export function captureToggleStates() {
    const states = { repositories: [], rootBranches: [], pullRequests: [] };

    document.querySelectorAll('.repository').forEach(repository => {
        const name = repository.querySelector('.repository-name');
        if (name) {
            states.repositories.push({
                name: name.textContent.trim(),
                collapsed: repository.classList.contains('collapsed')
            });
        }
    });

    document.querySelectorAll('.root-branch').forEach(rootBranch => {
        const link = rootBranch.querySelector('.root-branch-name a');
        if (link) {
            // The first text node is the branch name; the external-link icon follows it
            states.rootBranches.push({
                name: link.childNodes[0].textContent.trim(),
                collapsed: rootBranch.classList.contains('collapsed')
            });
        }
    });

    document.querySelectorAll('.pull-request').forEach(pullRequest => {
        const children = pullRequest.nextElementSibling;
        if (children && children.classList.contains('children')) {
            states.pullRequests.push({
                id: pullRequest.dataset.id,
                collapsed: pullRequest.classList.contains('collapsed')
            });
        }
    });

    return states;
}

export function restoreToggleStates(states) {
    if (!states) return;

    states.repositories.filter(state => state.collapsed).forEach(state => {
        const repository = Array.from(document.querySelectorAll('.repository')).find(candidate => {
            const name = candidate.querySelector('.repository-name');
            return name && name.textContent.trim() === state.name;
        });
        if (repository) setRepositoryCollapsed(repository, true);
    });

    states.rootBranches.filter(state => state.collapsed).forEach(state => {
        const rootBranch = Array.from(document.querySelectorAll('.root-branch')).find(candidate => {
            const link = candidate.querySelector('.root-branch-name a');
            return link && link.childNodes[0].textContent.trim() === state.name;
        });
        if (rootBranch) setRootBranchCollapsed(rootBranch, true);
    });

    states.pullRequests.filter(state => state.collapsed).forEach(state => {
        const pullRequest = document.querySelector(`.pull-request[data-id="${state.id}"]`);
        if (pullRequest) setPullRequestCollapsed(pullRequest, true);
    });
}
```

- [ ] **Step 2: Import the module in app.js and delete the moved code**

At the top of `public/app.js`, after the existing two imports, add:

```js
import { toggleChildren, toggleRootBranch, toggleRepository, captureToggleStates, restoreToggleStates } from './tree-toggle.js';
```

Delete these functions from `public/app.js` (they now live in the module): `toggleChildren`, `toggleRootBranch`, `toggleRepository` (the block between `handleFilterChange` and `populateFilters`), and `captureToggleStates`, `restoreToggleStates` (the block between `renderOrphanedIssues` and `renderEverything`).

Keep the three lines at the very end of the file; they now re-export the imported functions for the inline `onclick` handlers in the rendered markup:

```js
window.toggleChildren = toggleChildren;
window.toggleRootBranch = toggleRootBranch;
window.toggleRepository = toggleRepository;
```

Run: `grep -n "function toggle\|function captureToggleStates\|function restoreToggleStates" public/app.js`
Expected: no output.

- [ ] **Step 3: Update the rendered markup**

In `renderRepositories` (`public/app.js`), replace the header:

```js
                <div class="repository-header" onclick="toggleRepository(this)">
                    <button class="toggle-button">
                        <i class="fas fa-chevron-down"></i>
                        <i class="fas fa-chevron-right"></i>
                    </button>
                    <h2 class="repository-name">${repoName}</h2>
```

(the old markup had a single chevron and an `<h1>`).

In `renderPullRequests`, replace the root-branch heading (the old one was an `<h2>` with inline styles on the link and the icon):

```js
                        <h3 class="root-branch-name">
                            <a href="${branchUrl}" target="_blank" onclick="event.stopPropagation();" class="root-branch-link">
                                ${rootBranch}
                                <i class="fas fa-external-link-alt external-link-icon"></i>
                            </a>
                        </h3>
```

In `renderPullRequest`, mark root pull requests (level 1) so the collapse helper knows their counter stays visible. Replace the opening tag of the card:

```js
        <div class="pull-request ${statusClass}${isRootPullRequest ? ' pull-request-root' : ''}" data-id="${pullRequest.id}">
```

`isRootPullRequest` is already defined a few lines above (`const isRootPullRequest = level === 1;`).

- [ ] **Step 4: Update the heading selectors in the current stylesheet**

In `public/styles.css`, replace the `.repository-header h1 { ... }` rule with:

```css
.repository-name {
    margin: 0;
    font-size: 24px;
    font-weight: bold;
    color: white;
    flex-grow: 1;
}
```

Replace the `.root-branch-header h2 { ... }` rule and the four `.root-branch-header h2 a ...` / `.root-branch-header h2 .fa-external-link-alt` rules near the end of the file with:

```css
.root-branch-name {
    margin: 0;
    font-size: 18px;
    font-weight: bold;
    color: var(--primary-color);
    flex-grow: 1;
}

.root-branch-link {
    display: inline-flex;
    align-items: center;
    color: inherit;
    text-decoration: none;
}

.external-link-icon {
    margin-left: 5px;
    font-size: 0.8em;
    opacity: 0.6;
    transition: opacity 0.2s ease;
}

.root-branch-link:hover .external-link-icon {
    opacity: 1;
}
```

The existing chevron rules (`.collapsed .toggle-button .fa-chevron-down { display: none; }` and friends) already cover repositories now that both icons are rendered.

Run: `grep -n "repository-header h1\|root-branch-header h2" public/styles.css`
Expected: no output.

- [ ] **Step 5: Run the unit tests and check in the browser**

Run: `npm test`
Expected: `ℹ fail 0`.

Start `node index.mjs`, open http://localhost:3000, pick a project:
- Click a repository header, a branch header and a PR chevron: each collapses and expands, chevrons point right when collapsed.
- Collapse a root PR: its child counter stays; collapse a nested PR: its child counter appears and disappears with it.
- In the DevTools console run `document.querySelector('.repository').classList.add('collapsed')` (what a refresh does when restoring): the repository collapses and shows a right chevron; clicking its header expands it with a down chevron.
- In the console run `import('./tree-toggle.js').then(m => m.collapseAll())` then `... m.expandAll()`: everything folds, then unfolds.

Stop the server.

- [ ] **Step 6: Commit**

```bash
git add public/tree-toggle.js public/app.js public/styles.css
git commit -m "refactor: move tree collapse helpers to tree-toggle.js

Repositories, branches and pull requests share set*Collapsed helpers, gain
collapseAll/expandAll, and repository chevrons are CSS-driven like the others.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EZCANUDoVq6pd6b9i8vGbg"
```

---

### Task 3: Rewrite the stylesheet around colour tokens (current layout kept)

`styles.css` has grown by accretion: duplicate `spin` and `versionPulse` keyframes, duplicate popover and `.container` rules, two footer media queries, rules for a help button that no longer exists, and about twenty-five hard-coded greys and whites. Rewrite it in sections with every colour coming from a token, switch to the system font stack, and keep the current page layout untouched (the shell arrives in Task 4, the dark values in Task 6). The only visible change is the font.

**Files:**
- Modify: `public/styles.css` (full replacement)

- [ ] **Step 1: Replace the stylesheet**

Replace the whole of `public/styles.css` with:

```css
/* ==========================================================================
   Bitbucket Pull-Requests Tree
   1. Tokens          2. Base             3. Page layout
   4. Controls        5. Multi-select     6. Tree
   7. Orphaned issues 8. Popovers         9. Modal and help
   ========================================================================== */

/* 1. Tokens --------------------------------------------------------------- */
:root {
    color-scheme: light;

    --primary-color: #0052CC;
    --attention-color: #FF5630;
    --background-color: #F4F5F7;
    --surface-color: #FFFFFF;
    --surface-muted: #EBECF0;
    --text-color: #172B4D;
    --text-muted: #6B778C;
    --border-color: #DFE1E6;
    --success-color: #36B37E;
    --warning-color: #FFAB00;
    --error-color: #FF5630;
    --in-review-color: #0065FF;
    --danger-bg: #FFEBE6;
    --danger-text: #BF2600;
    --on-accent-text: #FFFFFF;
    --shadow-color: rgba(9, 30, 66, 0.15);
    --focus-ring: rgba(0, 82, 204, 0.25);
    --backdrop-color: rgba(9, 30, 66, 0.45);

    --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

    /* FontAwesome chevron-down, mid grey, readable on light and dark surfaces */
    --chevron-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 448 512' fill='%238993A4'%3E%3Cpath d='M207.029 381.476L12.686 187.132c-9.373-9.373-9.373-24.569 0-33.941l22.667-22.667c9.357-9.357 24.522-9.375 33.901-.04L224 284.505l154.745-154.021c9.379-9.335 24.544-9.317 33.901.04l22.667 22.667c9.373 9.373 9.373 24.569 0 33.941L240.971 381.476c-9.373 9.372-24.569 9.372-33.942 0z'/%3E%3C/svg%3E");
}

/* 2. Base ----------------------------------------------------------------- */
*,
*::before,
*::after {
    box-sizing: border-box;
}

[hidden] {
    display: none !important;
}

body {
    margin: 0;
    font-family: var(--font-family);
    line-height: 1.6;
    color: var(--text-color);
    background-color: var(--background-color);
}

button,
select,
input {
    font-family: inherit;
    font-size: inherit;
}

:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* 3. Page layout (replaced by the app shell in Task 4) -------------------- */
body {
    padding: 20px;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px 20px 60px;
    background-color: var(--surface-color);
    border-radius: 8px;
    box-shadow: 0 0 10px var(--shadow-color);
}

.header-container {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--border-color);
}

.header-container h1 {
    margin: 0;
    color: var(--primary-color);
}

.refresh-container {
    display: flex;
    align-items: center;
    gap: 8px;
}

.last-refresh {
    color: var(--text-muted);
    font-size: 0.9em;
    font-style: italic;
}

.refresh-icon {
    color: var(--primary-color);
    font-size: 0.9em;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.refresh-icon.checking {
    opacity: 1;
    animation: spin 1s linear infinite;
}

.filters-container {
    margin-bottom: 20px;
    padding: 15px;
    background-color: var(--surface-color);
    border-radius: 8px;
    box-shadow: 0 2px 4px var(--shadow-color);
}

.filters-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 20px;
    margin-bottom: 15px;
}

.filters-row:last-child {
    margin-bottom: 0;
}

.filter-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1 1 auto;
    min-width: 200px;
}

.filter-label {
    flex-shrink: 0;
    min-width: 70px;
    color: var(--text-color);
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
}

.filter-item select {
    flex: 1;
    min-width: 0;
}

.filter-item .multi-select {
    flex: 1 1 auto;
    min-width: 0;
}

.filter-item input[type="checkbox"] {
    margin-right: 8px;
}

.filter-item input[type="checkbox"]:disabled + label {
    color: var(--text-muted);
    cursor: not-allowed;
}

.filter-item label {
    cursor: pointer;
    user-select: none;
}

.app-footer {
    padding: 30px 0 10px;
    background-color: var(--primary-color);
    color: var(--on-accent-text);
    font-size: 14px;
    box-shadow: 0 -2px 10px var(--shadow-color);
}

.footer-content {
    display: flex;
    justify-content: space-around;
    flex-wrap: wrap;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
}

.footer-section {
    flex: 1;
    min-width: 200px;
    margin-bottom: 20px;
}

.footer-section h3 {
    margin-bottom: 10px;
    padding-bottom: 5px;
    border-bottom: 2px solid rgba(255, 255, 255, 0.1);
    color: var(--on-accent-text);
    font-size: 18px;
}

.footer-links {
    list-style-type: none;
    padding: 0;
}

.footer-link {
    display: flex;
    align-items: center;
    margin-bottom: 5px;
    color: var(--on-accent-text);
    opacity: 0.8;
    text-decoration: none;
    transition: opacity 0.3s ease;
}

.footer-link:hover {
    opacity: 1;
}

.footer-link i {
    width: 20px;
    margin-right: 5px;
    text-align: center;
}

.version-info,
.author-info,
.license-info {
    margin-bottom: 5px;
    opacity: 0.8;
}

.version-number {
    margin-right: 5px;
    font-weight: bold;
}

.version-date {
    font-style: italic;
}

.footer-bottom {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    text-align: center;
}

@keyframes versionPulse {
    0% { opacity: 0.7; }
    50% { opacity: 1; }
    100% { opacity: 0.7; }
}

@media (max-width: 768px) {
    .footer-content {
        flex-direction: column;
    }

    .footer-section {
        width: 100%;
        margin-bottom: 30px;
    }

    .filters-row {
        flex-direction: column;
        gap: 15px;
    }

    .filter-item {
        width: 100%;
    }
}

/* 4. Controls ------------------------------------------------------------- */
select {
    padding: 8px 32px 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    background-image: var(--chevron-icon);
    background-repeat: no-repeat;
    background-position: right 12px center;
    background-size: 12px;
    color: var(--text-color);
    font-size: 14px;
    line-height: inherit;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    transition: border-color 0.2s ease;
}

select:hover:not(:disabled) {
    border-color: var(--primary-color);
}

select:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px var(--focus-ring);
}

select:disabled {
    background-color: var(--surface-muted);
    color: var(--text-muted);
    opacity: 0.7;
    cursor: not-allowed;
}

.load-sync-button {
    flex-shrink: 0;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    color: var(--text-color);
    font-size: 14px;
    line-height: inherit;
    white-space: nowrap;
    cursor: pointer;
    transition: border-color 0.2s ease;
}

.load-sync-button:hover:not(:disabled) {
    border-color: var(--primary-color);
    color: var(--primary-color);
}

.load-sync-button:disabled {
    background-color: var(--surface-muted);
    color: var(--text-muted);
    opacity: 0.7;
    cursor: not-allowed;
}

.sync-warning {
    flex-shrink: 0;
    color: var(--warning-color);
    cursor: help;
}

.info-icon {
    color: var(--primary-color);
    cursor: help;
}

/* 5. Multi-select --------------------------------------------------------- */
.multi-select {
    position: relative;
}

.multi-select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    color: var(--text-color);
    font-size: 14px;
    cursor: pointer;
    outline: none;
    transition: border-color 0.2s ease;
}

.multi-select-trigger:hover {
    border-color: var(--primary-color);
}

.multi-select-trigger:focus {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 2px var(--focus-ring);
}

.multi-select.disabled .multi-select-trigger {
    background-color: var(--surface-muted);
    opacity: 0.7;
    cursor: not-allowed;
}

.multi-select-display {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.multi-select-display.has-selection {
    font-weight: 500;
}

.multi-select-arrow {
    margin-left: 8px;
    color: var(--text-muted);
    font-size: 12px;
    transition: transform 0.2s ease;
}

.multi-select.open .multi-select-arrow {
    transform: rotate(180deg);
}

.multi-select-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 100;
    margin-top: 4px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    box-shadow: 0 4px 12px var(--shadow-color);
    overflow: hidden;
}

.multi-select.open .multi-select-dropdown {
    display: block;
}

.multi-select-search {
    padding: 8px;
    border-bottom: 1px solid var(--border-color);
}

.multi-select-search-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    color: var(--text-color);
    font-size: 14px;
    outline: none;
}

.multi-select-search-input:focus {
    border-color: var(--primary-color);
}

.multi-select-options {
    max-height: 250px;
    overflow-y: auto;
}

.multi-select-option {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    transition: background-color 0.15s ease;
}

.multi-select-option:hover {
    background-color: var(--surface-muted);
}

.multi-select-option input[type="checkbox"] {
    margin-right: 8px;
    cursor: pointer;
}

.multi-select-option-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.multi-select-no-results {
    padding: 12px;
    color: var(--text-muted);
    font-style: italic;
    text-align: center;
}

.multi-select-actions {
    display: flex;
    justify-content: space-between;
    padding: 8px;
    border-top: 1px solid var(--border-color);
    background-color: var(--surface-muted);
}

.multi-select-actions button {
    padding: 4px 12px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    color: var(--text-color);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
}

.multi-select-actions button:hover {
    border-color: var(--primary-color);
    color: var(--primary-color);
}

/* 6. Tree ----------------------------------------------------------------- */
.repository {
    margin-bottom: 30px;
}

.repository-header {
    position: relative;
    display: flex;
    align-items: center;
    padding: 10px;
    background-color: var(--primary-color);
    color: var(--on-accent-text);
    border-radius: 4px 4px 0 0;
    cursor: pointer;
}

.repository-name {
    flex-grow: 1;
    margin: 0;
    color: inherit;
    font-size: 24px;
    font-weight: bold;
}

.repo-pr-counter {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    margin-left: 15px;
    padding: 0 8px;
    border-radius: 12px;
    background-color: var(--surface-color);
    color: var(--primary-color);
    font-size: 14px;
    font-weight: bold;
}

.repository-content {
    padding: 20px;
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 4px 4px;
    background-color: var(--surface-color);
}

.repository.collapsed .repository-content {
    display: none;
}

.root-branch {
    margin-bottom: 20px;
}

.root-branch-header {
    position: relative;
    display: flex;
    align-items: center;
    padding: 10px;
    background-color: var(--background-color);
    border-radius: 4px;
    cursor: pointer;
}

.root-branch-name {
    flex-grow: 1;
    margin: 0;
    color: var(--primary-color);
    font-size: 18px;
    font-weight: bold;
}

.root-branch-link {
    display: inline-flex;
    align-items: center;
    color: inherit;
    text-decoration: none;
}

.external-link-icon {
    margin-left: 5px;
    font-size: 0.8em;
    opacity: 0.6;
    transition: opacity 0.2s ease;
}

.root-branch-link:hover .external-link-icon {
    opacity: 1;
}

.branch-pr-counter {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    margin-left: 10px;
    padding: 0 5px;
    border-radius: 10px;
    background-color: var(--primary-color);
    color: var(--on-accent-text);
    font-size: 12px;
    font-weight: bold;
}

.root-branch-content {
    margin-top: 10px;
}

.root-branch.collapsed .root-branch-content {
    display: none;
}

.toggle-button {
    margin-right: 10px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font-size: 16px;
    cursor: pointer;
}

.pull-request .toggle-button,
.root-branch-header .toggle-button {
    color: var(--text-color);
}

.pull-request .toggle-button:hover,
.root-branch-header .toggle-button:hover {
    color: var(--primary-color);
}

.repository-header .toggle-button:hover {
    opacity: 0.8;
}

/* Chevrons: down when open, right when collapsed, one pair per level */
.toggle-button .fa-chevron-right {
    display: none;
}

.repository.collapsed > .repository-header .fa-chevron-down,
.root-branch.collapsed > .root-branch-header .fa-chevron-down,
.pull-request.collapsed .pull-request-header .fa-chevron-down {
    display: none;
}

.repository.collapsed > .repository-header .fa-chevron-right,
.root-branch.collapsed > .root-branch-header .fa-chevron-right,
.pull-request.collapsed .pull-request-header .fa-chevron-right {
    display: inline;
}

.pull-request {
    position: relative;
    margin-bottom: 10px;
    padding: 15px;
    border: 2px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    transition: box-shadow 0.3s ease;
}

.pull-request:hover {
    box-shadow: 0 0 5px var(--shadow-color);
}

.pull-request-content {
    padding-right: 70px; /* Make space for the counters */
}

.pull-request-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    width: 100%;
}

.pull-request-info {
    flex: 1;
    margin-right: 20px;
}

.pull-request-issues {
    flex: 0 0 290px;
}

.pull-request-details {
    margin-top: 10px;
}

.pull-request.filtered {
    opacity: 0.5;
    background-color: var(--surface-muted);
}

.pull-request.filtered .pull-request-details {
    display: none;
}

.pull-request a {
    color: var(--primary-color);
    font-weight: bold;
    text-decoration: none;
}

.pull-request a:hover {
    text-decoration: underline;
}

.pull-request.needs-attention .pull-request-link {
    color: var(--attention-color);
}

.pull-request-header {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
}

.participants {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.image-container {
    position: relative;
    display: inline-flex;
    align-items: center;
    height: 24px; /* Match the height of the avatar */
}

.image-container img {
    width: 24px;
    height: 24px;
    border-radius: 50%;
}

.icon {
    position: absolute;
    right: -2px;
    bottom: -2px;
    padding: 2px;
    border-radius: 50%;
    background-color: var(--surface-color);
    font-size: 12px;
}

.icon.fa-check-circle { color: var(--success-color); }
.icon.fa-times-circle { color: var(--error-color); }
.icon.fa-question-circle { color: var(--primary-color); }
.icon.fa-user { color: var(--text-color); }

.status-in-progress { border-color: var(--warning-color); }
.status-in-review { border-color: var(--in-review-color); }
.status-in-review-all-approved { border-color: var(--success-color); }
.status-resolved { border-color: var(--primary-color); }

.warnings {
    margin-top: 10px;
    padding: 10px;
    border: 1px solid var(--error-color);
    border-radius: 4px;
    background-color: var(--danger-bg);
}

.warnings li {
    margin-bottom: 5px;
}

.children {
    margin-left: 10px;
    padding-left: 10px;
    border-left: 2px solid var(--border-color);
}

.jira-issues {
    list-style-type: none;
    margin: 0;
    padding: 0;
}

.jira-issues li {
    display: flex;
    align-items: center;
    margin-bottom: 5px;
}

.jira-priority-icon {
    display: inline-block;
    width: 16px;
    height: 16px;
    margin-right: 4px;
    vertical-align: middle;
}

.counters-container {
    position: absolute;
    top: 15px;
    right: 15px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
}

.child-counter {
    display: none;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 10px;
    background-color: var(--primary-color);
    color: var(--on-accent-text);
    font-size: 12px;
    font-weight: bold;
}

.child-counter.visible,
.pull-request.collapsed .child-counter {
    display: flex;
}

.conflicts-counter {
    display: flex;
    align-items: center;
    justify-content: center;
}

.conflicts-count {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 8px;
    border-radius: 12px;
    background-color: var(--error-color);
    color: var(--on-accent-text);
    font-size: 12px;
    font-weight: bold;
}

.conflicts-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-color);
    border-top-color: var(--primary-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

.conflicts-error {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: var(--warning-color);
    color: var(--on-accent-text);
    font-size: 12px;
    font-weight: bold;
}

.commit-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
    padding: 2px 8px;
    border: 1px solid;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
}

.commit-badge-ahead {
    border-color: var(--success-color);
    color: var(--success-color);
}

.commit-badge-behind {
    border-color: var(--error-color);
    color: var(--error-color);
}

.commit-badge i {
    font-size: 10px;
}

.created-date {
    display: inline-flex;
    align-items: center;
}

/* 7. Orphaned issues ------------------------------------------------------ */
.orphaned-issues {
    margin-top: 30px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background-color: var(--surface-color);
    box-shadow: 0 1px 3px var(--shadow-color);
    overflow: hidden;
}

.orphaned-issues-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    background-color: var(--danger-bg);
}

.orphaned-issues-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--danger-text);
    font-size: 1.125rem;
    font-weight: 600;
}

.orphaned-issues-content {
    padding: 16px;
}

.orphaned-issue {
    margin-bottom: 12px;
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    transition: background-color 0.2s ease;
}

.orphaned-issue:last-child {
    margin-bottom: 0;
}

.orphaned-issue:hover {
    background-color: var(--surface-muted);
}

.orphaned-issue-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}

.orphaned-issue-priority {
    width: 16px;
    height: 16px;
}

.orphaned-issue-key {
    color: var(--primary-color);
    font-weight: 500;
    text-decoration: none;
}

.orphaned-issue-key:hover {
    text-decoration: underline;
}

.orphaned-issue-summary {
    margin: 4px 0;
    color: var(--text-color);
}

.orphaned-issue-status {
    margin-top: 8px;
    color: var(--text-muted);
    font-size: 0.875rem;
}

/* 8. Popovers ------------------------------------------------------------- */
.popover {
    display: none;
}

.jira-issue-popover,
.pull-request-popover {
    display: none;
    position: absolute;
    z-index: 1000;
    max-width: 500px;
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background-color: var(--surface-color);
    color: var(--text-color);
    box-shadow: 0 2px 5px var(--shadow-color);
    font-size: 14px;
}

.jira-issue-popover-key,
.pull-request-popover-title {
    margin-bottom: 5px;
    font-weight: bold;
}

.jira-issue-popover-summary,
.pull-request-popover-description {
    max-height: 200px;
    overflow-y: auto;
    color: var(--text-muted);
}

.pull-request-popover-description {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
}

/* 9. Modal and help ------------------------------------------------------- */
.modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 200;
    width: 100%;
    height: 100%;
    background-color: var(--backdrop-color);
    overflow: auto;
}

.modal-content {
    width: 80%;
    max-width: 800px;
    max-height: 80vh;
    margin: 5% auto;
    padding: 20px;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    background-color: var(--surface-color);
    overflow-y: auto;
}

.close {
    float: right;
    color: var(--text-muted);
    font-size: 28px;
    font-weight: bold;
    cursor: pointer;
}

.close:hover,
.close:focus {
    color: var(--text-color);
    text-decoration: none;
}

.help-content {
    margin-top: 20px;
}

.help-content h1,
.help-content h2,
.help-content h3,
.help-content h4,
.help-content h5,
.help-content h6 {
    margin-top: 20px;
    margin-bottom: 10px;
    color: var(--primary-color);
}

.help-content p {
    margin-bottom: 10px;
}

.help-content ul,
.help-content ol {
    margin-bottom: 10px;
    padding-left: 20px;
}

.help-content li {
    margin-bottom: 5px;
}

.help-content code {
    padding: 2px 4px;
    border-radius: 4px;
    background-color: var(--surface-muted);
    font-family: var(--font-mono);
}

.help-content pre {
    padding: 10px;
    border-radius: 4px;
    background-color: var(--surface-muted);
    font-family: var(--font-mono);
    overflow-x: auto;
}

.help-content a {
    color: var(--primary-color);
    text-decoration: none;
}

.help-content a:hover {
    text-decoration: underline;
}

.help-content blockquote {
    margin-left: 0;
    padding-left: 10px;
    border-left: 4px solid var(--primary-color);
    color: var(--text-muted);
}

.help-content img {
    max-width: 100%;
    height: auto;
}
```

- [ ] **Step 2: Move the two inline-styled info icons in index.html to the class**

In `public/index.html`, the two `<i class="fas fa-info-circle" style="color: var(--primary-color); cursor: help;" ...>` icons (Ready for reviewer and SYNC) become `<i class="fas fa-info-circle info-icon" ...>` with the same `title`.

- [ ] **Step 3: Check that no colour escaped the tokens**

Run: `grep -nE "#[0-9A-Fa-f]{3,6}\b" public/styles.css | grep -v "^[0-9]*:    --"`
Expected: no output (every hex colour sits on a token line inside `:root`).

Run: `grep -n "style=" public/index.html`
Expected: only the two `display: none` toggles on `#syncWarning` and `#loading`, which the old JavaScript still drives until Task 4.

- [ ] **Step 4: Run the tests and check in the browser**

Run: `npm test`
Expected: `ℹ fail 0`.

Start `node index.mjs`, open http://localhost:3000, pick a project, compare with the previous look: same layout, same colours, the font is the system one. Check the filter row, the multi-select dropdown, a PR card with a warning box, the SYNC badge after loading, the help modal, the popovers, and the footer. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add public/styles.css public/index.html
git commit -m "refactor: rebuild styles.css on colour tokens and the system font

Removes duplicate keyframes, popover, container and footer rules; every colour
now comes from a custom property so a dark theme can override them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EZCANUDoVq6pd6b9i8vGbg"
```

---

### Task 4: App shell: banner, sidebar, scrolling main pane

The page becomes a grid: banner on top, filter sidebar on the left, and a main pane that is the only element scrolling. This task adds the `app-shell.js` module (sidebar toggle with persistence, overlay drawer, `F` and `Escape` shortcuts, help modal, document title), rewrites `index.html`, replaces the page-layout section of the stylesheet with the shell sections, makes repository and branch headers sticky, moves the popovers to fixed positioning, adds the empty/loading/error states, and drops the footer. The active-filter badge, clear button and toolbar come in Task 5; the theme toggle in Task 6.

**Files:**
- Create: `public/app-shell.js`
- Create: `test/app-shell.test.mjs`
- Modify: `public/index.html` (full replacement)
- Modify: `public/styles.css` (sections 1, 2, 3, 4, 6, 8, 9; new sections 10 and 11)
- Modify: `public/app.js`

- [ ] **Step 1: Write the failing test for the document title**

Create `test/app-shell.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentTitle } from '../public/app-shell.js';

test('title without a project is the app name', () => {
    assert.equal(buildDocumentTitle({ project: null, attentionCount: 0 }), 'Bitbucket Pull-Requests Tree');
});

test('title with a project puts the project first', () => {
    assert.equal(buildDocumentTitle({ project: 'PROJ', attentionCount: 0 }), 'PROJ · Bitbucket Pull-Requests Tree');
});

test('title with an attention count prefixes the count', () => {
    assert.equal(buildDocumentTitle({ project: 'PROJ', attentionCount: 3 }), '(3) PROJ · Bitbucket Pull-Requests Tree');
});
```

Run: `npm test`
Expected: the new file fails with `Cannot find module '.../public/app-shell.js'`; the Task 1 tests still pass.

- [ ] **Step 2: Create the app-shell module**

Create `public/app-shell.js`:

```js
/**
 * Application shell: banner, sidebar visibility, help modal, keyboard
 * shortcuts and document title. Knows nothing about pull requests.
 *
 * Nothing here touches the DOM at import time, so the pure helpers can be
 * unit-tested with node:test.
 */

export const APP_NAME = 'Bitbucket Pull-Requests Tree';

const SIDEBAR_STORAGE_KEY = 'prTree.sidebarHidden';
const WIDE_LAYOUT_QUERY = '(min-width: 900px)';

let wideLayout = null;

// ---------------------------------------------------------- document title

export function buildDocumentTitle({ project, attentionCount }) {
    const prefix = attentionCount > 0 ? `(${attentionCount}) ` : '';
    const projectPart = project ? `${project} · ` : '';
    return `${prefix}${projectPart}${APP_NAME}`;
}

export function updateDocumentTitle(state) {
    document.title = buildDocumentTitle(state);
}

// ----------------------------------------------------------------- storage

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        // Storage unavailable (private window, blocked site data): the preference is not remembered
    }
}

// ----------------------------------------------------------------- sidebar

function isSidebarHidden() {
    return document.documentElement.classList.contains('sidebar-hidden');
}

// The stored preference only applies to the wide layout; the drawer of the
// narrow layout always starts closed and never writes the preference.
function setSidebarHidden(hidden, { persist = true } = {}) {
    document.documentElement.classList.toggle('sidebar-hidden', hidden);
    const toggle = document.getElementById('sidebarToggle');
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(!hidden));
    }
    if (persist && wideLayout.matches) {
        writeStorage(SIDEBAR_STORAGE_KEY, String(hidden));
    }
}

function toggleSidebar() {
    setSidebarHidden(!isSidebarHidden());
}

/** Closes the sidebar when it is shown as a drawer (narrow layout). No-op otherwise. */
export function closeSidebarDrawer() {
    if (!wideLayout.matches && !isSidebarHidden()) {
        setSidebarHidden(true, { persist: false });
    }
}

function applyLayoutMode() {
    if (wideLayout.matches) {
        setSidebarHidden(readStorage(SIDEBAR_STORAGE_KEY) === 'true', { persist: false });
    } else {
        setSidebarHidden(true, { persist: false });
    }
}

function initializeSidebar() {
    wideLayout = window.matchMedia(WIDE_LAYOUT_QUERY);
    applyLayoutMode();
    wideLayout.addEventListener('change', applyLayoutMode);
    document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
    document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebarDrawer);
}

// -------------------------------------------------------------- help modal

function openHelp() {
    document.getElementById('helpModal').hidden = false;
    const content = document.getElementById('helpContent');
    if (!content.innerHTML) {
        fetchAndRenderReadme(content);
    }
}

function closeHelp() {
    document.getElementById('helpModal').hidden = true;
}

async function fetchAndRenderReadme(content) {
    content.textContent = 'Loading...';
    try {
        const response = await fetch('README.md');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const markdown = await response.text();
        content.innerHTML = marked.parse(markdown);
    } catch (error) {
        console.error('Error fetching README:', error);
        content.textContent = 'Error loading help content. Please try again later.';
    }
}

function initializeHelpModal() {
    const modal = document.getElementById('helpModal');
    document.getElementById('helpButton').addEventListener('click', openHelp);
    document.getElementById('helpClose').addEventListener('click', closeHelp);
    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeHelp();
        }
    });
}

// ---------------------------------------------------------------- keyboard

function isTypingTarget(target) {
    return target instanceof Element &&
        (target.matches('input, select, textarea') || target.isContentEditable);
}

// Registered in the capture phase: an open multi-select is still open here and
// handles Escape itself, so the shell stays out of its way.
function handleKeydown(event) {
    if (document.querySelector('.multi-select.open')) {
        return;
    }

    if (event.key === 'Escape') {
        const modal = document.getElementById('helpModal');
        if (modal && !modal.hidden) {
            closeHelp();
        } else {
            closeSidebarDrawer();
        }
        return;
    }

    if ((event.key === 'f' || event.key === 'F') &&
        !event.ctrlKey && !event.metaKey && !event.altKey &&
        !isTypingTarget(event.target)) {
        event.preventDefault();
        toggleSidebar();
    }
}

// -------------------------------------------------------------------- init

export function initializeAppShell() {
    initializeSidebar();
    initializeHelpModal();
    document.addEventListener('keydown', handleKeydown, true);
}
```

Run: `npm test`
Expected: `ℹ pass 12`, `ℹ fail 0`.

- [ ] **Step 3: Replace index.html**

Replace the whole of `public/index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bitbucket Pull-Requests Tree</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <script>
    // Runs before the stylesheet so a hidden sidebar does not flash open on load.
    (function () {
      var sidebarHidden = null;
      try {
        sidebarHidden = localStorage.getItem('prTree.sidebarHidden');
      } catch (error) { /* storage unavailable */ }
      if (sidebarHidden === 'true' || !window.matchMedia('(min-width: 900px)').matches) {
        document.documentElement.classList.add('sidebar-hidden');
      }
    })();
  </script>
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
<header class="app-header">
  <button type="button" id="sidebarToggle" class="icon-button" aria-expanded="true" aria-controls="sidebar"
          title="Toggle filters (F)">
    <i class="fas fa-bars"></i>
  </button>
  <h1 class="app-brand">
    <img src="favicon.svg" alt="" class="app-logo">
    <span class="app-name">Bitbucket Pull-Requests Tree</span>
  </h1>
  <select id="projectSelect" class="project-select" aria-label="Project">
    <option value="">Select a project</option>
  </select>
  <div class="header-spacer"></div>
  <div class="refresh-container">
    <i class="fas fa-sync refresh-icon" id="refreshIcon" title="Checking for updates"></i>
    <span class="last-refresh" id="lastRefreshTime"></span>
  </div>
  <button type="button" id="helpButton" class="icon-button" title="Help">
    <i class="fas fa-question-circle"></i>
  </button>
  <a href="https://github.com/frejfrej/pr-tree" target="_blank" rel="noopener" class="icon-button"
     title="GitHub repository">
    <i class="fab fa-github"></i>
  </a>
  <span id="versionNumber" class="version-number"></span>
</header>

<aside id="sidebar" class="sidebar" aria-label="Filters">
  <div class="sidebar-header">
    <h2>Filters</h2>
  </div>

  <div class="filter-item">
    <span class="filter-label">Sprint</span>
    <div class="multi-select" id="sprintSelect" data-filter="sprint">
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

  <div class="filter-item">
    <span class="filter-label">Fix version</span>
    <div class="multi-select" id="fixVersionSelect" data-filter="fixVersion">
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

  <div class="filter-item">
    <span class="filter-label">Assignee</span>
    <div class="multi-select" id="assigneeSelect" data-filter="assignee">
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

  <div class="filter-item">
    <span class="filter-label">Reviewer</span>
    <div class="multi-select" id="reviewerSelect" data-filter="reviewer">
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

  <div class="filter-item filter-item-checkbox">
    <input type="checkbox" id="readyForReviewerCheck" disabled>
    <label for="readyForReviewerCheck">Ready for reviewer</label>
    <i class="fas fa-info-circle info-icon" title="This filter will be reset when the page is reloaded"></i>
  </div>

  <hr class="sidebar-divider">

  <div class="filter-item">
    <span class="filter-label">SYNC
      <i class="fas fa-info-circle info-icon"
         title="SYNC status is only fetched when you click the load button. This filter will be reset when the page is reloaded"></i>
    </span>
    <select id="syncSelect" disabled>
      <option value="Show all">SYNC status not loaded</option>
    </select>
    <div class="filter-row">
      <button type="button" id="loadSyncButton" class="button" disabled
              title="Load SYNC status for all pull requests">
        <i class="fas fa-sync-alt"></i> Load
      </button>
      <span id="syncWarning" class="sync-warning" hidden>
        <i class="fas fa-exclamation-triangle"></i>
      </span>
    </div>
  </div>
</aside>
<div id="sidebarBackdrop" class="sidebar-backdrop"></div>

<main id="main" class="main-pane">
  <div id="pull-requests" class="tree-pane"></div>
</main>

<div id="helpModal" class="modal" hidden>
  <div class="modal-content" role="dialog" aria-modal="true" aria-label="Help">
    <button type="button" id="helpClose" class="icon-button modal-close" aria-label="Close help">
      <i class="fas fa-times"></i>
    </button>
    <!-- The closing tag must absolutely remain immediately next to the open tag -->
    <div id="helpContent" class="help-content"></div>
  </div>
</div>

<script type="module" src="app.js"></script>
</body>
</html>
```

What changed: no `.container`, no footer, no `#loading` element (state messages render inside `#pull-requests`), `multi-select.js` and `app-filter.js` are no longer loaded as separate scripts (app.js imports them), the SYNC warning and the modal use the `hidden` attribute, the load button uses the shared `.button` class.

- [ ] **Step 4: Stylesheet, section 1: shell tokens**

In `public/styles.css`, inside `:root`, add after the `--backdrop-color` line:

```css
    --header-bg: #0052CC;
    --header-text: #FFFFFF;
    --header-muted: rgba(255, 255, 255, 0.75);
    --header-border: transparent;
    --header-control-bg: rgba(255, 255, 255, 0.14);
    --header-control-border: rgba(255, 255, 255, 0.35);

    --header-height: 48px;
    --sidebar-width: 280px;
    --repo-header-height: 48px;
    --branch-header-height: 40px;
```

and after the `--chevron-icon` line, the white variant for the banner's project selector:

```css
    --chevron-icon-on-header: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 448 512' fill='%23FFFFFF'%3E%3Cpath d='M207.029 381.476L12.686 187.132c-9.373-9.373-9.373-24.569 0-33.941l22.667-22.667c9.357-9.357 24.522-9.375 33.901-.04L224 284.505l154.745-154.021c9.379-9.335 24.544-9.317 33.901.04l22.667 22.667c9.373 9.373 9.373 24.569 0 33.941L240.971 381.476c-9.373 9.372-24.569 9.372-33.942 0z'/%3E%3C/svg%3E");
```

- [ ] **Step 5: Stylesheet, section 2: the body becomes the grid**

Replace the `body { ... }` rule of section 2 with:

```css
body {
    display: grid;
    grid-template-rows: var(--header-height) minmax(0, 1fr);
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
        "header header"
        "sidebar main";
    height: 100vh;
    height: 100dvh;
    margin: 0;
    overflow: hidden;
    font-family: var(--font-family);
    line-height: 1.6;
    color: var(--text-color);
    background-color: var(--background-color);
}
```

`minmax(0, 1fr)` matters: with a plain `1fr` the row would grow with the tree instead of letting the main pane scroll.

- [ ] **Step 6: Stylesheet, section 3: replace the page layout with the app shell**

Delete everything from the `/* 3. Page layout ... */` comment up to (not including) the `/* 4. Controls ... */` comment, and put this in its place:

```css
/* 3. App shell ------------------------------------------------------------ */
.app-header {
    grid-area: header;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    border-bottom: 1px solid var(--header-border);
    background-color: var(--header-bg);
    color: var(--header-text);
    box-shadow: 0 1px 3px var(--shadow-color);
    font-size: 14px;
}

.app-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
}

.app-logo {
    width: 24px;
    height: 24px;
    border-radius: 4px;
}

.header-spacer {
    flex: 1;
}

.icon-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 16px;
    text-decoration: none;
    cursor: pointer;
}

.app-header .icon-button:hover {
    background-color: var(--header-control-bg);
}

.project-select {
    max-width: 240px;
    padding: 5px 28px 5px 10px;
    border-color: var(--header-control-border);
    background-color: var(--header-control-bg);
    background-image: var(--chevron-icon-on-header);
    background-position: right 10px center;
    color: var(--header-text);
}

.project-select:hover:not(:disabled),
.project-select:focus {
    border-color: var(--header-text);
    box-shadow: none;
}

.project-select option {
    background-color: var(--surface-color);
    color: var(--text-color);
}

.refresh-container {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--header-muted);
}

.last-refresh {
    font-style: italic;
    white-space: nowrap;
}

.refresh-icon {
    opacity: 0;
    transition: opacity 0.3s ease;
}

.refresh-icon.checking {
    opacity: 1;
    animation: spin 1s linear infinite;
}

.version-number {
    color: var(--header-muted);
    white-space: nowrap;
    cursor: help;
}

.sidebar {
    grid-area: sidebar;
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: var(--sidebar-width);
    padding: 16px;
    border-right: 1px solid var(--border-color);
    background-color: var(--surface-color);
    font-size: 14px;
    overflow-y: auto;
}

html.sidebar-hidden .sidebar {
    display: none;
}

.sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 24px;
}

.sidebar-header h2 {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.sidebar-divider {
    margin: 0;
    border: none;
    border-top: 1px solid var(--border-color);
}

.filter-item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.filter-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-color);
    font-weight: 500;
}

.filter-item select {
    width: 100%;
}

.filter-item-checkbox {
    flex-direction: row;
    align-items: center;
    gap: 8px;
}

.filter-item-checkbox input[type="checkbox"] {
    margin: 0;
    cursor: pointer;
}

.filter-item-checkbox label {
    cursor: pointer;
    user-select: none;
}

.filter-item-checkbox input[type="checkbox"]:disabled,
.filter-item-checkbox input[type="checkbox"]:disabled + label {
    color: var(--text-muted);
    opacity: 0.6;
    cursor: not-allowed;
}

.filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.sidebar-backdrop {
    display: none;
}

.main-pane {
    grid-area: main;
    min-width: 0;
    overflow-y: auto;
}

/* Padding lives on the content, not on the scroll container: the container's own
   padding would inset the sticky area and leave a strip above the sticky headers */
.tree-pane {
    padding: 24px;
}
```

- [ ] **Step 7: Stylesheet, section 4: the shared button class**

In section 4, rename the three `.load-sync-button` selectors to `.button` (`.button`, `.button:hover:not(:disabled)`, `.button:disabled`); the declarations stay the same.

- [ ] **Step 8: Stylesheet, section 6: sticky repository and branch headers**

Replace the `.repository-header` and `.repository-name` rules with:

```css
.repository-header {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    height: var(--repo-header-height);
    padding: 0 10px;
    background-color: var(--primary-color);
    color: var(--on-accent-text);
    border-radius: 4px 4px 0 0;
    cursor: pointer;
}

.repository.collapsed > .repository-header {
    border-radius: 4px;
}

.repository-name {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: inherit;
    font-size: 20px;
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
```

Replace the `.root-branch-header` and `.root-branch-name` rules with:

```css
.root-branch-header {
    position: sticky;
    top: var(--repo-header-height);
    z-index: 2;
    display: flex;
    align-items: center;
    height: var(--branch-header-height);
    padding: 0 10px;
    background-color: var(--background-color);
    border-radius: 4px;
    cursor: pointer;
}

.root-branch-name {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--primary-color);
    font-size: 18px;
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
}
```

Headers have fixed heights so the branch header knows where to stick under its repository header.

- [ ] **Step 9: Stylesheet, sections 8 and 9: fixed popovers, hidden-driven modal**

In section 8, in the `.jira-issue-popover, .pull-request-popover` rule, change `position: absolute;` to `position: fixed;`.

In section 9, replace the `.modal`, `.modal-content`, `.close` and `.close:hover, .close:focus` rules with:

```css
.modal {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 5vh 16px;
    background-color: var(--backdrop-color);
    overflow: auto;
}

.modal-content {
    position: relative;
    width: 100%;
    max-width: 800px;
    max-height: 90vh;
    padding: 20px;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    background-color: var(--surface-color);
    overflow-y: auto;
}

.modal-close {
    position: absolute;
    top: 12px;
    right: 12px;
    color: var(--text-muted);
}

.modal-close:hover {
    background-color: var(--surface-muted);
    color: var(--text-color);
}
```

The modal is shown by removing its `hidden` attribute; the `[hidden]` rule in section 2 wins over `display: flex`.

- [ ] **Step 10: Stylesheet: append the state-message and responsive sections**

Append at the end of `public/styles.css`:

```css

/* 10. State messages ------------------------------------------------------ */
.state-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 50vh;
    color: var(--text-muted);
    font-size: 16px;
    text-align: center;
}

.state-message i {
    font-size: 32px;
}

.state-message.error i {
    color: var(--error-color);
}

/* 11. Responsive: below 900px the sidebar is a drawer over the tree -------- */
@media (max-width: 899.98px) {
    .app-name,
    .last-refresh {
        display: none;
    }

    .sidebar {
        position: fixed;
        top: var(--header-height);
        bottom: 0;
        left: 0;
        z-index: 15;
        box-shadow: 4px 0 12px var(--shadow-color);
    }

    html:not(.sidebar-hidden) .sidebar-backdrop {
        position: fixed;
        top: var(--header-height);
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 14;
        display: block;
        background-color: var(--backdrop-color);
    }
}
```

Update the header comment of the file to list the new sections (`3. App shell`, `10. State messages`, `11. Responsive`).

Run: `grep -n "footer\|\.container\|filters-row\|load-sync-button\|versionPulse" public/styles.css`
Expected: no output.

- [ ] **Step 11: app.js: imports and state messages**

At the top of `public/app.js`, add to the imports:

```js
import { initializeAppShell, updateDocumentTitle, closeSidebarDrawer } from './app-shell.js';
```

Delete the `showLoading` and `hideLoading` functions and add, right after `handleProjectChange`:

```js
// Messages shown in the main pane instead of the tree. Built with DOM nodes so
// project names never go through innerHTML.
function showStateMessage(iconClass, text, modifier = '') {
    const message = document.createElement('div');
    message.className = `state-message ${modifier}`.trim();
    const icon = document.createElement('i');
    icon.className = iconClass;
    const label = document.createElement('span');
    label.textContent = text;
    message.append(icon, label);
    document.getElementById('pull-requests').replaceChildren(message);
}

function showEmptyState() {
    showStateMessage('fas fa-code-branch', 'Select a project to display its pull requests');
}

function showLoadingState() {
    showStateMessage('fas fa-spinner fa-spin', `Loading ${currentProject}…`);
}

function showErrorState() {
    showStateMessage('fas fa-exclamation-triangle', `Could not load ${currentProject}. The next automatic check will retry.`, 'error');
}
```

- [ ] **Step 12: app.js: project change, rendering and update check**

Replace `handleProjectChange` with:

```js
async function handleProjectChange(event, isInitialLoad = false) {
    const projectName = event.target.value;
    if (projectName) {
        currentProject = projectName;
        updateDocumentTitle({ project: currentProject, attentionCount: 0 });
        closeSidebarDrawer();

        // Only clear filters from URL when manually switching projects, not during initial page load
        if (!isInitialLoad) {
            const url = new URL(window.location);
            url.searchParams.delete('assignee');
            url.searchParams.delete('reviewer');
            url.searchParams.delete('sprint');
            url.searchParams.delete('fixVersion');
            url.searchParams.delete('sync');
            url.searchParams.delete('ready');
            window.history.pushState({}, '', url);

            // Clear multi-select state and UI
            currentAssignees = [];
            currentReviewers = [];
            currentSprints = [];
            currentFixVersions = [];
            currentSync = "Show all";
            currentReadyForReviewer = false;

            // Clear multi-select components
            const assigneeMultiSelect = getMultiSelect('assigneeSelect');
            const reviewerMultiSelect = getMultiSelect('reviewerSelect');
            const sprintMultiSelect = getMultiSelect('sprintSelect');
            const fixVersionMultiSelect = getMultiSelect('fixVersionSelect');

            // Pass false to prevent triggering handleFilterChange callbacks
            if (assigneeMultiSelect) assigneeMultiSelect.clearAll(false);
            if (reviewerMultiSelect) reviewerMultiSelect.clearAll(false);
            if (sprintMultiSelect) sprintMultiSelect.clearAll(false);
            if (fixVersionMultiSelect) fixVersionMultiSelect.clearAll(false);

            // Reset sync statuses and ready checkbox (SYNC data belongs to the previous project)
            currentSyncStatuses = null;
            syncLoadFailed = false;
            updateSyncControls();
            const readyCheck = document.getElementById('readyForReviewerCheck');
            if (readyCheck) {
                readyCheck.checked = false;
                readyCheck.disabled = true;
            }
        }

        showLoadingState();
        renderEverything(await fetchData());
        updateUrlWithFilters();

        // Start periodic checking
        startPeriodicChecking();
    } else {
        currentProject = null;
        currentSyncStatuses = null;
        syncLoadFailed = false;
        updateSyncControls();
        updateUrlWithFilters();
        updateDocumentTitle({ project: null, attentionCount: 0 });
        showEmptyState();

        // Stop periodic checking
        stopPeriodicChecking();
    }
}
```

Replace `renderEverything` with a synchronous version that receives the data (callers fetch, so a failed refresh never wipes a valid tree, and the data is no longer fetched twice on every change):

```js
function renderEverything(apiResult) {
    if (!currentProject) {
        return;
    }
    if (!apiResult) {
        currentApiResult = null;
        showErrorState();
        return;
    }

    // Capture current toggle states before re-rendering
    const toggleStates = captureToggleStates();

    currentApiResult = apiResult;
    initializeFilter(currentApiResult);
    const container = document.getElementById('pull-requests');

    // Create main content
    const mainContent = renderRepositories(
        currentApiResult.pullRequests,
        currentApiResult.jiraIssuesMap,
        currentApiResult.jiraIssuesDetails,
        new Map(Object.entries(currentApiResult.pullRequestsByDestination)),
        currentApiResult.jiraSiteName
    );

    // Add orphaned issues section
    const orphanedIssuesHtml = renderOrphanedIssues(currentApiResult.orphanedIssues);

    // Combine content
    container.innerHTML = mainContent + orphanedIssuesHtml;

    // Restore toggle states after rendering
    restoreToggleStates(toggleStates);

    // Re-apply the last loaded SYNC statuses (without fetching them again)
    // before filters run, so the SYNC filter can rely on the rendered badges
    applySyncStatuses();
    populateFilters(currentApiResult.pullRequests);
    populateSprintFilter(currentApiResult.sprints);
    populateFixVersionFilter(currentApiResult.jiraIssuesDetails);

    // Update the last refresh time
    const lastRefreshElement = document.getElementById('lastRefreshTime');
    if (lastRefreshElement && currentApiResult.lastRefreshTime) {
        lastRefreshElement.textContent = formatRefreshTime(currentApiResult.lastRefreshTime);
    }
}
```

In `checkForUpdates`, replace the block that decides whether to re-render:

```js
        // Re-render when the data changed, or when nothing is displayed yet because the last fetch failed
        if (!currentApiResult || newData.dataHash !== currentApiResult.dataHash) {
            console.log('Data has changed. Updating...');
            renderEverything(newData);
        }
```

- [ ] **Step 13: app.js: SYNC warning, version, popovers, help modal, start-up**

In `updateSyncControls`, replace `syncWarning.style.display = warningText ? '' : 'none';` with:

```js
        syncWarning.hidden = !warningText;
```

Replace `fetchAndDisplayVersion` with:

```js
async function fetchAndDisplayVersion() {
    try {
        const response = await fetch('/api/version');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const versionElement = document.getElementById('versionNumber');
        if (versionElement) {
            versionElement.textContent = `v${data.version}`;
            versionElement.title = `Version ${data.version}, released ${data.releaseDate}\nCreated by ${data.author}\n${data.license}`;
        }
    } catch (error) {
        console.error('Error fetching version:', error);
    }
}
```

In `initializePopovers`, replace the `showPopover` function with:

```js
    function showPopover(link) {
        if (link.classList.contains('jira-issue-link')) {
            const key = link.dataset.issueKey;
            const summary = link.dataset.issueSummary;
            popover.className = 'jira-issue-popover';
            popover.innerHTML = `
                <div class="jira-issue-popover-key">${key}</div>
                <div class="jira-issue-popover-summary">${summary}</div>
            `;
        } else {
            const title = decodeURIComponent(link.dataset.renderedTitle);
            const description = decodeURIComponent(link.dataset.renderedDescription);
            popover.className = 'pull-request-popover';
            popover.innerHTML = `
                <div class="pull-request-popover-title">${title}</div>
                <div class="pull-request-popover-description">${description}</div>
            `;
        }

        // The popover is fixed: viewport coordinates, kept inside the viewport
        popover.style.display = 'block';
        const rect = link.getBoundingClientRect();
        const margin = 8;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - popover.offsetWidth - margin));
        const fitsBelow = rect.bottom + popover.offsetHeight + margin <= window.innerHeight;
        const top = fitsBelow ? rect.bottom : Math.max(margin, rect.top - popover.offsetHeight);
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }
```

and add at the end of `initializePopovers`, after the two `popover.addEventListener(...)` calls:

```js
    // A popover left open while the tree scrolls would float away from its link
    document.getElementById('main').addEventListener('scroll', hidePopover, { passive: true });
```

Delete `initializeHelpModal` and `fetchAndRenderReadme` (they now live in `app-shell.js`).

Replace the `DOMContentLoaded` listener with:

```js
document.addEventListener('DOMContentLoaded', function() {
    initializeAppShell();
    initializeMultiSelects();
    showEmptyState();
    loadProjects();
    fetchAndDisplayVersion();
    initializePopovers();
    initializeReadyForReviewerFilter();
    initializeSyncControls();
});
```

Run: `grep -n "helpModal\|footer\|showLoading\|hideLoading\|getElementById('loading')\|window.scrollY" public/app.js`
Expected: no output.

- [ ] **Step 14: Run the tests and verify in the browser**

Run: `npm test`
Expected: `ℹ pass 12`, `ℹ fail 0`.

Start `node index.mjs` and open http://localhost:3000 in a window wider than 900px:

1. Banner shows the logo, "Bitbucket Pull-Requests Tree", the project selector, help and GitHub buttons and the version; hovering the version shows the release date, author and licence.
2. Before choosing a project the main pane shows "Select a project to display its pull requests". Choosing one shows "Loading PROJECT…" then the tree; the tab title reads "PROJECT · Bitbucket Pull-Requests Tree". Choosing "Select a project" restores the plain title and the empty state.
3. The sidebar lists Sprint, Fix version, Assignee, Reviewer, Ready for reviewer, then SYNC; each multi-select opens, searches, selects and clears; the SYNC load button works and the select enables afterwards.
4. Scroll the tree: banner and sidebar stay put; repository headers stick to the top of the pane, branch headers stick under them.
5. Click the bars button: the sidebar disappears and the tree widens; press `F`: it comes back; hide it, reload: it stays hidden; open it, reload: it stays open. `F` typed inside a multi-select search box does not toggle the sidebar.
6. Hover a PR title and a Jira key after scrolling: the popover appears at the link; scrolling hides it; a link near the right edge gets a popover that stays inside the window.
7. Open help from the banner; close it with the button, by clicking the dark backdrop, and with Escape.
8. Narrow the window below 900px: the sidebar is gone, the brand text and refresh text are hidden; the bars button opens the sidebar as a drawer with a backdrop; clicking the backdrop, pressing Escape and choosing a project each close it. Widen the window again: the sidebar comes back according to the stored preference.
9. Stop the server, choose another project: the pane shows "Could not load PROJECT. The next automatic check will retry."; start the server again, switch to another tab and back: the tree appears.

Stop the server.

- [ ] **Step 15: Commit**

```bash
git add public/app-shell.js test/app-shell.test.mjs public/index.html public/styles.css public/app.js
git commit -m "feat: app shell with top banner, filter sidebar and scrolling tree pane

The banner holds the app name, project selector, refresh status, help, GitHub
and version; filters stack in a left sidebar that can be hidden (button, F key,
remembered) and becomes a drawer below 900px; the tree pane scrolls on its own
with sticky repository and branch headers; the tab title shows the project.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EZCANUDoVq6pd6b9i8vGbg"
```

---

### Task 5: Active-filter badge, clear filters, attention count in the tab title, collapse all / expand all

With the sidebar hideable, the user needs to see that filters are applied and to reset them in one click. Every filter pass now goes through `applyFilters()` in `app.js`, which refreshes counters, the badge on the sidebar toggle, the "Clear filters" button and the tab title's attention count. The toolbar above the tree wires the `collapseAll` / `expandAll` helpers from Task 2.

**Files:**
- Modify: `public/index.html` (badge, clear button, toolbar)
- Modify: `public/app-shell.js` (badge, toolbar, clear callback)
- Modify: `public/app.js` (`applyFilters`, `clearAllFilters`, call sites)
- Modify: `public/styles.css` (badge, toolbar, link buttons)

- [ ] **Step 1: Markup**

In `public/index.html`:

Inside the `#sidebarToggle` button, after the `<i class="fas fa-bars"></i>` line, add:

```html
    <span id="activeFilterBadge" class="header-badge" hidden></span>
```

Inside `.sidebar-header`, after `<h2>Filters</h2>`, add:

```html
    <button type="button" id="clearFiltersButton" class="link-button" hidden>Clear filters</button>
```

Inside `<main>`, before `<div id="pull-requests"></div>`, add:

```html
  <div id="treeToolbar" class="tree-toolbar" hidden>
    <button type="button" id="collapseAllButton" class="link-button">
      <i class="fas fa-compress-alt"></i> Collapse all
    </button>
    <button type="button" id="expandAllButton" class="link-button">
      <i class="fas fa-expand-alt"></i> Expand all
    </button>
  </div>
```

- [ ] **Step 2: Styles**

In `public/styles.css`, section 3, add after the `.app-header .icon-button:hover` rule:

```css
.header-badge {
    position: absolute;
    top: 0;
    right: 0;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background-color: var(--attention-color);
    color: var(--on-accent-text);
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
}
```

and after the `.tree-pane` rule:

```css
.tree-toolbar {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 24px 0;
}

/* With the toolbar shown, the tree needs less room above its first header */
.tree-toolbar:not([hidden]) + .tree-pane {
    padding-top: 12px;
}
```

In section 4, after the `.button:disabled` rule, add:

```css
.link-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--primary-color);
    font-size: 13px;
    cursor: pointer;
}

.link-button:hover {
    background-color: var(--surface-muted);
}
```

- [ ] **Step 3: app-shell.js: badge, toolbar and clear callback**

At the top of `public/app-shell.js`, before `export const APP_NAME`, add:

```js
import { collapseAll, expandAll } from './tree-toggle.js';
```

Add before the `// ---- init` block:

```js
// -------------------------------------------------------- filters and tree

/** Shows the number of active filters on the sidebar toggle and the clear button in the sidebar. */
export function updateActiveFilterBadge(count) {
    const badge = document.getElementById('activeFilterBadge');
    if (badge) {
        badge.textContent = String(count);
        badge.hidden = count === 0;
    }
    const clearButton = document.getElementById('clearFiltersButton');
    if (clearButton) {
        clearButton.hidden = count === 0;
    }
}

export function setToolbarVisible(visible) {
    const toolbar = document.getElementById('treeToolbar');
    if (toolbar) {
        toolbar.hidden = !visible;
    }
}

function initializeToolbar() {
    document.getElementById('collapseAllButton').addEventListener('click', collapseAll);
    document.getElementById('expandAllButton').addEventListener('click', expandAll);
}
```

Replace `initializeAppShell` with:

```js
export function initializeAppShell({ onClearFilters }) {
    initializeSidebar();
    initializeHelpModal();
    initializeToolbar();
    document.getElementById('clearFiltersButton').addEventListener('click', onClearFilters);
    document.addEventListener('keydown', handleKeydown, true);
}
```

- [ ] **Step 4: app.js: applyFilters and clearAllFilters**

Update the imports:

```js
import { initializeFilter, filterBranches, countActiveFilters } from './app-filter.js';
import { initializeAppShell, updateDocumentTitle, closeSidebarDrawer, updateActiveFilterBadge, setToolbarVisible } from './app-shell.js';
```

Add after the state declarations (after `let syncLoadFailed = false;`):

```js
function currentFilters() {
    return {
        assignees: currentAssignees,
        reviewers: currentReviewers,
        sprints: currentSprints,
        fixVersions: currentFixVersions,
        sync: currentSync,
        ready: currentReadyForReviewer
    };
}

// Runs the filter pass and refreshes everything that depends on it: the
// counters (inside filterBranches), the active-filter badge, the clear button
// and the attention count in the tab title.
function applyFilters() {
    const filters = currentFilters();
    const attentionCount = filterBranches(filters.assignees, filters.reviewers, filters.sprints, filters.fixVersions, filters.sync, filters.ready);
    updateActiveFilterBadge(countActiveFilters(filters));
    updateDocumentTitle({ project: currentProject, attentionCount });
}

// Resets every filter control to its default and applies the result once.
// The project and the loaded SYNC statuses are kept.
function clearAllFilters() {
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

Then route every filter pass through `applyFilters()`:

- In `handleFilterChange`, replace the `filterBranches(currentAssignees, ...)` call with `applyFilters();`.
- In `loadSyncStatuses`, replace the `filterBranches(currentAssignees, ...)` call (after the "Re-apply filters" comment) with `applyFilters();`.
- In `populateFilters`, replace the tail (the `restoreFiltersFromUrl();` call and the `if (...) { filterBranches(...) }` block) with:

```js
    // Restore filter values; renderEverything applies them once every filter is populated
    restoreFiltersFromUrl();
```

- In `renderEverything`, after `populateFixVersionFilter(currentApiResult.jiraIssuesDetails);`, add:

```js
    // Every filter is populated and restored from the URL: apply them once
    applyFilters();
    setToolbarVisible(true);
```

  and in its `if (!apiResult)` branch, before `showErrorState();`, add `setToolbarVisible(false);`.

- In `handleProjectChange`'s `else` branch, replace `updateDocumentTitle({ project: null, attentionCount: 0 });` with:

```js
        setToolbarVisible(false);
        applyFilters(); // no tree to filter: refreshes the badge and the tab title
```

- In the `DOMContentLoaded` listener, replace `initializeAppShell();` with `initializeAppShell({ onClearFilters: clearAllFilters });`.

Run: `grep -n "filterBranches(" public/app.js`
Expected: exactly one line, inside `applyFilters`.

- [ ] **Step 5: Run the tests and verify in the browser**

Run: `npm test`
Expected: `ℹ fail 0`.

Start `node index.mjs`, open http://localhost:3000, pick a project:

1. Select a reviewer: the bars button shows a badge with 1, "Clear filters" appears in the sidebar, the tab title starts with the number of orange-titled PRs in parentheses (no parentheses when there are none).
2. Add a sprint: badge 2. Tick "Ready for reviewer": badge 3. Hide the sidebar: the badge is still visible on the button.
3. Click "Clear filters": every control returns to "Show all", the checkbox is unchecked and disabled, the badge and the button disappear, the URL has no filter parameters, the tab title has no count.
4. Load the SYNC status, pick "SYNC required": badge 1; "Clear filters" resets the SYNC select to "Show all" but the loaded badges stay on the cards.
5. Reload a URL that has reviewer and sprint parameters: badge and count are restored once the tree is loaded.
6. "Collapse all" folds every repository, branch and PR subtree; "Expand all" unfolds them; both buttons are hidden while no project is selected.

Stop the server.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/styles.css public/app-shell.js public/app.js
git commit -m "feat: active-filter badge, clear filters, attention count and collapse/expand all

Every filter pass goes through applyFilters(), which refreshes the counters,
the badge on the sidebar toggle, the clear button and the tab title prefix.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EZCANUDoVq6pd6b9i8vGbg"
```

---

### Task 6: Dark theme

Every colour is a token since Task 3, so the dark theme is a second token block selected by `data-theme="dark"` on `<html>`, plus a toggle in the banner. The inline script in `<head>` picks the theme before paint, from the stored preference or the OS setting.

**Files:**
- Modify: `public/styles.css` (dark token block)
- Modify: `public/index.html` (head script, toggle button)
- Modify: `public/app-shell.js` (theme functions)

- [ ] **Step 1: Dark tokens**

In `public/styles.css`, right after the closing brace of the `:root { ... }` block, add:

```css
:root[data-theme="dark"] {
    color-scheme: dark;

    --primary-color: #579DFF;
    --attention-color: #FF7452;
    --background-color: #161A1D;
    --surface-color: #1D2125;
    --surface-muted: #22272B;
    --text-color: #B6C2CF;
    --text-muted: #8C9BAB;
    --border-color: #38414A;
    --success-color: #4BCE97;
    --warning-color: #F5CD47;
    --error-color: #F87168;
    --in-review-color: #579DFF;
    --danger-bg: #42221F;
    --danger-text: #FD9891;
    --on-accent-text: #1D2125;
    --shadow-color: rgba(0, 0, 0, 0.5);
    --focus-ring: rgba(87, 157, 255, 0.35);
    --backdrop-color: rgba(0, 0, 0, 0.6);
    --header-bg: #1D2125;
    --header-text: #B6C2CF;
    --header-muted: #8C9BAB;
    --header-border: #38414A;
    --header-control-bg: #22272B;
    --header-control-border: #38414A;
}
```

In the dark theme the banner shares the sidebar's surface colour, so `--header-border` gives it an edge.

- [ ] **Step 2: Markup**

In `public/index.html`, replace the inline `<script>` in `<head>` with:

```html
  <script>
    // Runs before the stylesheet so neither the theme nor a hidden sidebar flashes on load.
    (function () {
      var theme = null;
      var sidebarHidden = null;
      try {
        theme = localStorage.getItem('prTree.theme');
        sidebarHidden = localStorage.getItem('prTree.sidebarHidden');
      } catch (error) { /* storage unavailable */ }
      var root = document.documentElement;
      if (theme !== 'light' && theme !== 'dark') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      root.dataset.theme = theme;
      if (sidebarHidden === 'true' || !window.matchMedia('(min-width: 900px)').matches) {
        root.classList.add('sidebar-hidden');
      }
    })();
  </script>
```

In the banner, before the `#helpButton` button, add:

```html
  <button type="button" id="themeToggle" class="icon-button" title="Switch to dark theme">
    <i class="fas fa-moon"></i>
  </button>
```

- [ ] **Step 3: app-shell.js: theme toggle**

In `public/app-shell.js`, after `const SIDEBAR_STORAGE_KEY = ...;`, add:

```js
const THEME_STORAGE_KEY = 'prTree.theme';
```

Add before the `// ---- help modal` block:

```js
// ------------------------------------------------------------------- theme

function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const button = document.getElementById('themeToggle');
    if (!button) {
        return;
    }
    const dark = theme === 'dark';
    const icon = button.querySelector('i');
    icon.classList.toggle('fa-moon', !dark);
    icon.classList.toggle('fa-sun', dark);
    button.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
}

function initializeTheme() {
    // The inline script in <head> already chose the theme; this syncs the button with it
    applyTheme(currentTheme());
    document.getElementById('themeToggle').addEventListener('click', () => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        writeStorage(THEME_STORAGE_KEY, next);
        applyTheme(next);
    });
    // Follow the OS setting live as long as no preference has been stored
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        const stored = readStorage(THEME_STORAGE_KEY);
        if (stored !== 'light' && stored !== 'dark') {
            applyTheme(event.matches ? 'dark' : 'light');
        }
    });
}
```

In `initializeAppShell`, add `initializeTheme();` right after `initializeSidebar();`.

- [ ] **Step 4: Run the tests and verify in the browser**

Run: `npm test`
Expected: `ℹ fail 0`.

Start `node index.mjs`, open http://localhost:3000, pick a project, load the SYNC status, select a reviewer:

1. Click the moon: everything switches to dark at once, the icon becomes a sun, the tooltip reads "Switch to light theme". Reload: still dark. Click the sun: light again, and it survives a reload.
2. In the DevTools console run `localStorage.removeItem('prTree.theme')` and reload: the page follows the macOS appearance. Change the appearance in System Settings while the page is open: the page follows without a reload.
3. In dark mode, check every surface: banner and project selector popup, sidebar and multi-select dropdown, PR cards with their status borders, orange attention titles, a warnings box, SYNC and commit badges, the orphaned-issues block, a popover, the help modal with a code block, the empty and loading states, and the scrollbars.

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add public/styles.css public/index.html public/app-shell.js
git commit -m "feat: dark theme with banner toggle

Follows the OS setting until the toggle is used; the choice is stored and
applied before the first paint.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EZCANUDoVq6pd6b9i8vGbg"
```

---

### Task 7: Version 2.2.0 and documentation

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `PRD.md`

- [ ] **Step 1: package.json**

Set `"version": "2.2.0"` and `"releaseDate": "2026-09-05"`.

- [ ] **Step 2: README features**

In `README.md`, in the `## Features` list, replace the bullet `* Lists all projects from the configuration file in a dropdown selector` with:

```markdown
* Application layout
    * A top banner shows the app name, the project selector, the refresh status, the theme toggle, the help and GitHub links and the version
    * Filters live in a left sidebar that stays in place while the pull-request tree scrolls
    * The sidebar can be hidden with the banner button or the `F` key; the choice is remembered by the browser
    * On windows narrower than 900px the sidebar becomes a drawer over the tree
    * The badge on the sidebar button shows how many filters are active; "Clear filters" resets them all
    * Repository and branch headers stick to the top of the tree while scrolling
    * "Collapse all" and "Expand all" fold or unfold every repository, branch and pull request
    * The tab title shows the selected project and, when an assignee or reviewer filter is active, the number of pull requests waiting for them
* Light and dark themes, following the system setting until the theme toggle is used
* Lists all projects from the configuration file in a dropdown selector
```

- [ ] **Step 3: README changelog**

In `README.md`, under `## Changelog:`, add before `* Version 2.1.0`:

```markdown
* Version 2.2.0
    * New application layout
        * Top banner with the app name, project selector, refresh status, theme toggle, help, GitHub link and version
        * Filters stacked in a left sidebar that does not scroll with the tree; the sidebar can be hidden (button or `F` key) and its state is remembered
        * Below 900px the sidebar becomes a drawer over the tree
        * Repository and branch headers stick to the top of the tree while scrolling
        * Collapse all / expand all buttons above the tree
        * Active-filter badge on the sidebar button and a "Clear filters" button
        * The tab title shows the selected project and the number of pull requests needing attention
        * Empty, loading and error states are shown in the tree pane; a failed load no longer leaves the spinner forever
        * The footer is gone; its links and version moved to the banner
    * Dark theme, following the system setting until the toggle is used
    * "Ready for reviewer" is now computed from the data instead of the title colour
    * Stylesheet rebuilt on colour tokens, duplicate rules removed, system font stack
    * `npm test` runs unit tests for the pure filter and title logic (node:test)
```

- [ ] **Step 4: CLAUDE.md**

In `CLAUDE.md`:

Replace `Current version: **2.1.0** (as of 2026-08-12)` with `Current version: **2.2.0** (as of 2026-09-05)`.

In the `## Project Structure` tree, replace the `public/` part with:

```
└── public/                # Frontend assets
    ├── index.html         # App shell: banner, filter sidebar, tree pane, help modal
    ├── styles.css         # Application styles (colour tokens, light and dark themes)
    ├── app.js             # Data loading, rendering, filter state
    ├── app-filter.js      # Filtering logic for PRs (visibility, attention, active-filter count)
    ├── app-shell.js       # Banner, sidebar, theme, keyboard shortcuts, help modal, tab title
    ├── tree-toggle.js     # Collapse/expand helpers and toggle-state capture/restore
    ├── multi-select.js    # Multi-select dropdown component
    └── counter-utils.js   # Counter utilities for filtered/total counts
```

and add `├── test/                  # node:test unit tests (npm test)` after the `├── start.bat` line.

In `#### Frontend Files`, add after the `**public/counter-utils.js**` entry:

```markdown
**public/app-shell.js**
- Banner and sidebar chrome, independent of pull-request data
- Sidebar toggle (button, `F` key), stored in `localStorage` under `prTree.sidebarHidden` for the wide layout; below 900px the sidebar is a drawer that always starts closed
- Theme toggle, stored under `prTree.theme`; the OS setting is followed until a choice is stored; an inline script in `index.html` applies both before the first paint
- Help modal, active-filter badge, tree toolbar (collapse all / expand all), document title (`(attention) PROJECT · Bitbucket Pull-Requests Tree`)
- No DOM access at import time, so its pure helpers are unit-tested

**public/tree-toggle.js**
- `setRepositoryCollapsed`, `setRootBranchCollapsed`, `setPullRequestCollapsed` are the only code paths that change a collapsed state
- `collapseAll` / `expandAll`, `captureToggleStates` / `restoreToggleStates` used across re-renders
```

Replace the `### Frontend State Management` code block with:

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

and add after that block's URL example:

```markdown
Every filter pass goes through `applyFilters()` in app.js: it calls `filterBranches()` (app-filter.js), then updates the active-filter badge and the tab title. `renderEverything(apiResult)` receives the data from its caller and applies the filters once every filter control has been populated and restored from the URL.
```

In `### Testing Approach`, replace `- **No automated tests**: All testing is manual via UI` with:

```markdown
- **Unit tests**: `npm test` runs `node:test` over `test/*.test.mjs` for the pure logic (`computeAttention`, `countActiveFilters`, `buildDocumentTitle`); no DOM, no extra dependency
- **UI**: manual testing in the browser (layout, filters, theme)
```

and in `### Testing Changes`, replace `- **No automated tests**: Currently no test suite (scripts shows \`echo "Error: no test specified"\`)` with `- **Unit tests**: \`npm test\` (node:test, pure logic only)`.

In `### Common Pitfalls`, add:

```markdown
6. **Colours**: never hard-code a colour in styles.css; add a token to both the `:root` and `:root[data-theme="dark"]` blocks
7. **Ready for reviewer**: computed by `computeAttention()` from the data, never from rendered styles
```

- [ ] **Step 5: PRD**

In `PRD.md`, replace the diagram in `### 8.1 Layout Structure` with:

```
+------------------------------------------------------------------+
| Banner: ☰ | App name | Project ▾ | Last refresh | ☾ | ? | GitHub | v |
+----------------+-------------------------------------------------+
| Filters  Clear | [Collapse all] [Expand all]                     |
|  Sprint        | Repository 1                          [X / Y]   |
|  Fix version   |   Branch A                            [X / Y]   |
|  Assignee      |     PR #1 [SYNC] [Ahead:3] [Behind:1]           |
|  Reviewer      |       JIRA-123 [In Progress]                    |
|  Ready         |     PR #2                                       |
|  SYNC + Load   |   Branch B                            [X / Y]   |
|                |     PR #3 [Ahead:2]                             |
| (does not      | Orphaned Issues                                 |
|  scroll)       |   JIRA-456 [In Review] - Issue Summary          |
+----------------+-------------------------------------------------+
```

and replace the `### 8.3 Responsive Behavior` list with:

```markdown
- Desktop-first: the banner and the filter sidebar stay fixed while the pull-request pane scrolls
- The sidebar can be hidden (button or `F` key); the state is remembered per browser
- Below 900px the sidebar becomes a drawer over the pane and the banner hides its text labels
- Repository and branch headers stick to the top of the pane while scrolling
- Modal overlay for help content
- Light and dark themes, following the OS setting until the toggle is used
```

- [ ] **Step 6: Check and commit**

Run: `npm test`
Expected: `ℹ fail 0`.

Start `node index.mjs`, open http://localhost:3000: the banner shows `v2.2.0`; open the help modal: the README renders with the new features and changelog. Stop the server.

```bash
git add package.json README.md CLAUDE.md PRD.md
git commit -m "docs: version 2.2.0, README, CLAUDE.md and PRD for the new layout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EZCANUDoVq6pd6b9i8vGbg"
```

---

## Plan self-review

- **Spec coverage:** banner (Task 4), tab title with project (4) and attention count (5), stacked filters in a fixed sidebar (4), hideable with persistence and drawer (4), one app name (4, 7), project selector and refresh in the banner (4), footer retired (4), badge and clear (5), sticky headers (4), ready-for-reviewer fix (1), CSS cleanup and tokens (3), system font (3), dark theme (6), shortcut (4), collapse/expand all (2, 5), empty/loading/error states (4), popover fix (4), version and docs (7).
- **Spec deviations, on purpose:** the sidebar class lives on `<html>` instead of `<body>` so the inline head script can set it before paint; the token for text on coloured backgrounds is named `--on-accent-text` instead of `--repo-header-text` because it serves counters and badges too; the popover also flips above its link when it does not fit below; the tree pane's padding sits on the `.tree-pane` content element rather than on the scrolling `.main-pane`, because a scroll container's own padding insets the sticky area and left a 24px strip above the sticky headers.
- **Names used across tasks:** `computeAttention`, `countActiveFilters`, `filterBranches` (returns a number) from Task 1; `collapseAll`, `expandAll`, `captureToggleStates`, `restoreToggleStates`, `toggleChildren`, `toggleRootBranch`, `toggleRepository`, class `pull-request-root` from Task 2; `.button`, `.info-icon`, `--on-accent-text`, `--chevron-icon` from Task 3; `initializeAppShell`, `updateDocumentTitle`, `closeSidebarDrawer`, `buildDocumentTitle`, `showEmptyState`, `showLoadingState`, `showErrorState`, `renderEverything(apiResult)` from Task 4; `applyFilters`, `clearAllFilters`, `currentFilters`, `updateActiveFilterBadge`, `setToolbarVisible` from Task 5; `applyTheme`, `initializeTheme` from Task 6.
