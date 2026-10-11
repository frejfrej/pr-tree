import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRepositoryCollapsed, setRootBranchCollapsed, setPullRequestCollapsed, handleTreeClick, captureToggleStates, restoreToggleStates } from '../public/tree-toggle.js';

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

test('the collapse of a pull request survives a re-render by repository and id: #45 of two repositories are two pull requests (#99)', t => {
    // Two rows with children, one per repository, both pull request #45
    const row = key => element({ classes: ['pull-request'], next: element({ classes: ['children'] }), dataset: { id: key } });
    const tree = rows => ({ querySelectorAll: selector => (selector === '.pull-request' ? rows : []) });
    const previousDocument = globalThis.document;
    t.after(() => { globalThis.document = previousDocument; });

    const before = [row('repo-a/45'), row('repo-b/45')];
    setPullRequestCollapsed(before[1], true);
    globalThis.document = tree(before);
    const states = captureToggleStates();
    assert.deepEqual(states.pullRequests, [{ key: 'repo-a/45', collapsed: false }, { key: 'repo-b/45', collapsed: true }]);

    // The re-rendered tree: only repo-b's #45 is collapsed again
    const after = [row('repo-a/45'), row('repo-b/45')];
    globalThis.document = tree(after);
    restoreToggleStates(states);
    assert.deepEqual(after.map(pullRequest => pullRequest.classList.contains('collapsed')), [false, true]);
});

test('the collapse of a root branch survives a re-render by repository and branch: master of two repositories are two branches (#103)', t => {
    const branch = key => element({ classes: ['root-branch'], dataset: { rootBranchKey: key } });
    const tree = branches => ({ querySelectorAll: selector => (selector === '.root-branch' ? branches : []) });
    const previousDocument = globalThis.document;
    t.after(() => { globalThis.document = previousDocument; });

    // B's master collapsed, listed after A's: the name alone restored A's master and expanded B's again
    const before = [branch('repo-a/master'), branch('repo-b/master'), branch('repo-b/develop')];
    setRootBranchCollapsed(before[1], true);
    globalThis.document = tree(before);
    const states = captureToggleStates();
    assert.deepEqual(states.rootBranches, [
        { key: 'repo-a/master', collapsed: false }, { key: 'repo-b/master', collapsed: true }, { key: 'repo-b/develop', collapsed: false }
    ]);

    const after = [branch('repo-a/master'), branch('repo-b/master'), branch('repo-b/develop')];
    globalThis.document = tree(after);
    restoreToggleStates(states);
    assert.deepEqual(after.map(rootBranch => rootBranch.classList.contains('collapsed')), [false, true, false]);
});
