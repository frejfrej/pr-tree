/**
 * Collapse and expand helpers for the pull-request tree.
 *
 * Repositories, root branches and pull requests with children can be
 * collapsed. Every code path that changes a collapsed state goes through the
 * set*Collapsed helpers, so the collapsed class, the children container, the
 * child counter and the aria-expanded of the toggle button always change
 * together. The chevrons are pure CSS, driven by the "collapsed" class.
 * app.js installs handleTreeClick on the tree pane; the rendered tree carries
 * no inline handler.
 */

// The toggle button of a block announces whether the block is open
function setExpanded(button, collapsed) {
    if (button) {
        button.setAttribute('aria-expanded', String(!collapsed));
    }
}

export function setRepositoryCollapsed(repository, collapsed) {
    repository.classList.toggle('collapsed', collapsed);
    setExpanded(repository.querySelector(':scope > .repository-header > .toggle-button'), collapsed);
}

export function setRootBranchCollapsed(rootBranch, collapsed) {
    rootBranch.classList.toggle('collapsed', collapsed);
    setExpanded(rootBranch.querySelector(':scope > .root-branch-header > .toggle-button'), collapsed);
}

export function setPullRequestCollapsed(pullRequest, collapsed) {
    const children = pullRequest.nextElementSibling;
    if (!children || !children.classList.contains('children')) {
        return;
    }
    pullRequest.classList.toggle('collapsed', collapsed);
    children.hidden = collapsed;
    // The header is nested a few levels down; the stacked pull requests are
    // in the sibling .children container, never inside this element
    setExpanded(pullRequest.querySelector('.pull-request-header > .toggle-button'), collapsed);
    // The child counter is shown on root pull requests permanently, and on
    // other pull requests only while they are collapsed. counter-utils only
    // refreshes counters carrying the "visible" class.
    const childCounter = pullRequest.querySelector('.child-counter');
    if (childCounter) {
        const isRoot = pullRequest.classList.contains('pull-request-root');
        childCounter.classList.toggle('visible', collapsed || isRoot);
    }
}

// The three toggles: what handleTreeClick calls for the block a click lands on
function toggleRepository(button) {
    const repository = button.closest('.repository');
    setRepositoryCollapsed(repository, !repository.classList.contains('collapsed'));
}

function toggleRootBranch(button) {
    const rootBranch = button.closest('.root-branch');
    setRootBranchCollapsed(rootBranch, !rootBranch.classList.contains('collapsed'));
}

function toggleChildren(button) {
    const pullRequest = button.closest('.pull-request');
    setPullRequestCollapsed(pullRequest, !pullRequest.classList.contains('collapsed'));
}

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

// What a re-render puts back, by kind: the key of an element and how to collapse it.
// Two repositories share branch names and pull-request ids, so the root branches and
// the pull requests are known by keys that name their repository (pull-request-key.mjs)
const collapsibleKinds = {
    repositories: { selector: '.repository', keyOf: element => element.querySelector('.repository-name')?.textContent.trim(), setCollapsed: setRepositoryCollapsed },
    rootBranches: { selector: '.root-branch', keyOf: element => element.dataset.rootBranchKey, setCollapsed: setRootBranchCollapsed },
    pullRequests: { selector: '.pull-request', keyOf: element => element.dataset.id, setCollapsed: setPullRequestCollapsed }
};

/**
 * The keys of what is collapsed, per kind: repository names, root branch keys
 * (#103) and pull request keys (#99), so a re-render can put the tree back as
 * the user left it.
 * @returns {{ repositories: string[], rootBranches: string[], pullRequests: string[] }}
 */
export function captureToggleStates() {
    return Object.fromEntries(Object.entries(collapsibleKinds).map(([kind, { selector, keyOf }]) =>
        [kind, [...document.querySelectorAll(`${selector}.collapsed`)].map(keyOf).filter(Boolean)]));
}

/** Collapses the elements whose keys captureToggleStates returned: one map of the rendered elements per kind with something to restore */
export function restoreToggleStates(states) {
    if (!states) return;
    for (const [kind, { selector, keyOf, setCollapsed }] of Object.entries(collapsibleKinds)) {
        const keys = states[kind];
        if (keys.length === 0) continue;
        const elementsByKey = new Map([...document.querySelectorAll(selector)].map(element => [keyOf(element), element]));
        for (const key of keys) {
            const element = elementsByKey.get(key);
            if (element) setCollapsed(element, true);
        }
    }
}
