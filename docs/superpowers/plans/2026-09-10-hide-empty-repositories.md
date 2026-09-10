# Hide Empty Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide a repository block when the filters leave it without any visible pull request, and show a "No pull request matches the filters" message while every repository is hidden.

**Architecture:** The filter pass (`filterBranches` in `public/app-filter.js`) already hides a root branch whose visible count is 0; the repository gets the same treatment one level up, in the same walk. `renderRepositories` (`public/app.js`) appends a hidden message element after the repositories; the pass, which runs after every render and every filter change, shows it exactly when no repository is left visible. Nothing else changes: not the index, not the evaluation, not the URL.

**Tech Stack:** Vanilla ES modules, `node:test`. No server change.

**Spec:** `docs/superpowers/specs/2026-09-10-hide-empty-repositories-design.md`

**Branch:** `claude/hide-empty-repositories`, created from `master` (already checked out). Do not `git add` `config.js`, `config.js.test` or `.claude/`; add files by name. Commit messages end with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TcMUwKXicKzfDozyREWQdD
```

**Running the unit tests:** `npm test`, expected to end with `ℹ fail 0` (49 tests). The tree pass is DOM code and has no unit test (CLAUDE.md, "Testing Approach": UI is checked in the browser); the browser check is Task 2, done by the controller.

**Running the app for manual checks:** `PORT=3101 node index.mjs --fixtures` (port 3000 runs the user's real server, port 3100 an unrelated application), http://localhost:3101/?project=SECOLLAB.

---

### Task 1: Hide the repository and show the message

**Files:**
- Modify: `public/app-filter.js` (the `filterBranches` function, JSDoc and loop, around lines 273-305)
- Modify: `public/app.js` (`renderRepositories`, around lines 626-660)

- [ ] **Step 1: Hide the repository in the filter pass**

In `public/app-filter.js`, replace the JSDoc of `filterBranches` and the function body down to the `return` with:

```js
/**
 * Applies the filters to the rendered tree and refreshes the counters. A root
 * branch or a repository left without a visible pull request is hidden; while
 * every repository is hidden, the "nothing matches" message is shown instead.
 * @param {object} filters - { text, assignees, reviewers, sprints, fixVersions, epics, stories, sync, readyReviewer, readyAssignee }
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

    let shownRepositories = 0;
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

        // Hide the repository too when no pull request is left, like its branches
        setDisplay(repository, repositoryVisible > 0 ? '' : 'none');
        if (repositoryVisible > 0) shownRepositories++;
    }

    // renderRepositories renders the message hidden; it takes the place of the
    // tree while every repository is hidden
    const noMatch = document.querySelector('.tree-no-match');
    if (noMatch) noMatch.hidden = shownRepositories > 0;

    return pass.shownAttention;
}
```

- [ ] **Step 2: Render the message after the repositories**

In `public/app.js`, in `renderRepositories`, replace the final `return html;` (after the `for (const [repoName, repoPullRequests] ...)` loop) with:

```js
    // Shown by the filter pass while every repository is hidden
    if (Object.keys(pullRequestsByRepo).length > 0) {
        html += `
            <div class="state-message tree-no-match" hidden>
                <i class="fas fa-filter"></i>
                <span>No pull request matches the filters</span>
            </div>
        `;
    }
    return html;
```

(`hidden` works on a `.state-message`: the stylesheet has `[hidden] { display: none !important; }`.)

- [ ] **Step 3: Check the syntax and run the tests**

Run: `node --check public/app-filter.js && node --check public/app.js && npm test`
Expected: no syntax error, `ℹ fail 0`, 49 tests.

- [ ] **Step 4: Commit**

```bash
git add public/app-filter.js public/app.js
git commit -m "feat: hide the repositories left without a visible pull request, no-match message"
```

---

### Task 2: Browser check (controller)

Run: `PORT=3101 node index.mjs --fixtures`, open http://localhost:3101/?project=SECOLLAB.

- Type in the search box a word present in the pull requests of one repository only (a repository name works: source branches carry them in the fixtures, otherwise use a pull-request title word): the other repositories disappear, no empty header stays, the remaining repository keeps its `n/total` counter.
- Clear the search box: every repository is back with the full counter.
- Type `zzzz`: the tree is replaced by the filter icon and "No pull request matches the filters"; the orphaned issues section, when present, stays below it.
- Collapse a repository, type a word that hides it, clear the box: it is back and still collapsed.
- "Collapse all" then a filter that hides everything, "Expand all", clear: the repositories come back expanded.

Stop the server with Ctrl+C (or kill the process).

---

### Task 3: Documentation and version

**Files:**
- Modify: `README.md` (Features list around line 42, changelog at line 85)
- Modify: `CLAUDE.md` (version line, `filterBranches` bullet, Filtering Architecture step 3)
- Modify: `PRD.md` (F4.14 after the F4.13 line, around line 184)
- Modify: `package.json` (`version`, `releaseDate`)

- [ ] **Step 1: README**

a. In "Features", insert after the line `* Allows simultaneous filtering by both assignee and reviewer`:

```
* Hides the repositories and branches left without a matching pull request; when nothing matches, a message replaces the tree
```

b. Insert before the line `* Version 2.4.0` of the changelog:

```
* Version 2.5.0
    * Repositories left without a matching pull request are hidden by the filters, like their branches already were
    * When nothing matches, a "No pull request matches the filters" message replaces the tree; the orphaned issues stay listed
```

- [ ] **Step 2: CLAUDE.md**

a. Replace `Current version: **2.4.0** (as of 2026-09-09)` with `Current version: **2.5.0** (as of 2026-09-10)`.

b. In the `**public/app-filter.js**` block, replace the `filterBranches(filters)` bullet with:

```
- `filterBranches(filters)`: one walk of the rendered tree, direct children only, each pull request visited once; hides, highlights, sums the counters of repositories, root branches and child counters on the way back up, hides the root branches and repositories left without a visible pull request, shows the `.tree-no-match` message while every repository is hidden, returns the attention count
```

c. In "Filtering Architecture", replace step 3 `3. Children are evaluated first; a filtered-out parent stays displayed while a descendant is visible` with:

```
3. Children are evaluated first; a filtered-out parent stays displayed while a descendant is visible; a root branch or a repository with no visible pull request is hidden, and the `.tree-no-match` message rendered by `renderRepositories` is shown while every repository is hidden
```

- [ ] **Step 3: PRD.md**

Insert after the `- F4.13: ...` line:

```
- F4.14: Hide the repositories and branches left without a matching pull request; show a message when no pull request matches
```

- [ ] **Step 4: package.json**

Replace `"version": "2.4.0",` with `"version": "2.5.0",` and `"releaseDate": "2026-09-09",` with `"releaseDate": "2026-09-10",`.

- [ ] **Step 5: Check and commit**

Run: `npm test` (expected `ℹ fail 0`) and `curl -s localhost:3101/api/version` if the fixture server is still running (expected `"version":"2.5.0"` after a restart).

```bash
git add README.md CLAUDE.md PRD.md package.json
git commit -m "docs: version 2.5.0, repositories hidden when filtered empty"
```

The controller pushes the branch and opens the pull request (base `master`).

---

## Plan self-review

- **Spec coverage:** rule and counter refresh (Task 1 step 1), message rendered hidden and toggled by the pass (Task 1 steps 1-2), collapsed state untouched (nothing touches the `collapsed` class; checked in Task 2), version 2.5.0 (Task 3 step 4), docs (Task 3), verification (Task 2).
- **Placeholders:** none.
- **Type consistency:** the message element is `.tree-no-match` in `renderRepositories`, in `filterBranches` and in the docs; `shownRepositories` is local to `filterBranches`.
