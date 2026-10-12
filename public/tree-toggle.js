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
 *
 * What is collapsed is kept by key, per kind: across a re-render in memory
 * (captureToggleStates, restoreToggleStates), across a page reload in
 * localStorage, one entry per project (#142). A fold or an unfold by the
 * user, whichever path made it (a click, a key, Collapse all), reaches the
 * listener app.js sets with onFoldChange, once per task; a restore does
 * not. app.js decides when the entry is read, written and pruned.
 */

import { readStorage, writeStorage, removeStorage } from './local-storage.js';

// The listener of the user's folds, called once after the folds of a task
// (Collapse all folds hundreds of blocks); a restore folds nothing for it
let foldListener = () => {};
let foldNoticePending = false;
let restoring = false;

/** Sets what runs after the user folds or unfolds anything: app.js stores the collapse state */
export function onFoldChange(listener) {
    foldListener = listener;
}

// Called before a block's collapsed class changes to `collapsed`
function noticeFold(element, collapsed) {
    if (restoring || foldNoticePending || element.classList.contains('collapsed') === collapsed) return;
    foldNoticePending = true;
    queueMicrotask(() => {
        foldNoticePending = false;
        foldListener();
    });
}

// The toggle button of a block announces whether the block is open
function setExpanded(button, collapsed) {
    if (button) {
        button.setAttribute('aria-expanded', String(!collapsed));
    }
}

export function setRepositoryCollapsed(repository, collapsed) {
    noticeFold(repository, collapsed);
    repository.classList.toggle('collapsed', collapsed);
    setExpanded(repository.querySelector(':scope > .repository-header > .toggle-button'), collapsed);
}

export function setRootBranchCollapsed(rootBranch, collapsed) {
    noticeFold(rootBranch, collapsed);
    rootBranch.classList.toggle('collapsed', collapsed);
    setExpanded(rootBranch.querySelector(':scope > .root-branch-header > .toggle-button'), collapsed);
}

export function setPullRequestCollapsed(pullRequest, collapsed) {
    const children = pullRequest.nextElementSibling;
    if (!children || !children.classList.contains('children')) {
        return;
    }
    noticeFold(pullRequest, collapsed);
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

/**
 * Whether a row (a root-branch header, a pull request or an orphaned issue) is
 * out of sight behind a collapse: inside a collapsed repository or root
 * branch, or inside the stacked pull requests of a collapsed pull request
 * (their container hidden). A collapsed row itself is in sight: only what it
 * stacks is not; a header stays in sight when its own branch is collapsed.
 */
export function isCollapsedAway(row) {
    const from = row.classList.contains('root-branch-header') ? row.parentElement?.parentElement : row;
    return Boolean(from?.closest('.repository.collapsed, .root-branch.collapsed, .children[hidden]'));
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
// the pull requests are known by keys that name their repository (pull-request-key.mjs).
// isFoldable: whether the element can be folded (a pull request stacking nothing cannot).
// prunable: whether a key absent from a render is gone for good (see pruneStoredToggleStates)
const collapsibleKinds = {
    repositories: { selector: '.repository', keyOf: element => element.querySelector('.repository-name')?.textContent.trim(), setCollapsed: setRepositoryCollapsed, isFoldable: () => true, prunable: false },
    rootBranches: { selector: '.root-branch', keyOf: element => element.dataset.rootBranchKey, setCollapsed: setRootBranchCollapsed, isFoldable: () => true, prunable: false },
    pullRequests: { selector: '.pull-request', keyOf: element => element.dataset.id, setCollapsed: setPullRequestCollapsed, isFoldable: element => Boolean(element.nextElementSibling?.classList.contains('children')), prunable: true }
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

/**
 * Collapses the elements whose keys captureToggleStates returned: one map of
 * the rendered elements per kind with something to restore. Not a fold of the
 * user's: the fold listener is not called.
 */
export function restoreToggleStates(states) {
    if (!states) return;
    restoring = true;
    try {
        for (const [kind, { selector, keyOf, setCollapsed }] of Object.entries(collapsibleKinds)) {
            const keys = states[kind];
            if (keys.length === 0) continue;
            const elementsByKey = new Map([...document.querySelectorAll(selector)].map(element => [keyOf(element), element]));
            for (const key of keys) {
                const element = elementsByKey.get(key);
                if (element) setCollapsed(element, true);
            }
        }
    } finally {
        restoring = false;
    }
}

// ------------------------------------------------- across a page reload (#142)

/** The localStorage entry of a project's collapse state */
export function collapseStateStorageKey(project) {
    return `prTree.collapsed.${project}`;
}

/**
 * The collapse state of a stored entry, as captureToggleStates returns it;
 * nothing collapsed for a missing entry or one of another shape (junk, a
 * hand edit): a key of each kind is a string
 * @param {string | null} text
 * @returns {{ repositories: string[], rootBranches: string[], pullRequests: string[] }}
 */
export function parseToggleStates(text) {
    let stored = null;
    try {
        stored = JSON.parse(text);
    } catch (error) {
        // Not JSON: nothing collapsed
    }
    return Object.fromEntries(Object.keys(collapsibleKinds).map(kind => {
        const keys = stored?.[kind];
        return [kind, Array.isArray(keys) ? keys.filter(key => typeof key === 'string') : []];
    }));
}

/** The collapse state stored for a project, to restore at its first render */
export function storedToggleStates(project) {
    return parseToggleStates(readStorage(collapseStateStorageKey(project)));
}

// Writes a project's entry when it changes; nothing collapsed removes it
function writeToggleStates(project, states) {
    const key = collapseStateStorageKey(project);
    if (Object.values(states).every(keys => keys.length === 0)) {
        removeStorage(key);
        return;
    }
    const text = JSON.stringify(states);
    if (readStorage(key) !== text) writeStorage(key, text);
}

/**
 * Stores the folds of the rendered tree as the project's entry: after the
 * user folds or unfolds. A stored key whose element the tree cannot fold
 * (not rendered now, or a pull request stacking nothing for now) is kept:
 * the user cannot have unfolded it.
 */
export function storeToggleStates(project) {
    const stored = storedToggleStates(project);
    const collapsed = captureToggleStates();
    writeToggleStates(project, Object.fromEntries(Object.entries(collapsibleKinds).map(([kind, { selector, keyOf, isFoldable }]) => {
        if (stored[kind].length === 0) return [kind, collapsed[kind]];
        const foldable = new Set([...document.querySelectorAll(selector)].filter(isFoldable).map(keyOf));
        return [kind, [...stored[kind].filter(key => !foldable.has(key)), ...collapsed[kind]]];
    })));
}

/**
 * Drops from the project's entry the pull requests the rendered tree no
 * longer has (merged, declined): after every render. A repository or a root
 * branch absent from a render is not gone: it shows only while it has an
 * open pull request (the orphaned-issues block, while it has an issue), so
 * its key stays, and the user drops it by unfolding it. The entry is pruned,
 * not replaced by this tree's folds, so a refresh in one tab does not undo
 * a fold made in another tab of the project since.
 */
export function pruneStoredToggleStates(project) {
    const stored = storedToggleStates(project);
    const pruned = Object.fromEntries(Object.entries(collapsibleKinds).map(([kind, { selector, keyOf, prunable }]) => {
        if (!prunable || stored[kind].length === 0) return [kind, stored[kind]];
        const rendered = new Set([...document.querySelectorAll(selector)].map(keyOf));
        return [kind, stored[kind].filter(key => rendered.has(key))];
    }));
    writeToggleStates(project, pruned);
}
