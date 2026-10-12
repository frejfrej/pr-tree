import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRepositoryCollapsed, setRootBranchCollapsed, setPullRequestCollapsed, handleTreeClick, captureToggleStates, restoreToggleStates, collapseStateStorageKey, parseToggleStates, storedToggleStates, storeToggleStates, pruneStoredToggleStates, onFoldChange, collapseAll } from '../public/tree-toggle.js';

// The surface of an element the helpers touch: classList, the attributes, one
// querySelector and one closest answering the selectors of the module, hidden,
// nextElementSibling, dataset
function element({ classes = [], children = {}, next = null, closest = {}, dataset = {} } = {}) {
    const classSet = new Set(classes);
    const attributes = {};
    return {
        classList: {
            contains: name => classSet.has(name),
            toggle(name, force) { force ? classSet.add(name) : classSet.delete(name); }
        },
        getAttribute: name => attributes[name] ?? null,
        setAttribute(name, value) { attributes[name] = value; },
        querySelector: selector => children[selector] ?? null,
        closest: selector => closest[selector] ?? null,
        hidden: false,
        nextElementSibling: next,
        dataset
    };
}

test('setRepositoryCollapsed and setRootBranchCollapsed toggle the class and the aria-expanded of their own button', () => {
    const repoButton = element();
    const repository = element({ children: { ':scope > .repository-header > .toggle-button': repoButton } });
    setRepositoryCollapsed(repository, true);
    assert.ok(repository.classList.contains('collapsed'));
    assert.equal(repoButton.getAttribute('aria-expanded'), 'false');
    setRepositoryCollapsed(repository, false);
    assert.ok(!repository.classList.contains('collapsed'));
    assert.equal(repoButton.getAttribute('aria-expanded'), 'true');

    const branchButton = element();
    const rootBranch = element({ children: { ':scope > .root-branch-header > .toggle-button': branchButton } });
    setRootBranchCollapsed(rootBranch, true);
    assert.ok(rootBranch.classList.contains('collapsed'));
    assert.equal(branchButton.getAttribute('aria-expanded'), 'false');

    // A block without a button (none is rendered for it) is still collapsed
    const bare = element();
    setRepositoryCollapsed(bare, true);
    assert.ok(bare.classList.contains('collapsed'));
});

test('setPullRequestCollapsed hides the children, shows the child counter and flips aria-expanded; a leaf is left alone', () => {
    const button = element();
    const counter = element();
    const children = element({ classes: ['children'] });
    const pullRequest = element({ classes: ['pull-request'], next: children, children: { '.pull-request-header > .toggle-button': button, '.child-counter': counter } });
    setPullRequestCollapsed(pullRequest, true);
    assert.ok(pullRequest.classList.contains('collapsed'));
    assert.equal(children.hidden, true);
    assert.ok(counter.classList.contains('visible'));
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    setPullRequestCollapsed(pullRequest, false);
    assert.equal(children.hidden, false);
    assert.ok(!counter.classList.contains('visible')); // not a root: the counter shows only while collapsed
    assert.equal(button.getAttribute('aria-expanded'), 'true');

    const root = element({ classes: ['pull-request', 'pull-request-root'], next: children, children: { '.child-counter': counter } });
    setPullRequestCollapsed(root, false);
    assert.ok(counter.classList.contains('visible')); // a root keeps its counter

    const leaf = element({ classes: ['pull-request'], next: element({ classes: ['pull-request'] }) });
    setPullRequestCollapsed(leaf, true);
    assert.ok(!leaf.classList.contains('collapsed'));
});

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

// A document answering the selectors of captureToggleStates and restoreToggleStates
// over the given elements: `.kind` and `.kind.collapsed`
const fakeTree = elements => ({
    querySelectorAll: selector => {
        const [kind, state] = selector.slice(1).split('.');
        return elements.filter(element => element.classList.contains(kind) && (!state || element.classList.contains(state)));
    }
});

function captureAndRestore(t, makeElements, collapse) {
    const previousDocument = globalThis.document;
    t.after(() => { globalThis.document = previousDocument; });
    const before = makeElements();
    collapse(before);
    globalThis.document = fakeTree(before);
    const states = captureToggleStates();
    const after = makeElements();
    globalThis.document = fakeTree(after);
    restoreToggleStates(states);
    return { states, after };
}

test('the collapse of a pull request survives a re-render by repository and id: #45 of two repositories are two pull requests (#99)', t => {
    const row = key => element({ classes: ['pull-request'], next: element({ classes: ['children'] }), dataset: { id: key } });
    const { states, after } = captureAndRestore(t, () => [row('repo-a/45'), row('repo-b/45')], ([, second]) => setPullRequestCollapsed(second, true));
    assert.deepEqual(states.pullRequests, ['repo-b/45']);
    assert.deepEqual(after.map(pullRequest => pullRequest.classList.contains('collapsed')), [false, true]);
});

test('the collapse of a root branch survives a re-render by repository and branch: master of two repositories are two branches (#103)', t => {
    // B's master collapsed, listed after A's: the name alone restored A's master and expanded B's again
    const branch = key => element({ classes: ['root-branch'], dataset: { rootBranchKey: key } });
    const { states, after } = captureAndRestore(t, () => [branch('repo-a:master'), branch('repo-b:master'), branch('repo-b:develop')], ([, second]) => setRootBranchCollapsed(second, true));
    assert.deepEqual(states, { repositories: [], rootBranches: ['repo-b:master'], pullRequests: [] });
    assert.deepEqual(after.map(rootBranch => rootBranch.classList.contains('collapsed')), [false, true, false]);
});

test('the collapse of a repository survives a re-render by its name, the orphaned-issues block included', t => {
    const repository = name => element({ classes: ['repository'], children: { '.repository-name': { textContent: `  ${name}\n` } } });
    const { states, after } = captureAndRestore(t, () => [repository('repo-a'), repository('repo-b'), repository('Jira issues in review without a pull request')],
        ([, second, orphaned]) => { setRepositoryCollapsed(second, true); setRepositoryCollapsed(orphaned, true); });
    assert.deepEqual(states.repositories, ['repo-b', 'Jira issues in review without a pull request']);
    assert.deepEqual(after.map(element => element.classList.contains('collapsed')), [false, true, true]);
});

import { isCollapsedAway } from '../public/tree-toggle.js';
import { node } from './fake-dom.mjs';

test('isCollapsedAway: a row inside a collapsed repository, root branch or pull request is out of sight; the collapsed row itself is not (#118)', () => {
    const child = node({ classes: ['pull-request'] });
    const parent = node({ classes: ['pull-request'] }, node({ classes: ['pull-request-header'] }));
    const children = node({ classes: ['children'] }, child);
    const header = node({ classes: ['root-branch-header'] });
    const rootBranch = node({ classes: ['root-branch'] }, header, node({ classes: ['root-branch-content'] }, parent, children));
    const repository = node({ classes: ['repository'] }, node({ classes: ['repository-content'] }, rootBranch));
    const orphan = node({ classes: ['orphaned-issue'] });
    const orphanedIssues = node({ classes: ['repository', 'orphaned-issues'] }, node({ classes: ['repository-content'] }, orphan));
    node({}, repository, orphanedIssues);

    assert.equal(isCollapsedAway(child), false);
    setPullRequestCollapsed(parent, true);
    assert.equal(isCollapsedAway(child), true);
    assert.equal(isCollapsedAway(parent), false);
    setPullRequestCollapsed(parent, false);
    rootBranch.classList.add('collapsed');
    assert.equal(isCollapsedAway(parent), true);
    assert.equal(isCollapsedAway(header), false); // a header stays in sight when its own branch is collapsed
    rootBranch.classList.toggle('collapsed', false);
    repository.classList.add('collapsed');
    assert.equal(isCollapsedAway(parent), true);
    assert.equal(isCollapsedAway(header), true);
    assert.equal(isCollapsedAway(node({ classes: ['root-branch-header'] })), false); // detached by a re-render: no throw
    assert.equal(isCollapsedAway(orphan), false);
    orphanedIssues.classList.add('collapsed');
    assert.equal(isCollapsedAway(orphan), true);
});

// ------------------------------------------------- across a page reload (#142)

// A localStorage keeping its entries in a Map and counting the writes, and a
// document over the given elements, both put on globalThis for the test
function withStorageAndTree(t, elements, entries = {}) {
    const previous = { localStorage: globalThis.localStorage, document: globalThis.document };
    t.after(() => Object.assign(globalThis, previous));
    const map = new Map(Object.entries(entries));
    const storage = {
        writes: 0,
        map,
        getItem: key => map.get(key) ?? null,
        setItem(key, value) { this.writes++; map.set(key, String(value)); },
        removeItem(key) { this.writes++; map.delete(key); }
    };
    globalThis.localStorage = storage;
    globalThis.document = fakeTree(elements);
    return storage;
}

const pullRequestRow = key => element({ classes: ['pull-request'], next: element({ classes: ['children'] }), dataset: { id: key } });
const rootBranchElement = key => element({ classes: ['root-branch'], dataset: { rootBranchKey: key } });
const repositoryElement = name => element({ classes: ['repository'], children: { '.repository-name': { textContent: name } } });

test('collapseStateStorageKey: one entry per project', () => {
    assert.equal(collapseStateStorageKey('SECOLLAB'), 'prTree.collapsed.SECOLLAB');
    assert.notEqual(collapseStateStorageKey('A'), collapseStateStorageKey('B'));
});

test('parseToggleStates: the three kinds of a stored entry; nothing collapsed for a missing entry, junk or another shape', () => {
    const none = { repositories: [], rootBranches: [], pullRequests: [] };
    assert.deepEqual(parseToggleStates(null), none);
    assert.deepEqual(parseToggleStates('not json'), none);
    assert.deepEqual(parseToggleStates('42'), none);
    assert.deepEqual(parseToggleStates('["repo-a"]'), none);
    assert.deepEqual(parseToggleStates('{"repositories":"repo-a","pullRequests":null}'), none);
    assert.deepEqual(parseToggleStates('{"repositories":["repo-a",3,null],"rootBranches":["repo-a:master"],"pullRequests":["repo-a/45"],"other":["x"]}'),
        { repositories: ['repo-a'], rootBranches: ['repo-a:master'], pullRequests: ['repo-a/45'] });
});

test('storeToggleStates writes what the tree has collapsed, only when it changed; nothing collapsed removes the entry', t => {
    const tree = [repositoryElement('repo-a'), rootBranchElement('repo-a:master'), pullRequestRow('repo-a/45'), pullRequestRow('repo-a/46')];
    const storage = withStorageAndTree(t, tree);
    const key = collapseStateStorageKey('P');
    setRootBranchCollapsed(tree[1], true);
    setPullRequestCollapsed(tree[3], true);
    storeToggleStates('P');
    assert.deepEqual(JSON.parse(storage.map.get(key)), { repositories: [], rootBranches: ['repo-a:master'], pullRequests: ['repo-a/46'] });
    assert.equal(storage.writes, 1);
    // A key move, or a click that folds and unfolds back: nothing new is written
    storeToggleStates('P');
    assert.equal(storage.writes, 1);
    setRootBranchCollapsed(tree[1], false);
    setPullRequestCollapsed(tree[3], false);
    storeToggleStates('P');
    assert.equal(storage.map.has(key), false);
});

test('storeToggleStates keeps the stored keys the tree cannot fold now: a block not rendered, a pull request stacking nothing for now (#142)', t => {
    const key = collapseStateStorageKey('P');
    // repo-b and repo-a:develop have no open pull request for now; repo-a/45 stacks nothing for now; repo-a/46 is rendered expanded
    const stored = JSON.stringify({ repositories: ['repo-b'], rootBranches: ['repo-a:develop'], pullRequests: ['repo-a/45', 'repo-a/46'] });
    const leaf = element({ classes: ['pull-request'], next: element({ classes: ['pull-request'] }), dataset: { id: 'repo-a/45' } });
    const tree = [repositoryElement('repo-a'), rootBranchElement('repo-a:master'), leaf, pullRequestRow('repo-a/46')];
    const storage = withStorageAndTree(t, tree, { [key]: stored });
    setRootBranchCollapsed(tree[1], true);
    storeToggleStates('P');
    assert.deepEqual(JSON.parse(storage.map.get(key)), { repositories: ['repo-b'], rootBranches: ['repo-a:develop', 'repo-a:master'], pullRequests: ['repo-a/45'] });
});

test('onFoldChange: one call after the folds of a task, by any path; none for a restore or a block left as it was (#142)', async t => {
    const tree = [repositoryElement('repo-a'), rootBranchElement('repo-a:master'), pullRequestRow('repo-a/45'), pullRequestRow('repo-a/46')];
    withStorageAndTree(t, tree);
    let calls = 0;
    onFoldChange(() => calls++);
    t.after(() => onFoldChange(() => {}));
    const settled = () => new Promise(resolve => setTimeout(resolve, 0));

    collapseAll();
    assert.equal(calls, 0); // after the task's folds, not during them
    await settled();
    assert.equal(calls, 1);
    setPullRequestCollapsed(tree[2], true); // already collapsed
    setRepositoryCollapsed(tree[0], true);
    await settled();
    assert.equal(calls, 1);
    setPullRequestCollapsed(tree[2], false);
    await settled();
    assert.equal(calls, 2);
    restoreToggleStates({ repositories: [], rootBranches: [], pullRequests: ['repo-a/45'] });
    await settled();
    assert.equal(calls, 2);
});

test('a page load restores what was stored: the collapse survives a reload by key, in the project it was made in (#142)', t => {
    const makeTree = () => [repositoryElement('repo-b'), rootBranchElement('repo-a:master'), rootBranchElement('repo-b:master'), pullRequestRow('repo-a/45'), pullRequestRow('repo-b/45')];
    const before = makeTree();
    withStorageAndTree(t, before);
    setRepositoryCollapsed(before[0], true);
    setRootBranchCollapsed(before[2], true);
    setPullRequestCollapsed(before[4], true);
    storeToggleStates('P');

    // The reload: a new tree, nothing in memory
    const after = makeTree();
    globalThis.document = fakeTree(after);
    restoreToggleStates(storedToggleStates('P'));
    assert.deepEqual(after.map(block => block.classList.contains('collapsed')), [true, false, true, false, true]);
    // Another project has its own entry: nothing collapsed there
    assert.deepEqual(storedToggleStates('Q'), { repositories: [], rootBranches: [], pullRequests: [] });
});

test('pruneStoredToggleStates drops the pull requests the render no longer has, keeps those it shows expanded and every repository and branch, and removes an emptied entry', t => {
    const key = collapseStateStorageKey('P');
    const stored = JSON.stringify({ repositories: ['repo-a', 'gone-repo'], rootBranches: ['repo-a:release'], pullRequests: ['repo-a/45', 'repo-a/merged', '45'] });
    // repo-a/45 is rendered expanded: another tab may have folded it since this tab's render
    const storage = withStorageAndTree(t, [repositoryElement('repo-a'), rootBranchElement('repo-a:master'), pullRequestRow('repo-a/45')], { [key]: stored });
    pruneStoredToggleStates('P');
    // A repository or a branch shows only while it has an open pull request: absent is not gone
    assert.deepEqual(JSON.parse(storage.map.get(key)), { repositories: ['repo-a', 'gone-repo'], rootBranches: ['repo-a:release'], pullRequests: ['repo-a/45'] });
    assert.equal(storage.writes, 1);
    pruneStoredToggleStates('P');
    assert.equal(storage.writes, 1); // nothing more to drop: no write
    storage.map.set(key, JSON.stringify({ repositories: [], rootBranches: [], pullRequests: ['repo-a/merged'] }));
    pruneStoredToggleStates('P');
    assert.equal(storage.map.has(key), false);
});

test('the stored state does without storage: a blocked localStorage reads as nothing collapsed and writes nothing, without throwing', t => {
    withStorageAndTree(t, [pullRequestRow('repo-a/45')]);
    const blocked = () => { throw new Error('SecurityError'); };
    globalThis.localStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };
    setPullRequestCollapsed(globalThis.document.querySelectorAll('.pull-request')[0], true);
    assert.doesNotThrow(() => storeToggleStates('P'));
    assert.doesNotThrow(() => pruneStoredToggleStates('P'));
    assert.deepEqual(storedToggleStates('P'), { repositories: [], rootBranches: [], pullRequests: [] });
});
